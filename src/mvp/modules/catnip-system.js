import { catHasNonFloorSurface, isFloorSurfaceId, normalizeSurfaceId } from "./surface-ids.js";
import { clampPointToSurfaceXZ, getSurfaceEdgeDistance, getSurfacePlanarGap } from "./surface-shapes.js";

export function createCatnipRuntime(ctx) {
  const {
    THREE,
    scene,
    camera,
    renderer,
    raycaster,
    mouse,
    floorPlane,
    tempTo,
    ROOM,
    game,
    cat,
    cup,
    buildCatObstacles,
    canReachGroundTarget,
    findSafeGroundPoint,
    bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets,
    findSurfacePath,
    getSurfaceDefs,
    getSurfaceById,
    getClockTime,
    shouldRecordPathProfiler = () => false,
  } = ctx;
  const tempFloorHit = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();
  const tempPlacementOrigin = new THREE.Vector3();
  const tempPlacementNormal = new THREE.Vector3();
  const placementRaycaster = new THREE.Raycaster();
  const CATNIP_SCALE = 0.5;
  const CATNIP_RADIUS = 0.22 * CATNIP_SCALE;
  const CATNIP_HEIGHT = 0.04 * CATNIP_SCALE;
  const CATNIP_HALF_HEIGHT = CATNIP_HEIGHT * 0.5;
  const CATNIP_MOUTH_OFFSET = 0.34;
  const PATH_PROFILER_SAMPLE_LIMIT = 180;
  const PATH_PROFILER_EVENT_LIMIT = 24;

  function isPathProfilerEnabled() {
    return !!shouldRecordPathProfiler();
  }

  function ensurePathProfiler() {
    if (!isPathProfilerEnabled()) return null;
    if (!cat.nav || typeof cat.nav !== "object") cat.nav = {};
    if (!cat.nav.pathProfiler || typeof cat.nav.pathProfiler !== "object") {
      cat.nav.pathProfiler = {
        createdAt: getClockTime(),
        metrics: {},
        counters: {},
        events: [],
        lastSlowEvent: null,
      };
    }
    const profiler = cat.nav.pathProfiler;
    if (!profiler.metrics || typeof profiler.metrics !== "object") profiler.metrics = {};
    if (!profiler.counters || typeof profiler.counters !== "object") profiler.counters = {};
    if (!Array.isArray(profiler.events)) profiler.events = [];
    return profiler;
  }

  function ensurePathProfilerMetric(name) {
    const profiler = ensurePathProfiler();
    if (!profiler) return null;
    if (!profiler.metrics[name] || typeof profiler.metrics[name] !== "object") {
      profiler.metrics[name] = {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0,
        slowCount: 0,
        samples: [],
        lastMeta: null,
      };
    }
    const metric = profiler.metrics[name];
    if (!Array.isArray(metric.samples)) metric.samples = [];
    return metric;
  }

  function pushPathProfilerSample(metric, value) {
    if (!metric || !Array.isArray(metric.samples) || !Number.isFinite(value)) return;
    metric.samples.push(value);
    if (metric.samples.length > PATH_PROFILER_SAMPLE_LIMIT) {
      metric.samples.splice(0, metric.samples.length - PATH_PROFILER_SAMPLE_LIMIT);
    }
  }

  function recordPathProfilerEvent(kind, ms, meta = null) {
    const profiler = ensurePathProfiler();
    if (!profiler) return null;
    const event = {
      kind: String(kind || "path"),
      ms: Number.isFinite(ms) ? ms : NaN,
      t: getClockTime(),
      ...(meta && typeof meta === "object" ? meta : {}),
    };
    profiler.events.push(event);
    if (profiler.events.length > PATH_PROFILER_EVENT_LIMIT) {
      profiler.events.splice(0, profiler.events.length - PATH_PROFILER_EVENT_LIMIT);
    }
    profiler.lastSlowEvent = event;
    return event;
  }

  function finishPathProfilerMetric(name, startedAt, meta = null, slowMs = 6) {
    const elapsed = Math.max(0, performance.now() - startedAt);
    const metric = ensurePathProfilerMetric(name);
    if (!metric) return elapsed;
    metric.calls += 1;
    metric.totalMs += elapsed;
    metric.lastMs = elapsed;
    metric.maxMs = Math.max(metric.maxMs || 0, elapsed);
    metric.lastMeta = meta && typeof meta === "object" ? { ...meta, t: getClockTime() } : null;
    pushPathProfilerSample(metric, elapsed);
    if (elapsed >= slowMs) {
      metric.slowCount = (Number(metric.slowCount) || 0) + 1;
      recordPathProfilerEvent(name, elapsed, meta);
    }
    return elapsed;
  }

  function setMouseFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function getNonFloorSurfaceById(surfaceId) {
    if (!surfaceId || surfaceId === "floor") return null;
    if (typeof getSurfaceById === "function") return getSurfaceById(surfaceId);
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : [];
    if (!Array.isArray(defs)) return null;
    return defs.find((s) => String(s?.id || s?.name || "") === String(surfaceId)) || null;
  }

  function findBestNonFloorSurfaceAt(x, z, y, pad = 0.18, maxDy = 0.58, preferredSurfaceId = "") {
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : [];
    if (!Array.isArray(defs)) return null;
    let best = null;
    let bestScore = Infinity;
    for (const strictPad of [0.03, pad]) {
      best = null;
      bestScore = Infinity;
      for (const s of defs) {
        if (!s) continue;
        const sy = Number(s.y);
        if (!Number.isFinite(sy)) continue;
        if (getSurfacePlanarGap(s, x, z, 0) > strictPad) continue;
        const dy = Math.abs(sy - y);
        if (dy > maxDy) continue;
        const edgeDist = Math.max(0, getSurfaceEdgeDistance(s, x, z, 0));
        const surfaceId = String(s.id || s.name || "");
        const preferredBias = preferredSurfaceId && surfaceId === String(preferredSurfaceId) ? -0.08 : 0;
        const score = dy + Math.max(0, 0.22 - edgeDist) * 0.2 + preferredBias;
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best) return best;
    }
    return best;
  }

  function isNearNonFloorSurface(x, z, y, surface, pad = 0.28, yPad = 0.7) {
    if (!surface) return false;
    return (
      getSurfacePlanarGap(surface, x, z, 0) <= pad &&
      Math.abs((surface.y || 0) - y) <= yPad
    );
  }

  function findLooseNonFloorSurfaceAt(x, z, y, preferredSurfaceId = "") {
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : [];
    if (!Array.isArray(defs) || defs.length === 0) return null;

    let best = null;
    let bestScore = Infinity;
    for (const s of defs) {
      if (!s) continue;
      const sy = Number(s.y);
      if (!Number.isFinite(sy)) continue;
      const planarGap = getSurfacePlanarGap(s, x, z, 0);
      const dy = Math.abs(sy - y);
      if (dy > 1.15) continue;

      const surfaceId = String(s.id || s.name || "");
      const preferredBias = preferredSurfaceId && surfaceId === String(preferredSurfaceId) ? -0.18 : 0;
      const score = planarGap * 1.8 + dy * 1.8 + preferredBias;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  function clampToNonFloorSurface(surfaceId, x, z, edgePad = 0.16) {
    const surface = getNonFloorSurfaceById(surfaceId);
    if (!surface) return null;
    const clamped = clampPointToSurfaceXZ(surface, x, z, edgePad);
    return {
      x: clamped.x,
      z: clamped.z,
      surface,
    };
  }

  function isInsideNonFloorSurface(surfaceId, x, z, edgePad = 0.18) {
    const surface = getNonFloorSurfaceById(surfaceId);
    if (!surface) return false;
    return getSurfacePlanarGap(surface, x, z, edgePad) <= 1e-6;
  }

  function isInvisibleSurfaceProxy(object) {
    if (!object?.userData?.catSurface) return false;
    const material = object.material;
    return !!(material && material.transparent && Number(material.opacity) <= 1e-4);
  }

  function ignoresCatnipPlacement(object) {
    let cur = object;
    while (cur) {
      if (cur.userData?.ignoreCatnipPlacement) return true;
      cur = cur.parent;
    }
    return false;
  }

  function getCatnipVisualY(surfaceId, x, z, surfaceY) {
    const resolvedSurfaceId = String(surfaceId || "floor");
    const roomObjectId = resolvedSurfaceId !== "floor" ? resolvedSurfaceId : "";
    tempPlacementOrigin.set(x, Math.max(surfaceY + 1.5, 3.5), z);
    placementRaycaster.set(tempPlacementOrigin, new THREE.Vector3(0, -1, 0));
    placementRaycaster.far = Math.max(2.5, tempPlacementOrigin.y - (surfaceY - 0.5));
    const hits = placementRaycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      if (!hit?.object || !hit?.point || !hit?.face) continue;
      if (ignoresCatnipPlacement(hit.object)) continue;
      if (isDescendantOf(hit.object, cat.group)) continue;
      if (isDescendantOf(hit.object, cup.group)) continue;
      if (game.catnip?.mesh && isDescendantOf(hit.object, game.catnip.mesh)) continue;
      if (isInvisibleSurfaceProxy(hit.object)) continue;
      if (roomObjectId && String(hit.object.userData?.roomObjectId || "") !== roomObjectId) continue;
      tempPlacementNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (tempPlacementNormal.y < 0.45) continue;
      if (hit.point.y < surfaceY - 0.08) continue;
      if (!roomObjectId && hit.point.y > surfaceY + 0.18) continue;
      return hit.point.y + CATNIP_HALF_HEIGHT + 0.003;
    }
    return surfaceY + CATNIP_HALF_HEIGHT;
  }

  function getCurrentCatSurfaceId() {
    const y = Number.isFinite(cat.group.position.y) ? cat.group.position.y : 0;
    if (!catHasNonFloorSurface(cat) && y <= 0.08) return "floor";

    const routeSurfaceId =
      cat.nav?.route?.active && cat.nav?.route?.surfaceId && !isFloorSurfaceId(cat.nav.route.surfaceId)
        ? normalizeSurfaceId(cat.nav.route.surfaceId)
        : "";
    const routeFinalSurfaceId =
      cat.nav?.route?.active && cat.nav?.route?.finalSurfaceId && !isFloorSurfaceId(cat.nav.route.finalSurfaceId)
        ? normalizeSurfaceId(cat.nav.route.finalSurfaceId)
        : "";
    const hintedSurfaceId =
      routeSurfaceId ||
      routeFinalSurfaceId;

    const best = findBestNonFloorSurfaceAt(cat.pos.x, cat.pos.z, y, 0.18, 0.58, hintedSurfaceId);
    if (best) return String(best.id || best.name || hintedSurfaceId || "floor");

    for (const fallbackId of [
      hintedSurfaceId,
      routeFinalSurfaceId,
      cat.nav?.lastSurfaceHopTo,
      cat.nav?.lastSurfaceHopFrom,
    ]) {
      const surface = getNonFloorSurfaceById(fallbackId);
      if (surface && isNearNonFloorSurface(cat.pos.x, cat.pos.z, y, surface)) {
        return String(surface.id || surface.name || fallbackId || "floor");
      }
    }

    const loose = findLooseNonFloorSurfaceAt(cat.pos.x, cat.pos.z, y, hintedSurfaceId);
    if (loose) return String(loose.id || loose.name || hintedSurfaceId || "floor");

    return y <= 0.08 ? "floor" : normalizeSurfaceId(hintedSurfaceId || routeFinalSurfaceId);
  }

  function buildCatnipApproachPoint(x, z, start, surface) {
    let dx = x - start.x;
    let dz = z - start.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      dx = Math.sin(cat.group.rotation.y);
      dz = Math.cos(cat.group.rotation.y);
      len = 1;
    }
    const ux = dx / len;
    const uz = dz / len;
    let tx = x - ux * CATNIP_MOUTH_OFFSET;
    let tz = z - uz * CATNIP_MOUTH_OFFSET;
    if (surface !== "floor") {
      const clamped = clampToNonFloorSurface(surface, tx, tz, 0.14);
      if (clamped) {
        tx = clamped.x;
        tz = clamped.z;
      }
    } else {
      tx = THREE.MathUtils.clamp(tx, ROOM.minX + 0.6, ROOM.maxX - 0.6);
      tz = THREE.MathUtils.clamp(tz, ROOM.minZ + 0.6, ROOM.maxZ - 0.6);
    }
    return new THREE.Vector3(tx, 0, tz);
  }

  function getSurfacePlacementInfo(surface) {
    const surfaceId = normalizeSurfaceId(surface || "floor");
    if (isFloorSurfaceId(surfaceId)) {
      return {
        id: "floor",
        y: 0,
        pathOptions: {
          queryY: 0,
        },
      };
    }
    const surfaceDef = getNonFloorSurfaceById(surfaceId);
    if (!surfaceDef) return null;
    return {
      id: surfaceId,
      y: Math.max(0.02, Number(surfaceDef.y) || 0.02),
      def: surfaceDef,
      pathOptions: {
        queryY: Math.max(0.02, Number(surfaceDef.y) || 0.02),
        supportSurfaceId: surfaceId,
      },
    };
  }

  function canReachOnSurface(start, goal, obstacles, surfaceInfo, options = null) {
    if (!start || !goal || !surfaceInfo) return false;
    const baseOptions = {
      ...(surfaceInfo.pathOptions || {}),
      ...(options && typeof options === "object" ? options : {}),
    };
    if (canReachGroundTarget(start, goal, obstacles, baseOptions)) return true;
    const surfaceId = normalizeSurfaceId(surfaceInfo.id || "floor");
    return canReachGroundTarget(start, goal, obstacles, {
      ...baseOptions,
      ignorePushableSurfaceId: surfaceId,
    });
  }

  function isValidCatnipSpot(x, z, surface) {
    const startedAt = performance.now();
    let result = false;
    const surfaceInfo = getSurfacePlacementInfo(surface);
    let metaPhase = isFloorSurfaceId(surfaceInfo?.id || "floor") ? "floor" : "surface";
    try {
      if (!surfaceInfo) return false;
      const surfaceId = surfaceInfo.id;
      const surfaceY = surfaceInfo.y;
      tempTo.set(x, surfaceY, z);
      const dynamicObstacles = buildCatObstacles(true, true);

      if (!isFloorSurfaceId(surfaceId) && !isInsideNonFloorSurface(surfaceId, x, z)) return false;

      const sourceSurfaceId = getCurrentCatSurfaceId();
      const sameSurface = sourceSurfaceId === surfaceId && Math.abs(cat.group.position.y - surfaceY) <= 0.16;
      const start = isFloorSurfaceId(sourceSurfaceId)
        ? findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z))
        : new THREE.Vector3(cat.pos.x, Math.max(0.02, cat.group.position.y), cat.pos.z);
      if (isFloorSurfaceId(sourceSurfaceId)) start.y = 0;
      tempFrom.set(start.x, start.y, start.z);
      const approach = buildCatnipApproachPoint(x, z, start, surfaceId);
      approach.y = surfaceY;

      if (sameSurface) {
        const exactReachable = canReachOnSurface(start, tempTo, dynamicObstacles, surfaceInfo);
        const approachReachable = canReachOnSurface(start, approach, dynamicObstacles, surfaceInfo);
        result = approachReachable || exactReachable;
        return result;
      }

      if (isFloorSurfaceId(surfaceId)) {
        const floorStart = findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
        floorStart.y = 0;
        const floorApproach = buildCatnipApproachPoint(x, z, floorStart, "floor");
        floorApproach.y = 0;
        const exactReachable = canReachOnSurface(floorStart, tempTo, dynamicObstacles, surfaceInfo);
        const approachReachable = canReachOnSurface(floorStart, floorApproach, dynamicObstacles, surfaceInfo);
        result = approachReachable || exactReachable;
        return result;
      }

      const resolveWithSource = (sourceId, sourcePoint) => {
        if (typeof findSurfacePath === "function") {
          const surfacePath = findSurfacePath(surfaceId, sourceId);
          if (Array.isArray(surfacePath) && surfacePath.length > 2) {
            return true;
          }
        }

        const planningSource =
          isFloorSurfaceId(sourceId)
            ? (() => {
                const s = findSafeGroundPoint(new THREE.Vector3(sourcePoint.x, 0, sourcePoint.z));
                s.y = 0;
                return s;
              })()
            : sourcePoint;
        if (typeof bestSurfaceJumpAnchor !== "function" || typeof computeSurfaceJumpTargets !== "function") {
          return false;
        }
        const anchor = bestSurfaceJumpAnchor(surfaceId, planningSource, tempTo, sourceId);
        if (!anchor) return false;
        if (isFloorSurfaceId(sourceId) && !canReachOnSurface(planningSource, anchor, dynamicObstacles, getSurfacePlacementInfo("floor"))) {
          return false;
        }
        const targets = computeSurfaceJumpTargets(surfaceId, anchor, tempTo, sourceId);
        if (!targets?.top) return false;
        if (targets.surfaceId && normalizeSurfaceId(targets.surfaceId) !== surfaceId) {
          return true;
        }
        const landingPoint = new THREE.Vector3(targets.top.x, surfaceY, targets.top.z);
        const finalReachable =
          canReachOnSurface(landingPoint, tempTo, dynamicObstacles, surfaceInfo) ||
          canReachOnSurface(landingPoint, approach, dynamicObstacles, surfaceInfo);
        return finalReachable;
      };
      if (resolveWithSource(sourceSurfaceId, tempFrom)) {
        result = true;
        return true;
      }
      if (!isFloorSurfaceId(sourceSurfaceId)) {
        const floorStart = findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
        floorStart.y = 0;
        if (resolveWithSource("floor", floorStart)) {
          result = true;
          return true;
        }
      }
      return false;
    } finally {
      finishPathProfilerMetric(
        "isValidCatnipSpot",
        startedAt,
        {
          phase: metaPhase,
          surface: String(surfaceInfo?.id || surface || "floor"),
          result: result ? "valid" : "invalid",
        },
        2.5
      );
    }
  }

  function getPlacementFromMouse() {
    const startedAt = performance.now();
    let placement = null;
    try {
      raycaster.setFromCamera(mouse, camera);

      let floorHit = null;
      if (raycaster.ray.intersectPlane(floorPlane, tempFloorHit)) floorHit = tempFloorHit.clone();

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        if (!hit?.object || !hit?.point || !hit.face) continue;
        if (ignoresCatnipPlacement(hit.object)) continue;
        if (isDescendantOf(hit.object, cat.group)) continue;
        if (isDescendantOf(hit.object, cup.group)) continue;
        const surface = hit.object.userData?.catSurface;
        if (!surface) continue;
        const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        if (worldNormal.y < 0.45) continue;
        const surfaceId = normalizeSurfaceId(surface.id || surface.name);
        if (isFloorSurfaceId(surfaceId)) continue;
        const clamped = clampToNonFloorSurface(surfaceId, hit.point.x, hit.point.z, 0.16);
        if (!clamped) continue;
        placement = {
          surface: surfaceId,
          x: clamped.x,
          z: clamped.z,
          y: getCatnipVisualY(surfaceId, clamped.x, clamped.z, clamped.surface.y),
          surfaceY: clamped.surface.y,
        };
        return placement;
      }

      if (!floorHit) return null;
      const floorX = THREE.MathUtils.clamp(
        floorHit.x,
        ROOM.minX + CATNIP_RADIUS + 0.04,
        ROOM.maxX - CATNIP_RADIUS - 0.04
      );
      const floorZ = THREE.MathUtils.clamp(
        floorHit.z,
        ROOM.minZ + CATNIP_RADIUS + 0.04,
        ROOM.maxZ - CATNIP_RADIUS - 0.04
      );
      placement = {
        surface: "floor",
        x: floorX,
        z: floorZ,
        y: getCatnipVisualY("floor", floorX, floorZ, 0.055),
        surfaceY: 0.055,
      };
      return placement;
    } finally {
      finishPathProfilerMetric(
        "getPlacementFromMouse",
        startedAt,
        {
          phase: "catnip-raycast",
          surface: placement?.surface ? String(placement.surface) : "none",
          result: placement ? "hit" : "miss",
        },
        1.5
      );
    }
  }

  function placeCatnipFromMouse() {
    const startedAt = performance.now();
    const clockTime = getClockTime();
    let result = "noop";
    let placementSurface = "none";
    try {
      if (clockTime < (game.windowOpenUntil || 0) || cat.nav?.windowHoldActive) {
        game.placeCatnipMode = false;
        result = "blocked-window";
        return;
      }
      // Block new catnip placement while cat is mid-air / mid-jump.
      if (cat.jump || (!catHasNonFloorSurface(cat) && cat.group.position.y > 0.08)) {
        result = "blocked-midair";
        return;
      }
      if (game.catnip) {
        result = "already-active";
        return;
      }
      if (clockTime < game.catnipCooldownUntil) {
        result = "cooldown";
        return;
      }
      const placement = getPlacementFromMouse();
      if (!placement) {
        result = "no-placement";
        return;
      }
      placementSurface = String(placement.surface || "none");

      if (!isValidCatnipSpot(placement.x, placement.z, placement.surface)) {
        game.invalidCatnipUntil = clockTime + 1.1;
        result = "invalid";
        return;
      }

      if (game.catnip) scene.remove(game.catnip.mesh);
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(CATNIP_RADIUS, CATNIP_RADIUS, CATNIP_HEIGHT, 18),
        new THREE.MeshStandardMaterial({ color: 0x71bf62, roughness: 0.8 })
      );
      marker.position.set(placement.x, placement.y, placement.z);
      scene.add(marker);

      game.catnip = {
        mesh: marker,
        pos: new THREE.Vector3(placement.x, Number.isFinite(placement.surfaceY) ? placement.surfaceY : 0, placement.z),
        surface: placement.surface,
        placedAt: clockTime,
        timeoutAt: clockTime + 30,
        expiresAt: null,
        eatenAt: null,
      };
      game.placeCatnipMode = false;
      game.invalidCatnipUntil = 0;
      result = "placed";
    } finally {
      finishPathProfilerMetric(
        "placeCatnipFromMouse",
        startedAt,
        {
          phase: "catnip-place",
          surface: placementSurface,
          result,
        },
        2.5
      );
    }
  }

  function clearCatnip() {
    if (!game.catnip) return;
    scene.remove(game.catnip.mesh);
    game.catnip = null;
  }

  function isDescendantOf(node, parent) {
    let cur = node;
    while (cur) {
      if (cur === parent) return true;
      cur = cur.parent;
    }
    return false;
  }

  return {
    setMouseFromEvent,
    placeCatnipFromMouse,
    clearCatnip,
  };
}
