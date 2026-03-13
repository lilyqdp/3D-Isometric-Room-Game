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
    getDebugRoot,
    clearCatJumpTargets,
    clearCatNavPath,
    resetCatJumpBypass,
    resetCatUnstuckTracking,
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

  function getElevatedSurfaceById(surfaceId) {
    if (!surfaceId || surfaceId === "floor") return null;
    const defs = getElevatedSurfaceDefs(true);
    if (!Array.isArray(defs)) return null;
    return defs.find((s) => String(s?.id || s?.name || "") === String(surfaceId)) || null;
  }

  function getCurrentCatSurface(fromPos = cat.pos) {
    if (!cat.onTable && cat.group.position.y <= 0.08) {
      return { id: "floor", y: 0 };
    }
    const elevated = getElevatedSurfaceAt(fromPos, cat.group.position.y);
    if (elevated) {
      return {
        id: String(elevated.id || elevated.name || "desk"),
        y: Number.isFinite(elevated.y) ? elevated.y : Math.max(0.02, cat.group.position.y),
      };
    }
    const fallbackId = cat.debugMoveSurfaceId && cat.debugMoveSurfaceId !== "floor"
      ? String(cat.debugMoveSurfaceId)
      : "desk";
    const fallbackY = Number.isFinite(cat.group.position.y)
      ? Math.max(0.02, cat.group.position.y)
      : (Number.isFinite(cat.debugMoveY) ? Math.max(0.02, cat.debugMoveY) : desk.topY + 0.02);
    return { id: fallbackId, y: fallbackY };
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

  function buildElevatedWaypointPlan(surface, wantedPoint, fromPos = cat.pos) {
    const surfaceMargin = CAT_COLLISION.catBodyRadius + 0.05;
    const usableMinX = surface.minX + surfaceMargin;
    const usableMaxX = surface.maxX - surfaceMargin;
    const usableMinZ = surface.minZ + surfaceMargin;
    const usableMaxZ = surface.maxZ - surfaceMargin;
    if (usableMinX >= usableMaxX || usableMinZ >= usableMaxZ) return null;
    const targetX = THREE.MathUtils.clamp(wantedPoint.x, usableMinX, usableMaxX);
    const targetZ = THREE.MathUtils.clamp(wantedPoint.z, usableMinZ, usableMaxZ);
    const target = new THREE.Vector3(targetX, 0, targetZ);
    const surfaceId = String(surface?.id || surface?.name || "desk");
    const sourceSurface = getCurrentCatSurface(fromPos);
    if (sourceSurface.id === surfaceId) {
      return {
        surface: "elevated",
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
      // Fallback: if direct elevated->elevated linking is unavailable, route via floor
      // and keep final target on requested elevated surface.
      if (sourceSurface.id !== "floor") {
        const floorPoint = clampToRoomFloor(wantedPoint);
        return {
          surface: "floor",
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
          surface: "floor",
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
        surface: "floor",
        point: hopFloor.clone(),
        floorPoint: hopFloor,
        finalSurfaceId: surfaceId,
        finalPoint: new THREE.Vector3(targetX, surface.y, targetZ),
      };
    }
    const hopSurfaceDef = getElevatedSurfaceById(hopSurfaceId);
    const hopY = Number.isFinite(hopSurfaceDef?.y)
      ? hopSurfaceDef.y
      : (hopSurfaceId === surfaceId ? surface.y : jumpTargets.top.y);
    const hopPoint = hopSurfaceId === surfaceId
      ? new THREE.Vector3(targetX, hopY, targetZ)
      : new THREE.Vector3(jumpTargets.top.x, hopY, jumpTargets.top.z);
    return {
      surface: "elevated",
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
        const plan = buildElevatedWaypointPlan(
          {
            id: surface.id || surface.name || "desk",
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

      const elevated = getElevatedSurfaceAt(point, point.y);
      if (elevated) {
        const plan = buildElevatedWaypointPlan(elevated, point, cat.pos);
        if (plan) return plan;
      }

      const floorPoint = clampToRoomFloor(point);
      if (hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) {
        return {
          surface: "floor",
          point: floorPoint.clone(),
          floorPoint,
        };
      }
    }

    if (!raycaster.ray.intersectPlane(floorPlane, tempV3)) return null;
    const floorPoint = clampToRoomFloor(tempV3);
    if (!hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) return null;
    return { surface: "floor", point: floorPoint.clone(), floorPoint };
  }

  function getElevatedSurfaceAt(point, y) {
    if (y <= 0.08) return null;
    const surfaces = getElevatedSurfaceDefs(true);
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
          surface: "elevated",
          surfaceId: String(surface.id || surface.name || "desk"),
          point: surfacePoint,
          floorPoint: clampToRoomFloor(point),
        };
      }

      const elevated = getElevatedSurfaceAt(point, point.y);
      if (elevated) {
        const surfacePoint = findSurfaceTeleportPoint(elevated, point);
        return {
          surface: "elevated",
          surfaceId: String(elevated.id || elevated.name || "desk"),
          point: surfacePoint,
          floorPoint: clampToRoomFloor(point),
        };
      }

      const floorPoint = clampToRoomFloor(point);
      if (hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) {
        return { surface: "floor", point: floorPoint.clone(), floorPoint };
      }
    }

    if (!raycaster.ray.intersectPlane(floorPlane, tempV3)) return null;
    const floorPoint = clampToRoomFloor(tempV3);
    if (!hasNavAreaAt(floorPoint.x, floorPoint.z, 0)) return null;
    return { surface: "floor", point: floorPoint.clone(), floorPoint };
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
    const sourceSurface = getElevatedSurfaceAt(cat.pos, cat.group.position.y);
    const surfaceId = String(sourceSurface?.id || cat.debugMoveSurfaceId || "desk");
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
        ? String(cat.nav.jumpDownLandingSurfaceId || "floor")
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
    if (cat.jump || (!cat.onTable && cat.group.position.y > 0.08)) return false;
    const target = getMouseDebugSurfaceTarget();
    if (!target) return false;

    const movePoint =
      target.surface === "floor" ? navRuntime.findSafeGroundPoint(target.floorPoint) : new THREE.Vector3(target.point.x, 0, target.point.z);

    if (target.surface !== "elevated" && !cat.onTable && cat.group.position.y <= 0.08) {
      cat.debugMoveActive = false;
      cat.debugMoveSurface = "floor";
      cat.debugMoveSurfaceId = "floor";
      cat.debugMoveFinalSurfaceId = "floor";
      cat.debugMoveY = 0;
      cat.debugMoveFinalY = 0;
      cat.debugMoveTarget.copy(movePoint);
      cat.debugMoveFinalTarget.set(movePoint.x, 0, movePoint.z);
      cat.manualPatrolActive = true;
      cat.patrolTarget.copy(movePoint);
      cat.state = "patrol";
      cat.lastState = "debugMove";
      cat.stateT = 0;
      cat.phaseT = 0;
      clearCatJumpTargets();
      clearCatNavPath(true);
      resetCatJumpBypass();
      resetCatUnstuckTracking();
      cat.nav.stuckT = 0;
      cat.nav.debugDestination.set(movePoint.x, 0, movePoint.z);
      navRuntime.ensureCatPath(movePoint, true, true);
      return true;
    }

    cat.debugMoveActive = true;
    cat.debugMoveSurface = target.surface === "elevated" ? "elevated" : "floor";
    cat.debugMoveSurfaceId = target.surface === "elevated" ? String(target.surfaceId || "desk") : "floor";
    cat.debugMoveY = target.surface === "elevated" ? target.point.y : 0;
    cat.debugMoveFinalSurfaceId = String(
      target.finalSurfaceId || (target.surface === "elevated" ? target.surfaceId || "desk" : "floor")
    );
    const finalTargetPoint =
      target.finalPoint || target.point;
    cat.debugMoveFinalY =
      cat.debugMoveFinalSurfaceId === "floor"
        ? 0
        : Number(finalTargetPoint.y || cat.debugMoveY || 0.02);
    cat.debugMoveFinalTarget.set(finalTargetPoint.x, 0, finalTargetPoint.z);
    cat.debugMoveDirectJump = !!target.directJump;
    cat.debugMoveSitSeconds = 0;
    cat.debugMoveTarget.copy(movePoint);
    if (target.jumpAnchor) cat.debugMoveJumpAnchor.copy(target.jumpAnchor);
    else cat.debugMoveJumpAnchor.copy(movePoint);
    if (target.jumpLanding) cat.debugMoveLanding.copy(target.jumpLanding);
    else cat.debugMoveLanding.copy(movePoint);
    cat.debugMoveJumpOff.copy(cat.debugMoveLanding);
    cat.debugMoveJumpDown.copy(movePoint);
    cat.debugMoveJumpDownY = 0;
    if (cat.debugMoveSurface === "floor" && (cat.onTable || cat.group.position.y > 0.08)) {
      if (!updateDebugJumpDownPlan(movePoint, true, "floor")) return false;
    } else if (cat.debugMoveSurface === "elevated" && cat.group.position.y > 0.08 && Math.abs(cat.group.position.y - cat.debugMoveY) > 0.12) {
      if (!updateDebugJumpDownPlan(cat.debugMoveJumpAnchor, true, cat.debugMoveSurfaceId)) return false;
    }
    cat.state = "patrol";
    cat.lastState = "debugMove";
    cat.stateT = 0;
    cat.nav.debugDestination.set(target.point.x, cat.debugMoveY, target.point.z);
    if (cat.debugMoveSurface === "floor" && !cat.onTable) {
      navRuntime.ensureCatPath(cat.debugMoveTarget, true, true);
    }
    return true;
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
    cat.jump = null;
    cat.debugMoveActive = false;
    cat.debugMoveSurface = target.surface === "elevated" ? "elevated" : "floor";
    cat.debugMoveSurfaceId = target.surface === "elevated" ? String(target.surfaceId || "desk") : "floor";
    cat.debugMoveY = target.surface === "elevated" ? target.point.y : 0;
    cat.debugMoveFinalSurfaceId = String(
      target.finalSurfaceId || (target.surface === "elevated" ? target.surfaceId || "desk" : "floor")
    );
    const finalTeleportPoint =
      target.finalPoint || target.point;
    cat.debugMoveFinalY =
      cat.debugMoveFinalSurfaceId === "floor"
        ? 0
        : Number(finalTeleportPoint.y || cat.debugMoveY || 0.02);
    cat.debugMoveFinalTarget.set(finalTeleportPoint.x, 0, finalTeleportPoint.z);
    cat.debugMoveDirectJump = false;
    cat.debugMoveSitSeconds = 0;
    const landingPoint =
      cat.debugMoveSurface === "floor" ? navRuntime.findSafeGroundPoint(target.floorPoint) : target.point.clone();
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
    cat.onTable = cat.debugMoveY > 0.02;
    cat.tableRoamTarget.set(landingPoint.x, 0, landingPoint.z);
    if (cat.onTable) {
      const teleportedSurfaceId = String(cat.debugMoveSurfaceId || "");
      const teleportedToDesk = teleportedSurfaceId === "desk";
      cat.state = teleportedToDesk && !cup.broken && !cup.falling ? "toCup" : "patrol";
      cat.lastState = teleportedToDesk ? "debugTeleport" : "debugMove";
      cat.manualPatrolActive = false;
      cat.debugMoveActive = false;
      cat.debugMoveSurface = "elevated";
      cat.nextTableRoamAt = 0;
    } else {
      cat.state = "patrol";
      cat.lastState = "debugMove";
    }
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
