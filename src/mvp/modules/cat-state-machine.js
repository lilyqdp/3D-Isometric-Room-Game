import { animateCatPoseRuntime } from "./cat-animation.js";

export function updateCatStateMachineRuntime(ctx, dt) {
  const {
    THREE,
    scene,
    clockTime,
    game,
    cat,
    CAT_NAV,
    CAT_BEHAVIOR,
    cup,
    desk,
    JUMP_UP_TIMING,
    CUP_COLLISION,
    recoverCatFromPickupTrap,
    updateJump,
    getCurrentGroundGoal,
    ensureCatPath,
    nudgeBlockingPickupAwayFromCat,
    findSafeGroundPoint,
    startJump,
    clearCatJumpTargets,
    moveCatToward,
    refreshCatPatrolTarget,
    bestDeskJumpAnchor,
    clearCatNavPath,
    resetCatJumpBypass,
    buildCatObstacles,
    canReachGroundTarget,
    hasClearTravelLine,
    computeDeskJumpTargets,
    keepCatAwayFromCup,
    knockCup,
    sampleSwipePose,
    resetCatUnstuckTracking,
  } = ctx;

  const animateCatPose = (stepDt, moving) => animateCatPoseRuntime(ctx, stepDt, moving);
  const CATNIP_MOUTH_OFFSET = 0.34;
  const catnipApproachTarget = new THREE.Vector3();

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
        refreshCatPatrolTarget();
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
      refreshCatPatrolTarget();
    }

    if (!cat.jump && cat.group.position.y <= 0.03 && cat.nav.stuckT > 0.7) {
      const rescueGoal = getCurrentGroundGoal();
      if (rescueGoal) {
        ensureCatPath(rescueGoal, true, true);
        cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
      }
      if (cat.nav.stuckT > 1.1 && nudgeBlockingPickupAwayFromCat()) {
        cat.nav.repathAt = 0;
        cat.nav.stuckT = Math.max(0.25, cat.nav.stuckT * 0.55);
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

    // Catnip overrides knock behavior.
    if (game.catnip) {
      const catnipOnDesk = game.catnip.surface === "desk";
      if (catnipOnDesk) {
        if (cat.onTable) {
          clearCatJumpTargets();
          const catnipTarget = getCatnipApproachTarget() || game.catnip.pos;
          const atCatnip = moveCatToward(catnipTarget, stepDt, 0.95, desk.topY + 0.02, {
            direct: true,
            ignoreDynamic: true,
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
          cat.jumpAnchor = bestDeskJumpAnchor(cat.pos);
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
        const atCatnip = moveCatToward(catnipTarget, stepDt, 1.0, 0);
        faceCatnip(stepDt);
        cat.state = atCatnip ? "distracted" : "toCatnip";
        cat.status = atCatnip ? "Eating catnip" : "Going to catnip";
        animateCatPose(stepDt, !atCatnip);
        return;
      }
    }

    if (cat.state === "patrol") {
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
        const reached = moveCatToward(target, stepDt, 0.95, 0);
        cat.status = "Patrolling";
        if (reached) refreshCatPatrolTarget();
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
        cat.jumpAnchor = bestDeskJumpAnchor(cat.pos);
        clearCatJumpTargets(false);
        clearCatNavPath(true);
        cat.nav.anchorReplanAt = clockTime + 0.55;
        resetCatJumpBypass();
        if (cat.stateT > 8.0) cat.stateT = 0;
      }
      if (clockTime >= cat.nav.jumpBypassCheckAt && cat.jumpAnchor) {
        const dynamicObstacles = buildCatObstacles(true, true);
        const hasDynamicPath = canReachGroundTarget(cat.pos, cat.jumpAnchor, dynamicObstacles);
        if (cat.nav.jumpNoClip) {
          if (hasDynamicPath) {
            resetCatJumpBypass();
          }
        } else if (!hasDynamicPath) {
          // Temporary bypass through placeable clutter only; static geometry is still respected.
          cat.nav.jumpNoClip = true;
          clearCatNavPath(true);
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
        ignoreDynamic: cat.nav.jumpNoClip,
      });
      cat.status = cat.nav.jumpNoClip ? "Approaching jump point (bypassing clutter)" : "Approaching jump point";
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
      if (!cat.jumpTargets && cat.jumpAnchor) {
        cat.jumpTargets = computeDeskJumpTargets(cat.jumpAnchor);
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
        cat.state = game.catnip && game.catnip.surface === "desk" ? "toCatnip" : "toCup";
        cat.phaseT = 0;
      }
      return;
    }

    if (cat.state === "toCup") {
      const target = new THREE.Vector3(desk.cup.x - 0.36, 0, desk.cup.z + 0.02);
      const reachedCup = moveCatToward(target, stepDt, 0.65, desk.topY + 0.02);
      keepCatAwayFromCup(CUP_COLLISION.catAvoidRadius);
      const closeEnough = cat.pos.distanceToSquared(target) < 0.18 * 0.18;
      cat.status = "Stalking cup";
      animateCatPose(stepDt, true);
      if (reachedCup || closeEnough) {
        cat.state = "swipe";
        cat.phaseT = 0;
        cat.swipeHitDone = false;
      }
      return;
    }

    if (cat.state === "swipe") {
      cat.phaseT += stepDt;
      cat.status = "Swiping";
      cat.group.position.y = desk.topY + 0.02;
      keepCatAwayFromCup(CUP_COLLISION.catAvoidRadius);
      const swipePose = sampleSwipePose(cat.phaseT);
      cat.paw.position.y = 0.25 + swipePose.lift * 0.24;
      cat.paw.position.x = 0.21 + swipePose.reach * 0.32;
      if (swipePose.hit && !cat.swipeHitDone) {
        knockCup();
        cat.swipeHitDone = true;
      }
      if (swipePose.done) {
        cat.paw.position.y = 0.25;
        cat.paw.position.x = 0.21;
        cat.state = "jumpDown";
        cat.onTable = false;
        cat.phaseT = 0;
        clearCatJumpTargets();
        clearCatNavPath(false);
        const downPoint = findSafeGroundPoint(desk.approach);
        cat.landStopNextState = "sit";
        startJump(downPoint, 0, 0.64, 0.34, "landStop", {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
        });
      }
      animateCatPose(stepDt, false);
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
      if (cat.phaseT >= 1.25) {
        cat.state = "patrol";
        cat.phaseT = 0;
      }
    }
  }

  return updateCatImpl(dt);
}
