import { catHasNonFloorSurface, isFloorSurfaceId } from "./surface-ids.js";
import { createCatSteeringDebugRuntime } from "./cat-steering-debug.js";
import { getCatLocomotionProfile } from "./cat-locomotion.js";

export function createCatSteeringRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    SWIPE_TIMING,
    ROOM,
    game,
    getSurfaceDefs,
    getSurfaceById,
    cat,
    getClockTime,
    clearCatNavPath,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    ensureCatPath,
    ensureCatPathNoFallback,
    stepDetourCrowdToward,
    canReachGroundTarget,
  } = ctx;

  const tempTo = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();
  const tempCrowdVel = new THREE.Vector3();
  // Keep route correction responsive: if the active segment becomes blocked, repath immediately.
  const ENABLE_SEGMENT_BLOCK_REPATH = true;
  const GOAL_CHANGE_REPATH_EPS = 0.1;
  const GOAL_CHANGE_TARGET_CHANGE_EPS = 0.04;
  const GOAL_CHANGE_SETTLE_TIME = 0.1;
  const GOAL_CHANGE_SETTLE_TIME_TURN_ONLY = 0.2;
  const GOAL_CHANGE_REPATH_COOLDOWN = 0.26;
  const GOAL_CHANGE_REPATH_COOLDOWN_TURN_ONLY = 0.52;
  const FORCED_REPATH_MIN_INTERVAL = 0.12;
  const SAME_REPATH_REQUEST_COOLDOWN = 0.24;
  const SEGMENT_BLOCK_REPATH_COOLDOWN = 0.34;
  const SAME_SEGMENT_BLOCK_REPATH_COOLDOWN = 0.62;
  const MAX_FORCED_REPATHS_PER_UPDATE = 1;
  const TRAP_RECOVERY_HOLD = 0.35;
  const REPATH_KEY_QUANTUM = 0.06;
  const { ensureNavDebugStore, bumpDebugCounter, recordNavEvent, markRepathCause } =
    createCatSteeringDebugRuntime({
      cat,
      getClockTime,
    });

  function updateGoalChangePending(targetOnPlane, now) {
    const goalDelta2 = cat.nav.goal.distanceToSquared(targetOnPlane);
    if (goalDelta2 <= GOAL_CHANGE_REPATH_EPS * GOAL_CHANGE_REPATH_EPS) {
      cat.nav.goalChangePendingSince = 0;
      return false;
    }
    const px = Number(cat.nav.goalChangePendingX);
    const pz = Number(cat.nav.goalChangePendingZ);
    const hasPendingPoint = Number.isFinite(px) && Number.isFinite(pz);
    const changedTarget =
      !hasPendingPoint ||
      ((targetOnPlane.x - px) * (targetOnPlane.x - px) + (targetOnPlane.z - pz) * (targetOnPlane.z - pz) >
        GOAL_CHANGE_TARGET_CHANGE_EPS * GOAL_CHANGE_TARGET_CHANGE_EPS);
    if (changedTarget) {
      cat.nav.goalChangePendingX = targetOnPlane.x;
      cat.nav.goalChangePendingZ = targetOnPlane.z;
      cat.nav.goalChangePendingSince = now;
      return false;
    }
    const pendingSince = Number(cat.nav.goalChangePendingSince) || now;
    const turnOnlyT = Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0;
    const settleFor = turnOnlyT > 0.2 ? GOAL_CHANGE_SETTLE_TIME_TURN_ONLY : GOAL_CHANGE_SETTLE_TIME;
    if (now - pendingSince < settleFor) return false;
    const cooldownUntil = Number(cat.nav.goalRepathCooldownUntil) || 0;
    if (now < cooldownUntil) return false;
    return true;
  }

  function noteGoalChangedRepath(now) {
    const turnOnlyT = Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0;
    const cooldown = turnOnlyT > 0.2 ? GOAL_CHANGE_REPATH_COOLDOWN_TURN_ONLY : GOAL_CHANGE_REPATH_COOLDOWN;
    cat.nav.goalRepathCooldownUntil = now + cooldown;
    cat.nav.goalChangePendingSince = now;
  }

  function makeRepathKey(target, useDynamic, queryY = 0) {
    const q = (v) => Math.round((Number.isFinite(v) ? v : 0) / REPATH_KEY_QUANTUM);
    const mode = useDynamic ? "dyn" : "static";
    return `${mode}:${q(target?.x)}:${q(target?.z)}:${q(queryY)}`;
  }

  function makeSegmentBlockKey(segmentBlock, target, queryY = 0, nonFloorSurface = false) {
    const q = (v) => Math.round((Number.isFinite(v) ? v : 0) / REPATH_KEY_QUANTUM);
    const obs = String(segmentBlock?.obstacleLabel || segmentBlock?.obstacleKind || "unknown");
    const kind = String(segmentBlock?.obstacleKind || "na");
    const mode = nonFloorSurface ? "surface" : "ground";
    return `${mode}:${obs}:${kind}:${q(segmentBlock?.sampleX)}:${q(segmentBlock?.sampleZ)}:${q(target?.x)}:${q(target?.z)}:${q(queryY)}`;
  }

  function canTriggerSegmentBlockedRepath(now, segmentBlock, target, queryY = 0, nonFloorSurface = false) {
    const key = makeSegmentBlockKey(segmentBlock, target, queryY, nonFloorSurface);
    const lastKey = String(cat.nav.segmentBlockSignature || "");
    const nextAt = Number(cat.nav.segmentBlockRepathAt) || 0;
    const cooldown = key === lastKey ? SAME_SEGMENT_BLOCK_REPATH_COOLDOWN : SEGMENT_BLOCK_REPATH_COOLDOWN;
    if (now < nextAt && key === lastKey) return false;
    cat.nav.segmentBlockSignature = key;
    cat.nav.segmentBlockRepathAt = now + cooldown;
    return true;
  }

  function ensureRouteInvalidationStore() {
    if (!cat.nav.routeInvalidation || typeof cat.nav.routeInvalidation !== "object") {
      cat.nav.routeInvalidation = {
        pending: false,
        kind: "",
        target: new THREE.Vector3(cat.pos.x, 0, cat.pos.z),
        queryY: 0,
        useDynamic: true,
        requestedAt: 0,
        count: 0,
      };
    }
    const invalidation = cat.nav.routeInvalidation;
    if (!invalidation.target || typeof invalidation.target.set !== "function") {
      invalidation.target = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    invalidation.pending = !!invalidation.pending;
    invalidation.kind = invalidation.kind ? String(invalidation.kind) : "";
    invalidation.queryY = Number.isFinite(invalidation.queryY) ? invalidation.queryY : 0;
    invalidation.useDynamic = "useDynamic" in invalidation ? !!invalidation.useDynamic : true;
    invalidation.requestedAt = Number.isFinite(invalidation.requestedAt) ? invalidation.requestedAt : 0;
    invalidation.count = Number.isFinite(invalidation.count) ? invalidation.count : 0;
    return invalidation;
  }

  function requestActiveRouteInvalidation(target, useDynamic, queryY = null, kind = "") {
    if (!cat.nav?.route?.active || !target) return false;
    const invalidation = ensureRouteInvalidationStore();
    const now = getClockTime();
    const targetY = Number.isFinite(queryY)
      ? queryY
      : (Number.isFinite(target?.y) ? target.y : 0);
    const sameKind = invalidation.pending && invalidation.kind === String(kind || "");
    const sameTarget =
      invalidation.pending &&
      invalidation.target.distanceToSquared(target) <= 0.12 * 0.12 &&
      Math.abs((invalidation.queryY || 0) - targetY) <= 0.08;
    if (sameKind && sameTarget && now - (invalidation.requestedAt || 0) <= 0.12) return true;
    invalidation.pending = true;
    invalidation.kind = String(kind || cat.nav?.lastRepathCause?.kind || "route-refresh");
    invalidation.target.copy(target);
    invalidation.queryY = targetY;
    invalidation.useDynamic = !!useDynamic;
    invalidation.count = sameKind && sameTarget ? (invalidation.count || 0) + 1 : 1;
    invalidation.requestedAt = now;
    recordNavEvent("route-invalidate", {
      kind: invalidation.kind,
      targetX: target.x,
      targetZ: target.z,
      y: targetY,
      useDynamic: !!useDynamic,
      count: invalidation.count,
    });
    return true;
  }

  function tryEnsurePath(repathState, target, force, useDynamic, queryY = null) {
    const planner = ensureCatPath;
    const now = getClockTime();
    const activeRoute = cat.nav?.route;
    const targetY = Number.isFinite(queryY)
      ? queryY
      : (Number.isFinite(target?.y) ? target.y : 0);
    const isNearRoutePoint = (point, radius = 0.28) => {
      if (!point || !target) return false;
      const dx = target.x - point.x;
      const dz = target.z - point.z;
      return dx * dx + dz * dz <= radius * radius;
    };
    const onGroundNow = !catHasNonFloorSurface(cat);
    const routeCanRefreshLocally =
      !!activeRoute?.active &&
      (
        (
          targetY <= 0.02 &&
          onGroundNow &&
          (
            isFloorSurfaceId(activeRoute.surfaceId || activeRoute.finalSurfaceId || "floor") ||
            isNearRoutePoint(activeRoute.jumpAnchor) ||
            isNearRoutePoint(activeRoute.target)
          )
        ) ||
        (
          targetY > 0.02 &&
          (
            isNearRoutePoint(activeRoute.target) ||
            isNearRoutePoint(activeRoute.jumpOff) ||
            (activeRoute.directJump && isNearRoutePoint(activeRoute.jumpAnchor, 0.42))
          )
        )
      );
    if (activeRoute?.active && force && !routeCanRefreshLocally) {
      return requestActiveRouteInvalidation(
        target,
        useDynamic,
        queryY,
        String(cat.nav?.lastRepathCause?.kind || "route-refresh")
      );
    }
    if (force) {
      const trapRecoveryUntil = Number(cat.nav.trapRecoveryUntil) || 0;
      if (now < trapRecoveryUntil) return false;
      const forceCooldownUntil = Number(cat.nav.forceRepathCooldownUntil) || 0;
      if (now < forceCooldownUntil) return false;
      if ((repathState?.forcedCount || 0) >= MAX_FORCED_REPATHS_PER_UPDATE) return false;
      const key = makeRepathKey(target, useDynamic, Number.isFinite(queryY) ? queryY : 0);
      const lastKey = String(cat.nav.lastForceRepathKey || "");
      const lastAt = Number(cat.nav.lastForceRepathAt) || -1e9;
      if (key === lastKey && now < lastAt + SAME_REPATH_REQUEST_COOLDOWN) return false;
      cat.nav.forceRepathCooldownUntil = now + FORCED_REPATH_MIN_INTERVAL;
      cat.nav.lastForceRepathAt = now;
      cat.nav.lastForceRepathKey = key;
      if (repathState) repathState.forcedCount = (repathState.forcedCount || 0) + 1;
    }
    planner(target, force, useDynamic, queryY, true);
    return true;
  }

  function applyTrapRecoveryHold(now) {
    const holdUntil = now + TRAP_RECOVERY_HOLD;
    cat.nav.trapRecoveryUntil = holdUntil;
    cat.nav.repathAt = Math.max(Number(cat.nav.repathAt) || 0, holdUntil);
  }

  function getSpeedRef(speed) {
    const base = Math.max(0.05, Number.isFinite(speed) ? speed : (cat.speed || 1));
    const speedScale = Math.max(0.1, Number.isFinite(CAT_NAV.locomotionSpeedScale) ? CAT_NAV.locomotionSpeedScale : 1);
    return base * speedScale;
  }

  function updateDriveSpeed(targetSpeed, dt) {
    const accel = Math.max(0.1, Number.isFinite(CAT_NAV.accel) ? CAT_NAV.accel : 3.2);
    const decel = Math.max(0.1, Number.isFinite(CAT_NAV.decel) ? CAT_NAV.decel : 5.2);
    const current = Number.isFinite(cat.nav.driveSpeed) ? cat.nav.driveSpeed : 0;
    const target = Math.max(0, targetSpeed);
    const rate = target >= current ? accel : decel;
    const maxDelta = rate * Math.max(dt, 0);
    const next = current + THREE.MathUtils.clamp(target - current, -maxDelta, maxDelta);
    cat.nav.driveSpeed = Math.max(0, next);
    return cat.nav.driveSpeed;
  }

  function clearNavMotionMetrics() {
    cat.nav.lastSpeed = 0;
    cat.nav.driveSpeed = 0;
    cat.nav.speedNorm = 0;
    cat.nav.smoothedSpeed = 0;
    cat.nav.turnBias = 0;
    cat.nav.turnDirLock = 0;
    cat.nav.locomotionHoldT = 0;
  }

  function setLocomotionIntent(clipKey, clipScale) {
    if (!cat.locomotion) return;
    cat.locomotion.activeClip = clipKey || "idle";
    cat.locomotion.clipScale = Math.max(0, Number.isFinite(clipScale) ? clipScale : 0);
  }

  function getLocomotionProfile(clipKey) {
    return getCatLocomotionProfile(cat.locomotion?.profiles, clipKey);
  }

  function setNavMotionMetrics(moved, dt, speedRef) {
    const measured = moved / Math.max(dt, 1e-5);
    const prevSmooth = Number.isFinite(cat.nav.smoothedSpeed) ? cat.nav.smoothedSpeed : measured;
    const alpha = 1 - Math.exp(-dt * 14);
    const smooth = THREE.MathUtils.lerp(prevSmooth, measured, alpha);
    cat.nav.smoothedSpeed = smooth;
    cat.nav.lastSpeed = smooth;
    cat.nav.speedNorm = THREE.MathUtils.clamp(smooth / Math.max(speedRef, 1e-5), 0, 1.75);
  }

  function rotateCatToward(yaw, dt) {
    const delta = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
    const maxStep = CAT_NAV.maxTurnRate * dt;
    const clamped = THREE.MathUtils.clamp(delta, -maxStep, maxStep);
    cat.group.rotation.y += clamped;
    return delta;
  }

  function angleDelta(targetYaw, sourceYaw) {
    return Math.atan2(Math.sin(targetYaw - sourceYaw), Math.cos(targetYaw - sourceYaw));
  }

  function isNearTargetXZ(target, radius = 0.14) {
    if (!target) return false;
    const dx = target.x - cat.pos.x;
    const dz = target.z - cat.pos.z;
    return dx * dx + dz * dz < radius * radius;
  }

  function findNearestPlanarUnblockedTarget(
    target,
    staticObstacles,
    dynamicObstacles,
    clearance,
    ignoreDynamic = false,
    queryY = 0
  ) {
    if (!target) return target;
    const blockedStatic = isCatPointBlocked(target.x, target.z, staticObstacles, clearance, queryY);
    const blockedDynamic = !ignoreDynamic && isCatPointBlocked(target.x, target.z, dynamicObstacles, clearance, queryY);
    if (!blockedStatic && !blockedDynamic) return target;

    let best = null;
    let bestD2 = Infinity;
    const rings = [0.08, 0.14, 0.22, 0.3, 0.4, 0.52, 0.66];
    for (const r of rings) {
      const steps = Math.max(10, Math.ceil((Math.PI * 2 * r) / 0.08));
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const x = target.x + Math.cos(t) * r;
        const z = target.z + Math.sin(t) * r;
        if (isCatPointBlocked(x, z, staticObstacles, clearance, queryY)) continue;
        if (!ignoreDynamic && isCatPointBlocked(x, z, dynamicObstacles, clearance, queryY)) continue;
        const d2 = (x - target.x) * (x - target.x) + (z - target.z) * (z - target.z);
        if (d2 < bestD2) {
          bestD2 = d2;
          if (!best) best = new THREE.Vector3();
          best.set(x, queryY, z);
        }
      }
      if (best) break;
    }
    return best || target;
  }

  function chooseGroundLocomotion(rawYawDelta, dt, preferRun = false) {
    const isLeftTurn = (clip) => clip === "turn90L" || clip === "turn45L";
    const isRightTurn = (clip) => clip === "turn90R" || clip === "turn45R";
    const turnTierOf = (clip) => {
      if (clip === "turn90L" || clip === "turn90R") return 2;
      if (clip === "turn45L" || clip === "turn45R") return 1;
      return 0;
    };
    const prev = cat.locomotion?.activeClip || "walkF";
    const prevBias = Number.isFinite(cat.nav.turnBias) ? cat.nav.turnBias : rawYawDelta;
    const alpha = 1 - Math.exp(-Math.max(dt, 0) * 12);
    const turnBias = THREE.MathUtils.lerp(prevBias, rawYawDelta, alpha);
    cat.nav.turnBias = turnBias;
    const absDy = Math.abs(turnBias);
    const left = turnBias >= 0;
    const sideFromSign = left ? 1 : -1;

    let turnDirLock = Number.isFinite(cat.nav.turnDirLock) ? cat.nav.turnDirLock : 0;
    if (absDy > 0.55) {
      if (turnDirLock === 0) {
        turnDirLock = sideFromSign;
      } else if (sideFromSign !== turnDirLock && absDy > 1.45) {
        // Allow lock flip only on very large opposite error to avoid left/right chatter.
        turnDirLock = sideFromSign;
      }
    } else if (absDy < 0.16) {
      turnDirLock = 0;
    }
    cat.nav.turnDirLock = turnDirLock;
    const side = turnDirLock !== 0 ? turnDirLock : sideFromSign;
    const prevSide = prev.endsWith("L") ? 1 : prev.endsWith("R") ? -1 : sideFromSign;
    const lockedSide = turnDirLock !== 0 ? turnDirLock : prevSide;
    const sideKey = lockedSide > 0 ? "L" : "R";

    const prevTurnTier = turnTierOf(prev);
    const ENTER_TURN_45 = 0.34;
    const EXIT_TURN_45 = 0.24;
    const ENTER_TURN_90 = 1.02;
    const EXIT_TURN_90 = 0.82;
    let turnTier = 0;
    if (prevTurnTier >= 2) {
      if (absDy > EXIT_TURN_90) turnTier = 2;
      else if (absDy > EXIT_TURN_45) turnTier = 1;
    } else if (prevTurnTier === 1) {
      if (absDy >= ENTER_TURN_90) turnTier = 2;
      else if (absDy > EXIT_TURN_45) turnTier = 1;
    } else if (absDy >= ENTER_TURN_90) {
      turnTier = 2;
    } else if (absDy >= ENTER_TURN_45) {
      turnTier = 1;
    }

    let desired = preferRun ? "runF" : "walkF";
    if (turnTier === 1) desired = `turn45${sideKey}`;
    else if (turnTier === 2) desired = `turn90${sideKey}`;

    if (!preferRun && prev === "runF" && desired === "walkF") {
      cat.nav.locomotionHoldT = 0;
      return desired;
    }

    const hold = Number.isFinite(cat.nav.locomotionHoldT) ? cat.nav.locomotionHoldT : 0;
    const holdThreshold = Math.max(0.04, Number.isFinite(CAT_NAV.locomotionSwitchHold) ? CAT_NAV.locomotionSwitchHold : 0.12);
    if (desired !== prev) {
      const isLeftRightFlip =
        (isLeftTurn(prev) && isRightTurn(desired)) ||
        (isRightTurn(prev) && isLeftTurn(desired));
      if (isLeftRightFlip && absDy < 1.25) {
        cat.nav.locomotionHoldT = Math.min(0.2, hold + dt);
        return prev;
      }
      const promoteToHigherTier = turnTier > prevTurnTier;
      const demoteFromTurn = prevTurnTier >= 1 && turnTier < prevTurnTier;
      const minHold = demoteFromTurn ? holdThreshold * 2.2 : holdThreshold;
      if (!promoteToHigherTier && hold < holdThreshold) {
        cat.nav.locomotionHoldT = hold + dt;
        return prev;
      }
      if (!promoteToHigherTier && hold < minHold) {
        cat.nav.locomotionHoldT = hold + dt;
        return prev;
      }
      cat.nav.locomotionHoldT = 0;
      return desired;
    }

    cat.nav.locomotionHoldT = Math.min(0.2, hold + dt);
    return desired;
  }

  function isRunClip(clipKey) {
    return clipKey === "runF" || clipKey === "runL" || clipKey === "runR";
  }

  function triggerRunCooldown(now, duration = 0.9) {
    const until = now + Math.max(0.15, duration);
    cat.nav.runCooldownUntil = Math.max(Number(cat.nav.runCooldownUntil) || 0, until);
    cat.nav.runLocomotionActive = false;
  }

  function shouldUseRunLocomotion(
    basePreferRun,
    distToChase,
    distToTarget,
    rawYawDelta = 0,
    now = null
  ) {
    if (!basePreferRun) {
      cat.nav.runLocomotionActive = false;
      return false;
    }
    const clock = Number.isFinite(now) ? now : getClockTime();
    if (clock < (Number(cat.nav.runCooldownUntil) || 0)) {
      cat.nav.runLocomotionActive = false;
      return false;
    }
    const enableDist = Math.max(
      0.55,
      Number.isFinite(CAT_NAV.runEnableDistance) ? CAT_NAV.runEnableDistance : 0.95
    );
    const disableDistRaw = Number.isFinite(CAT_NAV.runDisableDistance)
      ? CAT_NAV.runDisableDistance
      : enableDist * 0.58;
    const disableDist = Math.min(enableDist - 0.05, Math.max(0.2, disableDistRaw));
    const maxYawDelta = Math.max(
      0.35,
      Number.isFinite(CAT_NAV.runMaxYawDelta) ? CAT_NAV.runMaxYawDelta : 0.82
    );
    const unstable =
      !!cat.nav.dynamicBypassActive ||
      (cat.nav.segmentBlockedFrames || 0) > 1 ||
      (cat.nav.wholePathBlockedFrames || 0) > 0 ||
      (cat.nav.noSteerFrames || 0) > 1 ||
      (cat.nav.stuckT || 0) > 0.1 ||
      (Number(cat.nav?.debugStep?.overlapDynamic) || 0) > 0.03;
    const activeRoute = cat.nav?.route;
    const activeSegment =
      activeRoute &&
      Array.isArray(activeRoute.segments) &&
      Number.isFinite(activeRoute.segmentIndex)
        ? activeRoute.segments[activeRoute.segmentIndex] || null
        : null;
    const approachingJumpPoint =
      activeRoute?.active &&
      (activeSegment?.kind === "jump-up-approach" || activeSegment?.kind === "jump-down-approach");
    const nearJumpPoint =
      approachingJumpPoint &&
      (
        (Number.isFinite(distToChase) && distToChase <= 1.0) ||
        (Number.isFinite(distToTarget) && distToTarget <= 1.0)
      );
    const closeTargetThreshold = Math.max(0.46, disableDist + 0.08);
    const closeToTarget = Number.isFinite(distToTarget) && distToTarget <= closeTargetThreshold;
    if (unstable || closeToTarget || nearJumpPoint || Math.abs(rawYawDelta) > maxYawDelta) {
      cat.nav.runLocomotionActive = false;
      return false;
    }
    const metric = Math.max(
      Number.isFinite(distToChase) ? distToChase : 0,
      Number.isFinite(distToTarget) ? distToTarget : 0
    );
    const wasRunning = !!cat.nav.runLocomotionActive;
    const threshold = wasRunning ? disableDist : enableDist;
    const allowRun = metric >= threshold;
    cat.nav.runLocomotionActive = allowRun;
    return allowRun;
  }

  function shouldPreferWalkNearEndpoint(distToChase, distToTarget) {
    const endpointMetric = Math.min(
      Number.isFinite(distToChase) ? distToChase : Infinity,
      Number.isFinite(distToTarget) ? distToTarget : Infinity
    );
    return endpointMetric <= 0.42 || (Number.isFinite(distToTarget) && distToTarget <= 0.5);
  }

  function getSharedProgressThreshold(step) {
    return Math.max(0.0008, Math.min(0.003, Math.max(0, step) * 0.45 + 0.0004));
  }

  function getRouteSegmentProgressInfo(now = getClockTime()) {
    const route = cat.nav?.route;
    if (!route?.active) return null;
    const enteredAt = Number.isFinite(route.segmentEnteredAt)
      ? route.segmentEnteredAt
      : (Number.isFinite(route.createdAt) ? route.createdAt : now);
    const progressAt = Number.isFinite(route.segmentProgressAt)
      ? Math.max(route.segmentProgressAt, enteredAt)
      : enteredAt;
    return {
      route,
      age: Math.max(0, now - enteredAt),
      idleFor: Math.max(0, now - progressAt),
      enteredAt,
      progressAt,
    };
  }

  function noteActiveRouteSegmentProgress(prevPos, moved, step, chasePoint = null, targetPoint = null) {
    const route = cat.nav?.route;
    if (!route?.active) return false;
    const now = getClockTime();
    const enteredAt = Number.isFinite(route.segmentEnteredAt)
      ? route.segmentEnteredAt
      : (Number.isFinite(route.createdAt) ? route.createdAt : now);
    if (!Number.isFinite(route.segmentProgressAt) || route.segmentProgressAt < enteredAt) {
      route.segmentProgressAt = enteredAt;
      route.segmentProgressX = Number(prevPos?.x) || cat.pos.x;
      route.segmentProgressZ = Number(prevPos?.z) || cat.pos.z;
      route.segmentProgressDist = Infinity;
    }
    const distToPoint = (point, pos) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return Infinity;
      return Math.hypot((pos?.x ?? cat.pos.x) - point.x, (pos?.z ?? cat.pos.z) - point.z);
    };
    const beforeDist = Math.min(distToPoint(chasePoint, prevPos), distToPoint(targetPoint, prevPos));
    const afterDist = Math.min(distToPoint(chasePoint, cat.pos), distToPoint(targetPoint, cat.pos));
    const progressDelta = Math.max(0.015, Math.min(0.04, Math.max(0, step) * 0.55 + 0.008));
    const moveDelta = Math.max(0.016, Math.min(0.05, Math.max(0, step) * 0.45 + 0.01));
    const prevBest = Number.isFinite(route.segmentProgressDist) ? route.segmentProgressDist : beforeDist;
    const improvedTowardGoal =
      (Number.isFinite(beforeDist) && Number.isFinite(afterDist) && beforeDist - afterDist >= progressDelta) ||
      (Number.isFinite(prevBest) && Number.isFinite(afterDist) && prevBest - afterDist >= progressDelta * 0.75) ||
      (Number.isFinite(afterDist) && afterDist <= Math.max(0.14, progressDelta * 3.5));
    const movedEnough = Number.isFinite(moved) && moved >= moveDelta;
    const meaningful = movedEnough || improvedTowardGoal;
    route.segmentProgressDist = Number.isFinite(afterDist)
      ? (meaningful ? afterDist : Math.min(prevBest, afterDist))
      : prevBest;
    if (meaningful) {
      route.lastProgressAt = now;
      route.lastProgressX = cat.pos.x;
      route.lastProgressZ = cat.pos.z;
      route.segmentProgressAt = now;
      route.segmentProgressX = cat.pos.x;
      route.segmentProgressZ = cat.pos.z;
    }
    return meaningful;
  }

  function computeSurfaceLocomotionPlan({
    rawYawDelta,
    dt,
    distToChase,
    distToTarget,
    speedRef,
    preferRun,
    now,
    allowRun = true,
  }) {
    const nearEndpoint = shouldPreferWalkNearEndpoint(distToChase, distToTarget);
    const runActive = allowRun
      ? shouldUseRunLocomotion(
          preferRun && !nearEndpoint,
          distToChase,
          distToTarget,
          rawYawDelta,
          now
        )
      : false;
    const locomotionClip = chooseGroundLocomotion(rawYawDelta, dt, runActive);
    const turnOnly = locomotionClip.startsWith("turn");
    const maxLocoScale = Math.max(
      1.0,
      Number.isFinite(CAT_NAV.locomotionScaleCap) ? CAT_NAV.locomotionScaleCap : 8.0
    );
    let locomotionScale = THREE.MathUtils.clamp(speedRef, 0.35, maxLocoScale);
    if (turnOnly) locomotionScale = 1.0;
    else locomotionScale = THREE.MathUtils.clamp(locomotionScale, 0.55, maxLocoScale);

    const profile = getLocomotionProfile(locomotionClip);
    const turnRate = Math.max(
      0.28,
      profile.turnRate || CAT_NAV.maxTurnRate * (turnOnly ? 0.46 : 0.7)
    );
    const turnClipScale = turnOnly ? 1.0 : locomotionScale;
    const maxYawStep = turnRate * turnClipScale * 0.92 * Math.max(dt, 0);
    const yawStep = THREE.MathUtils.clamp(rawYawDelta, -maxYawStep, maxYawStep);
    cat.group.rotation.y += yawStep;

    const clipPlanarSpeed = Math.max(0, profile.planarSpeed) * locomotionScale;
    const moveSpeed = updateDriveSpeed(turnOnly ? 0 : clipPlanarSpeed, dt);
    const step = turnOnly ? 0 : Math.min(distToChase, moveSpeed * dt);
    const commandedSpeed = Math.max(
      0.05,
      turnOnly ? turnRate * turnClipScale * CAT_COLLISION.catBodyRadius : clipPlanarSpeed
    );
    setLocomotionIntent(
      locomotionClip,
      turnOnly
        ? turnClipScale
        : Math.max(0.01, moveSpeed / Math.max(profile.planarSpeed, 1e-5))
    );

    return {
      runActive,
      locomotionClip,
      turnOnly,
      locomotionScale,
      profile,
      yawStep,
      moveSpeed,
      step,
      commandedSpeed,
    };
  }

  function getPathLookAheadDistance(speedRef, isElevated = false) {
    const baseLookAhead = Math.max(0.25, Number.isFinite(CAT_NAV.localLookAhead) ? CAT_NAV.localLookAhead : 0.56);
    const drive = Math.max(0, Number.isFinite(cat.nav.driveSpeed) ? cat.nav.driveSpeed : speedRef);
    const speedTerm = drive * (isElevated ? 0.22 : 0.28);
    const extra = isElevated ? 0.08 : 0;
    const minDist = isElevated ? 0.38 : 0.34;
    const maxDist = isElevated ? 1.15 : 1.35;
    return THREE.MathUtils.clamp(baseLookAhead + speedTerm + extra, minDist, maxDist);
  }

  function selectPathChasePoint(target, obstacles, clearance, queryY, lookAheadDistance) {
    if (!Array.isArray(cat.nav.path) || cat.nav.path.length <= 1) return target;
    let index = THREE.MathUtils.clamp(cat.nav.index || 1, 1, cat.nav.path.length - 1);
    while (index < cat.nav.path.length - 1 && cat.pos.distanceToSquared(cat.nav.path[index]) < 0.15 * 0.15) {
      index++;
    }
    let bestIndex = index;
    if (hasClearTravelLine(cat.pos, cat.nav.path[index], obstacles, clearance, queryY)) {
      let pathDist = cat.pos.distanceTo(cat.nav.path[index]);
      for (let i = index + 1; i < cat.nav.path.length; i++) {
        const prev = cat.nav.path[i - 1];
        const next = cat.nav.path[i];
        pathDist += prev.distanceTo(next);
        if (pathDist > lookAheadDistance) break;
        if (!hasClearTravelLine(cat.pos, next, obstacles, clearance, queryY)) break;
        bestIndex = i;
      }
    }
    cat.nav.index = bestIndex;
    return cat.nav.path[bestIndex] || target;
  }

  const GROUND_STEER_OFFSETS = [0, 0.2, -0.2, 0.42, -0.42, 0.66, -0.66, 0.92, -0.92, 1.22, -1.22, 1.48, -1.48];
  const GROUND_STEER_OFFSETS_FULL = (() => {
    const out = [];
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      out.push((i / steps) * Math.PI * 2 - Math.PI);
    }
    out.sort((a, b) => Math.abs(a) - Math.abs(b));
    return out;
  })();
  function getElevatedSurfaceCandidates(yLevel, supportSurfaceId = "") {
    const surfaces = [];
    const resolvedSupportSurfaceId =
      supportSurfaceId && supportSurfaceId !== "floor" ? String(supportSurfaceId) : "";
    if (typeof getSurfaceDefs === "function") {
      const defs = getSurfaceDefs({ includeFloor: false });
      if (Array.isArray(defs)) {
        for (const def of defs) {
          if (!def) continue;
          const surfaceId = String(def.id || def.name || "");
          if (resolvedSupportSurfaceId && surfaceId !== resolvedSupportSurfaceId) continue;
          const minX = Number(def.minX);
          const maxX = Number(def.maxX);
          const minZ = Number(def.minZ);
          const maxZ = Number(def.maxZ);
          const y = Number(def.y);
          if (![minX, maxX, minZ, maxZ, y].every(Number.isFinite)) continue;
          if (y <= 0.04) continue;
          if (maxX - minX <= 0.06 || maxZ - minZ <= 0.06) continue;
          surfaces.push({ id: surfaceId, y, minX, maxX, minZ, maxZ });
        }
      }
    }
    const out = [];
    for (const s of surfaces) {
      if (Math.abs(s.y - yLevel) <= 0.4) out.push(s);
    }
    out.sort((a, b) => Math.abs(a.y - yLevel) - Math.abs(b.y - yLevel));
    return out;
  }

  function isPointWithinElevatedSupport(x, z, yLevel, margin, supportSurfaceId = "") {
    const surfaces = getElevatedSurfaceCandidates(yLevel, supportSurfaceId);
    for (const s of surfaces) {
      const minX = s.minX + margin;
      const maxX = s.maxX - margin;
      const minZ = s.minZ + margin;
      const maxZ = s.maxZ - margin;
      if (minX >= maxX || minZ >= maxZ) continue;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
    }
    return false;
  }

  function nearestSupportedElevatedPoint(x, z, yLevel, margin, supportSurfaceId = "") {
    const surfaces = getElevatedSurfaceCandidates(yLevel, supportSurfaceId);
    let best = null;
    let bestD2 = Infinity;
    for (const s of surfaces) {
      const minX = s.minX + margin;
      const maxX = s.maxX - margin;
      const minZ = s.minZ + margin;
      const maxZ = s.maxZ - margin;
      if (minX >= maxX || minZ >= maxZ) continue;
      const cx = THREE.MathUtils.clamp(x, minX, maxX);
      const cz = THREE.MathUtils.clamp(z, minZ, maxZ);
      const d2 = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (d2 < bestD2) {
        bestD2 = d2;
        if (!best) best = new THREE.Vector3();
        best.set(cx, 0, cz);
      }
    }
    return best;
  }

  function findNearestSupportedElevatedTarget(
    target,
    staticObstacles,
    dynamicObstacles,
    clearance,
    yLevel,
    supportSurfaceId = "",
    ignoreDynamic = false,
    runtimeOptions = null
  ) {
    if (!target) return target;
    const supportMargin = CAT_COLLISION.catBodyRadius + 0.005;
    const supported = nearestSupportedElevatedPoint(
      target.x,
      target.z,
      yLevel,
      supportMargin,
      supportSurfaceId
    );
    const base = supported || new THREE.Vector3(target.x, 0, target.z);
    const candidate = new THREE.Vector3(base.x, yLevel, base.z);
    const blockedStatic = obstacleBlocksAny(staticObstacles, candidate.x, candidate.z, clearance, yLevel, runtimeOptions);
    const blockedDynamic = !ignoreDynamic && obstacleBlocksAny(dynamicObstacles, candidate.x, candidate.z, clearance, yLevel, runtimeOptions);
    if (!blockedStatic && !blockedDynamic) return candidate;

    let best = null;
    let bestD2 = Infinity;
    const rings = [0.06, 0.1, 0.16, 0.24, 0.32, 0.42, 0.56];
    for (const r of rings) {
      const steps = Math.max(10, Math.ceil((Math.PI * 2 * r) / 0.07));
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const x = candidate.x + Math.cos(t) * r;
        const z = candidate.z + Math.sin(t) * r;
        if (supportSurfaceId && !isPointWithinElevatedSupport(x, z, yLevel, supportMargin, supportSurfaceId)) continue;
        if (obstacleBlocksAny(staticObstacles, x, z, clearance, yLevel, runtimeOptions)) continue;
        if (!ignoreDynamic && obstacleBlocksAny(dynamicObstacles, x, z, clearance, yLevel, runtimeOptions)) continue;
        const d2 = (x - candidate.x) * (x - candidate.x) + (z - candidate.z) * (z - candidate.z);
        if (d2 < bestD2) {
          bestD2 = d2;
          if (!best) best = new THREE.Vector3();
          best.set(x, yLevel, z);
        }
      }
      if (best) break;
    }
    return best || candidate;
  }

  function chooseGroundSteer(
    target,
    step,
    staticObstacles,
    dynamicObstacles,
    ignoreDynamic = false,
    queryY = 0,
    supportSurfaceId = "",
    runtimeOptions = null
  ) {
    const toGoalX = target.x - cat.pos.x;
    const toGoalZ = target.z - cat.pos.z;
    const goalLen = Math.max(0.001, Math.hypot(toGoalX, toGoalZ));
    const goalYaw = Math.atan2(toGoalX, toGoalZ);
    const prevYaw = Number.isFinite(cat.nav.steerYaw) ? cat.nav.steerYaw : goalYaw;
    const staticClearance = getCatPathClearance();
    const dynamicClearance = staticClearance;
    const supportMargin = CAT_COLLISION.catBodyRadius + 0.005;
    const lookAhead = Math.max(step, Math.min(CAT_NAV.localLookAhead, step * 2.2));

    let best = null;
    let bestScore = Infinity;

    const evaluate = (offset, allowBacktrack, relaxFacingGate = false) => {
      const yaw = goalYaw + offset;
      const sx = Math.sin(yaw);
      const sz = Math.cos(yaw);
      const faceDelta = Math.abs(
        Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y))
      );
      const turnOnlyT = Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0;
      const pathPressure =
        (cat.nav.segmentBlockedFrames || 0) > 0 ||
        (cat.nav.wholePathBlockedFrames || 0) > 0 ||
        (cat.nav.noSteerFrames || 0) > 2;
      if (!relaxFacingGate && !pathPressure && cat.nav.stuckT < 0.18 && turnOnlyT < 0.25 && faceDelta > 1.15) {
        return;
      }

      const tx = cat.pos.x + sx * step;
      const tz = cat.pos.z + sz * step;
      if (
        supportSurfaceId &&
        !isPointWithinElevatedSupport(tx, tz, queryY, supportMargin, supportSurfaceId)
      ) {
        return;
      }
      if (obstacleBlocksAny(staticObstacles, tx, tz, staticClearance, queryY, runtimeOptions)) return;
      if (!ignoreDynamic && obstacleBlocksAny(dynamicObstacles, tx, tz, dynamicClearance, queryY, runtimeOptions)) return;

      const progress = (toGoalX * sx + toGoalZ * sz) / goalLen;
      if (!allowBacktrack && progress < -0.08) return;

      const lx = cat.pos.x + sx * lookAhead;
      const lz = cat.pos.z + sz * lookAhead;
      const dynamicAhead = !ignoreDynamic && obstacleBlocksAny(dynamicObstacles, lx, lz, dynamicClearance, queryY, runtimeOptions);
      const staticAhead = obstacleBlocksAny(staticObstacles, lx, lz, staticClearance, queryY, runtimeOptions);
      const softPointPenalty = !ignoreDynamic ? sampleSoftishObstaclePenalty(tx, tz, dynamicObstacles, dynamicClearance, runtimeOptions) : 0;
      const softAheadPenalty = !ignoreDynamic ? sampleSoftishObstaclePenalty(lx, lz, dynamicObstacles, dynamicClearance, runtimeOptions) : 0;
      if (staticAhead) {
        // Allow shallow detours around corners: reject only when even short look-ahead is blocked.
        const nearLookAhead = Math.max(step * 1.15, 0.16);
        const nx = cat.pos.x + sx * nearLookAhead;
        const nz = cat.pos.z + sz * nearLookAhead;
        if (obstacleBlocksAny(staticObstacles, nx, nz, staticClearance, queryY, runtimeOptions)) return;
      }

      const remainingD2 = (target.x - tx) * (target.x - tx) + (target.z - tz) * (target.z - tz);
      let score = Math.abs(offset) * 0.52 + (1 - progress) * 1.4 + remainingD2 * 0.015;
      const steerDelta = Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw));
      score += Math.abs(steerDelta) * CAT_NAV.steerSwitchPenalty;
      score += faceDelta * CAT_NAV.steerFacingPenalty;
      if (dynamicAhead) score += 0.95;
      if (staticAhead) score += 0.7;
      score += softPointPenalty * 0.42 + softAheadPenalty * 0.26;

      if (score < bestScore) {
        bestScore = score;
        best = { sx, sz, yaw };
      }
    };

    for (const offset of GROUND_STEER_OFFSETS) evaluate(offset, false, false);
    if (!best) {
      for (const offset of GROUND_STEER_OFFSETS_FULL) evaluate(offset, true, false);
    }
    if (!best) {
      // Last resort: allow sharper heading corrections so we don't stall with a valid path.
      for (const offset of GROUND_STEER_OFFSETS_FULL) evaluate(offset, true, true);
    }
    return best;
  }

  function obstacleRuntimePad(obs, clearance = 0, stage = "steer") {
    if (!obs) return Math.max(0, clearance || 0);
    const base = Math.max(0, clearance || 0);
    if (stage === "collision") return base + Math.max(0, Number(obs.collisionPad) || 0);
    return base + Math.max(0, Number(obs.steerPad) || 0);
  }

  function obstacleIsSoftish(obs) {
    if (!obs) return false;
    if (obs.pushable) return true;
    return String(obs.mode || "hard") !== "hard";
  }

  function hasNearbySoftishObstacle(point, obstacles, radius = 0.9) {
    if (!point || !Array.isArray(obstacles) || !obstacles.length) return false;
    const r2 = radius * radius;
    for (const obs of obstacles) {
      if (!obstacleIsSoftish(obs)) continue;
      const dx = point.x - obs.x;
      const dz = point.z - obs.z;
      if (obs.kind === "circle") {
        const reach = (obs.r || 0) + radius + Math.max(0, Number(obs.navPad || obs.steerPad || 0));
        if (dx * dx + dz * dz <= reach * reach) return true;
        continue;
      }
      const reachX = (obs.hx || 0) + radius + Math.max(0, Number(obs.navPad || obs.steerPad || 0));
      const reachZ = (obs.hz || 0) + radius + Math.max(0, Number(obs.navPad || obs.steerPad || 0));
      if (obs.kind === "obb") {
        const c = Math.cos(obs.yaw || 0);
        const ss = Math.sin(obs.yaw || 0);
        const lx = c * dx + ss * dz;
        const lz = -ss * dx + c * dz;
        if (Math.abs(lx) <= reachX && Math.abs(lz) <= reachZ) return true;
      } else {
        if (Math.abs(dx) <= reachX && Math.abs(dz) <= reachZ) return true;
      }
    }
    return false;
  }

  function sampleObstacleOverlapScore(x, z, obstacles, clearance, runtimeOptions = null) {
    let score = 0;
    for (const obs of obstacles) {
      if (!obstacleBlocksRuntime(obs, "collision", runtimeOptions)) continue;
      const dx = x - obs.x;
      const dz = z - obs.z;
      const obstacleClearance = obstacleRuntimePad(obs, clearance, "collision");
      if (obs.kind === "circle") {
        const rr = obs.r + obstacleClearance;
        const dist = Math.hypot(dx, dz);
        if (dist < rr) score += 1 + (rr - dist);
        continue;
      }
      if (obs.kind === "obb") {
        const c = Math.cos(obs.yaw || 0);
        const s = Math.sin(obs.yaw || 0);
        const lx = c * dx + s * dz;
        const lz = -s * dx + c * dz;
        const ex = obs.hx + obstacleClearance;
        const ez = obs.hz + obstacleClearance;
        const ox = ex - Math.abs(lx);
        const oz = ez - Math.abs(lz);
        if (ox > 0 && oz > 0) score += 1 + Math.min(ox, oz);
        continue;
      }
      const ox = obs.hx + obstacleClearance - Math.abs(dx);
      const oz = obs.hz + obstacleClearance - Math.abs(dz);
      if (ox > 0 && oz > 0) score += 1 + Math.min(ox, oz);
    }
    return score;
  }

  function chooseGroundEscapeStep(
    target,
    step,
    staticObstacles,
    dynamicObstacles,
    clearance,
    queryY = 0,
    supportSurfaceId = "",
    runtimeOptions = null
  ) {
    const currentOverlap = sampleObstacleOverlapScore(cat.pos.x, cat.pos.z, dynamicObstacles, clearance, runtimeOptions);
    if (currentOverlap <= 0.0001) return null;
    const supportMargin = CAT_COLLISION.catBodyRadius + 0.005;

    const baseYaw = Math.atan2(target.x - cat.pos.x, target.z - cat.pos.z);
    const escapeSteps = [
      Math.max(0.04, step * 1.8),
      Math.max(0.04, step * 1.45),
      Math.max(0.04, step * 1.15),
      Math.max(0.04, step),
      Math.max(0.032, step * 0.75),
      Math.max(0.026, step * 0.55),
    ];
    const dirs = 28;
    let best = null;
    let bestScore = Infinity;

    for (const s of escapeSteps) {
      for (let i = 0; i < dirs; i++) {
        const yaw = baseYaw + (i / dirs) * Math.PI * 2;
        const sx = Math.sin(yaw);
        const sz = Math.cos(yaw);
        const tx = cat.pos.x + sx * s;
        const tz = cat.pos.z + sz * s;
        if (
          supportSurfaceId &&
          !isPointWithinElevatedSupport(tx, tz, queryY, supportMargin, supportSurfaceId)
        ) {
          continue;
        }
        if (obstacleBlocksAny(staticObstacles, tx, tz, clearance, queryY, runtimeOptions)) continue;
        const overlap = sampleObstacleOverlapScore(tx, tz, dynamicObstacles, clearance, runtimeOptions);
        const progress = (target.x - cat.pos.x) * sx + (target.z - cat.pos.z) * sz;
        // Primary objective: reduce overlap quickly; secondary: still move roughly toward target.
        const score = overlap * 12 - progress * 0.25 + Math.abs(angleDelta(yaw, baseYaw)) * 0.08;
        if (score < bestScore) {
          bestScore = score;
          best = { sx, sz, yaw, step: s, overlap };
        }
      }
      if (best && best.overlap <= currentOverlap - 0.02) break;
    }

    if (!best) return null;
    if (best.overlap > currentOverlap + 0.005) return null;
    return best;
  }

  function findNearestNavigablePoint(
    origin,
    target,
    staticObstacles,
    dynamicObstacles,
    clearance,
    queryY = 0,
    supportSurfaceId = "",
    runtimeOptions = null
  ) {
    const baseYaw = Math.atan2(target.x - origin.x, target.z - origin.z);
    const supportMargin = CAT_COLLISION.catBodyRadius + 0.005;
    let best = null;
    let bestScore = Infinity;
    const radii = [0.06, 0.1, 0.14, 0.2, 0.28, 0.38, 0.5, 0.64, 0.8, 0.98];
    for (let ri = 0; ri < radii.length; ri++) {
      const r = radii[ri];
      const steps = 28;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const yaw = baseYaw + t * Math.PI * 2;
        const x = origin.x + Math.sin(yaw) * r;
        const z = origin.z + Math.cos(yaw) * r;
        if (
          supportSurfaceId &&
          !isPointWithinElevatedSupport(x, z, queryY, supportMargin, supportSurfaceId)
        ) {
          continue;
        }
        if (obstacleBlocksAny(staticObstacles, x, z, clearance, queryY, runtimeOptions)) continue;
        if (obstacleBlocksAny(dynamicObstacles, x, z, clearance, queryY, runtimeOptions)) continue;
        const dGoal = Math.hypot(target.x - x, target.z - z);
        const dTurn = Math.abs(angleDelta(yaw, baseYaw));
        const score = r * 0.9 + dGoal * 0.35 + dTurn * 0.04;
        if (score < bestScore) {
          bestScore = score;
          if (!best) best = new THREE.Vector3();
          best.set(x, 0, z);
        }
      }
      if (best) break;
    }
    return best;
  }

  function hasRuntimeClearTravelLine(a, b, obstacles, clearance = 0, queryY = 0, runtimeOptions = null) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const probeStride = Math.min(0.14, Math.max(0.08, Math.max(0.01, clearance) * 0.55));
    const samples = Math.max(2, Math.ceil(dist / probeStride));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      for (const obs of obstacles) {
        if (obstacleBlocksPoint(obs, x, z, clearance, queryY, runtimeOptions)) return false;
      }
    }
    return true;
  }

  function validateRemainingPathToGoal(target, obstacles, clearance, queryY = 0, runtimeOptions = null) {
    if (!Array.isArray(cat.nav.path) || cat.nav.path.length <= 1) {
      return {
        ok: hasRuntimeClearTravelLine(cat.pos, target, obstacles, clearance, queryY, runtimeOptions),
        blockedFrom: cat.pos,
        blockedTo: target,
      };
    }

    const points = [cat.pos];
    const startIdx = THREE.MathUtils.clamp(cat.nav.index || 1, 1, cat.nav.path.length - 1);
    for (let i = startIdx; i < cat.nav.path.length; i++) {
      const p = cat.nav.path[i];
      if (!p) continue;
      points.push(p);
    }
    const last = points[points.length - 1];
    if (!last || last.distanceToSquared(target) > 0.01 * 0.01) points.push(target);

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!hasRuntimeClearTravelLine(a, b, obstacles, clearance, queryY, runtimeOptions)) {
        return { ok: false, blockedFrom: a, blockedTo: b };
      }
    }
    return { ok: true, blockedFrom: null, blockedTo: null };
  }

  function obstacleMatchesRuntimeSurface(obs, runtimeOptions = null) {
    if (!obs || !runtimeOptions?.supportSurfaceId || runtimeOptions.supportSurfaceId === "floor") return true;
    const surface = typeof getSurfaceById === "function" ? getSurfaceById(runtimeOptions.supportSurfaceId) : null;
    if (!surface) return true;
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

  function obstacleIgnoredForRuntimeOnSurface(obs, runtimeOptions = null) {
    const supportSurfaceId = String(runtimeOptions?.supportSurfaceId || "");
    if (!obs || !supportSurfaceId || supportSurfaceId === "floor") return false;
    const ignoreIds = Array.isArray(obs.jumpIgnoreSurfaceIds)
      ? obs.jumpIgnoreSurfaceIds.map((v) => String(v))
      : obs.jumpIgnoreSurfaceIds != null
        ? [String(obs.jumpIgnoreSurfaceIds)]
        : [];
    if (ignoreIds.includes(supportSurfaceId)) return true;
    return obs.tag === "surfaceSupport" && String(obs.surfaceId || "") === supportSurfaceId;
  }

  function filterObstaclesForRuntimeSurface(obstacles, supportSurfaceId = "") {
    const resolvedSurfaceId = String(supportSurfaceId || "");
    if (!Array.isArray(obstacles) || !obstacles.length || !resolvedSurfaceId || resolvedSurfaceId === "floor") {
      return obstacles;
    }
    const runtimeOptions = { supportSurfaceId: resolvedSurfaceId };
    const filtered = obstacles.filter((obs) => !obstacleIgnoredForRuntimeOnSurface(obs, runtimeOptions));
    return filtered.length === obstacles.length ? obstacles : filtered;
  }

  function hasPushableObstacleOnRuntimeSurface(obstacles, runtimeOptions = null) {
    if (!Array.isArray(obstacles) || !obstacles.length) return false;
    for (const obs of obstacles) {
      if (!obs?.pushable) continue;
      if (obstacleIgnoredForRuntimeOnSurface(obs, runtimeOptions)) continue;
      if (!obstacleMatchesRuntimeSurface(obs, runtimeOptions)) continue;
      return true;
    }
    return false;
  }

  function sampleSoftishObstaclePenalty(x, z, obstacles, clearance = 0, runtimeOptions = null) {
    if (!Array.isArray(obstacles) || !obstacles.length) return 0;
    let score = 0;
    for (const obs of obstacles) {
      score += computeSoftishObstaclePenaltyForPoint(obs, x, z, clearance, runtimeOptions);
    }
    return score;
  }

  function computeSoftishObstaclePenaltyForPoint(obs, x, z, clearance = 0, runtimeOptions = null) {
    if (!obs) return 0;
    if (!obstacleIsSoftish(obs)) return 0;
    if (obstacleIgnoredForRuntimeOnSurface(obs, runtimeOptions)) return 0;
    if (!obstacleMatchesRuntimeSurface(obs, runtimeOptions)) return 0;
    const obstacleClearance = obstacleRuntimePad(obs, clearance, "steer") + 0.06;
    if (obs.kind === "circle") {
      const rr = (obs.r || 0) + obstacleClearance;
      const dx = x - obs.x;
      const dz = z - obs.z;
      const dist = Math.hypot(dx, dz);
      if (dist < rr) return 1 + (rr - dist) * 4.5;
      if (dist < rr + 0.18) return (rr + 0.18 - dist) * 0.85;
      return 0;
    }
    if (obs.kind === "obb") {
      const dx = x - obs.x;
      const dz = z - obs.z;
      const c = Math.cos(obs.yaw || 0);
      const s = Math.sin(obs.yaw || 0);
      const lx = c * dx + s * dz;
      const lz = -s * dx + c * dz;
      const ox = obs.hx + obstacleClearance - Math.abs(lx);
      const oz = obs.hz + obstacleClearance - Math.abs(lz);
      if (ox > 0 && oz > 0) return 1 + Math.min(ox, oz) * 4.5;
      if (ox > -0.16 && oz > -0.16) return Math.max(0, 0.16 + Math.min(ox, oz)) * 0.75;
      return 0;
    }
    const dx = x - obs.x;
    const dz = z - obs.z;
    const ox = obs.hx + obstacleClearance - Math.abs(dx);
    const oz = obs.hz + obstacleClearance - Math.abs(dz);
    if (ox > 0 && oz > 0) return 1 + Math.min(ox, oz) * 4.5;
    if (ox > -0.16 && oz > -0.16) return Math.max(0, 0.16 + Math.min(ox, oz)) * 0.75;
    return 0;
  }

  function findDominantSoftishObstacle(x, z, obstacles, clearance = 0, runtimeOptions = null) {
    if (!Array.isArray(obstacles) || !obstacles.length) return null;
    let best = null;
    let bestScore = 0;
    for (const obs of obstacles) {
      const score = computeSoftishObstaclePenaltyForPoint(obs, x, z, clearance, runtimeOptions);
      if (!(score > bestScore)) continue;
      bestScore = score;
      best = {
        ...(summarizeBlockingObstacle(obs) || {}),
        score,
      };
    }
    return best;
  }

  function withTemporaryPathOptions(pathOptions, fn) {
    const previous = cat.nav?.pathOptions && typeof cat.nav.pathOptions === "object"
      ? { ...cat.nav.pathOptions }
      : null;
    if (!cat.nav) return fn();
    if (pathOptions && typeof pathOptions === "object") cat.nav.pathOptions = { ...pathOptions };
    else delete cat.nav.pathOptions;
    try {
      return fn();
    } finally {
      if (previous) cat.nav.pathOptions = previous;
      else delete cat.nav.pathOptions;
    }
  }

  function obstacleBlocksRuntime(obs, stage = "segment", runtimeOptions = null) {
    if (!obs) return false;
    if (obstacleIgnoredForRuntimeOnSurface(obs, runtimeOptions)) return false;
    if (obs.tag === "cup" && (cat.state === "toCup" || cat.state === "swipe")) return false;
    const elevatedSoftAvoidance =
      stage !== "collision" &&
      !!runtimeOptions?.avoidSoftRuntime &&
      obstacleMatchesRuntimeSurface(obs, runtimeOptions);
    if (obs.pushable) {
      if (runtimeOptions?.allowPushablePass && obstacleMatchesRuntimeSurface(obs, runtimeOptions)) return false;
      return elevatedSoftAvoidance;
    }
    if (String(obs.mode || "hard") !== "hard") return elevatedSoftAvoidance;
    return obs.blocksRuntime !== false;
  }

  function obstacleBlocksPoint(obs, x, z, clearance = 0, queryY = 0, runtimeOptions = null) {
    if (!obstacleBlocksRuntime(obs, "segment", runtimeOptions)) return false;
    if (Number.isFinite(obs?.y) && Number.isFinite(obs?.h)) {
      const halfH = Math.max(0.001, obs.h * 0.5);
      const minY = obs.y - halfH - 0.08;
      const maxY = obs.y + halfH + 0.08;
      if (queryY < minY || queryY > maxY) return false;
    }
    const dx = x - obs.x;
    const dz = z - obs.z;
    const obstacleClearance = obstacleRuntimePad(obs, clearance, "steer");
    if (obs.kind === "box") {
      return Math.abs(dx) <= (obs.hx + obstacleClearance) && Math.abs(dz) <= (obs.hz + obstacleClearance);
    }
    if (obs.kind === "obb") {
      const c = Math.cos(obs.yaw || 0);
      const s = Math.sin(obs.yaw || 0);
      const lx = c * dx + s * dz;
      const lz = -s * dx + c * dz;
      return Math.abs(lx) <= (obs.hx + obstacleClearance) && Math.abs(lz) <= (obs.hz + obstacleClearance);
    }
    const rr = (obs.r || 0) + obstacleClearance;
    return dx * dx + dz * dz <= rr * rr;
  }

  function obstacleBlocksAny(obstacles, x, z, clearance = 0, queryY = 0, runtimeOptions = null) {
    if (!Array.isArray(obstacles) || !obstacles.length) return false;
    for (const obs of obstacles) {
      if (obstacleBlocksPoint(obs, x, z, clearance, queryY, runtimeOptions)) return true;
    }
    return false;
  }

  function summarizeBlockingObstacle(obs) {
    if (!obs) return null;
    const label =
      obs.pickupKey ||
      obs.tag ||
      (obs.kind === "circle" ? "circle" : obs.kind === "obb" ? "obb" : "box");
    return {
      obstacleLabel: label,
      obstacleKind: obs.kind || "unknown",
      obstacleX: Number.isFinite(obs.x) ? obs.x : 0,
      obstacleZ: Number.isFinite(obs.z) ? obs.z : 0,
    };
  }

  function findBlockingObstacleAtPoint(obstacles, x, z, clearance = 0, queryY = 0, runtimeOptions = null) {
    if (!Array.isArray(obstacles) || !obstacles.length) return null;
    for (const obs of obstacles) {
      if (!obstacleBlocksPoint(obs, x, z, clearance, queryY, runtimeOptions)) continue;
      return summarizeBlockingObstacle(obs);
    }
    return null;
  }

  function findFirstBlockingOnLine(a, b, obstacles, clearance = 0, queryY = 0, runtimeOptions = null) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return null;
    const probeStride = Math.min(0.14, Math.max(0.08, Math.max(0.01, clearance) * 0.55));
    const samples = Math.max(2, Math.ceil(dist / probeStride));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      for (const obs of obstacles) {
        if (obs?.tag === "cup" && (cat.state === "toCup" || cat.state === "swipe")) continue;
        if (!obstacleBlocksPoint(obs, x, z, clearance, queryY, runtimeOptions)) continue;
        return {
          t,
          sampleX: x,
          sampleZ: z,
          ...summarizeBlockingObstacle(obs),
        };
      }
    }
    return null;
  }

  function moveCatToward(target, dt, speed, yLevel, opts = {}) {
    ensureNavDebugStore();
    const now = getClockTime();
    const repathState = { forcedCount: 0 };
    let direct = !!opts.direct;
    let ignoreDynamic = !!opts.ignoreDynamic;
    const supportSurfaceId =
      yLevel > 0.02 && opts.supportSurfaceId && opts.supportSurfaceId !== "floor"
        ? String(opts.supportSurfaceId)
        : "";
    let chase = target;
    const speedRef = getSpeedRef(speed);
    const preferRun =
      !!cat.nav?.windowHoldActive ||
      (!!game?.catnip && cat.state !== "distracted") ||
      cat.state === "toCatnip";
    cat.nav.commandedSpeed = speedRef;
    cat.nav.debugDestination.set(target.x, yLevel, target.z);

    let cachedGroundStaticObstacles = null;
    let cachedElevatedStaticObstacles = null;
    let cachedDynamicObstacles = null;
    const getGroundStaticObstacles = () => {
      if (!cachedGroundStaticObstacles) cachedGroundStaticObstacles = buildCatObstacles(false);
      return cachedGroundStaticObstacles;
    };
    const getElevatedStaticObstacles = () => {
      if (!cachedElevatedStaticObstacles) {
        const built = buildCatObstacles(false, true);
        cachedElevatedStaticObstacles = filterObstaclesForRuntimeSurface(built, supportSurfaceId);
      }
      return cachedElevatedStaticObstacles;
    };
    const getDynamicObstacles = () => {
      if (!cachedDynamicObstacles) {
        const built = buildCatObstacles(true, true);
        cachedDynamicObstacles = filterObstaclesForRuntimeSurface(built, supportSurfaceId);
      }
      return cachedDynamicObstacles;
    };
    const getGroundCollisionObstacles = () =>
      ignoreDynamic ? getGroundStaticObstacles() : getDynamicObstacles();
    const getElevatedCollisionObstacles = () =>
      ignoreDynamic ? getElevatedStaticObstacles() : getDynamicObstacles();
    const withSurfacePathOptions = (fn, extraPathOptions = null) => {
      if (typeof fn !== "function") return false;
      const mergedPathOptions = {
        ...(extraPathOptions && typeof extraPathOptions === "object" ? extraPathOptions : {}),
      };
      if (supportSurfaceId) mergedPathOptions.supportSurfaceId = supportSurfaceId;
      if (Object.keys(mergedPathOptions).length === 0) return fn();
      return withTemporaryPathOptions(mergedPathOptions, fn);
    };

    if (yLevel <= 0.02) {
      let directRejectTargetObstacle = "";
      let directRejectLineObstacle = "";
      const staticClearance = getCatPathClearance();
      const dynamicClearance = staticClearance;
      const groundStaticObstacles = getGroundStaticObstacles();
      const groundCollisionObstacles = getGroundCollisionObstacles();
      // Some click targets land inside blocker margins; resolve a nearby valid planar goal
      // so we don't churn "no path" replans for unreachable exact points.
      const shouldSnapTarget = !cat.debugMoveActive && !cat.jump;
      const targetForPath = shouldSnapTarget
        ? findNearestPlanarUnblockedTarget(
            target,
            groundStaticObstacles,
            groundCollisionObstacles,
            staticClearance,
            !!ignoreDynamic,
            0
          )
        : target;
      if (direct) {
        const staticObstacles = groundStaticObstacles;
        const targetBlocked = isCatPointBlocked(targetForPath.x, targetForPath.z, staticObstacles, staticClearance, 0, "runtime");
        const lineBlocked = !hasClearTravelLine(cat.pos, targetForPath, staticObstacles, staticClearance, 0, "runtime");
        if (targetBlocked || lineBlocked) {
          if (targetBlocked) {
            directRejectTargetObstacle =
              findBlockingObstacleAtPoint(staticObstacles, targetForPath.x, targetForPath.z, staticClearance, 0, null)?.obstacleLabel || "";
          }
          if (lineBlocked) {
            directRejectLineObstacle =
              findFirstBlockingOnLine(cat.pos, targetForPath, staticObstacles, staticClearance, 0, null)?.obstacleLabel || "";
          }
          direct = false;
          ignoreDynamic = false;
        }
      }
      tempTo.set(targetForPath.x, 0, targetForPath.z);
      if (!direct) {
        const goalChanged = updateGoalChangePending(tempTo, now);
        const noPath = cat.nav.path.length <= 1;
        const needsPath = noPath && now >= cat.nav.repathAt;
        cat.nav.staleInvalidFrames = 0;
        const force = goalChanged || needsPath;
        if (force) {
          if (goalChanged) {
            markRepathCause("force-goalChanged", { ignoreDynamic: !!ignoreDynamic });
            noteGoalChangedRepath(now);
          }
          if (needsPath) markRepathCause("force-needsPath", { ignoreDynamic: !!ignoreDynamic });
        }
        const useDynamicPlan = !ignoreDynamic;
        tryEnsurePath(repathState, tempTo, force, useDynamicPlan);
        if (cat.nav.path.length > 1) {
          let segmentObstacles = getGroundCollisionObstacles();
          const segmentClearance = ignoreDynamic ? staticClearance : dynamicClearance;
          const lookAheadDistance = getPathLookAheadDistance(speedRef, false);
          chase = selectPathChasePoint(tempTo, segmentObstacles, segmentClearance, 0, lookAheadDistance);
          let deferredSegmentBlock = false;
          if (!hasRuntimeClearTravelLine(cat.pos, chase, segmentObstacles, segmentClearance)) {
            const segmentBlock = findFirstBlockingOnLine(cat.pos, chase, segmentObstacles, segmentClearance, 0);
            if (segmentBlock) {
              cat.nav.debugStep.blockedObstacle = segmentBlock.obstacleLabel;
              cat.nav.debugStep.blockedObstacleKind = segmentBlock.obstacleKind;
              cat.nav.debugStep.blockedAtX = segmentBlock.sampleX;
              cat.nav.debugStep.blockedAtZ = segmentBlock.sampleZ;
            }
            cat.nav.segmentBlockedFrames = (cat.nav.segmentBlockedFrames || 0) + 1;
            const minSegmentBlockedFrames =
              CAT_NAV.useDetourCrowd && !ignoreDynamic ? 3 : 2;
            const shouldRepathSegment =
              ENABLE_SEGMENT_BLOCK_REPATH &&
              (cat.nav.segmentBlockedFrames || 0) >= minSegmentBlockedFrames;
            const allowSegmentBlockedRepath =
              shouldRepathSegment &&
              canTriggerSegmentBlockedRepath(now, segmentBlock, tempTo, 0, false);
            if (allowSegmentBlockedRepath) {
              markRepathCause("segment-blocked", {
                ignoreDynamic: !!ignoreDynamic,
                segmentBlockedFrames: cat.nav.segmentBlockedFrames,
                ...segmentBlock,
              });
              if (tryEnsurePath(repathState, tempTo, true, !ignoreDynamic)) {
                bumpDebugCounter("repath");
                recordNavEvent("repath-segment-blocked", { ignoreDynamic: !!ignoreDynamic });
              }
              segmentObstacles = getGroundCollisionObstacles();
              if (cat.nav.path.length > 1) {
                chase = selectPathChasePoint(tempTo, segmentObstacles, segmentClearance, 0, lookAheadDistance);
                if (!hasRuntimeClearTravelLine(cat.pos, chase, segmentObstacles, segmentClearance)) {
                  const nIndex = THREE.MathUtils.clamp(cat.nav.index, 1, cat.nav.path.length - 1);
                  let advanced = false;
                  for (let i = nIndex + 1; i < cat.nav.path.length; i++) {
                    const candidate = cat.nav.path[i];
                    if (hasRuntimeClearTravelLine(cat.pos, candidate, segmentObstacles, segmentClearance)) {
                      cat.nav.index = i;
                      chase = candidate;
                      advanced = true;
                      recordNavEvent("segment-blocked-skip-waypoint", { pathIndex: i });
                      break;
                    }
                  }
                  if (advanced) {
                    // continue movement with farther visible waypoint
                  } else {
                    const rescueChase = findNearestNavigablePoint(
                      cat.pos,
                      tempTo,
                      getGroundStaticObstacles(),
                      segmentObstacles,
                      segmentClearance
                    );
                    if (rescueChase) {
                      chase = rescueChase;
                      bumpDebugCounter("segmentRescue");
                      recordNavEvent("segment-blocked-local-rescue", { x: rescueChase.x, z: rescueChase.z });
                    }
                  }
                }
              }
            } else {
              deferredSegmentBlock = true;
              if (now >= (cat.nav.segmentBlockEventAt || 0)) {
                recordNavEvent("segment-blocked-defer", {
                  ignoreDynamic: !!ignoreDynamic,
                  segmentBlockedFrames: cat.nav.segmentBlockedFrames,
                  ...segmentBlock,
                });
                cat.nav.segmentBlockEventAt = now + 0.2;
              }
              const shouldAttemptDeferredRescue =
                (cat.nav.segmentBlockedFrames || 0) >= 2 ||
                segmentBlock?.obstacleKind === "box" ||
                segmentBlock?.obstacleKind === "obb";
              if (shouldAttemptDeferredRescue) {
                const rescueChase = findNearestNavigablePoint(
                  cat.pos,
                  tempTo,
                  getGroundStaticObstacles(),
                  segmentObstacles,
                  segmentClearance,
                  0
                );
                if (rescueChase) {
                  chase = rescueChase;
                  deferredSegmentBlock = false;
                  bumpDebugCounter("segmentRescue");
                  recordNavEvent("segment-blocked-defer-rescue", {
                    x: rescueChase.x,
                    z: rescueChase.z,
                    ignoreDynamic: !!ignoreDynamic,
                  });
                }
              }
            }
          } else {
            cat.nav.segmentBlockedFrames = 0;
            cat.nav.segmentBlockSignature = "";
            cat.nav.segmentBlockRepathAt = 0;
            cat.nav.debugStep.blockedObstacle = "";
            cat.nav.debugStep.blockedObstacleKind = "";
            cat.nav.debugStep.blockedAtX = NaN;
            cat.nav.debugStep.blockedAtZ = NaN;
          }

          // Enforce full-route validity with hysteresis so temporary local blockers
          // don't force immediate global replans every frame.
          if (!deferredSegmentBlock && now >= cat.nav.wholePathValidateAt) {
            cat.nav.wholePathValidateAt = now + 0.08;
            let wholePath = validateRemainingPathToGoal(tempTo, segmentObstacles, segmentClearance, 0);
            if (!wholePath.ok) {
              cat.nav.wholePathBlockedFrames = (cat.nav.wholePathBlockedFrames || 0) + 1;
              const wholePathBlockedFrames = cat.nav.wholePathBlockedFrames || 0;
              const wholePathPressure =
                (cat.nav.stuckT || 0) > 0.24 ||
                (cat.nav.noSteerFrames || 0) > 6 ||
                (cat.nav.segmentBlockedFrames || 0) > 2;
              const relaxedWholePath =
                CAT_NAV.useDetourCrowd && !ignoreDynamic;
              const minWholePathFramesForRepath = relaxedWholePath ? 4 : 1;
              const forceWholePathRepath =
                wholePathBlockedFrames >= minWholePathFramesForRepath &&
                (wholePathPressure || wholePathBlockedFrames >= 8);
              const canRetryRepath = now >= (cat.nav.wholePathBlockRetryAt || 0);
              if (canRetryRepath && forceWholePathRepath) {
                cat.nav.wholePathBlockRetryAt = now + Math.max(CAT_NAV.repathInterval * 1.6, 0.26);
                markRepathCause("whole-path-blocked", { ignoreDynamic: !!ignoreDynamic });
                if (tryEnsurePath(repathState, tempTo, true, !ignoreDynamic)) {
                  bumpDebugCounter("repath");
                }
                if (now >= (cat.nav.wholePathBlockEventAt || 0)) {
                  recordNavEvent("repath-whole-path-blocked", {
                    fromX: wholePath.blockedFrom?.x,
                    fromZ: wholePath.blockedFrom?.z,
                    toX: wholePath.blockedTo?.x,
                    toZ: wholePath.blockedTo?.z,
                  });
                  cat.nav.wholePathBlockEventAt = now + 0.2;
                }

                segmentObstacles = getGroundCollisionObstacles();
                wholePath = validateRemainingPathToGoal(tempTo, segmentObstacles, segmentClearance, 0);
              }

              if (!wholePath.ok) {
                if (!relaxedWholePath || (wholePathPressure && wholePathBlockedFrames >= 10)) {
                  cat.nav.repathAt = Math.max(cat.nav.repathAt || 0, now + Math.max(CAT_NAV.repathInterval, 0.18));
                  cat.nav.debugStep.reason = "wholePathBlocked";
                  setLocomotionIntent("idle", 0);
                  updateDriveSpeed(0, dt);
                  clearNavMotionMetrics();
                  return false;
                }
                cat.nav.debugStep.reason = "wholePathBlockedRelaxed";
                cat.nav.wholePathBlockRetryAt = Math.max(
                  cat.nav.wholePathBlockRetryAt || 0,
                  now + Math.max(CAT_NAV.repathInterval * 1.2, 0.2)
                );
                recordNavEvent("whole-path-blocked-relaxed", {
                  frames: wholePathBlockedFrames,
                  pressure: wholePathPressure ? 1 : 0,
                });
              }

              if (wholePath.ok) {
                cat.nav.wholePathBlockedFrames = 0;
                cat.nav.wholePathBlockRetryAt = 0;
                cat.nav.wholePathBlockEventAt = 0;
                if (cat.nav.path.length > 1) {
                  chase = selectPathChasePoint(tempTo, segmentObstacles, segmentClearance, 0, lookAheadDistance);
                }
              }
            } else {
              cat.nav.wholePathBlockedFrames = 0;
              cat.nav.wholePathBlockRetryAt = 0;
              cat.nav.wholePathBlockEventAt = 0;
            }
          }
        }
        if (
          cat.nav.path.length <= 1
        ) {
          const arrivedWithoutPath = isNearTargetXZ(target) || (tempTo && isNearTargetXZ(tempTo, 0.12));
          if (arrivedWithoutPath) {
            cat.pos.set(target.x, 0, target.z);
            cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
            cat.nav.goalChangePendingSince = 0;
            setLocomotionIntent("idle", 0);
            updateDriveSpeed(0, dt);
            clearNavMotionMetrics();
            return true;
          }
          cat.nav.debugStep = {
            phase: "ground",
            reason: "noPath",
            direct,
            ignoreDynamic,
            targetX: target.x,
            targetZ: target.z,
            planTargetX: tempTo.x,
            planTargetZ: tempTo.z,
            pathLen: cat.nav.path.length,
            pathIndex: cat.nav.index,
            stuckT: cat.nav.stuckT,
            time: getClockTime(),
          };
          bumpDebugCounter("noPath");
          recordNavEvent("no-path", { targetX: target.x, targetZ: target.z });
          cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
          setLocomotionIntent("idle", 0);
          updateDriveSpeed(0, dt);
          clearNavMotionMetrics();
          return false;
        }
      }

      const crowdTarget = direct ? tempTo : chase;
      const crowdSoftPressure =
        hasNearbySoftishObstacle(cat.pos, groundCollisionObstacles, 0.95) ||
        hasNearbySoftishObstacle(crowdTarget, groundCollisionObstacles, 0.8) ||
        hasNearbySoftishObstacle(tempTo, groundCollisionObstacles, 0.8);
      const straightFloorRoute =
        yLevel <= 0.02 &&
        !cat.nav?.dynamicBypassActive &&
        (cat.nav?.path?.length || 0) <= 2 &&
        hasRuntimeClearTravelLine(cat.pos, tempTo, groundCollisionObstacles, staticClearance, 0);
      if (
        CAT_NAV.useDetourCrowd &&
        typeof stepDetourCrowdToward === "function" &&
        !crowdSoftPressure &&
        !straightFloorRoute
      ) {
        const crowdYaw = angleDelta(
          Math.atan2(crowdTarget.x - cat.pos.x, crowdTarget.z - cat.pos.z),
          cat.group.rotation.y
        );
        const nearCrowdEndpoint = shouldPreferWalkNearEndpoint(
          cat.pos.distanceTo(crowdTarget),
          cat.pos.distanceTo(tempTo)
        );
        const runForCrowd = shouldUseRunLocomotion(
          preferRun && !nearCrowdEndpoint,
          cat.pos.distanceTo(crowdTarget),
          cat.pos.distanceTo(tempTo),
          crowdYaw,
          now
        );
        const crowdDesiredSpeed = runForCrowd ? speedRef : speed;
        const crowdStep = stepDetourCrowdToward(crowdTarget, dt, !ignoreDynamic, crowdDesiredSpeed);
        if (crowdStep?.ok && crowdStep.position) {
          const staticClearance = getCatPathClearance();
          const collisionObstacles = getGroundCollisionObstacles();
          const cx = crowdStep.position.x;
          const cz = crowdStep.position.z;
          if (!isCatPointBlocked(cx, cz, collisionObstacles, staticClearance * 0.98, 0, "collision")) {
            const snapRadius = Math.max(0.06, Number.isFinite(CAT_NAV.detourArriveSnapRadius) ? CAT_NAV.detourArriveSnapRadius : 0.1);
            const distToTarget = cat.pos.distanceTo(target);
            if (distToTarget <= snapRadius) {
              cat.pos.set(target.x, 0, target.z);
              cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
              cat.nav.commandedSpeed = 0;
              cat.nav.stuckT = 0;
              cat.nav.noSteerFrames = 0;
              cat.nav.goalChangePendingSince = 0;
              setLocomotionIntent("idle", 0);
              updateDriveSpeed(0, dt);
              clearNavMotionMetrics();
              cat.nav.debugStep = {
                phase: "ground",
                reason: "detourCrowd-arrive",
                direct,
                ignoreDynamic,
                targetX: target.x,
                targetY: yLevel,
                targetZ: target.z,
                pathLen: cat.nav.path.length,
                pathIndex: cat.nav.index,
                crowdState: crowdStep.state,
                crowdSpeed: 0,
                crowdDrift: Math.sqrt(Math.max(0, crowdStep.driftSq || 0)),
                crowdDistToGoal: crowdStep.distToGoal,
                crowdReqX: crowdStep.requestX,
                crowdReqZ: crowdStep.requestZ,
                crowdTargetChanged: crowdStep.targetChanged,
                crowdRecreated: crowdStep.recreated,
                crowdTeleported: crowdStep.teleportedToCat,
                crowdAgentX: crowdStep.agentPos?.x,
                crowdAgentZ: crowdStep.agentPos?.z,
                crowdStepDt: crowdStep.stepDt,
                crowdLastRequestAge: crowdStep.lastRequestAge,
                locomotionClip: "idle",
                directRejectTargetObstacle,
                directRejectLineObstacle,
              time: now,
            };
            return true;
          }

            const vel = crowdStep.velocity ? tempCrowdVel.copy(crowdStep.velocity) : tempCrowdVel.set(0, 0, 0);
            const velLen = Math.hypot(vel.x || 0, vel.z || 0);
            const stepDx = cx - cat.pos.x;
            const stepDz = cz - cat.pos.z;
            const stepLen = Math.hypot(stepDx, stepDz);
            let yawTarget = Math.atan2(target.x - cat.pos.x, target.z - cat.pos.z);
            if (!direct) yawTarget = Math.atan2(crowdTarget.x - cat.pos.x, crowdTarget.z - cat.pos.z);
            if (stepLen > 0.005) yawTarget = Math.atan2(stepDx, stepDz);
            if (velLen > 0.08 && stepLen > 0.02) yawTarget = Math.atan2(vel.x, vel.z);
            const rawYaw = angleDelta(yawTarget, cat.group.rotation.y);
            const runForLocomotion = shouldUseRunLocomotion(
              preferRun && !nearCrowdEndpoint,
              cat.pos.distanceTo(crowdTarget),
              cat.pos.distanceTo(target),
              rawYaw,
              now
            );
            let locomotionClip = chooseGroundLocomotion(rawYaw, dt, runForLocomotion);
            let turnOnly = locomotionClip.startsWith("turn");
            const movingCrowdStep = stepLen > 0.012 || velLen > 0.35;
            if (turnOnly && movingCrowdStep && Math.abs(rawYaw) < 0.55) {
              locomotionClip = runForLocomotion ? "runF" : "walkF";
              turnOnly = false;
            }
            const profile = getLocomotionProfile(locomotionClip);
            const basePlanar = Math.max(0.05, profile.planarSpeed || 0.8);
            const d = cat.pos.distanceTo(crowdTarget);
            const scale = THREE.MathUtils.clamp(
              velLen > 0.01 ? velLen / basePlanar : (turnOnly ? 0.85 : 0),
              0,
              Math.max(1.0, Number.isFinite(CAT_NAV.locomotionScaleCap) ? CAT_NAV.locomotionScaleCap : 8.0)
            );

            rotateCatToward(yawTarget, dt);
            if (turnOnly) {
              const prevTurnOnlyT = Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0;
              cat.nav.turnOnlyT = prevTurnOnlyT + dt;
              if (Math.abs(rawYaw) > 0.95 && isRunClip(locomotionClip)) {
                triggerRunCooldown(now, 0.6);
              }

              const creepMoved = 0;
              cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
              cat.nav.commandedSpeed = Math.max(0.05, speedRef);
              cat.nav.stuckT += dt * 0.2;
              setLocomotionIntent(locomotionClip, 1.0);
              updateDriveSpeed(0, dt);
              setNavMotionMetrics(creepMoved, dt, Math.max(0.05, speedRef));

              const turnOnlyRepathCooldownUntil = Number.isFinite(cat.nav.turnOnlyRepathCooldownUntil)
                ? cat.nav.turnOnlyRepathCooldownUntil
                : 0;
              const goalRepathCooldownUntil = Number.isFinite(cat.nav.goalRepathCooldownUntil)
                ? cat.nav.goalRepathCooldownUntil
                : 0;
              const turnOnlyHardPressure =
                (cat.nav.segmentBlockedFrames || 0) > 0 ||
                (cat.nav.wholePathBlockedFrames || 0) > 0 ||
                !!cat.nav.staleInvalidFrames ||
                (cat.nav.path.length || 0) <= 1;
              const turnOnlyPathUnstable = turnOnlyHardPressure;
              if (
                turnOnlyPathUnstable &&
                cat.nav.turnOnlyT > 0.7 &&
                d > 0.35 &&
                now >= cat.nav.repathAt &&
                now >= turnOnlyRepathCooldownUntil &&
                now >= goalRepathCooldownUntil
              ) {
                markRepathCause("turn-only", { ignoreDynamic: !!ignoreDynamic, detour: true });
                if (tryEnsurePath(repathState, target, true, !ignoreDynamic)) {
                  cat.nav.repathAt = now + CAT_NAV.repathInterval * 0.8;
                  cat.nav.turnOnlyRepathCooldownUntil = now + 0.8;
                  bumpDebugCounter("turnOnlyRepath");
                  bumpDebugCounter("repath");
                  recordNavEvent("repath-turnonly", {
                    d,
                    rawYawDelta: rawYaw,
                    ignoreDynamic: !!ignoreDynamic,
                    detour: true,
                  });
                  cat.nav.turnOnlyT = 0;
                }
              }
              cat.nav.debugStep = {
                phase: "ground",
                reason: "detourCrowd-turnOnly",
                direct,
                ignoreDynamic,
                targetX: target.x,
                targetY: yLevel,
                targetZ: target.z,
                chaseX: crowdTarget.x,
                chaseY: Number.isFinite(crowdTarget.y) ? crowdTarget.y : yLevel,
                chaseZ: crowdTarget.z,
                distToChase: cat.pos.distanceTo(crowdTarget),
                pathLen: cat.nav.path.length,
                pathIndex: cat.nav.index,
                stuckT: cat.nav.stuckT,
                turnOnlyT: Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0,
                crowdState: crowdStep.state,
                crowdSpeed: velLen,
                crowdStepLen: stepLen,
                crowdVelLen: velLen,
                crowdDrift: Math.sqrt(Math.max(0, crowdStep.driftSq || 0)),
                crowdDistToGoal: crowdStep.distToGoal,
                crowdReqX: crowdStep.requestX,
                crowdReqZ: crowdStep.requestZ,
                crowdTargetChanged: crowdStep.targetChanged,
                crowdRecreated: crowdStep.recreated,
                crowdTeleported: crowdStep.teleportedToCat,
                crowdAgentX: crowdStep.agentPos?.x,
                crowdAgentZ: crowdStep.agentPos?.z,
                crowdStepDt: crowdStep.stepDt,
                crowdLastRequestAge: crowdStep.lastRequestAge,
                rawYawDelta: rawYaw,
                turnOnly,
                creepMoved,
                locomotionClip,
                directRejectTargetObstacle,
                directRejectLineObstacle,
                time: now,
              };
              return false;
            }

            cat.nav.turnOnlyT = 0;

            cat.pos.set(cx, 0, cz);
            cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);

            const moved = cat.pos.distanceTo(tempFrom);
            cat.nav.commandedSpeed = Math.max(0.05, speedRef);
            if (moved > 0.002 || velLen > 0.01) {
              cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.8);
              cat.nav.noSteerFrames = 0;
            } else {
              cat.nav.stuckT += dt * 0.25;
              if (isRunClip(locomotionClip) && velLen < 0.02) {
                triggerRunCooldown(now, 1.15);
              }
            }
            const movingNow = velLen > 0.006;
            setLocomotionIntent(movingNow || turnOnly ? locomotionClip : "idle", scale);
            updateDriveSpeed(velLen, dt);
            setNavMotionMetrics(moved, dt, Math.max(0.05, speedRef));
              cat.nav.debugStep = {
                phase: "ground",
                reason: "detourCrowd",
                direct,
                ignoreDynamic,
                targetX: target.x,
                targetY: yLevel,
                targetZ: target.z,
                planTargetX: tempTo.x,
                planTargetZ: tempTo.z,
                chaseX: crowdTarget.x,
                chaseY: Number.isFinite(crowdTarget.y) ? crowdTarget.y : yLevel,
                chaseZ: crowdTarget.z,
                distToChase: cat.pos.distanceTo(crowdTarget),
                pathLen: cat.nav.path.length,
                pathIndex: cat.nav.index,
              stuckT: cat.nav.stuckT,
              turnOnlyT: Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0,
              crowdState: crowdStep.state,
              crowdSpeed: velLen,
              crowdStepLen: stepLen,
              crowdVelLen: velLen,
              crowdDrift: Math.sqrt(Math.max(0, crowdStep.driftSq || 0)),
              crowdDistToGoal: crowdStep.distToGoal,
              crowdReqX: crowdStep.requestX,
              crowdReqZ: crowdStep.requestZ,
              crowdTargetChanged: crowdStep.targetChanged,
              crowdRecreated: crowdStep.recreated,
              crowdTeleported: crowdStep.teleportedToCat,
              crowdAgentX: crowdStep.agentPos?.x,
              crowdAgentZ: crowdStep.agentPos?.z,
              crowdStepDt: crowdStep.stepDt,
              crowdLastRequestAge: crowdStep.lastRequestAge,
              rawYawDelta: rawYaw,
              turnOnly,
              locomotionClip,
              directRejectTargetObstacle,
              directRejectLineObstacle,
                time: now,
              };
              return isNearTargetXZ(target);
            }
        } else if (crowdStep && crowdStep.ok === false) {
          cat.nav.debugStep = {
            phase: "ground",
            reason: "detourCrowd-failed",
            direct,
            ignoreDynamic,
            targetX: target.x,
            targetZ: target.z,
            crowdFailReason: crowdStep.reason || "unknown",
            crowdReqX: crowdStep.requestX,
            crowdReqZ: crowdStep.requestZ,
            crowdTargetChanged: crowdStep.targetChanged,
            crowdRecreated: crowdStep.recreated,
            crowdTeleported: crowdStep.teleportedToCat,
            directRejectTargetObstacle,
            directRejectLineObstacle,
            pathLen: cat.nav.path.length,
            pathIndex: cat.nav.index,
            stuckT: cat.nav.stuckT,
            time: now,
          };
        }
      }

    } else {
      const queryY = Math.max(0.02, yLevel);
      const staticClearance = getCatPathClearance();
      const dynamicClearance = staticClearance;
      const staticObstacles = getElevatedStaticObstacles();
      const collisionObstacles = getElevatedCollisionObstacles();
      const elevatedRuntimeOptions = {
        avoidSoftRuntime: true,
        supportSurfaceId: supportSurfaceId || "",
        queryY,
      };
      const elevatedMovementRuntimeOptions = {
        ...elevatedRuntimeOptions,
        allowPushablePass: true,
      };
      const collisionClearance = ignoreDynamic ? staticClearance : dynamicClearance;
      const targetForPath = findNearestSupportedElevatedTarget(
        target,
        staticObstacles,
        collisionObstacles,
        collisionClearance,
        queryY,
        supportSurfaceId,
        !!ignoreDynamic,
        elevatedRuntimeOptions
      );
      const canDirectOnSurface = hasRuntimeClearTravelLine(cat.pos, targetForPath, collisionObstacles, collisionClearance, queryY, elevatedRuntimeOptions);
      if (!direct && canDirectOnSurface) {
        direct = true;
      }
      if (direct) {
        if (
          obstacleBlocksAny(collisionObstacles, targetForPath.x, targetForPath.z, collisionClearance, queryY, elevatedRuntimeOptions) ||
          !hasRuntimeClearTravelLine(cat.pos, targetForPath, collisionObstacles, collisionClearance, queryY, elevatedRuntimeOptions)
        ) {
          direct = false;
          ignoreDynamic = false;
        }
      }

      tempTo.set(targetForPath.x, queryY, targetForPath.z);
      cat.nav.debugDestination.set(tempTo.x, queryY, tempTo.z);
      if (!direct) {
        const goalChanged = updateGoalChangePending(tempTo, now);
        const needsPath = cat.nav.path.length <= 1 && now >= cat.nav.repathAt;
        const force = goalChanged || needsPath;
        if (force) {
          if (goalChanged) {
            markRepathCause("force-goalChanged", { ignoreDynamic: !!ignoreDynamic });
            noteGoalChangedRepath(now);
          }
          if (needsPath) markRepathCause("force-needsPath", { ignoreDynamic: !!ignoreDynamic });
        }

        const useDynamicPlan = !ignoreDynamic;
        withSurfacePathOptions(() => tryEnsurePath(repathState, tempTo, force, useDynamicPlan, queryY));
        if (
          cat.nav.path.length <= 1 &&
          !ignoreDynamic &&
          supportSurfaceId &&
          hasPushableObstacleOnRuntimeSurface(collisionObstacles, elevatedRuntimeOptions)
        ) {
          const pushFallbackWorked = withTemporaryPathOptions(
            { supportSurfaceId, ignorePushableSurfaceId: supportSurfaceId, mode: "push-through-surface" },
            () => tryEnsurePath(repathState, tempTo, true, true, queryY)
          );
          if (pushFallbackWorked && cat.nav.path.length > 1) {
            cat.nav.debugStep.pushThroughSurfaceId = supportSurfaceId;
            recordNavEvent("surface-pushthrough-path", {
              surfaceId: supportSurfaceId,
              targetX: tempTo.x,
              targetZ: tempTo.z,
            });
          }
        }
        if (cat.nav.path.length > 1) {
          let segmentObstacles = getElevatedCollisionObstacles();
          const segmentClearance = ignoreDynamic ? staticClearance : dynamicClearance;
          const lookAheadDistance = getPathLookAheadDistance(speedRef, true);
          chase = selectPathChasePoint(tempTo, segmentObstacles, segmentClearance, queryY, lookAheadDistance);
          if (!hasRuntimeClearTravelLine(cat.pos, chase, segmentObstacles, segmentClearance, queryY, elevatedMovementRuntimeOptions)) {
            cat.nav.segmentBlockedFrames = (cat.nav.segmentBlockedFrames || 0) + 1;
            const segmentBlock = findFirstBlockingOnLine(cat.pos, chase, segmentObstacles, segmentClearance, queryY, elevatedRuntimeOptions);
            if (segmentBlock) {
              cat.nav.debugStep.blockedObstacle = segmentBlock.obstacleLabel;
              cat.nav.debugStep.blockedObstacleKind = segmentBlock.obstacleKind;
              cat.nav.debugStep.blockedAtX = segmentBlock.sampleX;
              cat.nav.debugStep.blockedAtZ = segmentBlock.sampleZ;
            }
            const allowSegmentBlockedRepath =
              ENABLE_SEGMENT_BLOCK_REPATH &&
              canTriggerSegmentBlockedRepath(now, segmentBlock, tempTo, queryY, true);
            if (allowSegmentBlockedRepath) {
              markRepathCause("segment-blocked", {
                ignoreDynamic: !!ignoreDynamic,
                nonFloorSurface: true,
                ...segmentBlock,
              });
              if (withSurfacePathOptions(() => tryEnsurePath(repathState, tempTo, true, !ignoreDynamic, queryY))) {
                bumpDebugCounter("repath");
                recordNavEvent("repath-segment-blocked", { ignoreDynamic: !!ignoreDynamic, nonFloorSurface: true });
                segmentObstacles = getElevatedCollisionObstacles();
                if (cat.nav.path.length > 1) {
                  chase = selectPathChasePoint(tempTo, segmentObstacles, segmentClearance, queryY, lookAheadDistance);
                }
              }
            }
            if (!hasRuntimeClearTravelLine(cat.pos, chase, segmentObstacles, segmentClearance, queryY, elevatedMovementRuntimeOptions)) {
              const rescueChase = findNearestNavigablePoint(
                cat.pos,
                tempTo,
                getElevatedStaticObstacles(),
                segmentObstacles,
                segmentClearance,
                queryY,
                supportSurfaceId,
                elevatedMovementRuntimeOptions
              );
              if (rescueChase) {
                chase = rescueChase;
                bumpDebugCounter("segmentRescue");
                recordNavEvent("segment-blocked-local-rescue", {
                  x: rescueChase.x,
                  z: rescueChase.z,
                  nonFloorSurface: true,
                });
              }
            }
          } else {
            cat.nav.segmentBlockedFrames = 0;
            cat.nav.segmentBlockSignature = "";
            cat.nav.segmentBlockRepathAt = 0;
            cat.nav.debugStep.blockedObstacle = "";
            cat.nav.debugStep.blockedObstacleKind = "";
            cat.nav.debugStep.blockedAtX = NaN;
            cat.nav.debugStep.blockedAtZ = NaN;
          }
        }
      }

      if (cat.nav.path.length <= 1 && !direct) {
        const arrivedWithoutPath = isNearTargetXZ(target) || (tempTo && isNearTargetXZ(tempTo, 0.12));
        if (arrivedWithoutPath) {
          cat.pos.set(target.x, yLevel, target.z);
          cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
          cat.nav.goalChangePendingSince = 0;
          setLocomotionIntent("idle", 0);
          updateDriveSpeed(0, dt);
          clearNavMotionMetrics();
          return true;
        }
        cat.nav.debugStep = {
          phase: "surface",
          reason: "noPath",
          direct,
          ignoreDynamic,
          targetX: target.x,
          targetZ: target.z,
          pathLen: cat.nav.path.length,
          pathIndex: cat.nav.index,
          stuckT: cat.nav.stuckT,
          time: now,
        };
        bumpDebugCounter("noPath");
        recordNavEvent("no-path", { targetX: target.x, targetZ: target.z, nonFloorSurface: true });
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        setLocomotionIntent("idle", 0);
        updateDriveSpeed(0, dt);
        clearNavMotionMetrics();
        return false;
      }
    }

    const dx = chase.x - cat.pos.x;
    const dz = chase.z - cat.pos.z;
    const d = Math.hypot(dx, dz);
    cat.nav.debugStep = {
      phase: yLevel <= 0.02 ? "ground" : "surface",
      reason: "active",
      direct,
      ignoreDynamic,
      targetX: target.x,
      targetY: yLevel,
      targetZ: target.z,
      planTargetX: tempTo.x,
      planTargetZ: tempTo.z,
      chaseX: chase.x,
      chaseY: Number.isFinite(chase.y) ? chase.y : yLevel,
      chaseZ: chase.z,
      distToChase: d,
      pathLen: cat.nav.path.length,
      pathIndex: cat.nav.index,
      stuckT: cat.nav.stuckT,
      turnOnlyT: Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0,
      time: now,
    };
    if (d < 0.06) {
      cat.nav.debugStep.reason = "nearTarget";
      cat.nav.goalChangePendingSince = 0;
      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      setLocomotionIntent("idle", 0);
      updateDriveSpeed(0, dt);
      clearNavMotionMetrics();
      return isNearTargetXZ(target) || (tempTo && isNearTargetXZ(tempTo, 0.12));
    }
    const nx = dx / d;
    const nz = dz / d;
    const yaw = Math.atan2(nx, nz);
    const rawDy = angleDelta(yaw, cat.group.rotation.y);
    const motionPlan = computeSurfaceLocomotionPlan({
      rawYawDelta: rawDy,
      dt,
      distToChase: d,
      distToTarget: cat.pos.distanceTo(target),
      speedRef,
      preferRun,
      now,
      allowRun: true,
    });
    const locomotionClip = motionPlan.locomotionClip;
    const turnOnly = motionPlan.turnOnly;
    const moveSpeed = motionPlan.moveSpeed;
    const step = motionPlan.step;
    cat.nav.commandedSpeed = motionPlan.commandedSpeed;
    cat.nav.debugStep.rawYawDelta = rawDy;
    cat.nav.debugStep.turnOnly = turnOnly;
    cat.nav.debugStep.runLocomotion = !!motionPlan.runActive;

    if (yLevel <= 0.02) {
      if (turnOnly) {
        cat.nav.debugStep.reason = "turnOnly";
        cat.nav.turnOnlyT = (Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0) + dt;
        if (d > 0.35 && Math.abs(rawDy) > 0.9) {
          cat.nav.stuckT += dt * 0.45;
        } else {
          cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.2);
        }
        const now = getClockTime();
        const turnOnlyRepathCooldownUntil = Number.isFinite(cat.nav.turnOnlyRepathCooldownUntil)
          ? cat.nav.turnOnlyRepathCooldownUntil
          : 0;
        const goalRepathCooldownUntil = Number.isFinite(cat.nav.goalRepathCooldownUntil)
          ? cat.nav.goalRepathCooldownUntil
          : 0;
        const turnOnlyHardPressure =
          (cat.nav.segmentBlockedFrames || 0) > 0 ||
          (cat.nav.wholePathBlockedFrames || 0) > 0 ||
          !!cat.nav.staleInvalidFrames ||
          (cat.nav.path.length || 0) <= 1;
        const turnOnlyPathUnstable = turnOnlyHardPressure;
        if (
          turnOnlyPathUnstable &&
          cat.nav.turnOnlyT > 0.7 &&
          d > 0.35 &&
          now >= cat.nav.repathAt &&
          now >= turnOnlyRepathCooldownUntil &&
          now >= goalRepathCooldownUntil
        ) {
          markRepathCause("turn-only", { ignoreDynamic: !!ignoreDynamic });
          if (tryEnsurePath(repathState, target, true, !ignoreDynamic)) {
            cat.nav.repathAt = now + CAT_NAV.repathInterval * 0.8;
            cat.nav.turnOnlyRepathCooldownUntil = now + 0.8;
            bumpDebugCounter("turnOnlyRepath");
            bumpDebugCounter("repath");
            recordNavEvent("repath-turnonly", {
              d,
              rawYawDelta: rawDy,
              ignoreDynamic: !!ignoreDynamic,
            });
            cat.nav.turnOnlyT = 0;
          }
        }
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        cat.nav.lastSpeed = 0;
        cat.nav.smoothedSpeed = 0;
        cat.nav.speedNorm = 0;
        return false;
      }
      cat.nav.turnOnlyT = 0;
      const staticClearance = getCatPathClearance();
      const staticObstacles = getGroundStaticObstacles();
      const dynamicObstacles = getGroundCollisionObstacles();
      const posBlockedStatic = isCatPointBlocked(cat.pos.x, cat.pos.z, staticObstacles, staticClearance * 0.98, 0, "collision");
      const posBlockedDynamic = !ignoreDynamic && isCatPointBlocked(cat.pos.x, cat.pos.z, dynamicObstacles, staticClearance * 0.98, 0, "collision");
      cat.nav.debugStep.posBlockedStatic = posBlockedStatic;
      cat.nav.debugStep.posBlockedDynamic = posBlockedDynamic;
      cat.nav.debugStep.posStaticObstacle = "";
      cat.nav.debugStep.posDynamicObstacle = "";
      cat.nav.debugStep.targetStaticObstacle = "";
      cat.nav.debugStep.targetDynamicObstacle = "";
      cat.nav.debugStep.lineStaticObstacle = "";
      cat.nav.debugStep.lineDynamicObstacle = "";
      cat.nav.debugStep.softPosObstacle = "";
      cat.nav.debugStep.softTargetObstacle = "";
      cat.nav.debugStep.softPosScore = 0;
      cat.nav.debugStep.softTargetScore = 0;
      if (posBlockedStatic || posBlockedDynamic) {
        const posStaticBlock = posBlockedStatic
          ? findBlockingObstacleAtPoint(staticObstacles, cat.pos.x, cat.pos.z, staticClearance * 0.98, 0, null)
          : null;
        const posDynamicBlock = posBlockedDynamic
          ? findBlockingObstacleAtPoint(dynamicObstacles, cat.pos.x, cat.pos.z, staticClearance * 0.98, 0, null)
          : null;
        cat.nav.debugStep.posStaticObstacle = posStaticBlock?.obstacleLabel || "";
        cat.nav.debugStep.posDynamicObstacle = posDynamicBlock?.obstacleLabel || "";
        if (isRunClip(locomotionClip)) triggerRunCooldown(now, 1.1);
        const rescued = findNearestNavigablePoint(cat.pos, chase, staticObstacles, dynamicObstacles, staticClearance);
        if (rescued) {
          cat.pos.copy(rescued);
          cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
          cat.nav.stuckT = 0;
          cat.nav.noSteerFrames = 0;
          markRepathCause("blocked-position-rescue", { ignoreDynamic: !!ignoreDynamic });
          if (tryEnsurePath(repathState, target, true, !ignoreDynamic)) {
            cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.6;
            bumpDebugCounter("rescueSnap");
            recordNavEvent("rescue-from-blocked-pos", { x: rescued.x, z: rescued.z });
          }
          applyTrapRecoveryHold(now);
          return false;
        }
      }
      cat.nav.debugStep.overlapDynamic = sampleObstacleOverlapScore(cat.pos.x, cat.pos.z, dynamicObstacles, staticClearance);
      cat.nav.debugStep.overlapStatic = sampleObstacleOverlapScore(cat.pos.x, cat.pos.z, staticObstacles, staticClearance);
      const steerTarget = chase;
      let steerStepBase = step;
      let steer = chooseGroundSteer(steerTarget, steerStepBase, staticObstacles, dynamicObstacles, ignoreDynamic);
      if (!steer && step > 0.015) {
        const stepScales = [0.75, 0.55, 0.38, 0.25];
        for (let i = 0; i < stepScales.length && !steer; i++) {
          const testStep = Math.max(0.015, step * stepScales[i]);
          steer = chooseGroundSteer(steerTarget, testStep, staticObstacles, dynamicObstacles, ignoreDynamic);
          if (steer) steerStepBase = testStep;
        }
      }
      if (!steer) {
        const targetStaticBlock = findBlockingObstacleAtPoint(
          staticObstacles,
          steerTarget.x,
          steerTarget.z,
          staticClearance,
          0,
          null
        );
        const targetDynamicBlock = !ignoreDynamic
          ? findBlockingObstacleAtPoint(
              dynamicObstacles,
              steerTarget.x,
              steerTarget.z,
              staticClearance,
              0,
              null
            )
          : null;
        const lineStaticBlock = findFirstBlockingOnLine(cat.pos, steerTarget, staticObstacles, staticClearance, 0, null);
        const lineDynamicBlock = !ignoreDynamic
          ? findFirstBlockingOnLine(cat.pos, steerTarget, dynamicObstacles, staticClearance, 0, null)
          : null;
        const softPos = !ignoreDynamic
          ? findDominantSoftishObstacle(cat.pos.x, cat.pos.z, dynamicObstacles, staticClearance, null)
          : null;
        const softTarget = !ignoreDynamic
          ? findDominantSoftishObstacle(steerTarget.x, steerTarget.z, dynamicObstacles, staticClearance, null)
          : null;
        cat.nav.debugStep.posStaticObstacle = cat.nav.debugStep.posStaticObstacle || targetStaticBlock?.obstacleLabel || "";
        cat.nav.debugStep.posDynamicObstacle = cat.nav.debugStep.posDynamicObstacle || "";
        cat.nav.debugStep.targetStaticObstacle = targetStaticBlock?.obstacleLabel || "";
        cat.nav.debugStep.targetDynamicObstacle = targetDynamicBlock?.obstacleLabel || "";
        cat.nav.debugStep.lineStaticObstacle = lineStaticBlock?.obstacleLabel || "";
        cat.nav.debugStep.lineDynamicObstacle = lineDynamicBlock?.obstacleLabel || "";
        cat.nav.debugStep.softPosObstacle = softPos?.obstacleLabel || "";
        cat.nav.debugStep.softTargetObstacle = softTarget?.obstacleLabel || "";
        cat.nav.debugStep.softPosScore = softPos?.score || 0;
        cat.nav.debugStep.softTargetScore = softTarget?.score || 0;
        const escape = chooseGroundEscapeStep(steerTarget, step, staticObstacles, dynamicObstacles, staticClearance);
        if (escape) {
          cat.nav.debugStep.reason = "escapeStep";
          tempFrom.copy(cat.pos);
          cat.pos.x += escape.sx * escape.step;
          cat.pos.z += escape.sz * escape.step;
          if (isCatPointBlocked(cat.pos.x, cat.pos.z, staticObstacles, staticClearance * 0.98, 0, "collision")) {
            cat.pos.copy(tempFrom);
            bumpDebugCounter("rollback");
            recordNavEvent("escape-rollback");
          } else {
            cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
            cat.nav.steerYaw = escape.yaw;
            rotateCatToward(escape.yaw, dt);
            const moved = cat.pos.distanceTo(tempFrom);
            setLocomotionIntent("walkF", 0.7);
            updateDriveSpeed(Math.max(0.15, speedRef * 0.45), dt);
            setNavMotionMetrics(moved, dt, Math.max(0.05, cat.nav.commandedSpeed));
            noteActiveRouteSegmentProgress(tempFrom, moved, escape.step, steerTarget, target);
            cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.25);
            cat.nav.noSteerFrames = 0;
            bumpDebugCounter("escape");
            recordNavEvent("escape-step", { moved });
            return false;
          }
        }
        if (isRunClip(locomotionClip)) triggerRunCooldown(now, 1.1);
        cat.nav.debugStep.reason = "noSteer";
        cat.nav.debugStep.overlapDynamic = sampleObstacleOverlapScore(cat.pos.x, cat.pos.z, dynamicObstacles, staticClearance);
        setLocomotionIntent("idle", 0);
        updateDriveSpeed(0, dt);
        cat.nav.stuckT += dt;
        cat.nav.noSteerFrames = (cat.nav.noSteerFrames || 0) + 1;
        cat.nav.debugStep.noSteerFrames = cat.nav.noSteerFrames;
        bumpDebugCounter("noSteer");
        const now = getClockTime();
        const shouldForceRepath = cat.nav.noSteerFrames >= 5 || cat.nav.stuckT > 0.16;
        if ((cat.nav.stuckT > 0.1 || shouldForceRepath) && now >= cat.nav.repathAt) {
          markRepathCause("stuck", { ignoreDynamic: !!ignoreDynamic, noSteerFrames: cat.nav.noSteerFrames });
          if (tryEnsurePath(repathState, target, true, !ignoreDynamic)) {
            cat.nav.repathAt = now + CAT_NAV.repathInterval * (shouldForceRepath ? 0.55 : 0.9);
            bumpDebugCounter("repath");
            recordNavEvent("repath-stuck", {
              ignoreDynamic: !!ignoreDynamic,
              stuckT: cat.nav.stuckT,
              noSteerFrames: cat.nav.noSteerFrames,
            });
          }
        }
        if (cat.nav.stuckT > 0.14 || cat.nav.noSteerFrames > 1) {
          const rescued = findNearestNavigablePoint(cat.pos, steerTarget, staticObstacles, dynamicObstacles, staticClearance);
          if (rescued) {
            cat.pos.copy(rescued);
            cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
            cat.nav.stuckT = 0;
            cat.nav.noSteerFrames = 0;
            markRepathCause("rescue-snap", { ignoreDynamic: !!ignoreDynamic });
            if (tryEnsurePath(repathState, target, true, !ignoreDynamic)) {
              cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.6;
              bumpDebugCounter("rescueSnap");
              recordNavEvent("rescue-snap", { x: rescued.x, z: rescued.z });
            }
            applyTrapRecoveryHold(now);
          } else {
            clearCatNavPath(false);
            recordNavEvent("clear-path-no-rescue");
          }
        }
        return false;
      }

      tempFrom.copy(cat.pos);
      const facingDelta = Math.abs(
        Math.atan2(Math.sin(steer.yaw - cat.group.rotation.y), Math.cos(steer.yaw - cat.group.rotation.y))
      );
      const facing01 = THREE.MathUtils.clamp(1 - facingDelta / 1.45, 0, 1);
      const forwardScale = THREE.MathUtils.clamp(facing01 * facing01, 0.04, 1);
      const steerStep = steerStepBase * forwardScale;
      cat.pos.x += steer.sx * steerStep;
      cat.pos.z += steer.sz * steerStep;

      const collisionObstacles = ignoreDynamic ? staticObstacles : dynamicObstacles;
      const collisionClearance = getCatPathClearance();
      if (isCatPointBlocked(cat.pos.x, cat.pos.z, collisionObstacles, collisionClearance * 0.98, 0, "collision")) {
        if (isRunClip(locomotionClip)) triggerRunCooldown(now, 1.15);
        cat.nav.debugStep.reason = "rollback-blocked";
        cat.pos.copy(tempFrom);
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        setLocomotionIntent("idle", 0);
        updateDriveSpeed(0, dt);
        clearNavMotionMetrics();
        cat.nav.stuckT += dt;
        bumpDebugCounter("rollback");
        if (getClockTime() >= cat.nav.repathAt) {
          markRepathCause("rollback-blocked", { ignoreDynamic: !!ignoreDynamic });
          if (tryEnsurePath(repathState, target, true, !ignoreDynamic)) {
            cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
            bumpDebugCounter("repath");
            recordNavEvent("repath-rollback", { ignoreDynamic: !!ignoreDynamic, stuckT: cat.nav.stuckT });
          }
        }
        return false;
      }

      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      cat.nav.steerYaw = steer.yaw;

      const moved = cat.pos.distanceTo(tempFrom);
      const progressThreshold = getSharedProgressThreshold(step);
      const meaningfulProgress = noteActiveRouteSegmentProgress(tempFrom, moved, step, chase, target);
      if (moved > progressThreshold || meaningfulProgress) cat.nav.noSteerFrames = 0;
      const movingExpected = moveSpeed > CAT_NAV.stuckSpeed * 1.5;
      if (movingExpected && moved < CAT_NAV.stuckSpeed * dt && d > 0.18) {
        cat.nav.stuckT += dt;
        if (isRunClip(locomotionClip) && cat.nav.stuckT > 0.08) {
          triggerRunCooldown(now, 1.0);
        }
        if (cat.nav.stuckT > 0.36 && getClockTime() >= cat.nav.repathAt) {
          markRepathCause("dynamic-overlap-stall", { ignoreDynamic: !!ignoreDynamic });
          if (tryEnsurePath(repathState, target, true, !ignoreDynamic)) {
            cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
          }
        }
      } else {
        cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.9);
      }
      setNavMotionMetrics(moved, dt, Math.max(0.05, cat.nav.commandedSpeed));
      return isNearTargetXZ(target);
    }

    if (yLevel > 0.02 && turnOnly) {
      cat.nav.debugStep.reason = "turnOnly";
      cat.nav.turnOnlyT = (Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0) + dt;
      if (d > 0.35 && Math.abs(rawDy) > 0.9) {
        cat.nav.stuckT += dt * 0.45;
      } else {
        cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.2);
      }
      const turnOnlyRepathCooldownUntil = Number.isFinite(cat.nav.turnOnlyRepathCooldownUntil)
        ? cat.nav.turnOnlyRepathCooldownUntil
        : 0;
      const goalRepathCooldownUntil = Number.isFinite(cat.nav.goalRepathCooldownUntil)
        ? cat.nav.goalRepathCooldownUntil
        : 0;
      const turnOnlyHardPressure =
        (cat.nav.segmentBlockedFrames || 0) > 0 ||
        (cat.nav.wholePathBlockedFrames || 0) > 0 ||
        !!cat.nav.staleInvalidFrames ||
        (cat.nav.path.length || 0) <= 1;
      const segmentInfo = getRouteSegmentProgressInfo(now);
      if (
        turnOnlyHardPressure &&
        cat.nav.turnOnlyT > 0.82 &&
        d > 0.35 &&
        (!segmentInfo || segmentInfo.age >= 0.28 || segmentInfo.idleFor >= 0.24) &&
        now >= cat.nav.repathAt &&
        now >= turnOnlyRepathCooldownUntil &&
        now >= goalRepathCooldownUntil
      ) {
        markRepathCause("turn-only", { ignoreDynamic: !!ignoreDynamic, nonFloorSurface: true });
        if (withSurfacePathOptions(() => tryEnsurePath(repathState, tempTo, true, !ignoreDynamic, Math.max(0.02, yLevel)))) {
          cat.nav.repathAt = now + CAT_NAV.repathInterval * 0.8;
          cat.nav.turnOnlyRepathCooldownUntil = now + 0.8;
          bumpDebugCounter("turnOnlyRepath");
          bumpDebugCounter("repath");
          recordNavEvent("repath-turnonly", {
            d,
            rawYawDelta: rawDy,
            ignoreDynamic: !!ignoreDynamic,
            nonFloorSurface: true,
          });
          cat.nav.turnOnlyT = 0;
        }
      }
      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      cat.nav.lastSpeed = 0;
      cat.nav.smoothedSpeed = 0;
      cat.nav.speedNorm = 0;
      setNavMotionMetrics(0, dt, Math.max(0.05, cat.nav.commandedSpeed));
      return false;
    }
    if (yLevel > 0.02) {
      cat.nav.turnOnlyT = 0;
    }

    tempFrom.copy(cat.pos);
    if (direct || !Array.isArray(cat.nav.path) || cat.nav.path.length <= 1) {
      cat.nav.path = [
        new THREE.Vector3(cat.pos.x, yLevel, cat.pos.z),
        new THREE.Vector3(tempTo.x, yLevel, tempTo.z),
      ];
      cat.nav.index = 1;
    }
    const queryY = Math.max(0.02, yLevel);
    const staticClearance = getCatPathClearance();
    const staticObstacles = getElevatedStaticObstacles();
    const dynamicObstacles = getElevatedCollisionObstacles();
    const elevatedRuntimeOptions = {
      avoidSoftRuntime: true,
      supportSurfaceId: supportSurfaceId || "",
      queryY,
    };
    const elevatedMovementRuntimeOptions = {
      ...elevatedRuntimeOptions,
      allowPushablePass: true,
    };
    const collisionObstacles = dynamicObstacles;
    const supportMargin = CAT_COLLISION.catBodyRadius + 0.005;

    const rawTargetX = tempTo.x;
    const rawTargetZ = tempTo.z;
    const resolvedTarget = findNearestSupportedElevatedTarget(
      tempTo,
      staticObstacles,
      dynamicObstacles,
      staticClearance,
      queryY,
      supportSurfaceId,
      !!ignoreDynamic,
      elevatedRuntimeOptions
    );
    if (resolvedTarget) {
      tempTo.copy(resolvedTarget);
      if (Array.isArray(cat.nav.path) && cat.nav.path.length > 0) {
        const lastIdx = cat.nav.path.length - 1;
        if (cat.nav.path[lastIdx] && typeof cat.nav.path[lastIdx].copy === "function") {
          cat.nav.path[lastIdx].copy(tempTo);
        }
      }
    }
    cat.nav.debugStep.supportSurfaceId = supportSurfaceId || "";
    cat.nav.debugStep.rawTargetX = rawTargetX;
    cat.nav.debugStep.rawTargetZ = rawTargetZ;
    cat.nav.debugStep.resolvedTargetX = tempTo.x;
    cat.nav.debugStep.resolvedTargetZ = tempTo.z;
    cat.nav.debugStep.targetSnapDist = Math.hypot(tempTo.x - rawTargetX, tempTo.z - rawTargetZ);
    cat.nav.debugStep.elevatedSoftAvoidance = true;

    const supportedNow = nearestSupportedElevatedPoint(
      cat.pos.x,
      cat.pos.z,
      yLevel,
      supportMargin,
      supportSurfaceId
    );
    if (supportedNow && ((supportedNow.x - cat.pos.x) ** 2 + (supportedNow.z - cat.pos.z) ** 2) > 0.0016) {
      cat.pos.x = supportedNow.x;
      cat.pos.z = supportedNow.z;
    }

    const posBlocked = isCatPointBlocked(cat.pos.x, cat.pos.z, collisionObstacles, staticClearance * 0.98, queryY, "collision");
    if (posBlocked) {
      const rescued = findNearestNavigablePoint(
        cat.pos,
        chase,
        staticObstacles,
        dynamicObstacles,
        staticClearance,
        queryY,
        supportSurfaceId,
        elevatedMovementRuntimeOptions
      );
      if (rescued) {
        cat.pos.copy(rescued);
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        cat.nav.stuckT = 0;
        cat.nav.noSteerFrames = 0;
        markRepathCause("blocked-position-rescue", { ignoreDynamic: !!ignoreDynamic, nonFloorSurface: true });
        if (withSurfacePathOptions(() => tryEnsurePath(repathState, tempTo, true, !ignoreDynamic, queryY))) {
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.45;
          bumpDebugCounter("rescueSnap");
          recordNavEvent("rescue-from-blocked-pos", { x: rescued.x, z: rescued.z, y: queryY, nonFloorSurface: true });
        }
        applyTrapRecoveryHold(now);
      }
      return false;
    }

    const probeStepBase = Math.max(step * 1.35, 0.02);
    let steerStepBase = step;
    let steer = chooseGroundSteer(
      chase,
      probeStepBase,
      staticObstacles,
      dynamicObstacles,
      ignoreDynamic,
      queryY,
      supportSurfaceId,
      elevatedMovementRuntimeOptions
    );
    if (steer) {
      steerStepBase = step;
    }
    if (!steer) {
      const probeSteps = [Math.max(step * 1.1, 0.02), Math.max(step * 0.75, 0.016), Math.max(step * 0.5, 0.012), Math.max(step * 0.3, 0.009)];
      for (let i = 0; i < probeSteps.length && !steer; i++) {
        const testStep = probeSteps[i];
        steer = chooseGroundSteer(
          chase,
          testStep,
          staticObstacles,
          dynamicObstacles,
          ignoreDynamic,
          queryY,
          supportSurfaceId,
          elevatedMovementRuntimeOptions
        );
        if (steer) steerStepBase = Math.max(step, Math.min(testStep, 0.024));
      }
    }

    if (!steer) {
      const rescuePoint = findNearestNavigablePoint(
        cat.pos,
        tempTo,
        staticObstacles,
        dynamicObstacles,
        staticClearance,
        queryY,
        supportSurfaceId,
        elevatedMovementRuntimeOptions
      );
      if (rescuePoint) {
        const rescueDist2 = (rescuePoint.x - cat.pos.x) * (rescuePoint.x - cat.pos.x) + (rescuePoint.z - cat.pos.z) * (rescuePoint.z - cat.pos.z);
        if (rescueDist2 > 0.03 * 0.03) {
          const rescueTarget = new THREE.Vector3(rescuePoint.x, queryY, rescuePoint.z);
          const rescueProbeBase = Math.max(step, 0.035);
          steer = chooseGroundSteer(
            rescueTarget,
            rescueProbeBase,
            staticObstacles,
            dynamicObstacles,
            ignoreDynamic,
            queryY,
            supportSurfaceId,
            elevatedMovementRuntimeOptions
          );
          if (steer) {
            steerStepBase = Math.max(step, Math.min(rescueProbeBase, 0.024));
          }
          if (!steer) {
            const probeSteps = [Math.max(step * 0.75, 0.028), Math.max(step * 0.55, 0.022), Math.max(step * 0.38, 0.018), Math.max(step * 0.25, 0.015)];
            for (let i = 0; i < probeSteps.length && !steer; i++) {
              const testStep = probeSteps[i];
              steer = chooseGroundSteer(
                rescueTarget,
                testStep,
                staticObstacles,
                dynamicObstacles,
                ignoreDynamic,
                queryY,
                supportSurfaceId,
                elevatedMovementRuntimeOptions
              );
              if (steer) steerStepBase = Math.max(step, Math.min(testStep, 0.024));
            }
          }
          if (steer) {
            chase = rescueTarget;
            cat.nav.path = [
              new THREE.Vector3(cat.pos.x, yLevel, cat.pos.z),
              rescueTarget.clone(),
              tempTo.clone(),
            ];
            cat.nav.index = 1;
            cat.nav.debugStep.reason = "surface-local-rescue";
            recordNavEvent("surface-local-rescue", {
              x: rescueTarget.x,
              z: rescueTarget.z,
              targetX: tempTo.x,
              targetZ: tempTo.z,
              supportSurfaceId,
            });
          }
        }
      }
    }

    if (!steer) {
      const escape = chooseGroundEscapeStep(
        chase,
        Math.max(step, 0.03),
        staticObstacles,
        dynamicObstacles,
        staticClearance,
        queryY,
        supportSurfaceId,
        elevatedRuntimeOptions
      );
      if (escape) {
        cat.nav.debugStep.reason = "escapeStep";
        tempFrom.copy(cat.pos);
        cat.pos.x += escape.sx * escape.step;
        cat.pos.z += escape.sz * escape.step;
        if (isCatPointBlocked(cat.pos.x, cat.pos.z, collisionObstacles, staticClearance * 0.98, queryY, "collision")) {
          cat.pos.copy(tempFrom);
          bumpDebugCounter("rollback");
          recordNavEvent("escape-rollback");
        } else {
          const supported = nearestSupportedElevatedPoint(
            cat.pos.x,
            cat.pos.z,
            yLevel,
            supportMargin,
            supportSurfaceId
          );
          if (supported) {
            cat.pos.x = supported.x;
            cat.pos.z = supported.z;
          }
          cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
          cat.nav.steerYaw = escape.yaw;
          rotateCatToward(escape.yaw, dt);
          const moved = cat.pos.distanceTo(tempFrom);
          setLocomotionIntent("walkF", 0.7);
          updateDriveSpeed(Math.max(0.15, speedRef * 0.45), dt);
          setNavMotionMetrics(moved, dt, Math.max(0.05, cat.nav.commandedSpeed));
          noteActiveRouteSegmentProgress(tempFrom, moved, escape.step, chase, target);
          cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.25);
          cat.nav.noSteerFrames = 0;
          bumpDebugCounter("escape");
          recordNavEvent("escape-step", { moved, nonFloorSurface: true });
          return false;
        }
      }

      cat.nav.debugStep.reason = "surface-noStep";
      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      setLocomotionIntent("idle", 0);
      updateDriveSpeed(0, dt);
      clearNavMotionMetrics();
      cat.nav.stuckT += dt * 0.28;
      cat.nav.noSteerFrames = (cat.nav.noSteerFrames || 0) + 1;
      const elevatedHardPressure =
        (cat.nav.segmentBlockedFrames || 0) > 0 ||
        (cat.nav.wholePathBlockedFrames || 0) > 0 ||
        !!cat.nav.staleInvalidFrames ||
        (cat.nav.path.length || 0) <= 1;
      const segmentInfo = getRouteSegmentProgressInfo(getClockTime());
      const shouldRepathNoStep =
        elevatedHardPressure &&
        (!segmentInfo || (segmentInfo.age >= 0.28 && (segmentInfo.idleFor >= 0.24 || (cat.nav.noSteerFrames || 0) >= 4)));
      if (shouldRepathNoStep && getClockTime() >= cat.nav.repathAt) {
        if (withSurfacePathOptions(() => tryEnsurePath(repathState, tempTo, true, !ignoreDynamic, queryY))) {
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.62;
          bumpDebugCounter("repath");
          recordNavEvent("repath-surface-nostep", { ignoreDynamic: !!ignoreDynamic, y: yLevel });
        }
      }
      return false;
    }

    tempFrom.copy(cat.pos);
    const facingDelta = Math.abs(
      Math.atan2(Math.sin(steer.yaw - cat.group.rotation.y), Math.cos(steer.yaw - cat.group.rotation.y))
    );
    const facing01 = THREE.MathUtils.clamp(1 - facingDelta / 1.45, 0, 1);
    const forwardScale = THREE.MathUtils.clamp(facing01 * facing01, 0.04, 1);
    const steerStep = steerStepBase * forwardScale;
    cat.pos.x += steer.sx * steerStep;
    cat.pos.z += steer.sz * steerStep;
    const supported = nearestSupportedElevatedPoint(
      cat.pos.x,
      cat.pos.z,
      yLevel,
      supportMargin,
      supportSurfaceId
    );
    if (supported) {
      cat.pos.x = supported.x;
      cat.pos.z = supported.z;
    }

    if (isCatPointBlocked(cat.pos.x, cat.pos.z, collisionObstacles, staticClearance * 0.98, queryY, "collision")) {
      cat.nav.debugStep.reason = "rollback-blocked";
      cat.pos.copy(tempFrom);
      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      setLocomotionIntent("idle", 0);
      updateDriveSpeed(0, dt);
      clearNavMotionMetrics();
      cat.nav.stuckT += dt;
      bumpDebugCounter("rollback");
      if (getClockTime() >= cat.nav.repathAt) {
        markRepathCause("rollback-blocked", { ignoreDynamic: !!ignoreDynamic, nonFloorSurface: true });
        if (withSurfacePathOptions(() => tryEnsurePath(repathState, tempTo, true, !ignoreDynamic, queryY))) {
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.5;
          bumpDebugCounter("repath");
          recordNavEvent("repath-rollback", { ignoreDynamic: !!ignoreDynamic, nonFloorSurface: true, stuckT: cat.nav.stuckT });
        }
      }
      return false;
    }

    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    cat.nav.steerYaw = steer.yaw;
    rotateCatToward(steer.yaw, dt);
    const moved = cat.pos.distanceTo(tempFrom);
    const nowElevated = getClockTime();
    const progressThreshold = getSharedProgressThreshold(step);
    const meaningfulProgress = noteActiveRouteSegmentProgress(tempFrom, moved, step, chase, target);
    if (moved > progressThreshold || meaningfulProgress) {
      cat.nav.noSteerFrames = 0;
      cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.58);
    } else {
      cat.nav.noSteerFrames = (cat.nav.noSteerFrames || 0) + 1;
      cat.nav.stuckT += dt * 0.24;
      if ((cat.nav.noSteerFrames || 0) >= 4 && !isNearTargetXZ(target, 0.2)) {
        cat.nav.debugStep.reason = "surface-noProgress";
        setLocomotionIntent("walkF", 0.55);
        updateDriveSpeed(Math.max(0.08, speedRef * 0.22), dt);
      }
      const elevatedHardPressure =
        (cat.nav.segmentBlockedFrames || 0) > 0 ||
        (cat.nav.wholePathBlockedFrames || 0) > 0 ||
        !!cat.nav.staleInvalidFrames ||
        (cat.nav.path.length || 0) <= 1;
      const segmentInfo = getRouteSegmentProgressInfo(nowElevated);
      const shouldForceRepath =
        elevatedHardPressure &&
        (!segmentInfo || (segmentInfo.age >= 0.34 && segmentInfo.idleFor >= 0.3)) &&
        ((cat.nav.noSteerFrames || 0) >= 8 ||
        (cat.nav.stuckT || 0) > 0.62);
      if (shouldForceRepath && nowElevated >= cat.nav.repathAt) {
        markRepathCause("surface-no-progress", {
          ignoreDynamic: !!ignoreDynamic,
          moved,
          y: queryY,
          noSteerFrames: cat.nav.noSteerFrames || 0,
          segmentIdleFor: segmentInfo?.idleFor,
        });
        if (withSurfacePathOptions(() => tryEnsurePath(repathState, tempTo, true, !ignoreDynamic, queryY))) {
          cat.nav.repathAt = nowElevated + CAT_NAV.repathInterval * 0.88;
          bumpDebugCounter("repath");
          recordNavEvent("repath-surface-no-progress", {
            ignoreDynamic: !!ignoreDynamic,
            moved,
            y: queryY,
            noSteerFrames: cat.nav.noSteerFrames || 0,
            segmentIdleFor: segmentInfo?.idleFor,
          });
        }
      }
    }
    setNavMotionMetrics(moved, dt, Math.max(0.05, cat.nav.commandedSpeed));
    const doneDx = target.x - cat.pos.x;
    const doneDz = target.z - cat.pos.z;
    if (doneDx * doneDx + doneDz * doneDz < 0.14 * 0.14) return true;
    return tempTo && isNearTargetXZ(tempTo, 0.12);
  }

  function findSafeGroundPoint(preferred) {
    const obstacles = buildCatObstacles(true);
    const clearance = getCatPathClearance();
    if (!isCatPointBlocked(preferred.x, preferred.z, obstacles, clearance)) {
      return preferred.clone();
    }

    let best = null;
    let bestD = Infinity;
    for (let r = 0.36; r <= 2.4; r += 0.24) {
      const steps = Math.max(8, Math.floor(r * 16));
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const x = preferred.x + Math.cos(t) * r;
        const z = preferred.z + Math.sin(t) * r;
        if (isCatPointBlocked(x, z, obstacles, clearance)) continue;
        const d = (x - preferred.x) * (x - preferred.x) + (z - preferred.z) * (z - preferred.z);
        if (d < bestD) {
          bestD = d;
          if (!best) best = new THREE.Vector3();
          best.set(x, 0, z);
        }
      }
      if (best) break;
    }
    return best || preferred.clone();
  }

  function pickRandomPatrolPoint(from = cat.pos, allowFallback = true) {
    const obstacles = buildCatObstacles(true, true);
    const clearance = getCatPathClearance();
    const fromGround =
      catHasNonFloorSurface(cat)
        ? findSafeGroundPoint(new THREE.Vector3(from.x, 0, from.z))
        : from;
    const minX = ROOM.minX + CAT_NAV.margin + 0.12;
    const maxX = ROOM.maxX - CAT_NAV.margin - 0.12;
    const minZ = ROOM.minZ + CAT_NAV.margin + 0.12;
    const maxZ = ROOM.maxZ - CAT_NAV.margin - 0.12;

    let pathChecks = 0;
    for (let i = 0; i < 48; i++) {
      const x = THREE.MathUtils.lerp(minX, maxX, Math.random());
      const z = THREE.MathUtils.lerp(minZ, maxZ, Math.random());
      if (isCatPointBlocked(x, z, obstacles, clearance)) continue;
      const candidate = new THREE.Vector3(x, 0, z);
      if (candidate.distanceToSquared(fromGround) < 0.65 * 0.65) continue;
      // Fast-path: if direct travel line is clear, skip heavier global path query.
      if (hasClearTravelLine(fromGround, candidate, obstacles, clearance)) return candidate;
      // Throttle expensive full-route checks to reduce spikes on state transitions.
      if (i % 4 !== 0 || pathChecks >= 6) continue;
      pathChecks++;
      if (!canReachGroundTarget(fromGround, candidate, obstacles)) continue;
      return candidate;
    }

    if (!allowFallback) return null;
    return findSafeGroundPoint(fromGround.clone());
  }

  function sampleSwipePose(t) {
    const w = SWIPE_TIMING.windup;
    const s = SWIPE_TIMING.strike;
    const r = Math.max(0.01, SWIPE_TIMING.recover);
    const ws = w;
    const ss = w + s;
    const rs = w + s + r;

    const pose = {
      lift: 0,
      reach: 0,
      lean: 0,
      hit: false,
      done: false,
    };

    if (t < ws) {
      const u = THREE.MathUtils.smootherstep(t / Math.max(ws, 1e-5), 0, 1);
      pose.lift = u;
      pose.reach = -0.24 * u;
      pose.lean = 0.18 * u;
      return pose;
    }

    if (t < ss) {
      const u = THREE.MathUtils.smootherstep((t - ws) / Math.max(s, 1e-5), 0, 1);
      pose.lift = 1.0 - u * 0.58;
      pose.reach = -0.24 + u * 1.22;
      pose.lean = 0.18 - u * 0.34;
      pose.hit = u >= 0.55;
      return pose;
    }

    if (t < rs) {
      const u = THREE.MathUtils.smootherstep((t - ss) / Math.max(r, 1e-5), 0, 1);
      pose.lift = 0.42 * (1 - u);
      pose.reach = 0.98 - u * 0.76;
      pose.lean = -0.16 * (1 - u);
      return pose;
    }

    pose.done = true;
    return pose;
  }

  return {
    moveCatToward,
    findSafeGroundPoint,
    pickRandomPatrolPoint,
    sampleSwipePose,
  };
}
