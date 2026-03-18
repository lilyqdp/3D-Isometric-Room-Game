import { FLOOR_SURFACE_ID, catHasNonFloorSurface, isFloorSurfaceId, isNonFloorSurfaceId, normalizeSurfaceId, setCatSurfaceId, targetSurfaceId } from "./surface-ids.js";

export function createDebugControlsRuntime(ctx) {
  const {
    THREE,
    scene,
    camera,
    raycaster,
    mouse,
    floorPlane,
    tempV3,
    ROOM,
    CAT_NAV,
    CAT_COLLISION,
    desk,
    cat,
    cup,
    pickups,
    game,
    navRuntime,
    getClockTime,
    getDebugRoot,
    queueSharedDebugRouteRequest,
    clearCatJumpTargets,
    clearCatNavPath,
    resetCatJumpBypass,
    resetCatUnstuckTracking,
    getSurfaceDefs,
    getSurfaceById,
    getElevatedSurfaceDefs,
  } = ctx;

  function isDescendantOf(node, parent) {
    let cur = node;
    while (cur) {
      if (cur === parent) return true;
      cur = cur.parent;
    }
    return false;
  }

  function isIgnoredDebugHitObject(object) {
    if (!object || !object.visible) return true;
    const debugRoot = typeof getDebugRoot === "function" ? getDebugRoot() : null;
    if (debugRoot && isDescendantOf(object, debugRoot)) return true;
    if (isDescendantOf(object, cat.group)) return true;
    if (isDescendantOf(object, cup.group)) return true;
    if (game.catnip?.mesh && isDescendantOf(object, game.catnip.mesh)) return true;
    for (const pickup of pickups) {
      if (pickup?.mesh && isDescendantOf(object, pickup.mesh)) return true;
    }
    return false;
  }

  function clampToRoomFloor(point) {
    const minX = ROOM.minX + CAT_NAV.margin;
    const maxX = ROOM.maxX - CAT_NAV.margin;
    const minZ = ROOM.minZ + CAT_NAV.margin;
    const maxZ = ROOM.maxZ - CAT_NAV.margin;
    return new THREE.Vector3(
      THREE.MathUtils.clamp(point.x, minX, maxX),
      0,
      THREE.MathUtils.clamp(point.z, minZ, maxZ)
    );
  }

  function clampPointToSurface(surface, point, margin = CAT_COLLISION.catBodyRadius + 0.04) {
    const minX = Number.isFinite(surface.minX) ? surface.minX + margin : point.x;
    const maxX = Number.isFinite(surface.maxX) ? surface.maxX - margin : point.x;
    const minZ = Number.isFinite(surface.minZ) ? surface.minZ + margin : point.z;
    const maxZ = Number.isFinite(surface.maxZ) ? surface.maxZ - margin : point.z;
    const x = minX <= maxX ? THREE.MathUtils.clamp(point.x, minX, maxX) : point.x;
    const z = minZ <= maxZ ? THREE.MathUtils.clamp(point.z, minZ, maxZ) : point.z;
    const y = Number.isFinite(surface.y) ? surface.y : point.y;
    return new THREE.Vector3(x, y, z);
  }

  function findSurfaceTeleportPoint(surface, point) {
    const clamped = clampPointToSurface(surface, point);
    if (hasNavAreaAt(clamped.x, clamped.z, clamped.y)) return clamped;

    const radii = [0.08, 0.16, 0.24, 0.32];
    const dirs = 16;
    for (const r of radii) {
      for (let i = 0; i < dirs; i++) {
        const t = (i / dirs) * Math.PI * 2;
        const probe = new THREE.Vector3(
          clamped.x + Math.cos(t) * r,
          clamped.y,
          clamped.z + Math.sin(t) * r
        );
        const candidate = clampPointToSurface(surface, probe);
        if (hasNavAreaAt(candidate.x, candidate.z, candidate.y)) return candidate;
      }
    }

    // Teleport should still land on the clicked walkable surface even if debug nav sampling misses.
    return clamped;
  }

  function getGroundPlanningStart(fromPos = cat.pos) {
    const start = new THREE.Vector3(fromPos.x, 0, fromPos.z);
    return navRuntime.findSafeGroundPoint(start);
  }

  function getNonFloorSurfaceById(surfaceId) {
    if (!surfaceId || surfaceId === "floor") return null;
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : getElevatedSurfaceDefs(true);
    if (!Array.isArray(defs)) return null;
    return defs.find((s) => String(s?.id || s?.name || "") === String(surfaceId)) || null;
  }

  function getRoutePointY(point, fallback = 0) {
    return Number.isFinite(point?.y) ? Number(point.y) : fallback;
  }

  function hydrateRoutePointHeights(route = null) {
    const activeRoute = route || cat.nav?.route || null;
    if (!activeRoute) return activeRoute;
    const targetY = isNonFloorSurfaceId(activeRoute.surfaceId)
      ? Math.max(0.02, getRoutePointY(activeRoute.target, Number(activeRoute.y) || 0.02))
      : 0;
    const finalSurfaceId = String(activeRoute.finalSurfaceId || activeRoute.surfaceId || "floor");
    const finalY = finalSurfaceId === "floor"
      ? 0
      : Math.max(0.02, getRoutePointY(activeRoute.finalTarget, Number(activeRoute.finalY) || targetY || 0.02));
    const jumpDownY = getRoutePointY(activeRoute.jumpDown, Number(activeRoute.jumpDownY) || 0);
    if (activeRoute.target?.set) activeRoute.target.y = targetY;
    if (activeRoute.finalTarget?.set) activeRoute.finalTarget.y = finalY;
    if (activeRoute.jumpDown?.set) activeRoute.jumpDown.y = jumpDownY;
    activeRoute.y = targetY;
    activeRoute.finalY = finalY;
    activeRoute.jumpDownY = jumpDownY;
    return activeRoute;
  }

  function ensureNavRoute() {
    if (!cat.nav.route || typeof cat.nav.route !== "object") cat.nav.route = {};
    const route = cat.nav.route;
    if (!route.target || typeof route.target.set !== "function") route.target = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    if (!route.finalTarget || typeof route.finalTarget.set !== "function") route.finalTarget = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    if (!route.jumpAnchor || typeof route.jumpAnchor.set !== "function") route.jumpAnchor = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    if (!route.landing || typeof route.landing.set !== "function") route.landing = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    if (!route.jumpOff || typeof route.jumpOff.set !== "function") route.jumpOff = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    if (!route.jumpDown || typeof route.jumpDown.set !== "function") route.jumpDown = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    if (typeof route.active !== "boolean") route.active = false;
    if (!route.source) route.source = "";
    route.surfaceId = normalizeSurfaceId(route.surfaceId || route.finalSurfaceId || cat.nav?.surfaceState?.currentSurfaceId);
    route.finalSurfaceId = normalizeSurfaceId(route.finalSurfaceId || route.surfaceId);
    route.y = Number.isFinite(route.y) ? route.y : 0;
    route.finalY = Number.isFinite(route.finalY) ? route.finalY : 0;
    route.jumpDownY = Number.isFinite(route.jumpDownY) ? route.jumpDownY : 0;
    route.directJump = !!route.directJump;
    route.approachSurfaceId = String(route.approachSurfaceId || "floor");
    route.sitSeconds = Number.isFinite(route.sitSeconds) ? route.sitSeconds : 0;
    route.recoverAt = Number.isFinite(route.recoverAt) ? route.recoverAt : 0;
    route.createdAt = Number.isFinite(route.createdAt) ? route.createdAt : 0;
    route.blockedSince = Number.isFinite(route.blockedSince) ? route.blockedSince : 0;
    route.blockedReason = route.blockedReason ? String(route.blockedReason) : "";
    route.lastProgressAt = Number.isFinite(route.lastProgressAt) ? route.lastProgressAt : 0;
    route.lastProgressX = Number.isFinite(route.lastProgressX) ? route.lastProgressX : cat.pos.x;
    route.lastProgressZ = Number.isFinite(route.lastProgressZ) ? route.lastProgressZ : cat.pos.z;
    if (!Array.isArray(route.segments)) route.segments = [];
    route.segmentIndex = Number.isFinite(route.segmentIndex) ? Math.max(0, route.segmentIndex | 0) : 0;
    route.segmentEnteredAt = Number.isFinite(route.segmentEnteredAt) ? route.segmentEnteredAt : 0;
    route.segmentReason = route.segmentReason ? String(route.segmentReason) : "";
    route.segmentProgressAt = Number.isFinite(route.segmentProgressAt) ? route.segmentProgressAt : 0;
    route.segmentProgressX = Number.isFinite(route.segmentProgressX) ? route.segmentProgressX : cat.pos.x;
    route.segmentProgressZ = Number.isFinite(route.segmentProgressZ) ? route.segmentProgressZ : cat.pos.z;
    route.segmentProgressDist = Number.isFinite(route.segmentProgressDist) ? route.segmentProgressDist : Infinity;
    hydrateRoutePointHeights(route);
    return route;
  }

  function syncRouteFromDebugMove(sourceOverride = null) {
    const route = ensureNavRoute();
    const wasActive = !!route.active;
    const now = typeof getClockTime === "function" ? Number(getClockTime()) : 0;
    route.active = !!cat.debugMoveActive;
    route.surfaceId = normalizeSurfaceId(cat.debugMoveSurfaceId || cat.debugMoveFinalSurfaceId || (Number(cat.debugMoveY) > 0.02 ? cat.nav?.surfaceState?.currentSurfaceId : FLOOR_SURFACE_ID));
    route.finalSurfaceId = normalizeSurfaceId(cat.debugMoveFinalSurfaceId || route.surfaceId);
    route.y = Number.isFinite(cat.debugMoveY) ? cat.debugMoveY : 0;
    route.finalY = Number.isFinite(cat.debugMoveFinalY) ? cat.debugMoveFinalY : 0;
    route.jumpDownY = Number.isFinite(cat.debugMoveJumpDownY) ? cat.debugMoveJumpDownY : 0;
    route.directJump = !!cat.debugMoveDirectJump;
    route.approachSurfaceId = String(cat.nav.debugMoveApproachSurfaceId || (route.directJump ? route.surfaceId : "floor"));
    route.sitSeconds = Number.isFinite(cat.debugMoveSitSeconds) ? cat.debugMoveSitSeconds : 0;
    route.recoverAt = Number.isFinite(cat.nav.debugMoveRecoverAt) ? cat.nav.debugMoveRecoverAt : 0;
    if (cat.debugMoveTarget?.copy) route.target.copy(cat.debugMoveTarget);
    if (cat.debugMoveFinalTarget?.copy) route.finalTarget.copy(cat.debugMoveFinalTarget);
    if (cat.debugMoveJumpAnchor?.copy) route.jumpAnchor.copy(cat.debugMoveJumpAnchor);
    if (cat.debugMoveLanding?.copy) route.landing.copy(cat.debugMoveLanding);
    if (cat.debugMoveJumpOff?.copy) route.jumpOff.copy(cat.debugMoveJumpOff);
    if (cat.debugMoveJumpDown?.copy) route.jumpDown.copy(cat.debugMoveJumpDown);
    hydrateRoutePointHeights(route);
    if (sourceOverride != null) route.source = String(sourceOverride);
    if (sourceOverride != null || (route.active && !wasActive)) {
      route.createdAt = Number.isFinite(now) ? now : 0;
      route.blockedSince = 0;
      route.blockedReason = "";
      route.lastProgressAt = route.active && Number.isFinite(now) ? now : 0;
      route.lastProgressX = cat.pos.x;
      route.lastProgressZ = cat.pos.z;
      route.segmentProgressAt = route.active && Number.isFinite(now) ? now : 0;
      route.segmentProgressX = cat.pos.x;
      route.segmentProgressZ = cat.pos.z;
      route.segmentProgressDist = Infinity;
    }
    return route;
  }

  function getCurrentCatSurface(fromPos = cat.pos) {
    if (!catHasNonFloorSurface(cat)) {
      return { id: FLOOR_SURFACE_ID, y: 0 };
    }
    const surface = getNonFloorSurfaceAt(fromPos, cat.group.position.y);
    if (surface) {
      return {
        id: normalizeSurfaceId(surface.id || surface.name || cat.nav?.surfaceState?.currentSurfaceId, FLOOR_SURFACE_ID),
        y: Number.isFinite(surface.y) ? surface.y : Math.max(0.02, cat.group.position.y),
      };
    }
    const fallbackId = normalizeSurfaceId(
      cat.nav?.surfaceState?.currentSurfaceId || cat.debugMoveSurfaceId || FLOOR_SURFACE_ID,
      FLOOR_SURFACE_ID
    );
    const fallbackY = Number.isFinite(cat.group.position.y)
      ? Math.max(0.02, cat.group.position.y)
      : (Number.isFinite(cat.debugMoveY) ? Math.max(0.02, cat.debugMoveY) : 0.02);
    return { id: fallbackId, y: fallbackY };
  }

  function getTargetSurfaceId(target, fallback = FLOOR_SURFACE_ID) {
    return targetSurfaceId(target, fallback);
  }

  function targetUsesNonFloorSurface(target) {
    return isNonFloorSurfaceId(getTargetSurfaceId(target));
  }

  function pointInTriangleXZ(px, pz, ax, az, bx, bz, cx, cz) {
    const v0x = cx - ax;
    const v0z = cz - az;
    const v1x = bx - ax;
    const v1z = bz - az;
    const v2x = px - ax;
    const v2z = pz - az;
    const dot00 = v0x * v0x + v0z * v0z;
    const dot01 = v0x * v1x + v0z * v1z;
    const dot02 = v0x * v2x + v0z * v2z;
    const dot11 = v1x * v1x + v1z * v1z;
    const dot12 = v1x * v2x + v1z * v2z;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-9) return false;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    return u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001;
  }

  function hasNavAreaAt(x, z, yHint = 0) {
    const nav = navRuntime.getNavMeshDebugData(true, true);
    if (!nav) return false;

    const probes = [
      [x, z],
      [x + 0.06, z],
      [x - 0.06, z],
      [x, z + 0.06],
      [x, z - 0.06],
      [x + 0.12, z],
      [x - 0.12, z],
      [x, z + 0.12],
      [x, z - 0.12],
    ];

    const yTol = 0.28;
    const triData = Array.isArray(nav.triangles) ? nav.triangles : [];
    if (triData.length >= 9 && typeof triData[0] === "number") {
      for (let i = 0; i < triData.length; i += 9) {
        const ax = triData[i];
        const ay = triData[i + 1];
        const az = triData[i + 2];
        const bx = triData[i + 3];
        const by = triData[i + 4];
        const bz = triData[i + 5];
        const cx = triData[i + 6];
        const cy = triData[i + 7];
        const cz = triData[i + 8];
        const triY = (ay + by + cy) / 3;
        if (Math.abs(triY - yHint) > yTol) continue;
        for (const [px, pz] of probes) {
          if (pointInTriangleXZ(px, pz, ax, az, bx, bz, cx, cz)) return true;
        }
      }
      return false;
    }

    if (Array.isArray(nav.vertices) && Array.isArray(nav.triangles)) {
      for (const tri of nav.triangles) {
        const a = nav.vertices[tri.a];
        const b = nav.vertices[tri.b];
        const c = nav.vertices[tri.c];
        if (!a || !b || !c) continue;
        const triY = ((a.y || 0) + (b.y || 0) + (c.y || 0)) / 3;
        if (Math.abs(triY - yHint) > yTol) continue;
        for (const [px, pz] of probes) {
          if (pointInTriangleXZ(px, pz, a.x, a.z, b.x, b.z, c.x, c.z)) return true;
        }
      }
    }
    return false;
  }

  function buildSurfaceWaypointPlan(surface, wantedPoint, fromPos = cat.pos) {
    const snappedPoint = findSurfaceTeleportPoint(surface, wantedPoint);
    const targetX = snappedPoint.x;
    const targetZ = snappedPoint.z;
    const target = new THREE.Vector3(targetX, 0, targetZ);
    const surfaceId = normalizeSurfaceId(surface?.id || surface?.name || FLOOR_SURFACE_ID);
    const sourceSurface = getCurrentCatSurface(fromPos);
    if (sourceSurface.id === surfaceId) {
      return {
        surfaceId,
        point: new THREE.Vector3(targetX, surface.y, targetZ),
        finalSurfaceId: surfaceId,
        finalPoint: new THREE.Vector3(targetX, surface.y, targetZ),
        floorPoint: clampToRoomFloor(wantedPoint),
      };
    }
    const planningStart = sourceSurface.id === "floor"
      ? getGroundPlanningStart(fromPos)
      : new THREE.Vector3(fromPos.x, sourceSurface.y, fromPos.z);
    const dynamicObstacles = navRuntime.buildCatObstacles(true, true);
    const anchor = typeof navRuntime.bestSurfaceJumpAnchor === "function"
      ? navRuntime.bestSurfaceJumpAnchor(
          surfaceId,
          planningStart,
          target,
          sourceSurface.id
        )
      : navRuntime.bestDeskJumpAnchor(planningStart, target);
    if (!anchor) {
      // Fallback: if direct surface-to-surface linking is unavailable, route via floor
      // and keep final target on the requested surface.
      if (sourceSurface.id !== "floor") {
        const floorPoint = clampToRoomFloor(wantedPoint);
        return {
          surfaceId: FLOOR_SURFACE_ID,
          point: floorPoint.clone(),
          floorPoint,
          finalSurfaceId: surfaceId,
          finalPoint: new THREE.Vector3(targetX, surface.y, targetZ),
        };
      }
      return null;
    }
    if (sourceSurface.id === "floor" && !navRuntime.canReachGroundTarget(planningStart, anchor, dynamicObstacles)) {
      return null;
    }
    const jumpTargets = typeof navRuntime.computeSurfaceJumpTargets === "function"
      ? navRuntime.computeSurfaceJumpTargets(
          surfaceId,
          anchor,
          target,
          sourceSurface.id
        )
      : navRuntime.computeDeskJumpTargets(anchor, target);
    if (!jumpTargets?.top) {
      if (sourceSurface.id !== "floor") {
        const floorPoint = clampToRoomFloor(wantedPoint);
        return {
          surfaceId: FLOOR_SURFACE_ID,
          point: floorPoint.clone(),
          floorPoint,
          finalSurfaceId: surfaceId,
          finalPoint: new THREE.Vector3(targetX, surface.y, targetZ),
        };
      }
      return null;
    }
    const hopSurfaceId = String(jumpTargets.surfaceId || surfaceId);
    if (hopSurfaceId === "floor") {
      const hopFloor = clampToRoomFloor(jumpTargets.top);
      return {
        surfaceId: FLOOR_SURFACE_ID,
        point: hopFloor.clone(),
        floorPoint: hopFloor,
        finalSurfaceId: surfaceId,
        finalPoint: new THREE.Vector3(targetX, surface.y, targetZ),
      };
    }
    const hopSurfaceDef = getNonFloorSurfaceById(hopSurfaceId);
    const hopY = Number.isFinite(hopSurfaceDef?.y)
      ? hopSurfaceDef.y
      : (hopSurfaceId === surfaceId ? surface.y : jumpTargets.top.y);
    const hopPoint = hopSurfaceId === surfaceId
      ? new THREE.Vector3(targetX, hopY, targetZ)
      : new THREE.Vector3(jumpTargets.top.x, hopY, jumpTargets.top.z);
    return {
      surfaceId: hopSurfaceId,
      point: hopPoint,
      finalSurfaceId: surfaceId,
      finalPoint: new THREE.Vector3(targetX, surface.y, targetZ),
      floorPoint: clampToRoomFloor(wantedPoint),
      jumpAnchor: anchor.clone(),
      jumpLanding: jumpTargets.top.clone(),
      directJump: sourceSurface.id !== "floor",
    };
  }

  function getMouseDebugSurfaceTarget() {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      if (!hit?.object || !hit?.point) continue;
      if (isIgnoredDebugHitObject(hit.object)) continue;
      if (!hit.face) continue;
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (worldNormal.y < 0.45) continue;

      const point = hit.point.clone();
      const surface = hit.object.userData?.catSurface;
      if (surface) {
        const surfaceY = Number.isFinite(surface.y) ? surface.y : point.y + 0.02;
        const plan = buildSurfaceWaypointPlan(
          {
            id: normalizeSurfaceId(surface.id || surface.name || FLOOR_SURFACE_ID),
            minX: Number.isFinite(surface.minX) ? surface.minX : point.x,
            maxX: Number.isFinite(surface.maxX) ? surface.maxX : point.x,
            minZ: Number.isFinite(surface.minZ) ? surface.minZ : point.z,
            maxZ: Number.isFinite(surface.maxZ) ? surface.maxZ : point.z,
            y: surfaceY,
          },
          point,
          cat.pos
        );
        if (plan) return plan;
        continue;
      }

      const hitSurface = getNonFloorSurfaceAt(point, point.y);
      if (hitSurface) {
        const plan = buildSurfaceWaypointPlan(hitSurface, point, cat.pos);
        if (plan) return plan;
      }

      const floorPoint = clampToRoomFloor(point);
      if (hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) {
        return {
          surfaceId: FLOOR_SURFACE_ID,
          point: floorPoint.clone(),
          floorPoint,
        };
      }
    }

    if (!raycaster.ray.intersectPlane(floorPlane, tempV3)) return null;
    const floorPoint = clampToRoomFloor(tempV3);
    if (!hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) return null;
    return { surfaceId: FLOOR_SURFACE_ID, point: floorPoint.clone(), floorPoint };
  }

  function getNonFloorSurfaceAt(point, y) {
    if (y <= 0.08) return null;
    const surfaces = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : getElevatedSurfaceDefs(true);
    let best = null;
    let bestScore = Infinity;
    for (const surface of surfaces) {
      const pad = 0.22;
      const inside =
        point.x >= surface.minX - pad &&
        point.x <= surface.maxX + pad &&
        point.z >= surface.minZ - pad &&
        point.z <= surface.maxZ + pad;
      if (!inside) continue;
      const dy = Math.abs(surface.y - y);
      if (dy > 0.36) continue;
      const edgeDist = Math.min(
        Math.abs(point.x - surface.minX),
        Math.abs(point.x - surface.maxX),
        Math.abs(point.z - surface.minZ),
        Math.abs(point.z - surface.maxZ)
      );
      const score = dy + edgeDist * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = surface;
      }
    }
    return best;
  }

  function getMouseDebugTeleportTarget() {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      if (!hit?.object || !hit?.point || !hit.face) continue;
      if (isIgnoredDebugHitObject(hit.object)) continue;
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (worldNormal.y < 0.45) continue;

      const point = hit.point.clone();
      const surface = hit.object.userData?.catSurface;
      if (surface) {
        const surfaceDef = {
          y: Number.isFinite(surface.y) ? surface.y : point.y + 0.02,
          minX: Number.isFinite(surface.minX) ? surface.minX : point.x,
          maxX: Number.isFinite(surface.maxX) ? surface.maxX : point.x,
          minZ: Number.isFinite(surface.minZ) ? surface.minZ : point.z,
          maxZ: Number.isFinite(surface.maxZ) ? surface.maxZ : point.z,
        };
        const surfacePoint = findSurfaceTeleportPoint(surfaceDef, point);
        return {
          surfaceId: normalizeSurfaceId(surface.id || surface.name || FLOOR_SURFACE_ID),
          point: surfacePoint,
          floorPoint: clampToRoomFloor(point),
        };
      }

      const hitSurface = getNonFloorSurfaceAt(point, point.y);
      if (hitSurface) {
        const surfacePoint = findSurfaceTeleportPoint(hitSurface, point);
        return {
          surfaceId: normalizeSurfaceId(hitSurface.id || hitSurface.name || FLOOR_SURFACE_ID),
          point: surfacePoint,
          floorPoint: clampToRoomFloor(point),
        };
      }

      const floorPoint = clampToRoomFloor(point);
      if (hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) {
        return { surfaceId: FLOOR_SURFACE_ID, point: floorPoint.clone(), floorPoint };
      }
    }

    if (!raycaster.ray.intersectPlane(floorPlane, tempV3)) return null;
    const floorPoint = clampToRoomFloor(tempV3);
    if (!hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) return null;
    return { surfaceId: FLOOR_SURFACE_ID, point: floorPoint.clone(), floorPoint };
  }

  function updateDebugJumpDownPlan(towardGroundPoint = null, force = false, desiredLandingSurfaceId = null) {
    if (!cat.nav.jumpDownDebug || typeof cat.nav.jumpDownDebug !== "object") cat.nav.jumpDownDebug = {};
    if (!force) {
      const off = cat.debugMoveJumpOff;
      const down = cat.debugMoveJumpDown;
      if (
        Number.isFinite(off?.x) &&
        Number.isFinite(off?.z) &&
        Number.isFinite(down?.x) &&
        Number.isFinite(down?.z) &&
        cat.pos.distanceToSquared(off) > 0.03 * 0.03
      ) {
        cat.nav.jumpDownDebug.planPhase = "reuse-current";
        cat.nav.jumpDownDebug.planReuse = true;
        cat.nav.jumpDownDebug.planRefreshSkipped = true;
        cat.nav.jumpDownDebug.planSkipReason = "already-approaching-jump-off";
        return true;
      }
    }
    const sourceSurface = getNonFloorSurfaceAt(cat.pos, cat.group.position.y);
    const surfaceId = normalizeSurfaceId(sourceSurface?.id || cat.debugMoveSurfaceId || cat.nav?.surfaceState?.currentSurfaceId || FLOOR_SURFACE_ID);
    const fromY = Number.isFinite(sourceSurface?.y)
      ? sourceSurface.y
      : (Number.isFinite(cat.debugMoveY) && cat.debugMoveY > 0.02 ? cat.debugMoveY : desk.topY + 0.02);
    const fromTopPoint = new THREE.Vector3(cat.pos.x, fromY, cat.pos.z);
    cat.nav.jumpDownDebug.planPhase = "recompute";
    cat.nav.jumpDownDebug.planReuse = false;
    cat.nav.jumpDownDebug.planRefreshSkipped = false;
    cat.nav.jumpDownDebug.planSourceSurfaceId = surfaceId;
    cat.nav.jumpDownDebug.planDesiredLandingSurfaceId =
      desiredLandingSurfaceId == null || desiredLandingSurfaceId === ""
        ? normalizeSurfaceId(cat.nav.jumpDownLandingSurfaceId || FLOOR_SURFACE_ID)
        : String(desiredLandingSurfaceId);
    cat.nav.jumpDownDebug.planFromX = fromTopPoint.x;
    cat.nav.jumpDownDebug.planFromY = fromTopPoint.y;
    cat.nav.jumpDownDebug.planFromZ = fromTopPoint.z;
    cat.nav.jumpDownDebug.planTowardX = Number.isFinite(towardGroundPoint?.x) ? towardGroundPoint.x : NaN;
    cat.nav.jumpDownDebug.planTowardZ = Number.isFinite(towardGroundPoint?.z) ? towardGroundPoint.z : NaN;
    const plan = typeof navRuntime.computeSurfaceJumpDownTargets === "function"
      ? navRuntime.computeSurfaceJumpDownTargets(
          surfaceId,
          fromTopPoint,
          towardGroundPoint,
          desiredLandingSurfaceId
        )
      : navRuntime.computeDeskJumpDownTargets(fromTopPoint, towardGroundPoint);
    if (!plan) {
      cat.nav.jumpDownDebug.planPhase = "recompute-failed";
      cat.nav.jumpDownDebug.planFailure = "planner-returned-null";
      return false;
    }
    cat.debugMoveJumpOff.copy(plan.top);
    cat.debugMoveJumpDown.copy(plan.jumpFrom);
    cat.debugMoveJumpDownY = Number.isFinite(plan.jumpFrom?.y) ? plan.jumpFrom.y : 0;
    syncRouteFromDebugMove();
    cat.nav.jumpDownDebug.planPhase = "recompute-ok";
    cat.nav.jumpDownDebug.planFailure = "";
    cat.nav.jumpDownDebug.planJumpOffX = plan.top.x;
    cat.nav.jumpDownDebug.planJumpOffY = Number.isFinite(plan.top.y) ? plan.top.y : fromY;
    cat.nav.jumpDownDebug.planJumpOffZ = plan.top.z;
    cat.nav.jumpDownDebug.planJumpDownX = plan.jumpFrom.x;
    cat.nav.jumpDownDebug.planJumpDownY = Number.isFinite(plan.jumpFrom?.y) ? plan.jumpFrom.y : 0;
    cat.nav.jumpDownDebug.planJumpDownZ = plan.jumpFrom.z;
    cat.nav.jumpDownDebug.planTopWasClamped = !!plan.topWasClamped;
    return true;
  }

  function moveCatToDebugClickTarget() {
    if (cat.jump || (!catHasNonFloorSurface(cat) && cat.group.position.y > 0.08)) return false;
    const target = getMouseDebugSurfaceTarget();
    if (!target) return false;

    const finalSurfaceId = normalizeSurfaceId(target.finalSurfaceId || getTargetSurfaceId(target));
    const rawFinalPoint = target.finalPoint || target.point || target.floorPoint;
    if (!rawFinalPoint) return false;
    const finalPoint = finalSurfaceId === "floor"
      ? navRuntime.findSafeGroundPoint(new THREE.Vector3(rawFinalPoint.x, 0, rawFinalPoint.z))
      : new THREE.Vector3(rawFinalPoint.x, Number(rawFinalPoint?.y || target.point?.y || 0.02), rawFinalPoint.z);

    clearCatJumpTargets();
    clearCatNavPath(true);
    resetCatJumpBypass();
    resetCatUnstuckTracking();
    cat.nav.stuckT = 0;
    cat.manualPatrolActive = false;
    cat.debugMoveActive = false;
    cat.nav.jumpDownPlanValid = false;
    cat.nav.jumpDownToward = null;
    cat.nav.jumpDownLandingSurfaceId = null;
    cat.state = "patrol";
    cat.lastState = "debugMove";
    cat.stateT = 0;
    cat.phaseT = 0;
    cat.nav.debugDestination.set(finalPoint.x, Number(finalPoint?.y || 0), finalPoint.z);

    if (typeof queueSharedDebugRouteRequest === "function") {
      return !!queueSharedDebugRouteRequest({
        finalSurfaceId,
        finalPoint,
        sitSeconds: 0,
        source: "debug-click",
        forceReplan: true,
        lastState: "debugMove",
        failStatus: "No route to click",
      });
    }

    return false;
  }

  function teleportCatToDebugMouseTarget() {
    const target = getMouseDebugTeleportTarget();
    if (!target) return false;

    clearCatJumpTargets();
    clearCatNavPath(true);
    resetCatJumpBypass();
    resetCatUnstuckTracking();
    cat.nav.stuckT = 0;
    cat.nav.jumpDownLandingSurfaceId = null;
    navRuntime.clearActiveJump();
    cat.debugMoveActive = false;
    cat.debugMoveSurfaceId = getTargetSurfaceId(target);
    cat.debugMoveY = isNonFloorSurfaceId(cat.debugMoveSurfaceId) ? target.point.y : 0;
    cat.debugMoveFinalSurfaceId = normalizeSurfaceId(target.finalSurfaceId || cat.debugMoveSurfaceId);
    const finalTeleportPoint =
      target.finalPoint || target.point;
    cat.debugMoveFinalY =
      cat.debugMoveFinalSurfaceId === "floor"
        ? 0
        : Number(finalTeleportPoint.y || cat.debugMoveY || 0.02);
    cat.debugMoveFinalTarget.set(finalTeleportPoint.x, cat.debugMoveFinalY, finalTeleportPoint.z);
    cat.debugMoveDirectJump = false;
    cat.debugMoveSitSeconds = 0;
    const landingPoint =
      isFloorSurfaceId(cat.debugMoveSurfaceId) ? navRuntime.findSafeGroundPoint(target.floorPoint) : target.point.clone();
    cat.debugMoveTarget.copy(landingPoint);
    if (target.jumpAnchor) cat.debugMoveJumpAnchor.copy(target.jumpAnchor);
    else cat.debugMoveJumpAnchor.copy(landingPoint);
    if (target.jumpLanding) cat.debugMoveLanding.copy(target.jumpLanding);
    else cat.debugMoveLanding.copy(landingPoint);
    cat.debugMoveJumpOff.copy(cat.debugMoveLanding);
    cat.debugMoveJumpDown.copy(landingPoint);
    cat.debugMoveJumpDownY = 0;
    cat.pos.set(landingPoint.x, 0, landingPoint.z);
    cat.group.position.set(landingPoint.x, cat.debugMoveY, landingPoint.z);
    setCatSurfaceId(cat, cat.debugMoveSurfaceId, "debug-teleport", Number(getClockTime?.() || 0), 1.2);
    cat.tableRoamTarget.set(landingPoint.x, 0, landingPoint.z);
    if (isNonFloorSurfaceId(cat.debugMoveSurfaceId)) {
      const teleportedSurfaceId = String(cat.debugMoveSurfaceId || "");
      const teleportedToDesk = teleportedSurfaceId === "desk";
      cat.state = teleportedToDesk && !cup.broken && !cup.falling ? "toCup" : "patrol";
      cat.lastState = teleportedToDesk ? "debugTeleport" : "debugMove";
      cat.manualPatrolActive = false;
      cat.debugMoveActive = false;
      cat.nextTableRoamAt = 0;
    } else {
      cat.state = "patrol";
      cat.lastState = "debugMove";
    }
    syncRouteFromDebugMove("debug-teleport-target");
    cat.stateT = 0;
    cat.phaseT = 0;
    cat.nav.goal.set(landingPoint.x, 0, landingPoint.z);
    cat.nav.debugDestination.set(landingPoint.x, cat.debugMoveY, landingPoint.z);
    cat.patrolTarget.copy(landingPoint);
    return true;
  }

  return {
    updateDebugJumpDownPlan,
    moveCatToDebugClickTarget,
    teleportCatToDebugMouseTarget,
  };
}
