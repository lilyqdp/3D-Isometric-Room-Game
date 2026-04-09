import { animateCatPoseRuntime } from "./cat-animation.js";
import { computeCupSwipePlan } from "./cat-plans.js";
import { createCatStateMachineDeskRuntime } from "./cat-state-machine-desk.js";
import { createCatStateMachineGroundBypassRuntime } from "./cat-state-machine-ground-bypass.js";
import { createCatStateMachineUtilsRuntime } from "./cat-state-machine-utils.js";
import { FLOOR_SURFACE_ID, catHasFloorContact, catHasNonFloorSurface, isFloorSurfaceId, isNonFloorSurfaceId, normalizeSurfaceId, setCatSurfaceId, targetSurfaceId } from "./surface-ids.js";
import { clampPointToSurfaceXZ, getSurfaceArea, getSurfaceCenter, samplePointOnSurfaceXZ } from "./surface-shapes.js";

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
    clearActiveJump,
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
    findSurfacePath,
    computeDeskJumpTargets,
    computeSurfaceJumpTargets,
    computeSurfaceJumpDownTargets,
    getSurfaceDefs,
    getSurfaceById,
    sampleSwipePose,
    knockCup,
    resetCatUnstuckTracking,
    clearCatClipSpecialPose,
    windowSill,
    recordFunctionTrace,
  } = ctx;

  const animateCatPose = (stepDt, moving) => animateCatPoseRuntime(ctx, stepDt, moving);
  const GROUND_MOVE_SPEED = 0.95;
  const CATNIP_ABORT_BLOCKED_GRACE = 0.45;
  const CATNIP_CUP_SUPPRESS = 2.4;
  const CATNIP_RECOVER_DUR = 1.14;
  const CATNIP_IDLE_BLEND_DUR = 0.2;
  const PATROL_NO_ROUTE_CONFIRM = 2;
  const WINDOW_NO_ROUTE_CONFIRM = 3;
  const ROUTE_BLOCK_CONFIRM = 0.28;
  const ROUTE_STUCK_CONFIRM = 0.38;
  const ROUTE_MIN_LIFETIME = 0.42;
  const HOP_PLAN_REQUEST_COOLDOWN = 0.24;
  const ARRIVAL_SNAP_RADIUS_BASE = 0.13;
  const ARRIVAL_SNAP_RADIUS_BONUS = 0.035;
  const ARRIVAL_SNAP_RADIUS_MAX = 0.18;
  const ARRIVAL_SNAP_Y_ELEVATED = 0.14;
  const ROUTE_FINISH_SETTLE = 0.14;
  const WINDOW_SIT_NUDGE_MAX = 0.07;
  const REACHABILITY_CACHE_TTL = 0.36;
  const REACHABILITY_CACHE_QUANTUM = 0.12;
  const NAV_REACHABILITY_OPTIONS = Object.freeze({ allowFallback: false });
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
    getNonFloorSurfaceById,
    getCurrentCatSurfaceId,
    setAuthoritativeCatSurfaceId,
    recordSurfaceHop,
    setJumpDownDebug,
    getAvoidSurfaceIdsForHop,
    clearCatnipApproachLock,
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
    getSurfaceDefs,
    getSurfaceById,
    catnipMouthOffset: 0.34,
    recordFunctionTrace,
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

  function getTrackedCatSurfaceId(fallback = FLOOR_SURFACE_ID) {
    return normalizeSurfaceId(cat.nav?.surfaceState?.currentSurfaceId || fallback);
  }

  function traceFunction(name, details = "") {
    if (typeof recordFunctionTrace === "function") {
      recordFunctionTrace(name, details);
    }
  }

  function ensureManualHoldPoint() {
    if (!cat.nav.manualHoldPoint || typeof cat.nav.manualHoldPoint.set !== "function") {
      cat.nav.manualHoldPoint = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    return cat.nav.manualHoldPoint;
  }

  function clearManualHoldState() {
    cat.nav.manualHoldSurfaceId = "";
    cat.nav.manualHoldY = 0;
    ensureManualHoldPoint().set(cat.pos.x, 0, cat.pos.z);
  }

  function setManualHoldState(surfaceId, point, y) {
    const resolvedSurfaceId = normalizeSurfaceId(surfaceId || FLOOR_SURFACE_ID);
    const holdPoint = ensureManualHoldPoint();
    holdPoint.set(
      Number.isFinite(point?.x) ? Number(point.x) : cat.pos.x,
      resolvedSurfaceId === FLOOR_SURFACE_ID ? 0 : Math.max(0.02, Number.isFinite(y) ? Number(y) : 0.02),
      Number.isFinite(point?.z) ? Number(point.z) : cat.pos.z
    );
    cat.nav.manualHoldSurfaceId = resolvedSurfaceId;
    cat.nav.manualHoldY = holdPoint.y;
  }

  function catHasTrackedNonFloorSurface() {
    return isNonFloorSurfaceId(getTrackedCatSurfaceId());
  }

  function catIsOnNonFloorSurfaceNow() {
    return catHasNonFloorSurface(cat);
  }

  function catIsOnWindowSillNow() {
    if (!windowSill) return false;
    const windowSurfaceId = String(windowSill.id || "windowSill");
    const windowY = Math.max(0.02, Number(windowSill.surfaceY || 0) + 0.02);
    const trackedSurfaceId = normalizeSurfaceId(getCurrentCatSurfaceId() || getTrackedCatSurfaceId());
    if (trackedSurfaceId === windowSurfaceId && Math.abs((cat.group.position.y || 0) - windowY) <= 0.16) {
      return true;
    }
    const sitPoint = windowSill.sitPoint;
    if (!sitPoint) return false;
    const dx = Number(sitPoint.x || 0) - cat.pos.x;
    const dz = Number(sitPoint.z || 0) - cat.pos.z;
    return dx * dx + dz * dz <= 0.22 * 0.22 && Math.abs((cat.group.position.y || 0) - windowY) <= 0.16;
  }

  function markCatSurfaceId(surfaceId, authority = "state-machine", stickySeconds = 0.9) {
    return setCatSurfaceId(cat, surfaceId, authority, clockTime, stickySeconds);
  }

  function getMoveTargetSurfaceId(target, fallback = FLOOR_SURFACE_ID) {
    return targetSurfaceId(target, fallback);
  }

  function routeTargetsNonFloorSurface(route = null) {
    return isNonFloorSurfaceId(normalizeSurfaceId(route?.surfaceId));
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

  function deferDeskApproachRoll(untilTime) {
    const resumeAt = Math.max(
      clockTime + CAT_BEHAVIOR.tableApproachRollInterval,
      Number.isFinite(untilTime) ? untilTime : 0
    );
    cat.tableRollStartAt = Math.max(Number(cat.tableRollStartAt) || 0, resumeAt);
    cat.nextTableRollAt = Math.max(Number(cat.nextTableRollAt) || 0, resumeAt);
  }

  function tryStartCupApproachFromPatrol() {
    if (game.catnip || cat.nav?.windowHoldActive) return false;
    if (clockTime < (cat.nav.suppressCupUntil || 0)) return false;
    if (cup.broken || cup.falling) return false;

    const currentSurfaceId = normalizeSurfaceId(getCurrentCatSurfaceId());
    const swipePlan = computeCupSwipePlan(THREE, desk, cup.group.position, cupSwipePoint, cupSwipeEdgeDir);
    clearNavRoute("patrol-cup-roll");
    cat.manualPatrolActive = false;
    clearCatNavPath(true);
    cat.phaseT = 0;
    if (currentSurfaceId === "desk") {
      markCatSurfaceId("desk", "cup-approach", 0.6);
      clearCatJumpTargets();
      cat.state = "toCup";
      return true;
    }
    clearCatJumpTargets();
    const queued = requestSharedMoveRoute("desk", swipePlan.point, 0, {
      source: "cup",
      forceReplan: true,
      preserveExactTarget: true,
    });
    if (queued) {
      cat.state = "patrol";
      cat.phaseT = 0;
      cat.status = "Approaching cup";
      return true;
    }

    cat.state = "toDesk";
    return true;
  }

  function rollCupApproachFromPatrol() {
    const nextRollAt = Number(cat.nextTableRollAt) || 0;
    if (clockTime < nextRollAt) return false;

    const canRoll =
      clockTime >= (Number(cat.tableRollStartAt) || 0) &&
      !game.catnip &&
      !cat.nav?.windowHoldActive &&
      clockTime >= (cat.nav.suppressCupUntil || 0) &&
      !cup.broken &&
      !cup.falling;

    const didStartCupApproach =
      canRoll && Math.random() < CAT_BEHAVIOR.tableApproachChancePerSecond
        ? tryStartCupApproachFromPatrol()
        : false;

    cat.nextTableRollAt =
      Math.max(nextRollAt, clockTime) + CAT_BEHAVIOR.tableApproachRollInterval;
    return didStartCupApproach;
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
    markCatSurfaceId(getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk", "jump-down-plan", 0.4);
  }

  function enterNoPathSit(seconds = 0.95) {
    traceFunction("enterNoPathSit", `state=${cat.state || "na"} for=${seconds.toFixed(2)}`);
    clearManualHoldState();
    clearNavRoute("no-path");
    cat.manualPatrolActive = false;
    cat.state = "sit";
    cat.phaseT = 0;
    cat.sitDuration = seconds;
    cat.status = "No valid path";
    cat.nav.jumpDownPlanValid = false;
    cat.nav.jumpDownToward = null;
    cat.nav.jumpDownLandingSurfaceId = null;
    clearCatNavPath(true);
  }

  function recordRoutePlannerEvent(kind, data = null) {
    if (!cat?.nav) return;
    if (!Array.isArray(cat.nav.debugEvents)) cat.nav.debugEvents = [];
    const evt = {
      t: clockTime,
      kind,
      state: cat.state,
    };
    if (data && typeof data === "object") Object.assign(evt, data);
    cat.nav.debugEvents.push(evt);
    if (cat.nav.debugEvents.length > 160) {
      cat.nav.debugEvents.splice(0, cat.nav.debugEvents.length - 160);
    }
  }

  function quantizeReachabilityValue(value) {
    const q = REACHABILITY_CACHE_QUANTUM;
    return Math.round((Number.isFinite(value) ? value : 0) / q);
  }

  function getReachabilityCacheKey(start, goal, includeDynamic = true, options = null, label = "") {
    const fallback = options && Object.prototype.hasOwnProperty.call(options, "allowFallback")
      ? (options.allowFallback ? 1 : 0)
      : -1;
    return [
      label || "reach",
      includeDynamic ? "dyn" : "static",
      quantizeReachabilityValue(start?.x),
      quantizeReachabilityValue(start?.z),
      quantizeReachabilityValue(goal?.x),
      quantizeReachabilityValue(goal?.z),
      fallback,
    ].join(":");
  }

  function canReachGroundTargetMemo(start, goal, includeDynamic = true, options = null, label = "") {
    if (!start || !goal) return false;
    if (!cat.nav.reachabilityCache || typeof cat.nav.reachabilityCache !== "object") {
      cat.nav.reachabilityCache = Object.create(null);
    }
    const key = getReachabilityCacheKey(start, goal, includeDynamic, options, label);
    const cached = cat.nav.reachabilityCache[key];
    if (cached && Number.isFinite(cached.t) && clockTime - cached.t <= REACHABILITY_CACHE_TTL) {
      return !!cached.ok;
    }
    const obstacles = includeDynamic ? buildCatObstacles(true, true) : buildCatObstacles(false);
    const ok = !!canReachGroundTarget(start, goal, obstacles, options || null);
    cat.nav.reachabilityCache[key] = { t: clockTime, ok };
    return ok;
  }

  function getSurfaceTargetY(surfaceId = FLOOR_SURFACE_ID, point = null, fallbackY = null) {
    const resolvedSurfaceId = normalizeSurfaceId(surfaceId || FLOOR_SURFACE_ID);
    if (isFloorSurfaceId(resolvedSurfaceId)) return 0;
    const pointY = Number.isFinite(point?.y) ? Number(point.y) : NaN;
    const resolvedFallbackY = Number.isFinite(fallbackY)
      ? Number(fallbackY)
      : (Number.isFinite(cat.group.position.y) ? Number(cat.group.position.y) : 0.02);
    return Math.max(0.02, Number.isFinite(pointY) ? pointY : resolvedFallbackY);
  }

  function isCatAlignedToSurface(surfaceId = FLOOR_SURFACE_ID, point = null, tolerance = 0.12) {
    const resolvedSurfaceId = normalizeSurfaceId(surfaceId || FLOOR_SURFACE_ID);
    if (isFloorSurfaceId(resolvedSurfaceId)) {
      return (cat.group.position.y || 0) <= 0.08;
    }
    const targetY = getSurfaceTargetY(resolvedSurfaceId, point, cat.group.position.y);
    return Math.abs((cat.group.position.y || 0) - targetY) <= tolerance;
  }

  function moveCatTowardSurfaceTarget(targetPoint, stepDt, speed, surfaceId = FLOOR_SURFACE_ID, opts = null) {
    if (!targetPoint) return false;
    const resolvedSurfaceId = normalizeSurfaceId(surfaceId || FLOOR_SURFACE_ID);
    const moveOptions = opts && typeof opts === "object" ? { ...opts } : {};
    if (isFloorSurfaceId(resolvedSurfaceId)) {
      delete moveOptions.supportSurfaceId;
    } else {
      moveOptions.supportSurfaceId = resolvedSurfaceId;
    }
    return moveCatToward(
      targetPoint,
      stepDt,
      speed,
      getSurfaceTargetY(resolvedSurfaceId, targetPoint, cat.group.position.y),
      moveOptions
    );
  }

  function getArrivalSnapRadius(surfaceId = "floor") {
    let radius = ARRIVAL_SNAP_RADIUS_BASE;
    const lastSpeed = Number.isFinite(cat.nav?.lastSpeed) ? cat.nav.lastSpeed : 0;
    const turnOnlyT = Number.isFinite(cat.nav?.turnOnlyT) ? cat.nav.turnOnlyT : 0;
    const stuckT = Number.isFinite(cat.nav?.stuckT) ? cat.nav.stuckT : 0;
    if (lastSpeed <= 0.16) radius += ARRIVAL_SNAP_RADIUS_BONUS;
    if (turnOnlyT > 0.14) radius += 0.02;
    if (stuckT > 0.16 || (cat.nav?.segmentBlockedFrames || 0) > 0) radius += 0.015;
    return Math.min(ARRIVAL_SNAP_RADIUS_MAX, radius);
  }

  function settleCatAtPoint(targetPoint, surfaceId = "floor", explicitRadius = null) {
    if (!targetPoint) return false;
    const resolvedSurfaceId = normalizeSurfaceId(surfaceId || FLOOR_SURFACE_ID);
    const dx = Number(targetPoint.x || 0) - cat.pos.x;
    const dz = Number(targetPoint.z || 0) - cat.pos.z;
    const radius = Number.isFinite(explicitRadius) ? explicitRadius : getArrivalSnapRadius(resolvedSurfaceId);
    if (dx * dx + dz * dz > radius * radius) return false;
    const targetY = getSurfaceTargetY(resolvedSurfaceId, targetPoint, cat.group.position.y);
    if (!isFloorSurfaceId(resolvedSurfaceId) && Math.abs((cat.group.position.y || 0) - targetY) > ARRIVAL_SNAP_Y_ELEVATED) {
      return false;
    }
    cat.pos.x = Number(targetPoint.x || 0);
    cat.pos.z = Number(targetPoint.z || 0);
    cat.group.position.set(cat.pos.x, targetY, cat.pos.z);
    clearCatNavPath(false);
    cat.nav.arrivalHoldUntil = clockTime + Math.max(ROUTE_FINISH_SETTLE, 0.28);
    return true;
  }

  function nudgeCatTowardWindowSitPoint(windowTarget) {
    if (!windowTarget) return;
    const dx = Number(windowTarget.x || 0) - cat.pos.x;
    const dz = Number(windowTarget.z || 0) - cat.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 1e-5) return;
    const step = Math.min(WINDOW_SIT_NUDGE_MAX, dist * 0.45);
    cat.pos.x += (dx / dist) * step;
    cat.pos.z += (dz / dist) * step;
    cat.group.position.x = cat.pos.x;
    cat.group.position.z = cat.pos.z;
  }

  function hadRecentSurfaceRouteInstability(route = null, within = 0.9) {
    const activeRoute = route || getActiveNavRoute?.() || null;
    if (!activeRoute?.active || !routeTargetsNonFloorSurface(activeRoute)) return false;

    const lastRepathCause = cat.nav?.lastRepathCause || null;
    if (lastRepathCause && Number.isFinite(lastRepathCause.t) && clockTime - lastRepathCause.t <= within) {
      const kind = String(lastRepathCause.kind || "");
      if (
        kind === "surface-no-progress" ||
        kind === "rollback-blocked" ||
        kind === "blocked-position-rescue"
      ) {
        return true;
      }
    }

    const events = Array.isArray(cat.nav?.debugEvents) ? cat.nav.debugEvents : [];
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i];
      if (!evt || !Number.isFinite(evt.t) || clockTime - evt.t > within) break;
      const kind = String(evt.kind || "");
      if (kind === "route-queue-reject-no-jumpdown-link" || kind === "route-queue-reject-no-surface-link") {
        return true;
      }
    }
    return false;
  }

  function getRoutePointY(point, fallback = 0) {
    return Number.isFinite(point?.y) ? Number(point.y) : fallback;
  }

  function getRouteTargetY(route) {
    if (!route) return 0;
    return routeTargetsNonFloorSurface(route)
      ? Math.max(0.02, getRoutePointY(route.target, Number(route.y) || 0.02))
      : 0;
  }

  function getRouteFinalY(route) {
    if (!route) return 0;
    const finalSurfaceId = String(route.finalSurfaceId || route.surfaceId || "floor");
    if (finalSurfaceId === "floor") return 0;
    return Math.max(
      0.02,
      getRoutePointY(
        route.finalTarget,
        Number(route.finalY) || getRouteTargetY(route) || 0.02
      )
    );
  }

  function getRouteJumpDownY(route) {
    if (!route) return 0;
    return getRoutePointY(route.jumpDown, Number(route.jumpDownY) || 0);
  }

  function hydrateRoutePointHeights(route = null) {
    const activeRoute = route || cat.nav?.route || null;
    if (!activeRoute) return activeRoute;

    const targetY = getRouteTargetY(activeRoute);
    const finalY = getRouteFinalY(activeRoute);
    const jumpDownY = getRouteJumpDownY(activeRoute);

    if (activeRoute.target?.set) activeRoute.target.y = targetY;
    if (activeRoute.finalTarget?.set) activeRoute.finalTarget.y = finalY;
    if (activeRoute.jumpDown?.set) activeRoute.jumpDown.y = jumpDownY;
    if (activeRoute.jumpOff?.set && !Number.isFinite(activeRoute.jumpOff.y) && Number.isFinite(activeRoute.landing?.y)) {
      activeRoute.jumpOff.y = Number(activeRoute.landing.y);
    }
    return activeRoute;
  }

  function syncRouteHeightsFromPoints(route = null) {
    const activeRoute = hydrateRoutePointHeights(route || ensureNavRoute());
    if (!activeRoute) return activeRoute;
    activeRoute.y = getRouteTargetY(activeRoute);
    activeRoute.finalY = getRouteFinalY(activeRoute);
    activeRoute.jumpDownY = getRouteJumpDownY(activeRoute);
    return activeRoute;
  }

  function ensureNavRoute() {
    if (!cat.nav.route || typeof cat.nav.route !== "object") cat.nav.route = {};
    const route = cat.nav.route;
    if (!route.target || typeof route.target.set !== "function") {
      route.target = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    if (!route.finalTarget || typeof route.finalTarget.set !== "function") {
      route.finalTarget = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    if (!route.jumpAnchor || typeof route.jumpAnchor.set !== "function") {
      route.jumpAnchor = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    if (!route.landing || typeof route.landing.set !== "function") {
      route.landing = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    if (!route.jumpOff || typeof route.jumpOff.set !== "function") {
      route.jumpOff = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    if (!route.jumpDown || typeof route.jumpDown.set !== "function") {
      route.jumpDown = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
    }
    if (typeof route.active !== "boolean") route.active = false;
    if (!route.source) route.source = "";
    route.surfaceId = normalizeSurfaceId(route.surfaceId || route.finalSurfaceId || cat.nav?.surfaceState?.currentSurfaceId);
    route.finalSurfaceId = normalizeSurfaceId(route.finalSurfaceId);
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
    syncRouteHeightsFromPoints(route);
    return route;
  }

  function buildRouteSegments(route = ensureNavRoute(), reason = "") {
    const onNonFloorSurfaceNow = catIsOnNonFloorSurfaceNow();
    const currentSurfaceId = normalizeSurfaceId(
      getCurrentCatSurfaceId() ||
      route.approachSurfaceId ||
      (onNonFloorSurfaceNow ? route.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId : FLOOR_SURFACE_ID)
    );
    const routeSurfaceId = normalizeSurfaceId(route.surfaceId || route.finalSurfaceId || currentSurfaceId);
    const routeTargetY = isFloorSurfaceId(routeSurfaceId)
      ? 0
      : Math.max(0.02, getRouteTargetY(route));
    const currentSurfaceY = isFloorSurfaceId(currentSurfaceId)
      ? 0
      : Math.max(0.02, Number(cat.group.position.y) || 0.02);
    const needsSurfaceTransition =
      currentSurfaceId !== routeSurfaceId ||
      Math.abs(currentSurfaceY - routeTargetY) > 0.12;
    const segments = [];

    if (needsSurfaceTransition) {
      if (route.directJump || !onNonFloorSurfaceNow) {
        segments.push({
          kind: "jump-up-approach",
          pointKey: "jumpAnchor",
          landingKey: "landing",
          landingYMode: "target",
          supportSurfaceId: normalizeSurfaceId(route.approachSurfaceId || currentSurfaceId),
        });
      } else {
        segments.push({
          kind: "jump-down-approach",
          pointKey: "jumpOff",
          jumpToKey: "jumpDown",
          towardKey: isFloorSurfaceId(routeSurfaceId) ? "target" : "jumpAnchor",
          desiredLandingSurfaceId: routeSurfaceId,
          supportSurfaceId: currentSurfaceId,
        });
      }
    }

    segments.push({
      kind: "walk-surface",
      pointKey: "target",
      supportSurfaceId: routeSurfaceId,
    });

    route.segments = segments.map((segment, index) => ({
      id: `${segment.kind}:${index}`,
      ...segment,
    }));
    route.segmentIndex = 0;
    route.segmentEnteredAt = clockTime;
    route.segmentReason = reason ? String(reason) : "planned";
    route.segmentProgressAt = clockTime;
    route.segmentProgressX = cat.pos.x;
    route.segmentProgressZ = cat.pos.z;
    route.segmentProgressDist = Infinity;
    return route;
  }

  function getActiveRouteSegment(route = ensureNavRoute()) {
    if (!route.active) return null;
    if (!Array.isArray(route.segments) || route.segments.length === 0) {
      buildRouteSegments(route, "lazy-build");
    }
    if (route.segmentIndex >= route.segments.length) return null;
    return route.segments[route.segmentIndex] || null;
  }

  function advanceRouteSegment(route = ensureNavRoute(), reason = "") {
    if (!Array.isArray(route.segments)) route.segments = [];
    route.segmentIndex = Math.min(route.segments.length, Math.max(0, Number(route.segmentIndex) || 0) + 1);
    route.segmentEnteredAt = clockTime;
    route.segmentReason = reason ? String(reason) : "advanced";
    route.segmentProgressAt = clockTime;
    route.segmentProgressX = cat.pos.x;
    route.segmentProgressZ = cat.pos.z;
    route.segmentProgressDist = Infinity;
    return getActiveRouteSegment(route);
  }

  function ensureRouteInvalidation() {
    if (!cat.nav.routeInvalidation || typeof cat.nav.routeInvalidation !== "object") {
      cat.nav.routeInvalidation = {};
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

  function clearRouteInvalidation() {
    const invalidation = ensureRouteInvalidation();
    invalidation.pending = false;
    invalidation.kind = "";
    invalidation.queryY = 0;
    invalidation.useDynamic = true;
    invalidation.requestedAt = 0;
    invalidation.count = 0;
    invalidation.target.set(cat.pos.x, 0, cat.pos.z);
    return invalidation;
  }

  function getPendingRouteInvalidation() {
    const invalidation = ensureRouteInvalidation();
    return invalidation.pending ? invalidation : null;
  }

  function syncRouteScalarsFromLegacy(route = ensureNavRoute()) {
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
    syncRouteHeightsFromPoints(route);
    return route;
  }

  function syncLegacyScalarsFromRoute(route = ensureNavRoute()) {
    syncRouteHeightsFromPoints(route);
    cat.debugMoveActive = !!route.active;
    cat.debugMoveSurfaceId = normalizeSurfaceId(route.surfaceId);
    cat.debugMoveFinalSurfaceId = normalizeSurfaceId(route.finalSurfaceId || route.surfaceId);
    cat.debugMoveY = Number.isFinite(route.y) ? route.y : 0;
    cat.debugMoveFinalY = Number.isFinite(route.finalY) ? route.finalY : 0;
    cat.debugMoveJumpDownY = Number.isFinite(route.jumpDownY) ? route.jumpDownY : 0;
    cat.debugMoveDirectJump = !!route.directJump;
    cat.nav.debugMoveApproachSurfaceId = String(route.approachSurfaceId || "floor");
    cat.debugMoveSitSeconds = Number.isFinite(route.sitSeconds) ? route.sitSeconds : 0;
    cat.nav.debugMoveRecoverAt = Number.isFinite(route.recoverAt) ? route.recoverAt : 0;
    if (cat.debugMoveTarget?.copy) cat.debugMoveTarget.copy(route.target);
    if (cat.debugMoveFinalTarget?.copy) cat.debugMoveFinalTarget.copy(route.finalTarget);
    if (cat.debugMoveJumpAnchor?.copy) cat.debugMoveJumpAnchor.copy(route.jumpAnchor);
    if (cat.debugMoveLanding?.copy) cat.debugMoveLanding.copy(route.landing);
    if (cat.debugMoveJumpOff?.copy) cat.debugMoveJumpOff.copy(route.jumpOff);
    if (cat.debugMoveJumpDown?.copy) cat.debugMoveJumpDown.copy(route.jumpDown);
    return route;
  }

  function clearNavRoute(source = "") {
    const route = ensureNavRoute();
    route.active = false;
    cat.nav.jumpDownLinkId = "";
    route.source = source ? String(source) : "";
    route.surfaceId = FLOOR_SURFACE_ID;
    route.finalSurfaceId = FLOOR_SURFACE_ID;
    route.approachSurfaceId = "floor";
    route.y = 0;
    route.finalY = 0;
    route.jumpDownY = 0;
    route.directJump = false;
    route.approachSurfaceId = "floor";
    route.sitSeconds = 0;
    route.recoverAt = 0;
    route.createdAt = 0;
    route.blockedSince = 0;
    route.blockedReason = "";
    route.lastProgressAt = 0;
    route.lastProgressX = cat.pos.x;
    route.lastProgressZ = cat.pos.z;
    route.segments = [];
    route.segmentIndex = 0;
    route.segmentEnteredAt = 0;
    route.segmentReason = source ? String(source) : "";
    route.segmentProgressAt = 0;
    route.segmentProgressX = cat.pos.x;
    route.segmentProgressZ = cat.pos.z;
    route.segmentProgressDist = Infinity;
    route.target.set(cat.pos.x, 0, cat.pos.z);
    route.finalTarget.set(cat.pos.x, 0, cat.pos.z);
    route.jumpAnchor.set(cat.pos.x, 0, cat.pos.z);
    route.landing.set(cat.pos.x, 0, cat.pos.z);
    route.jumpOff.set(cat.pos.x, 0, cat.pos.z);
    route.jumpDown.set(cat.pos.x, 0, cat.pos.z);
    syncRouteHeightsFromPoints(route);
    clearRouteInvalidation();
    syncLegacyScalarsFromRoute(route);
    return route;
  }

  function noteRouteProgress(route, targetPoint = null, minDelta = 0.03) {
    if (!route) return;
    const moveDelta = Math.max(0.012, Number.isFinite(minDelta) ? minDelta : 0.03);
    const dx = cat.pos.x - Number(route.lastProgressX || cat.pos.x);
    const dz = cat.pos.z - Number(route.lastProgressZ || cat.pos.z);
    const movedEnough = dx * dx + dz * dz >= moveDelta * moveDelta;

    const segmentEnteredAt = Number(route.segmentEnteredAt || route.createdAt || clockTime);
    if (!Number.isFinite(route.segmentProgressAt) || route.segmentProgressAt < segmentEnteredAt) {
      route.segmentProgressAt = segmentEnteredAt;
      route.segmentProgressX = cat.pos.x;
      route.segmentProgressZ = cat.pos.z;
      route.segmentProgressDist = Infinity;
    }

    let towardProgress = false;
    if (targetPoint && Number.isFinite(targetPoint.x) && Number.isFinite(targetPoint.z)) {
      const currentDist = Math.hypot(cat.pos.x - targetPoint.x, cat.pos.z - targetPoint.z);
      const prevBest = Number.isFinite(route.segmentProgressDist)
        ? route.segmentProgressDist
        : Math.hypot(Number(route.segmentProgressX || cat.pos.x) - targetPoint.x, Number(route.segmentProgressZ || cat.pos.z) - targetPoint.z);
      const gain = prevBest - currentDist;
      towardProgress = gain >= Math.max(0.018, moveDelta * 0.75) || currentDist <= Math.max(0.16, moveDelta * 3.2);
      route.segmentProgressDist = towardProgress ? currentDist : Math.min(prevBest, currentDist);
    }

    if (movedEnough || towardProgress) {
      route.lastProgressAt = clockTime;
      route.lastProgressX = cat.pos.x;
      route.lastProgressZ = cat.pos.z;
      route.segmentProgressAt = clockTime;
      route.segmentProgressX = cat.pos.x;
      route.segmentProgressZ = cat.pos.z;
    }
  }

  function hasConfirmedRouteFailure(route) {
    if (!route?.active) return false;
    const activeSegment = getActiveRouteSegment(route);
    const segmentPoint = activeSegment?.pointKey ? (route[activeSegment.pointKey] || route.target) : route.target;
    noteRouteProgress(route, segmentPoint, 0.026);
    const reason = String(cat.nav?.debugStep?.reason || "");
    const isBlocked = reason === "wholePathBlocked" || reason === "noPath";
    if (!isBlocked) {
      route.blockedSince = 0;
      route.blockedReason = "";
    } else if (route.blockedReason !== reason) {
      route.blockedReason = reason;
      route.blockedSince = clockTime;
    } else if (!Number.isFinite(route.blockedSince) || route.blockedSince <= 0) {
      route.blockedSince = clockTime;
    }

    const routeAge = clockTime - Number(route.createdAt || 0);
    const segmentEnteredAt = Number(route.segmentEnteredAt || route.createdAt || clockTime);
    const segmentAge = clockTime - segmentEnteredAt;
    const segmentIdleFor = clockTime - Number(route.segmentProgressAt || segmentEnteredAt || clockTime);
    const blockedLongEnough =
      isBlocked &&
      routeAge >= ROUTE_MIN_LIFETIME &&
      segmentAge >= 0.24 &&
      clockTime - Number(route.blockedSince || clockTime) >= ROUTE_BLOCK_CONFIRM;
    const stalledLongEnough =
      cat.nav.stuckT > 0.68 &&
      routeAge >= ROUTE_MIN_LIFETIME &&
      segmentAge >= 0.32 &&
      segmentIdleFor >= ROUTE_STUCK_CONFIRM + 0.14;
    return blockedLongEnough || stalledLongEnough;
  }

  function getActiveNavRoute() {
    const route = ensureNavRoute();
    return route.active ? route : null;
  }

  function abortCatnipRouteAndResumePatrol() {
    if (game.catnip?.mesh) scene.remove(game.catnip.mesh);
    game.catnip = null;
    clearCatnipApproachLock();
    game.placeCatnipMode = false;
    game.catnipNoRouteUntil = clockTime + 2.2;
    cat.nav.catnipPathCheckAt = 0;
    cat.nav.catnipUseExactTarget = false;
    cat.nav.catnipRecoverUntil = 0;
    cat.nav.catnipIdleBlendUntil = 0;
    cat.nav.catnipBlockedSince = 0;
    cat.nav.jumpDownLandingSurfaceId = null;
    clearNavRoute("catnip-abort");
    cat.manualPatrolActive = false;
    clearCatJumpTargets();
    clearCatNavPath(true);
    cat.state = "patrol";
    cat.phaseT = 0;
    cat.status = "No route to catnip";
    if (!setNextPatrolTarget(true)) enterNoPathSit(0.8);
  }

  function isBlockedNavReason(reason) {
    return reason === "wholePathBlocked" || reason === "noPath";
  }

  function shouldAbortCatnipForBlockedNav(reason) {
    if (!isBlockedNavReason(reason)) {
      cat.nav.catnipBlockedSince = 0;
      return false;
    }
    const blockedSince = Number(cat.nav.catnipBlockedSince) || 0;
    if (blockedSince <= 0) {
      cat.nav.catnipBlockedSince = clockTime;
      return false;
    }
    return clockTime - blockedSince >= CATNIP_ABORT_BLOCKED_GRACE;
  }

  function refreshJumpDownLink(towardGroundPoint = null, force = false, desiredLandingSurfaceId = null) {
    const route = ensureNavRoute();
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
      route.target ||
      desk.approach;
    const preferredLandingSurfaceId = cat.nav.jumpDownLandingSurfaceId || null;
    const ok = updateDebugJumpDownPlan(preferredToward, true, preferredLandingSurfaceId);
    const resolvedLandingSurfaceId = cat.nav.jumpDownLandingSurfaceId || preferredLandingSurfaceId || "floor";
    if (ok && cat.debugMoveJumpOff) {
      const jumpOffSurfaceId = String(
        getCurrentCatSurfaceId() !== "floor"
          ? getCurrentCatSurfaceId()
          : (route.surfaceId || cat.debugMoveSurfaceId || "desk")
      );
      const clampedJumpOff =
        clampPointToSurfaceSupport(
          jumpOffSurfaceId,
          new THREE.Vector3(cat.debugMoveJumpOff.x, 0, cat.debugMoveJumpOff.z),
          0.05
        ) || null;
      if (clampedJumpOff) {
        cat.debugMoveJumpOff.set(clampedJumpOff.x, Number(cat.debugMoveJumpOff.y || 0), clampedJumpOff.z);
      }
    }
    syncRouteScalarsFromLegacy(route);
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
      desiredLandingSurfaceId: resolvedLandingSurfaceId,
      jumpOffX: cat.debugMoveJumpOff?.x,
      jumpOffZ: cat.debugMoveJumpOff?.z,
      jumpDownX: cat.debugMoveJumpDown?.x,
      jumpDownY: cat.debugMoveJumpDownY || 0,
      jumpDownZ: cat.debugMoveJumpDown?.z,
    });
    return ok;
  }

  function getSurfacePatrolArea(surface) {
    return Math.max(0.001, getSurfaceArea(surface));
  }

  function sampleRandomPatrolPointOnSurface(surface, fromPoint = cat.pos) {
    if (!surface) return null;
    if (isFloorSurfaceId(surface.id)) {
      return pickRandomPatrolPoint(fromPoint, false);
    }

    const width = Math.max(0, Number(surface.maxX) - Number(surface.minX));
    const depth = Math.max(0, Number(surface.maxZ) - Number(surface.minZ));
    if (width <= 0.04 || depth <= 0.04) return null;

    const edgePad = Math.max(0.08, CAT_COLLISION.catBodyRadius + 0.08);

    for (let i = 0; i < 12; i++) {
      const sampled = samplePointOnSurfaceXZ(surface, edgePad, Math.random);
      const point = new THREE.Vector3(sampled.x, Number(surface.y || 0.02), sampled.z);
      if (point.distanceToSquared(fromPoint) < 0.45 * 0.45) continue;
      return point;
    }

    const center = getSurfaceCenter(surface);
    return new THREE.Vector3(center.x, Number(surface.y || 0.02), center.z);
  }

  function pickWeightedRandomPatrolSurface(allowSurfacePatrol = true) {
    const patrolSurfaces = getSurfaceDefs({
      includeFloor: true,
      onlyRandomPatrol: true,
    }).filter((surface) => allowSurfacePatrol || isFloorSurfaceId(surface.id));
    if (!patrolSurfaces.length) return null;

    const weighted = patrolSurfaces
      .map((surface) => ({ surface, weight: Math.max(0.001, getSurfacePatrolArea(surface)) }))
      .filter((entry) => entry.weight > 0);
    if (!weighted.length) return null;

    let pick = Math.random() * weighted.reduce((sum, entry) => sum + entry.weight, 0);
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick <= 0) return entry.surface;
    }
    return weighted[weighted.length - 1].surface;
  }

  function pickRandomPatrolMoveTarget(allowSurfacePatrol = true) {
    if (game.catnip || cat.manualPatrolActive) return null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const surface = pickWeightedRandomPatrolSurface(allowSurfacePatrol);
      if (!surface) break;
      const point = sampleRandomPatrolPointOnSurface(surface, cat.pos);
      if (!point) continue;
      if (isFloorSurfaceId(surface.id)) {
        return { surfaceId: FLOOR_SURFACE_ID, point: point.clone(), floorPoint: point };
      }
      return {
        surfaceId: surface.id,
        point,
      };
    }

    const floorPoint = pickRandomPatrolPoint(cat.pos, false);
    return floorPoint ? { surfaceId: FLOOR_SURFACE_ID, point: floorPoint.clone(), floorPoint } : null;
  }

  function setNextPatrolTarget(allowSurfacePatrol = true) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const nextPatrol = pickRandomPatrolMoveTarget(allowSurfacePatrol);
      if (!nextPatrol) return false;
      const finalPoint = (nextPatrol.floorPoint || nextPatrol.point)?.clone
        ? (nextPatrol.floorPoint || nextPatrol.point).clone()
        : new THREE.Vector3(
            Number(nextPatrol.floorPoint?.x ?? nextPatrol.point?.x ?? 0),
            Number(nextPatrol.floorPoint?.y ?? nextPatrol.point?.y ?? 0),
            Number(nextPatrol.floorPoint?.z ?? nextPatrol.point?.z ?? 0)
          );
      if (!requestSharedMoveRoute(nextPatrol.surfaceId, finalPoint, 0, { source: "patrol", forceReplan: true })) continue;
      cat.patrolTarget.copy(finalPoint);
      cat.nav.patrolSurfaceId = normalizeSurfaceId(nextPatrol.surfaceId || FLOOR_SURFACE_ID);
      cat.nav.debugDestination.set(
        finalPoint.x,
        isFloorSurfaceId(nextPatrol.surfaceId) ? 0 : Number(finalPoint.y || 0.02),
        finalPoint.z
      );
      return true;
    }
    return false;
  }

  function hasStaleElevatedRouteProgress(route = null, idle = 0.58) {
    const activeRoute = route || getActiveNavRoute?.() || null;
    if (!activeRoute?.active || !routeTargetsNonFloorSurface(activeRoute)) return false;
    const activeSegment = getActiveRouteSegment(activeRoute);
    const segmentPoint = activeSegment?.pointKey ? (activeRoute[activeSegment.pointKey] || activeRoute.target) : activeRoute.target;
    noteRouteProgress(activeRoute, segmentPoint, 0.024);
    const segmentEnteredAt = Number(activeRoute.segmentEnteredAt || activeRoute.createdAt || clockTime);
    const segmentAge = clockTime - segmentEnteredAt;
    const noProgressFor = clockTime - Number(activeRoute.segmentProgressAt || segmentEnteredAt || clockTime);
    const unstableMotion = (cat.nav?.noSteerFrames || 0) >= 4 || (cat.nav?.stuckT || 0) > 0.24;
    const explicitReroute = String(cat.status || "") === "Re-routing";
    return segmentAge >= 0.3 && noProgressFor >= idle && (unstableMotion || explicitReroute);
  }

  function hasMatchingActiveRoute(finalSurfaceId, finalPoint, tolerance = 0.18) {
    const route = getActiveNavRoute();
    if (!route?.active || !finalPoint) return false;
    if (String(route.finalSurfaceId || "floor") !== String(finalSurfaceId || "floor")) return false;
    const dx = Number(route.finalTarget?.x || 0) - Number(finalPoint.x || 0);
    const dz = Number(route.finalTarget?.z || 0) - Number(finalPoint.z || 0);
    if (dx * dx + dz * dz > tolerance * tolerance) return false;
    if (getPendingRouteInvalidation()) return false;
    if (hadRecentSurfaceRouteInstability(route)) return false;
    if (hasStaleElevatedRouteProgress(route)) return false;
    return !hasConfirmedRouteFailure(route);
  }

  function isActiveRouteFromSource(source) {
    const route = getActiveNavRoute();
    return !!route?.active && String(route.source || "") === String(source || "");
  }

  function makeHopPlanRequestKey(sourceSurfaceId, finalSurfaceId, finalPoint) {
    const q = (v) => Math.round((Number.isFinite(v) ? v : 0) / 0.06);
    return `${String(sourceSurfaceId || "floor")}|${String(finalSurfaceId || "floor")}|${q(finalPoint?.x)}:${q(finalPoint?.z)}:${q(finalPoint?.y)}`;
  }

  function shouldSkipRecentHopPlan(sourceSurfaceId, finalSurfaceId, finalPoint) {
    const route = getActiveNavRoute();
    if (!route?.active || !finalPoint) return false;
    if (String(route.finalSurfaceId || "floor") !== String(finalSurfaceId || "floor")) return false;
    if (hadRecentSurfaceRouteInstability(route)) return false;
    if (hasStaleElevatedRouteProgress(route)) return false;
    if (String(cat.status || "") === "Re-routing") return false;
    const key = makeHopPlanRequestKey(sourceSurfaceId, finalSurfaceId, finalPoint);
    const lastKey = String(cat.nav.lastHopPlanKey || "");
    const lastAt = Number(cat.nav.lastHopPlanAt) || 0;
    if (key !== lastKey) return false;
    return clockTime - lastAt <= HOP_PLAN_REQUEST_COOLDOWN;
  }

  function clampPointToSurfaceSupport(surfaceId, point, extraPad = 0.05) {
    if (!point) return null;
    const sid = String(surfaceId || "");
    if (!sid || sid === "floor") return point.clone();
    const surface = getNonFloorSurfaceById(sid);
    if (!surface) return point.clone();

    const out = point.clone();
    const edgePad = Math.max(0.02, CAT_COLLISION.catBodyRadius + extraPad);
    const clamped = clampPointToSurfaceXZ(surface, out.x, out.z, edgePad);
    out.x = clamped.x;
    out.z = clamped.z;
    return out;
  }

  function makeRoutePointForSurface(surfaceId, point, extraPad = 0.05) {
    if (!point) return null;
    const sid = normalizeSurfaceId(surfaceId || FLOOR_SURFACE_ID);
    if (sid === FLOOR_SURFACE_ID) {
      const groundPoint =
        findSafeGroundPoint(new THREE.Vector3(point.x, 0, point.z)) ||
        new THREE.Vector3(point.x, 0, point.z);
      groundPoint.y = 0;
      return groundPoint;
    }
    const surface = getNonFloorSurfaceById(sid);
    const targetY = Number.isFinite(surface?.y)
      ? surface.y
      : Math.max(0.02, Number(point?.y || 0.02));
    const rawPoint = new THREE.Vector3(point.x, targetY, point.z);
    const clamped = clampPointToSurfaceSupport(sid, rawPoint, extraPad) || rawPoint;
    clamped.y = targetY;
    return clamped;
  }


  const surfaceTargetRefineCache = new Map();

  function pruneSurfaceTargetRefineCache(now = performance.now()) {
    for (const [key, entry] of surfaceTargetRefineCache) {
      if (!entry || now - Number(entry.t || 0) > 900) surfaceTargetRefineCache.delete(key);
    }
    if (surfaceTargetRefineCache.size <= 48) return;
    const ordered = [...surfaceTargetRefineCache.entries()].sort((a, b) => Number(a[1]?.t || 0) - Number(b[1]?.t || 0));
    while (ordered.length > 48) {
      const [key] = ordered.shift();
      surfaceTargetRefineCache.delete(key);
    }
  }

  function buildSurfaceTargetCandidates(surfaceId, point, extraPad = 0.05) {
    if (!point) return [];
    const base = clampPointToSurfaceSupport(surfaceId, point, extraPad) || point.clone();
    const surface = getNonFloorSurfaceById(surfaceId);
    if (!surface) return [base];

    const candidates = [];
    const seen = new Set();
    const pushCandidate = (candidate) => {
      const snapped = clampPointToSurfaceSupport(surfaceId, candidate, extraPad);
      if (!snapped) return;
      const key = `${Math.round(snapped.x * 100)}:${Math.round(snapped.z * 100)}`;
      if (seen.has(key)) return;
      seen.add(key);
      snapped.y = Math.max(0.02, Number.isFinite(surface?.y) ? Number(surface.y) : Number(point?.y) || 0.02);
      candidates.push(snapped);
    };

    pushCandidate(base);

    const spanX = Math.max(0.12, (Number(surface.maxX) - Number(surface.minX)) * 0.45);
    const spanZ = Math.max(0.12, (Number(surface.maxZ) - Number(surface.minZ)) * 0.45);
    const maxRadius = Math.min(0.28, Math.max(0.14, Math.min(spanX, spanZ)));
    const radii = [0.12, maxRadius];
    const dirs = 8;
    for (const r of radii) {
      for (let i = 0; i < dirs; i += 1) {
        const t = (i / dirs) * Math.PI * 2;
        pushCandidate(new THREE.Vector3(base.x + Math.cos(t) * r, base.y, base.z + Math.sin(t) * r));
      }
    }

    const center = clampPointToSurfaceSupport(
      surfaceId,
      new THREE.Vector3(
        (Number(surface.minX) + Number(surface.maxX)) * 0.5,
        Number.isFinite(surface?.y) ? Number(surface.y) : base.y,
        (Number(surface.minZ) + Number(surface.maxZ)) * 0.5
      ),
      extraPad
    );
    if (center) pushCandidate(center);
    return candidates;
  }

  function chooseBestSurfaceTargetCandidate(surfaceId, desiredPoint, sourceSurfaceId = null) {
    const sid = String(surfaceId || "floor");
    if (!desiredPoint || sid === "floor") return desiredPoint?.clone ? desiredPoint.clone() : null;
    const sourceId = normalizeSurfaceId(sourceSurfaceId || getCurrentCatSurfaceId() || sid);
    const base = clampPointToSurfaceSupport(sid, desiredPoint, 0.05) || (desiredPoint?.clone ? desiredPoint.clone() : null);
    if (!base) return desiredPoint?.clone ? desiredPoint.clone() : null;
    if (sourceId === sid) return base;

    const now = performance.now();
    pruneSurfaceTargetRefineCache(now);
    const cacheKey = [
      sid,
      sourceId,
      Math.round(Number(base.x || 0) * 20),
      Math.round(Number(base.z || 0) * 20),
      Math.round(Number(cat.pos?.x || 0) * 10),
      Math.round(Number(cat.pos?.z || 0) * 10),
    ].join('|');
    const cached = surfaceTargetRefineCache.get(cacheKey);
    if (cached?.point && now - Number(cached.t || 0) <= 900) return cached.point.clone();

    const surface = getNonFloorSurfaceById(sid);
    if (surface) {
      const edgePad = Math.max(0.02, CAT_COLLISION.catBodyRadius + 0.05);
      const clearanceX = Math.min(Math.abs(base.x - (Number(surface.minX) + edgePad)), Math.abs((Number(surface.maxX) - edgePad) - base.x));
      const clearanceZ = Math.min(Math.abs(base.z - (Number(surface.minZ) + edgePad)), Math.abs((Number(surface.maxZ) - edgePad) - base.z));
      const edgeClearance = Math.min(clearanceX, clearanceZ);
      if (Number.isFinite(edgeClearance) && edgeClearance >= 0.16) {
        surfaceTargetRefineCache.set(cacheKey, { t: now, point: base.clone() });
        return base;
      }
    }

    const sourceY = sourceId === "floor" ? 0 : Math.max(0.02, Number(cat.group.position.y) || 0.02);
    const fromPoint = new THREE.Vector3(cat.pos.x, sourceY, cat.pos.z);
    if (sourceId === "floor") {
      const safeStart = findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
      fromPoint.set(safeStart.x, 0, safeStart.z);
    }
    const avoidSurfaceIds = getAvoidSurfaceIdsForHop(sourceId, sid);

    if (typeof bestSurfaceJumpAnchor === "function" && typeof computeSurfaceJumpTargets === "function") {
      const directTargetPoint = new THREE.Vector3(base.x, 0, base.z);
      const directAnchor = bestSurfaceJumpAnchor(sid, fromPoint, directTargetPoint, sourceId, avoidSurfaceIds);
      if (directAnchor) {
        const directJumpTargets = computeSurfaceJumpTargets(sid, directAnchor, directTargetPoint, sourceId, avoidSurfaceIds);
        if (directJumpTargets?.top && String(directJumpTargets.surfaceId || sid) === sid) {
          surfaceTargetRefineCache.set(cacheKey, { t: now, point: base.clone() });
          return base;
        }
      }
    }

    const candidates = buildSurfaceTargetCandidates(sid, base, 0.05);
    if (!candidates.length) return base;
    const rankedCandidates = candidates
      .map((candidate) => {
        const dx = candidate.x - base.x;
        const dz = candidate.z - base.z;
        return { candidate, preScore: dx * dx + dz * dz };
      })
      .sort((a, b) => a.preScore - b.preScore)
      .slice(0, 6);

    let best = rankedCandidates[0]?.candidate || base;
    let bestScore = Infinity;

    for (const entry of rankedCandidates) {
      const candidate = entry.candidate;
      const targetPoint = new THREE.Vector3(candidate.x, 0, candidate.z);
      let score = entry.preScore;

      if (typeof bestSurfaceJumpAnchor === "function" && typeof computeSurfaceJumpTargets === "function") {
        const anchor = bestSurfaceJumpAnchor(sid, fromPoint, targetPoint, sourceId, avoidSurfaceIds);
        if (!anchor) {
          score += 50;
        } else {
          const jumpTargets = computeSurfaceJumpTargets(sid, anchor, targetPoint, sourceId, avoidSurfaceIds);
          if (!jumpTargets?.top) {
            score += 40;
          } else {
            const hopSurfaceId = String(jumpTargets.surfaceId || sid);
            if (hopSurfaceId === "floor") score += 30;
            else if (hopSurfaceId !== sid) score += 12;
            const anchorDx = Number(anchor.x || 0) - fromPoint.x;
            const anchorDz = Number(anchor.z || 0) - fromPoint.z;
            score += Math.sqrt(anchorDx * anchorDx + anchorDz * anchorDz) * 0.15;
          }
        }
      }

      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    surfaceTargetRefineCache.set(cacheKey, { t: now, point: best.clone() });
    return best;
  }

  function queuePatrolMoveTarget(target, sitSeconds = 0) {
    clearManualHoldState();
    const requestedSurfaceId = getMoveTargetSurfaceId(target);
    const targetsNonFloorSurface = isNonFloorSurfaceId(requestedSurfaceId);
    const surfaceTargetId = targetsNonFloorSurface ? requestedSurfaceId : FLOOR_SURFACE_ID;
    const preserveExactTarget = !!target?.exactTarget;
    const rawMovePoint = targetsNonFloorSurface
      ? new THREE.Vector3(target.point.x, Number(target.point?.y || 0.02), target.point.z)
      : (target?.floorPoint || target?.point || pickRandomPatrolPoint(cat.pos)).clone();
    const movePoint = targetsNonFloorSurface
      ? (
          preserveExactTarget
            ? (clampPointToSurfaceSupport(surfaceTargetId, rawMovePoint, 0.05) || rawMovePoint)
            : (chooseBestSurfaceTargetCandidate(
                surfaceTargetId,
                rawMovePoint,
                target?.sourceSurfaceId || getCurrentCatSurfaceId()
              ) || rawMovePoint)
        )
      : rawMovePoint;
    recordRoutePlannerEvent("route-queue-target", {
      nonFloorSurface: targetsNonFloorSurface ? 1 : 0,
      surfaceId: targetsNonFloorSurface ? surfaceTargetId : FLOOR_SURFACE_ID,
      targetX: movePoint.x,
      targetZ: movePoint.z,
    });

    const moveSurfaceY = Number(getNonFloorSurfaceById(surfaceTargetId)?.y);
    const moveY = targetsNonFloorSurface
      ? Math.max(0.02, Number.isFinite(moveSurfaceY) ? moveSurfaceY : Number(target.point?.y || 0.02))
      : 0;
    const finalSurfaceId = String(
      target?.finalSurfaceId || (targetsNonFloorSurface ? surfaceTargetId : FLOOR_SURFACE_ID)
    );
    const rawFinalPoint =
      target?.finalPoint || target?.point || target?.jumpLanding || target?.jumpAnchor || movePoint;
    const finalPoint = finalSurfaceId === "floor"
      ? new THREE.Vector3(rawFinalPoint.x, 0, rawFinalPoint.z)
      : (
          clampPointToSurfaceSupport(
            finalSurfaceId,
            new THREE.Vector3(
              rawFinalPoint.x,
              Math.max(0.02, Number(rawFinalPoint?.y || moveY || 0.02)),
              rawFinalPoint.z
            ),
            0.05
          ) || new THREE.Vector3(
            rawFinalPoint.x,
            Math.max(0.02, Number(rawFinalPoint?.y || moveY || 0.02)),
            rawFinalPoint.z
          )
        );

    traceFunction(
      "queuePatrolMoveTarget",
      `target=${requestedSurfaceId || FLOOR_SURFACE_ID} final=${finalSurfaceId} move=${movePoint.x.toFixed(2)},${movePoint.z.toFixed(2)}`
    );

    clearGroundBypassMode();

    const route = ensureNavRoute();
    route.active = true;
    route.source = String(target?.source || cat.state || "patrol");
    route.surfaceId = surfaceTargetId;
    route.y = moveY;
    route.finalSurfaceId = finalSurfaceId;
    route.finalY = targetsNonFloorSurface
      ? Math.max(0.02, Number(finalPoint?.y || moveY || target?.point?.y || 0.02))
      : 0;
    route.directJump = !!target?.directJump;
    route.approachSurfaceId =
      route.directJump && cat.group.position.y > 0.08
        ? String(getCurrentCatSurfaceId() || target?.sourceSurfaceId || route.surfaceId || "floor")
        : (targetsNonFloorSurface ? normalizeSurfaceId(target?.sourceSurfaceId || route.surfaceId) : FLOOR_SURFACE_ID);
    route.sitSeconds = sitSeconds;
    route.recoverAt = 0;
    route.createdAt = clockTime;
    route.blockedSince = 0;
    route.blockedReason = "";
    route.lastProgressAt = clockTime;
    route.lastProgressX = cat.pos.x;
    route.lastProgressZ = cat.pos.z;
    route.segmentProgressAt = clockTime;
    route.segmentProgressX = cat.pos.x;
    route.segmentProgressZ = cat.pos.z;
    route.segmentProgressDist = Infinity;
    route.target.copy(movePoint);
    route.target.y = moveY;
    route.finalTarget.copy(finalPoint);
    if (target?.jumpAnchor) route.jumpAnchor.copy(target.jumpAnchor);
    else route.jumpAnchor.copy(movePoint);
    if (target?.jumpLanding) route.landing.copy(target.jumpLanding);
    else route.landing.copy(movePoint);
    route.jumpOff.copy(route.landing);
    route.jumpDown.copy(movePoint);
    route.jumpDown.y = 0;
    route.jumpDownY = 0;
    buildRouteSegments(route, "queue-target");
    clearRouteInvalidation();
    syncLegacyScalarsFromRoute(route);

    cat.nav.stuckT = 0;
    cat.nav.noSteerFrames = 0;
    cat.nav.segmentBlockedFrames = 0;
    cat.nav.wholePathBlockedFrames = 0;
    cat.nav.noPathFrames = 0;
    cat.nav.repathAt = 0;

    cat.manualPatrolActive = false;
    if (!targetsNonFloorSurface && catIsOnNonFloorSurfaceNow()) {
      if (!refreshJumpDownLink(route.target, true, "floor")) {
        recordRoutePlannerEvent("route-queue-reject-no-jumpdown-link", {
          targetX: movePoint.x,
          targetZ: movePoint.z,
          fromSurfaceId: getCurrentCatSurfaceId(),
        });
        clearNavRoute("queue-reject-no-jumpdown-link");
        cat.status = "No jump-down link";
        return false;
      }
    } else if (targetsNonFloorSurface && cat.group.position.y > 0.08 && Math.abs(cat.group.position.y - getRouteTargetY(route)) > 0.12) {
      const needsJumpDownPlan = !(route.directJump && target?.jumpAnchor && target?.jumpLanding);
      if (needsJumpDownPlan && !refreshJumpDownLink(route.jumpAnchor, true, route.surfaceId)) {
        recordRoutePlannerEvent("route-queue-reject-no-surface-link", {
          targetX: movePoint.x,
          targetZ: movePoint.z,
          surfaceId: route.surfaceId,
        });
        clearNavRoute("queue-reject-no-surface-link");
        cat.status = "No surface link";
        return false;
      }
    }

    cat.state = "patrol";
    cat.lastState = "debugMove";
    cat.stateT = 0;
    cat.nav.debugDestination.set(movePoint.x, movePoint.y, movePoint.z);
    if (!targetsNonFloorSurface && !catHasTrackedNonFloorSurface() && cat.group.position.y <= 0.08) {
      ensureCatPath(route.target, true, true);
    }
    return true;
  }

  function requestSharedMoveRoute(finalSurfaceId, finalPoint, sitSeconds = 0, opts = null) {
    if (!finalPoint) return false;
    const source = String(opts?.source || cat.state || "patrol");
    const forceReplan = !!opts?.forceReplan;
    const activeRoute = getActiveNavRoute();
    const resolvedFinalSurfaceId = normalizeSurfaceId(finalSurfaceId || FLOOR_SURFACE_ID);
    const sameRoute =
      !!activeRoute &&
      String(activeRoute.source || "") === source &&
      hasMatchingActiveRoute(resolvedFinalSurfaceId, finalPoint);

    traceFunction(
      "requestSharedMoveRoute",
      `src=${source} dst=${resolvedFinalSurfaceId} target=${Number(finalPoint.x).toFixed(2)},${Number(finalPoint.z).toFixed(2)} same=${sameRoute ? 1 : 0}`
    );

    if (!forceReplan && sameRoute) {
      activeRoute.sitSeconds = sitSeconds;
      syncLegacyScalarsFromRoute(activeRoute);
      return true;
    }

    const resolvedFinalPoint = makeRoutePointForSurface(
      resolvedFinalSurfaceId,
      resolvedFinalSurfaceId === FLOOR_SURFACE_ID
        ? new THREE.Vector3(finalPoint.x, 0, finalPoint.z)
        : new THREE.Vector3(
            finalPoint.x,
            Math.max(0.02, Number.isFinite(finalPoint?.y) ? Number(finalPoint.y) : 0.02),
            finalPoint.z
          )
    ) || finalPoint.clone();

    return planElevatedHopToFinalTarget(resolvedFinalSurfaceId, resolvedFinalPoint, sitSeconds, {
      ...(opts || {}),
      source,
      forceReplan,
    });
  }

  function consumePendingSharedRouteRequest() {
    const request = cat.nav?.pendingSharedRouteRequest;
    if (!request || !request.finalPoint) return false;
    cat.nav.pendingSharedRouteRequest = null;

    const finalSurfaceId = String(request.finalSurfaceId || "floor");
    const requestedPoint = request.finalPoint;
    const finalPoint = requestedPoint?.clone
      ? requestedPoint.clone()
      : new THREE.Vector3(
          Number(requestedPoint?.x) || 0,
          Number(requestedPoint?.y) || 0,
          Number(requestedPoint?.z) || 0
        );
    const source = String(request.source || "debug-click");
    const sitSeconds = Number.isFinite(request.sitSeconds) ? Number(request.sitSeconds) : 0;
    const forceReplan = request.forceReplan !== false;

    const ok = requestSharedMoveRoute(finalSurfaceId, finalPoint, sitSeconds, {
      source,
      forceReplan,
    });

    if (ok) {
      cat.manualPatrolActive = false;
      cat.state = "patrol";
      cat.lastState = String(request.lastState || "debugMove");
      cat.stateT = 0;
      cat.phaseT = 0;
      cat.nav.debugDestination.set(
        finalPoint.x,
        finalSurfaceId === "floor" ? 0 : Number(finalPoint.y || 0.02),
        finalPoint.z
      );
      return true;
    }

    cat.status = request.failStatus ? String(request.failStatus) : "No route";
    return true;
  }

  function getRoutePlanningIntent(route = null) {
    const activeRoute = route || getActiveNavRoute();
    if (!activeRoute?.finalTarget?.clone) return null;
    const finalSurfaceId = normalizeSurfaceId(activeRoute.finalSurfaceId || activeRoute.surfaceId || FLOOR_SURFACE_ID);
    const finalPoint = activeRoute.finalTarget.clone();
    finalPoint.y = finalSurfaceId === "floor" ? 0 : getRouteFinalY(activeRoute);
    return {
      finalSurfaceId,
      finalPoint,
      sitSeconds: Number(activeRoute.sitSeconds || 0),
      source: String(activeRoute.source || cat.state || "patrol"),
    };
  }

  function requestFreshRouteFromIntent(intent, opts = null) {
    if (!intent?.finalPoint) return false;
    const reason = String(opts?.reason || "route-refresh");
    const finalSurfaceId = String(intent.finalSurfaceId || "floor");
    const finalPoint = intent.finalPoint.clone ? intent.finalPoint.clone() : new THREE.Vector3(
      Number(intent.finalPoint.x || 0),
      Number(intent.finalPoint.y || 0),
      Number(intent.finalPoint.z || 0)
    );
    recordRoutePlannerEvent("route-refresh-request", {
      reason,
      finalSurfaceId,
      targetX: finalPoint.x,
      targetY: finalPoint.y,
      targetZ: finalPoint.z,
      source: intent.source || "",
      forceReplan: opts?.forceReplan ? 1 : 0,
    });
    const ok = requestSharedMoveRoute(finalSurfaceId, finalPoint, intent.sitSeconds, {
      source: intent.source,
      forceReplan: !!opts?.forceReplan,
    });
    recordRoutePlannerEvent(ok ? "route-refresh-queued" : "route-refresh-failed", {
      reason,
      finalSurfaceId,
      targetX: finalPoint.x,
      targetY: finalPoint.y,
      targetZ: finalPoint.z,
      source: intent.source || "",
    });
    return ok;
  }

  function planElevatedHopToFinalTarget(finalSurfaceId, finalPoint, sitSeconds = 0, opts = null) {
    if (!finalSurfaceId || !finalPoint) return false;
    const routeSource = String(opts?.source || cat.state || "patrol");
    const sourceSurfaceId = getCurrentCatSurfaceId();
    traceFunction(
      "planElevatedHopToFinalTarget",
      `src=${sourceSurfaceId || "na"} dst=${String(finalSurfaceId)} target=${Number(finalPoint.x).toFixed(2)},${Number(finalPoint.z).toFixed(2)}`
    );
    const forceReplan = !!(opts && opts.forceReplan);
    const preserveExactTarget = !!(opts && opts.preserveExactTarget);
    if (!forceReplan && hasMatchingActiveRoute(finalSurfaceId, finalPoint)) {
      recordRoutePlannerEvent("route-plan-skip-existing", {
        finalSurfaceId: String(finalSurfaceId),
        targetX: finalPoint.x,
        targetZ: finalPoint.z,
      });
      return true;
    }
    if (!forceReplan && shouldSkipRecentHopPlan(sourceSurfaceId, finalSurfaceId, finalPoint)) {
      recordRoutePlannerEvent("route-plan-skip-cooldown", {
        sourceSurfaceId,
        finalSurfaceId: String(finalSurfaceId),
        targetX: finalPoint.x,
        targetZ: finalPoint.z,
      });
      return true;
    }
    cat.nav.lastHopPlanKey = makeHopPlanRequestKey(sourceSurfaceId, finalSurfaceId, finalPoint);
    cat.nav.lastHopPlanAt = clockTime;
    const sourceY = sourceSurfaceId === "floor" ? 0 : Math.max(0.02, cat.group.position.y);
    const fromPoint = new THREE.Vector3(cat.pos.x, sourceY, cat.pos.z);
    if (sourceSurfaceId === "floor") {
      const safeStart = findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
      fromPoint.set(safeStart.x, 0, safeStart.z);
    }
    const rawFinalPoint = new THREE.Vector3(
      finalPoint.x,
      finalSurfaceId === FLOOR_SURFACE_ID
        ? 0
        : Math.max(0.02, Number(finalPoint.y || sourceY || 0.02)),
      finalPoint.z
    );
    const clampedFinalPoint = preserveExactTarget
      ? rawFinalPoint.clone()
      : (chooseBestSurfaceTargetCandidate(finalSurfaceId, rawFinalPoint, sourceSurfaceId) || rawFinalPoint);
    const finalRoutePoint = makeRoutePointForSurface(finalSurfaceId, clampedFinalPoint) || clampedFinalPoint.clone();
    finalRoutePoint.y =
      finalSurfaceId === FLOOR_SURFACE_ID
        ? 0
        : Math.max(0.02, Number(finalRoutePoint.y || clampedFinalPoint.y || sourceY || 0.02));
    const targetPoint = new THREE.Vector3(finalRoutePoint.x, 0, finalRoutePoint.z);
    recordRoutePlannerEvent("route-plan-attempt", {
      sourceSurfaceId,
      finalSurfaceId: String(finalSurfaceId),
      targetX: targetPoint.x,
      targetZ: targetPoint.z,
    });
    const avoidSurfaceIds = getAvoidSurfaceIdsForHop(sourceSurfaceId, finalSurfaceId);

    if (sourceSurfaceId === finalSurfaceId) {
      const surface = getNonFloorSurfaceById(finalSurfaceId);
      const targetY = Number.isFinite(surface?.y)
        ? surface.y
        : Math.max(0.02, Number(finalRoutePoint.y || sourceY));
      return queuePatrolMoveTarget(
        {
          surfaceId: finalSurfaceId,
          point: new THREE.Vector3(targetPoint.x, targetY, targetPoint.z),
          finalSurfaceId,
          finalPoint: new THREE.Vector3(targetPoint.x, targetY, targetPoint.z),
          exactTarget: preserveExactTarget,
          directJump: false,
          sourceSurfaceId,
          source: routeSource,
        },
        sitSeconds
      );
    }

    const surfacePath =
      typeof findSurfacePath === "function"
        ? findSurfacePath(finalSurfaceId, sourceSurfaceId, avoidSurfaceIds)
        : null;
    if (!Array.isArray(surfacePath) || surfacePath.length < 2) {
      recordRoutePlannerEvent("route-plan-fail-no-surface-path", {
        sourceSurfaceId,
        finalSurfaceId: String(finalSurfaceId),
      });
      return false;
    }

    const nextSurfaceId = normalizeSurfaceId(surfacePath[1] || finalSurfaceId);
    if (!nextSurfaceId || nextSurfaceId === sourceSurfaceId) {
      recordRoutePlannerEvent("route-plan-fail-bad-surface-path", {
        sourceSurfaceId,
        finalSurfaceId: String(finalSurfaceId),
      });
      return false;
    }

    if (nextSurfaceId === FLOOR_SURFACE_ID) {
      let hopFloorPoint =
        makeRoutePointForSurface(FLOOR_SURFACE_ID, finalRoutePoint) ||
        new THREE.Vector3(finalRoutePoint.x, 0, finalRoutePoint.z);
      if (
        sourceSurfaceId !== FLOOR_SURFACE_ID &&
        typeof computeSurfaceJumpDownTargets === "function"
      ) {
        const jumpDownPlan =
          computeSurfaceJumpDownTargets(
            sourceSurfaceId,
            fromPoint,
            finalRoutePoint,
            FLOOR_SURFACE_ID
          ) ||
          computeSurfaceJumpDownTargets(
            sourceSurfaceId,
            fromPoint,
            null,
            FLOOR_SURFACE_ID
          );
        if (!jumpDownPlan?.jumpFrom) {
          recordRoutePlannerEvent("route-plan-fail-no-floor-landing", {
            sourceSurfaceId,
            finalSurfaceId: String(finalSurfaceId),
            nextSurfaceId: FLOOR_SURFACE_ID,
          });
          return false;
        }
        hopFloorPoint =
          makeRoutePointForSurface(FLOOR_SURFACE_ID, jumpDownPlan.jumpFrom) ||
          new THREE.Vector3(jumpDownPlan.jumpFrom.x, 0, jumpDownPlan.jumpFrom.z);
      }
      const queued = queuePatrolMoveTarget(
        {
          surfaceId: FLOOR_SURFACE_ID,
          point: hopFloorPoint.clone(),
          floorPoint: hopFloorPoint.clone(),
          finalSurfaceId,
          finalPoint: finalRoutePoint.clone(),
          source: routeSource,
        },
        sitSeconds
      );
      if (queued) {
        recordSurfaceHop(sourceSurfaceId, FLOOR_SURFACE_ID);
        recordRoutePlannerEvent("route-plan-queued-surface-bfs-floor-hop", {
          sourceSurfaceId,
          finalSurfaceId: String(finalSurfaceId),
          hopSurfaceId: FLOOR_SURFACE_ID,
          hopX: hopFloorPoint.x,
          hopZ: hopFloorPoint.z,
        });
      }
      return queued;
    }

    const desiredNextHopPoint =
      nextSurfaceId === finalSurfaceId
        ? finalRoutePoint.clone()
        : (makeRoutePointForSurface(nextSurfaceId, finalRoutePoint) || finalRoutePoint.clone());
    const hopTargetCandidates = buildSurfaceTargetCandidates(nextSurfaceId, desiredNextHopPoint, 0.05);
    if (!hopTargetCandidates.length) hopTargetCandidates.push(desiredNextHopPoint.clone());

    let lastFailureKind = "route-plan-fail-no-anchor";
    let lastFailureData = {
      sourceSurfaceId,
      finalSurfaceId: String(finalSurfaceId),
      nextSurfaceId: String(nextSurfaceId),
    };

    for (let candidateIndex = 0; candidateIndex < hopTargetCandidates.length; candidateIndex += 1) {
      const candidatePoint = hopTargetCandidates[candidateIndex];
      const nextHopTarget = new THREE.Vector3(candidatePoint.x, 0, candidatePoint.z);
      const jumpAnchor =
        typeof bestSurfaceJumpAnchor === "function"
          ? bestSurfaceJumpAnchor(
              nextSurfaceId,
              fromPoint,
              nextHopTarget,
              sourceSurfaceId,
              avoidSurfaceIds
            )
          : null;
      if (!jumpAnchor || typeof computeSurfaceJumpTargets !== "function") {
        lastFailureKind = "route-plan-fail-no-anchor";
        lastFailureData = {
          sourceSurfaceId,
          finalSurfaceId: String(finalSurfaceId),
          nextSurfaceId: String(nextSurfaceId),
          candidateIndex,
        };
        continue;
      }

      const jumpTargets = computeSurfaceJumpTargets(
        nextSurfaceId,
        jumpAnchor,
        nextHopTarget,
        sourceSurfaceId,
        avoidSurfaceIds
      );
      if (!jumpTargets?.top) {
        lastFailureKind = "route-plan-fail-no-jump-targets";
        lastFailureData = {
          sourceSurfaceId,
          finalSurfaceId: String(finalSurfaceId),
          nextSurfaceId: String(nextSurfaceId),
          anchorX: jumpAnchor.x,
          anchorZ: jumpAnchor.z,
          candidateIndex,
        };
        continue;
      }

      const hopSurfaceId = normalizeSurfaceId(jumpTargets.surfaceId || nextSurfaceId);
      if (hopSurfaceId !== nextSurfaceId) {
        lastFailureKind = "route-plan-fail-surface-path-mismatch";
        lastFailureData = {
          sourceSurfaceId,
          finalSurfaceId: String(finalSurfaceId),
          nextSurfaceId: String(nextSurfaceId),
          hopSurfaceId: String(hopSurfaceId),
          candidateIndex,
        };
        continue;
      }
      if (hopSurfaceId === FLOOR_SURFACE_ID) {
        lastFailureKind = "route-plan-fail-unexpected-floor-hop";
        lastFailureData = {
          sourceSurfaceId,
          finalSurfaceId: String(finalSurfaceId),
          nextSurfaceId: String(nextSurfaceId),
          candidateIndex,
        };
        continue;
      }

      const hopSurface = getNonFloorSurfaceById(hopSurfaceId);
      const hopY = Number.isFinite(hopSurface?.y)
        ? hopSurface.y
        : Math.max(0.02, Number(jumpTargets.top.y || desiredNextHopPoint.y || finalRoutePoint.y || sourceY));
      const hopPoint = hopSurfaceId === finalSurfaceId
        ? new THREE.Vector3(finalRoutePoint.x, hopY, finalRoutePoint.z)
        : new THREE.Vector3(jumpTargets.top.x, hopY, jumpTargets.top.z);

      const queued = queuePatrolMoveTarget(
        {
          surfaceId: hopSurfaceId,
          point: hopPoint,
          finalSurfaceId,
          finalPoint: finalRoutePoint.clone(),
          exactTarget: preserveExactTarget && hopSurfaceId === finalSurfaceId,
          jumpAnchor,
          jumpLanding: jumpTargets.top,
          directJump: sourceSurfaceId !== FLOOR_SURFACE_ID,
          sourceSurfaceId,
          source: routeSource,
        },
        sitSeconds
      );
      if (!queued) {
        lastFailureKind = "route-plan-fail-queue-hop";
        lastFailureData = {
          sourceSurfaceId,
          finalSurfaceId: String(finalSurfaceId),
          nextSurfaceId: String(nextSurfaceId),
          hopSurfaceId,
          candidateIndex,
        };
        continue;
      }

      recordSurfaceHop(sourceSurfaceId, hopSurfaceId);
      recordRoutePlannerEvent("route-plan-queued-hop", {
        sourceSurfaceId,
        finalSurfaceId: String(finalSurfaceId),
        hopSurfaceId,
        hopX: hopPoint.x,
        hopZ: hopPoint.z,
        candidateIndex,
      });
      return true;
    }

    recordRoutePlannerEvent(lastFailureKind, lastFailureData);
    return false;
  }

  function hasReachedTrueFinalDestination(route, finalSurfaceId, finalTarget, planarThreshold = null) {
    const resolvedFinalSurfaceId = String(finalSurfaceId || route?.finalSurfaceId || "floor");
    const currentSurfaceId = normalizeSurfaceId(getCurrentCatSurfaceId() || route?.surfaceId || route?.finalSurfaceId);
    if (resolvedFinalSurfaceId !== currentSurfaceId) return false;

    const targetX = Number.isFinite(finalTarget?.x) ? Number(finalTarget.x) : cat.pos.x;
    const targetZ = Number.isFinite(finalTarget?.z) ? Number(finalTarget.z) : cat.pos.z;
    const dx = targetX - cat.pos.x;
    const dz = targetZ - cat.pos.z;
    const resolvedPlanarThreshold = Number.isFinite(planarThreshold) ? planarThreshold : getArrivalSnapRadius(resolvedFinalSurfaceId);
    if (dx * dx + dz * dz > resolvedPlanarThreshold * resolvedPlanarThreshold) return false;

    return isCatAlignedToSurface(
      resolvedFinalSurfaceId,
      finalTarget || route?.finalTarget || null,
      resolvedFinalSurfaceId === FLOOR_SURFACE_ID ? 0.08 : ARRIVAL_SNAP_Y_ELEVATED
    );
  }

  function enterCatnipDistractedState(arrivalPoint = null, arrivalSurfaceId = null) {
    const resolvedSurfaceId = normalizeSurfaceId(arrivalSurfaceId || getCurrentCatSurfaceId());
    let arrivalX = Number.isFinite(arrivalPoint?.x) ? Number(arrivalPoint.x) : cat.pos.x;
    let arrivalZ = Number.isFinite(arrivalPoint?.z) ? Number(arrivalPoint.z) : cat.pos.z;
    let arrivalY =
      resolvedSurfaceId === "floor"
        ? 0
        : Math.max(0.02, Number.isFinite(arrivalPoint?.y) ? Number(arrivalPoint.y) : cat.group.position.y || 0.02);

    if (resolvedSurfaceId === "floor" && game.catnip) {
      arrivalX = cat.pos.x;
      arrivalZ = cat.pos.z;
      arrivalY = 0;
    }

    clearNavRoute("reached-catnip");
    cat.manualPatrolActive = false;
    clearGroundBypassMode();
    clearCatJumpTargets();
    clearCatNavPath(false);
    cat.nav.catnipBlockedSince = 0;
    cat.nav.catnipUseExactTarget = false;
    cat.nav.catnipRecoverUntil = 0;
    cat.nav.catnipIdleBlendUntil = 0;
    markCatSurfaceId(resolvedSurfaceId, "catnip-arrival", 1.2);
    setAuthoritativeCatSurfaceId(resolvedSurfaceId, "catnip-arrival", 1.6);

    // Preserve the true arrived planar position on every surface so the
    // movement handoff into eating does not visibly hop forward/backward.
    arrivalX = cat.pos.x;
    arrivalZ = cat.pos.z;
    const snapDx = arrivalX - cat.pos.x;
    const snapDz = arrivalZ - cat.pos.z;
    const snapDistSq = snapDx * snapDx + snapDz * snapDz;
    const shouldSnapToCatnipTarget =
      snapDistSq > 0.08 * 0.08 || Math.abs((cat.group.position.y || 0) - arrivalY) > 0.06;
    if (shouldSnapToCatnipTarget) {
      cat.pos.x = arrivalX;
      cat.pos.z = arrivalZ;
      cat.group.position.set(arrivalX, arrivalY, arrivalZ);
    }
    cat.state = "distracted";
    cat.phaseT = 0;
    cat.stateT = 0;
    cat.status = "Eating catnip";
    cat.nav.arrivalHoldUntil = clockTime + ROUTE_FINISH_SETTLE;
    return true;
  }

  function resumePatrolAfterCatnip() {
    cat.nav.catnipRecoverUntil = 0;
    cat.nav.catnipIdleBlendUntil = 0;
    const currentSurfaceId = getCurrentCatSurfaceId();
    const onElevatedNow = currentSurfaceId !== "floor" || cat.group.position.y > 0.08;
    if (onElevatedNow) {
      markCatSurfaceId(
        currentSurfaceId || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk",
        "jump-down-plan",
        0.4
      );
      clearNavRoute("catnip-finish-return-patrol");
      cat.manualPatrolActive = false;
      clearCatJumpTargets();
      clearCatNavPath(false);
      if (!setNextPatrolTarget(true)) {
        enterNoPathSit(0.85);
        return;
      }
      cat.state = "patrol";
      cat.phaseT = 0;
      cat.status = "Patrolling";
      return;
    }

    markCatSurfaceId(FLOOR_SURFACE_ID, "catnip-finish-floor", 0.2);
    clearNavRoute("catnip-finish-floor");
    cat.manualPatrolActive = false;
    clearCatJumpTargets();
    clearCatNavPath(false);
    cat.state = "patrol";
    cat.phaseT = 0;
    if (!setNextPatrolTarget(true)) enterNoPathSit(0.85);
    cat.status = "Patrolling";
  }

  function getCatnipRecoverDuration() {
    const recoverAction = cat.stateClipActions?.eatRecover?.action;
    const recoverSpeed = Math.max(0.01, Number(cat.stateClipActions?.eatRecover?.speed || 1));
    const clipDur = Number(recoverAction?.getClip?.()?.duration || 0);
    if (clipDur > 0.01) return clipDur / recoverSpeed;
    return CATNIP_RECOVER_DUR;
  }

  function finalizeSourceArrival(route, finalSurfaceId, finalTarget) {
    const source = String(route?.source || "");
    if (source === "catnip") {
      if (!hasReachedTrueFinalDestination(route, finalSurfaceId, finalTarget)) return false;
      return enterCatnipDistractedState(finalTarget, finalSurfaceId);
    }
    if (source === "cup") {
      if (!hasReachedTrueFinalDestination(route, finalSurfaceId, finalTarget)) return false;
      clearNavRoute("reached-cup-approach");
      cat.manualPatrolActive = false;
      clearGroundBypassMode();
      clearCatJumpTargets();
      clearCatNavPath(false);
      markCatSurfaceId("desk", "cup-arrival", 0.8);
      setAuthoritativeCatSurfaceId("desk", "cup-arrival", 1.1);
      cat.state = "toCup";
      cat.phaseT = 0;
      cat.stateT = 0;
      cat.status = "Lining up swipe";
      return true;
    }
    return false;
  }

  function updatePatrolMoveTarget(stepDt) {
    const route = getActiveNavRoute();
    if (!route) return false;
    const targetY = getRouteTargetY(route);
    const tryRecoverTowardFinalTarget = (invalidation = null) => {
      if (clockTime < route.recoverAt) {
        cat.status = "Re-routing";
        return true;
      }

      if (invalidation) {
        recordRoutePlannerEvent("route-invalidation-consumed", {
          kind: invalidation.kind || "route-refresh",
          count: invalidation.count || 1,
          targetX: invalidation.target?.x,
          targetZ: invalidation.target?.z,
          useDynamic: invalidation.useDynamic ? 1 : 0,
        });
      }

      const intent = getRoutePlanningIntent(route);
      const rerouted = !!intent && requestFreshRouteFromIntent(intent, {
        reason: invalidation?.kind || "recover-route",
        forceReplan: true,
      });

      const recoverRoute = getActiveNavRoute() || route;
      recoverRoute.recoverAt = clockTime + (rerouted ? 0.24 : 0.55);
      syncLegacyScalarsFromRoute(recoverRoute);
      if (rerouted) {
        cat.status = "Re-routing";
        return true;
      }

      clearNavRoute("recover-failed");
      cat.manualPatrolActive = false;
      clearCatNavPath(true);
      return false;
    };
    const recoverRouteIfNeeded = () => {
      const invalidation = getPendingRouteInvalidation();
      const needsRecovery = !!invalidation || hasConfirmedRouteFailure(route);
      if (!needsRecovery) return null;
      if (invalidation && clockTime < route.recoverAt) {
        cat.status = "Re-routing";
        return true;
      }
      const handled = tryRecoverTowardFinalTarget(invalidation);
      if (invalidation && clockTime >= route.recoverAt) {
        clearRouteInvalidation();
      }
      return handled;
    };

    const refreshJumpUpLink = (force = false) => {
      const nextSurfaceId = normalizeSurfaceId(route.surfaceId || route.finalSurfaceId);
      if (!nextSurfaceId || nextSurfaceId === FLOOR_SURFACE_ID) return false;
      if (!force && clockTime < (cat.nav.jumpUpPlanAt || 0)) return true;

      const supportSurfaceId = normalizeSurfaceId(
        getCurrentCatSurfaceId() || route.approachSurfaceId || FLOOR_SURFACE_ID
      );
      const desiredTopPoint =
        (route.target?.clone ? route.target.clone() : null) ||
        (route.finalTarget?.clone ? route.finalTarget.clone() : null);
      const jumpAnchor =
        typeof bestSurfaceJumpAnchor === "function"
          ? bestSurfaceJumpAnchor(
              nextSurfaceId,
              cat.pos,
              desiredTopPoint,
              supportSurfaceId
            )
          : null;
      const jumpTargets =
        jumpAnchor && typeof computeSurfaceJumpTargets === "function"
          ? computeSurfaceJumpTargets(
              nextSurfaceId,
              jumpAnchor,
              desiredTopPoint,
              supportSurfaceId
            )
          : null;
      const ok = !!jumpAnchor && !!jumpTargets?.top;
      cat.nav.jumpUpPlanAt = clockTime + (force ? 0.08 : 0.14);
      if (!ok) return false;

      route.jumpAnchor.copy(jumpAnchor);
      route.landing.copy(jumpTargets.top);
      route.approachSurfaceId = supportSurfaceId;
      syncLegacyScalarsFromRoute(route);
      return true;
    };

    const initialRecovery = recoverRouteIfNeeded();
    if (initialRecovery != null) {
      if (!initialRecovery) return false;
      animateCatPose(stepDt, false);
      return true;
    }

    let segment = getActiveRouteSegment(route);
    if (!segment) {
      buildRouteSegments(route, "rebuild-missing");
      syncLegacyScalarsFromRoute(route);
      segment = getActiveRouteSegment(route);
      if (!segment) return false;
    }

    if (!catHasTrackedNonFloorSurface() && cat.group.position.y > 0.08) {
      markCatSurfaceId(getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk", "jump-down-plan", 0.4);
    }

    const finalizeRouteArrival = (arrivalSurfaceId = null) => {
      const finalSurfaceId = normalizeSurfaceId(route.finalSurfaceId || route.surfaceId || arrivalSurfaceId || FLOOR_SURFACE_ID);
      const finalY = finalSurfaceId === FLOOR_SURFACE_ID ? 0 : getRouteFinalY(route);
      const finalTarget = route.finalTarget?.clone
        ? route.finalTarget.clone()
        : new THREE.Vector3(cat.pos.x, finalY, cat.pos.z);
      finalTarget.y = finalY;
      const routeSource = String(route.source || "");
      traceFunction(
        "finalizeRouteArrival",
        `src=${routeSource || "na"} arrival=${normalizeSurfaceId(arrivalSurfaceId || route.surfaceId || FLOOR_SURFACE_ID)} final=${finalSurfaceId}`
      );
      if (finalizeSourceArrival(route, finalSurfaceId, finalTarget)) return true;
      const finalReached = hasReachedTrueFinalDestination(route, finalSurfaceId, route.finalTarget, 0.12);
      if (!finalReached) {
        const intent = getRoutePlanningIntent(route);
        if (
          intent && requestFreshRouteFromIntent(intent, {
            reason: arrivalSurfaceId && normalizeSurfaceId(arrivalSurfaceId) !== finalSurfaceId
              ? "continue-from-hop-to-final-surface"
              : "continue-to-final-surface",
            forceReplan: true,
          })
        ) {
          cat.status = "Re-routing";
          return true;
        }
        enterNoPathSit();
        return true;
      }
      clearNavRoute("reached-route-target");
      cat.manualPatrolActive = false;
      markCatSurfaceId(finalSurfaceId, "route-arrival", 0.3);
      if (routeSource === "debug-click") {
        const arrivalPoint = finalTarget.clone();
        cat.pos.x = arrivalPoint.x;
        cat.pos.z = arrivalPoint.z;
        cat.group.position.set(arrivalPoint.x, finalY, arrivalPoint.z);
        clearManualHoldState();
        setAuthoritativeCatSurfaceId(finalSurfaceId, "debug-click-arrival", 0.8);
        cat.debugMoveActive = false;
        cat.debugMoveSurfaceId = finalSurfaceId;
        cat.debugMoveFinalSurfaceId = finalSurfaceId;
        cat.debugMoveY = finalY;
        cat.debugMoveFinalY = finalY;
        cat.debugMoveTarget.set(arrivalPoint.x, finalY, arrivalPoint.z);
        cat.debugMoveFinalTarget.set(arrivalPoint.x, finalY, arrivalPoint.z);
        cat.manualPatrolActive = false;
        cat.nav.arrivalHoldUntil = 0;
        cat.status = "Patrolling";
        cat.nav.lastSpeed = 0;
        cat.nav.commandedSpeed = 0;
        cat.nav.driveSpeed = 0;
        cat.nav.speedNorm = 0;
        cat.nav.smoothedSpeed = 0;
        cat.nav.turnOnlyT = 0;
        clearCatNavPath(false);
        if (!setNextPatrolTarget(true)) {
          enterNoPathSit(0.85);
        }
        return true;
      }
      const sitSeconds = route.sitSeconds;
      if (sitSeconds > 0.05) {
        cat.sitDuration = sitSeconds;
        cat.state = "sit";
        cat.phaseT = 0;
      } else if (!setNextPatrolTarget(true)) {
        enterNoPathSit(0.85);
      }
      return true;
    };

    const handleRecoveryDuringMotion = () => {
      const recovered = recoverRouteIfNeeded();
      if (recovered != null) {
        if (!recovered) return false;
        if (cat.status === "Re-routing") {
          animateCatPose(stepDt, false);
          return true;
        }
      }
      return null;
    };

    switch (segment.kind) {
      case "jump-up-approach": {
        const supportSurfaceId = String(
          segment.supportSurfaceId || getCurrentCatSurfaceId() || route.surfaceId || FLOOR_SURFACE_ID
        );
        const shouldRefreshJumpLink = clockTime >= (cat.nav.jumpUpPlanAt || 0);
        if (shouldRefreshJumpLink && !refreshJumpUpLink(false)) {
          const recovered = tryRecoverTowardFinalTarget({
            kind: "no-jumpup-link",
            count: 1,
            target: route.finalTarget,
            useDynamic: true,
          });
          if (!recovered) return false;
          cat.status = "Re-routing";
          animateCatPose(stepDt, false);
          return true;
        }

        const jumpAnchor = route[segment.pointKey] || route.jumpAnchor;
        const approachSurfaceId = normalizeSurfaceId(supportSurfaceId || getCurrentCatSurfaceId() || FLOOR_SURFACE_ID);
        const usingElevatedApproach = !isFloorSurfaceId(approachSurfaceId);
        const reachedJumpAnchor = moveCatTowardSurfaceTarget(jumpAnchor, stepDt, 0.9, approachSurfaceId, {
          direct: false,
          ignoreDynamic: false,
          allowEndpointPushableGoal: false,
        });
        const nearJumpAnchor =
          (jumpAnchor.x - cat.pos.x) ** 2 + (jumpAnchor.z - cat.pos.z) ** 2 < 0.14 * 0.14;
        const readyToJump = reachedJumpAnchor || nearJumpAnchor;
        cat.status = "Approaching jump point";
        animateCatPose(stepDt, !readyToJump);
        if (!readyToJump) {
          const handled = handleRecoveryDuringMotion();
          if (handled != null) return handled;
        }
        if (readyToJump) {
          if (!refreshJumpUpLink(true)) {
            const recovered = tryRecoverTowardFinalTarget({
              kind: "jumpup-link-blocked",
              count: 1,
              target: route.finalTarget,
              useDynamic: true,
            });
            if (!recovered) return false;
            cat.status = "Re-routing";
            animateCatPose(stepDt, false);
            return true;
          }
          route.directJump = false;
          route.approachSurfaceId = approachSurfaceId;
          advanceRouteSegment(route, "jump-up-started");
          syncLegacyScalarsFromRoute(route);
          clearCatNavPath(false);
          startJump(route[segment.landingKey] || route.landing, targetY, 0.64, 0.46, "patrol", {
            easePos: true,
            easeY: true,
            preventSurfaceClip: usingElevatedApproach,
            fromSurfaceId: approachSurfaceId,
            toSurfaceId: String(route.surfaceId || route.finalSurfaceId || "desk"),
          });
          cat.status = usingElevatedApproach ? "Jumping across" : "Jumping up";
        }
        return true;
      }

      case "jump-down-approach": {
        const towardPoint = route[segment.towardKey] || route.target;
        const desiredLandingSurfaceId = String(
          segment.desiredLandingSurfaceId || route.surfaceId || FLOOR_SURFACE_ID
        );
        if (!refreshJumpDownLink(towardPoint, false, desiredLandingSurfaceId)) {
          if (routeTargetsNonFloorSurface(route)) {
            recordRoutePlannerEvent("route-move-reject-no-jumpdown-link", {
              surfaceId: route.surfaceId,
              finalSurfaceId: route.finalSurfaceId,
              targetX: route.target.x,
              targetZ: route.target.z,
            });
          }
          route.recoverAt = 0;
          const recovered = tryRecoverTowardFinalTarget({
            kind: "no-jumpdown-link",
            count: 1,
            target: route.finalTarget,
            useDynamic: true,
          });
          if (!recovered) return false;
          cat.status = routeTargetsNonFloorSurface(route) ? "Re-routing" : "No jump-down link";
          animateCatPose(stepDt, false);
          return true;
        }
        const jumpOffSurfaceId = String(getCurrentCatSurfaceId() || route.surfaceId || "desk");
        const clampedJumpOff =
          clampPointToSurfaceSupport(
            jumpOffSurfaceId,
            new THREE.Vector3(route.jumpOff.x, 0, route.jumpOff.z),
            0.05
          ) || null;
        if (clampedJumpOff) {
          route.jumpOff.set(clampedJumpOff.x, Number(route.jumpOff.y || 0), clampedJumpOff.z);
        }
        const elevatedY = Math.max(0.02, cat.group.position.y);
        const reachedJumpOff = moveCatToward(route.jumpOff, stepDt, 0.84, elevatedY, {
          direct: true,
          ignoreDynamic: true,
          supportSurfaceId: getCurrentCatSurfaceId(),
        });
        const dropDx = route.jumpOff.x - cat.pos.x;
        const dropDz = route.jumpOff.z - cat.pos.z;
        const distToDrop = Math.hypot(dropDx, dropDz);
        const nearDrop = dropDx * dropDx + dropDz * dropDz < 0.16 * 0.16;
        const commanded = Number.isFinite(cat.nav?.commandedSpeed) ? cat.nav.commandedSpeed : 0;
        const actual = Number.isFinite(cat.nav?.lastSpeed) ? cat.nav.lastSpeed : 0;
        const stalledWhileNear = distToDrop < 0.28 && commanded > 0.12 && actual < 0.01;
        cat.nav.jumpDownNoMoveT = stalledWhileNear
          ? (Number.isFinite(cat.nav.jumpDownNoMoveT) ? cat.nav.jumpDownNoMoveT : 0) + stepDt
          : 0;
        const readyToDrop = reachedJumpOff || (nearDrop && cat.stateT > 0.16);
        cat.status = routeTargetsNonFloorSurface(route) ? "Repositioning" : "Preparing jump down";
        animateCatPose(stepDt, !readyToDrop);
        if (!readyToDrop) {
          const handled = handleRecoveryDuringMotion();
          if (handled != null) return handled;
        }
        if (readyToDrop) {
          markCatSurfaceId(desiredLandingSurfaceId, "jump-down-launch", 0.2);
          cat.nav.jumpDownPlanValid = false;
          cat.nav.jumpDownToward = null;
          cat.nav.jumpDownLandingSurfaceId = null;
          advanceRouteSegment(route, "jump-down-started");
          syncLegacyScalarsFromRoute(route);
          startJump(route[segment.jumpToKey] || route.jumpDown, getRouteJumpDownY(route), 0.52, 0.34, "patrol", {
            easePos: true,
            easeY: true,
            preventSurfaceClip: true,
            fromSurfaceId: jumpOffSurfaceId,
            toSurfaceId: desiredLandingSurfaceId,
          });
          cat.status = "Jumping down";
        }
        return true;
      }

      case "walk-surface": {
        const routeSurfaceId = normalizeSurfaceId(segment.supportSurfaceId || route.surfaceId || FLOOR_SURFACE_ID);
        const walkTarget = route[segment.pointKey] || route.target;
        const currentSurfaceId = normalizeSurfaceId(getCurrentCatSurfaceId() || routeSurfaceId);
        const onRouteSurface = currentSurfaceId === routeSurfaceId && isCatAlignedToSurface(routeSurfaceId, walkTarget, 0.12);
        if (!onRouteSurface) {
          route.recoverAt = 0;
          const recovered = tryRecoverTowardFinalTarget({
            kind: "surface-id-mismatch",
            count: 1,
            target: route.finalTarget,
            useDynamic: true,
          });
          if (!recovered) return false;
          cat.status = "Re-routing";
          animateCatPose(stepDt, false);
          return true;
        }
        let reachedTarget = moveCatTowardSurfaceTarget(
          walkTarget,
          stepDt,
          isFloorSurfaceId(routeSurfaceId) ? GROUND_MOVE_SPEED : 0.84,
          routeSurfaceId,
          {
            direct: false,
            ignoreDynamic: false,
          }
        );
        if (!reachedTarget) {
          reachedTarget = settleCatAtPoint(walkTarget, routeSurfaceId);
        }
        cat.status = "Patrolling";
        animateCatPose(stepDt, !reachedTarget);
        if (!reachedTarget) {
          const handled = handleRecoveryDuringMotion();
          if (handled != null) return handled;
        }
        if (reachedTarget) {
          return finalizeRouteArrival(routeSurfaceId);
        }
        return true;
      }

      default:
        return false;
    }
  }

  function updateCatImpl(stepDt) {
    if (game.state !== "playing") return;

    consumePendingSharedRouteRequest();

    if (cat.state !== cat.lastState) {
      cat.lastState = cat.state;
      cat.stateT = 0;
      cat.phaseT = 0;
      resetCatUnstuckTracking();
      if (cat.state !== "toDesk") {
        resetCatJumpBypass();
      }
      if (cat.state === "patrol") {
        if (!getActiveNavRoute() && !cat.manualPatrolActive) {
          if (!setNextPatrolTarget(true)) enterNoPathSit();
        }
        cat.nav.patrolPathCheckAt = clockTime;
        if (!Number.isFinite(cat.nextTableRollAt) || cat.nextTableRollAt <= 0) {
          cat.nextTableRollAt = clockTime + CAT_BEHAVIOR.tableApproachRollInterval;
        }
        if (!Number.isFinite(cat.tableRollStartAt) || cat.tableRollStartAt <= 0) {
          cat.tableRollStartAt = clockTime;
        }
      } else {
        cat.nextTableRollAt = Math.max(Number(cat.nextTableRollAt) || 0, clockTime);
      }
    } else {
      cat.stateT += stepDt;
    }

    if (cat.jump || catIsOnNonFloorSurfaceNow()) {
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
      clearCatnipApproachLock();
      cat.nav.suppressCupUntil = clockTime + CATNIP_CUP_SUPPRESS;
      deferDeskApproachRoll(cat.nav.suppressCupUntil + CAT_BEHAVIOR.initialRollDelay);

      const currentSurfaceId = getCurrentCatSurfaceId();
      const onElevatedNow = currentSurfaceId !== "floor" || cat.group.position.y > 0.08;
      if (cat.state === "toCatnip" || cat.state === "distracted") {
        if (cat.state === "distracted") {
          clearNavRoute("catnip-expired-recover");
          cat.manualPatrolActive = false;
          clearCatJumpTargets();
          clearCatNavPath(false);
          cat.state = "catnipRecover";
          cat.phaseT = 0;
          cat.stateT = 0;
          cat.nav.catnipRecoverUntil = clockTime + getCatnipRecoverDuration();
          cat.status = "Finishing catnip";
          return;
        }
        if (onElevatedNow) {
          markCatSurfaceId(
            getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk",
            "jump-down-plan",
            0.4
          );
        } else {
          markCatSurfaceId(FLOOR_SURFACE_ID, "catnip-expired-floor", 0.2);
        }
        resumePatrolAfterCatnip();
        return;
      }
    }
    if (!game.catnip) {
      cat.nav.catnipPathCheckAt = 0;
      cat.nav.catnipUseExactTarget = false;
      clearCatnipApproachLock();
    }

    if (!game.catnip && cat.state === "catnipRecover") {
      cat.status = "Finishing catnip";
      if (clockTime < (Number(cat.nav.catnipRecoverUntil) || 0)) {
        animateCatPose(stepDt, false);
        return;
      }
      cat.state = "catnipIdleBlend";
      cat.phaseT = 0;
      cat.stateT = 0;
      cat.nav.catnipRecoverUntil = 0;
      cat.nav.catnipIdleBlendUntil = clockTime + CATNIP_IDLE_BLEND_DUR;
      cat.status = "Settling";
      animateCatPose(stepDt, false);
      return;
    }

    if (!game.catnip && cat.state === "catnipIdleBlend") {
      cat.status = "Settling";
      if (clockTime < (Number(cat.nav.catnipIdleBlendUntil) || 0)) {
        animateCatPose(stepDt, false);
        return;
      }
      cat.nav.lastSpeed = 0;
      cat.nav.commandedSpeed = 0;
      cat.nav.driveSpeed = 0;
      cat.nav.speedNorm = 0;
      cat.nav.smoothedSpeed = 0;
      cat.motionBlend = 0;
      clearCatClipSpecialPose?.(cat, true);
      cat.nav.catnipIdleBlendUntil = 0;
      resumePatrolAfterCatnip();
      return;
    }

    const windowActive =
      !!windowSill &&
      windowSill?.specialFlags?.catGoesToSillOnButtonClick !== false &&
      clockTime < (game.windowOpenUntil || 0);
    const canInterruptFloorJumpForWindow =
      windowActive &&
      !!cat.jump &&
      cat.state === "launchUp" &&
      cat.group.position.y <= 0.08;

    if (canInterruptFloorJumpForWindow) {
      clearActiveJump();
      markCatSurfaceId(FLOOR_SURFACE_ID, "window-interrupt", 0.2);
      clearCatJumpTargets();
      clearCatNavPath(true);
      resetCatJumpBypass();
      cat.jumpAnchor = null;
      cat.jumpTargets = null;
      cat.state = "patrol";
      cat.phaseT = 0;
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

    const windowOverrideBlockedByJumpFlow =
      cat.state === "launchUp" ||
      cat.state === "forepawHook" ||
      cat.state === "pullUp" ||
      cat.state === "jumpSettle" ||
      cat.state === "jumpDown" ||
      cat.state === "landStop";

    if (!windowActive) {
      cat.nav.windowNoRouteStreak = 0;
      cat.nav.windowStallT = 0;
      cat.nav.windowLastX = NaN;
      cat.nav.windowLastZ = NaN;
      if (cat.nav.windowHoldActive) {
        cat.nav.windowHoldActive = false;
        cat.nav.windowPathCheckAt = 0;
        if (!game.catnip) {
          const cupActive = !cup.broken && !cup.falling;
          const currentSurfaceId = getCurrentCatSurfaceId();
          if (currentSurfaceId === "desk") {
            markCatSurfaceId(getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk", "jump-down-plan", 0.4);
            if (cupActive && clockTime >= (cat.nav.suppressCupUntil || 0)) {
              cat.state = "toCup";
              cat.phaseT = 0;
            } else {
              if (!setNextPatrolTarget(true)) {
                enterNoPathSit(0.7);
                return;
              }
              cat.state = "patrol";
              cat.phaseT = 0;
              return;
            }
          } else if (currentSurfaceId !== "floor" || cat.group.position.y > 0.08) {
            markCatSurfaceId(
              getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || currentSurfaceId,
              "jump-down-plan",
              0.4
            );
            if (!setNextPatrolTarget(true)) {
              enterNoPathSit(0.7);
              return;
            }
            cat.state = "patrol";
            cat.phaseT = 0;
            return;
          } else {
            markCatSurfaceId(FLOOR_SURFACE_ID, "window-interrupt", 0.2);
            cat.state = "patrol";
            cat.phaseT = 0;
          }
        }
      }
    } else if (!windowOverrideBlockedByJumpFlow) {
      const windowJustActivated = !cat.nav.windowHoldActive;
      if (windowJustActivated) {
        // Window distraction takes over immediately; drop stale scripted routes.
        clearNavRoute("window-override");
        cat.manualPatrolActive = false;
        clearCatNavPath(true);
        clearCatJumpTargets();
        const pendingRoute = cat.nav?.pendingSharedRouteRequest;
        if (pendingRoute && String(pendingRoute.source || "") !== "window") {
          cat.nav.pendingSharedRouteRequest = null;
        }
        if (cat.state === "toDesk" || cat.state === "prepareJump") {
          resetCatJumpBypass();
          cat.jumpAnchor = null;
          cat.jumpTargets = null;
          cat.state = "patrol";
          cat.phaseT = 0;
        }
        cat.nav.windowPathCheckAt = 0;
        cat.nav.windowNoRouteStreak = 0;
        cat.nav.windowStallT = 0;
        cat.nav.windowLastX = NaN;
        cat.nav.windowLastZ = NaN;
      }
      cat.nav.windowHoldActive = true;
      const windowSurfaceId = String(windowSill.id || "windowSill");
      const windowY = Math.max(0.02, Number(windowSill.surfaceY || 0) + 0.02);
      const windowTargetRaw = new THREE.Vector3(windowSill.sitPoint.x, windowY, windowSill.sitPoint.z);
      const windowTarget = clampPointToSurfaceSupport(windowSurfaceId, windowTargetRaw, 0.05) || windowTargetRaw;

      const windowRoute = getActiveNavRoute();
      if (windowRoute && windowRoute.finalSurfaceId !== windowSurfaceId) {
        clearNavRoute("window-retarget");
      }

      const onTargetSurface =
        cat.group.position.y > 0.12 &&
        Math.abs(cat.group.position.y - windowY) <= 0.14 &&
        getCurrentCatSurfaceId() === windowSurfaceId;

      if (onTargetSurface) {
        markCatSurfaceId(getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk", "jump-down-plan", 0.4);
        const route = ensureNavRoute();
        route.surfaceId = windowSurfaceId;
        route.target.set(windowTarget.x, windowY, windowTarget.z);
        route.finalTarget.set(windowTarget.x, windowY, windowTarget.z);
        route.y = windowY;
        route.finalY = windowY;
        syncLegacyScalarsFromRoute(route);
        cat.group.position.y = windowY;
        clearCatJumpTargets();
        cat.nav.debugDestination.set(windowTarget.x, windowY, windowTarget.z);
        nudgeCatTowardWindowSitPoint(windowTarget);
        markCatSurfaceId(windowSurfaceId, "window-sit", 2.2);
        setAuthoritativeCatSurfaceId(windowSurfaceId, "window-sit", 2.4);
        cat.state = "sit";
        cat.status = "Watching window";
        cat.group.rotation.y = Number.isFinite(windowSill?.outsideYaw) ? windowSill.outsideYaw : Math.PI;
        animateCatPose(stepDt, false);
        return;
      }

      const navReason = cat.nav?.debugStep?.reason || "";
      const activeWindowRoute = getActiveNavRoute();
      const shouldReplanWindow =
        !activeWindowRoute ||
        activeWindowRoute.finalSurfaceId !== windowSurfaceId ||
        hasConfirmedRouteFailure(activeWindowRoute);
      if (shouldReplanWindow && clockTime >= (cat.nav.windowPathCheckAt || 0)) {
        const forceWindowReplan =
          !!activeWindowRoute && (
            hasConfirmedRouteFailure(activeWindowRoute) ||
            hadRecentSurfaceRouteInstability(activeWindowRoute) ||
            hasStaleElevatedRouteProgress(activeWindowRoute, 0.34)
          );
        const queued = planElevatedHopToFinalTarget(
          windowSurfaceId,
          new THREE.Vector3(windowTarget.x, windowY, windowTarget.z),
          Math.max(0.3, (game.windowOpenUntil || 0) - clockTime),
          { forceReplan: forceWindowReplan }
        );
        if (queued) {
          cat.nav.windowNoRouteStreak = 0;
        } else {
          cat.nav.windowNoRouteStreak = (Number(cat.nav.windowNoRouteStreak) || 0) + 1;
          // Keep an existing in-flight window route alive; only clear scripted move if
          // there is no active route to the window right now.
          const currentRoute = getActiveNavRoute();
          if (!(currentRoute && currentRoute.finalSurfaceId === windowSurfaceId)) {
            clearNavRoute("window-no-route");
          }
        }
        cat.nav.windowPathCheckAt = clockTime + (queued ? 0.55 : 1.1);
      }

      const routedWindowMove = getActiveNavRoute();
      if (routedWindowMove && routedWindowMove.finalSurfaceId === windowSurfaceId && updatePatrolMoveTarget(stepDt)) {
        const lastWx = Number(cat.nav.windowLastX);
        const lastWz = Number(cat.nav.windowLastZ);
        const routeAge = clockTime - Number(routedWindowMove.createdAt || clockTime);
        const navBlocked = navReason === "wholePathBlocked" || navReason === "noPath";
        const navNoSteer = (cat.nav.noSteerFrames || 0) >= 2 || (cat.nav.stuckT || 0) > 0.16;
        const shouldMeasureWindowStall = routeAge >= 0.45 && (navBlocked || navNoSteer);
        if (Number.isFinite(lastWx) && Number.isFinite(lastWz) && shouldMeasureWindowStall) {
          const moveDx = cat.pos.x - lastWx;
          const moveDz = cat.pos.z - lastWz;
          const movedSq = moveDx * moveDx + moveDz * moveDz;
          if (movedSq <= 0.0045 * 0.0045) {
            cat.nav.windowStallT = (Number(cat.nav.windowStallT) || 0) + stepDt;
          } else {
            cat.nav.windowStallT = Math.max(0, (Number(cat.nav.windowStallT) || 0) - stepDt * 0.5);
          }
        } else {
          cat.nav.windowStallT = Math.max(0, (Number(cat.nav.windowStallT) || 0) - stepDt * 0.75);
        }
        cat.nav.windowLastX = cat.pos.x;
        cat.nav.windowLastZ = cat.pos.z;
        if ((Number(cat.nav.windowStallT) || 0) > 0.72) {
          clearNavRoute("window-stall");
          clearCatNavPath(true);
          cat.nav.windowPathCheckAt = clockTime + 0.38;
          cat.nav.windowStallT = 0;
          cat.nav.windowNoRouteStreak = Math.max(1, Number(cat.nav.windowNoRouteStreak) || 0);
          cat.status = "Re-routing to window";
          animateCatPose(stepDt, false);
          return;
        }
        const dx = windowTarget.x - cat.pos.x;
        const dz = windowTarget.z - cat.pos.z;
        const closeEnough =
          dx * dx + dz * dz <= 0.14 * 0.14 && Math.abs(cat.group.position.y - windowY) <= 0.14;
        if (closeEnough) {
          const route = clearNavRoute("window-arrived");
          markCatSurfaceId(getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk", "jump-down-plan", 0.4);
          route.surfaceId = windowSurfaceId;
          route.target.set(windowTarget.x, windowY, windowTarget.z);
          route.finalTarget.set(windowTarget.x, windowY, windowTarget.z);
          route.y = windowY;
          route.finalY = windowY;
          syncLegacyScalarsFromRoute(route);
          cat.group.position.y = windowY;
          clearCatNavPath(false);
          nudgeCatTowardWindowSitPoint(windowTarget);
          markCatSurfaceId(windowSurfaceId, "window-sit", 2.2);
          setAuthoritativeCatSurfaceId(windowSurfaceId, "window-sit", 2.4);
          cat.state = "sit";
          cat.status = "Watching window";
          cat.group.rotation.y = Number.isFinite(windowSill?.outsideYaw) ? windowSill.outsideYaw : Math.PI;
          animateCatPose(stepDt, false);
        } else {
          cat.state = "patrol";
          cat.status = "Going to window";
        }
        return;
      }
      cat.state = "patrol";
      const windowNoRouteStreak = Number(cat.nav.windowNoRouteStreak) || 0;
      cat.status =
        windowNoRouteStreak >= WINDOW_NO_ROUTE_CONFIRM
          ? "No path to window"
          : "Re-routing to window";
      animateCatPose(stepDt, false);
      return;
    } else if (cat.nav.windowHoldActive) {
      // Window opened during a jump/transition: defer window override until jump flow finishes.
      cat.nav.windowHoldActive = false;
      cat.nav.windowPathCheckAt = 0;
      cat.nav.windowNoRouteStreak = 0;
      cat.nav.windowStallT = 0;
      cat.nav.windowLastX = NaN;
      cat.nav.windowLastZ = NaN;
    }

    // Catnip overrides knock behavior.
    if (game.catnip) {
      const inDropFlow = cat.state === "jumpDown" || cat.state === "landStop";
      if (!inDropFlow) {
        const catnipSurfaceId = String(game.catnip.surface || "floor");
        const catnipApproachTarget = getCatnipApproachTarget() || game.catnip.pos;
        let catnipRoutePoint =
          catnipSurfaceId === "floor"
            ? (findSafeGroundPoint(catnipApproachTarget) || catnipApproachTarget).clone()
            : new THREE.Vector3(
                catnipApproachTarget.x,
                Math.max(0.02, Number(game.catnip.pos?.y || catnipApproachTarget?.y || 0.02)),
                catnipApproachTarget.z
              );

        if (catnipSurfaceId === "floor") {
          if (clockTime >= (cat.nav.catnipPathCheckAt || 0)) {
            const approachReachable = canReachGroundTargetMemo(
              cat.pos,
              catnipApproachTarget,
              true,
              NAV_REACHABILITY_OPTIONS,
              "catnip-approach"
            );
            const exactReachable = canReachGroundTargetMemo(
              cat.pos,
              game.catnip.pos,
              true,
              NAV_REACHABILITY_OPTIONS,
              "catnip-exact"
            );
            cat.nav.catnipUseExactTarget = !approachReachable && exactReachable;
          }
          if (cat.nav.catnipUseExactTarget) {
            catnipRoutePoint = (findSafeGroundPoint(game.catnip.pos) || game.catnip.pos).clone();
          }
          catnipRoutePoint.y = 0;
        }

        const currentSurfaceId = normalizeSurfaceId(getCurrentCatSurfaceId() || catnipSurfaceId);
        const nearCatnipTarget = (() => {
          if (currentSurfaceId !== catnipSurfaceId) return false;
          const comparePoint = cat.nav.catnipUseExactTarget ? game.catnip.pos : catnipRoutePoint;
          if (!comparePoint) return false;
          const dx = Number(comparePoint.x || 0) - cat.pos.x;
          const dz = Number(comparePoint.z || 0) - cat.pos.z;
          const floorCatnipArriveRadius = 0.05;
          if (dx * dx + dz * dz > floorCatnipArriveRadius * floorCatnipArriveRadius) return false;
          if (catnipSurfaceId === "floor") return (cat.group.position.y || 0) <= 0.08;
          const targetY = Math.max(0.02, Number(comparePoint.y || game.catnip.pos?.y || cat.group.position.y || 0.02));
          return Math.abs((cat.group.position.y || 0) - targetY) <= 0.16;
        })();
        if (nearCatnipTarget && cat.state !== "distracted") {
          enterCatnipDistractedState(catnipRoutePoint, catnipSurfaceId);
        }

        if (cat.state === "distracted") {
          cat.status = "Eating catnip";
          faceCatnip(stepDt);
          animateCatPose(stepDt, false);
          return;
        }

        const activeRoute = getActiveNavRoute();
        if (activeRoute && String(activeRoute.source || "") !== "catnip") {
          clearNavRoute("catnip-route-override");
          cat.manualPatrolActive = false;
        }
        const pendingRoute = cat.nav?.pendingSharedRouteRequest;
        if (pendingRoute && String(pendingRoute.source || "") !== "catnip") {
          cat.nav.pendingSharedRouteRequest = null;
        }

        const currentCatnipRoute = isActiveRouteFromSource("catnip") ? getActiveNavRoute() : null;
        const routeMismatch =
          !currentCatnipRoute ||
          !hasMatchingActiveRoute(catnipSurfaceId, catnipRoutePoint) ||
          hasConfirmedRouteFailure(currentCatnipRoute);

        if (routeMismatch && clockTime >= (cat.nav.catnipPathCheckAt || 0)) {
          const queued = requestSharedMoveRoute(catnipSurfaceId, catnipRoutePoint, 0.18, {
            source: "catnip",
            forceReplan: !!currentCatnipRoute && hasConfirmedRouteFailure(currentCatnipRoute),
          });
          cat.nav.catnipPathCheckAt = clockTime + (queued ? 0.32 : 0.62);
          if (!queued) {
            abortCatnipRouteAndResumePatrol();
            animateCatPose(stepDt, true);
            return;
          }
        }

        const catnipRoute = getActiveNavRoute();
        if (catnipRoute && String(catnipRoute.source || "") === "catnip") {
          const updated = updatePatrolMoveTarget(stepDt);
          if (!updated) {
            abortCatnipRouteAndResumePatrol();
            animateCatPose(stepDt, true);
            return;
          }
          if (cat.state === "distracted") {
            faceCatnip(stepDt);
            return;
          }
          cat.state = "toCatnip";
          cat.status = "Going to catnip";
          return;
        }

        if (cat.state === "distracted") {
          faceCatnip(stepDt);
          return;
        }

        abortCatnipRouteAndResumePatrol();
        animateCatPose(stepDt, true);
        return;
      }
    }

    if (cat.state === "patrol") {
      if (rollCupApproachFromPatrol()) {
        animateCatPose(stepDt, false);
        return;
      }
      if (getActiveNavRoute()) {
        if (updatePatrolMoveTarget(stepDt)) return;
      }
      if (cat.manualPatrolActive) {
        const holdSurfaceId = normalizeSurfaceId(cat.nav.manualHoldSurfaceId || FLOOR_SURFACE_ID);
        const holdPoint = ensureManualHoldPoint();
        const holdY =
          holdSurfaceId === FLOOR_SURFACE_ID
            ? 0
            : Math.max(0.02, Number(cat.nav.manualHoldY) || Number(holdPoint.y) || 0.02);
        cat.pos.x = holdPoint.x;
        cat.pos.z = holdPoint.z;
        cat.group.position.set(cat.pos.x, holdY, cat.pos.z);
        markCatSurfaceId(holdSurfaceId, "manual-hold", 0.25);
        setAuthoritativeCatSurfaceId(holdSurfaceId, "manual-hold", 0.35);
        cat.nav.lastSpeed = 0;
        cat.nav.commandedSpeed = 0;
        cat.nav.driveSpeed = 0;
        cat.nav.speedNorm = 0;
        cat.nav.smoothedSpeed = 0;
        cat.nav.turnOnlyT = 0;
        clearCatNavPath(false);
        if (clockTime < (Number(cat.nav.arrivalHoldUntil) || 0)) {
          cat.status = "At click target";
          animateCatPose(stepDt, false);
          return;
        }
        clearManualHoldState();
        cat.manualPatrolActive = false;
        cat.nav.arrivalHoldUntil = 0;
        cat.status = "Patrolling";
        traceFunction("manualHoldExpired", `surface=${getCurrentCatSurfaceId() || FLOOR_SURFACE_ID}`);
        if (!setNextPatrolTarget(true)) {
          enterNoPathSit(0.85);
          animateCatPose(stepDt, false);
          return;
        }
        animateCatPose(stepDt, false);
        return;
      }
      if (cat.state === "patrol") {
        const target = cat.patrolTarget;
        const patrolSurfaceId = normalizeSurfaceId(
          cat.nav.patrolSurfaceId || getCurrentCatSurfaceId() || FLOOR_SURFACE_ID
        );
        const restoredRoute = target
          ? requestSharedMoveRoute(patrolSurfaceId, target, 0, { source: "patrol", forceReplan: true })
          : false;
        if (restoredRoute && getActiveNavRoute() && updatePatrolMoveTarget(stepDt)) return;
        if (!setNextPatrolTarget(true)) enterNoPathSit();
        animateCatPose(stepDt, false);
        return;
      }
    }

    if (cat.state === "toDesk") {
      if (!game.catnip && clockTime < (cat.nav.suppressCupUntil || 0)) {
        cat.state = "patrol";
        cat.phaseT = 0;
        cat.jumpAnchor = null;
        cat.jumpTargets = null;
        clearCatJumpTargets();
        clearCatNavPath(true);
        if (!setNextPatrolTarget(true)) enterNoPathSit(0.85);
        animateCatPose(stepDt, false);
        return;
      }
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
          const hasDynamicPath = canReachGroundTargetMemo(
            cat.pos,
            cat.jumpAnchor,
            true,
            { allowFallback: true, allowEndpointPushableGoal: false },
            "desk-anchor"
          );
          if (!hasDynamicPath) {
            if (!replanDeskJumpOrFallback()) return;
          } else if (cat.nav.jumpNoClip) {
            resetCatJumpBypass();
          }
        }
        cat.nav.jumpBypassCheckAt = clockTime + (shouldProbeBypass ? CAT_NAV.jumpBypassCheckInterval : 0.4);
      }
      const reachedDesk = moveCatTowardGroundWithBypass(cat.jumpAnchor, stepDt, 0.92, {
        allowEndpointPushableGoal: false,
      });
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
          preventSurfaceClip: true,
          upPrep: false,
          fromSurfaceId: "floor",
          toSurfaceId: "desk",
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
        markCatSurfaceId(getCurrentCatSurfaceId() || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.lastStableSurfaceId || "desk", "jump-down-plan", 0.4);
        clearCatJumpTargets();
        clearCatNavPath(false);
      }
      cat.status = "Settling on desk";
      animateCatPose(stepDt, false);
      if (cat.phaseT >= JUMP_UP_TIMING.settle) {
        pickTableRoamTarget(false);
        cat.nextTableRoamAt = clockTime + 0.35;
        if (game.catnip) {
          cat.state = "toCatnip";
          cat.phaseT = 0;
        } else if (clockTime >= (cat.nav.suppressCupUntil || 0)) {
          cat.state = "toCup";
          cat.phaseT = 0;
        } else {
          if (!setNextPatrolTarget(true)) {
            enterNoPathSit(0.85);
            return;
          }
          cat.state = "patrol";
          cat.phaseT = 0;
        }
      }
      return;
    }

    if (cat.state === "toCup") {
      if (clockTime < (cat.nav.suppressCupUntil || 0)) {
        cat.state = "patrol";
        cat.phaseT = 0;
        clearCatJumpTargets();
        clearCatNavPath(true);
        if (!setNextPatrolTarget(true)) enterNoPathSit(0.85);
        animateCatPose(stepDt, false);
        return;
      }
      cat.phaseT += stepDt;
      const cupActive = !cup.broken && !cup.falling;

      if (cupActive) {
        const swipePlan = computeCupSwipePlan(THREE, desk, cup.group.position, cupSwipePoint, cupSwipeEdgeDir);
        cat.nav.debugDestination.set(swipePlan.point.x, desk.topY + 0.02, swipePlan.point.z);
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

        let reachedSwipePoint = moveCatToward(swipePlan.point, stepDt, 0.72, desk.topY + 0.02, {
          direct: true,
          ignoreDynamic: true,
          supportSurfaceId: "desk",
        });
        if (!reachedSwipePoint) {
          reachedSwipePoint = settleCatAtPoint(swipePlan.point, "desk", 0.135);
        }
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
        supportSurfaceId: "desk",
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
        supportSurfaceId: getCurrentCatSurfaceId(),
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
        const landingSurfaceId = normalizeSurfaceId(cat.nav.jumpDownLandingSurfaceId || FLOOR_SURFACE_ID);
        markCatSurfaceId(landingSurfaceId, "jump-down-launch", 0.2);
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
          preventSurfaceClip: true,
          fromSurfaceId: normalizeSurfaceId(getCurrentCatSurfaceId() || cat.debugMoveSurfaceId),
          toSurfaceId: landingSurfaceId,
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
      if (catIsOnWindowSillNow()) {
        const windowSurfaceId = String(windowSill?.id || "windowSill");
        markCatSurfaceId(windowSurfaceId, "window-sit", 0.5);
        setAuthoritativeCatSurfaceId(windowSurfaceId, "window-sit", 0.65);
      }
      animateCatPose(stepDt, false);
      const sitFor = Math.max(0.2, Number.isFinite(cat.sitDuration) ? cat.sitDuration : 1.25);
      if (cat.phaseT >= sitFor) {
        cat.sitDuration = 1.25;
        if (catIsOnWindowSillNow() || catIsOnNonFloorSurfaceNow()) {
          if (!setNextPatrolTarget(true)) {
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
