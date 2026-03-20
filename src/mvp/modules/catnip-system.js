import { catHasNonFloorSurface, isFloorSurfaceId, normalizeSurfaceId } from "./surface-ids.js";

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
    CAT_NAV,
    game,
    cat,
    cup,
    pickups,
    pickupRadius,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    canReachGroundTarget,
    findSafeGroundPoint,
    bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets,
    getSurfaceDefs,
    getSurfaceById,
    getClockTime,
  } = ctx;
  const tempFloorHit = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();
  const CATNIP_SCALE = 0.5;
  const CATNIP_RADIUS = 0.22 * CATNIP_SCALE;
  const CATNIP_HEIGHT = 0.04 * CATNIP_SCALE;
  const CATNIP_HALF_HEIGHT = CATNIP_HEIGHT * 0.5;
  const CATNIP_MOUTH_OFFSET = 0.34;
  const CATNIP_ESCAPE_SAMPLE_COUNT = 12;
  const CATNIP_ESCAPE_MIN_OPEN = 3;
  const CATNIP_ESCAPE_MIN_CONTIGUOUS = 2;
  const CATNIP_ESCAPE_SAMPLE_RADIUS = 0.34;
  const tempEscapeSample = new THREE.Vector3();
  const PATH_PROFILER_SAMPLE_LIMIT = 180;
  const PATH_PROFILER_EVENT_LIMIT = 24;

  function ensurePathProfiler() {
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
        const sx0 = Number(s.minX);
        const sx1 = Number(s.maxX);
        const sz0 = Number(s.minZ);
        const sz1 = Number(s.maxZ);
        const sy = Number(s.y);
        if (![sx0, sx1, sz0, sz1, sy].every(Number.isFinite)) continue;
        const inside =
          x >= sx0 - strictPad &&
          x <= sx1 + strictPad &&
          z >= sz0 - strictPad &&
          z <= sz1 + strictPad;
        if (!inside) continue;
        const dy = Math.abs(sy - y);
        if (dy > maxDy) continue;
        const edgeDist = Math.min(
          Math.abs(x - sx0),
          Math.abs(x - sx1),
          Math.abs(z - sz0),
          Math.abs(z - sz1)
        );
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
      x >= surface.minX - pad &&
      x <= surface.maxX + pad &&
      z >= surface.minZ - pad &&
      z <= surface.maxZ + pad &&
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
      const sx0 = Number(s.minX);
      const sx1 = Number(s.maxX);
      const sz0 = Number(s.minZ);
      const sz1 = Number(s.maxZ);
      const sy = Number(s.y);
      if (![sx0, sx1, sz0, sz1, sy].every(Number.isFinite)) continue;

      const dx = x < sx0 ? sx0 - x : x > sx1 ? x - sx1 : 0;
      const dz = z < sz0 ? sz0 - z : z > sz1 ? z - sz1 : 0;
      const dy = Math.abs(sy - y);
      if (dy > 1.15) continue;

      const surfaceId = String(s.id || s.name || "");
      const preferredBias = preferredSurfaceId && surfaceId === String(preferredSurfaceId) ? -0.18 : 0;
      const score = dx * 1.25 + dz * 1.25 + dy * 1.8 + preferredBias;
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
    return {
      x: THREE.MathUtils.clamp(x, surface.minX + edgePad, surface.maxX - edgePad),
      z: THREE.MathUtils.clamp(z, surface.minZ + edgePad, surface.maxZ - edgePad),
      surface,
    };
  }

  function isInsideNonFloorSurface(surfaceId, x, z, edgePad = 0.18) {
    const surface = getNonFloorSurfaceById(surfaceId);
    if (!surface) return false;
    return (
      x >= surface.minX + edgePad &&
      x <= surface.maxX - edgePad &&
      z >= surface.minZ + edgePad &&
      z <= surface.maxZ - edgePad
    );
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

  function hasGroundEscapeSpace(origin, obstacles, clearance) {
    const startedAt = performance.now();
    let result = false;
    try {
      const ox = Number(origin?.x);
      const oz = Number(origin?.z);
      if (!Number.isFinite(ox) || !Number.isFinite(oz)) return false;
      const sampleRadius = Math.max(CATNIP_ESCAPE_SAMPLE_RADIUS, clearance * 2.1);
      const open = new Array(CATNIP_ESCAPE_SAMPLE_COUNT).fill(false);

      for (let i = 0; i < CATNIP_ESCAPE_SAMPLE_COUNT; i++) {
        const angle = (i / CATNIP_ESCAPE_SAMPLE_COUNT) * Math.PI * 2;
        const sx = ox + Math.cos(angle) * sampleRadius;
        const sz = oz + Math.sin(angle) * sampleRadius;
        if (isCatPointBlocked(sx, sz, obstacles, clearance * 0.92, 0)) continue;
        tempEscapeSample.set(sx, 0, sz);
        if (!canReachGroundTarget(origin, tempEscapeSample, obstacles)) continue;
        open[i] = true;
      }

      const openCount = open.reduce((count, flag) => count + (flag ? 1 : 0), 0);
      if (openCount < CATNIP_ESCAPE_MIN_OPEN) return false;

      let maxRun = 0;
      let run = 0;
      for (let i = 0; i < CATNIP_ESCAPE_SAMPLE_COUNT * 2; i++) {
        if (open[i % CATNIP_ESCAPE_SAMPLE_COUNT]) {
          run++;
          if (run > maxRun) maxRun = run;
        } else {
          run = 0;
        }
      }
      result = Math.min(maxRun, CATNIP_ESCAPE_SAMPLE_COUNT) >= CATNIP_ESCAPE_MIN_CONTIGUOUS;
      return result;
    } finally {
      finishPathProfilerMetric(
        "hasGroundEscapeSpace",
        startedAt,
        {
          phase: "catnip-escape",
          result: result ? "open" : "blocked",
        },
        1.8
      );
    }
  }

  function isValidCatnipSpot(x, z, surface) {
    const startedAt = performance.now();
    let result = false;
    let metaPhase = String(surface || "floor") === "floor" ? "floor" : "surface";
    try {
      tempTo.set(x, 0, z);
    const dynamicObstacles = buildCatObstacles(true, true);
    const staticObstacles = buildCatObstacles(false);
    const clearance = typeof getCatPathClearance === "function" ? getCatPathClearance() : CAT_NAV.clearance;

    if (surface !== "floor") {
      if (!isInsideNonFloorSurface(surface, x, z)) return false;
      const surfaceDef = getNonFloorSurfaceById(surface);
      if (!surfaceDef) return false;
      const surfaceY = surfaceDef.y;
      if (!cup.broken && !cup.falling) {
        if (Math.abs(cup.group.position.y - surfaceY) <= 0.36) {
          const dxCup = x - cup.group.position.x;
          const dzCup = z - cup.group.position.z;
          if (dxCup * dxCup + dzCup * dzCup < 0.42 * 0.42) return false;
        }
      }
      for (const p of pickups) {
        if (Math.abs(p.mesh.position.y - surfaceY) > 0.3) continue;
        const dx = x - p.mesh.position.x;
        const dz = z - p.mesh.position.z;
        const rr = pickupRadius(p) + 0.2;
        if (dx * dx + dz * dz < rr * rr) return false;
      }
      const sourceSurfaceId = getCurrentCatSurfaceId();
      if (sourceSurfaceId === surface && Math.abs(cat.group.position.y - surfaceY) <= 0.16) { result = true; return true; }
      tempFrom.set(cat.pos.x, sourceSurfaceId === "floor" ? 0 : Math.max(0.02, cat.group.position.y), cat.pos.z);
      const resolveWithSource = (sourceId, sourcePoint) => {
        const planningSource =
          sourceId === "floor"
            ? (() => {
                const s = findSafeGroundPoint(new THREE.Vector3(sourcePoint.x, 0, sourcePoint.z));
                s.y = 0;
                return s;
              })()
            : sourcePoint;
        if (typeof bestSurfaceJumpAnchor !== "function" || typeof computeSurfaceJumpTargets !== "function") {
          return false;
        }
        const anchor = bestSurfaceJumpAnchor(surface, planningSource, tempTo, sourceId);
        if (!anchor) return false;
        if (sourceId === "floor" && !canReachGroundTarget(planningSource, anchor, dynamicObstacles)) return false;
        const targets = computeSurfaceJumpTargets(surface, anchor, tempTo, sourceId);
        return !!targets?.top;
      };
      if (resolveWithSource(sourceSurfaceId, tempFrom)) { result = true; return true; }
      if (sourceSurfaceId !== "floor") {
        const floorStart = findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
        floorStart.y = 0;
        if (resolveWithSource("floor", floorStart)) { result = true; return true; }
      }
      return false;
    }

    if (isCatPointBlocked(tempTo.x, tempTo.z, staticObstacles, clearance)) return false;
    for (const p of pickups) {
      if (p.mesh.position.y > 0.34) continue;
      const dx = x - p.mesh.position.x;
      const dz = z - p.mesh.position.z;
      const rr = pickupRadius(p) + 0.28;
      if (dx * dx + dz * dz < rr * rr) return false;
    }

    const start = findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
    if (!hasGroundEscapeSpace(tempTo, dynamicObstacles, clearance)) return false;
    if (!canReachGroundTarget(start, tempTo, dynamicObstacles)) return false;

    // Validate the same approach offset used by cat behavior; fall back to center path if offset is blocked.
    const approach = buildCatnipApproachPoint(x, z, start, "floor");
    const approachBlockedStatic = isCatPointBlocked(approach.x, approach.z, staticObstacles, clearance);
    if (
      !approachBlockedStatic &&
      hasGroundEscapeSpace(approach, dynamicObstacles, clearance) &&
      canReachGroundTarget(start, approach, dynamicObstacles)
    ) {
      result = true;
      return true;
    }
    result = canReachGroundTarget(start, tempTo, dynamicObstacles);
    return result;
    } finally {
      finishPathProfilerMetric(
        "isValidCatnipSpot",
        startedAt,
        {
          phase: metaPhase,
          surface: String(surface || "floor"),
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
          y: clamped.surface.y - 0.02 + CATNIP_HALF_HEIGHT,
          surfaceY: clamped.surface.y,
        };
        return placement;
      }

      if (!floorHit) return null;
      placement = {
        surface: "floor",
        x: THREE.MathUtils.clamp(floorHit.x, ROOM.minX + 0.6, ROOM.maxX - 0.6),
        z: THREE.MathUtils.clamp(floorHit.z, ROOM.minZ + 0.6, ROOM.maxZ - 0.6),
        y: CATNIP_HALF_HEIGHT,
        surfaceY: 0,
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
      // Block new catnip placement while cat is mid-air / mid-jump.
      if (cat.jump || (!catHasNonFloorSurface(cat) && cat.group.position.y > 0.08)) {
        result = "blocked-midair";
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
        expiresAt: clockTime + 7,
      };
      game.catnipCooldownUntil = game.catnip.expiresAt;
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
