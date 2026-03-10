import { animateCatPoseRuntime } from "./cat-animation.js";
import { computeCupSwipePlan } from "./cat-plans.js";

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
    updateJump,
    getCurrentGroundGoal,
    ensureCatPath,
    findSafeGroundPoint,
    startJump,
    clearCatJumpTargets,
    moveCatToward,
    pickRandomPatrolPoint,
    bestDeskJumpAnchor,
    clearCatNavPath,
    resetCatJumpBypass,
    updateDebugJumpDownPlan,
    buildCatObstacles,
    canReachGroundTarget,
    hasClearTravelLine,
    computeDeskJumpTargets,
    sampleSwipePose,
    knockCup,
    resetCatUnstuckTracking,
  } = ctx;

  const animateCatPose = (stepDt, moving) => animateCatPoseRuntime(ctx, stepDt, moving);
  const CATNIP_MOUTH_OFFSET = 0.34;
  const GROUND_MOVE_SPEED = 0.95;
  const catnipApproachTarget = new THREE.Vector3();
  const tableRoamTarget = new THREE.Vector3();
  const cupSwipePoint = new THREE.Vector3();
  const cupSwipeEdgeDir = new THREE.Vector3();

  function isDeskLandingBlockedByObjects(point) {
    if (!point) return true;
    const landingClearance = CAT_COLLISION.catBodyRadius * 1.5;
    const landingClearance2 = landingClearance * landingClearance;

    if (!cup.broken && !cup.falling && cup.group.visible) {
      const dx = point.x - cup.group.position.x;
      const dz = point.z - cup.group.position.z;
      if (dx * dx + dz * dz < landingClearance2) return true;
    }

    const minY = desk.topY - 0.24;
    const maxY = desk.topY + 0.55;
    for (const pickup of pickups) {
      if (!pickup?.mesh || !pickup.mesh.visible) continue;
      const py = pickup.mesh.position.y;
      if (!Number.isFinite(py) || py < minY || py > maxY) continue;
      const dx = point.x - pickup.mesh.position.x;
      const dz = point.z - pickup.mesh.position.z;
      const pickupPad = Math.max(0.02, pickupRadius(pickup) * 0.2);
      const minDist = landingClearance + pickupPad;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }

    return false;
  }

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

  function getDeskDesiredTarget() {
    if (game.catnip && game.catnip.surface === "desk") return game.catnip.pos;
    if (!cup.broken && !cup.falling) return cup.group.position;
    return desk.perch;
  }

  function pickTableRoamTarget(nearCup = false) {
    const minX = desk.pos.x - desk.sizeX * 0.5 + 0.32;
    const maxX = desk.pos.x + desk.sizeX * 0.5 - 0.32;
    const minZ = desk.pos.z - desk.sizeZ * 0.5 + 0.28;
    const maxZ = desk.pos.z + desk.sizeZ * 0.5 - 0.28;

    if (nearCup && !cup.broken && !cup.falling) {
      const angle = Math.random() * Math.PI * 2;
      const radius = THREE.MathUtils.lerp(0.22, 0.46, Math.random());
      tableRoamTarget.set(
        cup.group.position.x + Math.cos(angle) * radius,
        0,
        cup.group.position.z + Math.sin(angle) * radius
      );
    } else {
      tableRoamTarget.set(
        THREE.MathUtils.lerp(minX, maxX, Math.random()),
        0,
        THREE.MathUtils.lerp(minZ, maxZ, Math.random())
      );
    }

    tableRoamTarget.x = THREE.MathUtils.clamp(tableRoamTarget.x, minX, maxX);
    tableRoamTarget.z = THREE.MathUtils.clamp(tableRoamTarget.z, minZ, maxZ);
    cat.tableRoamTarget.copy(tableRoamTarget);
  }

  function startJumpDownFromDesk(nextState = "patrol") {
    cat.state = "jumpDown";
    cat.onTable = false;
    cat.phaseT = 0;
    clearCatJumpTargets();
    clearCatNavPath(false);
    const downPoint = findSafeGroundPoint(desk.approach);
    cat.landStopNextState = nextState;
    startJump(downPoint, 0, 0.64, 0.34, "landStop", {
      easePos: true,
      easeY: true,
      avoidDeskClip: true,
    });
  }

  function getCatnipApproachTarget() {
    if (!game.catnip) return null;

    let dx = game.catnip.pos.x - cat.pos.x;
    let dz = game.catnip.pos.z - cat.pos.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      // If we are already very close, reuse facing direction for a stable mouth offset.
      dx = Math.sin(cat.group.rotation.y);
      dz = Math.cos(cat.group.rotation.y);
      len = 1;
    }

    const ux = dx / len;
    const uz = dz / len;
    let tx = game.catnip.pos.x - ux * CATNIP_MOUTH_OFFSET;
    let tz = game.catnip.pos.z - uz * CATNIP_MOUTH_OFFSET;

    if (game.catnip.surface === "desk") {
      const edgePad = 0.14;
      tx = THREE.MathUtils.clamp(tx, desk.pos.x - desk.sizeX * 0.5 + edgePad, desk.pos.x + desk.sizeX * 0.5 - edgePad);
      tz = THREE.MathUtils.clamp(tz, desk.pos.z - desk.sizeZ * 0.5 + edgePad, desk.pos.z + desk.sizeZ * 0.5 - edgePad);
    }

    catnipApproachTarget.set(tx, 0, tz);
    return catnipApproachTarget;
  }

  function faceCatnip(stepDt) {
    if (!game.catnip) return;
    const dx = game.catnip.pos.x - cat.pos.x;
    const dz = game.catnip.pos.z - cat.pos.z;
    if (dx * dx + dz * dz < 1e-6) return;
    const yaw = Math.atan2(dx, dz);
    const dy = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
    cat.group.rotation.y += dy * Math.min(1, stepDt * 7.2);
  }

  function enterNoPathSit(seconds = 0.95) {
    cat.debugMoveActive = false;
    cat.manualPatrolActive = false;
    cat.state = "sit";
    cat.phaseT = 0;
    cat.sitDuration = seconds;
    cat.status = "No valid path";
    clearCatNavPath(true);
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
      if (!canReachGroundTarget(start, movePoint, dynamicObstacles)) {
        enterNoPathSit();
        return false;
      }
    }

    cat.debugMoveActive = true;
    cat.manualPatrolActive = false;
    cat.debugMoveSurface = isElevated ? "elevated" : "floor";
    cat.debugMoveY = isElevated ? Math.max(0.02, target.point.y) : 0;
    cat.debugMoveTarget.copy(movePoint);
    cat.debugMoveSitSeconds = sitSeconds;

    if (target?.jumpAnchor) cat.debugMoveJumpAnchor.copy(target.jumpAnchor);
    else cat.debugMoveJumpAnchor.copy(movePoint);
    if (target?.jumpLanding) cat.debugMoveLanding.copy(target.jumpLanding);
    else cat.debugMoveLanding.copy(movePoint);

    cat.debugMoveJumpOff.copy(cat.debugMoveLanding);
    cat.debugMoveJumpDown.copy(movePoint);

    if (!isElevated && (cat.onTable || cat.group.position.y > 0.08)) {
      if (!updateDebugJumpDownPlan(movePoint)) {
        cat.debugMoveJumpOff.set(cat.pos.x, 0, cat.pos.z);
        cat.debugMoveJumpDown.copy(movePoint);
      }
    } else if (isElevated && cat.group.position.y > 0.08 && Math.abs(cat.group.position.y - cat.debugMoveY) > 0.12) {
      if (!updateDebugJumpDownPlan(cat.debugMoveJumpAnchor)) {
        cat.debugMoveJumpOff.set(cat.pos.x, 0, cat.pos.z);
        cat.debugMoveJumpDown.copy(cat.debugMoveJumpAnchor);
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

  function updatePatrolMoveTarget(stepDt) {
    const targetY = cat.debugMoveSurface === "elevated" ? Math.max(0.02, cat.debugMoveY || 0) : 0;
    if (cat.debugMoveSurface === "elevated") {
      if (!cat.onTable && cat.group.position.y > 0.08) {
        cat.onTable = true;
      }
      if (cat.onTable && Math.abs(cat.group.position.y - targetY) > 0.12) {
        if (!updateDebugJumpDownPlan(cat.debugMoveJumpAnchor)) {
          cat.debugMoveJumpOff.set(cat.pos.x, 0, cat.pos.z);
          cat.debugMoveJumpDown.copy(cat.debugMoveJumpAnchor);
        }
        const elevatedY = Math.max(0.02, cat.group.position.y);
        const readyToDrop = moveCatToward(cat.debugMoveJumpOff, stepDt, 0.84, elevatedY, {
          direct: true,
          ignoreDynamic: false,
        });
        cat.status = "Repositioning";
        animateCatPose(stepDt, !readyToDrop);
        if (readyToDrop) {
          cat.onTable = false;
          startJump(cat.debugMoveJumpDown, 0, 0.52, 0.34, "patrol", {
            easePos: true,
            easeY: true,
            avoidDeskClip: true,
          });
        }
        return true;
      }
      if (!cat.onTable) {
        const reachedJumpAnchor = moveCatToward(cat.debugMoveJumpAnchor, stepDt, GROUND_MOVE_SPEED, 0);
        cat.status = "Preparing jump";
        animateCatPose(stepDt, !reachedJumpAnchor);
        if (reachedJumpAnchor) {
          startJump(cat.debugMoveLanding, targetY, 0.64, 0.46, "patrol", {
            easePos: true,
            easeY: true,
            avoidDeskClip: false,
          });
          cat.status = "Jumping up";
        }
        return true;
      }

      const reachedTarget = moveCatToward(cat.debugMoveTarget, stepDt, 0.84, targetY, {
        direct: true,
        ignoreDynamic: false,
      });
      cat.status = "Patrolling";
      animateCatPose(stepDt, !reachedTarget);
      if (reachedTarget) {
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
      if (!updateDebugJumpDownPlan(cat.debugMoveTarget)) {
        cat.debugMoveJumpOff.set(cat.pos.x, 0, cat.pos.z);
        cat.debugMoveJumpDown.copy(cat.debugMoveTarget);
      }
      const elevatedY = Math.max(0.02, cat.group.position.y);
      const readyToDrop = moveCatToward(cat.debugMoveJumpOff, stepDt, 0.84, elevatedY, {
        direct: true,
        ignoreDynamic: false,
      });
      cat.status = "Preparing jump down";
      animateCatPose(stepDt, !readyToDrop);
      if (readyToDrop) {
        cat.onTable = false;
        startJump(cat.debugMoveJumpDown, 0, 0.52, 0.34, "patrol", {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
        });
        cat.status = "Jumping down";
      }
      return true;
    }

    const reachedFloorTarget = moveCatToward(cat.debugMoveTarget, stepDt, GROUND_MOVE_SPEED, 0);
    cat.status = "Patrolling";
    animateCatPose(stepDt, !reachedFloorTarget);
    if (reachedFloorTarget) {
      cat.debugMoveActive = false;
      cat.manualPatrolActive = false;
      cat.onTable = false;
      const nextPatrol = pickRandomPatrolPoint(cat.pos, false);
      if (nextPatrol) cat.patrolTarget.copy(nextPatrol);
      else enterNoPathSit(0.85);
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
          const nextPatrol = pickRandomPatrolPoint(cat.pos, false);
          if (nextPatrol) {
            cat.patrolTarget.copy(nextPatrol);
          } else {
            enterNoPathSit();
          }
        }
        cat.nav.patrolPathCheckAt = clockTime;
        cat.nextTableRollAt = Math.max(clockTime + CAT_BEHAVIOR.tableApproachRollInterval, cat.nextTableRollAt);
      } else {
        cat.nextTableRollAt = clockTime + CAT_BEHAVIOR.tableApproachRollInterval;
      }
    } else {
      cat.stateT += stepDt;
    }

    if (!cat.jump && recoverCatFromPickupTrap(stepDt)) {
      animateCatPose(stepDt, false);
      return;
    }

    if (!cat.jump && cat.group.position.y <= 0.03 && cat.nav.stuckT > CAT_NAV.stuckReset) {
      cat.state = "patrol";
      clearCatJumpTargets();
      clearCatNavPath(true);
      resetCatUnstuckTracking();
      cat.nav.stuckT = 0;
      const nextPatrol = pickRandomPatrolPoint(cat.pos, false);
      if (nextPatrol) cat.patrolTarget.copy(nextPatrol);
      else enterNoPathSit();
    }

    if (!cat.jump && cat.group.position.y <= 0.03 && cat.nav.stuckT > 0.7) {
      const rescueGoal = getCurrentGroundGoal();
      if (rescueGoal) {
        ensureCatPath(rescueGoal, true, true);
        cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
      }
    }

    if (game.catnip && clockTime >= game.catnip.expiresAt) {
      scene.remove(game.catnip.mesh);
      game.catnip = null;
      if (cat.state === "toCatnip" || cat.state === "distracted") {
        if (cat.onTable) {
          if (!cup.broken && !cup.falling) {
            // Stay on the desk and resume normal desk behavior.
            cat.state = "toCup";
            cat.phaseT = 0;
          } else {
            // No cup target available; jump down instead of snapping through the desk.
            cat.onTable = false;
            const downPoint = findSafeGroundPoint(desk.approach);
            cat.landStopNextState = "patrol";
            startJump(downPoint, 0, 0.62, 0.34, "landStop", {
              easePos: true,
              easeY: true,
              avoidDeskClip: true,
            });
            return;
          }
        } else {
          cat.state = "patrol";
        }
      }
    }

    if (cat.jump) {
      updateJump(stepDt);
      if (cat.state === "launchUp") cat.status = "Jumping up";
      else if (cat.state === "pullUp") cat.status = "Pulling up";
      else if (cat.state === "jumpDown") cat.status = "Jumping down";
      else cat.status = "Jumping";
      animateCatPose(stepDt, false);
      return;
    }

    // Guard against stale jump states if a debug waypoint interrupts mid-air.
    if (cat.state === "jumpDown") {
      cat.state = "landStop";
      cat.phaseT = 0;
    } else if (cat.state === "launchUp" || cat.state === "pullUp") {
      cat.state = "patrol";
      cat.phaseT = 0;
    }

    // Catnip overrides knock behavior.
    if (game.catnip) {
      const catnipOnDesk = game.catnip.surface === "desk";
      if (catnipOnDesk) {
        if (cat.onTable) {
          clearCatJumpTargets();
          const catnipTarget = getCatnipApproachTarget() || game.catnip.pos;
          const atCatnip = moveCatToward(catnipTarget, stepDt, 0.95, desk.topY + 0.02, {
            direct: true,
            ignoreDynamic: false,
          });
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
          cat.state = "toDesk";
          cat.stateT = 0;
        }
      } else {
        if (cat.onTable) {
          cat.onTable = false;
          const downPoint = findSafeGroundPoint(desk.approach);
          cat.landStopNextState = "toCatnip";
          startJump(downPoint, 0, 0.62, 0.34, "landStop", {
            easePos: true,
            easeY: true,
            avoidDeskClip: true,
          });
          return;
        }
        clearCatJumpTargets();
        const catnipTarget = getCatnipApproachTarget() || game.catnip.pos;
        const atCatnip = moveCatToward(catnipTarget, stepDt, GROUND_MOVE_SPEED, 0);
        faceCatnip(stepDt);
        cat.state = atCatnip ? "distracted" : "toCatnip";
        cat.status = atCatnip ? "Eating catnip" : "Going to catnip";
        animateCatPose(stepDt, !atCatnip);
        return;
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
            const nextPatrol = pickRandomPatrolPoint(cat.pos, false);
            if (nextPatrol) {
              cat.patrolTarget.copy(nextPatrol);
              ensureCatPath(nextPatrol, true, true);
            } else {
              enterNoPathSit();
            }
            animateCatPose(stepDt, false);
            return;
          }
        }
        const reached = moveCatToward(target, stepDt, 0.95, 0);
        cat.status = "Patrolling";
        if (reached) {
          cat.manualPatrolActive = false;
          const nextPatrol = pickRandomPatrolPoint(cat.pos, false);
          if (nextPatrol) {
            cat.patrolTarget.copy(nextPatrol);
          } else {
            enterNoPathSit();
          }
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
        clearCatNavPath(true);
        cat.nav.anchorReplanAt = clockTime + 0.55;
        cat.nav.anchorLandingCheckAt = clockTime + 0.12;
        resetCatJumpBypass();
        if (cat.stateT > 8.0) cat.stateT = 0;
      }
      if (cat.jumpAnchor && clockTime >= cat.nav.anchorLandingCheckAt) {
        const jumpTargets = computeDeskJumpTargets(cat.jumpAnchor, getDeskDesiredTarget());
        if (!jumpTargets || isDeskLandingBlockedByObjects(jumpTargets.top)) {
          if (!replanDeskJumpOrFallback()) return;
        }
        cat.nav.anchorLandingCheckAt = clockTime + 0.14;
      }
      if (clockTime >= cat.nav.jumpBypassCheckAt && cat.jumpAnchor) {
        const dynamicObstacles = buildCatObstacles(true, true);
        const hasDynamicPath = canReachGroundTarget(cat.pos, cat.jumpAnchor, dynamicObstacles);
        if (!hasDynamicPath) {
          if (!replanDeskJumpOrFallback()) return;
        } else if (cat.nav.jumpNoClip) {
          resetCatJumpBypass();
        }
        cat.nav.jumpBypassCheckAt = clockTime + CAT_NAV.jumpBypassCheckInterval;
      }
      if (!cat.jumpApproachLock && cat.pos.distanceToSquared(cat.jumpAnchor) < 0.4 * 0.4) {
        const staticObstacles = buildCatObstacles(false);
        if (hasClearTravelLine(cat.pos, cat.jumpAnchor, staticObstacles)) {
          cat.jumpApproachLock = true;
        }
      }
      if (cat.jumpApproachLock && cat.pos.distanceToSquared(cat.jumpAnchor) > 0.56 * 0.56) {
        cat.jumpApproachLock = false;
      }
      const reachedDesk = moveCatToward(cat.jumpAnchor, stepDt, 0.92, 0, {
        direct: cat.jumpApproachLock,
        ignoreDynamic: false,
      });
      cat.status = "Approaching jump point";
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

        const reachedSwipePoint = moveCatToward(swipePlan.point, stepDt, 0.58, desk.topY + 0.02, {
          direct: true,
          ignoreDynamic: true,
        });
        const yawDelta = Math.atan2(
          Math.sin(swipePlan.faceYaw - cat.group.rotation.y),
          Math.cos(swipePlan.faceYaw - cat.group.rotation.y)
        );
        cat.group.rotation.y += yawDelta * Math.min(1, stepDt * 7.2);
        const facingReady = Math.abs(yawDelta) < 0.3;
        cat.status = reachedSwipePoint ? "Aiming swipe" : "Lining up swipe";
        animateCatPose(stepDt, !(reachedSwipePoint && facingReady));
        if (reachedSwipePoint && facingReady) {
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
      cat.status = "Jumping down";
      animateCatPose(stepDt, false);
      return;
    }

    if (cat.state === "landStop") {
      cat.phaseT += stepDt;
      cat.status = "Landing";
      animateCatPose(stepDt, false);
      if (cat.phaseT >= 0.22) {
        cat.state = cat.landStopNextState || "patrol";
        cat.phaseT = 0;
        cat.landStopNextState = "patrol";
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
