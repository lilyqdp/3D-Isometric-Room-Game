import { createCatPathfindingRuntime } from "./cat-pathfinding.js";
import { createCatJumpPlanningRuntime } from "./cat-jump-planning.js";
import { createCatSteeringRuntime } from "./cat-steering.js";
import { createCatRecoveryRuntime } from "./cat-recovery.js";
import { createCatJumpRuntime } from "./cat-jump-runtime.js";

export function createCatNavigationRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ASTAR_NEIGHBOR_OFFSETS,
    SWIPE_TIMING,
    ROOM,
    desk,
    hamper,
    trashCan,
    DESK_LEGS,
    EXTRA_NAV_OBSTACLES,
    CUP_COLLISION,
    pickups,
    cat,
    cup,
    game,
    pickupRadius,
    isDraggingPickup,
    getSurfaceDefs,
    getSurfaceById,
    clearCatNavPath,
    resetCatUnstuckTracking,
    getClockTime,
    recordFunctionTrace,
    shouldRecordPathProfiler,
  } = ctx;

  const pathRuntime = createCatPathfindingRuntime({
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ASTAR_NEIGHBOR_OFFSETS,
    ROOM,
    desk,
    getSurfaceDefs,
    getSurfaceById,
    hamper,
    trashCan,
    DESK_LEGS,
    EXTRA_NAV_OBSTACLES,
    CUP_COLLISION,
    pickups,
    cat,
    cup,
    pickupRadius,
    getClockTime,
    recordFunctionTrace,
    shouldRecordPathProfiler,
  });

  function initPathfinding() {
    return pathRuntime.initPathfinding();
  }

  function buildCatObstacles(includePickups = false, includeClosePickups = false) {
    return pathRuntime.buildCatObstacles(includePickups, includeClosePickups);
  }

  function isCatPointBlocked(x, z, obstacles, clearance = null, queryY = 0, stage = "plan", pathOptions = null) {
    return pathRuntime.isCatPointBlocked(x, z, obstacles, clearance, queryY, stage, pathOptions);
  }

  function getCatPathClearance() {
    return pathRuntime.getCatPathClearance();
  }

  function hasClearTravelLine(a, b, obstacles, clearance = null, queryY = 0, stage = "plan", pathOptions = null) {
    return pathRuntime.hasClearTravelLine(a, b, obstacles, clearance, queryY, stage, pathOptions);
  }

  function catPathDistance(path) {
    return pathRuntime.catPathDistance(path);
  }

  function getNavMeshDebugData(includePickups = false, includeClosePickups = false) {
    return pathRuntime.getNavMeshDebugData(includePickups, includeClosePickups);
  }

  function getActiveNavMeshDebugData() {
    return pathRuntime.getActiveNavMeshDebugData();
  }

  function getLastAStarDebugData() {
    return pathRuntime.getLastAStarDebugData();
  }

  function computeCatPath(start, goal, obstacles, queryY = null, allowFallback = null, recordDebug = true, pathOptions = null) {
    return pathRuntime.computeCatPath(start, goal, obstacles, queryY, allowFallback, recordDebug, pathOptions);
  }

  function isPathTraversable(path, obstacles, clearance = null, queryY = null, stage = "plan", pathOptions = null) {
    return pathRuntime.isPathTraversable(path, obstacles, clearance, queryY, stage, pathOptions);
  }

  function canReachGroundTarget(start, goal, obstacles, options = null) {
    return pathRuntime.canReachGroundTarget(start, goal, obstacles, options);
  }

  function ensureCatPath(target, force = false, useDynamic = false, queryY = null, allowFallback = null) {
    return pathRuntime.ensureCatPath(target, force, useDynamic, queryY, allowFallback);
  }

  function ensureCatPathNoFallback(target, force = false, useDynamic = false, queryY = null) {
    return pathRuntime.ensureCatPathNoFallback(target, force, useDynamic, queryY);
  }

  function invalidateNavCaches() {
    return pathRuntime.invalidateNavCaches();
  }

  function stepDetourCrowdToward(target, dt, useDynamicPlan = true, desiredSpeed = null, options = null) {
    return pathRuntime.stepDetourCrowdToward(target, dt, useDynamicPlan, desiredSpeed, options);
  }

  function resetDetourCrowd() {
    return pathRuntime.resetDetourCrowd();
  }

  const jumpRuntime = createCatJumpPlanningRuntime({
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    ROOM,
    desk,
    getSurfaceDefs,
    getSurfaceById,
    CUP_COLLISION,
    pickups,
    cup,
    pickupRadius,
    buildCatObstacles,
    isCatPointBlocked,
    computeCatPath,
    isPathTraversable,
    catPathDistance,
    hasClearTravelLine,
    recordFunctionTrace,
  });

  const motionJumpRuntime = createCatJumpRuntime({
    THREE,
    CAT_COLLISION,
    cat,
    getSurfaceDefs,
    getSurfaceById,
    getClockTime,
    recordFunctionTrace,
  });

  const recoveryRuntime = createCatRecoveryRuntime({
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CUP_COLLISION,
    pickups,
    cat,
    cup,
    desk,
    game,
    pickupRadius,
    isDraggingPickup,
    getClockTime,
    clearCatNavPath,
    resetCatUnstuckTracking,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    ensureCatPath,
    bestDeskJumpAnchor: jumpRuntime.bestDeskJumpAnchor,
  });

  const steeringRuntime = createCatSteeringRuntime({
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    SWIPE_TIMING,
    ROOM,
    desk,
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
    nudgeBlockingPickupAwayFromCat: recoveryRuntime.nudgeBlockingPickupAwayFromCat,
    nudgeNearbyPickupsAwayFromCat: recoveryRuntime.nudgeNearbyPickupsAwayFromCat,
  });

  return {
    initPathfinding,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    getNavMeshDebugData,
    getActiveNavMeshDebugData,
    getLastAStarDebugData,
    computeCatPath,
    canReachGroundTarget,
    ensureCatPath,
    ensureCatPathNoFallback,
    invalidateNavCaches,
    stepDetourCrowdToward,
    resetDetourCrowd,
    findSurfacePath: jumpRuntime.findSurfacePath,
    bestSurfaceJumpAnchor: jumpRuntime.bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets: jumpRuntime.computeSurfaceJumpTargets,
    computeSurfaceJumpDownTargets: jumpRuntime.computeSurfaceJumpDownTargets,
    bestDeskJumpAnchor: jumpRuntime.bestDeskJumpAnchor,
    computeDeskJumpTargets: jumpRuntime.computeDeskJumpTargets,
    computeDeskJumpDownTargets: jumpRuntime.computeDeskJumpDownTargets,
    getSurfaceJumpDebugData: jumpRuntime.getSurfaceJumpDebugData,
    computeJumpNoClipMinY: motionJumpRuntime.computeJumpNoClipMinY,
    clearActiveJump: motionJumpRuntime.clearActiveJump,
    startJump: motionJumpRuntime.startJump,
    updateJump: motionJumpRuntime.updateJump,
    moveCatToward: steeringRuntime.moveCatToward,
    findSafeGroundPoint: steeringRuntime.findSafeGroundPoint,
    pickRandomPatrolPoint: steeringRuntime.pickRandomPatrolPoint,
    sampleSwipePose: steeringRuntime.sampleSwipePose,
    recoverCatFromPickupTrap: recoveryRuntime.recoverCatFromPickupTrap,
    nudgeBlockingPickupAwayFromCat: recoveryRuntime.nudgeBlockingPickupAwayFromCat,
    getCurrentGroundGoal: recoveryRuntime.getCurrentGroundGoal,
    keepCatAwayFromCup: recoveryRuntime.keepCatAwayFromCup,
  };
}
