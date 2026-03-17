export function createCatStateMachineGroundBypassRuntime(ctx) {
  const {
    getClockTime,
    cat,
    moveCatToward,
    canReachGroundTarget,
    buildCatObstacles,
    nudgeBlockingPickupAwayFromCat,
  } = ctx;
  const BYPASS_FAILS_TO_ACTIVATE = 2;
  const BYPASS_STUCK_MIN = 0.12;
  const BYPASS_RECHECK_IDLE = 0.24;
  const BYPASS_RECHECK_ACTIVE = 0.16;
  const BYPASS_ACTIVE_WINDOW = 0.55;
  const BYPASS_EXTEND_WINDOW = 0.18;
  const BYPASS_CACHE_TTL_DYNAMIC = 0.12;
  const BYPASS_CACHE_TTL_STATIC = 0.22;
  const REACHABILITY_OPTIONS = Object.freeze({ allowFallback: true });

  function clearGroundBypassMode() {
    cat.nav.dynamicBypassActive = false;
    cat.nav.dynamicBypassUntil = 0;
    cat.nav.dynamicBypassNudgeAt = 0;
    cat.nav.dynamicBypassCheckAt = 0;
    cat.nav.dynamicBypassFailCount = 0;
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

  function getGroundReachabilityCache() {
    if (!cat.nav.dynamicBypassReachability || typeof cat.nav.dynamicBypassReachability !== "object") {
      cat.nav.dynamicBypassReachability = {
        dynamic: null,
        static: null,
      };
    }
    return cat.nav.dynamicBypassReachability;
  }

  function readCachedGroundReachability(kind, start, target, clockTime) {
    const entry = getGroundReachabilityCache()[kind];
    if (!entry || clockTime > (entry.expiresAt || 0)) return null;
    const startDx = start.x - entry.startX;
    const startDz = start.z - entry.startZ;
    const targetDx = target.x - entry.targetX;
    const targetDz = target.z - entry.targetZ;
    if (startDx * startDx + startDz * startDz > 0.18 * 0.18) return null;
    if (targetDx * targetDx + targetDz * targetDz > 0.12 * 0.12) return null;
    return !!entry.ok;
  }

  function writeCachedGroundReachability(kind, start, target, clockTime, ok) {
    const cache = getGroundReachabilityCache();
    cache[kind] = {
      ok: !!ok,
      startX: start.x,
      startZ: start.z,
      targetX: target.x,
      targetZ: target.z,
      expiresAt: clockTime + (kind === "dynamic" ? BYPASS_CACHE_TTL_DYNAMIC : BYPASS_CACHE_TTL_STATIC),
    };
    return !!ok;
  }

  function canReachGroundTargetCached(start, target, includeDynamic, clockTime) {
    const kind = includeDynamic ? "dynamic" : "static";
    const cached = readCachedGroundReachability(kind, start, target, clockTime);
    if (cached != null) return cached;
    const ok = canReachGroundTarget(
      start,
      target,
      includeDynamic ? buildCatObstacles(true, true) : buildCatObstacles(false),
      REACHABILITY_OPTIONS
    );
    return writeCachedGroundReachability(kind, start, target, clockTime, ok);
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
    if (!Number.isFinite(cat.nav.dynamicBypassFailCount)) cat.nav.dynamicBypassFailCount = 0;

    if (!isSameGroundBypassTarget(target)) {
      clearGroundBypassMode();
      cat.nav.dynamicBypassTargetX = target.x;
      cat.nav.dynamicBypassTargetZ = target.z;
      cat.nav.dynamicBypassReachability = null;
    }

    if (clockTime >= cat.nav.dynamicBypassCheckAt) {
      const dynamicPathExists = canReachGroundTargetCached(cat.pos, target, true, clockTime);
      if (!dynamicPathExists) {
        const staticPathExists = canReachGroundTargetCached(cat.pos, target, false, clockTime);
        if (staticPathExists) {
          const stuckPressure = (cat.nav.stuckT || 0) >= BYPASS_STUCK_MIN || (cat.nav.noSteerFrames || 0) >= 3;
          if (stuckPressure) {
            cat.nav.dynamicBypassFailCount += 1;
          } else {
            cat.nav.dynamicBypassFailCount = Math.max(0, cat.nav.dynamicBypassFailCount - 1);
          }
          if (cat.nav.dynamicBypassFailCount >= BYPASS_FAILS_TO_ACTIVATE) {
            cat.nav.dynamicBypassActive = true;
            cat.nav.dynamicBypassUntil = Math.max(cat.nav.dynamicBypassUntil || 0, clockTime + BYPASS_ACTIVE_WINDOW);
            cat.nav.dynamicBypassNudgeAt = Math.min(cat.nav.dynamicBypassNudgeAt || 0, clockTime);
          }
        } else {
          clearGroundBypassMode();
        }
      } else if (
        cat.nav.dynamicBypassActive &&
        cat.nav.stuckT < BYPASS_STUCK_MIN &&
        (cat.nav.noSteerFrames || 0) < 2 &&
        clockTime >= (cat.nav.dynamicBypassUntil || 0)
      ) {
        clearGroundBypassMode();
      } else {
        cat.nav.dynamicBypassFailCount = 0;
      }
      cat.nav.dynamicBypassCheckAt = clockTime + (cat.nav.dynamicBypassActive ? BYPASS_RECHECK_ACTIVE : BYPASS_RECHECK_IDLE);
    }

    if (cat.nav.dynamicBypassActive && clockTime >= (cat.nav.dynamicBypassUntil || 0)) {
      const dynamicPathExists = canReachGroundTargetCached(cat.pos, target, true, clockTime);
      if (dynamicPathExists && cat.nav.stuckT < BYPASS_STUCK_MIN && (cat.nav.noSteerFrames || 0) < 2) {
        clearGroundBypassMode();
      } else {
        cat.nav.dynamicBypassUntil = clockTime + BYPASS_EXTEND_WINDOW;
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
