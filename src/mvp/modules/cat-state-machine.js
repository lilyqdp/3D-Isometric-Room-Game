import { animateCatPoseRuntime } from "./cat-animation.js";
import { computeCupSwipePlan } from "./cat-plans.js";
import { createCatStateMachineDeskRuntime } from "./cat-state-machine-desk.js";
import { createCatStateMachineGroundBypassRuntime } from "./cat-state-machine-ground-bypass.js";
import { createCatStateMachineUtilsRuntime } from "./cat-state-machine-utils.js";

export function updateCatStateMachineRuntime(ctx, dt) {
  const {
    THREE,
    scene,
    clockTime,
    game,
    cat,
    CAT_NAV,
    CAT_BEHAVIOR,
    CAT_COLLISION,
    cup,
    desk,
    JUMP_UP_TIMING,
    pickups,
    pickupRadius,
    recoverCatFromPickupTrap,
    nudgeBlockingPickupAwayFromCat,
    updateJump,
    getCurrentGroundGoal,
    ensureCatPath,
    findSafeGroundPoint,
    startJump,
    clearCatJumpTargets,
    moveCatToward,
    pickRandomPatrolPoint,
    bestDeskJumpAnchor,
    bestSurfaceJumpAnchor,
    clearCatNavPath,
    resetCatJumpBypass,
    updateDebugJumpDownPlan,
    buildCatObstacles,
    canReachGroundTarget,
    hasClearTravelLine,
    computeDeskJumpTargets,
    computeSurfaceJumpTargets,
    getElevatedSurfaceDefs,
    sampleSwipePose,
    knockCup,
    resetCatUnstuckTracking,
    windowSill,
  } = ctx;

  const animateCatPose = (stepDt, moving) => animateCatPoseRuntime(ctx, stepDt, moving);
  const GROUND_MOVE_SPEED = 0.95;
  const DESK_PATROL_UP_CHANCE = 0.3;
  const cupSwipePoint = new THREE.Vector3();
  const cupSwipeEdgeDir = new THREE.Vector3();
  const { isDeskLandingBlockedByObjects, getDeskDesiredTarget, pickTableRoamTarget } =
    createCatStateMachineDeskRuntime({
      THREE,
      game,
      cat,
      desk,
      cup,
      pickups,
      pickupRadius,
      CAT_COLLISION,
    });
  const {
    getElevatedSurfaceById,
    getCurrentCatSurfaceId,
    recordSurfaceHop,
    setJumpDownDebug,
    getAvoidSurfaceIdsForHop,
    isCatOnDeskNow,
    getCatnipApproachTarget,
    faceCatnip,
    faceWindowOutside,
  } = createCatStateMachineUtilsRuntime({
    THREE,
    getClockTime: () => clockTime,
    game,
    cat,
    desk,
    windowSill,
    CAT_COLLISION,
    getElevatedSurfaceDefs,
    catnipMouthOffset: 0.34,
  });
  const { clearGroundBypassMode, moveCatTowardGroundWithBypass } =
    createCatStateMachineGroundBypassRuntime({
      getClockTime: () => clockTime,
      cat,
      moveCatToward,
      canReachGroundTarget,
      buildCatObstacles,
      nudgeBlockingPickupAwayFromCat,
    });

  function replanDeskJumpOrFallback() {
    cat.jumpTargets = null;
    cat.jumpAnchor = bestDeskJumpAnchor(cat.pos, getDeskDesiredTarget());
    clearCatJumpTargets(false);
    clearCatNavPath(true);
    resetCatJumpBypass();
    if (!cat.jumpAnchor) {
      cat.state = "patrol";
      cat.phaseT = 0;
      return false;
    }
    cat.phaseT = 0;
    return true;
  }

  function startJumpDownFromDesk(nextState = "patrol") {
    cat.state = "jumpDown";
    cat.phaseT = 0;
    clearCatJumpTargets();
    clearCatNavPath(false);
    cat.landStopNextState = nextState;
    const toward =
      nextState === "toCatnip" && game.catnip && game.catnip.surface !== "desk"
        ? game.catnip.pos
        : desk.approach;
    const landingSurfaceId =
      nextState === "toCatnip" && game.catnip?.surface && game.catnip.surface !== "desk"
        ? String(game.catnip.surface)
        : "floor";
    if (!cat.nav.jumpDownToward) cat.nav.jumpDownToward = new THREE.Vector3();
    cat.nav.jumpDownToward.set(toward.x, Number.isFinite(toward?.y) ? toward.y : 0, toward.z);
    cat.nav.jumpDownLandingSurfaceId = landingSurfaceId;
    cat.nav.jumpDownNoMoveT = 0;
    setJumpDownDebug(
      {
        phase: "plan-init",
        sourceState: nextState,
        sourceSurfaceId: getCurrentCatSurfaceId(),
        towardX: toward.x,
        towardZ: toward.z,
        desiredLandingSurfaceId: landingSurfaceId,
        catX: cat.pos.x,
        catY: cat.group.position.y,
        catZ: cat.pos.z,
      },
      true
    );
    if (!updateDebugJumpDownPlan(toward, true, landingSurfaceId)) {
      cat.status = "No jump-down link";
      cat.nav.jumpDownPlanValid = false;
      cat.nav.jumpDownToward = null;
      cat.nav.jumpDownLandingSurfaceId = null;
      cat.nav.jumpDownNoMoveT = 0;
      setJumpDownDebug({
        phase: "plan-failed",
        failReason: "noLinkFromPlanner",
        planValid: false,
      });
      cat.state = "sit";
      cat.phaseT = 0;
      cat.sitDuration = 0.5;
      return;
    }
    cat.nav.jumpDownPlanAt = clockTime + 0.12;
    cat.nav.jumpDownPlanValid = true;
    cat.nav.debugDestination.set(cat.debugMoveJumpOff.x, desk.topY + 0.02, cat.debugMoveJumpOff.z);
    setJumpDownDebug({
      phase: "plan-ready",
      planValid: true,
      jumpOffX: cat.debugMoveJumpOff.x,
      jumpOffZ: cat.debugMoveJumpOff.z,
      jumpDownX: cat.debugMoveJumpDown.x,
      jumpDownY: cat.debugMoveJumpDownY || 0,
      jumpDownZ: cat.debugMoveJumpDown.z,
    });
    cat.onTable = true;
  }

  function enterNoPathSit(seconds = 0.95) {
    cat.debugMoveActive = false;
    cat.manualPatrolActive = false;
    cat.debugMoveSurfaceId = "floor";
    cat.debugMoveFinalSurfaceId = "floor";
    cat.debugMoveFinalY = 0;
    cat.debugMoveFinalTarget.set(cat.pos.x, 0, cat.pos.z);
    cat.state = "sit";
    cat.phaseT = 0;
    cat.sitDuration = seconds;
    cat.status = "No valid path";
    cat.nav.jumpDownPlanValid = false;
    cat.nav.jumpDownToward = null;
    cat.nav.jumpDownLandingSurfaceId = null;
    clearCatNavPath(true);
  }

  function abortCatnipRouteAndResumePatrol() {
    if (game.catnip?.mesh) scene.remove(game.catnip.mesh);
    game.catnip = null;
    game.placeCatnipMode = false;
    game.catnipNoRouteUntil = clockTime + 2.2;
    cat.nav.catnipPathCheckAt = 0;
    cat.nav.catnipUseExactTarget = false;
    cat.nav.jumpDownLandingSurfaceId = null;
    cat.debugMoveActive = false;
    cat.manualPatrolActive = false;
    clearCatJumpTargets();
    clearCatNavPath(true);
    cat.state = "patrol";
    cat.phaseT = 0;
    cat.status = "No route to catnip";
    if (!setNextPatrolTarget(true)) enterNoPathSit(0.8);
  }

  function refreshJumpDownLink(towardGroundPoint = null, force = false, desiredLandingSurfaceId = null) {
    if (!force && clockTime < (cat.nav.jumpDownPlanAt || 0)) return !!cat.nav.jumpDownPlanValid;
    if (towardGroundPoint && Number.isFinite(towardGroundPoint.x) && Number.isFinite(towardGroundPoint.z)) {
      if (!cat.nav.jumpDownToward) cat.nav.jumpDownToward = new THREE.Vector3();
      cat.nav.jumpDownToward.set(
        towardGroundPoint.x,
        Number.isFinite(towardGroundPoint.y) ? towardGroundPoint.y : 0,
        towardGroundPoint.z
      );
    }
    if (desiredLandingSurfaceId != null && desiredLandingSurfaceId !== "") {
      cat.nav.jumpDownLandingSurfaceId = String(desiredLandingSurfaceId);
    }
    const preferredToward =
      cat.nav.jumpDownToward ||
      towardGroundPoint ||
      cat.debugMoveTarget ||
      desk.approach;
    const preferredLandingSurfaceId = cat.nav.jumpDownLandingSurfaceId || null;
    const ok = updateDebugJumpDownPlan(preferredToward, true, preferredLandingSurfaceId);
    cat.nav.jumpDownPlanAt = clockTime + 0.12;
    cat.nav.jumpDownPlanValid = !!ok;
    if (!ok) cat.nav.jumpDownNoMoveT = 0;
    setJumpDownDebug({
      phase: ok ? "plan-refresh-ok" : "plan-refresh-fail",
      refreshForce: !!force,
      refreshOk: !!ok,
      planValid: !!ok,
      preferredTowardX: Number.isFinite(preferredToward?.x) ? preferredToward.x : NaN,
      preferredTowardZ: Number.isFinite(preferredToward?.z) ? preferredToward.z : NaN,
      desiredLandingSurfaceId: preferredLandingSurfaceId || "floor",
      jumpOffX: cat.debugMoveJumpOff?.x,
      jumpOffZ: cat.debugMoveJumpOff?.z,
      jumpDownX: cat.debugMoveJumpDown?.x,
      jumpDownY: cat.debugMoveJumpDownY || 0,
      jumpDownZ: cat.debugMoveJumpDown?.z,
    });
    return ok;
  }

  function sampleDeskPatrolPoint() {
    const padX = Math.max(0.22, CAT_COLLISION.catBodyRadius + 0.1);
    const padZ = Math.max(0.18, CAT_COLLISION.catBodyRadius + 0.08);
    const minX = desk.pos.x - desk.sizeX * 0.5 + padX;
    const maxX = desk.pos.x + desk.sizeX * 0.5 - padX;
    const minZ = desk.pos.z - desk.sizeZ * 0.5 + padZ;
    const maxZ = desk.pos.z + desk.sizeZ * 0.5 - padZ;
    if (minX >= maxX || minZ >= maxZ) return null;
    return new THREE.Vector3(
      THREE.MathUtils.lerp(minX, maxX, Math.random()),
      desk.topY + 0.02,
      THREE.MathUtils.lerp(minZ, maxZ, Math.random())
    );
  }

  function tryQueueElevatedPatrolMove() {
    if (game.catnip || cat.manualPatrolActive) return false;
    const onGround = !cat.onTable && cat.group.position.y <= 0.08;
    if (Math.random() >= DESK_PATROL_UP_CHANCE) return false;
    const desired = sampleDeskPatrolPoint();
    if (!desired) return false;

    if (onGround) {
      const anchor = bestDeskJumpAnchor(cat.pos, desired);
      if (!anchor) return false;
      const jumpTargets = computeDeskJumpTargets(anchor, desired);
      if (!jumpTargets) return false;
      return queuePatrolMoveTarget({
        surface: "elevated",
        point: desired,
        jumpAnchor: anchor,
        jumpLanding: jumpTargets.top,
      });
    }

    return queuePatrolMoveTarget({
      surface: "elevated",
      point: desired,
    });
  }

  function setNextPatrolTarget(allowElevated = true) {
    if (allowElevated && tryQueueElevatedPatrolMove()) return true;
    const nextPatrol = pickRandomPatrolPoint(cat.pos, false);
    if (!nextPatrol) return false;
    if (cat.onTable || cat.group.position.y > 0.08) {
      return queuePatrolMoveTarget({
        surface: "floor",
        point: nextPatrol.clone(),
        floorPoint: nextPatrol,
      });
    }
    cat.patrolTarget.copy(nextPatrol);
    cat.nav.debugDestination.set(nextPatrol.x, 0, nextPatrol.z);
    return true;
  }

  function queuePatrolMoveTarget(target, sitSeconds = 0) {
    const isElevated = target?.surface === "elevated";
    const movePoint = isElevated
      ? new THREE.Vector3(target.point.x, 0, target.point.z)
      : (target?.floorPoint || target?.point || pickRandomPatrolPoint(cat.pos)).clone();

    if (!isElevated) {
      const dynamicObstacles = buildCatObstacles(true, true);
      const start = !cat.onTable && cat.group.position.y <= 0.08
        ? cat.pos
        : findSafeGroundPoint(desk.approach);
      const hasDynamicPath = canReachGroundTarget(start, movePoint, dynamicObstacles);
      if (!hasDynamicPath) {
        const hasStaticPath = canReachGroundTarget(start, movePoint, buildCatObstacles(false));
        if (!hasStaticPath) {
          enterNoPathSit();
          return false;
        }
        cat.nav.dynamicBypassActive = true;
        cat.nav.dynamicBypassUntil = Math.max(cat.nav.dynamicBypassUntil || 0, clockTime + 1.0);
        cat.nav.dynamicBypassNudgeAt = 0;
        cat.nav.dynamicBypassCheckAt = 0;
        cat.nav.dynamicBypassTargetX = movePoint.x;
        cat.nav.dynamicBypassTargetZ = movePoint.z;
      } else {
        clearGroundBypassMode();
        cat.nav.dynamicBypassTargetX = movePoint.x;
        cat.nav.dynamicBypassTargetZ = movePoint.z;
      }
    }

    cat.debugMoveActive = true;
    cat.manualPatrolActive = false;
    cat.debugMoveSurface = isElevated ? "elevated" : "floor";
    cat.debugMoveSurfaceId = isElevated ? String(target?.surfaceId || "desk") : "floor";
    cat.debugMoveY = isElevated ? Math.max(0.02, target.point.y) : 0;
    const finalSurfaceId = String(
      target?.finalSurfaceId || (isElevated ? target?.surfaceId || "desk" : "floor")
    );
    const finalPoint = target?.finalPoint || target?.point || target?.jumpLanding || target?.jumpAnchor || movePoint;
    cat.debugMoveFinalSurfaceId = finalSurfaceId;
    cat.debugMoveFinalY = isElevated
      ? Math.max(0.02, Number(finalPoint?.y || cat.debugMoveY || target?.point?.y || 0.02))
      : 0;
    cat.debugMoveFinalTarget.set(finalPoint.x, 0, finalPoint.z);
    cat.debugMoveDirectJump = !!target?.directJump;
    cat.debugMoveTarget.copy(movePoint);
    cat.debugMoveSitSeconds = sitSeconds;
    cat.nav.debugMoveRecoverAt = 0;

    if (target?.jumpAnchor) cat.debugMoveJumpAnchor.copy(target.jumpAnchor);
    else cat.debugMoveJumpAnchor.copy(movePoint);
    if (target?.jumpLanding) cat.debugMoveLanding.copy(target.jumpLanding);
    else cat.debugMoveLanding.copy(movePoint);

    cat.debugMoveJumpOff.copy(cat.debugMoveLanding);
    cat.debugMoveJumpDown.copy(movePoint);
    cat.debugMoveJumpDownY = 0;

    if (!isElevated && (cat.onTable || cat.group.position.y > 0.08)) {
      if (!refreshJumpDownLink(movePoint, true, "floor")) {
        enterNoPathSit();
        return false;
      }
    } else if (isElevated && cat.group.position.y > 0.08 && Math.abs(cat.group.position.y - cat.debugMoveY) > 0.12) {
      if (!refreshJumpDownLink(cat.debugMoveJumpAnchor, true, cat.debugMoveSurfaceId)) {
        enterNoPathSit();
        return false;
      }
    }

    cat.state = "patrol";
    cat.lastState = "debugMove";
    cat.stateT = 0;
    cat.nav.debugDestination.set(target.point.x, cat.debugMoveY, target.point.z);
    if (!isElevated && !cat.onTable && cat.group.position.y <= 0.08) {
      ensureCatPath(cat.debugMoveTarget, true, true);
    }
    return true;
  }

  function planElevatedHopToFinalTarget(finalSurfaceId, finalPoint, sitSeconds = 0) {
    if (!finalSurfaceId || finalSurfaceId === "floor" || !finalPoint) return false;
    const sourceSurfaceId = getCurrentCatSurfaceId();
    const sourceY = sourceSurfaceId === "floor" ? 0 : Math.max(0.02, cat.group.position.y);
    const fromPoint = new THREE.Vector3(cat.pos.x, sourceY, cat.pos.z);
    if (sourceSurfaceId === "floor") {
      const safeStart = findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
      fromPoint.set(safeStart.x, 0, safeStart.z);
    }
    const targetPoint = new THREE.Vector3(finalPoint.x, 0, finalPoint.z);
    const avoidSurfaceIds = getAvoidSurfaceIdsForHop(sourceSurfaceId, finalSurfaceId);

    if (sourceSurfaceId === finalSurfaceId) {
      const surface = getElevatedSurfaceById(finalSurfaceId);
      const targetY = Number.isFinite(surface?.y)
        ? surface.y
        : Math.max(0.02, Number(finalPoint.y || sourceY));
      return queuePatrolMoveTarget(
        {
          surface: "elevated",
          surfaceId: finalSurfaceId,
          point: new THREE.Vector3(targetPoint.x, targetY, targetPoint.z),
          finalSurfaceId,
          finalPoint: new THREE.Vector3(targetPoint.x, targetY, targetPoint.z),
          directJump: false,
        },
        sitSeconds
      );
    }

    const jumpAnchor =
      typeof bestSurfaceJumpAnchor === "function"
        ? bestSurfaceJumpAnchor(
            finalSurfaceId,
            fromPoint,
            targetPoint,
            sourceSurfaceId,
            avoidSurfaceIds
          )
        : null;
    if (!jumpAnchor || typeof computeSurfaceJumpTargets !== "function") return false;

    const jumpTargets = computeSurfaceJumpTargets(
      finalSurfaceId,
      jumpAnchor,
      targetPoint,
      sourceSurfaceId,
      avoidSurfaceIds
    );
    if (!jumpTargets?.top) return false;

    const hopSurfaceId = String(jumpTargets.surfaceId || finalSurfaceId);
    if (hopSurfaceId === "floor") {
      const hopFloorPoint = new THREE.Vector3(jumpTargets.top.x, 0, jumpTargets.top.z);
      const finalSurface = getElevatedSurfaceById(finalSurfaceId);
      const finalY = Number.isFinite(finalSurface?.y)
        ? finalSurface.y
        : Math.max(0.02, Number(finalPoint.y || 0.02));
      const queued = queuePatrolMoveTarget(
        {
          surface: "floor",
          point: hopFloorPoint.clone(),
          floorPoint: hopFloorPoint.clone(),
          finalSurfaceId,
          finalPoint: new THREE.Vector3(targetPoint.x, finalY, targetPoint.z),
        },
        sitSeconds
      );
      if (queued) {
        recordSurfaceHop(sourceSurfaceId, "floor");
      }
      return queued;
    }
    const hopSurface = getElevatedSurfaceById(hopSurfaceId);
    const hopY = Number.isFinite(hopSurface?.y)
      ? hopSurface.y
      : Math.max(0.02, Number(jumpTargets.top.y || finalPoint.y || sourceY));
    const hopPoint =
      hopSurfaceId === finalSurfaceId
        ? new THREE.Vector3(targetPoint.x, hopY, targetPoint.z)
        : new THREE.Vector3(jumpTargets.top.x, hopY, jumpTargets.top.z);
    const finalSurface = getElevatedSurfaceById(finalSurfaceId);
    const finalY = Number.isFinite(finalSurface?.y)
      ? finalSurface.y
      : Math.max(0.02, Number(finalPoint.y || hopY));

    const queued = queuePatrolMoveTarget(
      {
        surface: "elevated",
        surfaceId: hopSurfaceId,
        point: hopPoint,
        finalSurfaceId,
        finalPoint: new THREE.Vector3(targetPoint.x, finalY, targetPoint.z),
        jumpAnchor,
        jumpLanding: jumpTargets.top,
        directJump: sourceSurfaceId !== "floor",
      },
      sitSeconds
    );
    if (queued) {
      recordSurfaceHop(sourceSurfaceId, hopSurfaceId);
    }
    return queued;
  }

  function updatePatrolMoveTarget(stepDt) {
    const targetY = cat.debugMoveSurface === "elevated" ? Math.max(0.02, cat.debugMoveY || 0) : 0;
    const navReason = () => String(cat.nav?.debugStep?.reason || "");
    const navBlocked = () => {
      const reason = navReason();
      return reason === "wholePathBlocked" || reason === "noPath";
    };
    const tryRecoverTowardFinalTarget = () => {
      if (clockTime < (cat.nav.debugMoveRecoverAt || 0)) return true;

      const finalSurfaceId = String(
        cat.debugMoveFinalSurfaceId ||
          (cat.debugMoveSurface === "elevated" ? cat.debugMoveSurfaceId || "desk" : "floor")
      );
      const finalY =
        finalSurfaceId === "floor"
          ? 0
          : Math.max(0.02, Number(cat.debugMoveFinalY || targetY || cat.group.position.y || 0.02));
      const finalPoint = new THREE.Vector3(cat.debugMoveFinalTarget.x, finalY, cat.debugMoveFinalTarget.z);

      let rerouted = false;
      if (finalSurfaceId !== "floor") {
        rerouted = planElevatedHopToFinalTarget(finalSurfaceId, finalPoint, cat.debugMoveSitSeconds);
      } else {
        const safeFloor = findSafeGroundPoint(new THREE.Vector3(finalPoint.x, 0, finalPoint.z));
        if (safeFloor) {
          cat.debugMoveTarget.copy(safeFloor);
          cat.debugMoveFinalTarget.set(safeFloor.x, 0, safeFloor.z);
          cat.nav.debugDestination.set(safeFloor.x, 0, safeFloor.z);
          clearCatNavPath(true);
          ensureCatPath(cat.debugMoveTarget, true, true);
          rerouted = true;
        }
      }

      cat.nav.debugMoveRecoverAt = clockTime + (rerouted ? 0.24 : 0.55);
      if (rerouted) {
        cat.status = "Re-routing";
        return true;
      }

      cat.debugMoveActive = false;
      cat.manualPatrolActive = false;
      clearCatNavPath(true);
      return false;
    };

    if (cat.debugMoveSurface === "elevated") {
      if (!cat.onTable && cat.group.position.y > 0.08) {
        cat.onTable = true;
      }
      if (cat.onTable && Math.abs(cat.group.position.y - targetY) > 0.12) {
        if (cat.debugMoveDirectJump) {
          const sourceY = Math.max(0.02, cat.group.position.y);
          const reachedJumpAnchor = moveCatToward(cat.debugMoveJumpAnchor, stepDt, 0.9, sourceY, {
            direct: false,
            ignoreDynamic: false,
          });
          const nearJumpAnchor = !!cat.debugMoveJumpAnchor &&
            (cat.debugMoveJumpAnchor.x - cat.pos.x) ** 2 + (cat.debugMoveJumpAnchor.z - cat.pos.z) ** 2 < 0.14 * 0.14;
          const readyToJump = reachedJumpAnchor || nearJumpAnchor;
          cat.status = "Approaching jump point";
          animateCatPose(stepDt, !readyToJump);
          if (readyToJump) {
            cat.debugMoveDirectJump = false;
            clearCatNavPath(false);
            startJump(cat.debugMoveLanding, targetY, 0.64, 0.46, "patrol", {
              easePos: true,
              easeY: true,
              avoidDeskClip: true,
            });
          }
          return true;
        }
        if (!refreshJumpDownLink(cat.debugMoveJumpAnchor, false, cat.debugMoveSurfaceId)) {
          cat.status = "No jump-down link";
          animateCatPose(stepDt, false);
          return true;
        }
        const elevatedY = Math.max(0.02, cat.group.position.y);
        const reachedJumpOff = moveCatToward(cat.debugMoveJumpOff, stepDt, 0.84, elevatedY, {
          direct: true,
          ignoreDynamic: true,
        });
        const dropDx = cat.debugMoveJumpOff.x - cat.pos.x;
        const dropDz = cat.debugMoveJumpOff.z - cat.pos.z;
        const nearDrop = dropDx * dropDx + dropDz * dropDz < 0.16 * 0.16;
        const readyToDrop = reachedJumpOff || (nearDrop && cat.stateT > 0.16);
        cat.status = "Repositioning";
        animateCatPose(stepDt, !readyToDrop);
        if (!readyToDrop && (navBlocked() || cat.nav.stuckT > 0.55)) {
          if (!tryRecoverTowardFinalTarget()) return false;
          if (cat.status === "Re-routing") {
            animateCatPose(stepDt, false);
            return true;
          }
        }
        if (readyToDrop) {
          cat.onTable = false;
          cat.nav.jumpDownPlanValid = false;
          cat.nav.jumpDownToward = null;
          cat.nav.jumpDownLandingSurfaceId = null;
          startJump(cat.debugMoveJumpDown, cat.debugMoveJumpDownY || 0, 0.52, 0.34, "patrol", {
            easePos: true,
            easeY: true,
            avoidDeskClip: true,
          });
        }
        return true;
      }
      if (!cat.onTable) {
        const reachedJumpAnchor = moveCatTowardGroundWithBypass(cat.debugMoveJumpAnchor, stepDt, GROUND_MOVE_SPEED);
        const nearJumpAnchor = !!cat.debugMoveJumpAnchor &&
          (cat.debugMoveJumpAnchor.x - cat.pos.x) ** 2 + (cat.debugMoveJumpAnchor.z - cat.pos.z) ** 2 < 0.14 * 0.14;
        const readyToJump = reachedJumpAnchor || nearJumpAnchor;
        cat.status = "Preparing jump";
        animateCatPose(stepDt, !readyToJump);
        if (!readyToJump && (navBlocked() || cat.nav.stuckT > 0.55)) {
          if (!tryRecoverTowardFinalTarget()) return false;
          if (cat.status === "Re-routing") {
            animateCatPose(stepDt, false);
            return true;
          }
        }
        if (readyToJump) {
          startJump(cat.debugMoveLanding, targetY, 0.64, 0.46, "patrol", {
            easePos: true,
            easeY: true,
            avoidDeskClip: false,
          });
          cat.status = "Jumping up";
        }
        return true;
      }

      let reachedTarget = moveCatToward(cat.debugMoveTarget, stepDt, 0.84, targetY, {
        direct: true,
        ignoreDynamic: false,
      });
      if (!reachedTarget) {
        const dxNear = cat.debugMoveTarget.x - cat.pos.x;
        const dzNear = cat.debugMoveTarget.z - cat.pos.z;
        if (dxNear * dxNear + dzNear * dzNear <= 0.115 * 0.115) {
          cat.pos.x = cat.debugMoveTarget.x;
          cat.pos.z = cat.debugMoveTarget.z;
          cat.group.position.set(cat.pos.x, targetY, cat.pos.z);
          clearCatNavPath(false);
          reachedTarget = true;
        }
      }
      cat.status = "Patrolling";
      animateCatPose(stepDt, !reachedTarget);
      if (!reachedTarget && (navBlocked() || cat.nav.stuckT > 0.55)) {
        if (!tryRecoverTowardFinalTarget()) return false;
        if (cat.status === "Re-routing") {
          animateCatPose(stepDt, false);
          return true;
        }
      }
      if (reachedTarget) {
        const finalSurfaceId = String(cat.debugMoveFinalSurfaceId || cat.debugMoveSurfaceId || "floor");
        const finalTarget = cat.debugMoveFinalTarget;
        if (finalSurfaceId !== "floor") {
          const sameSurface = finalSurfaceId === String(cat.debugMoveSurfaceId || "");
          const dxFinal = finalTarget.x - cat.pos.x;
          const dzFinal = finalTarget.z - cat.pos.z;
          const finalReached = sameSurface && (dxFinal * dxFinal + dzFinal * dzFinal <= 0.12 * 0.12);
          if (!finalReached) {
            if (planElevatedHopToFinalTarget(finalSurfaceId, new THREE.Vector3(finalTarget.x, cat.debugMoveFinalY || targetY, finalTarget.z), cat.debugMoveSitSeconds)) {
              cat.status = "Re-routing";
              return true;
            }
            enterNoPathSit();
            return true;
          }
        }
        cat.debugMoveActive = false;
        cat.onTable = true;
        if (cat.debugMoveSitSeconds > 0.05) {
          cat.sitDuration = cat.debugMoveSitSeconds;
          cat.state = "sit";
          cat.phaseT = 0;
        } else {
          const floorPoint = pickRandomPatrolPoint(cat.pos, false);
          if (!floorPoint || !queuePatrolMoveTarget({ surface: "floor", point: floorPoint.clone(), floorPoint }, 0)) {
            enterNoPathSit(0.85);
          }
        }
      }
      return true;
    }

    if (cat.onTable || cat.group.position.y > 0.08) {
      if (!refreshJumpDownLink(cat.debugMoveTarget, false, "floor")) {
        cat.status = "No jump-down link";
        animateCatPose(stepDt, false);
        return true;
      }
      const elevatedY = Math.max(0.02, cat.group.position.y);
      const reachedJumpOff = moveCatToward(cat.debugMoveJumpOff, stepDt, 0.84, elevatedY, {
        direct: true,
        ignoreDynamic: true,
      });
      const dropDx = cat.debugMoveJumpOff.x - cat.pos.x;
      const dropDz = cat.debugMoveJumpOff.z - cat.pos.z;
      const nearDrop = dropDx * dropDx + dropDz * dropDz < 0.16 * 0.16;
      const readyToDrop = reachedJumpOff || (nearDrop && cat.stateT > 0.16);
      cat.status = "Preparing jump down";
      animateCatPose(stepDt, !readyToDrop);
      if (!readyToDrop && (navBlocked() || cat.nav.stuckT > 0.55)) {
        if (!tryRecoverTowardFinalTarget()) return false;
        if (cat.status === "Re-routing") {
          animateCatPose(stepDt, false);
          return true;
        }
      }
      if (readyToDrop) {
        cat.onTable = false;
        cat.nav.jumpDownPlanValid = false;
        cat.nav.jumpDownToward = null;
        cat.nav.jumpDownLandingSurfaceId = null;
        startJump(cat.debugMoveJumpDown, cat.debugMoveJumpDownY || 0, 0.52, 0.34, "patrol", {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
        });
        cat.status = "Jumping down";
      }
      return true;
    }

    let reachedFloorTarget = moveCatTowardGroundWithBypass(cat.debugMoveTarget, stepDt, GROUND_MOVE_SPEED);
    if (!reachedFloorTarget) {
      const dxNear = cat.debugMoveTarget.x - cat.pos.x;
      const dzNear = cat.debugMoveTarget.z - cat.pos.z;
      if (dxNear * dxNear + dzNear * dzNear <= 0.115 * 0.115) {
        cat.pos.x = cat.debugMoveTarget.x;
        cat.pos.z = cat.debugMoveTarget.z;
        cat.group.position.set(cat.pos.x, 0, cat.pos.z);
        clearCatNavPath(false);
        reachedFloorTarget = true;
      }
    }
    cat.status = "Patrolling";
    animateCatPose(stepDt, !reachedFloorTarget);
    if (!reachedFloorTarget && (navBlocked() || cat.nav.stuckT > 0.55)) {
      if (!tryRecoverTowardFinalTarget()) return false;
      if (cat.status === "Re-routing") {
        animateCatPose(stepDt, false);
        return true;
      }
    }
    if (reachedFloorTarget) {
      const finalSurfaceId = String(cat.debugMoveFinalSurfaceId || "floor");
      if (finalSurfaceId !== "floor") {
        if (
          planElevatedHopToFinalTarget(
            finalSurfaceId,
            new THREE.Vector3(cat.debugMoveFinalTarget.x, cat.debugMoveFinalY || 0.02, cat.debugMoveFinalTarget.z),
            cat.debugMoveSitSeconds
          )
        ) {
          cat.status = "Re-routing";
          return true;
        }
        enterNoPathSit();
        return true;
      }
      cat.debugMoveActive = false;
      cat.manualPatrolActive = false;
      cat.onTable = false;
      if (!setNextPatrolTarget(true)) enterNoPathSit(0.85);
    }
    return true;
  }

  function updateCatImpl(stepDt) {
    if (game.state !== "playing") return;

    if (cat.state !== cat.lastState) {
      cat.lastState = cat.state;
      cat.stateT = 0;
      cat.phaseT = 0;
      resetCatUnstuckTracking();
      if (cat.state !== "toDesk") {
        resetCatJumpBypass();
      }
      if (cat.state === "patrol") {
        if (!cat.debugMoveActive && !cat.manualPatrolActive) {
          if (!setNextPatrolTarget(true)) enterNoPathSit();
        }
        cat.nav.patrolPathCheckAt = clockTime;
        cat.nextTableRollAt = Math.max(clockTime + CAT_BEHAVIOR.tableApproachRollInterval, cat.nextTableRollAt);
      } else {
        cat.nextTableRollAt = clockTime + CAT_BEHAVIOR.tableApproachRollInterval;
      }
    } else {
      cat.stateT += stepDt;
    }

    if (cat.jump || cat.onTable || cat.group.position.y > 0.08) {
      clearGroundBypassMode();
    }

    if (!cat.jump && recoverCatFromPickupTrap(stepDt)) {
      clearGroundBypassMode();
      animateCatPose(stepDt, false);
      return;
    }

    if (!cat.jump && cat.group.position.y <= 0.03 && cat.nav.stuckT > CAT_NAV.stuckReset) {
      cat.state = "patrol";
      clearCatJumpTargets();
      clearCatNavPath(true);
      resetCatUnstuckTracking();
      cat.nav.stuckT = 0;
      if (!setNextPatrolTarget(false)) enterNoPathSit();
    }

    if (!cat.jump && cat.group.position.y <= 0.03 && cat.nav.stuckT > 0.7) {
      const rescueGoal = getCurrentGroundGoal();
      if (rescueGoal) {
        ensureCatPath(rescueGoal, true, true);
        cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
      }
    }

    if (game.catnip && clockTime >= game.catnip.expiresAt) {
      const expiredCatnip = game.catnip;
      scene.remove(expiredCatnip.mesh);
      game.catnip = null;

      const deskCatnipExpired = String(expiredCatnip.surface || "floor") === "desk";
      const cupActive = !cup.broken && !cup.falling;
      const onDeskNow = isCatOnDeskNow();
      const currentSurfaceId = getCurrentCatSurfaceId();
      const onElevatedNow = currentSurfaceId !== "floor" || cat.group.position.y > 0.08;

      // If desk catnip just ended while the cat is on the desk, do NOT auto-enter cup swipe flow.
      if (!cat.jump && deskCatnipExpired && onDeskNow) {
        cat.onTable = true;
        cat.debugMoveActive = false;
        cat.manualPatrolActive = false;
        cat.debugMoveSurfaceId = "desk";
        cat.debugMoveFinalSurfaceId = "desk";
        cat.debugMoveFinalY = desk.topY + 0.02;
        cat.debugMoveFinalTarget.set(cat.pos.x, 0, cat.pos.z);
        clearCatJumpTargets();
        clearCatNavPath(false);
        startJumpDownFromDesk("patrol");
        return;
      } else if (cat.state === "toCatnip" || cat.state === "distracted") {
        if (onDeskNow || currentSurfaceId === "desk") {
          cat.onTable = true;
          if (deskCatnipExpired) {
            // Desk catnip expires -> leave the desk instead of instantly targeting the cup.
            startJumpDownFromDesk("patrol");
            return;
          }
          if (cupActive) {
            // Stay on the desk and resume normal desk behavior.
            cat.state = "toCup";
            cat.phaseT = 0;
          } else {
            // No cup target available; use link-constrained jump-down.
            startJumpDownFromDesk("patrol");
            return;
          }
        } else if (onElevatedNow) {
          // Elevated catnip expiry should resume normal patrol flow, not force an immediate cup route.
          // Forcing desk/cup here can leave stale elevated waypoints and cause infinite edge-running.
          cat.onTable = true;
          cat.debugMoveActive = false;
          cat.manualPatrolActive = false;
          clearCatJumpTargets();
          clearCatNavPath(false);
          const floorPoint = pickRandomPatrolPoint(cat.pos, false);
          if (!floorPoint || !queuePatrolMoveTarget({ surface: "floor", point: floorPoint.clone(), floorPoint }, 0)) {
            enterNoPathSit(0.85);
            return;
          }
          cat.state = "patrol";
          cat.phaseT = 0;
          cat.status = "Returning to floor";
          return;
        } else {
          cat.onTable = false;
          if (cupActive) {
            cat.jumpAnchor = bestDeskJumpAnchor(cat.pos, getDeskDesiredTarget());
            if (cat.jumpAnchor) {
              cat.nav.debugDestination.set(cat.jumpAnchor.x, 0, cat.jumpAnchor.z);
              cat.state = "toDesk";
              cat.stateT = 0;
            } else {
              cat.state = "patrol";
            }
          } else {
            cat.state = "patrol";
          }
        }
      }
    }
    if (!game.catnip) {
      cat.nav.catnipPathCheckAt = 0;
      cat.nav.catnipUseExactTarget = false;
    }

    if (cat.jump) {
      updateJump(stepDt);
      if (cat.state === "launchUp") cat.status = "Jumping up";
      else if (cat.state === "pullUp") cat.status = "Pulling up";
      else if (cat.state === "jumpDown") {
        const prepDur = Number(cat.jump.preDur || 0);
        const prepT = Number(cat.jump.preT || 0);
        cat.status = prepDur > 1e-5 && prepT < prepDur - 1e-5 ? "Preparing jump down" : "Jumping down";
      }
      else cat.status = "Jumping";
      animateCatPose(stepDt, false);
      return;
    }

    // Guard against stale jump states if a debug waypoint interrupts mid-air.
    if (cat.state === "launchUp" || cat.state === "pullUp") {
      cat.state = "patrol";
      cat.phaseT = 0;
    }

    const windowActive = !!windowSill && clockTime < (game.windowOpenUntil || 0);
    const windowOverrideBlockedByJumpFlow =
      cat.state === "toDesk" ||
      cat.state === "prepareJump" ||
      cat.state === "launchUp" ||
      cat.state === "forepawHook" ||
      cat.state === "pullUp" ||
      cat.state === "jumpSettle" ||
      cat.state === "jumpDown" ||
      cat.state === "landStop";

    if (!windowActive) {
      if (cat.nav.windowHoldActive) {
        cat.nav.windowHoldActive = false;
        cat.nav.windowPathCheckAt = 0;
        if (!game.catnip) {
          const cupActive = !cup.broken && !cup.falling;
          const currentSurfaceId = getCurrentCatSurfaceId();
          if (currentSurfaceId === "desk") {
            cat.onTable = true;
            cat.state = cupActive ? "toCup" : "patrol";
            cat.phaseT = 0;
          } else if (currentSurfaceId !== "floor" || cat.group.position.y > 0.08) {
            cat.onTable = true;
            const floorPoint = pickRandomPatrolPoint(cat.pos, false);
            if (!floorPoint || !queuePatrolMoveTarget({ surface: "floor", point: floorPoint.clone(), floorPoint }, 0)) {
              enterNoPathSit(0.7);
              return;
            }
            cat.state = "patrol";
            cat.phaseT = 0;
            return;
          } else {
            cat.onTable = false;
            cat.state = "patrol";
            cat.phaseT = 0;
          }
        }
      }
    } else if (!windowOverrideBlockedByJumpFlow) {
      const windowJustActivated = !cat.nav.windowHoldActive;
      if (windowJustActivated) {
        // Window distraction takes over immediately; drop stale scripted routes.
        cat.debugMoveActive = false;
        cat.manualPatrolActive = false;
        clearCatNavPath(true);
        clearCatJumpTargets();
        cat.nav.windowPathCheckAt = 0;
      }
      cat.nav.windowHoldActive = true;
      const windowSurfaceId = String(windowSill.id || "windowSill");
      const windowY = Math.max(0.02, Number(windowSill.surfaceY || 0) + 0.02);
      const windowTarget = new THREE.Vector3(windowSill.sitPoint.x, windowY, windowSill.sitPoint.z);

      if (cat.debugMoveActive && cat.debugMoveFinalSurfaceId !== windowSurfaceId) {
        cat.debugMoveActive = false;
      }

      const onTargetSurface =
        cat.group.position.y > 0.12 &&
        Math.abs(cat.group.position.y - windowY) <= 0.14 &&
        getCurrentCatSurfaceId() === windowSurfaceId;

      if (onTargetSurface) {
        cat.onTable = true;
        cat.debugMoveSurfaceId = windowSurfaceId;
        cat.group.position.y = windowY;
        clearCatJumpTargets();
        cat.nav.debugDestination.set(windowTarget.x, windowY, windowTarget.z);
        const atWindow = moveCatToward(windowTarget, stepDt, 0.9, windowY);
        if (atWindow) faceWindowOutside(stepDt);
        cat.state = atWindow ? "sit" : "patrol";
        cat.status = atWindow ? "Watching window" : "Going to window";
        animateCatPose(stepDt, !atWindow);
        return;
      }

      const navReason = cat.nav?.debugStep?.reason || "";
      const shouldReplanWindow =
        !cat.debugMoveActive ||
        cat.debugMoveFinalSurfaceId !== windowSurfaceId ||
        cat.nav.stuckT > 0.2 ||
        navReason === "wholePathBlocked" ||
        navReason === "noPath";
      if (shouldReplanWindow && clockTime >= (cat.nav.windowPathCheckAt || 0)) {
        const queued = planElevatedHopToFinalTarget(
          windowSurfaceId,
          new THREE.Vector3(windowTarget.x, windowY, windowTarget.z),
          Math.max(0.3, (game.windowOpenUntil || 0) - clockTime)
        );
        if (!queued) cat.debugMoveActive = false;
        cat.nav.windowPathCheckAt = clockTime + (queued ? 0.55 : 1.1);
      }

      if (cat.debugMoveActive && cat.debugMoveFinalSurfaceId === windowSurfaceId && updatePatrolMoveTarget(stepDt)) {
        const dx = windowTarget.x - cat.pos.x;
        const dz = windowTarget.z - cat.pos.z;
        const closeEnough =
          dx * dx + dz * dz <= 0.11 * 0.11 && Math.abs(cat.group.position.y - windowY) <= 0.14;
        if (closeEnough) {
          cat.debugMoveActive = false;
          cat.onTable = true;
          cat.debugMoveSurfaceId = windowSurfaceId;
          cat.group.position.y = windowY;
          cat.state = "sit";
          cat.status = "Watching window";
          faceWindowOutside(stepDt);
          animateCatPose(stepDt, false);
        } else {
          cat.state = "patrol";
          cat.status = "Going to window";
        }
        return;
      }
      cat.state = "patrol";
      cat.status = "No path to window";
      animateCatPose(stepDt, false);
      return;
    } else if (cat.nav.windowHoldActive) {
      // Window opened during a jump/transition: defer window override until jump flow finishes.
      cat.nav.windowHoldActive = false;
      cat.nav.windowPathCheckAt = 0;
    }

    // Catnip overrides knock behavior.
    if (game.catnip) {
      const inDropFlow = cat.state === "jumpDown" || cat.state === "landStop";
      if (!inDropFlow) {
      const catnipSurfaceId = String(game.catnip.surface || "floor");
      const catnipOnDesk = catnipSurfaceId === "desk";
      const catnipOnElevated = catnipSurfaceId !== "floor";
      const catnipUsesElevatedPlanner = catnipOnElevated && !catnipOnDesk;

      // Keep existing behavior for floor/desk catnip; elevated catnip uses debug-move routing.
      if (!catnipUsesElevatedPlanner && (cat.debugMoveActive || cat.manualPatrolActive)) {
        cat.debugMoveActive = false;
        cat.manualPatrolActive = false;
      }

      if (catnipUsesElevatedPlanner) {
        const catnipTarget = getCatnipApproachTarget() || game.catnip.pos;
        const catnipY = Math.max(0.02, game.catnip.pos.y || 0.02);
        const onTargetSurface =
          cat.group.position.y > 0.12 &&
          Math.abs(cat.group.position.y - catnipY) <= 0.14 &&
          getCurrentCatSurfaceId() === catnipSurfaceId;

        if (onTargetSurface) {
          cat.onTable = true;
          cat.debugMoveSurfaceId = catnipSurfaceId;
          cat.group.position.y = catnipY;
          clearCatJumpTargets();
          cat.nav.debugDestination.set(catnipTarget.x, catnipY, catnipTarget.z);
          const atCatnip = moveCatToward(catnipTarget, stepDt, 0.95, catnipY);
          const navReasonNow = cat.nav?.debugStep?.reason || "";
          if (!atCatnip && (navReasonNow === "wholePathBlocked" || navReasonNow === "noPath")) {
            abortCatnipRouteAndResumePatrol();
            animateCatPose(stepDt, true);
            return;
          }
          faceCatnip(stepDt);
          cat.state = atCatnip ? "distracted" : "toCatnip";
          cat.status = atCatnip ? "Eating catnip" : "Going to catnip";
          animateCatPose(stepDt, !atCatnip);
          return;
        }

        const navReason = cat.nav?.debugStep?.reason || "";
        const shouldReplanElevatedCatnip =
          !cat.debugMoveActive ||
          cat.debugMoveFinalSurfaceId !== catnipSurfaceId ||
          cat.nav.stuckT > 0.2 ||
          navReason === "wholePathBlocked" ||
          navReason === "noPath";
        if (shouldReplanElevatedCatnip && clockTime >= (cat.nav.catnipPathCheckAt || 0)) {
          const queued = planElevatedHopToFinalTarget(
            catnipSurfaceId,
            new THREE.Vector3(catnipTarget.x, catnipY, catnipTarget.z),
            0.18
          );
          cat.nav.catnipPathCheckAt = clockTime + (queued ? 0.32 : 0.62);
          if (!queued) {
            abortCatnipRouteAndResumePatrol();
            animateCatPose(stepDt, true);
            return;
          }
        }

        if (cat.debugMoveActive && updatePatrolMoveTarget(stepDt)) {
          const dx = catnipTarget.x - cat.pos.x;
          const dz = catnipTarget.z - cat.pos.z;
          const closeEnough = dx * dx + dz * dz <= 0.11 * 0.11 && Math.abs(cat.group.position.y - catnipY) <= 0.14;
          if (closeEnough) {
            cat.debugMoveActive = false;
            cat.onTable = true;
            cat.debugMoveSurfaceId = catnipSurfaceId;
            cat.group.position.y = catnipY;
            cat.state = "distracted";
            cat.status = "Eating catnip";
            faceCatnip(stepDt);
            animateCatPose(stepDt, false);
          } else {
            cat.state = "toCatnip";
            cat.status = "Going to catnip";
          }
          return;
        }
        abortCatnipRouteAndResumePatrol();
        animateCatPose(stepDt, true);
        return;
      } else if (catnipOnDesk) {
        if (cat.group.position.y > 0.12) cat.onTable = true;
        if (cat.onTable) {
          clearCatJumpTargets();
          const catnipTarget = getCatnipApproachTarget() || game.catnip.pos;
          cat.nav.debugDestination.set(catnipTarget.x, desk.topY + 0.02, catnipTarget.z);
          const atCatnip = moveCatToward(catnipTarget, stepDt, 0.95, desk.topY + 0.02);
          const navReasonNow = cat.nav?.debugStep?.reason || "";
          if (!atCatnip && (navReasonNow === "wholePathBlocked" || navReasonNow === "noPath")) {
            abortCatnipRouteAndResumePatrol();
            animateCatPose(stepDt, true);
            return;
          }
          faceCatnip(stepDt);
          cat.state = atCatnip ? "distracted" : "toCatnip";
          cat.status = atCatnip ? "Eating catnip" : "Going to catnip";
          animateCatPose(stepDt, !atCatnip);
          return;
        }
        const inDeskJumpFlow =
          cat.state === "toDesk" ||
          cat.state === "prepareJump" ||
          cat.state === "launchUp" ||
          cat.state === "forepawHook" ||
          cat.state === "pullUp" ||
          cat.state === "jumpSettle";
        if (!inDeskJumpFlow) {
          clearCatJumpTargets();
          cat.jumpAnchor = bestDeskJumpAnchor(cat.pos, getDeskDesiredTarget());
          if (cat.jumpAnchor) cat.nav.debugDestination.set(cat.jumpAnchor.x, 0, cat.jumpAnchor.z);
          cat.state = "toDesk";
          cat.stateT = 0;
        }
      } else {
        if (cat.onTable || cat.group.position.y > 0.08) {
          if (cat.state !== "jumpDown" && cat.state !== "landStop") {
            startJumpDownFromDesk("toCatnip");
            return;
          }
        } else {
          clearCatJumpTargets();
          const catnipTarget = getCatnipApproachTarget() || game.catnip.pos;
          let groundTarget = catnipTarget;
          if (clockTime >= (cat.nav.catnipPathCheckAt || 0)) {
            const dynamicObstacles = buildCatObstacles(true, true);
            const approachReachable = canReachGroundTarget(cat.pos, catnipTarget, dynamicObstacles);
            const exactReachable = canReachGroundTarget(cat.pos, game.catnip.pos, dynamicObstacles);
            cat.nav.catnipUseExactTarget = !approachReachable && exactReachable;
            cat.nav.catnipPathCheckAt = clockTime + 0.2;
          }
          if (cat.nav.catnipUseExactTarget) {
            groundTarget = game.catnip.pos;
          }
          cat.nav.debugDestination.set(groundTarget.x, 0, groundTarget.z);
          const atCatnip = moveCatTowardGroundWithBypass(groundTarget, stepDt, GROUND_MOVE_SPEED);
          const navReasonNow = cat.nav?.debugStep?.reason || "";
          if (!atCatnip && (navReasonNow === "wholePathBlocked" || navReasonNow === "noPath")) {
            abortCatnipRouteAndResumePatrol();
            animateCatPose(stepDt, true);
            return;
          }
          faceCatnip(stepDt);
          cat.state = atCatnip ? "distracted" : "toCatnip";
          cat.status = atCatnip ? "Eating catnip" : "Going to catnip";
          animateCatPose(stepDt, !atCatnip);
          return;
        }
      }
      }
    }

    if (cat.state === "patrol") {
      if (cat.debugMoveActive) {
        if (updatePatrolMoveTarget(stepDt)) return;
      }
      if (clockTime >= cat.nextTableRollAt) {
        if (
          clockTime >= cat.tableRollStartAt &&
          !cup.broken &&
          !cup.falling &&
          Math.random() < CAT_BEHAVIOR.tableApproachChancePerSecond
        ) {
          clearCatJumpTargets();
          cat.state = "toDesk";
        }
        cat.nextTableRollAt += CAT_BEHAVIOR.tableApproachRollInterval;
      }
      if (cat.state === "patrol") {
        const target = cat.patrolTarget;
        if (clockTime >= cat.nav.patrolPathCheckAt) {
          cat.nav.patrolPathCheckAt = clockTime + 0.2;
          const dynamicObstacles = buildCatObstacles(true, true);
          if (!canReachGroundTarget(cat.pos, target, dynamicObstacles)) {
            if (!setNextPatrolTarget(true)) enterNoPathSit();
            else if (!cat.debugMoveActive) ensureCatPath(cat.patrolTarget, true, true);
            animateCatPose(stepDt, false);
            return;
          }
        }
        const reached = moveCatTowardGroundWithBypass(target, stepDt, 0.95);
        cat.status = "Patrolling";
        if (reached) {
          cat.manualPatrolActive = false;
          if (!setNextPatrolTarget(true)) enterNoPathSit();
        }
        animateCatPose(stepDt, true);
        return;
      }
    }

    if (cat.state === "toDesk") {
      const shouldReplanAnchor =
        cat.stateT > 8.0 ||
        !cat.jumpAnchor ||
        (cat.nav.stuckT > 0.46 && clockTime >= cat.nav.anchorReplanAt);
      if (shouldReplanAnchor) {
        cat.jumpAnchor = bestDeskJumpAnchor(cat.pos, getDeskDesiredTarget());
        clearCatJumpTargets(false);
        if (cat.jumpAnchor) {
          // Seed a stable preview jump plan immediately so debug path lines do not jitter.
          const previewTargets = computeDeskJumpTargets(cat.jumpAnchor, getDeskDesiredTarget());
          if (previewTargets && !isDeskLandingBlockedByObjects(previewTargets.top)) {
            cat.jumpTargets = previewTargets;
          }
        }
        clearCatNavPath(true);
        cat.nav.anchorReplanAt = clockTime + 0.55;
        cat.nav.anchorLandingCheckAt = clockTime + 0.12;
        resetCatJumpBypass();
        if (cat.stateT > 8.0) cat.stateT = 0;
      }
      if (!cat.jumpAnchor) {
        cat.state = "patrol";
        cat.phaseT = 0;
        if (!setNextPatrolTarget(true)) enterNoPathSit();
        animateCatPose(stepDt, false);
        return;
      }
      if (cat.jumpAnchor && clockTime >= cat.nav.anchorLandingCheckAt) {
        // Landing checks are expensive; run them often near anchor or when movement is unstable.
        const nearAnchor = cat.pos.distanceToSquared(cat.jumpAnchor) < 0.9 * 0.9;
        const shouldCheckLanding = nearAnchor || cat.nav.stuckT > 0.1 || cat.stateT < 1.2;
        if (shouldCheckLanding) {
          const jumpTargets = computeDeskJumpTargets(cat.jumpAnchor, getDeskDesiredTarget());
          if (!jumpTargets || isDeskLandingBlockedByObjects(jumpTargets.top)) {
            cat.jumpTargets = null;
            if (!replanDeskJumpOrFallback()) return;
          } else {
            cat.jumpTargets = jumpTargets;
          }
        }
        cat.nav.anchorLandingCheckAt = clockTime + (shouldCheckLanding ? 0.14 : 0.35);
      }
      if (clockTime >= cat.nav.jumpBypassCheckAt && cat.jumpAnchor) {
        // Avoid full path probes every tick; only do them when steering indicates trouble.
        const shouldProbeBypass =
          cat.nav.jumpNoClip || cat.nav.stuckT > 0.1 || (cat.nav.segmentBlockedFrames || 0) > 1;
        if (shouldProbeBypass) {
          const dynamicObstacles = buildCatObstacles(true, true);
          const hasDynamicPath = canReachGroundTarget(cat.pos, cat.jumpAnchor, dynamicObstacles);
          if (!hasDynamicPath) {
            if (!replanDeskJumpOrFallback()) return;
          } else if (cat.nav.jumpNoClip) {
            resetCatJumpBypass();
          }
        }
        cat.nav.jumpBypassCheckAt = clockTime + (shouldProbeBypass ? CAT_NAV.jumpBypassCheckInterval : 0.4);
      }
      const reachedDesk = moveCatTowardGroundWithBypass(cat.jumpAnchor, stepDt, 0.92);
      cat.status = "Approaching jump point";
      if (!reachedDesk) {
        const navReason = cat.nav?.debugStep?.reason;
        if (navReason === "wholePathBlocked" || navReason === "noPath") {
          if (!replanDeskJumpOrFallback()) return;
          cat.nav.anchorReplanAt = clockTime + 0.2;
          animateCatPose(stepDt, false);
          return;
        }
      }
      animateCatPose(stepDt, true);
      if (reachedDesk) {
        cat.state = "prepareJump";
        cat.phaseT = 0;
        clearCatJumpTargets(false);
        resetCatJumpBypass();
        clearCatNavPath(false);
      }
      return;
    }

    if (cat.state === "prepareJump") {
      cat.phaseT += stepDt;
      if (cat.jumpAnchor) {
        cat.pos.x = cat.jumpAnchor.x;
        cat.pos.z = cat.jumpAnchor.z;
        cat.group.position.set(cat.pos.x, 0, cat.pos.z);
      }
      if (cat.jumpAnchor) {
        const refreshedTargets = computeDeskJumpTargets(cat.jumpAnchor, getDeskDesiredTarget());
        if (!refreshedTargets || isDeskLandingBlockedByObjects(refreshedTargets.top)) {
          // Landing zone became unsafe (cup/object too close): re-plan anchor instead of forcing a bad jump.
          if (!replanDeskJumpOrFallback()) return;
          return;
        }
        cat.jumpTargets = refreshedTargets;
      }
      const lookTarget = cat.jumpTargets ? cat.jumpTargets.hook : desk.perch;
      const dx = lookTarget.x - cat.pos.x;
      const dz = lookTarget.z - cat.pos.z;
      const yaw = Math.atan2(dx, dz);
      const dy = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
      cat.group.rotation.y += dy * Math.min(1, stepDt * 5.5);
      cat.status = "Preparing jump";
      animateCatPose(stepDt, false);
      if (cat.phaseT >= JUMP_UP_TIMING.prepare && cat.jumpTargets) {
        // Last-moment guard: never launch if landing has become blocked.
        const finalTargets = computeDeskJumpTargets(cat.jumpAnchor, getDeskDesiredTarget());
        if (!finalTargets || isDeskLandingBlockedByObjects(finalTargets.top)) {
          if (!replanDeskJumpOrFallback()) return;
          return;
        }
        cat.jumpTargets = finalTargets;
        cat.jumpApproachLock = false;
        cat.state = "launchUp";
        startJump(
          cat.jumpTargets.top,
          desk.topY + 0.02,
          (JUMP_UP_TIMING.launch + JUMP_UP_TIMING.hook + JUMP_UP_TIMING.pull) / 3,
          0.46,
          "jumpSettle",
          {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
          upPrep: false,
          }
        );
      }
      return;
    }

    if (cat.state === "forepawHook") {
      // Legacy state: collapse into a single jump path.
      cat.state = "jumpSettle";
      return;
    }

    if (cat.state === "jumpSettle") {
      cat.phaseT += stepDt;
      if (cat.stateT <= 0.001) {
        cat.onTable = true;
        clearCatJumpTargets();
        clearCatNavPath(false);
      }
      cat.status = "Settling on desk";
      animateCatPose(stepDt, false);
      if (cat.phaseT >= JUMP_UP_TIMING.settle) {
        pickTableRoamTarget(false);
        cat.nextTableRoamAt = clockTime + 0.35;
        cat.state = game.catnip && game.catnip.surface === "desk" ? "toCatnip" : "toCup";
        cat.phaseT = 0;
      }
      return;
    }

    if (cat.state === "toCup") {
      cat.phaseT += stepDt;
      const cupActive = !cup.broken && !cup.falling;

      if (cupActive) {
        const swipePlan = computeCupSwipePlan(THREE, desk, cup.group.position, cupSwipePoint, cupSwipeEdgeDir);
        const toCupX = cup.group.position.x - cat.pos.x;
        const toCupZ = cup.group.position.z - cat.pos.z;
        const cupDist2 = toCupX * toCupX + toCupZ * toCupZ;
        const immediateSwipeRadius = 0.3;
        const immediateSwipe = cupDist2 <= immediateSwipeRadius * immediateSwipeRadius;

        if (immediateSwipe) {
          const faceYaw = Math.atan2(toCupX, toCupZ);
          const yawDelta = Math.atan2(
            Math.sin(faceYaw - cat.group.rotation.y),
            Math.cos(faceYaw - cat.group.rotation.y)
          );
          cat.group.rotation.y += yawDelta * Math.min(1, stepDt * 8.4);
          cat.status = "Aiming swipe";
          animateCatPose(stepDt, false);
          if (Math.abs(yawDelta) < 0.42) {
            cat.state = "swipe";
            cat.phaseT = 0;
            cat.swipeHitDone = false;
          }
          return;
        }

        const reachedSwipePoint = moveCatToward(swipePlan.point, stepDt, 0.72, desk.topY + 0.02, {
          direct: true,
          ignoreDynamic: true,
        });
        if (!reachedSwipePoint) {
          cat.status = "Lining up swipe";
          animateCatPose(stepDt, true);
          return;
        }
        const yawDelta = Math.atan2(
          Math.sin(swipePlan.faceYaw - cat.group.rotation.y),
          Math.cos(swipePlan.faceYaw - cat.group.rotation.y)
        );
        cat.group.rotation.y += yawDelta * Math.min(1, stepDt * 7.2);
        const facingReady = Math.abs(yawDelta) < 0.3;
        cat.status = "Aiming swipe";
        animateCatPose(stepDt, !facingReady);
        if (facingReady) {
          cat.state = "swipe";
          cat.phaseT = 0;
          cat.swipeHitDone = false;
        }
        if (cat.phaseT > 3.2 && cat.nav.stuckT > 0.6) {
          // Escape lining-up deadlocks on crowded surfaces.
          cat.pos.x = swipePlan.point.x;
          cat.pos.z = swipePlan.point.z;
          cat.group.position.set(cat.pos.x, desk.topY + 0.02, cat.pos.z);
          cat.state = "swipe";
          cat.phaseT = 0;
          cat.swipeHitDone = false;
        }
        return;
      } else if (
        clockTime >= cat.nextTableRoamAt ||
        cat.pos.distanceToSquared(cat.tableRoamTarget) < 0.18 * 0.18
      ) {
        pickTableRoamTarget(false);
        cat.nextTableRoamAt = clockTime + THREE.MathUtils.lerp(0.55, 1.35, Math.random());
      }

      const reachedRoam = moveCatToward(cat.tableRoamTarget, stepDt, 0.62, desk.topY + 0.02, {
        direct: true,
        ignoreDynamic: false,
      });
      cat.status = "Roaming desk";
      animateCatPose(stepDt, !reachedRoam);

      if (cat.phaseT > 1.4 && Math.random() < stepDt * 0.1) {
        startJumpDownFromDesk("patrol");
      }
      return;
    }

    if (cat.state === "swipe") {
      cat.phaseT += stepDt;
      const yaw = Math.atan2(cup.group.position.x - cat.pos.x, cup.group.position.z - cat.pos.z);
      const dy = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
      cat.group.rotation.y += dy * Math.min(1, stepDt * 8.0);
      cat.status = "Swiping cup";
      animateCatPose(stepDt, false);

      const swipePose = sampleSwipePose(cat.phaseT);
      if (swipePose.hit && !cat.swipeHitDone && !cup.broken && !cup.falling) {
        const dirX = Math.sin(cat.group.rotation.y);
        const dirZ = Math.cos(cat.group.rotation.y);
        const momentum = 0.75 + Math.max(0, swipePose.reach) * 0.55;
        knockCup({ dirX, dirZ, strength: momentum });
        cat.swipeHitDone = true;
      }
      // Deterministic fallback: never let swipe stall without producing a cup hit.
      if (!cat.swipeHitDone && cat.phaseT > 0.9 && !cup.broken && !cup.falling) {
        const dirX = Math.sin(cat.group.rotation.y);
        const dirZ = Math.cos(cat.group.rotation.y);
        knockCup({ dirX, dirZ, strength: 0.85 });
        cat.swipeHitDone = true;
      }
      if (swipePose.done || cup.falling || cup.broken) {
        cat.swipeHitDone = false;
        startJumpDownFromDesk("sit");
      }
      return;
    }

    if (cat.state === "jumpDown") {
      if (!refreshJumpDownLink(null, false, cat.nav.jumpDownLandingSurfaceId || "floor")) {
        cat.status = "No jump-down link";
        setJumpDownDebug({
          phase: "plan-refresh-fail",
          failReason: "noJumpDownPlan",
          planValid: false,
          navReason: cat.nav?.debugStep?.reason || "na",
          stateT: cat.stateT,
        });
        animateCatPose(stepDt, false);
        return;
      }
      const elevatedY = Math.max(0.02, cat.group.position.y);
      const reachedJumpOff = moveCatToward(cat.debugMoveJumpOff, stepDt, 0.84, elevatedY, {
        direct: true,
        ignoreDynamic: true,
      });
      const dropDx = cat.debugMoveJumpOff.x - cat.pos.x;
      const dropDz = cat.debugMoveJumpOff.z - cat.pos.z;
      const distToDrop = Math.hypot(dropDx, dropDz);
      const nearDrop = distToDrop < 0.16;
      const commanded = Number.isFinite(cat.nav?.commandedSpeed) ? cat.nav.commandedSpeed : 0;
      const actual = Number.isFinite(cat.nav?.lastSpeed) ? cat.nav.lastSpeed : 0;
      const stalledWhileNear = distToDrop < 0.26 && commanded > 0.12 && actual < 0.01;
      cat.nav.jumpDownNoMoveT = stalledWhileNear
        ? (Number.isFinite(cat.nav.jumpDownNoMoveT) ? cat.nav.jumpDownNoMoveT : 0) + stepDt
        : 0;
      const stallReady = cat.nav.jumpDownNoMoveT > 0.18;
      const readyToDrop = reachedJumpOff || (nearDrop && cat.stateT > 0.16) || stallReady;
      cat.status = "Preparing jump down";
      setJumpDownDebug({
        phase: readyToDrop ? "launching" : "approach-off",
        planValid: !!cat.nav.jumpDownPlanValid,
        reachedJumpOff: !!reachedJumpOff,
        nearDrop: !!nearDrop,
        readyToDrop: !!readyToDrop,
        stallReady: !!stallReady,
        noMoveT: cat.nav.jumpDownNoMoveT || 0,
        distToDrop,
        stateT: cat.stateT,
        navReason: cat.nav?.debugStep?.reason || "na",
        jumpOffX: cat.debugMoveJumpOff?.x,
        jumpOffY: elevatedY,
        jumpOffZ: cat.debugMoveJumpOff?.z,
        jumpDownX: cat.debugMoveJumpDown?.x,
        jumpDownY: cat.debugMoveJumpDownY || 0,
        jumpDownZ: cat.debugMoveJumpDown?.z,
        currentX: cat.pos.x,
        currentY: cat.group.position.y,
        currentZ: cat.pos.z,
        speed: cat.nav?.lastSpeed || 0,
        commandedSpeed: cat.nav?.commandedSpeed || 0,
      });
      animateCatPose(stepDt, !readyToDrop);
      if (readyToDrop) {
        cat.onTable = false;
        cat.nav.jumpDownPlanValid = false;
        cat.nav.jumpDownToward = null;
        cat.nav.jumpDownLandingSurfaceId = null;
        cat.nav.jumpDownNoMoveT = 0;
        setJumpDownDebug({
          phase: "jump-started",
          planValid: false,
          launchToX: cat.debugMoveJumpDown?.x,
          launchToY: cat.debugMoveJumpDownY || 0,
          launchToZ: cat.debugMoveJumpDown?.z,
        });
        startJump(cat.debugMoveJumpDown, cat.debugMoveJumpDownY || 0, 0.52, 0.34, "landStop", {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
        });
        cat.status = "Jumping down";
      }
      return;
    }

    if (cat.state === "landStop") {
      cat.phaseT += stepDt;
      cat.status = "Landing";
      setJumpDownDebug({
        phase: "land-stop",
        stateT: cat.stateT,
      });
      animateCatPose(stepDt, false);
      const baseLandDuration = Math.max(0.22, Number.isFinite(cat.landStopDuration) ? cat.landStopDuration : 0.22);
      let requiredLandDuration = baseLandDuration;
      let clipFinished = false;
      const landClipAction = cat.stateClipActions?.landStop?.action;
      const landClip = landClipAction?.getClip?.();
      const rawClipDuration = landClip?.duration;
      if (Number.isFinite(rawClipDuration) && rawClipDuration > 1e-5) {
        const overrideSpeed = cat.clipSpecialSpeedOverrides?.landStop;
        const defaultSpeed = Number.isFinite(cat.stateClipActions?.landStop?.speed)
          ? cat.stateClipActions.landStop.speed
          : 1;
        const clipSpeed = Math.max(0.05, Number.isFinite(overrideSpeed) ? overrideSpeed : defaultSpeed);
        requiredLandDuration = Math.max(requiredLandDuration, rawClipDuration / clipSpeed);
        // Respect full clip completion when clip locomotion is active.
        clipFinished = landClipAction.time >= rawClipDuration - 1 / 60;
      }

      const readyByTime = cat.phaseT >= requiredLandDuration;
      const canLeaveLandStop =
        Number.isFinite(rawClipDuration) && rawClipDuration > 1e-5
          ? (readyByTime && clipFinished)
          : readyByTime;
      if (canLeaveLandStop) {
        cat.state = cat.landStopNextState || "patrol";
        cat.phaseT = 0;
        cat.landStopNextState = "patrol";
        cat.landStopDuration = 0.22;
      }
      return;
    }

    if (cat.state === "sit") {
      cat.phaseT += stepDt;
      cat.status = "Sitting";
      animateCatPose(stepDt, false);
      const sitFor = Math.max(0.2, Number.isFinite(cat.sitDuration) ? cat.sitDuration : 1.25);
      if (cat.phaseT >= sitFor) {
        cat.sitDuration = 1.25;
        if (cat.onTable || cat.group.position.y > 0.08) {
          const floorPoint = pickRandomPatrolPoint(cat.pos, false);
          if (!floorPoint || !queuePatrolMoveTarget({ surface: "floor", point: floorPoint.clone(), floorPoint }, 0)) {
            enterNoPathSit(0.85);
          }
        } else {
          cat.state = "patrol";
          cat.phaseT = 0;
        }
      }
    }
  }

  return updateCatImpl(dt);
}
