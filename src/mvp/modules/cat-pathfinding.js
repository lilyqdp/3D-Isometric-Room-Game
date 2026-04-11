import { init as initRecast, NavMeshQuery, Crowd } from "@recast-navigation/core";
import { NavMeshHelper, threeToSoloNavMesh, threeToTileCache } from "@recast-navigation/three";
import { createCatPathSignatureRuntime } from "./cat-path-signature.js";
import {
  getSurfaceAabb,
  getSurfaceCenter,
  getSurfaceHalfExtents,
  getSurfaceKind,
  getSurfacePlanarGap,
  getSurfaceRadius,
  getSurfaceYaw,
  isPointInsideSurfaceXZ,
} from "./surface-shapes.js";

export function createCatPathfindingRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ROOM,
    getSurfaceDefs,
    getSurfaceById,
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
    recordFunctionTrace = null,
    shouldRecordPathProfiler = () => false,
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
  const pathSolveCache = new Map();
  const reachabilityCache = new Map();
  const nearestWalkableCache = new Map();

  function traceFunction(name, details = "") {
    if (typeof recordFunctionTrace === "function") {
      recordFunctionTrace(name, details);
    }
  }
  const PATH_CACHE_QUANTUM = 0.1;
  const PATH_CACHE_TTL = 0.65;
  const PATH_CACHE_LIMIT = 72;
  const REACHABILITY_CACHE_TTL = 0.5;
  const REACHABILITY_CACHE_LIMIT = 96;
  const NEAREST_WALKABLE_CACHE_TTL = 0.5;
  const NEAREST_WALKABLE_CACHE_LIMIT = 96;
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
  const WALKABLE_SURFACE_THICKNESS = 0.08;
  const WALKABLE_SURFACE_LIFT = 0.01;
  const activeNavMeshMode = {
    includePickups: false,
    includeClosePickups: true,
  };
  const obstacleBuildCache = new Map();
  const OBSTACLE_BUILD_CACHE_LIMIT = 8;
  let staticSourceObstaclesCache = null;
  const pathFamilyCache = new Map();
  const triangleNavMeshCache = new Map();
  const PATH_FAMILY_QUANTUM = 0.36;
  const PATH_FAMILY_TTL = 0.6;
  const PATH_FAMILY_LIMIT = 48;
  const TRIANGLE_NAV_CACHE_TTL = 0.85;
  const TRIANGLE_NAV_CACHE_LIMIT = 12;
  const CORRIDOR_GOAL_QUANTUM = 0.42;
  const DYNAMIC_OBSTACLE_SAMPLE_INTERVAL = 0.035;
  const dynamicObstacleSnapshot = {
    at: -1e9,
    includePickups: false,
    includeClosePickups: false,
    signature: "",
  };

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

  function bumpPathProfilerCounter(name, delta = 1) {
    const profiler = ensurePathProfiler();
    if (!profiler) return 0;
    profiler.counters[name] = (Number(profiler.counters[name]) || 0) + delta;
    return profiler.counters[name];
  }

  function bumpPathProfilerReason(prefix, reason, delta = 1) {
    const key = String(reason || "unknown")
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "unknown";
    return bumpPathProfilerCounter(`${prefix}.${key}`, delta);
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

  function ensureLastSolverDebug() {
    if (!cat.nav || typeof cat.nav !== "object") cat.nav = {};
    if (!cat.nav.lastSolverDebug || typeof cat.nav.lastSolverDebug !== "object") {
      cat.nav.lastSolverDebug = {};
    }
    return cat.nav.lastSolverDebug;
  }

  function updateLastSolverDebug(partial = null) {
    const debug = ensureLastSolverDebug();
    Object.assign(debug, partial && typeof partial === "object" ? partial : {});
    debug.t = getClockTime();
    return debug;
  }

  const OBSTACLE_BEHAVIOR_DEFAULTS = {
    hard: { navPad: 0.02, steerPad: 0.005, collisionPad: 0.0, blocksRuntime: true, blocksPath: true, pushable: false },
    soft: { navPad: 0.05, steerPad: 0.01, collisionPad: 0.0, blocksRuntime: false, blocksPath: true, pushable: false },
    pushable: { navPad: 0.05, steerPad: 0.0, collisionPad: 0.0, blocksRuntime: true, blocksPath: true, pushable: true },
  };

  function resolveObstacleMode(mode, fallback = "hard") {
    const normalized = String(mode || fallback || "hard").toLowerCase();
    return OBSTACLE_BEHAVIOR_DEFAULTS[normalized] ? normalized : "hard";
  }

  function makeObstacle(spec = {}, defaults = {}) {
    const mode = resolveObstacleMode(spec.mode, defaults.mode);
    const behavior = OBSTACLE_BEHAVIOR_DEFAULTS[mode] || OBSTACLE_BEHAVIOR_DEFAULTS.hard;
    const obstacle = { ...defaults, ...spec };
    obstacle.mode = mode;
    obstacle.navPad = Number.isFinite(Number(spec.navPad)) ? Number(spec.navPad) : Number(defaults.navPad ?? behavior.navPad ?? 0);
    obstacle.steerPad = Number.isFinite(Number(spec.steerPad)) ? Number(spec.steerPad) : Number(defaults.steerPad ?? behavior.steerPad ?? obstacle.navPad ?? 0);
    obstacle.collisionPad = Number.isFinite(Number(spec.collisionPad)) ? Number(spec.collisionPad) : Number(defaults.collisionPad ?? behavior.collisionPad ?? 0);
    obstacle.blocksRuntime = spec.blocksRuntime != null ? !!spec.blocksRuntime : (defaults.blocksRuntime != null ? !!defaults.blocksRuntime : !!behavior.blocksRuntime);
    obstacle.blocksPath = spec.blocksPath != null ? !!spec.blocksPath : (defaults.blocksPath != null ? !!defaults.blocksPath : !!behavior.blocksPath);
    obstacle.pushable = spec.pushable != null ? !!spec.pushable : (defaults.pushable != null ? !!defaults.pushable : !!behavior.pushable);
    return obstacle;
  }

  function getObstaclePad(obs, stage = "plan") {
    if (!obs) return 0;
    if (stage === "runtime") return Math.max(0, Number(obs.steerPad) || 0);
    if (stage === "collision") return Math.max(0, Number(obs.collisionPad) || 0);
    return Math.max(0, Number(obs.navPad) || 0);
  }

  function obstacleBlocksAtStage(obs, stage = "plan") {
    if (!obs) return false;
    if (stage === "runtime" || stage === "collision") return obs.blocksRuntime !== false;
    return obs.blocksPath !== false;
  }

  function obstacleAffectsDetourCrowd(obs) {
    if (!obs) return false;
    if (obs.tag === "cup" && (cat.state === "toCup" || cat.state === "swipe")) return false;
    return obs.blocksPath !== false;
  }

  function buildSpecialRoomObstacles() {
    const obstacles = [];
    if (hamper?.obstacle?.enabled) {
      obstacles.push(makeObstacle({
        kind: "box",
        mode: "soft",
        tag: "hamper",
        x: hamper.pos.x,
        z: hamper.pos.z,
        hx: hamper.outerHalfX + 0.01,
        hz: hamper.outerHalfZ + 0.01,
        navPad: 0.03,
        steerPad: 0.012,
        collisionPad: 0,
        y: hamper.rimY * 0.5,
        h: hamper.rimY + 0.06,
      }));
    }
    if (trashCan?.obstacle?.enabled) {
      obstacles.push(makeObstacle({
        kind: "circle",
        mode: "soft",
        tag: "trashcan",
        x: trashCan.pos.x,
        z: trashCan.pos.z,
        r: trashCan.outerRadius + 0.08,
        navPad: 0.06,
        steerPad: 0.016,
        collisionPad: 0,
        y: trashCan.rimY * 0.5,
        h: trashCan.rimY + 0.08,
      }));
    }
    for (const leg of DESK_LEGS) {
      obstacles.push(applyOptionalObstacleMeta(makeObstacle({
        kind: "box",
        mode: "hard",
        x: leg.x,
        z: leg.z,
        hx: leg.halfX + 0.02,
        hz: leg.halfZ + 0.02,
        navPad: 0.025,
        steerPad: 0.02,
        collisionPad: 0,
        jumpIgnoreSurfaceIds: ["desk"],
        y: leg.topY * 0.5,
        h: leg.topY + 0.04,
      }), leg));
    }
    return obstacles;
  }

  function inflateObstacleForStage(obs, stage = "plan") {
    const pad = getObstaclePad(obs, stage);
    if (!pad) return obs;
    if (obs.kind === "circle") return { ...obs, r: (obs.r || 0) + pad };
    if (obs.kind === "obb") return { ...obs, hx: (obs.hx || 0) + pad, hz: (obs.hz || 0) + pad };
    return { ...obs, hx: (obs.hx || 0) + pad, hz: (obs.hz || 0) + pad };
  }

  function makePathFamilyKey(signature, allowFallbackPlanner, pathY, start, goal) {
    const q = (v) => Math.round((Number.isFinite(v) ? v : 0) / PATH_FAMILY_QUANTUM);
    return `${signature}|${allowFallbackPlanner ? 1 : 0}|${q(pathY)}|${q(start?.x)}:${q(start?.z)}|${q(goal?.x)}:${q(goal?.z)}`;
  }

  function makeCorridorGoalReuseKey(signature, allowFallbackPlanner, pathY, goal) {
    const q = (v) => Math.round((Number.isFinite(v) ? v : 0) / CORRIDOR_GOAL_QUANTUM);
    return `${signature}|${allowFallbackPlanner ? 1 : 0}|${q(pathY)}|${q(goal?.x)}:${q(goal?.z)}`;
  }

  function getCachedFamilyPath(familyKey, startOnPlane, goalOnPlane, obstacles, navClearance, queryY, now, pathOptions = null) {
    const cached = pathFamilyCache.get(familyKey);
    if (!cached || now - cached.at > PATH_FAMILY_TTL) return null;
    const cachedPath = Array.isArray(cached.path) ? cached.path.map((p) => p.clone()) : null;
    if (!cachedPath || cachedPath.length < 2) return null;
    const nextPoint = cachedPath[1] || cachedPath[0];
    if (!hasClearTravelLine(startOnPlane, nextPoint, obstacles, navClearance, queryY, "plan", pathOptions)) return null;
    const prevPoint = cachedPath[cachedPath.length - 2] || cachedPath[cachedPath.length - 1];
    if (!hasClearTravelLine(prevPoint, goalOnPlane, obstacles, navClearance, queryY, "plan", pathOptions)) return null;
    cachedPath[0] = startOnPlane.clone();
    cachedPath[cachedPath.length - 1] = goalOnPlane.clone();
    return { mode: cached.mode || "family", path: cachedPath };
  }

  function getReusableCorridorPath(reuseKey, startOnPlane, freeStart, goalOnPlane, freeGoal, obstacles, navClearance, queryY, now, pathOptions = null) {
    for (const cached of pathFamilyCache.values()) {
      if (!cached || cached.reuseKey !== reuseKey || now - cached.at > PATH_FAMILY_TTL) continue;
      const cachedPath = Array.isArray(cached.path) ? cached.path : null;
      if (!cachedPath || cachedPath.length < 3) continue;
      const tailAnchor = cachedPath[cachedPath.length - 2] || cachedPath[cachedPath.length - 1];
      if (!hasClearTravelLine(tailAnchor, freeGoal, obstacles, navClearance, queryY, "plan", pathOptions)) continue;
      for (let i = 1; i < cachedPath.length - 1; i++) {
        const joinPoint = cachedPath[i];
        if (!joinPoint) continue;
        if (!hasClearTravelLine(freeStart, joinPoint, obstacles, navClearance, queryY, "plan", pathOptions)) continue;
        const corePath = [freeStart.clone()];
        for (let j = i; j < cachedPath.length - 1; j++) {
          corePath.push(cachedPath[j].clone());
        }
        corePath.push(freeGoal.clone());
        const path = materializePathWithEndpoints(
          corePath,
          startOnPlane,
          freeStart,
          goalOnPlane,
          freeGoal,
          obstacles,
          navClearance,
          queryY,
          pathOptions
        );
        if (!Array.isArray(path) || path.length < 2) continue;
        return { mode: cached.mode || "corridor", path };
      }
    }
    return null;
  }

  function storePathFamily(familyKey, now, mode, path, reuseKey = "") {
    pathFamilyCache.set(familyKey, { at: now, mode, path: path.map((p) => p.clone()), reuseKey });
    if (pathFamilyCache.size > PATH_FAMILY_LIMIT) {
      const oldestKey = pathFamilyCache.keys().next().value;
      if (oldestKey != null) pathFamilyCache.delete(oldestKey);
    }
  }

  function attachObstacleMetadata(obstacles, includePickups = false, includeClosePickups = false) {
    obstacles._includePickups = !!includePickups;
    obstacles._includeClosePickups = !!includeClosePickups;
    obstacles._signatureByClearance = new Map();
    const dynamicSpecs = buildTileCacheDynamicSpecs(obstacles, includePickups);
    obstacles._tileCacheDynamicSpecs = dynamicSpecs;
    obstacles._dynamicSignature = dynamicSpecsSignature(dynamicSpecs);
    return obstacles;
  }

  function getObstacleSignatureCached(obstacles, clearance) {
    if (!Array.isArray(obstacles)) return obstacleSignature(obstacles || [], clearance);
    if (!(obstacles._signatureByClearance instanceof Map)) obstacles._signatureByClearance = new Map();
    const key = qv(clearance, 0.02);
    if (!obstacles._signatureByClearance.has(key)) {
      obstacles._signatureByClearance.set(key, obstacleSignature(obstacles, clearance));
      if (obstacles._signatureByClearance.size > 4) {
        const oldestKey = obstacles._signatureByClearance.keys().next().value;
        if (oldestKey != null) obstacles._signatureByClearance.delete(oldestKey);
      }
    }
    return obstacles._signatureByClearance.get(key);
  }

  function ensurePickupObstacleKey(pickup, fallbackIndex = 0) {
    if (!pickup?._navObstacleKey) {
      pickup._navObstacleKey = `pickup-${fallbackIndex}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return pickup._navObstacleKey;
  }

  function getPickupPlanarYaw(pickup) {
    if (!pickup?.body?.quaternion) return 0;
    tempQ.set(pickup.body.quaternion.x, pickup.body.quaternion.y, pickup.body.quaternion.z, pickup.body.quaternion.w);
    tempForward.set(0, 0, 1).applyQuaternion(tempQ);
    tempForward.y = 0;
    if (tempForward.lengthSq() > 1e-6) {
      tempForward.normalize();
      return Math.atan2(tempForward.x, tempForward.z);
    }
    tempEuler.setFromQuaternion(tempQ, "YXZ");
    return tempEuler.y;
  }

  function getDynamicObstacleSampleSignature(includePickups = false, includeClosePickups = false) {
    const now = getClockTime();
    const sameMode =
      dynamicObstacleSnapshot.includePickups === !!includePickups &&
      dynamicObstacleSnapshot.includeClosePickups === !!includeClosePickups;
    if (sameMode && now - dynamicObstacleSnapshot.at <= DYNAMIC_OBSTACLE_SAMPLE_INTERVAL) {
      return dynamicObstacleSnapshot.signature;
    }
    const parts = [];
    if (!cup.broken && !cup.falling && cup.group.visible) {
      parts.push(
        `cup:${qv(cup.group.position.x, 0.03)}:${qv(cup.group.position.y, 0.03)}:${qv(cup.group.position.z, 0.03)}`
      );
    } else {
      parts.push("cup:none");
    }
    if (includePickups) {
      if (!includeClosePickups) {
        parts.push(`cat:${qv(cat.pos.x, 0.08)}:${qv(cat.pos.z, 0.08)}`);
      }
      for (let i = 0; i < pickups.length; i++) {
        const p = pickups[i];
        if (!p || p.motion === "drag") continue;
        const px = p.body?.position?.x ?? p.mesh?.position?.x ?? 0;
        const py = p.body?.position?.y ?? p.mesh?.position?.y ?? 0;
        const pz = p.body?.position?.z ?? p.mesh?.position?.z ?? 0;
        if (!includeClosePickups) {
          const cdx = px - cat.pos.x;
          const cdz = pz - cat.pos.z;
          if (cdx * cdx + cdz * cdz < 0.22 * 0.22) continue;
        }
        const yaw = getPickupPlanarYaw(p);
        parts.push(
          `pk:${ensurePickupObstacleKey(p, i)}:${p.type || "pickup"}:${qv(px, 0.04)}:${qv(py, 0.04)}:${qv(pz, 0.04)}:${qv(yaw, Math.PI / 24)}`
        );
      }
    }
    dynamicObstacleSnapshot.at = now;
    dynamicObstacleSnapshot.includePickups = !!includePickups;
    dynamicObstacleSnapshot.includeClosePickups = !!includeClosePickups;
    dynamicObstacleSnapshot.signature = parts.join("|");
    return dynamicObstacleSnapshot.signature;
  }

  function buildObstacleCacheKey(includePickups = false, includeClosePickups = false) {
    const parts = [`p:${includePickups ? 1 : 0}`, `c:${includeClosePickups ? 1 : 0}`];
    parts.push(getDynamicObstacleSampleSignature(includePickups, includeClosePickups));
    return parts.join("|");
  }

  function getWalkableSurfaces(options = {}) {
    const includeFloor = options.includeFloor !== false;
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor }) : [];
    if (!Array.isArray(defs)) return [];
    const out = [];
    const seen = new Set();
    for (const def of defs) {
      if (!def) continue;
      const aabb = getSurfaceAabb(def);
      const minX = Number(aabb.minX);
      const maxX = Number(aabb.maxX);
      const minZ = Number(aabb.minZ);
      const maxZ = Number(aabb.maxZ);
      const y = Number(def.y);
      if (![minX, maxX, minZ, maxZ, y].every(Number.isFinite)) continue;
      const id = String(def.id || def.name || `surface-${out.length}`);
      if (seen.has(id)) continue;
      let resolvedMinX = minX;
      let resolvedMaxX = maxX;
      let resolvedMinZ = minZ;
      let resolvedMaxZ = maxZ;
      let center = getSurfaceCenter(def);
      let halfExtents = getSurfaceHalfExtents(def);
      let radius = getSurfaceRadius(def);
      let shape = getSurfaceKind(def);
      let yaw = getSurfaceYaw(def);
      if (id === "floor") {
        resolvedMinX += CAT_NAV.margin;
        resolvedMaxX -= CAT_NAV.margin;
        resolvedMinZ += CAT_NAV.margin;
        resolvedMaxZ -= CAT_NAV.margin;
        center = {
          x: (resolvedMinX + resolvedMaxX) * 0.5,
          z: (resolvedMinZ + resolvedMaxZ) * 0.5,
        };
        halfExtents = {
          hx: Math.max(0.02, (resolvedMaxX - resolvedMinX) * 0.5),
          hz: Math.max(0.02, (resolvedMaxZ - resolvedMinZ) * 0.5),
        };
        radius = Math.max(0.02, Math.min(halfExtents.hx, halfExtents.hz));
        shape = "rect";
        yaw = 0;
      }
      if (resolvedMaxX - resolvedMinX <= 0.05 || resolvedMaxZ - resolvedMinZ <= 0.05) continue;
      seen.add(id);
      out.push({
        id,
        y,
        shape,
        center,
        halfExtents,
        radius,
        yaw,
        minX: resolvedMinX,
        maxX: resolvedMaxX,
        minZ: resolvedMinZ,
        maxZ: resolvedMaxZ,
      });
    }
    return out;
  }

  function getWalkableElevatedSurfaces() {
    return getWalkableSurfaces({ includeFloor: false });
  }

  function getWalkableSurfaceById(id) {
    const resolvedId = String(id || "floor");
    return getWalkableSurfaces().find((surface) => String(surface?.id || "") === resolvedId) || null;
  }

  function resolvePathSupportSurfaceId(pathOptions = null) {
    const supportSurfaceId =
      pathOptions && typeof pathOptions === "object"
        ? String(pathOptions.supportSurfaceId || "")
        : "";
    return supportSurfaceId && supportSurfaceId !== "floor" ? supportSurfaceId : "";
  }

  function resolvePathClearanceOverride(pathOptions = null) {
    if (!pathOptions || typeof pathOptions !== "object") return null;
    const override = Number(pathOptions.clearanceOverride);
    return Number.isFinite(override) ? Math.max(0.01, override) : null;
  }


  function getObstacleIdentity(obs) {
    if (!obs) return "";
    const pickupKey = String(obs.pickupKey || "").trim();
    if (pickupKey) return pickupKey;
    const explicitId = String(obs.obstacleId || obs.id || "").trim();
    if (explicitId) return explicitId;
    const surfaceId = String(obs.surfaceId || "").trim();
    const tag = String(obs.tag || "").trim();
    const x = Number.isFinite(obs.x) ? obs.x.toFixed(3) : "0.000";
    const z = Number.isFinite(obs.z) ? obs.z.toFixed(3) : "0.000";
    if (surfaceId && tag) return `${surfaceId}:${tag}:${x}:${z}`;
    if (tag) return `${tag}:${x}:${z}`;
    return `${String(obs.kind || "obs")}:${x}:${z}`;
  }

  function resolveIgnoredObstacleIds(pathOptions = null) {
    if (!pathOptions || typeof pathOptions !== "object") return [];
    return (Array.isArray(pathOptions.ignoreObstacleIds) ? pathOptions.ignoreObstacleIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .sort();
  }

  function getPathOptionsCacheKey(pathOptions = null) {
    const supportSurfaceId = resolvePathSupportSurfaceId(pathOptions);
    const clearanceOverride = resolvePathClearanceOverride(pathOptions);
    const ignoredObstacleIds = resolveIgnoredObstacleIds(pathOptions);
    const parts = [supportSurfaceId ? `surface:${supportSurfaceId}` : "surface:all"];
    if (Number.isFinite(clearanceOverride)) {
      parts.push(`clr:${Math.round(clearanceOverride * 1000)}`);
    }
    if (ignoredObstacleIds.length) {
      parts.push(`ign:${ignoredObstacleIds.join(",")}`);
    }
    const ignorePushableSurfaceId = pathOptions && typeof pathOptions === "object"
      ? String(pathOptions.ignorePushableSurfaceId || "")
      : "";
    if (ignorePushableSurfaceId) {
      parts.push(`ignsurf:${ignorePushableSurfaceId}`);
    }
    return parts.join("|");
  }

  function pointRespectsPathSupportSurface(x, z, clearance = null, pathOptions = null) {
    const supportSurfaceId = resolvePathSupportSurfaceId(pathOptions);
    if (!supportSurfaceId) return true;
    const supportSurface = getWalkableSurfaceById(supportSurfaceId);
    if (!supportSurface) return false;
    const navClearance = resolvePathClearance(clearance);
    const supportPad = Math.max(0.005, Math.min(0.02, navClearance * 0.2));
    return isPointInsideSurfaceXZ(supportSurface, x, z, supportPad);
  }

  function resolveObstacleSurfaceForPoint(x, y, z) {
    const surfaces = getWalkableSurfaces();
    let best = null;
    let bestScore = Infinity;
    for (const surface of surfaces) {
      if (!surface) continue;
      if (x < surface.minX - 0.08 || x > surface.maxX + 0.08 || z < surface.minZ - 0.08 || z > surface.maxZ + 0.08) continue;
      const dy = Math.abs((Number.isFinite(y) ? y : 0) - surface.y);
      if (dy > 0.34) continue;
      const inside = isPointInsideSurfaceXZ(surface, x, z, 0.02);
      const gap = inside ? 0 : getSurfacePlanarGap(surface, x, z, 0.02);
      const score = dy * 4 + gap;
      if (score < bestScore) {
        bestScore = score;
        best = surface;
      }
    }
    return best || getWalkableSurfaceById("floor");
  }

  function resolveObstacleSurfaceIdForPoint(x, y, z) {
    return String(resolveObstacleSurfaceForPoint(x, y, z)?.id || "floor");
  }

  function obstacleMatchesIgnoredPushableSurface(obs, ignoreSurfaceId = "") {
    const resolvedIgnoreId = String(ignoreSurfaceId || "");
    if (!obs?.pushable || !resolvedIgnoreId) return false;
    if (String(obs.surfaceId || "") === resolvedIgnoreId) return true;
    const surface = getWalkableSurfaceById(resolvedIgnoreId);
    if (!surface) return false;
    const reach = Math.max(
      0.08,
      Number(obs.r) || 0,
      Number(obs.hx) || 0,
      Number(obs.hz) || 0
    ) + 0.08;
    return (
      obs.x >= surface.minX - reach &&
      obs.x <= surface.maxX + reach &&
      obs.z >= surface.minZ - reach &&
      obs.z <= surface.maxZ + reach
    );
  }

  function getActiveCatPathOptions() {
    return cat?.nav?.pathOptions && typeof cat.nav.pathOptions === "object"
      ? cat.nav.pathOptions
      : null;
  }

  function filterObstaclesForPathOptions(obstacles, pathOptions = null) {
    const source = Array.isArray(obstacles) ? obstacles : [];
    const resolvedPathOptions = pathOptions && typeof pathOptions === "object" ? pathOptions : null;
    if (!resolvedPathOptions) return obstacles;
    const ignoreSurfaceId = String(pathOptions.ignorePushableSurfaceId || "");
    const ignoredObstacleIds = new Set(resolveIgnoredObstacleIds(resolvedPathOptions));
    let filtered = source;
    if (ignoredObstacleIds.size > 0) {
      filtered = filtered.filter((obs) => !ignoredObstacleIds.has(getObstacleIdentity(obs)));
    }
    if (ignoreSurfaceId) {
      filtered = filtered.filter((obs) => !obstacleMatchesIgnoredPushableSurface(obs, ignoreSurfaceId));
    }
    if (filtered.length === source.length) return obstacles;
    attachObstacleMetadata(filtered, !!source._includePickups, !!source._includeClosePickups);
    filtered._filteredFromSignature = source._dynamicSignature || "";
    return filtered;
  }

  function obstacleIgnoredForSameSurfaceStartRescue(obs, supportSurfaceId = "") {
    const resolvedSurfaceId = String(supportSurfaceId || "");
    if (!obs || !resolvedSurfaceId || resolvedSurfaceId === "floor") return false;
    const ignoreIds = Array.isArray(obs.jumpIgnoreSurfaceIds)
      ? obs.jumpIgnoreSurfaceIds.map((v) => String(v))
      : obs.jumpIgnoreSurfaceIds != null
        ? [String(obs.jumpIgnoreSurfaceIds)]
        : [];
    if (ignoreIds.includes(resolvedSurfaceId)) return true;
    if (String(obs.surfaceId || "") !== resolvedSurfaceId) return false;
    return obs.tag === "surfaceSupport" || obs.tag === "surfaceBlocker";
  }

  function filterObstaclesForSameSurfaceStartRescue(obstacles, supportSurfaceId = "") {
    const resolvedSurfaceId = String(supportSurfaceId || "");
    if (!Array.isArray(obstacles) || !obstacles.length || !resolvedSurfaceId || resolvedSurfaceId === "floor") {
      return obstacles;
    }
    const filtered = obstacles.filter((obs) => !obstacleIgnoredForSameSurfaceStartRescue(obs, resolvedSurfaceId));
    if (filtered.length === obstacles.length) return obstacles;
    attachObstacleMetadata(filtered, !!obstacles._includePickups, !!obstacles._includeClosePickups);
    filtered._filteredFromSignature = obstacles._dynamicSignature || "";
    return filtered;
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
    const startedAt = performance.now();
    const cacheKey = buildObstacleCacheKey(includePickups, includeClosePickups);
    const cached = obstacleBuildCache.get(cacheKey);
    if (cached) {
      bumpPathProfilerCounter("obstacleCacheHits");
      finishPathProfilerMetric(
        "buildCatObstacles",
        startedAt,
        {
          cached: true,
          includePickups: !!includePickups,
          includeClosePickups: !!includeClosePickups,
          obstacleCount: Array.isArray(cached) ? cached.length : 0,
        },
        2.5
      );
      return cached;
    }
    bumpPathProfilerCounter("obstacleCacheMisses");
    const obstacles = buildSpecialRoomObstacles();
    for (const obs of EXTRA_NAV_OBSTACLES) {
      if (!obs) continue;
      if (obs.kind === "circle") {
        obstacles.push(applyOptionalObstacleMeta(makeObstacle({
          kind: "circle",
          mode: obs.mode || "hard",
          x: obs.x,
          z: obs.z,
          r: obs.r,
          navPad: obs.navPad || 0,
          steerPad: obs.steerPad,
          collisionPad: obs.collisionPad,
          blocksRuntime: obs.blocksRuntime,
          blocksPath: obs.blocksPath,
          pushable: obs.pushable,
          y: obs.y,
          h: obs.h,
        }), obs));
      } else if (obs.kind === "obb") {
        obstacles.push(applyOptionalObstacleMeta(makeObstacle({
          kind: "obb",
          mode: obs.mode || "hard",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          navPad: obs.navPad || 0,
          steerPad: obs.steerPad,
          collisionPad: obs.collisionPad,
          blocksRuntime: obs.blocksRuntime,
          blocksPath: obs.blocksPath,
          pushable: obs.pushable,
          yaw: obs.yaw || 0,
          y: obs.y,
          h: obs.h,
        }), obs));
      } else {
        obstacles.push(applyOptionalObstacleMeta(makeObstacle({
          kind: "box",
          mode: obs.mode || "hard",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          navPad: obs.navPad || 0,
          steerPad: obs.steerPad,
          collisionPad: obs.collisionPad,
          blocksRuntime: obs.blocksRuntime,
          blocksPath: obs.blocksPath,
          pushable: obs.pushable,
          y: obs.y,
          h: obs.h,
        }), obs));
      }
    }
    // The desk cup is intentionally interactable and should not behave like a
    // hard navigation wall. Treating it as an impassable nav obstacle strands
    // the cat near swipe points and jump anchors on the desk, especially when
    // the cat needs to approach the cup or pass close to it before jumping.
    if (includePickups) {
      for (let i = 0; i < pickups.length; i++) {
        const p = pickups[i];
        // A held/dragged item is player-controlled and suspended in air; it should not
        // invalidate nav/jump routes until released.
        if (p?.motion === "drag") continue;
        const pickupKey = ensurePickupObstacleKey(p, i);
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
        const rawCenterY = p.body?.position?.y ?? p.mesh.position.y;
        const supportY = rawCenterY - halfY;
        const supportSurface =
          resolveObstacleSurfaceForPoint(px, supportY, pz) ||
          (typeof getSurfaceById === "function" ? getSurfaceById("floor") : null);
        const surfaceId = String(supportSurface?.id || "floor");
        const centerY = Number.isFinite(Number(supportSurface?.y))
          ? Number(supportSurface.y) + halfY
          : rawCenterY;
        const yaw = getPickupPlanarYaw(p);
        const pickupMode = p.type === "trash" ? "pushable" : "pushable";
        obstacles.push(makeObstacle({
          kind: "obb",
          mode: pickupMode,
          tag: `pickup-${p.type || "item"}`,
          pickupKey,
          surfaceId,
          x: px,
          z: pz,
          hx: halfX,
          hz: halfZ,
          navPad: p.type === "laundry" ? 0.05 : 0.04,
          steerPad: 0,
          collisionPad: 0,
          yaw,
          y: centerY,
          h: height,
        }));
      }
    }
    attachObstacleMetadata(obstacles, includePickups, includeClosePickups);
    obstacleBuildCache.set(cacheKey, obstacles);
    if (obstacleBuildCache.size > OBSTACLE_BUILD_CACHE_LIMIT) {
      const oldestKey = obstacleBuildCache.keys().next().value;
      if (oldestKey != null) obstacleBuildCache.delete(oldestKey);
    }
    finishPathProfilerMetric(
      "buildCatObstacles",
      startedAt,
      {
        cached: false,
        includePickups: !!includePickups,
        includeClosePickups: !!includeClosePickups,
        obstacleCount: obstacles.length,
      },
      2.5
    );
    return obstacles;
  }

  function buildStaticSourceObstacles() {
    if (staticSourceObstaclesCache) return staticSourceObstaclesCache;
    const obstacles = buildSpecialRoomObstacles();
    for (const obs of EXTRA_NAV_OBSTACLES) {
      if (!obs) continue;
      if (obs.kind === "circle") {
        obstacles.push(applyOptionalObstacleMeta(makeObstacle({
          kind: "circle",
          mode: obs.mode || "hard",
          x: obs.x,
          z: obs.z,
          r: obs.r,
          navPad: obs.navPad || 0,
          steerPad: obs.steerPad,
          collisionPad: obs.collisionPad,
          y: obs.y,
          h: obs.h,
        }), obs));
      } else if (obs.kind === "obb") {
        obstacles.push(applyOptionalObstacleMeta(makeObstacle({
          kind: "obb",
          mode: obs.mode || "hard",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          navPad: obs.navPad || 0,
          steerPad: obs.steerPad,
          collisionPad: obs.collisionPad,
          yaw: obs.yaw || 0,
          y: obs.y,
          h: obs.h,
        }), obs));
      } else {
        obstacles.push(applyOptionalObstacleMeta(makeObstacle({
          kind: "box",
          mode: obs.mode || "hard",
          x: obs.x,
          z: obs.z,
          hx: obs.hx,
          hz: obs.hz,
          navPad: obs.navPad || 0,
          steerPad: obs.steerPad,
          collisionPad: obs.collisionPad,
          y: obs.y,
          h: obs.h,
        }), obs));
      }
    }
    staticSourceObstaclesCache = attachObstacleMetadata(obstacles, false, false);
    return staticSourceObstaclesCache;
  }

  function buildRecastSourceObstacleSet(obstacles) {
    if (!Array.isArray(obstacles) || !obstacles.length) return buildStaticSourceObstacles();
    const source = [];
    for (const obs of obstacles) {
      if (!obs) continue;
      if (obs.pickupKey || String(obs.tag || "").startsWith("pickup-")) continue;
      if (obs.blocksPath === false) continue;
      source.push(obs);
    }
    return source.length ? source : buildStaticSourceObstacles();
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

  function isCatPointBlocked(x, z, obstacles, clearance = null, queryY = 0, stage = "plan", pathOptions = null) {
    const navClearance = resolvePathClearance(clearance);
    if (!pointRespectsPathSupportSurface(x, z, navClearance, pathOptions)) return true;
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
      if (!obstacleBlocksAtStage(obs, stage)) continue;
      if (!obstacleOverlapsQueryY(obs, queryY)) continue;
      if (obs.tag === "cup" && (cat.state === "toCup" || cat.state === "swipe")) continue;
      const dx = x - obs.x;
      const dz = z - obs.z;
      const obstacleClearance = navClearance + getObstaclePad(obs, stage);
      if (obs.kind === "box") {
        if (Math.abs(dx) <= obs.hx + obstacleClearance && Math.abs(dz) <= obs.hz + obstacleClearance) return true;
        continue;
      }
      if (obs.kind === "obb") {
        const c = Math.cos(obs.yaw);
        const s = Math.sin(obs.yaw);
        const lx = c * dx + s * dz;
        const lz = -s * dx + c * dz;
        if (Math.abs(lx) <= obs.hx + obstacleClearance && Math.abs(lz) <= obs.hz + obstacleClearance) return true;
        continue;
      }
      const rr = obs.r + obstacleClearance;
      if (dx * dx + dz * dz <= rr * rr) return true;
    }
    return false;
  }

  function getCatPathClearance() {
    // Keep nav/path radius aligned with cat body and add a tiny safety epsilon
    // so planned paths don't hug obstacles tighter than runtime movement checks.
    return Math.max(0.01, CAT_COLLISION.catBodyRadius + (CAT_PATH_CLEARANCE_EPSILON || 0));
  }

  function resolvePathClearance(clearance = null) {
    return Number.isFinite(clearance) ? Math.max(0, clearance) : getCatPathClearance();
  }

  function shouldAllowFallbackPlanner(allowFallback = null) {
    return false;
  }

  function hasClearTravelLine(a, b, obstacles, clearance = null, queryY = 0, stage = "plan", pathOptions = null) {
    const navClearance = resolvePathClearance(clearance);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const probeStride = Math.min(0.14, Math.max(0.08, navClearance * 0.55));
    const samples = Math.max(2, Math.ceil(dist / probeStride));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      if (isCatPointBlocked(x, z, obstacles, navClearance, queryY, stage, pathOptions)) return false;
    }
    return true;
  }

  function smoothCatPath(path, obstacles, clearance = null, queryY = 0, pathOptions = null) {
    const navClearance = resolvePathClearance(clearance);
    if (path.length <= 2) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1) {
        if (hasClearTravelLine(path[i], path[j], obstacles, navClearance, queryY, "plan", pathOptions)) break;
        j--;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  function materializePathWithEndpoints(corePath, startOnPlane, freeStart, goalOnPlane, freeGoal, obstacles, clearance, queryY = 0, pathOptions = null) {
    if (!Array.isArray(corePath) || corePath.length < 2) return [];
    const navClearance = resolvePathClearance(clearance);
    const path = [startOnPlane.clone()];
    const startSnapDist2 = freeStart.distanceToSquared(startOnPlane);
    const goalSnapDist2 = freeGoal.distanceToSquared(goalOnPlane);
    const startSnapEps2 = 0.0004;
    const goalSnapEps2 = 0.0004;

    let coreStartIndex = 1;
    if (startSnapDist2 > startSnapEps2) {
      const nextCore = corePath.length > 1 ? corePath[1] : freeGoal;
      if (!hasClearTravelLine(startOnPlane, nextCore, obstacles, navClearance, queryY, "plan", pathOptions)) {
        path.push(freeStart.clone());
      }
    }

    for (let i = coreStartIndex; i < corePath.length - 1; i++) {
      path.push(corePath[i].clone());
    }

    const prevToGoal = path[path.length - 1];
    if (
      goalSnapDist2 <= goalSnapEps2 ||
      hasClearTravelLine(prevToGoal, goalOnPlane, obstacles, navClearance, queryY, "plan", pathOptions)
    ) {
      path.push(goalOnPlane.clone());
    } else {
      path.push(freeGoal.clone());
    }

    const deduped = [];
    for (const point of path) {
      const last = deduped[deduped.length - 1];
      if (last && last.distanceToSquared(point) <= 1e-6) continue;
      deduped.push(point);
    }
    return deduped;
  }

  function obstacleBlocksPoint(obs, x, z, clearance, queryY = 0, stage = "plan") {
    if (!obstacleBlocksAtStage(obs, stage)) return false;
    if (!obstacleOverlapsQueryY(obs, queryY)) return false;
    if (obs.tag === "cup" && (cat.state === "toCup" || cat.state === "swipe")) return false;
    const dx = x - obs.x;
    const dz = z - obs.z;
    const obstacleClearance = clearance + getObstaclePad(obs, stage);
    if (obs.kind === "circle") {
      const rr = (obs.r || 0) + obstacleClearance;
      return dx * dx + dz * dz <= rr * rr;
    }
    if (obs.kind === "obb") {
      const c = Math.cos(obs.yaw || 0);
      const s = Math.sin(obs.yaw || 0);
      const lx = c * dx + s * dz;
      const lz = -s * dx + c * dz;
      return Math.abs(lx) <= (obs.hx + obstacleClearance) && Math.abs(lz) <= (obs.hz + obstacleClearance);
    }
    return Math.abs(dx) <= (obs.hx + obstacleClearance) && Math.abs(dz) <= (obs.hz + obstacleClearance);
  }

  function collectPointBlockingObstacles(x, z, obstacles, clearance, queryY = 0, stage = "plan") {
    if (!Array.isArray(obstacles) || !obstacles.length) return [];
    const out = [];
    for (const obs of obstacles) {
      if (!obs) continue;
      if (obstacleBlocksPoint(obs, x, z, clearance, queryY, stage)) out.push(obs);
    }
    return out;
  }

  function obstacleAllowsStartOverlapEscape(obs) {
    if (!obs) return false;
    if (obs.pickupKey || obs.pushable) return true;
    if (String(obs.tag || "").startsWith("pickup-")) return true;
    if (String(obs.mode || "") === "soft") return true;
    return obs.blocksRuntime === false && obs.blocksPath !== false;
  }

  function buildStartOverlapEscapeObstacles(point, obstacles, clearance, queryY = 0) {
    if (!Array.isArray(obstacles) || !obstacles.length || !point) return null;
    const blockers = collectPointBlockingObstacles(point.x, point.z, obstacles, clearance, queryY, "plan");
    if (!blockers.length) return null;
    const ignoredBlockers = blockers.filter((obs) => obstacleAllowsStartOverlapEscape(obs));
    if (!ignoredBlockers.length) return null;
    const skipped = new Set(ignoredBlockers);
    const filtered = obstacles.filter((obs) => !skipped.has(obs));
    if (filtered.length === obstacles.length) return null;
    attachObstacleMetadata(filtered, !!obstacles._includePickups, !!obstacles._includeClosePickups);
    filtered._filteredFromSignature = obstacles._dynamicSignature || "";
    return {
      obstacles: filtered,
      blockerLabels: ignoredBlockers.map((obs) => String(obs.pickupKey || obs.tag || obs.kind || "unknown")),
    };
  }

  function buildStartRuntimeAlignedObstacles(point, obstacles, clearance, queryY = 0) {
    if (!Array.isArray(obstacles) || !obstacles.length || !point) return null;
    const blockers = collectPointBlockingObstacles(point.x, point.z, obstacles, clearance, queryY, "plan");
    if (!blockers.length) return null;
    const ignoredBlockers = blockers.filter((obs) =>
      obstacleAllowsStartOverlapEscape(obs) &&
      !obstacleBlocksPoint(obs, point.x, point.z, clearance, queryY, "runtime")
    );
    if (!ignoredBlockers.length) return null;
    const skipped = new Set(ignoredBlockers);
    const filtered = obstacles.filter((obs) => !skipped.has(obs));
    if (filtered.length === obstacles.length) return null;
    attachObstacleMetadata(filtered, !!obstacles._includePickups, !!obstacles._includeClosePickups);
    filtered._filteredFromSignature = obstacles._dynamicSignature || "";
    return {
      obstacles: filtered,
      blockerLabels: ignoredBlockers.map((obs) => String(obs.pickupKey || obs.tag || obs.kind || "unknown")),
    };
  }

  function summarizePathBlockingObstacle(obs, extra = null) {
    if (!obs) return null;
    const label =
      obs.pickupKey ||
      obs.tag ||
      (obs.kind === "circle" ? "circle" : obs.kind === "obb" ? "obb" : "box");
    return {
      obstacleLabel: String(label || "unknown"),
      obstacleKind: String(obs.kind || "unknown"),
      obstacleMode: String(obs.mode || "unknown"),
      obstacleSurfaceId: obs.surfaceId != null ? String(obs.surfaceId) : "",
      obstacleX: Number.isFinite(obs.x) ? obs.x : 0,
      obstacleZ: Number.isFinite(obs.z) ? obs.z : 0,
      obstaclePickup: !!obs.pickupKey,
      ...(extra && typeof extra === "object" ? extra : {}),
    };
  }

  function summarizeRecastSourceObstacle(obs) {
    if (!obs) return null;
    return {
      label: String(obs.pickupKey || obs.tag || (obs.kind === "circle" ? "circle" : obs.kind === "obb" ? "obb" : "box") || "unknown"),
      kind: String(obs.kind || "unknown"),
      mode: String(obs.mode || "unknown"),
      x: Number.isFinite(obs.x) ? obs.x : NaN,
      z: Number.isFinite(obs.z) ? obs.z : NaN,
      pickup: !!obs.pickupKey,
    };
  }

  function summarizeRecastDynamicSpec(spec) {
    if (!spec) return null;
    return {
      label: String(spec.key || "unknown"),
      kind: String(spec.kind || "unknown"),
      mode: String(spec.mode || "unknown"),
      x: Number.isFinite(spec.x) ? spec.x : NaN,
      z: Number.isFinite(spec.z) ? spec.z : NaN,
      pickup: String(spec.key || "") !== "cup",
    };
  }

  function doesBlockingDetailMatchRef(detail, ref) {
    if (!detail || !ref) return false;
    const labelA = String(detail.obstacleLabel || "");
    const labelB = String(ref.label || "");
    if (labelA && labelB && labelA !== labelB) return false;
    const dist = Math.hypot((Number(ref.x) || 0) - (Number(detail.obstacleX) || 0), (Number(ref.z) || 0) - (Number(detail.obstacleZ) || 0));
    return dist <= 0.18;
  }

  function findMatchingSolveInputRef(detail, refs) {
    if (!detail || !Array.isArray(refs) || !refs.length) return null;
    for (const ref of refs) {
      if (doesBlockingDetailMatchRef(detail, ref)) return ref;
    }
    return null;
  }

  function formatSolveInputPresence(detail, entry, prefix = "solve") {
    const head = prefix ? `${prefix}=` : "";
    const srcRefs = Array.isArray(entry?.debugSourceObstacleRefs) ? entry.debugSourceObstacleRefs : [];
    const dynRefs = Array.isArray(entry?.debugDynamicSpecRefs) ? entry.debugDynamicSpecRefs : [];
    const srcMatch = findMatchingSolveInputRef(detail, srcRefs);
    const dynMatch = findMatchingSolveInputRef(detail, dynRefs);
    const includePickups = entry?.debugIncludePickups ? 1 : 0;
    return `${head}p${includePickups}/src${srcRefs.length}:${srcMatch ? "yes" : "no"}/dyn${dynRefs.length}:${dynMatch ? "yes" : "no"}`;
  }


  function computeObstacleHitMetrics(obs, x, z, clearance, stage = "plan") {
    if (!obs) return null;
    const dx = x - obs.x;
    const dz = z - obs.z;
    const stagePad = getObstaclePad(obs, stage);
    const inflatedPad = Math.max(0, clearance) + stagePad;
    if (obs.kind === "circle") {
      const rawR = Math.max(0, obs.r || 0);
      const dist2 = dx * dx + dz * dz;
      return {
        rawInside: dist2 <= rawR * rawR,
        inflatedInside: dist2 <= (rawR + inflatedPad) * (rawR + inflatedPad),
        centerX: Number.isFinite(obs.x) ? obs.x : NaN,
        centerZ: Number.isFinite(obs.z) ? obs.z : NaN,
        rawA: rawR,
        rawB: rawR,
        inflatedPad,
        localX: dx,
        localZ: dz,
      };
    }
    let lx = dx;
    let lz = dz;
    if (obs.kind === "obb") {
      const c = Math.cos(obs.yaw || 0);
      const s = Math.sin(obs.yaw || 0);
      lx = c * dx + s * dz;
      lz = -s * dx + c * dz;
    }
    const rawA = Math.max(0, obs.hx || 0);
    const rawB = Math.max(0, obs.hz || 0);
    return {
      rawInside: Math.abs(lx) <= rawA && Math.abs(lz) <= rawB,
      inflatedInside: Math.abs(lx) <= rawA + inflatedPad && Math.abs(lz) <= rawB + inflatedPad,
      centerX: Number.isFinite(obs.x) ? obs.x : NaN,
      centerZ: Number.isFinite(obs.z) ? obs.z : NaN,
      rawA,
      rawB,
      inflatedPad,
      localX: lx,
      localZ: lz,
    };
  }

  function findPointBlockingDetail(x, z, obstacles, clearance, queryY = 0, stage = "plan", pathOptions = null) {
    if (!pointRespectsPathSupportSurface(x, z, clearance, pathOptions)) {
      return {
        obstacleLabel: "support-surface",
        obstacleKind: "surface-boundary",
        obstacleMode: "support",
        obstacleSurfaceId: resolvePathSupportSurfaceId(pathOptions),
        obstacleX: x,
        obstacleZ: z,
        obstaclePickup: false,
      };
    }
    if (!Array.isArray(obstacles) || !obstacles.length) return null;
    for (const obs of obstacles) {
      if (!obstacleBlocksPoint(obs, x, z, clearance, queryY, stage)) continue;
      return summarizePathBlockingObstacle(obs, computeObstacleHitMetrics(obs, x, z, clearance, stage));
    }
    return null;
  }

  function analyzeTraversabilityFailure(path, obstacles, clearance = null, queryY = 0, stage = "plan", pathOptions = null) {
    const navClearance = resolvePathClearance(clearance);
    if (!Array.isArray(path) || path.length < 2) return null;
    for (let segIndex = 1; segIndex < path.length; segIndex++) {
      const a = path[segIndex - 1];
      const b = path[segIndex];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.001) continue;
      const probeStride = Math.min(0.14, Math.max(0.08, navClearance * 0.55));
      const samples = Math.max(2, Math.ceil(dist / probeStride));
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const x = a.x + dx * t;
        const z = a.z + dz * t;
        const detail = findPointBlockingDetail(x, z, obstacles, navClearance, queryY, stage, pathOptions);
        if (!detail) continue;
        return {
          segmentIndex: segIndex,
          sampleIndex: i,
          sampleCount: samples,
          sampleT: t,
          sampleX: x,
          sampleZ: z,
          fromX: a.x,
          fromZ: a.z,
          toX: b.x,
          toZ: b.z,
          ...detail,
        };
      }
    }
    return null;
  }

  function formatTraversabilityFailure(detail, prefix = "") {
    if (!detail || typeof detail !== "object") return "";
    const head = prefix ? `${prefix}=` : "";
    const label = detail.obstacleLabel || detail.obstacleKind || "unknown";
    const kind = detail.obstacleKind || "unknown";
    const mode = detail.obstacleMode || "unknown";
    const seg = Number.isFinite(detail.segmentIndex) ? detail.segmentIndex : -1;
    const posX = Number.isFinite(detail.sampleX) ? detail.sampleX.toFixed(2) : "na";
    const posZ = Number.isFinite(detail.sampleZ) ? detail.sampleZ.toFixed(2) : "na";
    const rawInside = detail.rawInside === true ? 1 : 0;
    const inflInside = detail.inflatedInside === true ? 1 : 0;
    const localX = Number.isFinite(detail.localX) ? detail.localX.toFixed(2) : "na";
    const localZ = Number.isFinite(detail.localZ) ? detail.localZ.toFixed(2) : "na";
    const rawA = Number.isFinite(detail.rawA) ? detail.rawA.toFixed(2) : "na";
    const rawB = Number.isFinite(detail.rawB) ? detail.rawB.toFixed(2) : "na";
    const pad = Number.isFinite(detail.inflatedPad) ? detail.inflatedPad.toFixed(2) : "na";
    return `${head}${label}/${kind}/${mode}@seg${seg}:${posX},${posZ}[r${rawInside}/i${inflInside} l=${localX},${localZ} e=${rawA},${rawB} p=${pad}]`;
  }

  function formatProjectionDetail(detail, prefix = "") {
    if (!detail || typeof detail !== "object") return "";
    const head = prefix ? `${prefix}=` : "";
    const fromX = Number.isFinite(detail.fromX) ? detail.fromX.toFixed(2) : "na";
    const fromZ = Number.isFinite(detail.fromZ) ? detail.fromZ.toFixed(2) : "na";
    const finalToX = Number.isFinite(detail.toX) ? detail.toX.toFixed(2) : "na";
    const toZ = Number.isFinite(detail.toZ) ? detail.toZ.toFixed(2) : "na";
    const dist = Number.isFinite(detail.snapDistance) ? detail.snapDistance.toFixed(3) : "na";
    const status = detail.joinClear ? "clear" : "blocked";
    const block = detail.blockDetail ? ` ${formatTraversabilityFailure(detail.blockDetail)}` : "";
    return `${head}${status}@${fromX},${fromZ}->${finalToX},${toZ} d=${dist}${block}`;
  }

  function formatPointBlockDetail(detail, prefix = "") {
    const head = prefix ? `${prefix}=` : "";
    if (!detail || typeof detail !== "object") return `${head}none`;
    const label = detail.obstacleLabel || detail.obstacleKind || "unknown";
    const kind = detail.obstacleKind || "unknown";
    const mode = detail.obstacleMode || "unknown";
    const x = Number.isFinite(detail.obstacleX) ? detail.obstacleX.toFixed(2) : "na";
    const z = Number.isFinite(detail.obstacleZ) ? detail.obstacleZ.toFixed(2) : "na";
    return `${head}${label}/${kind}/${mode}@${x},${z}`;
  }

  function formatVec2Inline(point) {
    if (!point) return "na,na";
    const x = Number.isFinite(point.x) ? point.x.toFixed(2) : "na";
    const z = Number.isFinite(point.z) ? point.z.toFixed(2) : "na";
    return `${x},${z}`;
  }

  function formatPathPreview(path, prefix = "") {
    const head = prefix ? `${prefix}=` : "";
    if (!Array.isArray(path) || !path.length) return `${head}none`;
    const pts = path.slice(0, 4).map((p) => formatVec2Inline(p)).join(">");
    const suffix = path.length > 4 ? ">..." : "";
    return `${head}n${path.length}:${pts}${suffix}`;
  }

  function formatFirstSegment(path, prefix = "") {
    const head = prefix ? `${prefix}=` : "";
    if (!Array.isArray(path) || path.length < 2) return `${head}none`;
    return `${head}${formatVec2Inline(path[0])}->${formatVec2Inline(path[1])}`;
  }

  function probeNavPoint(entry, point, planY, isGroundPlan = false) {
    if (!entry?.navQuery || !point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
    const halfExtents = { x: 0.06, y: isGroundPlan ? 0.24 : 0.32, z: 0.06 };
    const fallbackHalfExtents = { x: 0.18, y: isGroundPlan ? 0.48 : 0.72, z: 0.18 };
    const sample = entry.navQuery.findClosestPoint(
      { x: point.x, y: planY, z: point.z },
      { halfExtents }
    );
    const use = sample?.success ? sample : entry.navQuery.findClosestPoint(
      { x: point.x, y: planY, z: point.z },
      { halfExtents: fallbackHalfExtents }
    );
    if (!use?.success || !use.point) return { status: "none", distance: NaN, x: NaN, z: NaN };
    const dx = (use.point.x || 0) - point.x;
    const dz = (use.point.z || 0) - point.z;
    const dist = Math.hypot(dx, dz);
    return {
      status: dist <= 0.03 ? "walk" : "snap",
      distance: dist,
      x: use.point.x,
      z: use.point.z,
    };
  }

  function formatNavProbe(detail, prefix = "") {
    const head = prefix ? `${prefix}=` : "";
    if (!detail || typeof detail !== "object") return `${head}none`;
    const status = detail.status || "none";
    const x = Number.isFinite(detail.x) ? detail.x.toFixed(2) : "na";
    const z = Number.isFinite(detail.z) ? detail.z.toFixed(2) : "na";
    const dist = Number.isFinite(detail.distance) ? detail.distance.toFixed(3) : "na";
    return `${head}${status}@${x},${z} d=${dist}`;
  }

  function filterEndpointPushableGoalObstacles(point, obstacles, clearance, queryY = 0, stage = "plan") {
    if (!point || !Array.isArray(obstacles) || !obstacles.length) return obstacles;
    const endpointPushables = [];
    for (const obs of obstacles) {
      if (!obstacleBlocksPoint(obs, point.x, point.z, clearance, queryY, stage)) continue;
      if (obs?.pushable && (obs.pickupKey || String(obs.tag || "").startsWith("pickup-"))) {
        endpointPushables.push(obs);
        continue;
      }
      return obstacles;
    }
    if (!endpointPushables.length) return obstacles;
    const filtered = obstacles.filter((obs) => !endpointPushables.includes(obs));
    if (filtered.length === obstacles.length) return obstacles;
    attachObstacleMetadata(filtered, !!obstacles._includePickups, !!obstacles._includeClosePickups);
    filtered._filteredFromSignature = obstacles._dynamicSignature || "";
    return filtered;
  }


  function resolveNearestPlanarPathTarget(target, obstacles, clearance = null, queryY = 0, pathOptions = null, origin = null) {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return target;
    const navClearance = resolvePathClearance(clearance);
    const planY = Number.isFinite(queryY)
      ? queryY
      : (Number.isFinite(target?.y) ? target.y : 0);
    const includePickups = !!obstacles?._includePickups;
    const entry = buildRecastNavEntry(obstacles, includePickups, navClearance, pathOptions);
    const isGroundPlan = planY <= 0.08;
    const queryHalfExtents = { x: 2.5, y: isGroundPlan ? 0.24 : 0.32, z: 2.5 };
    const relaxedHalfExtents = { x: 2.5, y: isGroundPlan ? 0.48 : 0.72, z: 2.5 };
    const maxSnapDy = isGroundPlan ? 0.22 : 0.3;
    const acceptPoint = (p) => p && Number.isFinite(p.y) && Math.abs(p.y - planY) <= maxSnapDy;
    const sampleClosest = (x, z, halfExtents) =>
      entry?.navQuery?.findClosestPoint(
        { x, y: planY, z },
        { halfExtents }
      );
    const resolveClosestNavPoint = (point) => {
      if (!entry?.navQuery || !point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
      const base = sampleClosest(point.x, point.z, queryHalfExtents);
      if (base?.success && acceptPoint(base.point)) return base.point;
      const relaxed = sampleClosest(point.x, point.z, relaxedHalfExtents);
      if (relaxed?.success && acceptPoint(relaxed.point)) return relaxed.point;
      const searchRadii = [0.08, 0.16, 0.26];
      for (const radius of searchRadii) {
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const sx = point.x + Math.cos(ang) * radius;
          const sz = point.z + Math.sin(ang) * radius;
          const ringBase = sampleClosest(sx, sz, queryHalfExtents);
          if (ringBase?.success && acceptPoint(ringBase.point)) return ringBase.point;
          const ringRelaxed = sampleClosest(sx, sz, relaxedHalfExtents);
          if (ringRelaxed?.success && acceptPoint(ringRelaxed.point)) return ringRelaxed.point;
        }
      }
      return null;
    };
    const validateCandidate = (x, z) => {
      if (isCatPointBlocked(x, z, obstacles, navClearance, planY, "plan", pathOptions)) return null;
      const point = new THREE.Vector3(x, planY, z);
      const onNav = resolveClosestNavPoint(point);
      if (!onNav) return null;
      if (isCatPointBlocked(onNav.x, onNav.z, obstacles, navClearance, planY, "plan", pathOptions)) return null;
      const navPoint = new THREE.Vector3(onNav.x, Number.isFinite(onNav.y) ? onNav.y : planY, onNav.z);
      if (!hasClearTravelLine(navPoint, point, obstacles, navClearance, planY, "plan", pathOptions)) return null;
      const joinDistance = Math.hypot(navPoint.x - point.x, navPoint.z - point.z);
      const originDistance = origin && Number.isFinite(origin.x) && Number.isFinite(origin.z)
        ? Math.hypot(x - origin.x, z - origin.z)
        : 0;
      return { point, navPoint, joinDistance, originDistance };
    };

    const direct = validateCandidate(target.x, target.z);
    if (direct) return target;

    let best = null;
    let bestScore = Infinity;
    const baseYaw = origin && Number.isFinite(origin.x) && Number.isFinite(origin.z)
      ? Math.atan2(target.x - origin.x, target.z - origin.z)
      : 0;
    const radii = [0.04, 0.08, 0.12, 0.18, 0.26, 0.36, 0.48, 0.62, 0.78, 0.96, 1.16];
    for (const radius of radii) {
      const steps = Math.max(16, Math.ceil((Math.PI * 2 * Math.max(radius, 0.06)) / 0.08));
      for (let i = 0; i < steps; i++) {
        const yaw = baseYaw + (i / steps) * Math.PI * 2;
        const x = target.x + Math.sin(yaw) * radius;
        const z = target.z + Math.cos(yaw) * radius;
        const candidate = validateCandidate(x, z);
        if (!candidate) continue;
        const score =
          radius * 1.0 +
          candidate.joinDistance * 0.6 +
          candidate.originDistance * 0.03;
        if (score < bestScore) {
          bestScore = score;
          best = candidate.point;
        }
      }
      if (best) break;
    }
    return best || target;
  }

  function findFirstBlockingObstacleOnLine(a, b, obstacles, clearance, queryY = 0, stage = "plan") {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return null;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const probeStride = Math.min(0.12, Math.max(0.07, clearance * 0.5));
    const samples = Math.max(2, Math.ceil(dist / probeStride));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const sx = a.x + dx * t;
      const sz = a.z + dz * t;
      for (const obs of obstacles) {
        if (!obstacleBlocksPoint(obs, sx, sz, clearance, queryY, stage)) continue;
        return { obs, sampleX: sx, sampleZ: sz, dirX, dirZ };
      }
    }
    return null;
  }

  function buildGroundDetourCandidates(hit, clearance, queryY = 0) {
    if (!hit?.obs) return [];
    const obs = hit.obs;
    const pad = clearance + (obs.pushable ? 0.2 : 0.12);
    const out = [];
    const pushCandidate = (x, z) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      if (isCatPointBlocked(x, z, [obs], clearance * 0.96, queryY)) return;
      out.push(new THREE.Vector3(x, queryY, z));
    };

    if (obs.kind === "circle") {
      const base = Math.atan2(hit.dirZ, hit.dirX);
      const radius = (obs.r || 0.1) + pad;
      const offsets = [Math.PI * 0.5, -Math.PI * 0.5, Math.PI * 0.32, -Math.PI * 0.32, Math.PI * 0.68, -Math.PI * 0.68];
      for (const off of offsets) {
        const ang = base + off;
        pushCandidate(obs.x + Math.cos(ang) * radius, obs.z + Math.sin(ang) * radius);
      }
      return out;
    }

    const localPoints = [];
    const ex = (obs.hx || 0.1) + pad;
    const ez = (obs.hz || 0.1) + pad;
    localPoints.push([ ex, 0], [-ex, 0], [0, ez], [0, -ez], [ ex, ez], [ ex, -ez], [-ex, ez], [-ex, -ez]);
    if (obs.kind === "obb") {
      const c = Math.cos(obs.yaw || 0);
      const s = Math.sin(obs.yaw || 0);
      for (const [lx, lz] of localPoints) {
        const wx = obs.x + c * lx - s * lz;
        const wz = obs.z + s * lx + c * lz;
        pushCandidate(wx, wz);
      }
      return out;
    }
    for (const [lx, lz] of localPoints) {
      pushCandidate(obs.x + lx, obs.z + lz);
    }
    return out;
  }

  function hasGroundPathNoFallback(start, goal, obstacles, clearance) {
    if (hasClearTravelLine(start, goal, obstacles, clearance, 0)) return true;
    const path = computeCatPath(start, goal, obstacles, 0, false, false, { clearanceOverride: clearance });
    return isPathTraversable(path, obstacles, clearance, 0);
  }

  function joinPathSegments(first, second) {
    const out = [];
    const append = (segment) => {
      if (!Array.isArray(segment) || !segment.length) return;
      for (const point of segment) {
        const last = out[out.length - 1];
        if (last && last.distanceToSquared(point) <= 1e-6) continue;
        out.push(point.clone());
      }
    };
    append(first);
    append(second);
    return out;
  }

  function joinPathSegmentList(segments) {
    const out = [];
    for (const segment of segments) {
      if (!Array.isArray(segment) || !segment.length) continue;
      for (const point of segment) {
        const last = out[out.length - 1];
        if (last && last.distanceToSquared(point) <= 1e-6) continue;
        out.push(point.clone());
      }
    }
    return out;
  }

  function buildNoFallbackLegPath(startOnPlane, goalOnPlane, obstacles, clearance, queryY = 0, options = null, pathOptions = null) {
    const freeStart = findNearestWalkablePoint(startOnPlane, obstacles, clearance, queryY, pathOptions);
    const freeGoal = findNearestWalkablePoint(goalOnPlane, obstacles, clearance, queryY, pathOptions);
    if (!freeStart || !freeGoal) return [];
    const opts = options && typeof options === "object" ? options : null;
    const maxGoalSnap = Number.isFinite(opts?.maxGoalSnap)
      ? Math.max(0.1, Number(opts.maxGoalSnap))
      : Math.max(0.16, CAT_NAV.step * 1.25, clearance * 1.9);
    if (freeGoal.distanceToSquared(goalOnPlane) > maxGoalSnap * maxGoalSnap) return [];
    if (freeStart.distanceToSquared(freeGoal) < 0.1 * 0.1) {
      const snappedPath = materializePathWithEndpoints(
        [freeStart.clone(), freeGoal.clone()],
        startOnPlane,
        freeStart,
        goalOnPlane,
        freeGoal,
        obstacles,
        clearance,
        queryY,
        pathOptions
      );
      return isPathTraversable(snappedPath, obstacles, clearance, queryY, "plan", pathOptions)
        ? snappedPath
        : [];
    }
    if (hasClearTravelLine(freeStart, freeGoal, obstacles, clearance, queryY, "plan", pathOptions)) {
      return materializePathWithEndpoints(
        [freeStart.clone(), freeGoal.clone()],
        startOnPlane,
        freeStart,
        goalOnPlane,
        freeGoal,
        obstacles,
        clearance,
        queryY,
        pathOptions
      );
    }
    const recastPath = computeRecastPath(freeStart, freeGoal, obstacles, clearance, queryY, pathOptions);
    if (!Array.isArray(recastPath) || recastPath.length < 2) return [];
    const corePath = recastPath.map((p) => p.clone());
    corePath[0].copy(freeStart);
    corePath[corePath.length - 1].copy(freeGoal);
    return materializePathWithEndpoints(
      corePath,
      startOnPlane,
      freeStart,
      goalOnPlane,
      freeGoal,
      obstacles,
      clearance,
      queryY,
      pathOptions
    );
  }

  function buildNoFallbackObstacleDetourPath(startOnPlane, goalOnPlane, obstacles, clearance, queryY = 0, debugMeta = null, pathOptions = null) {
    const quantizeKey = (point) => `${Math.round((point?.x || 0) / 0.08)}:${Math.round((point?.z || 0) / 0.08)}:${Math.round((queryY || 0) / 0.06)}`;
    const maxDetourDepth = 5;
    const maxNodeExpansions = 44;
    const maxCandidatesPerExpansion = 12;
    const legCache = new Map();
    let candidateCount = 0;
    let legMisses = 0;
    let bestDepth = 0;
    const buildLegCached = (from, to) => {
      const key = `${quantizeKey(from)}>${quantizeKey(to)}`;
      if (legCache.has(key)) {
        return legCache.get(key).map((p) => p.clone());
      }
      const built = buildNoFallbackLegPath(from, to, obstacles, clearance, queryY, {
        maxGoalSnap: Math.max(0.44, CAT_NAV.step * 2.1, clearance * 2.8),
      }, pathOptions);
      legCache.set(key, Array.isArray(built) ? built.map((p) => p.clone()) : []);
      return built;
    };

    const open = [{
      point: startOnPlane.clone(),
      segments: [],
      cost: 0,
      depth: 0,
      visited: new Set([quantizeKey(startOnPlane)]),
    }];
    let bestPath = [];
    let bestScore = Infinity;
    let expansions = 0;

    while (open.length && expansions < maxNodeExpansions) {
      open.sort((a, b) => {
        const scoreA = a.cost + a.point.distanceTo(goalOnPlane);
        const scoreB = b.cost + b.point.distanceTo(goalOnPlane);
        return scoreA - scoreB;
      });
      const current = open.shift();
      if (!current) break;
      expansions += 1;

      const finalLeg = buildLegCached(current.point, goalOnPlane);
      if (finalLeg.length >= 2) {
        const fullPath = joinPathSegmentList([...current.segments, finalLeg]);
        if (isPathTraversable(fullPath, obstacles, clearance, queryY, "plan", pathOptions)) {
          const score = current.cost + catPathDistance(finalLeg);
          if (score < bestScore) {
            bestScore = score;
            bestPath = fullPath;
            bestDepth = current.depth;
          }
        }
        continue;
      }

      if (current.depth >= maxDetourDepth) continue;
      const blocker = findFirstBlockingObstacleOnLine(current.point, goalOnPlane, obstacles, clearance, queryY);
      if (!blocker) continue;
      const candidates = buildGroundDetourCandidates(blocker, clearance, queryY)
        .filter((via) => !isCatPointBlocked(via.x, via.z, obstacles, clearance, queryY, "plan", pathOptions))
        .sort((a, b) => {
          const scoreA = current.point.distanceTo(a) + a.distanceTo(goalOnPlane);
          const scoreB = current.point.distanceTo(b) + b.distanceTo(goalOnPlane);
          return scoreA - scoreB;
        })
        .slice(0, maxCandidatesPerExpansion);
      candidateCount += candidates.length;

      for (const via of candidates) {
        const viaKey = quantizeKey(via);
        if (current.visited.has(viaKey)) continue;
        const leg = buildLegCached(current.point, via);
        if (leg.length < 2) {
          legMisses += 1;
          continue;
        }
        const nextCost = current.cost + catPathDistance(leg);
        if (nextCost >= bestScore) continue;
        const nextVisited = new Set(current.visited);
        nextVisited.add(viaKey);
        open.push({
          point: via.clone(),
          segments: [...current.segments, leg.map((p) => p.clone())],
          cost: nextCost,
          depth: current.depth + 1,
          visited: nextVisited,
        });
      }
    }

    if (debugMeta && typeof debugMeta === "object") {
      debugMeta.detourExpansions = expansions;
      debugMeta.detourCandidates = candidateCount;
      debugMeta.detourLegMisses = legMisses;
      debugMeta.detourBestDepth = bestDepth;
      debugMeta.detourFound = bestPath.length >= 2;
    }

    return bestPath;
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

  function buildRecastSourceMeshes(obstacles, clearance = null, pathOptions = null) {
    const meshes = [];
    const supportSurfaceId = resolvePathSupportSurfaceId(pathOptions);
    const walkableSurfaces = supportSurfaceId
      ? getWalkableSurfaces().filter((surface) => String(surface?.id || "") === supportSurfaceId)
      : getWalkableSurfaces();
    for (const surface of walkableSurfaces) {
      let geometry = null;
      if (surface.shape === "circle") {
        const radius = Math.max(0.05, Number(surface.radius) || 0.05);
        geometry = new THREE.CylinderGeometry(radius, radius, WALKABLE_SURFACE_THICKNESS, 24);
      } else {
        const hx = Math.max(0.05, Number(surface.halfExtents?.hx) || 0.05);
        const hz = Math.max(0.05, Number(surface.halfExtents?.hz) || 0.05);
        geometry = new THREE.BoxGeometry(hx * 2, WALKABLE_SURFACE_THICKNESS, hz * 2);
      }
      const topMesh = new THREE.Mesh(geometry);
      topMesh.position.set(
        surface.center.x,
        surface.y - WALKABLE_SURFACE_THICKNESS * 0.5 + WALKABLE_SURFACE_LIFT,
        surface.center.z
      );
      if (surface.shape === "obb") {
        topMesh.rotation.y = Number(surface.yaw) || 0;
      }
      topMesh.updateMatrixWorld(true);
      meshes.push(topMesh);
    }
    const recastClearance = Math.max(0, resolvePathClearance(clearance));
    for (const obs of obstacles) {
      let mesh = null;
      const inflated = inflateObstacleForStage(obs, "plan");
      const recastObstacle = inflated.kind === "circle"
        ? { ...inflated, r: Math.max(0, Number(inflated.r) || 0) + recastClearance }
        : { ...inflated, hx: Math.max(0, Number(inflated.hx) || 0) + recastClearance, hz: Math.max(0, Number(inflated.hz) || 0) + recastClearance };
      const obsHeight = Math.max(0.06, Number.isFinite(recastObstacle.h) ? recastObstacle.h : 1.6);
      const obsY = Number.isFinite(recastObstacle.y) ? recastObstacle.y : obsHeight * 0.5;
      if (recastObstacle.kind === "circle") {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(recastObstacle.r, recastObstacle.r, obsHeight, 16));
        mesh.position.set(recastObstacle.x, obsY, recastObstacle.z);
      } else if (recastObstacle.kind === "obb") {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(recastObstacle.hx * 2, obsHeight, recastObstacle.hz * 2));
        mesh.position.set(recastObstacle.x, obsY, recastObstacle.z);
        mesh.rotation.y = recastObstacle.yaw || 0;
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(recastObstacle.hx * 2, obsHeight, recastObstacle.hz * 2));
        mesh.position.set(recastObstacle.x, obsY, recastObstacle.z);
      }
      mesh.updateMatrixWorld(true);
      meshes.push(mesh);
    }
    return meshes;
  }

  function getDebugWalkableSurfaces() {
    return getWalkableSurfaces().map((surface) => ({
      minX: surface.minX,
      maxX: surface.maxX,
      minZ: surface.minZ,
      maxZ: surface.maxZ,
      y: surface.y,
      yTol: surface.id === "floor" ? 0.14 : 0.12,
    }));
  }

  function isPointOnDebugWalkableSurface(x, y, z, surfaces) {
    for (const s of surfaces) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      if (Math.abs(y - s.y) <= s.yTol) return true;
    }
    return false;
  }

  function extractDebugGeometryFromNavMesh(navMesh, debugObstacles = null) {
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
      if (Array.isArray(debugObstacles) && debugObstacles.length) {
        for (const obstacle of debugObstacles) {
          if (obstacleBlocksPoint(obstacle, mx, mz, 0, my, "plan")) return;
        }
      }
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

  function buildRecastNavEntry(obstacles, includePickups, clearance, pathOptions = null) {
    const startedAt = performance.now();
    const profileMeta = {
      includePickups: !!includePickups,
      cache: "miss",
      ok: false,
      dynamicChanged: false,
    };
    try {
      if (!recastState.ready) {
        profileMeta.reason = "recast-not-ready";
        return null;
      }
      const modeKey = includePickups ? "dynamic" : "static";
      const sourceObstacles = buildRecastSourceObstacleSet(obstacles);
      const signature = `${getObstacleSignatureCached(sourceObstacles, clearance)}|${getPathOptionsCacheKey(pathOptions)}`;
      const cached = navMeshCache[modeKey];
      if (cached && cached.signature === signature) {
        profileMeta.cache = "hit";
        bumpPathProfilerCounter("recastEntryCacheHits");
        const dynamicSpecs = buildTileCacheDynamicSpecs(obstacles, includePickups, clearance);
        const dynamicSignature = dynamicSpecsSignature(dynamicSpecs);
        cached.debugIncludePickups = !!includePickups;
        cached.debugSourceObstacleRefs = sourceObstacles.map((obs) => summarizeRecastSourceObstacle(obs)).filter(Boolean);
        cached.debugDynamicSpecRefs = dynamicSpecs.map((spec) => summarizeRecastDynamicSpec(spec)).filter(Boolean);
        if (cached.tileCache) {
          const signatureChanged = cached.dynamicSignature !== dynamicSignature;
          const tileCacheChanged = syncTileCacheObstacles(cached, dynamicSpecs);
          const changed = signatureChanged || tileCacheChanged;
          if (changed) cached.dynamicSignature = dynamicSignature;
          profileMeta.dynamicChanged = !!changed;
        } else {
          cached.dynamicSignature = "none";
        }
        if (cached.debugDirty) {
          const debugGeometry = extractDebugGeometryFromNavMesh(cached.navMesh, obstacles);
          cached.segments = debugGeometry.segments;
          cached.triangles = debugGeometry.triangles;
          cached.debugDirty = false;
        }
        cached.runtimeSignature = `${cached.signature}|dyn:${cached.dynamicSignature || "none"}`;
        navMeshCache.active = cached;
        profileMeta.ok = true;
        return cached;
      }

      bumpPathProfilerCounter("recastEntryRebuilds");
      profileMeta.cache = "rebuild";
      const sourceMeshes = buildRecastSourceMeshes(sourceObstacles, clearance, pathOptions);
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
        if (!fallback?.success || !fallback.navMesh) {
          profileMeta.reason = "solo-nav-build-failed";
          return null;
        }
        navMesh = fallback.navMesh;
      }

      const navQuery = new NavMeshQuery(navMesh, { maxNodes: 4096 });
      navQuery.defaultQueryHalfExtents = { x: 2.5, y: 2.0, z: 2.5 };

      const debugGeometry = extractDebugGeometryFromNavMesh(navMesh, obstacles);
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
        debugIncludePickups: !!includePickups,
        debugSourceObstacleRefs: sourceObstacles.map((obs) => summarizeRecastSourceObstacle(obs)).filter(Boolean),
        debugDynamicSpecRefs: [],
      };

      if (tileCache) {
        const dynamicSpecs = buildTileCacheDynamicSpecs(obstacles, includePickups, clearance);
        entry.debugDynamicSpecRefs = dynamicSpecs.map((spec) => summarizeRecastDynamicSpec(spec)).filter(Boolean);
        syncTileCacheObstacles(entry, dynamicSpecs);
        entry.dynamicSignature = dynamicSpecsSignature(dynamicSpecs);
        if (entry.debugDirty) {
          const refreshed = extractDebugGeometryFromNavMesh(entry.navMesh, obstacles);
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
      profileMeta.ok = true;
      return entry;
    } catch (error) {
      profileMeta.reason = "exception";
      console.warn("Recast navmesh build failed; leaving recast enabled for retry.", error);
      return null;
    } finally {
      finishPathProfilerMetric("buildRecastNavEntry", startedAt, profileMeta, 4.5);
    }
  }

  function computeRecastPath(start, goal, obstacles, clearance, queryY = 0, pathOptions = null) {
    const startedAt = performance.now();
    const profileMeta = {
      includePickups: !!obstacles?._includePickups,
      ok: false,
      pathLen: 0,
    };
    let smoothedBlockDetail = null;
    let rawBlockDetail = null;
    let startProjectionDetail = null;
    let goalProjectionDetail = null;
    let startPointBlockDetail = null;
    let goalPointBlockDetail = null;
    let blockedSampleNavDetail = null;
    let rawFirstSegmentPreview = "";
    let smoothFirstSegmentPreview = "";
    let rawPathPreview = "";
    let smoothPathPreview = "";
    let solveInputPresence = "";
    try {
      updateLastSolverDebug({
        recastReason: "",
        recastPathLen: 0,
        recastIncludePickups: !!obstacles?._includePickups,
      });
      if (!recastState.ready) {
        profileMeta.reason = "recast-not-ready";
        return null;
      }
      const includePickups = !!obstacles?._includePickups;
      const entry = buildRecastNavEntry(obstacles, includePickups, clearance, pathOptions);
      if (!entry) {
        profileMeta.reason = "nav-entry-missing";
        return null;
      }

      const planY = Number.isFinite(queryY)
        ? queryY
        : (Number.isFinite(start?.y) ? start.y : (Number.isFinite(goal?.y) ? goal.y : 0));
      const isGroundPlan = planY <= 0.08;
      const queryHalfExtents = { x: 2.5, y: isGroundPlan ? 0.24 : 0.32, z: 2.5 };
      const relaxedHalfExtents = { x: 2.5, y: isGroundPlan ? 0.48 : 0.72, z: 2.5 };
      const maxSnapDy = isGroundPlan ? 0.22 : 0.3;
      const acceptPoint = (p) => p && Number.isFinite(p.y) && Math.abs(p.y - planY) <= maxSnapDy;
      const sampleClosest = (x, z, halfExtents) =>
        entry.navQuery.findClosestPoint(
          { x, y: planY, z },
          { halfExtents }
        );
      const resolveClosestNavPoint = (point) => {
        const base = sampleClosest(point.x, point.z, queryHalfExtents);
        if (base?.success && acceptPoint(base.point)) return base.point;
        const relaxed = sampleClosest(point.x, point.z, relaxedHalfExtents);
        if (relaxed?.success && acceptPoint(relaxed.point)) return relaxed.point;
        const searchRadii = [0.08, 0.16, 0.26];
        for (const radius of searchRadii) {
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2;
            const sx = point.x + Math.cos(ang) * radius;
            const sz = point.z + Math.sin(ang) * radius;
            const ringBase = sampleClosest(sx, sz, queryHalfExtents);
            if (ringBase?.success && acceptPoint(ringBase.point)) return ringBase.point;
            const ringRelaxed = sampleClosest(sx, sz, relaxedHalfExtents);
            if (ringRelaxed?.success && acceptPoint(ringRelaxed.point)) return ringRelaxed.point;
          }
        }
        return null;
      };
      const startOnNav = resolveClosestNavPoint(start);
      const goalOnNav = resolveClosestNavPoint(goal);
      startPointBlockDetail = findPointBlockingDetail(start?.x, start?.z, obstacles, clearance, planY, "plan", pathOptions);
      goalPointBlockDetail = findPointBlockingDetail(goal?.x, goal?.z, obstacles, clearance, planY, "plan", pathOptions);
      if (startOnNav) {
        const startJoinBlock = analyzeTraversabilityFailure([
          new THREE.Vector3(start.x, Number.isFinite(start.y) ? start.y : planY, start.z),
          new THREE.Vector3(startOnNav.x, Number.isFinite(startOnNav.y) ? startOnNav.y : planY, startOnNav.z),
        ], obstacles, clearance, planY, "plan", pathOptions);
        startProjectionDetail = {
          joinClear: !startJoinBlock,
          snapDistance: Math.hypot((startOnNav.x || 0) - (start?.x || 0), (startOnNav.z || 0) - (start?.z || 0)),
          fromX: start?.x,
          fromZ: start?.z,
          toX: startOnNav.x,
          toZ: startOnNav.z,
          blockDetail: startJoinBlock,
        };
      }
      if (goalOnNav) {
        const goalJoinBlock = analyzeTraversabilityFailure([
          new THREE.Vector3(goalOnNav.x, Number.isFinite(goalOnNav.y) ? goalOnNav.y : planY, goalOnNav.z),
          new THREE.Vector3(goal.x, Number.isFinite(goal.y) ? goal.y : planY, goal.z),
        ], obstacles, clearance, planY, "plan", pathOptions);
        goalProjectionDetail = {
          joinClear: !goalJoinBlock,
          snapDistance: Math.hypot((goalOnNav.x || 0) - (goal?.x || 0), (goalOnNav.z || 0) - (goal?.z || 0)),
          fromX: goalOnNav.x,
          fromZ: goalOnNav.z,
          toX: goal?.x,
          toZ: goal?.z,
          blockDetail: goalJoinBlock,
        };
      }
      if (!startOnNav || !goalOnNav) {
        profileMeta.reason = "projection-failed";
        return [];
      }
      const result = entry.navQuery.computePath(
        { x: startOnNav.x, y: Number.isFinite(startOnNav.y) ? startOnNav.y : planY, z: startOnNav.z },
        { x: goalOnNav.x, y: Number.isFinite(goalOnNav.y) ? goalOnNav.y : planY, z: goalOnNav.z },
        {
          halfExtents: queryHalfExtents,
          maxPathPolys: 1024,
          maxStraightPathPoints: 1024,
        }
      );
      if (!result?.success || !Array.isArray(result.path) || result.path.length === 0) {
        profileMeta.reason = "compute-path-empty";
        return [];
      }

      const path = [];
      for (let i = 0; i < result.path.length; i++) {
        const p = result.path[i];
        path.push(new THREE.Vector3(p.x, Number.isFinite(p.y) ? p.y : planY, p.z));
      }

      if (path.length === 0) {
        profileMeta.reason = "no-waypoints";
        return [];
      }
      // Keep the raw recast path on valid nav points. The caller is responsible for
      // stitching exact snapped endpoints back in, and doing that here can make an
      // otherwise valid recast solve fail post-validation and spill into fallback A*.
      if (path[0].distanceToSquared(startOnNav) > 0.01 * 0.01) path.unshift(new THREE.Vector3(startOnNav.x, startOnNav.y, startOnNav.z));
      else path[0].set(startOnNav.x, startOnNav.y, startOnNav.z);
      const last = path.length - 1;
      if (path[last].distanceToSquared(goalOnNav) > 0.01 * 0.01) path.push(new THREE.Vector3(goalOnNav.x, goalOnNav.y, goalOnNav.z));
      else path[last].set(goalOnNav.x, goalOnNav.y, goalOnNav.z);

      const smoothed = smoothCatPath(path, obstacles, clearance, planY, pathOptions);
      rawFirstSegmentPreview = formatFirstSegment(path, "raw1");
      smoothFirstSegmentPreview = formatFirstSegment(smoothed, "smooth1");
      rawPathPreview = formatPathPreview(path, "rawPts");
      smoothPathPreview = formatPathPreview(smoothed, "smoothPts");
      const recastValidationClearance = clearance;
      let finalPath = [];
      let acceptedMode = "";
      if (smoothed.length >= 2 && isPathTraversable(smoothed, obstacles, recastValidationClearance, planY, "plan", pathOptions)) {
        finalPath = smoothed;
        acceptedMode = "smoothed-baked";
      } else if (path.length >= 2 && isPathTraversable(path, obstacles, recastValidationClearance, planY, "plan", pathOptions)) {
        finalPath = path;
        acceptedMode = "raw-baked";
      }
      profileMeta.ok = finalPath.length >= 2;
      profileMeta.pathLen = finalPath.length;
      if (profileMeta.ok) {
        profileMeta.acceptedMode = acceptedMode;
      } else {
        profileMeta.reason = "post-smooth-blocked";
        profileMeta.validationClearance = recastValidationClearance;
        smoothedBlockDetail = analyzeTraversabilityFailure(smoothed, obstacles, recastValidationClearance, planY, "plan", pathOptions);
        rawBlockDetail = analyzeTraversabilityFailure(path, obstacles, recastValidationClearance, planY, "plan", pathOptions);
        if (smoothedBlockDetail) {
          profileMeta.blockedPathType = "smoothed";
          profileMeta.blockedObstacle = smoothedBlockDetail.obstacleLabel || smoothedBlockDetail.obstacleKind || "";
          profileMeta.blockedSegment = smoothedBlockDetail.segmentIndex;
        } else if (rawBlockDetail) {
          profileMeta.blockedPathType = "raw";
          profileMeta.blockedObstacle = rawBlockDetail.obstacleLabel || rawBlockDetail.obstacleKind || "";
          profileMeta.blockedSegment = rawBlockDetail.segmentIndex;
        }
        const samplePoint = smoothedBlockDetail || rawBlockDetail;
        if (samplePoint) {
          blockedSampleNavDetail = probeNavPoint(entry, { x: samplePoint.sampleX, z: samplePoint.sampleZ }, planY, isGroundPlan);
        }
        const blockParts = [];
        if (smoothedBlockDetail) blockParts.push(formatTraversabilityFailure(smoothedBlockDetail, "smoothed"));
        if (rawBlockDetail) blockParts.push(formatTraversabilityFailure(rawBlockDetail, "raw"));
        if (startProjectionDetail) blockParts.push(formatProjectionDetail(startProjectionDetail, "startProj"));
        if (goalProjectionDetail) blockParts.push(formatProjectionDetail(goalProjectionDetail, "goalProj"));
        blockParts.push(formatPointBlockDetail(startPointBlockDetail, "startBlk"));
        blockParts.push(formatPointBlockDetail(goalPointBlockDetail, "goalBlk"));
        if (blockedSampleNavDetail) blockParts.push(formatNavProbe(blockedSampleNavDetail, "sampleNav"));
        solveInputPresence = formatSolveInputPresence(samplePoint, entry, "solveIn");
        if (solveInputPresence) blockParts.push(solveInputPresence);
        if (rawFirstSegmentPreview) blockParts.push(rawFirstSegmentPreview);
        if (smoothFirstSegmentPreview) blockParts.push(smoothFirstSegmentPreview);
        if (rawPathPreview) blockParts.push(rawPathPreview);
        if (smoothPathPreview) blockParts.push(smoothPathPreview);
        if (blockParts.length) {
          traceFunction(
            "recastPostBlockV14",
            `${blockParts.join(" ")} target=${Number.isFinite(goal?.x) ? goal.x.toFixed(2) : "na"},${Number.isFinite(goal?.z) ? goal.z.toFixed(2) : "na"}`
          );
        }
      }
      return finalPath;
    } finally {
      updateLastSolverDebug({
        recastReason: profileMeta.ok ? "ok" : (profileMeta.reason || ""),
        recastPathLen: profileMeta.pathLen || 0,
        recastIncludePickups: !!obstacles?._includePickups,
        recastBlockedPathType: profileMeta.blockedPathType || "",
        recastBlockedObstacle: profileMeta.blockedObstacle || "",
        recastBlockedSegment: Number.isFinite(profileMeta.blockedSegment) ? profileMeta.blockedSegment : 0,
        recastSmoothedBlock: smoothedBlockDetail ? formatTraversabilityFailure(smoothedBlockDetail) : "",
        recastRawBlock: rawBlockDetail ? formatTraversabilityFailure(rawBlockDetail) : "",
        recastStartProjection: startProjectionDetail ? formatProjectionDetail(startProjectionDetail) : "",
        recastGoalProjection: goalProjectionDetail ? formatProjectionDetail(goalProjectionDetail) : "",
        recastStartPointBlock: formatPointBlockDetail(startPointBlockDetail),
        recastGoalPointBlock: formatPointBlockDetail(goalPointBlockDetail),
        recastSampleNavProbe: blockedSampleNavDetail ? formatNavProbe(blockedSampleNavDetail) : "",
        recastSolveInputPresence: solveInputPresence || "",
        recastRawFirstSegment: rawFirstSegmentPreview || "",
        recastSmoothFirstSegment: smoothFirstSegmentPreview || "",
        recastRawPathPreview: rawPathPreview || "",
        recastSmoothPathPreview: smoothPathPreview || "",
        recastStartProjectionClear: !!startProjectionDetail?.joinClear,
        recastGoalProjectionClear: !!goalProjectionDetail?.joinClear,
        recastBlockSampleX: Number.isFinite((smoothedBlockDetail || rawBlockDetail)?.sampleX) ? (smoothedBlockDetail || rawBlockDetail).sampleX : NaN,
        recastBlockSampleZ: Number.isFinite((smoothedBlockDetail || rawBlockDetail)?.sampleZ) ? (smoothedBlockDetail || rawBlockDetail).sampleZ : NaN,
      });
      bumpPathProfilerReason("recastReason", profileMeta.ok ? "ok" : (profileMeta.reason || "unknown"));
      finishPathProfilerMetric("computeRecastPath", startedAt, profileMeta, 5.5);
    }
  }

  function stepDetourCrowdToward(target, dt, useDynamicPlan = true, desiredSpeed = null, options = null) {
    const startedAt = performance.now();
    const profileMeta = {
      useDynamicPlan: !!useDynamicPlan,
      ok: false,
      recreated: false,
    };
    try {
      if (!CAT_NAV.useDetourCrowd || !recastState.ready) {
        profileMeta.reason = !CAT_NAV.useDetourCrowd
          ? "disabled"
          : "recast-not-ready";
        return null;
      }

      const clearance = getCatPathClearance();
      const baseSpeed = Number.isFinite(desiredSpeed) && desiredSpeed > 0 ? desiredSpeed : (cat.speed || 1);
      const detourSpeedScale = Math.max(0.1, Number.isFinite(CAT_NAV.detourSpeedScale) ? CAT_NAV.detourSpeedScale : 0.4);
      const agentSpeed = Math.max(0.2, baseSpeed * detourSpeedScale);
      const pathOptions = options && typeof options === "object" ? { ...options } : null;
      const queryY = Number.isFinite(pathOptions?.queryY)
        ? Number(pathOptions.queryY)
        : (Number.isFinite(target?.y) ? Number(target.y) : (Number.isFinite(cat.group.position.y) ? Number(cat.group.position.y) : 0));
      const obstacles = filterObstaclesForPathOptions(buildCatObstacles(!!useDynamicPlan, true), pathOptions);
      const crowdObstacles = attachObstacleMetadata(
        obstacles.filter((obs) => obstacleAffectsDetourCrowd(obs)),
        !!useDynamicPlan,
        true
      );
      const entry = buildRecastNavEntry(crowdObstacles, !!useDynamicPlan, clearance, pathOptions);
      if (!entry) {
        profileMeta.reason = "nav-entry-missing";
        return null;
      }

      const q = (v, quantum = 0.04) => Math.round((Number.isFinite(v) ? v : 0) / quantum);
      const signature = `${useDynamicPlan ? "dynamic" : "static"}|${entry.runtimeSignature || entry.signature}|${Math.round(clearance * 1000) / 1000}|y:${q(queryY)}`;
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
          { x: cat.pos.x, y: queryY, z: cat.pos.z },
          { halfExtents: { x: 1.8, y: queryY <= 0.08 ? 1.8 : 0.6, z: 1.8 } }
        );
        const startPos = nearest?.success ? nearest.point : { x: cat.pos.x, y: queryY, z: cat.pos.z };
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
      profileMeta.recreated = recreated;

      const agent = crowdState.agent;
      if (Math.abs((agent.maxSpeed || 0) - agentSpeed) > 0.02) {
        agent.maxSpeed = agentSpeed;
      }

      const agentPos = agent.position();
      if (!Number.isFinite(agentPos.x) || !Number.isFinite(agentPos.z)) {
        profileMeta.reason = "agent-pos-invalid";
        return null;
      }

      const driftSq = (agentPos.x - cat.pos.x) ** 2 + (agentPos.z - cat.pos.z) ** 2;
      const teleportedToCat = recreated || driftSq > 0.32 * 0.32;
      if (teleportedToCat) {
        agent.teleport({ x: cat.pos.x, y: queryY, z: cat.pos.z });
      }

      const snapRadius = Math.max(0.06, Number.isFinite(CAT_NAV.detourArriveSnapRadius) ? CAT_NAV.detourArriveSnapRadius : 0.1);
      const toGoalX = target.x - agentPos.x;
      const toGoalZ = target.z - agentPos.z;
      const distToGoal = Math.hypot(toGoalX, toGoalZ);
      let requestX = target.x;
      let requestZ = target.z;

      const reqDx = requestX - crowdState.lastTarget.x;
      const reqDz = requestZ - crowdState.lastTarget.z;
      const targetChanged = reqDx * reqDx + reqDz * reqDz > 0.05 * 0.05;
      const now = getClockTime();
      if (targetChanged || now - crowdState.lastRequestAt > 0.4) {
        const ok = agent.requestMoveTarget({ x: requestX, y: queryY, z: requestZ });
        if (!ok) {
          profileMeta.reason = "request-move-failed";
          return { ok: false, reason: "requestMoveTargetFailed" };
        }
        crowdState.lastTarget.set(requestX, 0, requestZ);
        crowdState.lastRequestAt = now;
      }

      const stepDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 1 / 24);
      crowdState.crowd.update(stepDt);

      const nextPos = agent.position();
      const velocity = agent.velocity();
      const state = agent.state();
      profileMeta.ok = true;
      return {
        ok: true,
        position: new THREE.Vector3(nextPos.x, Number.isFinite(nextPos.y) ? nextPos.y : queryY, nextPos.z),
        velocity: new THREE.Vector3(velocity.x, Number.isFinite(velocity.y) ? velocity.y : 0, velocity.z),
        state,
        recreated,
        teleportedToCat,
        driftSq,
        distToGoal,
        requestX,
        requestZ,
        targetChanged,
        lastRequestAge: now - crowdState.lastRequestAt,
        agentPos: new THREE.Vector3(agentPos.x, Number.isFinite(agentPos.y) ? agentPos.y : queryY, agentPos.z),
        stepDt,
        queryY,
      };
    } finally {
      finishPathProfilerMetric("stepDetourCrowdToward", startedAt, profileMeta, 3.5);
    }
  }

  function findNearestWalkablePoint(point, obstacles, clearance, queryY = null, pathOptions = null) {
    const startedAt = performance.now();
    const profileMeta = { cached: false, found: false };
    try {
      const y = Number.isFinite(queryY) ? queryY : (Number.isFinite(point?.y) ? point.y : 0);
      const q = (v, quantum = 0.08) => Math.round((Number.isFinite(v) ? v : 0) / quantum);
      const signature = getObstacleSignatureCached(obstacles, clearance);
      const cacheKey = `${signature}|${getPathOptionsCacheKey(pathOptions)}|${q(point?.x)}:${q(point?.z)}:${q(y, 0.06)}`;
      const now = getClockTime();
      const cached = nearestWalkableCache.get(cacheKey);
      if (cached && now - cached.at <= NEAREST_WALKABLE_CACHE_TTL && cached.point) {
        bumpPathProfilerCounter("nearestWalkableCacheHits");
        profileMeta.cached = true;
        profileMeta.found = true;
        return cached.point.clone();
      }
      bumpPathProfilerCounter("nearestWalkableCacheMisses");
      if (!isCatPointBlocked(point.x, point.z, obstacles, clearance, y, "plan", pathOptions)) {
        const exact = point.clone();
        nearestWalkableCache.set(cacheKey, { at: now, point: exact.clone() });
        if (nearestWalkableCache.size > NEAREST_WALKABLE_CACHE_LIMIT) {
          const oldestKey = nearestWalkableCache.keys().next().value;
          if (oldestKey != null) nearestWalkableCache.delete(oldestKey);
        }
        profileMeta.found = true;
        return exact;
      }
      const step = CAT_NAV.step;
      const candidate = new THREE.Vector3();
      for (let r = 1; r <= 10; r++) {
        const ringDist = r * step;
        const steps = Math.max(12, Math.floor(20 * r));
        for (let i = 0; i < steps; i++) {
          const t = (i / steps) * Math.PI * 2;
          candidate.set(point.x + Math.cos(t) * ringDist, y, point.z + Math.sin(t) * ringDist);
          if (!isCatPointBlocked(candidate.x, candidate.z, obstacles, clearance, y, "plan", pathOptions)) {
            const found = candidate.clone();
            nearestWalkableCache.set(cacheKey, { at: now, point: found.clone() });
            if (nearestWalkableCache.size > NEAREST_WALKABLE_CACHE_LIMIT) {
              const oldestKey = nearestWalkableCache.keys().next().value;
              if (oldestKey != null) nearestWalkableCache.delete(oldestKey);
            }
            profileMeta.found = true;
            return found;
          }
        }
      }
      profileMeta.reason = "not-found";
      return null;
    } finally {
      finishPathProfilerMetric("findNearestWalkablePoint", startedAt, profileMeta, 2.5);
    }
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

  function buildTriangleNavMeshCore(obstacles, clearance, queryY = 0, pathOptions = null) {
    const step = CAT_NAV.step;
    const minX = ROOM.minX + CAT_NAV.margin;
    const maxX = ROOM.maxX - CAT_NAV.margin;
    const minZ = ROOM.minZ + CAT_NAV.margin;
    const maxZ = ROOM.maxZ - CAT_NAV.margin;
    const vxCount = Math.floor((maxX - minX) / step) + 1;
    const vzCount = Math.floor((maxZ - minZ) / step) + 1;
    if (vxCount < 2 || vzCount < 2) return { vertices: [], triangles: [], pointTriCache: new Map() };

    const vertexId = (ix, iz) => iz * vxCount + ix;
    const vertices = new Array(vxCount * vzCount);
    const walkable = new Uint8Array(vertices.length);
    for (let iz = 0; iz < vzCount; iz++) {
      for (let ix = 0; ix < vxCount; ix++) {
        const id = vertexId(ix, iz);
        const v = new THREE.Vector3(minX + ix * step, queryY, minZ + iz * step);
        vertices[id] = v;
        if (!isCatPointBlocked(v.x, v.z, obstacles, clearance, queryY, "plan", pathOptions)) walkable[id] = 1;
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
      if (!hasClearTravelLine(va, vb, obstacles, clearance, queryY, "plan", pathOptions)) return;
      if (!hasClearTravelLine(vb, vc, obstacles, clearance, queryY, "plan", pathOptions)) return;
      if (!hasClearTravelLine(vc, va, obstacles, clearance, queryY, "plan", pathOptions)) return;
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

    return { vertices, triangles, pointTriCache: new Map() };
  }

  function buildTriangleNavMesh(obstacles, clearance, queryY = 0, pathOptions = null) {
    const startedAt = performance.now();
    const profileMeta = { cache: "miss", triangles: 0 };
    try {
      const q = (v, quantum = 0.08) => Math.round((Number.isFinite(v) ? v : 0) / quantum);
      const signature = getObstacleSignatureCached(obstacles, clearance);
      const cacheKey = `${signature}|${getPathOptionsCacheKey(pathOptions)}|${q(clearance, 0.02)}|${q(queryY, 0.08)}`;
      const now = getClockTime();
      const cached = triangleNavMeshCache.get(cacheKey);
      if (cached && now - cached.at <= TRIANGLE_NAV_CACHE_TTL && cached.navMesh) {
        bumpPathProfilerCounter("triangleNavMeshCacheHits");
        profileMeta.cache = "hit";
        profileMeta.triangles = Array.isArray(cached.navMesh.triangles) ? cached.navMesh.triangles.length : 0;
        return cached.navMesh;
      }
      bumpPathProfilerCounter("triangleNavMeshCacheMisses");
      const navMesh = buildTriangleNavMeshCore(obstacles, clearance, queryY, pathOptions);
      triangleNavMeshCache.set(cacheKey, { at: now, navMesh });
      if (triangleNavMeshCache.size > TRIANGLE_NAV_CACHE_LIMIT) {
        const oldestKey = triangleNavMeshCache.keys().next().value;
        if (oldestKey != null) triangleNavMeshCache.delete(oldestKey);
      }
      profileMeta.triangles = Array.isArray(navMesh?.triangles) ? navMesh.triangles.length : 0;
      return navMesh;
    } finally {
      finishPathProfilerMetric("buildTriangleNavMesh", startedAt, profileMeta, 3.5);
    }
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
    // Always resolve against current dynamic pickup obstacles so the debug navmesh
    // matches the live floor cutouts users see around settled clutter.
    return getNavMeshDebugData(true, true);
  }

  function findTriangleForPoint(point, navMesh, obstacles, clearance, queryY = 0) {
    if (navMesh && navMesh.pointTriCache instanceof Map) {
      const q = (v, quantum = 0.14) => Math.round((Number.isFinite(v) ? v : 0) / quantum);
      const cacheKey = `${q(point?.x)}:${q(point?.z)}`;
      const cachedTri = navMesh.pointTriCache.get(cacheKey);
      if (Number.isInteger(cachedTri) && cachedTri >= 0 && cachedTri < navMesh.triangles.length) {
        const cached = navMesh.triangles[cachedTri];
        if (cached) {
          const va = navMesh.vertices[cached.a];
          const vb = navMesh.vertices[cached.b];
          const vc = navMesh.vertices[cached.c];
          if (isPointInsideTriangleXZ(point, va, vb, vc) || hasClearTravelLine(point, cached.centroid, obstacles, clearance, queryY)) {
            return cachedTri;
          }
        }
      }
      if (cachedTri === -1) return -1;
      let best = -1;
      let bestD2 = Infinity;
      for (let i = 0; i < navMesh.triangles.length; i++) {
        const tri = navMesh.triangles[i];
        const va = navMesh.vertices[tri.a];
        const vb = navMesh.vertices[tri.b];
        const vc = navMesh.vertices[tri.c];
        if (isPointInsideTriangleXZ(point, va, vb, vc)) {
          navMesh.pointTriCache.set(cacheKey, i);
          if (navMesh.pointTriCache.size > 256) {
            const oldestKey = navMesh.pointTriCache.keys().next().value;
            if (oldestKey != null) navMesh.pointTriCache.delete(oldestKey);
          }
          return i;
        }
        const d2 = tri.centroid.distanceToSquared(point);
        if (d2 >= bestD2) continue;
        if (!hasClearTravelLine(point, tri.centroid, obstacles, clearance, queryY)) continue;
        bestD2 = d2;
        best = i;
      }
      navMesh.pointTriCache.set(cacheKey, best);
      if (navMesh.pointTriCache.size > 256) {
        const oldestKey = navMesh.pointTriCache.keys().next().value;
        if (oldestKey != null) navMesh.pointTriCache.delete(oldestKey);
      }
      return best;
    }
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

  function computeFallbackCatPath(start, goal, obstacles, navClearance, queryY = 0, recordDebug = true) {
    const startedAt = performance.now();
    const profileMeta = { ok: false, pathLen: 0 };
    try {
      if (recordDebug) {
        lastAStarDebug.mode = "fallback";
        lastAStarDebug.start = start.clone();
        lastAStarDebug.goal = goal.clone();
        lastAStarDebug.edges = [];
        lastAStarDebug.finalPath = [];
        lastAStarDebug.timestamp = getClockTime();
      }

      const freeStart = findNearestWalkablePoint(start, obstacles, navClearance, queryY);
      const freeGoal = findNearestWalkablePoint(goal, obstacles, navClearance, queryY);
      if (!freeStart || !freeGoal) {
        profileMeta.reason = !freeStart ? "no-walkable-start" : "no-walkable-goal";
        return [];
      }
      const navMesh = buildTriangleNavMesh(obstacles, navClearance, queryY);
      if (!navMesh.triangles.length) {
        profileMeta.reason = "no-triangles";
        return [];
      }

      const startTri = findTriangleForPoint(freeStart, navMesh, obstacles, navClearance, queryY);
      const goalTri = findTriangleForPoint(freeGoal, navMesh, obstacles, navClearance, queryY);
      if (startTri < 0 || goalTri < 0) {
        profileMeta.reason = "missing-triangle";
        return [];
      }
      if (startTri === goalTri) {
        if (recordDebug) lastAStarDebug.edges = [
          {
            from: start.clone(),
            to: goal.clone(),
            order: 0,
            accepted: true,
            reason: "sameCell",
          },
        ];
        if (recordDebug) lastAStarDebug.finalPath = [start.clone(), goal.clone()];
        profileMeta.ok = true;
        profileMeta.pathLen = 2;
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
          if (recordDebug && lastAStarDebug.edges.length < 1800) {
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

      if (came[goalTri] === -1) {
        profileMeta.reason = "astar-no-path";
        return [];
      }

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
      if (recordDebug) lastAStarDebug.finalPath = final.map((p) => p.clone());
      profileMeta.ok = final.length >= 2;
      profileMeta.pathLen = final.length;
      if (!profileMeta.ok) profileMeta.reason = "smoothed-empty";
      return final;
    } finally {
      finishPathProfilerMetric("computeFallbackCatPath", startedAt, profileMeta, 6.5);
    }
  }

  function computeCatPath(start, goal, obstacles, queryY = null, allowFallback = null, recordDebug = true, pathOptions = null) {
    const startedAt = performance.now();
    const profileMeta = {
      mode: "",
      cached: false,
      family: false,
      ok: false,
      allowFallback: shouldAllowFallbackPlanner(allowFallback),
      pathLen: 0,
    };
    const solveDebug = {
      mode: "",
      reason: "",
      pathLen: 0,
      cached: false,
      family: false,
      includePickups: !!obstacles?._includePickups,
      queryY: Number.isFinite(queryY)
        ? queryY
        : (Number.isFinite(start?.y) ? start.y : (Number.isFinite(goal?.y) ? goal.y : 0)),
      allowFallback: !!profileMeta.allowFallback,
      detourExpansions: 0,
      detourCandidates: 0,
      detourLegMisses: 0,
      detourBestDepth: 0,
      detourFound: false,
    };
    try {
      const allowFallbackPlanner = profileMeta.allowFallback;
      const resolvedPathOptions =
        pathOptions && typeof pathOptions === "object"
          ? pathOptions
          : getActiveCatPathOptions();
      const navClearance = resolvePathClearance(resolvePathClearanceOverride(resolvedPathOptions));
      const pathY = Number.isFinite(queryY)
        ? queryY
        : (Number.isFinite(start?.y) ? start.y : (Number.isFinite(goal?.y) ? goal.y : 0));
      solveDebug.queryY = pathY;
      solveDebug.allowFallback = !!allowFallbackPlanner;
      if (resolvePathSupportSurfaceId(resolvedPathOptions)) {
        solveDebug.supportSurfaceId = resolvePathSupportSurfaceId(resolvedPathOptions);
      } else {
        delete solveDebug.supportSurfaceId;
      }
      updateLastSolverDebug(solveDebug);
      const startOnPlane = new THREE.Vector3(start.x, pathY, start.z);
      const goalOnPlane = new THREE.Vector3(goal.x, pathY, goal.z);
      const softStartEscape = buildStartOverlapEscapeObstacles(startOnPlane, obstacles, navClearance, pathY);
      const runtimeAlignedStart = !softStartEscape
        ? buildStartRuntimeAlignedObstacles(startOnPlane, obstacles, navClearance, pathY)
        : null;
      const planningObstacles = softStartEscape?.obstacles || runtimeAlignedStart?.obstacles || obstacles;
      if (softStartEscape) {
        solveDebug.softStartEscape = true;
        solveDebug.softStartEscapeCount = softStartEscape.blockerLabels.length;
        solveDebug.softStartEscapeLabels = softStartEscape.blockerLabels.join(",");
      }
      if (runtimeAlignedStart) {
        solveDebug.startRuntimeAligned = true;
        solveDebug.startRuntimeAlignedCount = runtimeAlignedStart.blockerLabels.length;
        solveDebug.startRuntimeAlignedLabels = runtimeAlignedStart.blockerLabels.join(",");
      }
      const q = (v) => Math.round((Number.isFinite(v) ? v : 0) / PATH_CACHE_QUANTUM);
      const signature = `${getObstacleSignatureCached(planningObstacles, navClearance)}|${getPathOptionsCacheKey(resolvedPathOptions)}`;
      const cacheKey = `${signature}|${allowFallbackPlanner ? 1 : 0}|${q(start?.x)}:${q(start?.z)}:${q(goal?.x)}:${q(goal?.z)}:${q(pathY)}`;
      const cached = pathSolveCache.get(cacheKey);
      const now = getClockTime();
      const setDebugSnapshot = (mode, startPoint, goalPoint, edges = [], finalPath = []) => {
        if (!recordDebug) return;
        lastAStarDebug.mode = mode;
        lastAStarDebug.start = startPoint ? startPoint.clone() : null;
        lastAStarDebug.goal = goalPoint ? goalPoint.clone() : null;
        lastAStarDebug.edges = Array.isArray(edges) ? edges : [];
        lastAStarDebug.finalPath = Array.isArray(finalPath) ? finalPath : [];
        lastAStarDebug.timestamp = getClockTime();
      };
      if (cached && now - cached.at <= PATH_CACHE_TTL) {
        const cachedPath = Array.isArray(cached.path) ? cached.path.map((p) => p.clone()) : null;
        const nextPoint = cachedPath && cachedPath.length > 1 ? (cachedPath[1] || cachedPath[0]) : null;
        const prevPoint = cachedPath && cachedPath.length > 1 ? (cachedPath[cachedPath.length - 2] || cachedPath[cachedPath.length - 1]) : null;
        const cachePathReusable = !!(
          cachedPath &&
          cachedPath.length >= 2 &&
          nextPoint &&
          prevPoint &&
          hasClearTravelLine(startOnPlane, nextPoint, planningObstacles, navClearance, pathY, "plan", resolvedPathOptions) &&
          hasClearTravelLine(prevPoint, goalOnPlane, planningObstacles, navClearance, pathY, "plan", resolvedPathOptions)
        );
        if (cachePathReusable) {
          bumpPathProfilerCounter("pathCacheHits");
          cachedPath[0] = startOnPlane.clone();
          cachedPath[cachedPath.length - 1] = goalOnPlane.clone();
          setDebugSnapshot(cached.mode, startOnPlane, goalOnPlane, [], cachedPath.map((p) => p.clone()));
          profileMeta.cached = true;
          profileMeta.mode = `cache:${cached.mode || "unknown"}`;
          profileMeta.ok = cachedPath.length >= 2;
          profileMeta.pathLen = cachedPath.length;
          solveDebug.mode = profileMeta.mode;
          solveDebug.cached = true;
          solveDebug.pathLen = cachedPath.length;
          return cachedPath;
        }
        if (cached) {
          pathSolveCache.delete(cacheKey);
          solveDebug.cacheRejected = true;
          solveDebug.cacheRejectReason = "endpoint-join-blocked";
        }
      }
      bumpPathProfilerCounter("pathCacheMisses");
      const familyKey = makePathFamilyKey(signature, allowFallbackPlanner, pathY, startOnPlane, goalOnPlane);
      const reuseKey = makeCorridorGoalReuseKey(signature, allowFallbackPlanner, pathY, goalOnPlane);
      const familyPath = getCachedFamilyPath(familyKey, startOnPlane, goalOnPlane, planningObstacles, navClearance, pathY, now, resolvedPathOptions);
      if (familyPath) {
        bumpPathProfilerCounter("pathFamilyHits");
        setDebugSnapshot(familyPath.mode, startOnPlane, goalOnPlane, [], familyPath.path.map((p) => p.clone()));
        profileMeta.family = true;
        profileMeta.mode = `family:${familyPath.mode || "unknown"}`;
        profileMeta.ok = familyPath.path.length >= 2;
        profileMeta.pathLen = familyPath.path.length;
        solveDebug.mode = profileMeta.mode;
        solveDebug.family = true;
        solveDebug.pathLen = familyPath.path.length;
        return familyPath.path;
      }
      bumpPathProfilerCounter("pathFamilyMisses");
      let freeStart = softStartEscape ? startOnPlane.clone() : findNearestWalkablePoint(startOnPlane, planningObstacles, navClearance, pathY, resolvedPathOptions);
      let freeGoal = findNearestWalkablePoint(goalOnPlane, planningObstacles, navClearance, pathY, resolvedPathOptions);
      const rescueSurfaceId = !softStartEscape ? resolvePathSupportSurfaceId(resolvedPathOptions) : "";
      if (!freeStart && rescueSurfaceId) {
        const rescueObstacles = filterObstaclesForSameSurfaceStartRescue(planningObstacles, rescueSurfaceId);
        if (rescueObstacles !== planningObstacles) {
          const rescuedStart = findNearestWalkablePoint(startOnPlane, rescueObstacles, navClearance, pathY, resolvedPathOptions);
          if (rescuedStart) {
            freeStart = rescuedStart;
            solveDebug.startRescue = true;
            solveDebug.startRescueSurfaceId = rescueSurfaceId;
          }
        }
      }
      if (!freeStart || !freeGoal) {
        profileMeta.reason = !freeStart ? "no-walkable-start" : "no-walkable-goal";
        solveDebug.reason = profileMeta.reason;
        return [];
      }

      if (hasClearTravelLine(freeStart, freeGoal, planningObstacles, navClearance, pathY, "plan", resolvedPathOptions)) {
        const directPath = materializePathWithEndpoints(
          [freeStart.clone(), freeGoal.clone()],
          startOnPlane,
          freeStart,
          goalOnPlane,
          freeGoal,
          planningObstacles,
          navClearance,
          pathY,
          resolvedPathOptions
        );
        const directEdges = [];
        for (let i = 1; i < directPath.length; i++) {
          directEdges.push({
            from: directPath[i - 1].clone(),
            to: directPath[i].clone(),
            order: i - 1,
            accepted: true,
            reason: "directPath",
          });
        }
        setDebugSnapshot("direct", startOnPlane, goalOnPlane, directEdges, directPath.map((p) => p.clone()));
        pathSolveCache.set(cacheKey, {
          at: now,
          mode: "direct",
          path: directPath.map((p) => p.clone()),
        });
        storePathFamily(familyKey, now, "direct", directPath, reuseKey);
        if (pathSolveCache.size > PATH_CACHE_LIMIT) {
          const oldestKey = pathSolveCache.keys().next().value;
          if (oldestKey != null) pathSolveCache.delete(oldestKey);
        }
        bumpPathProfilerCounter("computeCatPathDirect");
        profileMeta.mode = "direct";
        profileMeta.ok = true;
        profileMeta.pathLen = directPath.length;
        solveDebug.mode = "direct";
        solveDebug.pathLen = directPath.length;
        return directPath;
      }

      const recastPath = computeRecastPath(freeStart, freeGoal, planningObstacles, navClearance, pathY, resolvedPathOptions);
      if (Array.isArray(recastPath) && recastPath.length >= 2) {
        const corePath = recastPath.map((p) => p.clone());
        corePath[0].copy(freeStart);
        corePath[corePath.length - 1].copy(freeGoal);
        const path = materializePathWithEndpoints(
          corePath,
          startOnPlane,
          freeStart,
          goalOnPlane,
          freeGoal,
          planningObstacles,
          navClearance,
          pathY,
          resolvedPathOptions
        );
        const recastEdges = [];
        for (let i = 1; i < path.length; i++) {
          recastEdges.push({
            from: path[i - 1].clone(),
            to: path[i].clone(),
            order: i - 1,
            accepted: true,
            reason: "recastPath",
          });
        }
        setDebugSnapshot("recast", startOnPlane, goalOnPlane, recastEdges, path.map((p) => p.clone()));
        pathSolveCache.set(cacheKey, {
          at: now,
          mode: "recast",
          path: path.map((p) => p.clone()),
        });
        storePathFamily(familyKey, now, "recast", path, reuseKey);
        if (pathSolveCache.size > PATH_CACHE_LIMIT) {
          const oldestKey = pathSolveCache.keys().next().value;
          if (oldestKey != null) pathSolveCache.delete(oldestKey);
        }
        bumpPathProfilerCounter("computeCatPathRecast");
        profileMeta.mode = "recast";
        profileMeta.ok = true;
        profileMeta.pathLen = path.length;
        solveDebug.mode = "recast";
        solveDebug.pathLen = path.length;
        return path;
      }

      const corridorPath = getReusableCorridorPath(
        reuseKey,
        startOnPlane,
        freeStart,
        goalOnPlane,
        freeGoal,
        planningObstacles,
        navClearance,
        pathY,
        now,
        resolvedPathOptions
      );
      if (corridorPath) {
        bumpPathProfilerCounter("pathCorridorHits");
        setDebugSnapshot(corridorPath.mode, startOnPlane, goalOnPlane, [], corridorPath.path.map((p) => p.clone()));
        pathSolveCache.set(cacheKey, {
          at: now,
          mode: corridorPath.mode,
          path: corridorPath.path.map((p) => p.clone()),
        });
        storePathFamily(familyKey, now, corridorPath.mode, corridorPath.path, reuseKey);
        if (pathSolveCache.size > PATH_CACHE_LIMIT) {
          const oldestKey = pathSolveCache.keys().next().value;
          if (oldestKey != null) pathSolveCache.delete(oldestKey);
        }
        profileMeta.family = true;
        profileMeta.mode = `corridor:${corridorPath.mode || "unknown"}`;
        profileMeta.ok = corridorPath.path.length >= 2;
        profileMeta.pathLen = corridorPath.path.length;
        solveDebug.mode = profileMeta.mode;
        solveDebug.family = true;
        solveDebug.pathLen = corridorPath.path.length;
        return corridorPath.path;
      }
      bumpPathProfilerCounter("pathCorridorMisses");

      const detourDebug = {};
      const detourPath = buildNoFallbackObstacleDetourPath(
        startOnPlane,
        goalOnPlane,
        planningObstacles,
        navClearance,
        pathY,
        detourDebug,
        resolvedPathOptions
      );
      Object.assign(solveDebug, detourDebug);
      if (detourPath.length >= 2) {
        setDebugSnapshot("recast-detour", startOnPlane, goalOnPlane, [], detourPath.map((p) => p.clone()));
        pathSolveCache.set(cacheKey, {
          at: now,
          mode: "recast-detour",
          path: detourPath.map((p) => p.clone()),
        });
        storePathFamily(familyKey, now, "recast-detour", detourPath, reuseKey);
        if (pathSolveCache.size > PATH_CACHE_LIMIT) {
          const oldestKey = pathSolveCache.keys().next().value;
          if (oldestKey != null) pathSolveCache.delete(oldestKey);
        }
        bumpPathProfilerCounter("computeCatPathRecast");
        profileMeta.mode = "recast-detour";
        profileMeta.ok = true;
        profileMeta.pathLen = detourPath.length;
        solveDebug.mode = "recast-detour";
        solveDebug.pathLen = detourPath.length;
        return detourPath;
      }

      setDebugSnapshot("none", startOnPlane, goalOnPlane, [], []);
      bumpPathProfilerCounter("computeCatPathNone");
      profileMeta.mode = "none";
      profileMeta.reason = "recast-unresolved";
      solveDebug.mode = "none";
      solveDebug.reason = profileMeta.reason;
      return [];
    } finally {
      solveDebug.mode = profileMeta.mode || solveDebug.mode || "";
      solveDebug.reason = profileMeta.reason || solveDebug.reason || "";
      solveDebug.pathLen = profileMeta.pathLen || solveDebug.pathLen || 0;
      solveDebug.cached = !!profileMeta.cached;
      solveDebug.family = !!profileMeta.family;
      solveDebug.includePickups = !!obstacles?._includePickups;
      solveDebug.queryY = Number.isFinite(queryY)
        ? queryY
        : (Number.isFinite(start?.y) ? start.y : (Number.isFinite(goal?.y) ? goal.y : 0));
      solveDebug.allowFallback = !!profileMeta.allowFallback;
      updateLastSolverDebug(solveDebug);
      finishPathProfilerMetric("computeCatPath", startedAt, profileMeta, 5.5);
    }
  }

  function isPathTraversable(path, obstacles, clearance = null, queryY = null, stage = "plan", pathOptions = null) {
    const navClearance = resolvePathClearance(clearance);
    if (!path || path.length < 2) return false;
    for (let i = 1; i < path.length; i++) {
      const segY = Number.isFinite(queryY)
        ? queryY
        : (
            Number.isFinite(path[i - 1]?.y) && Number.isFinite(path[i]?.y)
              ? (path[i - 1].y + path[i].y) * 0.5
              : 0
          );
      if (!hasClearTravelLine(path[i - 1], path[i], obstacles, navClearance, segY, stage, pathOptions)) return false;
    }
    return true;
  }

  function canReachGroundTarget(start, goal, obstacles, options = null) {
    const startedAt = performance.now();
    const profileMeta = { cached: false, ok: false };
    try {
      const clearanceOverride =
        options && typeof options === "object"
          ? resolvePathClearanceOverride(options)
          : null;
      const navClearance = resolvePathClearance(clearanceOverride);
      const allowFallback = typeof options === "boolean"
        ? options
        : (
            options &&
            typeof options === "object" &&
            "allowFallback" in options
              ? !!options.allowFallback
              : null
          );
      const allowEndpointPushableGoal = typeof options === "object" && options
        ? options.allowEndpointPushableGoal !== false
        : true;
      const startOnPlane = new THREE.Vector3(start.x, 0, start.z);
      const goalOnPlane = new THREE.Vector3(goal.x, 0, goal.z);
      const q = (v, quantum = 0.08) => Math.round((Number.isFinite(v) ? v : 0) / quantum);
      const pathObstacles = allowEndpointPushableGoal
        ? filterEndpointPushableGoalObstacles(goalOnPlane, obstacles, navClearance, 0, "plan")
        : obstacles;
      const signature = getObstacleSignatureCached(pathObstacles, navClearance);
      const cacheKey = `${signature}|${allowFallback == null ? "default" : (allowFallback ? 1 : 0)}|ep:${allowEndpointPushableGoal ? 1 : 0}|${q(startOnPlane.x)}:${q(startOnPlane.z)}:${q(goalOnPlane.x)}:${q(goalOnPlane.z)}`;
      const now = getClockTime();
      const cached = reachabilityCache.get(cacheKey);
      if (cached && now - cached.at <= REACHABILITY_CACHE_TTL) {
        bumpPathProfilerCounter("reachabilityCacheHits");
        profileMeta.cached = true;
        profileMeta.ok = !!cached.ok;
        return !!cached.ok;
      }
      bumpPathProfilerCounter("reachabilityCacheMisses");
      const commit = (ok, reason = "") => {
        reachabilityCache.set(cacheKey, { at: now, ok: !!ok });
        if (reachabilityCache.size > REACHABILITY_CACHE_LIMIT) {
          const oldestKey = reachabilityCache.keys().next().value;
          if (oldestKey != null) reachabilityCache.delete(oldestKey);
        }
        profileMeta.ok = !!ok;
        if (reason) profileMeta.reason = reason;
        return !!ok;
      };
      const freeGoal = findNearestWalkablePoint(goalOnPlane, pathObstacles, navClearance, 0);
      if (!freeGoal) {
        return commit(false, "goal-not-walkable");
      }
      const maxGoalSnap = Math.max(0.16, CAT_NAV.step * 1.25, navClearance * 1.9);
      if (freeGoal.distanceToSquared(goalOnPlane) > maxGoalSnap * maxGoalSnap) {
        return commit(false, "goal-snap-too-far");
      }
      if (
        startOnPlane.distanceToSquared(freeGoal) < 0.1 * 0.1 &&
        hasClearTravelLine(startOnPlane, freeGoal, pathObstacles, navClearance, 0)
      ) {
        return commit(true, "already-near-goal");
      }
      if (hasClearTravelLine(startOnPlane, freeGoal, pathObstacles, navClearance, 0)) {
        return commit(true, "direct-line");
      }
      const pathOptions = Number.isFinite(clearanceOverride)
        ? { clearanceOverride }
        : null;
      const path = computeCatPath(startOnPlane, freeGoal, pathObstacles, 0, allowFallback, false, pathOptions);
      if (isPathTraversable(path, pathObstacles, navClearance, 0)) {
        return commit(true, "path-traversable");
      }

      const blocker = findFirstBlockingObstacleOnLine(startOnPlane, freeGoal, pathObstacles, navClearance, 0);
      if (!blocker) {
        return commit(false, "no-blocker-found");
      }
      const candidates = buildGroundDetourCandidates(blocker, navClearance, 0);
      for (const via of candidates) {
        if (isCatPointBlocked(via.x, via.z, pathObstacles, navClearance, 0)) continue;
        if (!hasGroundPathNoFallback(startOnPlane, via, pathObstacles, navClearance)) continue;
        if (!hasGroundPathNoFallback(via, freeGoal, pathObstacles, navClearance)) continue;
        return commit(true, "two-leg-detour");
      }
      return commit(false, "detour-failed");
    } finally {
      bumpPathProfilerReason("reachReason", profileMeta.ok ? (profileMeta.reason || "ok") : (profileMeta.reason || "unknown"));
      finishPathProfilerMetric("canReachGroundTarget", startedAt, profileMeta, 4.5);
    }
  }

  function ensureCatPath(target, force = false, useDynamic = false, queryY = null, allowFallback = null) {
    const startedAt = performance.now();
    const profileMeta = {
      force: !!force,
      useDynamic: !!useDynamic,
      action: "compute",
      pathLen: 0,
    };
    try {
      const pathY = Number.isFinite(queryY)
        ? queryY
        : (cat.group.position.y > 0.08 ? cat.group.position.y : (Number.isFinite(target?.y) ? target.y : 0));
      const navClearance = getCatPathClearance();
      const builtObstacles = buildCatObstacles(useDynamic, true);
      const pathOptions = getActiveCatPathOptions();
      const obstacles = filterObstaclesForPathOptions(builtObstacles, pathOptions);
      const modeKey = useDynamic ? "dynamic" : "static";
      const requestedTargetOnPlane = new THREE.Vector3(target.x, pathY, target.z);
      const startOnPlane = new THREE.Vector3(cat.pos.x, pathY, cat.pos.z);
      const allowEndpointPushableGoal = true;
      const pathObstacles = allowEndpointPushableGoal
        ? filterEndpointPushableGoalObstacles(requestedTargetOnPlane, obstacles, navClearance, pathY, "plan")
        : obstacles;
      const targetOnPlane = resolveNearestPlanarPathTarget(
        requestedTargetOnPlane,
        pathObstacles,
        navClearance,
        pathY,
        pathOptions,
        startOnPlane
      );
      const navSignature = `${getObstacleSignatureCached(pathObstacles, navClearance)}|${getPathOptionsCacheKey(pathOptions)}`;
      if (pathOptions?.ignorePushableSurfaceId) profileMeta.ignorePushableSurfaceId = String(pathOptions.ignorePushableSurfaceId);
      if (targetOnPlane !== requestedTargetOnPlane) {
        profileMeta.targetAdjusted = true;
        profileMeta.targetAdjustFromX = requestedTargetOnPlane.x;
        profileMeta.targetAdjustFromZ = requestedTargetOnPlane.z;
        profileMeta.targetAdjustToX = targetOnPlane.x;
        profileMeta.targetAdjustToZ = targetOnPlane.z;
      }
      const navChanged = lastPlannedSignature[modeKey] !== navSignature;
      const now = getClockTime();
      const goalDelta = cat.nav.goal.distanceToSquared(targetOnPlane);
      const goalUnchanged = goalDelta < 0.05 * 0.05;
      const allowNavRefreshNow = now >= (cat.nav.repathAt || 0);
      if (!force) {
        if (!navChanged && cat.nav.path.length > 1 && goalUnchanged) {
          bumpPathProfilerCounter("ensureCatPathSkipped");
          profileMeta.action = "skip-existing";
          profileMeta.pathLen = cat.nav.path.length || 0;
          updateLastSolverDebug({
            ensureAction: profileMeta.action,
            ensurePathLen: profileMeta.pathLen,
            ensureUseDynamic: !!useDynamic,
            ensureTargetAdjusted: profileMeta.targetAdjusted ? 1 : 0,
            ensureTargetAdjustFrom: profileMeta.targetAdjusted
              ? `${profileMeta.targetAdjustFromX.toFixed(2)},${profileMeta.targetAdjustFromZ.toFixed(2)}`
              : "",
            ensureTargetAdjustTo: profileMeta.targetAdjusted
              ? `${profileMeta.targetAdjustToX.toFixed(2)},${profileMeta.targetAdjustToZ.toFixed(2)}`
              : "",
          });
          return;
        }
        if (navChanged && goalUnchanged && !allowNavRefreshNow) {
          bumpPathProfilerCounter("ensureCatPathThrottled");
          profileMeta.action = "skip-throttle";
          profileMeta.pathLen = cat.nav.path.length || 0;
          updateLastSolverDebug({
            ensureAction: profileMeta.action,
            ensurePathLen: profileMeta.pathLen,
            ensureUseDynamic: !!useDynamic,
            ensureTargetAdjusted: profileMeta.targetAdjusted ? 1 : 0,
            ensureTargetAdjustFrom: profileMeta.targetAdjusted
              ? `${profileMeta.targetAdjustFromX.toFixed(2)},${profileMeta.targetAdjustFromZ.toFixed(2)}`
              : "",
            ensureTargetAdjustTo: profileMeta.targetAdjusted
              ? `${profileMeta.targetAdjustToX.toFixed(2)},${profileMeta.targetAdjustToZ.toFixed(2)}`
              : "",
          });
          return;
        }
      }
      activeNavMeshMode.includePickups = !!useDynamic;
      activeNavMeshMode.includeClosePickups = true;
      cat.nav.path = computeCatPath(startOnPlane, targetOnPlane, pathObstacles, pathY, allowFallback, true, pathOptions);
      if ((cat.nav.path?.length || 0) <= 1) {
        const solverDebug = cat.nav?.lastSolverDebug && typeof cat.nav.lastSolverDebug === "object"
          ? cat.nav.lastSolverDebug
          : null;
        const blockerInfo = solverDebug?.recastBlockedObstacle
          ? ` blocker=${solverDebug.recastBlockedObstacle}${solverDebug?.recastBlockedPathType ? `/${solverDebug.recastBlockedPathType}` : ""}${Number.isFinite(solverDebug?.recastBlockedSegment) && solverDebug.recastBlockedSegment > 0 ? ` seg=${solverDebug.recastBlockedSegment}` : ""}`
          : "";
        const blockVariants = `${solverDebug?.recastSmoothedBlock ? ` smooth=${solverDebug.recastSmoothedBlock}` : ""}${solverDebug?.recastRawBlock ? ` raw=${solverDebug.recastRawBlock}` : ""}`;
        const projectionInfo = `${solverDebug?.recastStartProjection ? ` startProj=${solverDebug.recastStartProjection}` : ""}${solverDebug?.recastGoalProjection ? ` goalProj=${solverDebug.recastGoalProjection}` : ""}`;
        const pointInfo = `${solverDebug?.recastStartPointBlock ? ` startBlk=${solverDebug.recastStartPointBlock}` : ""}${solverDebug?.recastGoalPointBlock ? ` goalBlk=${solverDebug.recastGoalPointBlock}` : ""}${solverDebug?.recastSampleNavProbe ? ` sampleNav=${solverDebug.recastSampleNavProbe}` : ""}${solverDebug?.recastSolveInputPresence ? ` ${solverDebug.recastSolveInputPresence}` : ""}`;
        const pathShapeInfo = `${solverDebug?.recastRawFirstSegment ? ` ${solverDebug.recastRawFirstSegment}` : ""}${solverDebug?.recastSmoothFirstSegment ? ` ${solverDebug.recastSmoothFirstSegment}` : ""}${solverDebug?.recastRawPathPreview ? ` ${solverDebug.recastRawPathPreview}` : ""}${solverDebug?.recastSmoothPathPreview ? ` ${solverDebug.recastSmoothPathPreview}` : ""}`;
        traceFunction(
          "noPathSolveV14",
          `reason=${solverDebug?.reason || "na"} recast=${solverDebug?.recastReason || "na"} ensure=${profileMeta.action || "compute"}${blockerInfo}${blockVariants}${projectionInfo}${pointInfo}${pathShapeInfo} target=${Number.isFinite(targetOnPlane?.x) ? targetOnPlane.x.toFixed(2) : "na"},${Number.isFinite(targetOnPlane?.z) ? targetOnPlane.z.toFixed(2) : "na"}`
        );
      }
      cat.nav.index = cat.nav.path.length > 1 ? 1 : 0;
      cat.nav.goal.copy(targetOnPlane);
      cat.nav.repathAt = now + CAT_NAV.repathInterval;
      lastPlannedSignature[modeKey] = navSignature;
      bumpPathProfilerCounter("ensureCatPathComputed");
      profileMeta.pathLen = cat.nav.path.length || 0;
    } finally {
      updateLastSolverDebug({
        ensureAction: profileMeta.action || "",
        ensurePathLen: profileMeta.pathLen || 0,
        ensureUseDynamic: !!useDynamic,
        ensureTargetAdjusted: profileMeta.targetAdjusted ? 1 : 0,
        ensureTargetAdjustFrom: profileMeta.targetAdjusted
          ? `${profileMeta.targetAdjustFromX.toFixed(2)},${profileMeta.targetAdjustFromZ.toFixed(2)}`
          : "",
        ensureTargetAdjustTo: profileMeta.targetAdjusted
          ? `${profileMeta.targetAdjustToX.toFixed(2)},${profileMeta.targetAdjustToZ.toFixed(2)}`
          : "",
      });
      finishPathProfilerMetric("ensureCatPath", startedAt, profileMeta, 4.5);
    }
  }

  function ensureCatPathNoFallback(target, force = false, useDynamic = false, queryY = null) {
    return ensureCatPath(target, force, useDynamic, queryY, false);
  }

  async function initPathfinding() {
    await ensureRecastInitialized();
  }

  function invalidateNavCaches() {
    destroyCrowdState();

    if (navMeshCache.static) {
      try { if (navMeshCache.static.tileCache) navMeshCache.static.tileCache.destroy(); } catch {}
      try { navMeshCache.static.navQuery?.destroy(); } catch {}
      try { navMeshCache.static.navMesh?.destroy(); } catch {}
    }
    if (navMeshCache.dynamic && navMeshCache.dynamic !== navMeshCache.static) {
      try { if (navMeshCache.dynamic.tileCache) navMeshCache.dynamic.tileCache.destroy(); } catch {}
      try { navMeshCache.dynamic.navQuery?.destroy(); } catch {}
      try { navMeshCache.dynamic.navMesh?.destroy(); } catch {}
    }
    navMeshCache.static = null;
    navMeshCache.dynamic = null;
    navMeshCache.active = null;

    obstacleBuildCache.clear();
    triangleNavMeshCache.clear();
    pathFamilyCache.clear();
    pathSolveCache.clear();
    reachabilityCache.clear();
    nearestWalkableCache.clear();

    dynamicObstacleSnapshot.at = -1e9;
    dynamicObstacleSnapshot.includePickups = false;
    dynamicObstacleSnapshot.includeClosePickups = false;
    dynamicObstacleSnapshot.signature = "";

    lastPlannedSignature.static = "";
    lastPlannedSignature.dynamic = "";
    lastAStarDebug.mode = "none";
    lastAStarDebug.start = null;
    lastAStarDebug.goal = null;
    lastAStarDebug.edges = [];
    lastAStarDebug.finalPath = [];
    lastAStarDebug.timestamp = 0;
    if (cat.nav && typeof cat.nav === "object") cat.nav.lastSolverDebug = {};
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
    ensureCatPathNoFallback,
    stepDetourCrowdToward,
    resetDetourCrowd: destroyCrowdState,
    invalidateNavCaches,
  };
}
