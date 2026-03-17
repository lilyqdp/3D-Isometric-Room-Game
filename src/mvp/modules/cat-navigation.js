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
    getElevatedSurfaceDefs,
    clearCatNavPath,
    resetCatUnstuckTracking,
    getClockTime,
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
    getElevatedSurfaceDefs,
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
  });

  function initPathfinding() {
    return pathRuntime.initPathfinding();
  }

  function buildCatObstacles(includePickups = false, includeClosePickups = false) {
    return pathRuntime.buildCatObstacles(includePickups, includeClosePickups);
  }

  function isCatPointBlocked(x, z, obstacles, clearance = null, queryY = 0, stage = "plan") {
    return pathRuntime.isCatPointBlocked(x, z, obstacles, clearance, queryY, stage);
  }

  function getCatPathClearance() {
    return pathRuntime.getCatPathClearance();
  }

  function hasClearTravelLine(a, b, obstacles, clearance = null, queryY = 0, stage = "plan") {
    return pathRuntime.hasClearTravelLine(a, b, obstacles, clearance, queryY, stage);
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

  function computeCatPath(start, goal, obstacles, queryY = null, allowFallback = null, recordDebug = true) {
    return pathRuntime.computeCatPath(start, goal, obstacles, queryY, allowFallback, recordDebug);
  }

  function isPathTraversable(path, obstacles, clearance = null, queryY = null) {
    return pathRuntime.isPathTraversable(path, obstacles, clearance, queryY);
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

  function stepDetourCrowdToward(target, dt, useDynamicPlan = true, desiredSpeed = null) {
    return pathRuntime.stepDetourCrowdToward(target, dt, useDynamicPlan, desiredSpeed);
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
    getElevatedSurfaceDefs,
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
  });

  const motionJumpRuntime = createCatJumpRuntime({
    THREE,
    CAT_COLLISION,
    desk,
    cat,
    getElevatedSurfaceDefs,
    getClockTime,
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
    getElevatedSurfaceDefs,
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
    stepDetourCrowdToward,
    resetDetourCrowd,
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
