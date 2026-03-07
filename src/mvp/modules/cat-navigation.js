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
    DESK_JUMP_ANCHORS,
    CUP_COLLISION,
    pickups,
    cat,
    cup,
    game,
    pickupRadius,
    isDraggingPickup,
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
    hamper,
    trashCan,
    DESK_LEGS,
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

  function computeCatPath(start, goal, obstacles) {
    return pathRuntime.computeCatPath(start, goal, obstacles);
  }

  function isPathTraversable(path, obstacles, clearance = CAT_NAV.clearance) {
    return pathRuntime.isPathTraversable(path, obstacles, clearance);
  }

  function canReachGroundTarget(start, goal, obstacles) {
    return pathRuntime.canReachGroundTarget(start, goal, obstacles);
  }

  function ensureCatPath(target, force = false, useDynamic = false) {
    return pathRuntime.ensureCatPath(target, force, useDynamic);
  }

  const jumpRuntime = createCatJumpPlanningRuntime({
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    desk,
    DESK_JUMP_ANCHORS,
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
    cat,
    getClockTime,
    clearCatNavPath,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    ensureCatPath,
    canReachGroundTarget,
    nudgeBlockingPickupAwayFromCat: recoveryRuntime.nudgeBlockingPickupAwayFromCat,
  });

  return {
    initPathfinding,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    getNavMeshDebugData,
    getActiveNavMeshDebugData,
    computeCatPath,
    canReachGroundTarget,
    ensureCatPath,
    bestDeskJumpAnchor: jumpRuntime.bestDeskJumpAnchor,
    computeDeskJumpTargets: jumpRuntime.computeDeskJumpTargets,
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
