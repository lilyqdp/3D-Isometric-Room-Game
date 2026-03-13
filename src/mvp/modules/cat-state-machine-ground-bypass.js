export function createCatStateMachineGroundBypassRuntime(ctx) {
  const {
    getClockTime,
    cat,
    moveCatToward,
    canReachGroundTarget,
    buildCatObstacles,
    nudgeBlockingPickupAwayFromCat,
  } = ctx;

  function clearGroundBypassMode() {
    cat.nav.dynamicBypassActive = false;
    cat.nav.dynamicBypassUntil = 0;
    cat.nav.dynamicBypassNudgeAt = 0;
    cat.nav.dynamicBypassCheckAt = 0;
    cat.nav.dynamicBypassTargetX = NaN;
    cat.nav.dynamicBypassTargetZ = NaN;
  }

  function isSameGroundBypassTarget(target) {
    if (!target) return false;
    const tx = Number(cat.nav.dynamicBypassTargetX);
    const tz = Number(cat.nav.dynamicBypassTargetZ);
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) return false;
    const dx = target.x - tx;
    const dz = target.z - tz;
    return dx * dx + dz * dz <= 0.2 * 0.2;
  }

  function moveCatTowardGroundWithBypass(target, stepDt, speed) {
    if (!target) return false;
    const clockTime = getClockTime();

    if (
      cat.jump ||
      cat.onTable ||
      cat.group.position.y > 0.08 ||
      cat.state === "jumpDown" ||
      cat.state === "landStop"
    ) {
      clearGroundBypassMode();
      return moveCatToward(target, stepDt, speed, 0);
    }

    if (!Number.isFinite(cat.nav.dynamicBypassCheckAt)) cat.nav.dynamicBypassCheckAt = 0;
    if (!Number.isFinite(cat.nav.dynamicBypassNudgeAt)) cat.nav.dynamicBypassNudgeAt = 0;
    if (!Number.isFinite(cat.nav.dynamicBypassUntil)) cat.nav.dynamicBypassUntil = 0;

    if (!isSameGroundBypassTarget(target)) {
      clearGroundBypassMode();
      cat.nav.dynamicBypassTargetX = target.x;
      cat.nav.dynamicBypassTargetZ = target.z;
    }

    if (clockTime >= cat.nav.dynamicBypassCheckAt) {
      const dynamicPathExists = canReachGroundTarget(cat.pos, target, buildCatObstacles(true, true));
      if (!dynamicPathExists) {
        const staticPathExists = canReachGroundTarget(cat.pos, target, buildCatObstacles(false));
        if (staticPathExists) {
          cat.nav.dynamicBypassActive = true;
          cat.nav.dynamicBypassUntil = Math.max(cat.nav.dynamicBypassUntil || 0, clockTime + 0.9);
          cat.nav.dynamicBypassNudgeAt = Math.min(cat.nav.dynamicBypassNudgeAt || 0, clockTime);
        } else {
          clearGroundBypassMode();
        }
      } else if (
        cat.nav.dynamicBypassActive &&
        cat.nav.stuckT < 0.12 &&
        clockTime >= (cat.nav.dynamicBypassUntil || 0)
      ) {
        clearGroundBypassMode();
      }
      cat.nav.dynamicBypassCheckAt = clockTime + (cat.nav.dynamicBypassActive ? 0.08 : 0.14);
    }

    if (cat.nav.dynamicBypassActive && clockTime >= (cat.nav.dynamicBypassUntil || 0)) {
      const dynamicPathExists = canReachGroundTarget(cat.pos, target, buildCatObstacles(true, true));
      if (dynamicPathExists && cat.nav.stuckT < 0.12) {
        clearGroundBypassMode();
      } else {
        cat.nav.dynamicBypassUntil = clockTime + 0.22;
      }
    }

    const reached = moveCatToward(target, stepDt, speed, 0, {
      ignoreDynamic: !!cat.nav.dynamicBypassActive,
    });

    if (cat.nav.dynamicBypassActive && clockTime >= (cat.nav.dynamicBypassNudgeAt || 0)) {
      const nudged =
        typeof nudgeBlockingPickupAwayFromCat === "function" &&
        nudgeBlockingPickupAwayFromCat();
      cat.nav.dynamicBypassNudgeAt = clockTime + (nudged ? 0.05 : 0.11);
      if (nudged) {
        cat.nav.dynamicBypassUntil = Math.max(cat.nav.dynamicBypassUntil || 0, clockTime + 0.28);
        cat.status = "Shoving clutter";
      }
    }

    if (reached) clearGroundBypassMode();
    return reached;
  }

  return {
    clearGroundBypassMode,
    moveCatTowardGroundWithBypass,
  };
}
