import { buildWeightedJumpGraph, dijkstraAllCostsFrom, dijkstraJumpCountsFrom } from "./cat-jump-graph.js";

export function createCatJumpPlanningRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    ROOM,
    getSurfaceDefs,
    getSurfaceById,
    CUP_COLLISION,
    pickups,
    cup,
    pickupRadius,
    buildCatObstacles,
    isCatPointBlocked,
    computeCatPath,
    isPathTraversable,
    catPathDistance,
    hasClearTravelLine,
    recordFunctionTrace,
  } = ctx;

  const SURFACE_CFG = {
    anchorsPerimeterTarget: 20,
    circleAnchors: 10,
    jumpAngleMinDownDeg: 0,
    jumpAngleMaxDownDeg: 60,
    jumpAngleStepDeg: 2,
    jumpMaxDistance: 1.6,
    jumpUpArc: 0.46,
    jumpDownArc: 0.34,
    launchOuterPad: 0.02,
    landingClearanceMul: 1.5,
    jumpVerticalProbePad: 0.22,
    jumpSideProbeMul: 0.42,
    // For down-jumps, stage nearer the edge to reduce visual mismatch
    // between the edge animation and physical launch point.
    downJumpEdgeBias: 0.72,
    sameLevelTolerance: 0.08,
    // Keep vertical hops physically plausible: chair->high platform links are rejected.
    maxJumpUpHeight: 1.28,
  };

  const floorY = 0;
  const jumpGraphCache = {
    graph: null,
    fromCache: new Map(),
    jumpCountFromCache: new Map(),
    linkByAnchorKey: new Map(),
  };

  function pointKey(v, quantum = 0.02) {
    const q = (n) => Math.round((Number.isFinite(n) ? n : 0) / quantum);
    return `${q(v.x)}:${q(v.z)}`;
  }

  function linkAnchorKey(fromSurfaceId, toSurfaceId, v) {
    return `${fromSurfaceId || "?"}->${toSurfaceId || "?"}:${pointKey(v)}`;
  }

  function normalizeAvoidSurfaceIds(avoidSurfaceIds) {
    const out = new Set();
    if (!avoidSurfaceIds) return out;
    if (avoidSurfaceIds instanceof Set) {
      for (const id of avoidSurfaceIds) {
        if (id != null && id !== "") out.add(String(id));
      }
      return out;
    }
    if (Array.isArray(avoidSurfaceIds)) {
      for (const id of avoidSurfaceIds) {
        if (id != null && id !== "") out.add(String(id));
      }
      return out;
    }
    if (avoidSurfaceIds != null && avoidSurfaceIds !== "") {
      out.add(String(avoidSurfaceIds));
    }
    return out;
  }

  function traceFunction(name, details = "") {
    if (typeof recordFunctionTrace === "function") {
      recordFunctionTrace(name, details);
    }
  }

  function cloneXZ(v) {
    return new THREE.Vector3(v.x, 0, v.z);
  }

  function getConfiguredJumpSurfaces() {
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: true }) : [];
    if (!Array.isArray(defs)) return [];
    const out = [];
    const seen = new Set();
    for (const def of defs) {
      if (!def) continue;
      const minX = Number(def.minX);
      const maxX = Number(def.maxX);
      const minZ = Number(def.minZ);
      const maxZ = Number(def.maxZ);
      const y = Number(def.y);
      if (![minX, maxX, minZ, maxZ, y].every(Number.isFinite)) continue;
      if (maxX - minX <= 0.08 || maxZ - minZ <= 0.08) continue;
      const id = String(def.id || def.name || `surface-${out.length}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, minX, maxX, minZ, maxZ, y });
    }
    return out;
  }

  function makeRectSurface(id, y, minX, maxX, minZ, maxZ, inset) {
    const safeInset = Math.max(0, inset);
    const inner = {
      minX: minX + safeInset,
      maxX: maxX - safeInset,
      minZ: minZ + safeInset,
      maxZ: maxZ - safeInset,
    };
    return {
      id,
      y,
      outer: { minX, maxX, minZ, maxZ },
      inner,
      anchors: [],
    };
  }

  function isInsideRect(rect, x, z, pad = 0) {
    return (
      x >= rect.minX + pad &&
      x <= rect.maxX - pad &&
      z >= rect.minZ + pad &&
      z <= rect.maxZ - pad
    );
  }

  function finalizeAnchors(surface, anchors) {
    const inner = surface.inner || surface.outer;
    const cx = ((inner?.minX ?? 0) + (inner?.maxX ?? 0)) * 0.5;
    const cz = ((inner?.minZ ?? 0) + (inner?.maxZ ?? 0)) * 0.5;
    anchors.sort((a, b) => {
      const aa = Math.atan2(a.inner.z - cz, a.inner.x - cx);
      const bb = Math.atan2(b.inner.z - cz, b.inner.x - cx);
      return aa - bb;
    });
    for (let i = 0; i < anchors.length; i++) {
      anchors[i].id = `${surface.id}:a${i}`;
      anchors[i].ringIndex = i;
      anchors[i].nodeId = `node:${surface.id}:inner:${i}`;
    }
    return anchors;
  }

  function getRectAnchorCountPerEdge(surface, perimeterTarget = SURFACE_CFG.anchorsPerimeterTarget) {
    const sideCount = 4;
    const totalTarget = Math.max(sideCount, Math.ceil(Number(perimeterTarget) || sideCount));
    return Math.max(2, Math.ceil(totalTarget / sideCount));
  }

  function buildRectAnchors(surface, perimeterTarget = SURFACE_CFG.anchorsPerimeterTarget) {
    const anchors = [];
    const n = getRectAnchorCountPerEdge(surface, perimeterTarget);
    const inner = surface.inner;
    const outer = surface.outer;

    if (inner.minX >= inner.maxX || inner.minZ >= inner.maxZ) return anchors;

    const addAnchor = (edgeIndex, t, innerX, innerZ, outerX, outerZ, nx, nz) => {
      anchors.push({
        surfaceId: surface.id,
        edgeIndex,
        t,
        inner: new THREE.Vector3(innerX, 0, innerZ),
        outer: new THREE.Vector3(outerX, 0, outerZ),
        normal: new THREE.Vector3(nx, 0, nz),
      });
    };

    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const xI = THREE.MathUtils.lerp(inner.minX, inner.maxX, t);
      addAnchor(0, t, xI, inner.maxZ, xI, outer.maxZ, 0, 1);
    }
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const zI = THREE.MathUtils.lerp(inner.maxZ, inner.minZ, t);
      addAnchor(1, t, inner.maxX, zI, outer.maxX, zI, 1, 0);
    }
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const xI = THREE.MathUtils.lerp(inner.maxX, inner.minX, t);
      addAnchor(2, t, xI, inner.minZ, xI, outer.minZ, 0, -1);
    }
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const zI = THREE.MathUtils.lerp(inner.minZ, inner.maxZ, t);
      addAnchor(3, t, inner.minX, zI, outer.minX, zI, -1, 0);
    }

    return finalizeAnchors(surface, anchors);
  }

  function buildCircleAnchors(surface, anchorCount = SURFACE_CFG.circleAnchors) {
    const anchors = [];
    const centerX = Number(surface.cx ?? surface.centerX ?? surface.x ?? 0);
    const centerZ = Number(surface.cz ?? surface.centerZ ?? surface.z ?? 0);
    const innerRadius = Number(surface.innerRadius ?? surface.radius ?? 0);
    const outerRadius = Number(surface.outerRadius ?? surface.radius ?? innerRadius);
    const count = Math.max(3, Math.ceil(Number(anchorCount) || 0));
    if (!(innerRadius > 0) || !(outerRadius > 0)) return anchors;

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * Math.PI * 2;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      anchors.push({
        surfaceId: surface.id,
        edgeIndex: 0,
        t,
        inner: new THREE.Vector3(centerX + nx * innerRadius, 0, centerZ + nz * innerRadius),
        outer: new THREE.Vector3(centerX + nx * outerRadius, 0, centerZ + nz * outerRadius),
        normal: new THREE.Vector3(nx, 0, nz),
      });
    }

    return finalizeAnchors(surface, anchors);
  }

  function buildSurfaceAnchors(surface) {
    const shape = String(surface?.shape || surface?.shapeType || 'rect').toLowerCase();
    if (shape === 'circle' || shape === 'disc' || shape === 'disk') {
      return buildCircleAnchors(surface, SURFACE_CFG.circleAnchors);
    }
    return buildRectAnchors(surface, SURFACE_CFG.anchorsPerimeterTarget);
  }

  function intersectProbeWithSurface(origin, dir, maxDist, surface, sameLevelTolerance = SURFACE_CFG.sameLevelTolerance) {
    const EPS = 1e-6;
    const dy = dir.y;
    // Horizontal probe: allow same-level links by ray-vs-rect intersection in XZ.
    if (Math.abs(dy) < EPS) {
      if (Math.abs(surface.y - origin.y) > sameLevelTolerance) return null;
      let tMin = 0;
      let tMax = maxDist;

      if (Math.abs(dir.x) < EPS) {
        if (origin.x < surface.inner.minX || origin.x > surface.inner.maxX) return null;
      } else {
        const tx1 = (surface.inner.minX - origin.x) / dir.x;
        const tx2 = (surface.inner.maxX - origin.x) / dir.x;
        tMin = Math.max(tMin, Math.min(tx1, tx2));
        tMax = Math.min(tMax, Math.max(tx1, tx2));
        if (tMin > tMax) return null;
      }

      if (Math.abs(dir.z) < EPS) {
        if (origin.z < surface.inner.minZ || origin.z > surface.inner.maxZ) return null;
      } else {
        const tz1 = (surface.inner.minZ - origin.z) / dir.z;
        const tz2 = (surface.inner.maxZ - origin.z) / dir.z;
        tMin = Math.max(tMin, Math.min(tz1, tz2));
        tMax = Math.min(tMax, Math.max(tz1, tz2));
        if (tMin > tMax) return null;
      }

      const t = tMin > EPS ? tMin : (tMax > EPS ? tMax : null);
      if (!Number.isFinite(t) || t <= 0 || t > maxDist) return null;
      return {
        t,
        point: new THREE.Vector3(origin.x + dir.x * t, surface.y, origin.z + dir.z * t),
      };
    }

    const t = (surface.y - origin.y) / dy;
    if (!(t > 0 && t <= maxDist)) return null;
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    if (!isInsideRect(surface.inner, x, z, 0)) return null;
    return {
      t,
      point: new THREE.Vector3(x, surface.y, z),
    };
  }

  function buildSurfaceRegistry() {
    const surfaces = [];
    const configuredSurfaces = getConfiguredJumpSurfaces();
    for (const surface of configuredSurfaces) {
      surfaces.push(
        makeRectSurface(
          surface.id,
          surface.y,
          surface.minX,
          surface.maxX,
          surface.minZ,
          surface.maxZ,
          CAT_COLLISION.catBodyRadius
        )
      );
    }

    const byId = new Map();
    for (const surface of surfaces) {
      surface.anchors = buildSurfaceAnchors(surface);
      byId.set(surface.id, surface);
    }

    return { surfaces, byId };
  }

  function normalizeIgnoreSurfaceIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => String(v));
    if (value instanceof Set) return Array.from(value, (v) => String(v));
    return [String(value)];
  }

  function shouldIgnoreObstacleForLink(obs, fromSurfaceId, toSurfaceId) {
    if (!obs) return false;
    const fromId = fromSurfaceId == null ? null : String(fromSurfaceId);
    const toId = toSurfaceId == null ? null : String(toSurfaceId);

    if (obs.tag === "surfaceSolid") {
      const sid = obs.surfaceId == null ? null : String(obs.surfaceId);
      return !!sid && (sid === fromId || sid === toId);
    }

    const ignoreIds = normalizeIgnoreSurfaceIds(obs.jumpIgnoreSurfaceIds);
    if (!ignoreIds.length) return false;
    return (fromId && ignoreIds.includes(fromId)) || (toId && ignoreIds.includes(toId));
  }

  function filterObstaclesForLink(obstacles, fromSurfaceId, toSurfaceId) {
    if (!Array.isArray(obstacles) || !obstacles.length) return [];
    return obstacles.filter((obs) => !shouldIgnoreObstacleForLink(obs, fromSurfaceId, toSurfaceId));
  }

  function getJumpObstaclesForLink(link, obstacles, options = null) {
    if (!link) return Array.isArray(obstacles) ? obstacles : [];
    let filtered = filterObstaclesForLink(obstacles, link.fromSurfaceId, link.toSurfaceId);
    if (options?.ignorePushable) filtered = filtered.filter((obs) => !obs?.pushable);
    return filtered;
  }

  function firstBlockedPointOnSegment(
    a,
    b,
    clearance,
    yFrom = 0,
    yTo = yFrom,
    obstacles = []
  ) {
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) {
      const qy = Number.isFinite(yFrom) ? yFrom : 0;
      if (isCatPointBlocked(a.x, a.z, obstacles, clearance, qy)) {
        return new THREE.Vector3(a.x, qy, a.z);
      }
      return null;
    }
    const samples = Math.max(3, Math.ceil(dist / 0.06));
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const qy = THREE.MathUtils.lerp(yFrom, yTo, t);
      if (isCatPointBlocked(x, z, obstacles, clearance, qy)) {
        return new THREE.Vector3(x, qy, z);
      }
    }
    return null;
  }

  function isSegmentBlocked(
    a,
    b,
    clearance,
    yFrom = 0,
    yTo = yFrom,
    obstacles = []
  ) {
    return !!firstBlockedPointOnSegment(a, b, clearance, yFrom, yTo, obstacles);
  }

  function buildDirectedJumpLinks(surfaceRegistry) {
    const links = [];
    const debugProbes = [];
    const surfaces = surfaceRegistry.surfaces;
    const staticObstacles = buildCatObstacles(false, false).filter(
      (obs) => obs && obs.tag !== "cup" && !obs.pickupKey
    );
    const makeSurfaceSolidObstacles = () => {
      const slabThickness = Math.max(0.06, CAT_COLLISION.catBodyRadius * 0.55);
      const slabs = [];
      for (const s of surfaces) {
        if (!s || s.id === "floor") continue;
        const width = Math.max(0.06, s.outer.maxX - s.outer.minX);
        const depth = Math.max(0.06, s.outer.maxZ - s.outer.minZ);
        slabs.push({
          kind: "box",
          tag: "surfaceSolid",
          surfaceId: String(s.id),
          x: (s.outer.minX + s.outer.maxX) * 0.5,
          z: (s.outer.minZ + s.outer.maxZ) * 0.5,
          hx: width * 0.5,
          hz: depth * 0.5,
          y: s.y - slabThickness * 0.5,
          h: slabThickness,
        });
      }
      return slabs;
    };
    const staticJumpObstacles = [...staticObstacles, ...makeSurfaceSolidObstacles()];
    const debugVectorBlockers = [];
    const probeClearance = CAT_NAV.clearance * 0.9;
    const hookClearance = CAT_COLLISION.catBodyRadius * SURFACE_CFG.landingClearanceMul;
    const debugVectorPad = Math.max(probeClearance, hookClearance);
    for (const obs of staticJumpObstacles) {
      if (!obs) continue;
      const blockerClass = obs.tag === "surfaceSolid" ? "surface" : "object";
      const ignoreSurfaceIds = normalizeIgnoreSurfaceIds(obs.jumpIgnoreSurfaceIds);
      if (obs.kind === "circle") {
        debugVectorBlockers.push({
          kind: "circle",
          x: obs.x,
          z: obs.z,
          r: Math.max(0.01, (obs.r || 0) + debugVectorPad),
          y: obs.y,
          h: obs.h,
          pad: debugVectorPad,
          tag: obs.tag || "",
          blockerClass,
          surfaceId: obs.surfaceId || null,
          jumpIgnoreSurfaceIds: ignoreSurfaceIds,
        });
      } else {
        debugVectorBlockers.push({
          kind: obs.kind === "obb" ? "obb" : "box",
          x: obs.x,
          z: obs.z,
          hx: Math.max(0.01, (obs.hx || 0.01) + debugVectorPad),
          hz: Math.max(0.01, (obs.hz || 0.01) + debugVectorPad),
          yaw: Number.isFinite(obs.yaw) ? obs.yaw : 0,
          y: obs.y,
          h: obs.h,
          pad: debugVectorPad,
          tag: obs.tag || "",
          blockerClass,
          surfaceId: obs.surfaceId || null,
          jumpIgnoreSurfaceIds: ignoreSurfaceIds,
        });
      }
    }
    const jumpObstaclesForLink = (fromSurfaceId, toSurfaceId) =>
      filterObstaclesForLink(staticJumpObstacles, fromSurfaceId, toSurfaceId);
    const segmentBlocked = (
      a,
      b,
      clearance,
      yFrom = 0,
      yTo = yFrom,
      obstacles = staticJumpObstacles
    ) => isSegmentBlocked(a, b, clearance, yFrom, yTo, obstacles);
    const jumpArcBlocked = (
      from,
      fromY,
      to,
      toY,
      arcHeight,
      clearance,
      obstacles = staticJumpObstacles
    ) => {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const dist = Math.hypot(dx, dz);
      const samples = Math.max(8, Math.ceil(dist / 0.06));
      const verticalPad = Math.max(0.05, SURFACE_CFG.jumpVerticalProbePad);
      const arcClearance = Math.max(clearance, CAT_COLLISION.catBodyRadius * 0.9);
      const sideOffset = Math.max(0.04, CAT_COLLISION.catBodyRadius * SURFACE_CFG.jumpSideProbeMul);
      const invLen = dist > 1e-6 ? 1 / dist : 0;
      const perpX = -dz * invLen;
      const perpZ = dx * invLen;
      for (let i = 1; i < samples; i++) {
        const u = i / samples;
        const x = THREE.MathUtils.lerp(from.x, to.x, u);
        const z = THREE.MathUtils.lerp(from.z, to.z, u);
        const y =
          THREE.MathUtils.lerp(fromY, toY, u) +
          Math.sin(Math.PI * u) * arcHeight;
        const probePoints = [[x, z]];
        if (u > 0.18 && u < 0.82) {
          probePoints.push([x + perpX * sideOffset, z + perpZ * sideOffset]);
          probePoints.push([x - perpX * sideOffset, z - perpZ * sideOffset]);
        }
        for (const [px, pz] of probePoints) {
          if (isCatPointBlocked(px, pz, obstacles, arcClearance, y)) return true;
          if (isCatPointBlocked(px, pz, obstacles, arcClearance, y + verticalPad)) {
            return true;
          }
        }
      }
      return false;
    };
    const minDeg = THREE.MathUtils.clamp(Number(SURFACE_CFG.jumpAngleMinDownDeg), 0, 89.9);
    const maxDeg = THREE.MathUtils.clamp(
      Number(SURFACE_CFG.jumpAngleMaxDownDeg),
      minDeg,
      89.9
    );
    const stepDeg = Math.max(1, Number(SURFACE_CFG.jumpAngleStepDeg) || 5);
    const angleDegs = [];
    for (let deg = maxDeg; deg >= minDeg - 1e-4; deg -= stepDeg) {
      angleDegs.push(Math.max(minDeg, deg));
    }
    if (!angleDegs.length || angleDegs[angleDegs.length - 1] > minDeg + 1e-4) {
      angleDegs.push(minDeg);
    }

    for (const source of surfaces) {
      for (const anchor of source.anchors) {
        const origin = new THREE.Vector3(
          anchor.outer.x + anchor.normal.x * SURFACE_CFG.launchOuterPad,
          source.y + 0.02,
          anchor.outer.z + anchor.normal.z * SURFACE_CFG.launchOuterPad
        );
        const fallbackTheta = THREE.MathUtils.degToRad(maxDeg);
        const fallbackDir = new THREE.Vector3(
          anchor.normal.x * Math.cos(fallbackTheta),
          -Math.sin(fallbackTheta),
          anchor.normal.z * Math.cos(fallbackTheta)
        );
        const fallbackMissPoint = new THREE.Vector3(
          origin.x + fallbackDir.x * SURFACE_CFG.jumpMaxDistance,
          origin.y + fallbackDir.y * SURFACE_CFG.jumpMaxDistance,
          origin.z + fallbackDir.z * SURFACE_CFG.jumpMaxDistance
        );

        const candidatesBySurface = new Map();
        const probeHitsBySurface = new Map();
        for (const angleDeg of angleDegs) {
          const theta = THREE.MathUtils.degToRad(angleDeg);
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const dir = new THREE.Vector3(anchor.normal.x * cos, -sin, anchor.normal.z * cos);

          let bestHitForAngle = null;
          let bestTargetForAngle = null;
          for (const target of surfaces) {
            if (target.id === source.id) continue;
            if (target.y > source.y + SURFACE_CFG.sameLevelTolerance) continue;
            const hit = intersectProbeWithSurface(
              origin,
              dir,
              SURFACE_CFG.jumpMaxDistance,
              target,
              SURFACE_CFG.sameLevelTolerance
            );
            if (!hit) continue;
            const dy = Math.max(0, source.y - target.y);
            if (dy > SURFACE_CFG.maxJumpUpHeight) continue;
            if (!bestHitForAngle || hit.t < bestHitForAngle.t) {
              bestHitForAngle = hit;
              bestTargetForAngle = target;
            }
          }

          if (!bestHitForAngle || !bestTargetForAngle) continue;
          if (probeHitsBySurface.has(bestTargetForAngle.id)) continue;

          const jumpFrom = bestHitForAngle.point.clone();
          const top = new THREE.Vector3(anchor.inner.x, source.y, anchor.inner.z);
          const hook = new THREE.Vector3(anchor.outer.x, source.y, anchor.outer.z);
          const linkObstacles = jumpObstaclesForLink(bestTargetForAngle.id, source.id);
          // Reject probe hit if the cat-radius corridor is occluded on launch or on top latch.
          const blockedOnLaunch = segmentBlocked(
            jumpFrom,
            hook,
            probeClearance,
            bestTargetForAngle.y,
            source.y,
            linkObstacles
          );
          const blockedOnTopLatch = segmentBlocked(
            hook,
            top,
            hookClearance,
            source.y,
            source.y,
            linkObstacles
          );
          const blockedOnJumpUpArc = jumpArcBlocked(
            jumpFrom,
            bestTargetForAngle.y,
            top,
            source.y,
            SURFACE_CFG.jumpUpArc,
            hookClearance,
            linkObstacles
          );
          const blockedOnJumpDownArc = jumpArcBlocked(
            top,
            source.y,
            jumpFrom,
            bestTargetForAngle.y,
            SURFACE_CFG.jumpDownArc,
            probeClearance,
            linkObstacles
          );
          const staticValidUp = !blockedOnLaunch && !blockedOnTopLatch && !blockedOnJumpUpArc;
          const staticValidDown = !blockedOnJumpDownArc;

          const candidate = {
            hit: bestHitForAngle,
            target: bestTargetForAngle,
            angleDeg,
            staticValidUp,
            staticValidDown,
          };

          // First hit per surface wins (angle order is steep->shallow), even when blocked,
          // so the debug probe view can still show invalid/blocked probe hits in red.
          probeHitsBySurface.set(bestTargetForAngle.id, candidate);
          if (staticValidUp || staticValidDown) {
            candidatesBySurface.set(bestTargetForAngle.id, candidate);
          }
        }

        if (probeHitsBySurface.size === 0) {
          debugProbes.push({
            surfaceId: source.id,
            anchorId: anchor.id,
            origin: origin.clone(),
            end: fallbackMissPoint,
            hit: false,
            toSurfaceId: null,
            angleDeg: maxDeg,
          });
          continue;
        }

        for (const candidate of probeHitsBySurface.values()) {
          const bestHit = candidate.hit;
          const bestTarget = candidate.target;
          debugProbes.push({
            surfaceId: source.id,
            anchorId: anchor.id,
            origin: origin.clone(),
            end: bestHit.point.clone(),
            hit: true,
            toSurfaceId: bestTarget.id,
            angleDeg: candidate.angleDeg,
            staticValidUp: !!candidate.staticValidUp,
            staticValidDown: !!candidate.staticValidDown,
          });
        }

        for (const candidate of candidatesBySurface.values()) {
          const bestHit = candidate.hit;
          const bestTarget = candidate.target;
          const jumpFrom = bestHit.point;
          const top = cloneXZ(anchor.inner);
          const hook = cloneXZ(anchor.outer);
          const dy = Math.max(0, source.y - bestTarget.y);
          const dx = top.x - jumpFrom.x;
          const dz = top.z - jumpFrom.z;
          const planar = Math.hypot(dx, dz);
          const jumpCost = planar + dy * 0.9 + 0.45;

          links.push({
            id: `jump:${bestTarget.id}->${source.id}:${anchor.id}`,
            fromSurfaceId: bestTarget.id,
            toSurfaceId: source.id,
            anchorId: anchor.id,
            anchorNodeId: anchor.nodeId,
            top,
            hook,
            jumpFrom,
            jumpCost,
            staticValidUp: !!candidate.staticValidUp,
            staticValidDown: !!candidate.staticValidDown,
          });
        }
      }
    }

    return { links, debugProbes, debugVectorBlockers };
  }

  function ensureJumpGraph() {
    if (jumpGraphCache.graph) return jumpGraphCache.graph;
    const surfaceRegistry = buildSurfaceRegistry();
    const jumpBuild = buildDirectedJumpLinks(surfaceRegistry);
    const jumpLinks = jumpBuild.links;
    const graph = buildWeightedJumpGraph(THREE, floorY, surfaceRegistry, jumpLinks);
    const linksByFromSurface = new Map();
    const linksByToSurface = new Map();
    const linksByPair = new Map();
    for (const link of jumpLinks) {
      if (!linksByFromSurface.has(link.fromSurfaceId)) linksByFromSurface.set(link.fromSurfaceId, []);
      linksByFromSurface.get(link.fromSurfaceId).push(link);
      if (!linksByToSurface.has(link.toSurfaceId)) linksByToSurface.set(link.toSurfaceId, []);
      linksByToSurface.get(link.toSurfaceId).push(link);
      const pairKey = `${link.fromSurfaceId}->${link.toSurfaceId}`;
      if (!linksByPair.has(pairKey)) linksByPair.set(pairKey, []);
      linksByPair.get(pairKey).push(link);
    }
    jumpGraphCache.graph = {
      surfaces: surfaceRegistry,
      jumpLinks,
      debugProbes: jumpBuild.debugProbes,
      debugVectorBlockers: jumpBuild.debugVectorBlockers,
      linksByFromSurface,
      linksByToSurface,
      linksByPair,
      graph,
    };
    return jumpGraphCache.graph;
  }

  function shortestPathCost(fromNodeId, toNodeId) {
    if (!fromNodeId || !toNodeId) return Infinity;
    let fromDist = jumpGraphCache.fromCache.get(fromNodeId);
    const built = ensureJumpGraph();
    if (!fromDist) {
      fromDist = dijkstraAllCostsFrom(fromNodeId, built.graph);
      jumpGraphCache.fromCache.set(fromNodeId, fromDist);
    }
    return fromDist.get(toNodeId) ?? Infinity;
  }

  function shortestPathJumpCount(fromNodeId, toNodeId) {
    if (!fromNodeId || !toNodeId) return Infinity;
    let fromDist = jumpGraphCache.jumpCountFromCache.get(fromNodeId);
    const built = ensureJumpGraph();
    if (!fromDist) {
      fromDist = dijkstraJumpCountsFrom(fromNodeId, built.graph);
      jumpGraphCache.jumpCountFromCache.set(fromNodeId, fromDist);
    }
    return fromDist.get(toNodeId) ?? Infinity;
  }

  function nearestSurfaceNodeId(surfaceId, point) {
    const built = ensureJumpGraph();
    const surface = built.surfaces.byId.get(surfaceId);
    if (!surface || !surface.anchors.length) return null;
    let best = null;
    let bestD2 = Infinity;
    for (const anchor of surface.anchors) {
      const d2 = anchor.inner.distanceToSquared(point);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = anchor.nodeId;
      }
    }
    return best;
  }

  function getSurfaceAnchorNodeIds(surfaceId) {
    const built = ensureJumpGraph();
    const surface = built.surfaces.byId.get(surfaceId);
    if (!surface || !Array.isArray(surface.anchors)) return [];
    const out = [];
    for (const anchor of surface.anchors) {
      if (anchor?.nodeId) out.push(anchor.nodeId);
    }
    return out;
  }

  function minGraphCostToSurface(fromNodeId, targetSurfaceId, desiredTopPoint = null) {
    if (!fromNodeId || !targetSurfaceId) return Infinity;
    const desiredNodeId = desiredTopPoint ? nearestSurfaceNodeId(targetSurfaceId, desiredTopPoint) : null;
    if (desiredNodeId) {
      const direct = shortestPathCost(fromNodeId, desiredNodeId);
      if (Number.isFinite(direct)) return direct;
    }
    const anchorNodeIds = getSurfaceAnchorNodeIds(targetSurfaceId);
    if (!anchorNodeIds.length) return Infinity;
    let best = Infinity;
    for (const nodeId of anchorNodeIds) {
      const cost = shortestPathCost(fromNodeId, nodeId);
      if (cost < best) best = cost;
    }
    return best;
  }

  function minGraphJumpCountToSurface(fromNodeId, targetSurfaceId, desiredTopPoint = null) {
    if (!fromNodeId || !targetSurfaceId) return Infinity;
    const desiredNodeId = desiredTopPoint ? nearestSurfaceNodeId(targetSurfaceId, desiredTopPoint) : null;
    if (desiredNodeId) {
      const direct = shortestPathJumpCount(fromNodeId, desiredNodeId);
      if (Number.isFinite(direct)) return direct;
    }
    const anchorNodeIds = getSurfaceAnchorNodeIds(targetSurfaceId);
    if (!anchorNodeIds.length) return Infinity;
    let best = Infinity;
    for (const nodeId of anchorNodeIds) {
      const jumps = shortestPathJumpCount(fromNodeId, nodeId);
      if (jumps < best) best = jumps;
    }
    return best;
  }

  function isMovableObjectNearLanding(p, y) {
    const landingObjectRadius = CAT_COLLISION.catBodyRadius * SURFACE_CFG.landingClearanceMul;
    if (!cup.broken && !cup.falling && cup.group.visible) {
      if (Math.abs(cup.group.position.y - y) <= 0.36) {
        const dx = p.x - cup.group.position.x;
        const dz = p.z - cup.group.position.z;
        const minDist = landingObjectRadius + CUP_COLLISION.radius;
        if (dx * dx + dz * dz < minDist * minDist) return true;
      }
    }
    for (const pickup of pickups) {
      if (!pickup?.mesh || !pickup.body || !pickup.mesh.visible) continue;
      if (pickup.motion === "drag") continue;
      const py = pickup.mesh.position.y;
      if (!Number.isFinite(py) || Math.abs(py - y) > 0.36) continue;
      const dx = p.x - pickup.mesh.position.x;
      const dz = p.z - pickup.mesh.position.z;
      const minDist = landingObjectRadius + Math.max(0.04, pickupRadius(pickup));
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
  }

  function normalizeJumpSafetyOptions(options = null) {
    if (typeof options === "boolean") {
      return {
        allowPushableBlocked: !!options,
        ignoreMovableLandingObjects: false,
      };
    }
    return {
      allowPushableBlocked: !!options?.allowPushableBlocked,
      ignoreMovableLandingObjects: !!options?.ignoreMovableLandingObjects,
    };
  }

  function isLandingSafe(link, dynamicObstacles, options = null) {
    const safetyOptions = normalizeJumpSafetyOptions(options);
    if (!link) return false;
    if (link.staticValidUp === false) return false;
    const linkObstacles = getJumpObstaclesForLink(link, dynamicObstacles, { ignorePushable: safetyOptions.allowPushableBlocked });
    const toSurface = ensureJumpGraph().surfaces.byId.get(link.toSurfaceId);
    if (!toSurface) return false;
    const landingY = toSurface.y;
    const landingClearance = CAT_COLLISION.catBodyRadius * SURFACE_CFG.landingClearanceMul;
    const cupAvoid = CAT_COLLISION.catBodyRadius + CUP_COLLISION.radius + 0.18;
    const p = link.top;

    if (!safetyOptions.ignoreMovableLandingObjects && isMovableObjectNearLanding(p, landingY)) return false;
    if (isCatPointBlocked(p.x, p.z, linkObstacles, landingClearance, landingY)) return false;
    if (isCatPointBlocked(p.x, p.z, linkObstacles, landingClearance, landingY + 0.18)) return false;
    if (!hasClearTravelLine(link.hook, p, linkObstacles, landingClearance, landingY)) return false;
    if (!cup.broken && !cup.falling) {
      const dx = p.x - cup.group.position.x;
      const dz = p.z - cup.group.position.z;
      if (dx * dx + dz * dz < cupAvoid * cupAvoid) return false;
    }
    return true;
  }

  function isSurfaceJumpUpSafe(link, dynamicObstacles, options = null) {
    const safetyOptions = normalizeJumpSafetyOptions(options);
    if (!link) return false;
    if (link.staticValidUp === false) return false;
    const linkObstacles = getJumpObstaclesForLink(link, dynamicObstacles, { ignorePushable: safetyOptions.allowPushableBlocked });
    const built = ensureJumpGraph();
    const fromSurface = built.surfaces.byId.get(link.fromSurfaceId);
    const toSurface = built.surfaces.byId.get(link.toSurfaceId);
    const fromY = Number.isFinite(fromSurface?.y) ? fromSurface.y : floorY;
    const toY = Number.isFinite(toSurface?.y) ? toSurface.y : fromY;
    const anchorClearance = CAT_NAV.clearance * 0.9;
    if (!isJumpPointSafeAtY(link.jumpFrom, fromY, linkObstacles, anchorClearance)) return false;
    if (isSegmentBlocked(link.jumpFrom, link.hook, anchorClearance, fromY, toY, linkObstacles)) {
      return false;
    }
    const landingClearance = CAT_COLLISION.catBodyRadius * SURFACE_CFG.landingClearanceMul;
    if (isSegmentBlocked(link.hook, link.top, landingClearance, toY, toY, linkObstacles)) {
      return false;
    }
    return isLandingSafe(link, dynamicObstacles, safetyOptions);
  }

  function isSurfaceJumpDownSafe(link, dynamicObstacles, options = null) {
    const safetyOptions = normalizeJumpSafetyOptions(options);
    if (!link) return false;
    if (link.staticValidDown === false) return false;
    const linkObstacles = getJumpObstaclesForLink(link, dynamicObstacles, { ignorePushable: safetyOptions.allowPushableBlocked });
    const built = ensureJumpGraph();
    const fromSurface = built.surfaces.byId.get(link.fromSurfaceId);
    const toSurface = built.surfaces.byId.get(link.toSurfaceId);
    const landingY = Number.isFinite(fromSurface?.y) ? fromSurface.y : floorY;
    const sourceY = Number.isFinite(toSurface?.y) ? toSurface.y : floorY;
    const anchorClearance = CAT_NAV.clearance * 0.9;
    if (!isJumpPointSafeAtY(link.top, sourceY, linkObstacles, anchorClearance)) return false;
    if (!isJumpPointSafeAtY(link.jumpFrom, landingY, linkObstacles, anchorClearance)) return false;
    if (isSegmentBlocked(link.top, link.jumpFrom, anchorClearance, sourceY, landingY, linkObstacles)) {
      return false;
    }
    if (!safetyOptions.ignoreMovableLandingObjects && isMovableObjectNearLanding(link.jumpFrom, landingY)) return false;
    return true;
  }

  function minDynamicSurfaceJumpsToTarget(targetSurfaceId, dynamicObstacles, allowPushableBlocked = false) {
    const built = ensureJumpGraph();
    const surfaces = built.surfaces.surfaces || [];
    const incoming = new Map();
    for (const s of surfaces) {
      if (s?.id) incoming.set(String(s.id), []);
    }
    for (const link of built.jumpLinks) {
      if (isSurfaceJumpUpSafe(link, dynamicObstacles, allowPushableBlocked)) {
        const to = String(link.toSurfaceId);
        const from = String(link.fromSurfaceId);
        if (incoming.has(to)) incoming.get(to).push(from);
      }
      if (isSurfaceJumpDownSafe(link, dynamicObstacles, allowPushableBlocked)) {
        const to = String(link.fromSurfaceId);
        const from = String(link.toSurfaceId);
        if (incoming.has(to)) incoming.get(to).push(from);
      }
    }

    const out = new Map();
    const targetId = String(targetSurfaceId || "");
    if (!targetId || !incoming.has(targetId)) return out;
    out.set(targetId, 0);
    const queue = [targetId];
    while (queue.length > 0) {
      const cur = queue.shift();
      const base = out.get(cur) || 0;
      const prevs = incoming.get(cur) || [];
      for (const prev of prevs) {
        if (out.has(prev)) continue;
        out.set(prev, base + 1);
        queue.push(prev);
      }
    }
    return out;
  }

  function buildDynamicSurfaceAdjacency(dynamicObstacles, allowPushableBlocked = false) {
    const built = ensureJumpGraph();
    const outgoing = new Map();
    const seenPairs = new Set();
    const pushEdge = (fromSurfaceId, toSurfaceId) => {
      const fromId = String(fromSurfaceId || "");
      const toId = String(toSurfaceId || "");
      if (!fromId || !toId) return;
      if (!outgoing.has(fromId)) outgoing.set(fromId, []);
      if (!outgoing.has(toId)) outgoing.set(toId, []);
      const key = `${fromId}->${toId}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      outgoing.get(fromId).push(toId);
    };

    for (const surface of built.surfaces.surfaces || []) {
      if (!surface?.id) continue;
      outgoing.set(String(surface.id), []);
    }

    for (const link of built.jumpLinks) {
      if (isSurfaceJumpUpSafe(link, dynamicObstacles, allowPushableBlocked)) {
        pushEdge(link.fromSurfaceId, link.toSurfaceId);
      }
      if (isSurfaceJumpDownSafe(link, dynamicObstacles, allowPushableBlocked)) {
        pushEdge(link.toSurfaceId, link.fromSurfaceId);
      }
    }

    return outgoing;
  }

  function bfsSurfacePath(sourceSurfaceId, targetSurfaceId, dynamicObstacles, avoidSurfaceIds = null, allowPushableBlocked = false) {
    const sourceId = String(sourceSurfaceId || "");
    const targetId = String(targetSurfaceId || "");
    if (!sourceId || !targetId) return null;
    if (sourceId === targetId) return [sourceId];

    const adjacency = buildDynamicSurfaceAdjacency(dynamicObstacles, allowPushableBlocked);
    if (!adjacency.has(sourceId) || !adjacency.has(targetId)) return null;

    const avoid = normalizeAvoidSurfaceIds(avoidSurfaceIds);
    avoid.delete(sourceId);
    avoid.delete(targetId);

    const prev = new Map();
    const queue = [sourceId];
    prev.set(sourceId, null);

    while (queue.length > 0) {
      const current = queue.shift();
      const nextIds = adjacency.get(current) || [];
      for (const nextId of nextIds) {
        if (avoid.has(nextId) || prev.has(nextId)) continue;
        prev.set(nextId, current);
        if (nextId === targetId) {
          const path = [];
          let cursor = targetId;
          while (cursor != null) {
            path.push(cursor);
            cursor = prev.get(cursor) ?? null;
          }
          path.reverse();
          return path;
        }
        queue.push(nextId);
      }
    }

    return null;
  }

  function findSurfacePath(targetSurfaceId, fromSurfaceId = null, avoidSurfaceIds = null) {
    const built = ensureJumpGraph();
    const sourceId = String(fromSurfaceId || "");
    const targetId = String(targetSurfaceId || "");
    if (!sourceId || !targetId) {
      traceFunction("findSurfacePath", `from=${sourceId || "na"} to=${targetId || "na"} ok=0 reason=missing-id`);
      return null;
    }
    if (!built.surfaces.byId.has(sourceId) || !built.surfaces.byId.has(targetId)) {
      traceFunction("findSurfacePath", `from=${sourceId} to=${targetId} ok=0 reason=missing-surface`);
      return null;
    }

    const dynamicObstacles = buildCatObstacles(true, true);
    const path = (
      bfsSurfacePath(sourceId, targetId, dynamicObstacles, avoidSurfaceIds, false) ||
      bfsSurfacePath(sourceId, targetId, dynamicObstacles, avoidSurfaceIds, true)
    );
    traceFunction(
      "findSurfacePath",
      `from=${sourceId} to=${targetId} ok=${path ? 1 : 0} len=${Array.isArray(path) ? path.length : 0}`
    );
    return path;
  }

  function isGroundJumpFromSafe(link, dynamicObstacles) {
    if (!link) return false;
    const linkObstacles = getJumpObstaclesForLink(link, dynamicObstacles);
    const clearance = CAT_NAV.clearance * 0.9;
    const p = link.jumpFrom;
    if (isCatPointBlocked(p.x, p.z, linkObstacles, clearance, floorY)) return false;
    if (isCatPointBlocked(p.x, p.z, linkObstacles, clearance, floorY + 0.18)) return false;
    return true;
  }

  function isJumpPointSafeAtY(point, yLevel, dynamicObstacles, clearance = CAT_NAV.clearance * 0.9) {
    if (!point) return false;
    const y = Number.isFinite(yLevel) ? yLevel : floorY;
    if (isCatPointBlocked(point.x, point.z, dynamicObstacles, clearance, y)) return false;
    if (isCatPointBlocked(point.x, point.z, dynamicObstacles, clearance, y + 0.18)) return false;
    return true;
  }

  function groundPathCost(from, to, dynamicObstacles, clearance) {
    if (hasClearTravelLine(from, to, dynamicObstacles, clearance, floorY)) {
      return from.distanceTo(to);
    }
    const p = computeCatPath(from, to, dynamicObstacles, null, null, false);
    if (!isPathTraversable(p, dynamicObstacles, clearance, floorY)) return Infinity;
    return catPathDistance(p);
  }

  function resolveSourceSurfaceId(from, explicitSourceSurfaceId = null) {
    if (explicitSourceSurfaceId) return String(explicitSourceSurfaceId);
    const built = ensureJumpGraph();
    const fromY = Number.isFinite(from?.y) ? from.y : floorY;
    if (fromY <= floorY + 0.08) return "floor";

    let best = null;
    let bestScore = Infinity;
    for (const surface of built.surfaces.surfaces) {
      if (!surface || surface.id === "floor") continue;
      const inside =
        from.x >= surface.outer.minX - 0.06 &&
        from.x <= surface.outer.maxX + 0.06 &&
        from.z >= surface.outer.minZ - 0.06 &&
        from.z <= surface.outer.maxZ + 0.06;
      if (!inside) continue;
      const dy = Math.abs(surface.y - fromY);
      if (dy > 0.45) continue;
      if (dy < bestScore) {
        bestScore = dy;
        best = surface.id;
      }
    }
    return best || "floor";
  }

  function surfacePathCost(from, to, dynamicObstacles, clearance, sourceSurfaceId) {
    const built = ensureJumpGraph();
    const sourceSurface = built.surfaces.byId.get(sourceSurfaceId);
    const sourceY = Number.isFinite(sourceSurface?.y) ? sourceSurface.y : floorY;
    if (sourceSurfaceId === "floor" || sourceY <= floorY + 0.08) {
      return groundPathCost(from, to, dynamicObstacles, clearance);
    }
    const fromOnSurface = new THREE.Vector3(from.x, sourceY, from.z);
    const toOnSurface = new THREE.Vector3(to.x, sourceY, to.z);
    if (hasClearTravelLine(fromOnSurface, toOnSurface, dynamicObstacles, clearance, sourceY)) {
      return fromOnSurface.distanceTo(toOnSurface);
    }
    const p = computeCatPath(fromOnSurface, toOnSurface, dynamicObstacles, null, null, false);
    if (!isPathTraversable(p, dynamicObstacles, clearance, sourceY)) return Infinity;
    return catPathDistance(p);
  }

  function getSurfaceLinks(surfaceId, fromSurfaceId = null) {
    if (!surfaceId) return [];
    const built = ensureJumpGraph();
    if (!fromSurfaceId) return built.linksByToSurface.get(surfaceId) || [];
    const pairKey = `${fromSurfaceId}->${surfaceId}`;
    return built.linksByPair.get(pairKey) || [];
  }

  function selectBestSurfaceTransition(
    surfaceId,
    from,
    desiredTopPoint = null,
    fromSurfaceId = null,
    avoidSurfaceIds = null
  ) {
    const built = ensureJumpGraph();
    const resolvedFromSurfaceId = resolveSourceSurfaceId(from, fromSurfaceId);
    if (!surfaceId || !resolvedFromSurfaceId || surfaceId === resolvedFromSurfaceId) return null;

    const sourceSurface = built.surfaces.byId.get(resolvedFromSurfaceId);
    if (!sourceSurface) return null;
    const sourceY = Number.isFinite(sourceSurface.y) ? sourceSurface.y : floorY;
    const dynamicObstacles = buildCatObstacles(true, true);
    const anchorClearance = CAT_NAV.clearance * 0.9;
    const avoidNextSurfaceIds = normalizeAvoidSurfaceIds(avoidSurfaceIds);
    let allowPushableBlockedLinks = false;
    let dynamicSurfaceJumpCounts = minDynamicSurfaceJumpsToTarget(surfaceId, dynamicObstacles, false);
    let sourceDynamicMinJumps = dynamicSurfaceJumpCounts.get(resolvedFromSurfaceId);
    if (!Number.isFinite(sourceDynamicMinJumps)) {
      dynamicSurfaceJumpCounts = minDynamicSurfaceJumpsToTarget(surfaceId, dynamicObstacles, true);
      sourceDynamicMinJumps = dynamicSurfaceJumpCounts.get(resolvedFromSurfaceId);
      allowPushableBlockedLinks = Number.isFinite(sourceDynamicMinJumps);
    }

    const candidates = [];
    const outgoingUpLinks = built.linksByFromSurface.get(resolvedFromSurfaceId) || [];
    for (const link of outgoingUpLinks) {
      if (!isSurfaceJumpUpSafe(link, dynamicObstacles, allowPushableBlockedLinks)) continue;
      const remainingCost = minGraphCostToSurface(link.toNodeId, surfaceId, desiredTopPoint);
      const remainingJumps = minGraphJumpCountToSurface(link.toNodeId, surfaceId, desiredTopPoint);
      if (!Number.isFinite(remainingCost)) continue;
      if (!Number.isFinite(remainingJumps)) continue;

      const roughApproach = from.distanceTo(link.jumpFrom);
      const jumpSpan = link.top.distanceTo(link.jumpFrom);
      let roughScore =
        roughApproach +
        link.jumpCost * 0.8 +
        jumpSpan * 0.42 +
        remainingCost * 0.92 +
        0.25;
      if (desiredTopPoint && link.toSurfaceId === surfaceId) {
        roughScore += link.top.distanceTo(desiredTopPoint) * 0.55;
      }

      candidates.push({
        score: roughScore,
        roughApproach,
        transition: "up",
        link,
        anchorPoint: link.jumpFrom,
        hookPoint: link.hook,
        landingPoint: link.top,
        nextSurfaceId: link.toSurfaceId,
        exitNodeId: link.toNodeId,
        remainingCost,
        remainingJumps,
        totalJumps: 1 + remainingJumps,
        totalDynamicJumps: Infinity,
        jumpSpan,
      });
    }

    const incomingDownLinks = built.linksByToSurface.get(resolvedFromSurfaceId) || [];
    for (const link of incomingDownLinks) {
      if (!isSurfaceJumpDownSafe(link, dynamicObstacles, allowPushableBlockedLinks)) continue;
      const landingNodeId = nearestSurfaceNodeId(link.fromSurfaceId, link.jumpFrom);
      const remainingCost =
        link.fromSurfaceId === surfaceId
          ? 0
          : minGraphCostToSurface(landingNodeId, surfaceId, desiredTopPoint);
      const remainingJumps =
        link.fromSurfaceId === surfaceId
          ? 0
          : minGraphJumpCountToSurface(landingNodeId, surfaceId, desiredTopPoint);
      if (!Number.isFinite(remainingCost)) continue;
      if (!Number.isFinite(remainingJumps)) continue;

      const roughApproach = from.distanceTo(link.top);
      const jumpSpan = link.top.distanceTo(link.jumpFrom);
      let roughScore =
        roughApproach +
        link.jumpCost * 0.76 +
        jumpSpan * 0.42 +
        remainingCost * 0.92 +
        0.25;
      if (desiredTopPoint && link.fromSurfaceId === surfaceId) {
        roughScore += link.jumpFrom.distanceTo(desiredTopPoint) * 0.55;
      }

      candidates.push({
        score: roughScore,
        roughApproach,
        transition: "down",
        link,
        anchorPoint: link.top,
        hookPoint: link.hook,
        landingPoint: link.jumpFrom,
        nextSurfaceId: link.fromSurfaceId,
        exitNodeId: link.fromNodeId,
        remainingCost,
        remainingJumps,
        totalJumps: 1 + remainingJumps,
        totalDynamicJumps: Infinity,
        jumpSpan,
      });
    }

    if (!candidates.length) return null;

    for (const c of candidates) {
      const dynRemaining = dynamicSurfaceJumpCounts.get(c.nextSurfaceId);
      if (Number.isFinite(dynRemaining)) c.totalDynamicJumps = 1 + dynRemaining;
    }
    const jumpTiers = Array.from(
      new Set(
        candidates
          .map((c) => (Number.isFinite(c.totalDynamicJumps) ? c.totalDynamicJumps : c.totalJumps))
          .filter((v) => Number.isFinite(v))
      )
    ).sort((a, b) => a - b);
    if (Number.isFinite(sourceDynamicMinJumps) && sourceDynamicMinJumps > 0) {
      const rest = jumpTiers.filter((t) => t !== sourceDynamicMinJumps).sort((a, b) => a - b);
      jumpTiers.length = 0;
      jumpTiers.push(sourceDynamicMinJumps, ...rest);
    }

    const strictMinJumpTier =
      Number.isFinite(sourceDynamicMinJumps) && sourceDynamicMinJumps > 0
        ? sourceDynamicMinJumps
        : null;

    for (const tier of jumpTiers) {
      if (strictMinJumpTier != null && tier !== strictMinJumpTier) continue;
      const tierCandidates = candidates.filter((c) => {
        const candidateTier = Number.isFinite(c.totalDynamicJumps) ? c.totalDynamicJumps : c.totalJumps;
        return candidateTier === tier;
      });
      if (!tierCandidates.length) continue;

      // Prefer non-avoid surfaces if available in this tier; if those are unreachable,
      // retry with full tier so avoid IDs cannot hide the only valid route.
      const preferredCandidates = (() => {
        if (avoidNextSurfaceIds.size <= 0) return tierCandidates;
        const nonAvoid = tierCandidates.filter((c) => !avoidNextSurfaceIds.has(c.nextSurfaceId));
        return nonAvoid.length ? nonAvoid : tierCandidates;
      })();
      const candidateSets = [preferredCandidates];
      if (preferredCandidates !== tierCandidates) candidateSets.push(tierCandidates);

      // Selection policy:
      // 1) fewest jumps (tier loop)
      // 2) lowest reachable total cost (approach path + jump + remaining graph cost)
      // 3) tie-break by shorter on-surface approach to reduce dithering
      let best = null;
      let bestScore = Infinity;
      for (const set of candidateSets) {
        for (const c of set) {
          const pathCost = surfacePathCost(
            from,
            c.anchorPoint,
            dynamicObstacles,
            anchorClearance,
            resolvedFromSurfaceId
          );
          if (!Number.isFinite(pathCost)) continue;
          let score =
            pathCost +
            c.link.jumpCost * 0.6 +
            c.jumpSpan * 0.28 +
            c.remainingCost * 0.92 +
            0.2;
          if (desiredTopPoint && c.nextSurfaceId === surfaceId) {
            score += c.landingPoint.distanceTo(desiredTopPoint) * 0.48;
          }
          if (
            score < bestScore - 1e-5 ||
            (
              Math.abs(score - bestScore) <= 1e-5 &&
              (!best || pathCost < best.pathCost - 1e-5)
            ) ||
            (
              Math.abs(score - bestScore) <= 1e-5 &&
              best &&
              Math.abs(pathCost - best.pathCost) <= 1e-5 &&
              c.roughApproach < best.roughApproach
            )
          ) {
            bestScore = score;
            best = { ...c, pathCost, score };
          }
        }
        if (best) break;
      }
      if (best) return best;
    }

    return null;
  }

  function getSurfaceLinksNearAnchor(surfaceId, anchor, maxDist = 0.42, fromSurfaceId = null) {
    const links = getSurfaceLinks(surfaceId, fromSurfaceId);
    const out = [];
    const maxD2 = maxDist * maxDist;
    for (const link of links) {
      const d2 = link.jumpFrom.distanceToSquared(anchor);
      if (d2 <= maxD2) out.push({ link, d2 });
    }
    if (out.length === 0) {
      for (const link of links) {
        out.push({ link, d2: link.jumpFrom.distanceToSquared(anchor) });
      }
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out.map((v) => v.link);
  }

  function bestSurfaceJumpAnchor(
    surfaceId,
    from,
    desiredTopPoint = null,
    fromSurfaceId = null,
    avoidNextSurfaceId = null
  ) {
    const resolvedFromSurfaceId = resolveSourceSurfaceId(from, fromSurfaceId);
    const best = selectBestSurfaceTransition(
      surfaceId,
      from,
      desiredTopPoint,
      resolvedFromSurfaceId,
      avoidNextSurfaceId
    );
    if (!best) {
      traceFunction("bestSurfaceJumpAnchor", `from=${resolvedFromSurfaceId} to=${surfaceId || "na"} ok=0`);
      return null;
    }
    jumpGraphCache.linkByAnchorKey.set(
      linkAnchorKey(resolvedFromSurfaceId, surfaceId, best.anchorPoint),
      best
    );
    traceFunction(
      "bestSurfaceJumpAnchor",
      `from=${resolvedFromSurfaceId} to=${surfaceId || "na"} ok=1 next=${best.nextSurfaceId || "na"} mode=${best.transition || "na"}`
    );
    return best.anchorPoint.clone();
  }

  function computeSurfaceJumpTargets(
    surfaceId,
    anchor,
    desiredTopPoint = null,
    fromSurfaceId = null,
    avoidSurfaceIds = null
  ) {
    if (!anchor) {
      traceFunction("computeSurfaceJumpTargets", `to=${surfaceId || "na"} ok=0 reason=no-anchor`);
      return null;
    }
    const resolvedFromSurfaceId = resolveSourceSurfaceId(anchor, fromSurfaceId);
    const avoidNextSurfaceIds = normalizeAvoidSurfaceIds(avoidSurfaceIds);
    const cached = jumpGraphCache.linkByAnchorKey.get(
      linkAnchorKey(resolvedFromSurfaceId, surfaceId, anchor)
    );
    const canUseCached =
      cached &&
      (avoidNextSurfaceIds.size === 0 || !avoidNextSurfaceIds.has(cached.nextSurfaceId));
    const best =
      (canUseCached ? cached : null) ||
      selectBestSurfaceTransition(
        surfaceId,
        anchor,
        desiredTopPoint,
        resolvedFromSurfaceId,
        avoidNextSurfaceIds
      );
    if (!best) {
      traceFunction("computeSurfaceJumpTargets", `from=${resolvedFromSurfaceId} to=${surfaceId || "na"} ok=0`);
      return null;
    }
    jumpGraphCache.linkByAnchorKey.set(
      linkAnchorKey(resolvedFromSurfaceId, surfaceId, best.anchorPoint),
      best
    );
    traceFunction(
      "computeSurfaceJumpTargets",
      `from=${resolvedFromSurfaceId} to=${surfaceId || "na"} ok=1 next=${best.nextSurfaceId || "na"} mode=${best.transition || "na"}`
    );
    return {
      hook: best.hookPoint.clone(),
      top: best.landingPoint.clone(),
      surfaceId: best.nextSurfaceId,
      transition: best.transition,
    };
  }

  function computeSurfaceJumpDownTargets(
    surfaceId,
    fromTopPoint,
    desiredGroundPoint = null,
    desiredLandingSurfaceId = null
  ) {
    if (!fromTopPoint) {
      traceFunction("computeSurfaceJumpDownTargets", `from=${surfaceId || "na"} ok=0 reason=no-top-point`);
      return null;
    }
    const toSurface = ensureJumpGraph().surfaces.byId.get(surfaceId);
    if (!toSurface) {
      traceFunction("computeSurfaceJumpDownTargets", `from=${surfaceId || "na"} ok=0 reason=missing-surface`);
      return null;
    }
    const links = getSurfaceLinks(surfaceId);
    if (!links.length) {
      traceFunction("computeSurfaceJumpDownTargets", `from=${surfaceId || "na"} ok=0 reason=no-links`);
      return null;
    }
    const requestedLandingSurfaceId =
      desiredLandingSurfaceId == null ? null : String(desiredLandingSurfaceId);
    let candidateLinks = links;
    if (requestedLandingSurfaceId) {
      const exactMatches = links.filter((link) => String(link.fromSurfaceId) === requestedLandingSurfaceId);
      if (!exactMatches.length) {
        traceFunction(
          "computeSurfaceJumpDownTargets",
          `from=${surfaceId || "na"} to=${requestedLandingSurfaceId} ok=0 reason=no-exact-link`
        );
        return null;
      }
      candidateLinks = exactMatches;
    }
    const dynamicObstacles = buildCatObstacles(true, true);
    let allowPushableBlockedLinks = false;
    let traversableLinks = candidateLinks.filter((link) => isSurfaceJumpDownSafe(link, dynamicObstacles, false));
    if (!traversableLinks.length) {
      traversableLinks = candidateLinks.filter((link) => isSurfaceJumpDownSafe(link, dynamicObstacles, true));
      allowPushableBlockedLinks = traversableLinks.length > 0;
    }
    const surfaceY = toSurface.y;
    const topClearance = CAT_COLLISION.catBodyRadius * 1.08;
    const desired = desiredGroundPoint ? cloneXZ(desiredGroundPoint) : null;
    let best = null;
    let bestScore = Infinity;
    for (const link of traversableLinks) {
      if (!isSurfaceJumpDownSafe(link, dynamicObstacles, allowPushableBlockedLinks)) continue;
      const rawStageTop = new THREE.Vector3(
        THREE.MathUtils.lerp(link.top.x, link.hook.x, THREE.MathUtils.clamp(SURFACE_CFG.downJumpEdgeBias, 0, 0.95)),
        surfaceY,
        THREE.MathUtils.lerp(link.top.z, link.hook.z, THREE.MathUtils.clamp(SURFACE_CFG.downJumpEdgeBias, 0, 0.95))
      );
      const stageTop = rawStageTop.clone();
      let stageTopWasClamped = false;
      // Keep down-jump staging strictly inside the same support bounds used by surface steering.
      if (toSurface?.inner) {
        const supportPad = 0.006;
        const minX = Number.isFinite(toSurface.inner.minX) ? toSurface.inner.minX + supportPad : stageTop.x;
        const maxX = Number.isFinite(toSurface.inner.maxX) ? toSurface.inner.maxX - supportPad : stageTop.x;
        const minZ = Number.isFinite(toSurface.inner.minZ) ? toSurface.inner.minZ + supportPad : stageTop.z;
        const maxZ = Number.isFinite(toSurface.inner.maxZ) ? toSurface.inner.maxZ - supportPad : stageTop.z;
        const clampedX = minX <= maxX ? THREE.MathUtils.clamp(stageTop.x, minX, maxX) : stageTop.x;
        const clampedZ = minZ <= maxZ ? THREE.MathUtils.clamp(stageTop.z, minZ, maxZ) : stageTop.z;
        if (Math.abs(clampedX - stageTop.x) > 1e-6 || Math.abs(clampedZ - stageTop.z) > 1e-6) {
          stageTopWasClamped = true;
          stageTop.set(clampedX, surfaceY, clampedZ);
        }
      }
      const stagePathCost = surfacePathCost(
        fromTopPoint,
        stageTop,
        dynamicObstacles,
        topClearance,
        surfaceId
      );
      if (!Number.isFinite(stagePathCost)) continue;
      if (!isJumpPointSafeAtY(stageTop, surfaceY, dynamicObstacles, topClearance)) continue;

      let score = stagePathCost * 1.2 + 0.2;
      if (desired) score += link.jumpFrom.distanceTo(desired) * 0.45;
      if (score < bestScore) {
        bestScore = score;
        best = {
          link,
          stageTop,
          stageTopWasClamped,
        };
      }
    }
    if (!best) {
      traceFunction(
        "computeSurfaceJumpDownTargets",
        `from=${surfaceId || "na"} to=${requestedLandingSurfaceId || "auto"} ok=0`
      );
      return null;
    }
    traceFunction(
      "computeSurfaceJumpDownTargets",
      `from=${surfaceId || "na"} to=${String(best.link.fromSurfaceId || "floor")} ok=1`
    );
    return {
      top: best.stageTop.clone(),
      hook: best.link.hook.clone(),
      jumpFrom: best.link.jumpFrom.clone(),
      landingSurfaceId: String(best.link.fromSurfaceId || "floor"),
      topWasClamped: !!best.stageTopWasClamped,
    };
  }

  function bestDeskJumpAnchor(from, desiredTopPoint = null) {
    return bestSurfaceJumpAnchor("desk", from, desiredTopPoint);
  }

  function computeDeskJumpTargets(anchor, desiredTopPoint = null) {
    return computeSurfaceJumpTargets("desk", anchor, desiredTopPoint, "floor");
  }

  function computeDeskJumpDownTargets(fromTopPoint, desiredGroundPoint = null) {
    return computeSurfaceJumpDownTargets("desk", fromTopPoint, desiredGroundPoint);
  }

  function resolveDebugProbeClass(probe) {
    if (!probe?.hit) return "noTarget";
    if (probe.validUp) return "validUp";
    if (probe.blockedByImmovableUp) return "staticBlocked";
    if (probe.blockedByMovableUp) return "dynamicBlocked";
    if (probe.staticValidUp !== true && probe.staticValidDown !== true) return "staticBlocked";
    if (probe.validDown || probe.staticValidDown) return "validDown";
    if (probe.blockedByImmovableDown) return "staticBlocked";
    if (probe.blockedByMovableDown) return "dynamicBlocked";
    return "staticBlocked";
  }


  function getSurfaceJumpDebugData() {
    const built = ensureJumpGraph();
    const dynamicObstacles = buildCatObstacles(true, true);

    const surfaces = built.surfaces.surfaces.map((surface) => ({
      id: surface.id,
      y: surface.y,
      outer: { ...surface.outer },
      inner: { ...surface.inner },
      anchors: surface.anchors.map((a) => ({
        id: a.id,
        edgeIndex: a.edgeIndex,
        inner: a.inner.clone(),
        outer: a.outer.clone(),
      })),
    }));

    const immovableObstacles = dynamicObstacles.filter((obs) => !obs?.pushable);

    const links = built.jumpLinks.map((link) => ({
      id: link.id,
      fromSurfaceId: link.fromSurfaceId,
      toSurfaceId: link.toSurfaceId,
      anchorId: link.anchorId,
      jumpFrom: link.jumpFrom.clone(),
      hook: link.hook.clone(),
      top: link.top.clone(),
      staticValidUp: link.staticValidUp !== false,
      staticValidDown: link.staticValidDown !== false,
      validUp: isSurfaceJumpUpSafe(link, dynamicObstacles),
      validDown: isSurfaceJumpDownSafe(link, dynamicObstacles),
      immovableValidUp: isSurfaceJumpUpSafe(link, immovableObstacles, { ignoreMovableLandingObjects: true }),
      immovableValidDown: isSurfaceJumpDownSafe(link, immovableObstacles, { ignoreMovableLandingObjects: true }),
    })).map((entry) => {
      const fromSurface = built.surfaces.byId.get(entry.fromSurfaceId);
      const toSurface = built.surfaces.byId.get(entry.toSurfaceId);
      const fromY = Number.isFinite(fromSurface?.y) ? fromSurface.y : floorY;
      const toY = Number.isFinite(toSurface?.y) ? toSurface.y : fromY;
      const launchStart = new THREE.Vector3(entry.jumpFrom.x, fromY, entry.jumpFrom.z);
      const launchToHook = new THREE.Vector3(entry.hook.x, toY, entry.hook.z);
      const hookToTopStart = launchToHook.clone();
      const hookToTopEndTarget = new THREE.Vector3(entry.top.x, toY, entry.top.z);
      const launchClearance = CAT_NAV.clearance * 0.9;
      const landingClearance = CAT_COLLISION.catBodyRadius * SURFACE_CFG.landingClearanceMul;
      const linkObstacles = getJumpObstaclesForLink(entry, dynamicObstacles);
      const immovableLinkObstacles = getJumpObstaclesForLink(entry, immovableObstacles);
      const blockedOnLaunch = firstBlockedPointOnSegment(
        launchStart,
        launchToHook,
        launchClearance,
        fromY,
        toY,
        linkObstacles
      );
      const blockedOnHook = firstBlockedPointOnSegment(
        hookToTopStart,
        hookToTopEndTarget,
        landingClearance,
        toY,
        toY,
        linkObstacles
      );
      const blockedOnDown = firstBlockedPointOnSegment(
        hookToTopEndTarget,
        launchStart,
        launchClearance,
        toY,
        fromY,
        linkObstacles
      );
      const immovableBlockedOnLaunch = firstBlockedPointOnSegment(
        launchStart,
        launchToHook,
        launchClearance,
        fromY,
        toY,
        immovableLinkObstacles
      );
      const immovableBlockedOnHook = firstBlockedPointOnSegment(
        hookToTopStart,
        hookToTopEndTarget,
        landingClearance,
        toY,
        toY,
        immovableLinkObstacles
      );
      const immovableBlockedOnDown = firstBlockedPointOnSegment(
        hookToTopEndTarget,
        launchStart,
        launchClearance,
        toY,
        fromY,
        immovableLinkObstacles
      );
      const resolvedValidUp = entry.validUp && !blockedOnLaunch && !blockedOnHook;
      const resolvedValidDown = entry.validDown && !blockedOnDown;
      const immovableResolvedValidUp = entry.immovableValidUp && !immovableBlockedOnLaunch && !immovableBlockedOnHook;
      const immovableResolvedValidDown = entry.immovableValidDown && !immovableBlockedOnDown;
      const blockedByImmovableUp = entry.staticValidUp && !immovableResolvedValidUp;
      const blockedByImmovableDown = entry.staticValidDown && !immovableResolvedValidDown;
      const blockedByMovableUp = entry.staticValidUp && immovableResolvedValidUp && !resolvedValidUp;
      const blockedByMovableDown = entry.staticValidDown && immovableResolvedValidDown && !resolvedValidDown;
      return {
        ...entry,
        fromY,
        toY,
        launchClearance,
        landingClearance,
        validUp: resolvedValidUp,
        validDown: resolvedValidDown,
        blockedByImmovableUp,
        blockedByImmovableDown,
        blockedByMovableUp,
        blockedByMovableDown,
        upLaunchStart: launchStart,
        upLaunchEnd: blockedOnLaunch ? blockedOnLaunch : launchToHook,
        upLaunchBlocked: !!blockedOnLaunch,
        upHookStart: hookToTopStart,
        upHookEnd: blockedOnHook ? blockedOnHook : hookToTopEndTarget,
        upHookBlocked: !!blockedOnHook,
        downStart: hookToTopEndTarget,
        downEnd: blockedOnDown ? blockedOnDown : launchStart,
        downBlocked: !!blockedOnDown,
      };
    });

    const linkByProbeKey = new Map();
    for (const link of links) {
      const key = `${link.toSurfaceId}|${link.fromSurfaceId}|${link.anchorId}`;
      linkByProbeKey.set(key, link);
    }

    const probes = (built.debugProbes || []).map((p) => {
      const key = `${p.surfaceId}|${p.toSurfaceId}|${p.anchorId}`;
      const linked = linkByProbeKey.get(key);
      const staticValidUp = linked ? !!linked.staticValidUp : !!p.staticValidUp;
      const staticValidDown = linked ? !!linked.staticValidDown : !!p.staticValidDown;
      const validUp = !!linked?.validUp;
      const validDown = !!linked?.validDown;
      const blockedByImmovableUp = !!linked?.blockedByImmovableUp;
      const blockedByImmovableDown = !!linked?.blockedByImmovableDown;
      const blockedByMovableUp = !!linked?.blockedByMovableUp;
      const blockedByMovableDown = !!linked?.blockedByMovableDown;
      const probe = {
        surfaceId: p.surfaceId,
        anchorId: p.anchorId,
        toSurfaceId: p.toSurfaceId,
        hit: !!p.hit,
        // Green probe should mean "jump-up is actually valid now", not just "ray hit something".
        validUp,
        validDown,
        staticValidUp,
        staticValidDown,
        blockedByImmovableUp,
        blockedByImmovableDown,
        blockedByMovableUp,
        blockedByMovableDown,
        origin: p.origin.clone(),
        end: p.end.clone(),
      };
      probe.debugClass = resolveDebugProbeClass(probe);
      return probe;
    });
    const vectorBlockers = (built.debugVectorBlockers || []).map((obs) => ({ ...obs }));

    return { surfaces, probes, links, vectorBlockers };
  }

  return {
    findSurfacePath,
    bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets,
    computeSurfaceJumpDownTargets,
    bestDeskJumpAnchor,
    computeDeskJumpTargets,
    computeDeskJumpDownTargets,
    getSurfaceJumpDebugData,
  };
}
