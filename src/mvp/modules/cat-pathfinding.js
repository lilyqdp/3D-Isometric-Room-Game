import { init as initRecast, NavMeshQuery, Crowd } from "@recast-navigation/core";
import { NavMeshHelper, threeToSoloNavMesh, threeToTileCache } from "@recast-navigation/three";
import { createCatPathSignatureRuntime } from "./cat-path-signature.js";

export function createCatPathfindingRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ROOM,
    getElevatedSurfaceDefs,
    hamper,
    trashCan,
    DESK_LEGS,
    EXTRA_NAV_OBSTACLES = [],
    CUP_COLLISION,
    pickups,
    cat,
    cup,
    pickupRadius,
    getClockTime,
  } = ctx;

  const tempQ = new THREE.Quaternion();
  const tempEuler = new THREE.Euler();
  const tempForward = new THREE.Vector3();
  const recastState = {
    ready: false,
    failed: false,
    initPromise: null,
  };
  const navMeshCache = {
    static: null,
    dynamic: null,
    active: null,
  };
  const crowdState = {
    crowd: null,
    agent: null,
    entry: null,
    signature: "",
    lastTarget: new THREE.Vector3(NaN, 0, NaN),
    lastRequestAt: -1e9,
  };
  const lastAStarDebug = {
    mode: "none", // none | fallback | recast
    start: null,
    goal: null,
    edges: [],
    finalPath: [],
    timestamp: 0,
  };
  const lastPlannedSignature = {
    static: "",
    dynamic: "",
  };
  const { qv, buildTileCacheDynamicSpecs, dynamicSpecsSignature, obstacleSignature } =
    createCatPathSignatureRuntime({
      CUP_COLLISION,
    });
  const recastConfig = {
    // Use a finer voxel size so dynamic pickup obstacles are reflected more accurately.
    cs: 0.08,
    ch: 0.05,
    walkableSlopeAngle: 50,
    walkableHeight: 0.25,
    walkableClimb: 0.08,
    walkableRadius: Math.max(0.05, CAT_COLLISION.catBodyRadius),
    maxEdgeLen: 12,
    maxSimplificationError: 0.7,
    minRegionArea: 0,
    mergeRegionArea: 0,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    tileSize: 32,
    expectedLayersPerTile: 6,
    maxObstacles: 512,
  };
  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      ROOM.maxX - ROOM.minX - CAT_NAV.margin * 2,
      0.1,
      ROOM.maxZ - ROOM.minZ - CAT_NAV.margin * 2
    )
  );
  floorMesh.position.set(
    (ROOM.minX + ROOM.maxX) * 0.5,
    -0.05,
    (ROOM.minZ + ROOM.maxZ) * 0.5
  );
  floorMesh.updateMatrixWorld(true);
  const activeNavMeshMode = {
    includePickups: false,
    includeClosePickups: true,
  };

  function getWalkableElevatedSurfaces() {
    if (typeof getElevatedSurfaceDefs !== "function") return [];
    const defs = getElevatedSurfaceDefs(true);
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
      if (maxX - minX <= 0.05 || maxZ - minZ <= 0.05) continue;
      const id = String(def.id || def.name || `surface-${out.length}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, minX, maxX, minZ, maxZ, y });
    }
    return out;
  }

  function destroyCrowdState() {
    if (crowdState.crowd) {
      try {
        if (crowdState.agent) crowdState.crowd.removeAgent(crowdState.agent);
      } catch {}
      try {
        crowdState.crowd.destroy();
      } catch {}
    }
    crowdState.crowd = null;
    crowdState.agent = null;
    crowdState.entry = null;
    crowdState.signature = "";
    crowdState.lastTarget.set(NaN, 0, NaN);
    crowdState.lastRequestAt = -1e9;
  }

  function normalizeJumpIgnoreSurfaceIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => String(v));
    if (value instanceof Set) return Array.from(value, (v) => String(v));
    return [String(value)];
  }

  function applyOptionalObstacleMeta(dst, src) {
    if (!dst || !src) return dst;
    if (src.tag != null) dst.tag = src.tag;
    if (src.surfaceId != null) dst.surfaceId = String(src.surfaceId);
    const ignoreIds = normalizeJumpIgnoreSurfaceIds(src.jumpIgnoreSurfaceIds);
    if (ignoreIds.length) dst.jumpIgnoreSurfaceIds = ignoreIds;
    return dst;
  }

  function buildCatObstacles(includePickups = false, includeClosePickups = false) {
    const obstacles = [
      {
        kind: "box",
        x: hamper.pos.x,
        z: hamper.pos.z,
        hx: hamper.outerHalfX + 0.02,
        hz: hamper.outerHalfZ + 0.02,
        navPad: 0.02,
        y: hamper.rimY * 0.5,
        h: hamper.rimY + 0.06,
      },
      {
        kind: "circle",
        x: trashCan.pos.x,
        z: trashCan.pos.z,
        r: trashCan.outerRadius + 0.12,
        navPad: 0.12,
        y: trashCan.rimY * 0.5,
        h: trashCan.rimY + 0.08,
      },
    ];
    for (const leg of DESK_LEGS) {
      obstacles.push(applyOptionalObstacleMeta({
        kind: "box",
        x: leg.x,
        z: leg.z,
        hx: leg.halfX + 0.03,
        hz: leg.halfZ + 0.03,
        navPad: 0.03,
        // "desk" is the surface id used by jump-planning for the table top.
        jumpIgnoreSurfaceIds: ["desk"],
        y: leg.topY * 0.5,
        h: leg.topY + 0.04,
      }, leg));
    }
    for (const obs of EXTRA_NAV_OBSTACLES) {
      if (!obs) continue;
      if (obs.kind === "circle") {
        obstacles.push(applyOptionalObstacleMeta({
          kind: "circle",
          x: obs.x,
          z: obs.z,
          r: obs.r,
          navPad: obs.navPad || 0,
          y: obs.y,
          h: obs.h,
        }, obs));
      } else if (obs.kind === "obb") {
        obstacles.push(applyOptionalObstacleMeta({
          kind: "obb",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          navPad: obs.navPad || 0,
          yaw: obs.yaw || 0,
          y: obs.y,
          h: obs.h,
        }, obs));
      } else {
        obstacles.push(applyOptionalObstacleMeta({
          kind: "box",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          navPad: obs.navPad || 0,
          y: obs.y,
          h: obs.h,
        }, obs));
      }
    }
    if (!cup.broken && !cup.falling && cup.group.visible) {
      obstacles.push({
        kind: "circle",
        tag: "cup",
        x: cup.group.position.x,
        z: cup.group.position.z,
        r: CUP_COLLISION.radius + 0.04,
        navPad: 0.04,
        y: cup.group.position.y,
        h: (CUP_COLLISION.waterHeight || 0.27) + 0.14,
      });
    }
    if (includePickups) {
      for (const p of pickups) {
        // A held/dragged item is player-controlled and suspended in air; it should not
        // invalidate nav/jump routes until released.
        if (p?.motion === "drag") continue;
        if (!p._navObstacleKey) {
          p._navObstacleKey = `pickup-${Math.random().toString(36).slice(2, 10)}`;
        }
        const px = p.body?.position?.x ?? p.mesh.position.x;
        const pz = p.body?.position?.z ?? p.mesh.position.z;
        const cdx = px - cat.pos.x;
        const cdz = pz - cat.pos.z;
        if (!includeClosePickups && cdx * cdx + cdz * cdz < 0.22 * 0.22) continue;
        const shape = p.body?.shapes?.[0];
        const halfX = shape?.halfExtents?.x || (p.type === "laundry" ? 0.24 : 0.15);
        const halfZ = shape?.halfExtents?.z || (p.type === "laundry" ? 0.18 : 0.12);
        const halfY = shape?.halfExtents?.y || (p.type === "laundry" ? 0.04 : 0.03);
        // Keep pickup obstacles tall enough that recast still blocks them after they settle flat.
        const height = p.type === "laundry" ? Math.max(0.2, halfY * 2 + 0.1) : Math.max(0.18, halfY * 2 + 0.1);
        const centerY = (p.body?.position?.y ?? p.mesh.position.y) + 0.05;
        let yaw = 0;
        if (p.body?.quaternion) {
          tempQ.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
          // Derive planar yaw from forward axis projection to avoid roll/pitch artifacts.
          tempForward.set(0, 0, 1).applyQuaternion(tempQ);
          tempForward.y = 0;
          if (tempForward.lengthSq() > 1e-6) {
            tempForward.normalize();
            yaw = Math.atan2(tempForward.x, tempForward.z);
          } else {
            tempEuler.setFromQuaternion(tempQ, "YXZ");
            yaw = tempEuler.y;
          }
        }
        obstacles.push({
          kind: "obb",
          pickupKey: p._navObstacleKey,
          x: px,
          z: pz,
          hx: halfX,
          hz: halfZ,
          navPad: 0,
          yaw,
          y: centerY,
          h: height,
        });
      }
    }
    obstacles._includePickups = !!includePickups;
    obstacles._includeClosePickups = !!includeClosePickups;
    return obstacles;
  }

  function buildStaticSourceObstacles() {
    const obstacles = [
      {
        kind: "box",
        x: hamper.pos.x,
        z: hamper.pos.z,
        hx: hamper.outerHalfX + 0.02,
        hz: hamper.outerHalfZ + 0.02,
        y: hamper.rimY * 0.5,
        h: hamper.rimY + 0.06,
      },
      {
        kind: "circle",
        x: trashCan.pos.x,
        z: trashCan.pos.z,
        r: trashCan.outerRadius + 0.12,
        y: trashCan.rimY * 0.5,
        h: trashCan.rimY + 0.08,
      },
    ];
    for (const leg of DESK_LEGS) {
      obstacles.push(applyOptionalObstacleMeta({
        kind: "box",
        x: leg.x,
        z: leg.z,
        hx: leg.halfX + 0.03,
        hz: leg.halfZ + 0.03,
        jumpIgnoreSurfaceIds: ["desk"],
        y: leg.topY * 0.5,
        h: leg.topY + 0.04,
      }, leg));
    }
    for (const obs of EXTRA_NAV_OBSTACLES) {
      if (!obs) continue;
      if (obs.kind === "circle") {
        obstacles.push(applyOptionalObstacleMeta({
          kind: "circle",
          x: obs.x,
          z: obs.z,
          r: obs.r,
          y: obs.y,
          h: obs.h,
        }, obs));
      } else if (obs.kind === "obb") {
        obstacles.push(applyOptionalObstacleMeta({
          kind: "obb",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          yaw: obs.yaw || 0,
          y: obs.y,
          h: obs.h,
        }, obs));
      } else {
        obstacles.push(applyOptionalObstacleMeta({
          kind: "box",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          y: obs.y,
          h: obs.h,
        }, obs));
      }
    }
    return obstacles;
  }

  function obstacleOverlapsQueryY(obs, queryY, tolerance = null) {
    if (!Number.isFinite(queryY)) return true;
    if (!Number.isFinite(obs.y) || !Number.isFinite(obs.h)) return true;
    const yTol = Number.isFinite(tolerance)
      ? tolerance
      : (queryY <= 0.08 ? 0.08 : 0.025);
    const halfH = Math.max(0.001, obs.h * 0.5);
    const minY = obs.y - halfH - yTol;
    const maxY = obs.y + halfH + yTol;
    return queryY >= minY && queryY <= maxY;
  }

  function isCatPointBlocked(x, z, obstacles, clearance = CAT_NAV.clearance, queryY = 0) {
    const y = Number.isFinite(queryY) ? queryY : 0;
    const boundaryMargin = y <= 0.08 ? CAT_NAV.margin : 0.02;
    if (
      x < ROOM.minX + boundaryMargin ||
      x > ROOM.maxX - boundaryMargin ||
      z < ROOM.minZ + boundaryMargin ||
      z > ROOM.maxZ - boundaryMargin
    ) {
      return true;
    }
    for (const obs of obstacles) {
      if (!obstacleOverlapsQueryY(obs, queryY)) continue;
      if (obs.tag === "cup" && (cat.state === "toCup" || cat.state === "swipe")) continue;
      const dx = x - obs.x;
      const dz = z - obs.z;
      if (obs.kind === "box") {
        if (Math.abs(dx) <= obs.hx + clearance && Math.abs(dz) <= obs.hz + clearance) return true;
        continue;
      }
      if (obs.kind === "obb") {
        const c = Math.cos(obs.yaw);
        const s = Math.sin(obs.yaw);
        const lx = c * dx + s * dz;
        const lz = -s * dx + c * dz;
        if (Math.abs(lx) <= obs.hx + clearance && Math.abs(lz) <= obs.hz + clearance) return true;
        continue;
      }
      const rr = obs.r + clearance;
      if (dx * dx + dz * dz <= rr * rr) return true;
    }
    return false;
  }

  function getCatPathClearance() {
    // Keep nav/path radius aligned with cat body and add a tiny safety epsilon
    // so planned paths don't hug obstacles tighter than runtime movement checks.
    return Math.max(0.01, CAT_COLLISION.catBodyRadius + (CAT_PATH_CLEARANCE_EPSILON || 0));
  }

  function hasClearTravelLine(a, b, obstacles, clearance = CAT_NAV.clearance, queryY = 0) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const samples = Math.max(2, Math.ceil(dist / 0.18));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      if (isCatPointBlocked(x, z, obstacles, clearance, queryY)) return false;
    }
    return true;
  }

  function smoothCatPath(path, obstacles, clearance = CAT_NAV.clearance, queryY = 0) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1) {
        if (hasClearTravelLine(path[i], path[j], obstacles, clearance, queryY)) break;
        j--;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  function catPathDistance(path) {
    if (!path || path.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < path.length; i++) d += path[i - 1].distanceTo(path[i]);
    return d;
  }

  function ensureRecastInitialized() {
    if (recastState.ready) return Promise.resolve();
    if (recastState.initPromise) return recastState.initPromise;
    recastState.initPromise = initRecast()
      .then(() => {
        recastState.ready = true;
        recastState.failed = false;
      })
      .catch((error) => {
        recastState.ready = false;
        recastState.failed = true;
        console.warn("Recast init failed, using fallback nav pathing.", error);
      })
      .finally(() => {
        if (!recastState.ready) recastState.initPromise = null;
      });
    return recastState.initPromise;
  }

  function buildRecastSourceMeshes(obstacles) {
    const meshes = [floorMesh];

    // Extra walkable surfaces above floor.
    for (const surface of getWalkableElevatedSurfaces()) {
      const sx = Math.max(0.05, surface.maxX - surface.minX);
      const sz = Math.max(0.05, surface.maxZ - surface.minZ);
      const topMesh = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.06, sz));
      topMesh.position.set((surface.minX + surface.maxX) * 0.5, surface.y + 0.01, (surface.minZ + surface.maxZ) * 0.5);
      topMesh.updateMatrixWorld(true);
      meshes.push(topMesh);
    }

    // Static blockers baked into the base navmesh.
    for (const obs of obstacles) {
      let mesh = null;
      const obsHeight = Math.max(0.06, Number.isFinite(obs.h) ? obs.h : 1.6);
      const obsY = Number.isFinite(obs.y) ? obs.y : obsHeight * 0.5;
      if (obs.kind === "circle") {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(obs.r, obs.r, obsHeight, 16));
        mesh.position.set(obs.x, obsY, obs.z);
      } else if (obs.kind === "obb") {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(obs.hx * 2, obsHeight, obs.hz * 2));
        mesh.position.set(obs.x, obsY, obs.z);
        mesh.rotation.y = obs.yaw || 0;
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(obs.hx * 2, obsHeight, obs.hz * 2));
        mesh.position.set(obs.x, obsY, obs.z);
      }
      mesh.updateMatrixWorld(true);
      meshes.push(mesh);
    }
    return meshes;
  }

  function getDebugWalkableSurfaces() {
    const surfaces = [];
    surfaces.push({
      minX: ROOM.minX + CAT_NAV.margin,
      maxX: ROOM.maxX - CAT_NAV.margin,
      minZ: ROOM.minZ + CAT_NAV.margin,
      maxZ: ROOM.maxZ - CAT_NAV.margin,
      y: 0,
      yTol: 0.14,
    });
    for (const surface of getWalkableElevatedSurfaces()) {
      surfaces.push({
        minX: surface.minX,
        maxX: surface.maxX,
        minZ: surface.minZ,
        maxZ: surface.maxZ,
        y: surface.y,
        yTol: 0.12,
      });
    }
    return surfaces;
  }

  function isPointOnDebugWalkableSurface(x, y, z, surfaces) {
    for (const s of surfaces) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      if (Math.abs(y - s.y) <= s.yTol) return true;
    }
    return false;
  }

  function extractDebugGeometryFromNavMesh(navMesh) {
    const helper = new NavMeshHelper(navMesh);
    helper.update();
    const geometry = helper.navMeshGeometry || helper.mesh?.geometry;
    const positionAttr = geometry ? geometry.getAttribute("position") : null;
    if (!positionAttr) return { segments: [], triangles: [] };

    const segments = [];
    const triangles = [];
    const surfaces = getDebugWalkableSurfaces();
    const seen = new Set();
    const addEdge = (ia, ib) => {
      const ax = positionAttr.getX(ia);
      const ay = positionAttr.getY(ia);
      const az = positionAttr.getZ(ia);
      const bx = positionAttr.getX(ib);
      const by = positionAttr.getY(ib);
      const bz = positionAttr.getZ(ib);
      const keyA = `${Math.round(ax * 100)}:${Math.round(ay * 100)}:${Math.round(az * 100)}`;
      const keyB = `${Math.round(bx * 100)}:${Math.round(by * 100)}:${Math.round(bz * 100)}`;
      const edgeKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
      if (seen.has(edgeKey)) return;
      seen.add(edgeKey);
      segments.push([ax, ay, az, bx, by, bz]);
    };

    const addTri = (ia, ib, ic) => {
      const ax = positionAttr.getX(ia);
      const ay = positionAttr.getY(ia);
      const az = positionAttr.getZ(ia);
      const bx = positionAttr.getX(ib);
      const by = positionAttr.getY(ib);
      const bz = positionAttr.getZ(ib);
      const cx = positionAttr.getX(ic);
      const cy = positionAttr.getY(ic);
      const cz = positionAttr.getZ(ic);
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      const mz = (az + bz + cz) / 3;
      if (!isPointOnDebugWalkableSurface(mx, my, mz, surfaces)) return;
      addEdge(ia, ib);
      addEdge(ib, ic);
      addEdge(ic, ia);
      triangles.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    };

    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        addTri(a, b, c);
      }
    } else {
      for (let i = 0; i < positionAttr.count; i += 3) {
        addTri(i, i + 1, i + 2);
      }
    }

    if (helper.navMeshGeometry) helper.navMeshGeometry.dispose();
    return { segments, triangles };
  }

  function syncTileCacheObstacles(entry, specs) {
    if (!entry?.tileCache) return false;
    if (!entry.dynamicObstacleRefs) entry.dynamicObstacleRefs = new Map();

    const desired = new Map();
    for (const spec of specs) desired.set(spec.key, spec);
    let changed = false;

    for (const [key, current] of entry.dynamicObstacleRefs.entries()) {
      if (desired.has(key)) continue;
      try {
        entry.tileCache.removeObstacle(current.obstacle);
      } catch {}
      entry.dynamicObstacleRefs.delete(key);
      changed = true;
    }

    for (const [key, spec] of desired.entries()) {
      const signature =
        spec.kind === "cylinder"
          ? `c:${qv(spec.x, 0.02)}:${qv(spec.y, 0.02)}:${qv(spec.z, 0.02)}:${qv(spec.radius, 0.01)}:${qv(spec.height, 0.02)}`
          : `b:${qv(spec.x, 0.02)}:${qv(spec.y, 0.02)}:${qv(spec.z, 0.02)}:${qv(spec.hx, 0.01)}:${qv(spec.hy, 0.01)}:${qv(spec.hz, 0.01)}:${qv(spec.angle, 0.03)}`;
      const existing = entry.dynamicObstacleRefs.get(key);

      if (existing?.signature === signature) continue;

      if (existing) {
        try {
          entry.tileCache.removeObstacle(existing.obstacle);
        } catch {}
      }

      let addResult = null;
      if (spec.kind === "cylinder") {
        addResult = entry.tileCache.addCylinderObstacle(
          { x: spec.x, y: spec.y, z: spec.z },
          spec.radius,
          spec.height
        );
      } else {
        addResult = entry.tileCache.addBoxObstacle(
          { x: spec.x, y: spec.y, z: spec.z },
          { x: spec.hx, y: spec.hy, z: spec.hz },
          spec.angle
        );
      }
      if (addResult?.success && addResult.obstacle) {
        entry.dynamicObstacleRefs.set(key, { obstacle: addResult.obstacle, signature });
        changed = true;
      } else {
        entry.dynamicObstacleRefs.delete(key);
      }
    }

    if (!changed) return false;

    for (let i = 0; i < 6; i++) {
      const update = entry.tileCache.update(entry.navMesh);
      if (!update?.success || update.upToDate) break;
    }
    entry.debugDirty = true;
    return true;
  }

  function buildRecastNavEntry(obstacles, includePickups, clearance) {
    if (!recastState.ready) return null;
    const modeKey = includePickups ? "dynamic" : "static";
    const sourceObstacles = buildStaticSourceObstacles();
    const signature = obstacleSignature(sourceObstacles, clearance);
    const cached = navMeshCache[modeKey];
    if (cached && cached.signature === signature) {
      const dynamicSpecs = buildTileCacheDynamicSpecs(obstacles, includePickups);
      const dynamicSignature = dynamicSpecsSignature(dynamicSpecs);
      if (cached.tileCache) {
        const changed = cached.dynamicSignature !== dynamicSignature || syncTileCacheObstacles(cached, dynamicSpecs);
        if (changed) cached.dynamicSignature = dynamicSignature;
      } else {
        cached.dynamicSignature = "none";
      }
      if (cached.debugDirty) {
        const debugGeometry = extractDebugGeometryFromNavMesh(cached.navMesh);
        cached.segments = debugGeometry.segments;
        cached.triangles = debugGeometry.triangles;
        cached.debugDirty = false;
      }
      cached.runtimeSignature = `${cached.signature}|dyn:${cached.dynamicSignature || "none"}`;
      navMeshCache.active = cached;
      return cached;
    }

    try {
      const sourceMeshes = buildRecastSourceMeshes(sourceObstacles);
      const result = threeToTileCache(sourceMeshes, {
        ...recastConfig,
        walkableRadius: Math.max(clearance, 0.05),
      });
      let navMesh = null;
      let tileCache = null;
      if (result?.success && result.navMesh && result.tileCache) {
        navMesh = result.navMesh;
        tileCache = result.tileCache;
      } else {
        const fallback = threeToSoloNavMesh(sourceMeshes, {
          ...recastConfig,
          walkableRadius: Math.max(clearance, 0.05),
        });
        if (!fallback?.success || !fallback.navMesh) return null;
        navMesh = fallback.navMesh;
      }

      const navQuery = new NavMeshQuery(navMesh, { maxNodes: 4096 });
      navQuery.defaultQueryHalfExtents = { x: 2.5, y: 2.0, z: 2.5 };

      const debugGeometry = extractDebugGeometryFromNavMesh(navMesh);
      const entry = {
        signature,
        includePickups,
        navMesh,
        navQuery,
        tileCache,
        dynamicObstacleRefs: new Map(),
        dynamicSignature: "none",
        runtimeSignature: `${signature}|dyn:none`,
        debugDirty: false,
        segments: debugGeometry.segments,
        triangles: debugGeometry.triangles,
        clearance,
      };

      if (tileCache) {
        const dynamicSpecs = buildTileCacheDynamicSpecs(obstacles, includePickups);
        syncTileCacheObstacles(entry, dynamicSpecs);
        entry.dynamicSignature = dynamicSpecsSignature(dynamicSpecs);
        if (entry.debugDirty) {
          const refreshed = extractDebugGeometryFromNavMesh(entry.navMesh);
          entry.segments = refreshed.segments;
          entry.triangles = refreshed.triangles;
          entry.debugDirty = false;
        }
        entry.runtimeSignature = `${signature}|dyn:${entry.dynamicSignature}`;
      }

      if (cached) {
        if (crowdState.entry === cached) destroyCrowdState();
        if (cached.tileCache) cached.tileCache.destroy();
        cached.navQuery.destroy();
        cached.navMesh.destroy();
      }
      navMeshCache[modeKey] = entry;
      navMeshCache.active = entry;
      return entry;
    } catch (error) {
      recastState.ready = false;
      recastState.failed = true;
      console.warn("Recast navmesh build failed, using fallback nav pathing.", error);
      return null;
    }
  }

  function computeRecastPath(start, goal, obstacles, clearance, queryY = 0) {
    if (!recastState.ready) return null;
    const includePickups = !!obstacles?._includePickups;
    const entry = buildRecastNavEntry(obstacles, includePickups, clearance);
    if (!entry) return null;

    const queryHalfExtents = { x: 2.5, y: 2.0, z: 2.5 };
    const planY = Number.isFinite(queryY)
      ? queryY
      : (Number.isFinite(start?.y) ? start.y : (Number.isFinite(goal?.y) ? goal.y : 0));
    const result = entry.navQuery.computePath(
      { x: start.x, y: planY, z: start.z },
      { x: goal.x, y: planY, z: goal.z },
      {
        halfExtents: queryHalfExtents,
        maxPathPolys: 1024,
        maxStraightPathPoints: 1024,
      }
    );
    if (!result?.success || !Array.isArray(result.path) || result.path.length === 0) return [];

    const path = [];
    for (let i = 0; i < result.path.length; i++) {
      const p = result.path[i];
      path.push(new THREE.Vector3(p.x, Number.isFinite(p.y) ? p.y : planY, p.z));
    }

    if (path.length === 0) return [];
    if (path[0].distanceToSquared(start) > 0.01 * 0.01) path.unshift(start.clone());
    else path[0].copy(start);
    const last = path.length - 1;
    if (path[last].distanceToSquared(goal) > 0.01 * 0.01) path.push(goal.clone());
    else path[last].copy(goal);

    const smoothed = smoothCatPath(path, obstacles, clearance, planY);
    if (!isPathTraversable(smoothed, obstacles, clearance, planY)) return [];
    return smoothed;
  }

  function stepDetourCrowdToward(target, dt, useDynamicPlan = true, desiredSpeed = null) {
    if (!CAT_NAV.useDetourCrowd || !recastState.ready || cat.group.position.y > 0.02) return null;

    const clearance = getCatPathClearance();
    const baseSpeed = Number.isFinite(desiredSpeed) && desiredSpeed > 0 ? desiredSpeed : (cat.speed || 1);
    const detourSpeedScale = Math.max(0.1, Number.isFinite(CAT_NAV.detourSpeedScale) ? CAT_NAV.detourSpeedScale : 0.4);
    const agentSpeed = Math.max(0.2, baseSpeed * detourSpeedScale);

    const obstacles = buildCatObstacles(!!useDynamicPlan, true);
    const entry = buildRecastNavEntry(obstacles, !!useDynamicPlan, clearance);
    if (!entry) return null;

    const signature = `${useDynamicPlan ? "dynamic" : "static"}|${entry.runtimeSignature || entry.signature}|${Math.round(clearance * 1000) / 1000}`;
    let recreated = false;
    if (!crowdState.crowd || crowdState.entry !== entry || crowdState.signature !== signature) {
      destroyCrowdState();
      crowdState.crowd = new Crowd(entry.navMesh, {
        maxAgents: 1,
        maxAgentRadius: Math.max(0.05, clearance),
      });
      crowdState.entry = entry;
      crowdState.signature = signature;
      recreated = true;
    }

    if (!crowdState.agent) {
      const nearest = entry.navQuery.findClosestPoint(
        { x: cat.pos.x, y: 0, z: cat.pos.z },
        { halfExtents: { x: 1.8, y: 1.8, z: 1.8 } }
      );
      const startPos = nearest?.success ? nearest.point : { x: cat.pos.x, y: 0, z: cat.pos.z };
      crowdState.agent = crowdState.crowd.addAgent(startPos, {
        radius: Math.max(0.05, clearance),
        height: 0.4,
        maxAcceleration: 10,
        maxSpeed: agentSpeed,
        collisionQueryRange: Math.max(1.2, clearance * 8),
        pathOptimizationRange: Math.max(1.4, clearance * 6),
        separationWeight: 2,
        obstacleAvoidanceType: 3,
        updateFlags: 7,
      });
      crowdState.lastTarget.set(NaN, 0, NaN);
      crowdState.lastRequestAt = -1e9;
      recreated = true;
    }

    const agent = crowdState.agent;
    if (Math.abs((agent.maxSpeed || 0) - agentSpeed) > 0.02) {
      agent.maxSpeed = agentSpeed;
    }

    const agentPos = agent.position();
    if (!Number.isFinite(agentPos.x) || !Number.isFinite(agentPos.z)) return null;

    const driftSq = (agentPos.x - cat.pos.x) ** 2 + (agentPos.z - cat.pos.z) ** 2;
    if (recreated || driftSq > 0.32 * 0.32) {
      agent.teleport({ x: cat.pos.x, y: 0, z: cat.pos.z });
    }

    const snapRadius = Math.max(0.06, Number.isFinite(CAT_NAV.detourArriveSnapRadius) ? CAT_NAV.detourArriveSnapRadius : 0.1);
    const leadRadius = Math.max(0.2, Number.isFinite(CAT_NAV.detourLeadRadius) ? CAT_NAV.detourLeadRadius : 0.9);
    const leadDistance = Math.max(0.1, Number.isFinite(CAT_NAV.detourLeadDistance) ? CAT_NAV.detourLeadDistance : 0.45);
    const toGoalX = target.x - agentPos.x;
    const toGoalZ = target.z - agentPos.z;
    const distToGoal = Math.hypot(toGoalX, toGoalZ);
    let requestX = target.x;
    let requestZ = target.z;
    if (distToGoal > snapRadius && distToGoal < leadRadius) {
      const inv = 1 / Math.max(1e-6, distToGoal);
      requestX = target.x + toGoalX * inv * leadDistance;
      requestZ = target.z + toGoalZ * inv * leadDistance;
    }

    const reqDx = requestX - crowdState.lastTarget.x;
    const reqDz = requestZ - crowdState.lastTarget.z;
    const targetChanged = reqDx * reqDx + reqDz * reqDz > 0.05 * 0.05;
    const now = getClockTime();
    if (targetChanged || now - crowdState.lastRequestAt > 0.4) {
      const ok = agent.requestMoveTarget({ x: requestX, y: 0, z: requestZ });
      if (!ok) return { ok: false, reason: "requestMoveTargetFailed" };
      crowdState.lastTarget.set(requestX, 0, requestZ);
      crowdState.lastRequestAt = now;
    }

    // Keep detour step proportional to game dt so debug speed scaling affects movement continuously.
    const stepDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 1 / 24);
    crowdState.crowd.update(stepDt);

    const nextPos = agent.position();
    const velocity = agent.velocity();
    const state = agent.state();
    return {
      ok: true,
      position: new THREE.Vector3(nextPos.x, 0, nextPos.z),
      velocity: new THREE.Vector3(velocity.x, 0, velocity.z),
      state,
    };
  }

  function findNearestWalkablePoint(point, obstacles, clearance, queryY = null) {
    const y = Number.isFinite(queryY) ? queryY : (Number.isFinite(point?.y) ? point.y : 0);
    if (!isCatPointBlocked(point.x, point.z, obstacles, clearance, y)) return point.clone();
    const step = CAT_NAV.step;
    const candidate = new THREE.Vector3();
    for (let r = 1; r <= 10; r++) {
      const ringDist = r * step;
      const steps = Math.max(12, Math.floor(20 * r));
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        candidate.set(point.x + Math.cos(t) * ringDist, y, point.z + Math.sin(t) * ringDist);
        if (!isCatPointBlocked(candidate.x, candidate.z, obstacles, clearance, y)) return candidate.clone();
      }
    }
    return point.clone();
  }

  function isPointInsideTriangleXZ(point, a, b, c) {
    const cross = (p1, p2, p3) => (p2.x - p1.x) * (p3.z - p1.z) - (p2.z - p1.z) * (p3.x - p1.x);
    const c1 = cross(a, b, point);
    const c2 = cross(b, c, point);
    const c3 = cross(c, a, point);
    const hasNeg = c1 < 0 || c2 < 0 || c3 < 0;
    const hasPos = c1 > 0 || c2 > 0 || c3 > 0;
    return !(hasNeg && hasPos);
  }

  function buildTriangleNavMesh(obstacles, clearance, queryY = 0) {
    const step = CAT_NAV.step;
    const minX = ROOM.minX + CAT_NAV.margin;
    const maxX = ROOM.maxX - CAT_NAV.margin;
    const minZ = ROOM.minZ + CAT_NAV.margin;
    const maxZ = ROOM.maxZ - CAT_NAV.margin;
    const vxCount = Math.floor((maxX - minX) / step) + 1;
    const vzCount = Math.floor((maxZ - minZ) / step) + 1;
    if (vxCount < 2 || vzCount < 2) return { vertices: [], triangles: [] };

    const vertexId = (ix, iz) => iz * vxCount + ix;
    const vertices = new Array(vxCount * vzCount);
    const walkable = new Uint8Array(vertices.length);
    for (let iz = 0; iz < vzCount; iz++) {
      for (let ix = 0; ix < vxCount; ix++) {
        const id = vertexId(ix, iz);
        const v = new THREE.Vector3(minX + ix * step, queryY, minZ + iz * step);
        vertices[id] = v;
        if (!isCatPointBlocked(v.x, v.z, obstacles, clearance, queryY)) walkable[id] = 1;
      }
    }

    const triangles = [];
    const edgeOwner = new Map();
    const addAdjacencyEdge = (a, b, triIndex) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const owner = edgeOwner.get(key);
      if (owner == null) {
        edgeOwner.set(key, triIndex);
        return;
      }
      triangles[owner].neighbors.push(triIndex);
      triangles[triIndex].neighbors.push(owner);
    };

    const addTriangle = (a, b, c) => {
      if (!walkable[a] || !walkable[b] || !walkable[c]) return;
      const va = vertices[a];
      const vb = vertices[b];
      const vc = vertices[c];
      if (!hasClearTravelLine(va, vb, obstacles, clearance, queryY)) return;
      if (!hasClearTravelLine(vb, vc, obstacles, clearance, queryY)) return;
      if (!hasClearTravelLine(vc, va, obstacles, clearance, queryY)) return;
      const triIndex = triangles.length;
      triangles.push({
        a,
        b,
        c,
        centroid: new THREE.Vector3((va.x + vb.x + vc.x) / 3, 0, (va.z + vb.z + vc.z) / 3),
        neighbors: [],
      });
      addAdjacencyEdge(a, b, triIndex);
      addAdjacencyEdge(b, c, triIndex);
      addAdjacencyEdge(c, a, triIndex);
    };

    for (let iz = 0; iz < vzCount - 1; iz++) {
      for (let ix = 0; ix < vxCount - 1; ix++) {
        const a = vertexId(ix, iz);
        const b = vertexId(ix + 1, iz);
        const c = vertexId(ix, iz + 1);
        const d = vertexId(ix + 1, iz + 1);
        addTriangle(a, b, c);
        addTriangle(b, d, c);
      }
    }

    return { vertices, triangles };
  }

  function getNavMeshDebugData(includePickups = false, includeClosePickups = false) {
    const obstacles = buildCatObstacles(includePickups, includeClosePickups);
    const clearance = getCatPathClearance();
    if (recastState.ready) {
      const recastEntry = buildRecastNavEntry(obstacles, includePickups, clearance);
      if (recastEntry) {
        return {
          engine: "recast",
          segments: recastEntry.segments,
          triangles: recastEntry.triangles,
          includePickups,
          includeClosePickups,
          clearance,
        };
      }
    }

    const fallback = buildTriangleNavMesh(obstacles, clearance);
    return {
      engine: "triangle-fallback",
      ...fallback,
      includePickups,
      includeClosePickups,
      clearance,
    };
  }

  function getActiveNavMeshDebugData() {
    // Always resolve against current obstacles so debug reflects live navmesh changes.
    return getNavMeshDebugData(activeNavMeshMode.includePickups, activeNavMeshMode.includeClosePickups);
  }

  function findTriangleForPoint(point, navMesh, obstacles, clearance, queryY = 0) {
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < navMesh.triangles.length; i++) {
      const tri = navMesh.triangles[i];
      const va = navMesh.vertices[tri.a];
      const vb = navMesh.vertices[tri.b];
      const vc = navMesh.vertices[tri.c];
      if (isPointInsideTriangleXZ(point, va, vb, vc)) return i;
      const d2 = tri.centroid.distanceToSquared(point);
      if (d2 >= bestD2) continue;
      if (!hasClearTravelLine(point, tri.centroid, obstacles, clearance, queryY)) continue;
      bestD2 = d2;
      best = i;
    }
    return best;
  }

  function computeFallbackCatPath(start, goal, obstacles, navClearance, queryY = 0) {
    lastAStarDebug.mode = "fallback";
    lastAStarDebug.start = start.clone();
    lastAStarDebug.goal = goal.clone();
    lastAStarDebug.edges = [];
    lastAStarDebug.finalPath = [];
    lastAStarDebug.timestamp = getClockTime();

    const freeStart = findNearestWalkablePoint(start, obstacles, navClearance, queryY);
    const freeGoal = findNearestWalkablePoint(goal, obstacles, navClearance, queryY);
    const navMesh = buildTriangleNavMesh(obstacles, navClearance, queryY);
    if (!navMesh.triangles.length) return [];

    const startTri = findTriangleForPoint(freeStart, navMesh, obstacles, navClearance, queryY);
    const goalTri = findTriangleForPoint(freeGoal, navMesh, obstacles, navClearance, queryY);
    if (startTri < 0 || goalTri < 0) return [];
    if (startTri === goalTri) {
      lastAStarDebug.edges = [
        {
          from: start.clone(),
          to: goal.clone(),
          order: 0,
          accepted: true,
          reason: "sameCell",
        },
      ];
      lastAStarDebug.finalPath = [start.clone(), goal.clone()];
      return [start.clone(), goal.clone()];
    }

    const triCount = navMesh.triangles.length;
    const g = new Float32Array(triCount);
    const f = new Float32Array(triCount);
    const came = new Int32Array(triCount);
    const closed = new Uint8Array(triCount);
    for (let i = 0; i < triCount; i++) {
      g[i] = Infinity;
      f[i] = Infinity;
      came[i] = -1;
    }

    const open = [startTri];
    g[startTri] = 0;
    f[startTri] = navMesh.triangles[startTri].centroid.distanceTo(navMesh.triangles[goalTri].centroid);
    let aStarOrder = 0;

    while (open.length) {
      let bestI = 0;
      let bestF = f[open[0]];
      for (let i = 1; i < open.length; i++) {
        const score = f[open[i]];
        if (score < bestF) {
          bestF = score;
          bestI = i;
        }
      }

      const current = open[bestI];
      open[bestI] = open[open.length - 1];
      open.pop();
      if (current === goalTri) break;
      if (closed[current]) continue;
      closed[current] = 1;

      const currentCenter = navMesh.triangles[current].centroid;
      for (const neighbor of navMesh.triangles[current].neighbors) {
        const neighborCenter = navMesh.triangles[neighbor].centroid;
        const edgeRecord = {
          from: currentCenter.clone(),
          to: neighborCenter.clone(),
          order: aStarOrder++,
          accepted: false,
          reason: "checked",
        };
        if (lastAStarDebug.edges.length < 1800) {
          lastAStarDebug.edges.push(edgeRecord);
        }
        if (closed[neighbor]) continue;
        if (!hasClearTravelLine(currentCenter, neighborCenter, obstacles, navClearance, queryY)) {
          edgeRecord.reason = "blocked";
          continue;
        }
        const candidate = g[current] + currentCenter.distanceTo(neighborCenter);
        if (candidate >= g[neighbor]) {
          edgeRecord.reason = "worse";
          continue;
        }
        came[neighbor] = current;
        g[neighbor] = candidate;
        f[neighbor] = candidate + neighborCenter.distanceTo(navMesh.triangles[goalTri].centroid);
        open.push(neighbor);
        edgeRecord.accepted = true;
        edgeRecord.reason = "accepted";
      }
    }

    if (came[goalTri] === -1) return [];

    const triPath = [];
    let cur = goalTri;
    while (cur !== -1) {
      triPath.push(cur);
      cur = came[cur];
    }
    triPath.reverse();

    const waypoints = [start.clone()];
    for (let i = 1; i < triPath.length - 1; i++) {
      waypoints.push(navMesh.triangles[triPath[i]].centroid.clone());
    }
    waypoints.push(goal.clone());
    const final = smoothCatPath(waypoints, obstacles, navClearance, queryY);
    lastAStarDebug.finalPath = final.map((p) => p.clone());
    return final;
  }

  function computeCatPath(start, goal, obstacles, queryY = null) {
    const navClearance = getCatPathClearance();
    const pathY = Number.isFinite(queryY)
      ? queryY
      : (Number.isFinite(start?.y) ? start.y : (Number.isFinite(goal?.y) ? goal.y : 0));
    const startOnPlane = new THREE.Vector3(start.x, pathY, start.z);
    const goalOnPlane = new THREE.Vector3(goal.x, pathY, goal.z);
    const freeStart = findNearestWalkablePoint(startOnPlane, obstacles, navClearance, pathY);
    const freeGoal = findNearestWalkablePoint(goalOnPlane, obstacles, navClearance, pathY);

    const recastPath = computeRecastPath(freeStart, freeGoal, obstacles, navClearance, pathY);
    if (Array.isArray(recastPath) && recastPath.length >= 2) {
      recastPath[0] = startOnPlane.clone();
      recastPath[recastPath.length - 1] = goalOnPlane.clone();
      lastAStarDebug.mode = "recast";
      lastAStarDebug.start = startOnPlane.clone();
      lastAStarDebug.goal = goalOnPlane.clone();
      lastAStarDebug.edges = [];
      for (let i = 1; i < recastPath.length; i++) {
        lastAStarDebug.edges.push({
          from: recastPath[i - 1].clone(),
          to: recastPath[i].clone(),
          order: i - 1,
          accepted: true,
          reason: "recastPath",
        });
      }
      lastAStarDebug.finalPath = recastPath.map((p) => p.clone());
      lastAStarDebug.timestamp = getClockTime();
      return recastPath;
    }

    return computeFallbackCatPath(startOnPlane, goalOnPlane, obstacles, navClearance, pathY);
  }

  function isPathTraversable(path, obstacles, clearance = CAT_NAV.clearance, queryY = null) {
    if (!path || path.length < 2) return false;
    for (let i = 1; i < path.length; i++) {
      const segY = Number.isFinite(queryY)
        ? queryY
        : (
            Number.isFinite(path[i - 1]?.y) && Number.isFinite(path[i]?.y)
              ? (path[i - 1].y + path[i].y) * 0.5
              : 0
          );
      if (!hasClearTravelLine(path[i - 1], path[i], obstacles, clearance, segY)) return false;
    }
    return true;
  }

  function canReachGroundTarget(start, goal, obstacles) {
    const navClearance = getCatPathClearance();
    if (isCatPointBlocked(goal.x, goal.z, obstacles, navClearance)) return false;
    if (start.distanceToSquared(goal) < 0.1 * 0.1) return true;
    const path = computeCatPath(start, goal, obstacles, 0);
    return isPathTraversable(path, obstacles, navClearance, 0);
  }

  function ensureCatPath(target, force = false, useDynamic = false, queryY = null) {
    const pathY = Number.isFinite(queryY)
      ? queryY
      : (cat.group.position.y > 0.08 ? cat.group.position.y : (Number.isFinite(target?.y) ? target.y : 0));
    const navClearance = getCatPathClearance();
    const obstacles = buildCatObstacles(useDynamic, true);
    const modeKey = useDynamic ? "dynamic" : "static";
    const navSignature = obstacleSignature(obstacles, navClearance);
    const navChanged = lastPlannedSignature[modeKey] !== navSignature;
    const now = getClockTime();
    const targetOnPlane = new THREE.Vector3(target.x, pathY, target.z);
    const goalDelta = cat.nav.goal.distanceToSquared(targetOnPlane);
    const goalUnchanged = goalDelta < 0.05 * 0.05;
    const allowNavRefreshNow = now >= (cat.nav.repathAt || 0);
    if (!force) {
      if (!navChanged && cat.nav.path.length > 1 && goalUnchanged) return;
      // Throttle nav-signature churn from moving pickups; force/stuck handlers still bypass this.
      if (navChanged && goalUnchanged && !allowNavRefreshNow) return;
    }
    activeNavMeshMode.includePickups = !!useDynamic;
    activeNavMeshMode.includeClosePickups = true;
    const startOnPlane = new THREE.Vector3(cat.pos.x, pathY, cat.pos.z);
    cat.nav.path = computeCatPath(startOnPlane, targetOnPlane, obstacles, pathY);
    cat.nav.index = cat.nav.path.length > 1 ? 1 : 0;
    cat.nav.goal.copy(targetOnPlane);
    cat.nav.repathAt = now + CAT_NAV.repathInterval;
    lastPlannedSignature[modeKey] = navSignature;
  }

  async function initPathfinding() {
    await ensureRecastInitialized();
  }

  function getLastAStarDebugData() {
    return {
      mode: lastAStarDebug.mode,
      start: lastAStarDebug.start ? lastAStarDebug.start.clone() : null,
      goal: lastAStarDebug.goal ? lastAStarDebug.goal.clone() : null,
      edges: Array.isArray(lastAStarDebug.edges) ? lastAStarDebug.edges : [],
      finalPath: Array.isArray(lastAStarDebug.finalPath) ? lastAStarDebug.finalPath : [],
      timestamp: lastAStarDebug.timestamp || 0,
    };
  }

  return {
    initPathfinding,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    catPathDistance,
    getNavMeshDebugData,
    getActiveNavMeshDebugData,
    getLastAStarDebugData,
    computeCatPath,
    isPathTraversable,
    canReachGroundTarget,
    ensureCatPath,
    stepDetourCrowdToward,
    resetDetourCrowd: destroyCrowdState,
  };
}
