import { createCatPathfindingRuntime } from "./cat-pathfinding.js";
import { createCatJumpPlanningRuntime } from "./cat-jump-planning.js";
import { createCatSteeringRuntime } from "./cat-steering.js";
import { createCatRecoveryRuntime } from "./cat-recovery.js";

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

  function isCatPointBlocked(x, z, obstacles, clearance = CAT_NAV.clearance, queryY = 0) {
    return pathRuntime.isCatPointBlocked(x, z, obstacles, clearance, queryY);
  }

  function getCatPathClearance() {
    return pathRuntime.getCatPathClearance();
  }

  function hasClearTravelLine(a, b, obstacles, clearance = CAT_NAV.clearance, queryY = 0) {
    return pathRuntime.hasClearTravelLine(a, b, obstacles, clearance, queryY);
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

  function computeCatPath(start, goal, obstacles, queryY = null) {
    return pathRuntime.computeCatPath(start, goal, obstacles, queryY);
  }

  function isPathTraversable(path, obstacles, clearance = CAT_NAV.clearance) {
    return pathRuntime.isPathTraversable(path, obstacles, clearance);
  }

  function canReachGroundTarget(start, goal, obstacles) {
    return pathRuntime.canReachGroundTarget(start, goal, obstacles);
  }

  function ensureCatPath(target, force = false, useDynamic = false, queryY = null) {
    return pathRuntime.ensureCatPath(target, force, useDynamic, queryY);
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
    getElevatedSurfaceDefs,
    cat,
    getClockTime,
    clearCatNavPath,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    ensureCatPath,
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
    stepDetourCrowdToward,
    resetDetourCrowd,
    bestSurfaceJumpAnchor: jumpRuntime.bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets: jumpRuntime.computeSurfaceJumpTargets,
    computeSurfaceJumpDownTargets: jumpRuntime.computeSurfaceJumpDownTargets,
    bestDeskJumpAnchor: jumpRuntime.bestDeskJumpAnchor,
    computeDeskJumpTargets: jumpRuntime.computeDeskJumpTargets,
    computeDeskJumpDownTargets: jumpRuntime.computeDeskJumpDownTargets,
    getSurfaceJumpDebugData: jumpRuntime.getSurfaceJumpDebugData,
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
