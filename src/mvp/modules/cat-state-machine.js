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
        cat.state = "patrol";
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
      if (cat.onTable) {
        cat.onTable = false;
        const downPoint = findSafeGroundPoint(desk.approach);
        startJump(downPoint, 0, 0.62, 0.34, "toCatnip", {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
        });
        return;
      }
      clearCatJumpTargets();
      cat.state = "toCatnip";
      const atCatnip = moveCatToward(game.catnip.pos, stepDt, 1.0, 0);
      cat.status = atCatnip ? "Distracted" : "Going to catnip";
      animateCatPose(stepDt, !atCatnip);
      return;
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
        startJump(cat.jumpTargets.hook, desk.topY - 0.18, JUMP_UP_TIMING.launch, 0.4, "forepawHook", {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
        });
      }
      return;
    }

    if (cat.state === "forepawHook") {
      cat.phaseT += stepDt;
      cat.status = "Grabbing edge";
      animateCatPose(stepDt, false);
      if (cat.phaseT >= JUMP_UP_TIMING.hook && cat.jumpTargets) {
        cat.state = "pullUp";
        startJump(cat.jumpTargets.top, desk.topY + 0.02, JUMP_UP_TIMING.pull, 0.26, "jumpSettle", {
          easePos: true,
          easeY: true,
          avoidDeskClip: true,
        });
      }
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
        cat.state = "toCup";
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
        startJump(downPoint, 0, 0.64, 0.34, "sit", {
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
