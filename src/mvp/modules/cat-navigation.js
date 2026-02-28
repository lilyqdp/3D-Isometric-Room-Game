import { createCatPathfindingRuntime } from "./cat-pathfinding.js";

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

  const tempTo = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();

  const pathRuntime = createCatPathfindingRuntime({
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ASTAR_NEIGHBOR_OFFSETS,
    ROOM,
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

function buildCatObstacles(includePickups = false, includeClosePickups = false) {
  return pathRuntime.buildCatObstacles(includePickups, includeClosePickups);
}

function isCatPointBlocked(x, z, obstacles, clearance = CAT_NAV.clearance) {
  return pathRuntime.isCatPointBlocked(x, z, obstacles, clearance);
}

function getCatPathClearance() {
  return pathRuntime.getCatPathClearance();
}

function hasClearTravelLine(a, b, obstacles, clearance = CAT_NAV.clearance) {
  return pathRuntime.hasClearTravelLine(a, b, obstacles, clearance);
}

function catPathDistance(path) {
  return pathRuntime.catPathDistance(path);
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

function nearestDeskJumpAnchor(from) {
  const staticObstacles = buildCatObstacles(false);
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < DESK_JUMP_ANCHORS.length; i++) {
    const a = DESK_JUMP_ANCHORS[i];
    if (isCatPointBlocked(a.x, a.z, staticObstacles, CAT_NAV.clearance * 0.85)) continue;
    const d = from.distanceToSquared(a);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best || DESK_JUMP_ANCHORS[0];
}


function bestDeskJumpAnchor(from) {
  const staticObstacles = buildCatObstacles(false);
  const dynamicObstacles = buildCatObstacles(true);
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < DESK_JUMP_ANCHORS.length; i++) {
    const a = DESK_JUMP_ANCHORS[i];
    if (isCatPointBlocked(a.x, a.z, staticObstacles, CAT_NAV.clearance * 0.85)) continue;

    const path = computeCatPath(from, a, staticObstacles);
    if (!isPathTraversable(path, staticObstacles)) continue;
    const dynamicClear = isPathTraversable(path, dynamicObstacles);
    const score = catPathDistance(path) + (dynamicClear ? 0 : 2.2);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best || nearestDeskJumpAnchor(from);
}


function computeDeskJumpTargets(anchor) {
  const relX = anchor.x - desk.pos.x;
  const relZ = anchor.z - desk.pos.z;
  const hook = new THREE.Vector3();
  const top = new THREE.Vector3();
  const edgeOut = 0.24;
  const topIn = 0.34;

  if (Math.abs(relX) >= Math.abs(relZ)) {
    const sx = Math.sign(relX || 1);
    const edgeX = desk.pos.x + sx * (desk.sizeX * 0.5 + edgeOut);
    const z = THREE.MathUtils.clamp(
      anchor.z,
      desk.pos.z - desk.sizeZ * 0.5 + 0.24,
      desk.pos.z + desk.sizeZ * 0.5 - 0.24
    );
    hook.set(edgeX, 0, z);
    top.set(desk.pos.x + sx * (desk.sizeX * 0.5 - topIn), 0, z);
  } else {
    const sz = Math.sign(relZ || 1);
    const edgeZ = desk.pos.z + sz * (desk.sizeZ * 0.5 + edgeOut);
    const x = THREE.MathUtils.clamp(
      anchor.x,
      desk.pos.x - desk.sizeX * 0.5 + 0.3,
      desk.pos.x + desk.sizeX * 0.5 - 0.3
    );
    hook.set(x, 0, edgeZ);
    top.set(x, 0, desk.pos.z + sz * (desk.sizeZ * 0.5 - topIn));
  }

  return { hook, top };
}


function rotateCatToward(yaw, dt) {
  const delta = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
  const maxStep = CAT_NAV.maxTurnRate * dt;
  const clamped = THREE.MathUtils.clamp(delta, -maxStep, maxStep);
  cat.group.rotation.y += clamped;
  return delta;
}

const GROUND_STEER_OFFSETS = [0, 0.2, -0.2, 0.42, -0.42, 0.66, -0.66, 0.92, -0.92, 1.22, -1.22, 1.48, -1.48];

function chooseGroundSteer(target, step, staticObstacles, dynamicObstacles, ignoreDynamic = false) {
  const toGoalX = target.x - cat.pos.x;
  const toGoalZ = target.z - cat.pos.z;
  const goalLen = Math.max(0.001, Math.hypot(toGoalX, toGoalZ));
  const goalYaw = Math.atan2(toGoalX, toGoalZ);
  const prevYaw = Number.isFinite(cat.nav.steerYaw) ? cat.nav.steerYaw : goalYaw;
  const staticClearance = getCatPathClearance();
  const dynamicClearance = staticClearance;
  const lookAhead = Math.max(step, Math.min(CAT_NAV.localLookAhead, step * 2.2));

  let best = null;
  let bestScore = Infinity;

  const evaluate = (offset, allowBacktrack) => {
    const yaw = goalYaw + offset;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const faceDelta = Math.abs(
      Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y))
    );
    if (cat.nav.stuckT < 0.26 && faceDelta > 0.95) return;

    const tx = cat.pos.x + sx * step;
    const tz = cat.pos.z + sz * step;
    if (isCatPointBlocked(tx, tz, staticObstacles, staticClearance)) return;
    if (!ignoreDynamic && isCatPointBlocked(tx, tz, dynamicObstacles, dynamicClearance)) return;

    const progress = (toGoalX * sx + toGoalZ * sz) / goalLen;
    if (!allowBacktrack && progress < -0.08) return;

    const lx = cat.pos.x + sx * lookAhead;
    const lz = cat.pos.z + sz * lookAhead;
    const dynamicAhead = !ignoreDynamic && isCatPointBlocked(lx, lz, dynamicObstacles, dynamicClearance);
    const staticAhead = isCatPointBlocked(lx, lz, staticObstacles, staticClearance);
    if (staticAhead) return;

    const remainingD2 = (target.x - tx) * (target.x - tx) + (target.z - tz) * (target.z - tz);
    let score = Math.abs(offset) * 0.52 + (1 - progress) * 1.4 + remainingD2 * 0.015;
    const steerDelta = Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw));
    score += Math.abs(steerDelta) * CAT_NAV.steerSwitchPenalty;
    score += faceDelta * CAT_NAV.steerFacingPenalty;
    if (dynamicAhead) score += 0.95;

    if (score < bestScore) {
      bestScore = score;
      best = { sx, sz, yaw };
    }
  };

  for (const offset of GROUND_STEER_OFFSETS) evaluate(offset, false);
  if (!best) {
    for (const offset of GROUND_STEER_OFFSETS) evaluate(offset, true);
  }
  return best;
}


function moveCatToward(target, dt, speed, yLevel, opts = {}) {
  let direct = !!opts.direct;
  let ignoreDynamic = !!opts.ignoreDynamic;
  let chase = target;
  if (yLevel <= 0.02) {
    const staticClearance = getCatPathClearance();
    const dynamicClearance = staticClearance;
    if (direct) {
      const staticObstacles = buildCatObstacles(false);
      if (
        isCatPointBlocked(target.x, target.z, staticObstacles, staticClearance) ||
        !hasClearTravelLine(cat.pos, target, staticObstacles, staticClearance)
      ) {
        direct = false;
        ignoreDynamic = false;
      }
    }
    tempTo.set(target.x, 0, target.z);
    if (!direct) {
      const goalChanged = cat.nav.goal.distanceToSquared(tempTo) > 0.1 * 0.1;
      const needsPath = cat.nav.path.length <= 1 && getClockTime() >= cat.nav.repathAt;
      const stalePath = getClockTime() >= cat.nav.repathAt;
      const force = goalChanged || needsPath || stalePath;
      // Always include dynamic blockers in the global plan so hidden/off-screen clutter is accounted for.
      const useDynamicPlan = !ignoreDynamic;
      ensureCatPath(tempTo, force, useDynamicPlan);
      if (cat.nav.path.length > 1) {
        let index = THREE.MathUtils.clamp(cat.nav.index, 1, cat.nav.path.length - 1);
        while (index < cat.nav.path.length - 1 && cat.pos.distanceToSquared(cat.nav.path[index]) < 0.15 * 0.15) {
          index++;
        }
        cat.nav.index = index;
        chase = cat.nav.path[index];
        const segmentObstacles = ignoreDynamic ? buildCatObstacles(false) : buildCatObstacles(true, true);
        const segmentClearance = ignoreDynamic ? staticClearance : dynamicClearance;
        if (!hasClearTravelLine(cat.pos, chase, segmentObstacles, segmentClearance)) {
          ensureCatPath(tempTo, true, !ignoreDynamic);
          if (cat.nav.path.length > 1) {
            const nIndex = THREE.MathUtils.clamp(cat.nav.index, 1, cat.nav.path.length - 1);
            chase = cat.nav.path[nIndex];
          }
        }
      }
      if (cat.nav.path.length <= 1) {
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        cat.nav.lastSpeed = 0;
        return false;
      }
    }
  }

  cat.nav.debugDestination.set(target.x, yLevel, target.z);

  const dx = chase.x - cat.pos.x;
  const dz = chase.z - cat.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.06) {
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    return cat.pos.distanceTo(target) < 0.14;
  }
  const nx = dx / d;
  const nz = dz / d;
  const yaw = Math.atan2(nx, nz);
  const dy = rotateCatToward(yaw, dt);
  let step = Math.min(d, speed * dt);
  if (yLevel <= 0.02 && Math.abs(dy) > CAT_NAV.turnSlowThreshold) {
    const t = THREE.MathUtils.clamp((Math.abs(dy) - CAT_NAV.turnSlowThreshold) / 0.9, 0, 1);
    step *= THREE.MathUtils.lerp(1.0, 0.2, t);
  }
  if (yLevel <= 0.02 && Math.abs(dy) > CAT_NAV.turnStopThreshold) {
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    cat.nav.lastSpeed = 0;
    cat.nav.stuckT += dt * 0.4;
    if (cat.nav.stuckT > 0.4 && getClockTime() >= cat.nav.repathAt) {
      ensureCatPath(target, true, !ignoreDynamic);
      cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
    }
    return false;
  }

  if (yLevel <= 0.02) {
    const staticObstacles = buildCatObstacles(false);
    const dynamicObstacles = ignoreDynamic ? staticObstacles : buildCatObstacles(true, true);
    const steerTarget = chase;
    const steer = chooseGroundSteer(steerTarget, step, staticObstacles, dynamicObstacles, ignoreDynamic);
    if (!steer) {
      cat.nav.stuckT += dt;
      if (cat.nav.stuckT > 0.55) {
        nudgeBlockingPickupAwayFromCat();
      }
      if (cat.nav.stuckT > 0.3 && getClockTime() >= cat.nav.repathAt) {
        ensureCatPath(target, true, !ignoreDynamic);
        cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
      }
      if (cat.nav.stuckT > 1.15) {
        clearCatNavPath(false);
      }
      return false;
    }

    tempFrom.copy(cat.pos);
    const facingDelta = Math.abs(
      Math.atan2(Math.sin(steer.yaw - cat.group.rotation.y), Math.cos(steer.yaw - cat.group.rotation.y))
    );
    const forwardScale = THREE.MathUtils.clamp(1 - facingDelta / 1.7, 0.26, 1);
    const steerStep = step * forwardScale;
    cat.pos.x += steer.sx * steerStep;
    cat.pos.z += steer.sz * steerStep;
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    cat.nav.steerYaw = steer.yaw;
    rotateCatToward(steer.yaw, dt);

    const moved = cat.pos.distanceTo(tempFrom);
    if (moved < CAT_NAV.stuckSpeed * dt && d > 0.18) {
      cat.nav.stuckT += dt;
      if (cat.nav.stuckT > 0.36 && getClockTime() >= cat.nav.repathAt) {
        ensureCatPath(target, true, !ignoreDynamic);
        cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
      }
    } else {
      cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.9);
    }
    cat.nav.lastSpeed = moved / Math.max(dt, 1e-5);
    return cat.pos.distanceToSquared(target) < 0.14 * 0.14;
  }

  tempFrom.copy(cat.pos);
  cat.pos.x += nx * step;
  cat.pos.z += nz * step;
  cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);

  const moved = cat.pos.distanceTo(tempFrom);
  cat.nav.lastSpeed = moved / Math.max(dt, 1e-5);

  return cat.pos.distanceToSquared(target) < 0.14 * 0.14;
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


function pickRandomPatrolPoint(from = cat.pos) {
  const obstacles = buildCatObstacles(true, true);
  const clearance = getCatPathClearance();
  const minX = ROOM.minX + CAT_NAV.margin + 0.12;
  const maxX = ROOM.maxX - CAT_NAV.margin - 0.12;
  const minZ = ROOM.minZ + CAT_NAV.margin + 0.12;
  const maxZ = ROOM.maxZ - CAT_NAV.margin - 0.12;

  for (let i = 0; i < 90; i++) {
    const x = THREE.MathUtils.lerp(minX, maxX, Math.random());
    const z = THREE.MathUtils.lerp(minZ, maxZ, Math.random());
    if (isCatPointBlocked(x, z, obstacles, clearance)) continue;
    const candidate = new THREE.Vector3(x, 0, z);
    if (candidate.distanceToSquared(from) < 0.65 * 0.65) continue;
    if (!canReachGroundTarget(from, candidate, obstacles)) continue;
    return candidate;
  }

  return findSafeGroundPoint(from.clone());
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


function getCatPickupOverlap() {
  let count = 0;
  let maxPenetration = 0;
  const catRadius = CAT_COLLISION.catBodyRadius + 0.04;
  for (const p of pickups) {
    if (!p.body) continue;
    if (isDraggingPickup(p)) continue;
    if (p.body.position.y > 1.25) continue;
    const itemRadius = pickupRadius(p) * 0.98;
    const dx = p.body.position.x - cat.pos.x;
    const dz = p.body.position.z - cat.pos.z;
    const dist = Math.hypot(dx, dz);
    const minDist = catRadius + itemRadius;
    const penetration = minDist - dist;
    if (penetration > 0) {
      count++;
      if (penetration > maxPenetration) maxPenetration = penetration;
    }
  }
  return { count, maxPenetration };
}


function getCatObstacleIntrusion() {
  const catRadius = CAT_COLLISION.catBodyRadius;
  const nearPadding = 0.08;
  const obstacles = buildCatObstacles(true, true);
  let intersectCount = 0;
  let nearCount = 0;
  let maxPenetration = 0;
  let maxNearness = 0;

  for (const obs of obstacles) {
    const dx = cat.pos.x - obs.x;
    const dz = cat.pos.z - obs.z;
    let penetration = 0;
    let nearness = 0;

    if (obs.kind === "circle") {
      const signed = Math.hypot(dx, dz) - (obs.r + catRadius);
      penetration = -Math.min(0, signed);
      if (signed > 0 && signed < nearPadding) nearness = nearPadding - signed;
    } else if (obs.kind === "box") {
      const ox = Math.abs(dx) - (obs.hx + catRadius);
      const oz = Math.abs(dz) - (obs.hz + catRadius);
      if (ox <= 0 && oz <= 0) {
        penetration = Math.min(-ox, -oz);
      } else {
        const outX = Math.max(0, ox);
        const outZ = Math.max(0, oz);
        const gap = Math.hypot(outX, outZ);
        if (gap < nearPadding) nearness = nearPadding - gap;
      }
    } else if (obs.kind === "obb") {
      const c = Math.cos(obs.yaw);
      const s = Math.sin(obs.yaw);
      const lx = c * dx + s * dz;
      const lz = -s * dx + c * dz;
      const ox = Math.abs(lx) - (obs.hx + catRadius);
      const oz = Math.abs(lz) - (obs.hz + catRadius);
      if (ox <= 0 && oz <= 0) {
        penetration = Math.min(-ox, -oz);
      } else {
        const outX = Math.max(0, ox);
        const outZ = Math.max(0, oz);
        const gap = Math.hypot(outX, outZ);
        if (gap < nearPadding) nearness = nearPadding - gap;
      }
    }

    if (penetration > 0) {
      intersectCount++;
      if (penetration > maxPenetration) maxPenetration = penetration;
    } else if (nearness > 0) {
      nearCount++;
      if (nearness > maxNearness) maxNearness = nearness;
    }
  }

  return { intersectCount, nearCount, maxPenetration, maxNearness };
}


function isCatCagedByPickups() {
  const staticObstacles = buildCatObstacles(false);
  const dynamicObstacles = buildCatObstacles(true, true);
  const clearance = getCatPathClearance();
  const radii = [0.28, 0.42];
  const dirs = 16;
  let staticFree = 0;
  let dynamicFree = 0;

  for (const r of radii) {
    for (let i = 0; i < dirs; i++) {
      const t = (i / dirs) * Math.PI * 2;
      const x = cat.pos.x + Math.cos(t) * r;
      const z = cat.pos.z + Math.sin(t) * r;
      const sFree = !isCatPointBlocked(x, z, staticObstacles, clearance);
      if (sFree) {
        staticFree++;
        if (!isCatPointBlocked(x, z, dynamicObstacles, clearance)) dynamicFree++;
      }
    }
  }

  return staticFree >= 3 && dynamicFree === 0;
}


function findNearestCatRecoveryPoint(preferred, includePickups = true) {
  const obstacles = buildCatObstacles(includePickups, includePickups);
  const clearance = getCatPathClearance();
  const isFree = (x, z) => !isCatPointBlocked(x, z, obstacles, clearance);
  const isNavigable = (x, z) => {
    if (!isFree(x, z)) return false;
    let exits = 0;
    const exitR = 0.26;
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      const ex = x + Math.cos(t) * exitR;
      const ez = z + Math.sin(t) * exitR;
      if (isFree(ex, ez)) exits++;
      if (exits >= 2) return true;
    }
    return false;
  };

  if (isNavigable(preferred.x, preferred.z)) return preferred.clone();

  let best = null;
  let bestD2 = Infinity;
  for (let r = 0.16; r <= 2.8; r += 0.12) {
    const steps = Math.max(12, Math.floor(r * 34));
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const x = preferred.x + Math.cos(t) * r;
      const z = preferred.z + Math.sin(t) * r;
      if (!isNavigable(x, z)) continue;
      const d2 = (x - preferred.x) * (x - preferred.x) + (z - preferred.z) * (z - preferred.z);
      if (d2 < bestD2) {
        bestD2 = d2;
        if (!best) best = new THREE.Vector3();
        best.set(x, 0, z);
      }
    }
    if (best) break;
  }
  return best;
}


function recoverCatFromPickupTrap(dt) {
  if (cat.jump || cat.onTable || cat.group.position.y > 0.04) {
    cat.nav.pickupTrapT = 0;
    cat.nav.unstuckCheckAt = getClockTime();
    cat.nav.unstuckCheckPos.copy(cat.pos);
    return false;
  }

  const since = getClockTime() - cat.nav.unstuckCheckAt;
  if (since < CAT_NAV.unstuckCheckInterval) return false;

  const moved = cat.pos.distanceTo(cat.nav.unstuckCheckPos);
  const sampleDt = since;
  cat.nav.unstuckCheckAt = getClockTime();
  cat.nav.unstuckCheckPos.copy(cat.pos);

  const overlap = getCatPickupOverlap();
  const intrusion = getCatObstacleIntrusion();
  const caged = isCatCagedByPickups();
  const goal = getCurrentGroundGoal();
  const hasGoal = !!goal;
  const goalDist2 = hasGoal ? cat.pos.distanceToSquared(goal) : 0;
  const nearGoal = hasGoal && goalDist2 < 0.18 * 0.18;
  const movementStalled = hasGoal && !nearGoal && moved < CAT_NAV.unstuckMinMove && cat.nav.stuckT > 0.16;
  const nearIntrusion = intrusion.nearCount > 0 && moved < CAT_NAV.unstuckMinMove * 1.25;
  const trapDetected = intrusion.intersectCount > 0 || nearIntrusion || overlap.count > 0 || caged || movementStalled;

  if (!trapDetected) {
    cat.nav.pickupTrapT = Math.max(0, cat.nav.pickupTrapT - sampleDt * 2.2);
    return false;
  }

  const overlapPressure = overlap.count > 0 ? 1 + overlap.maxPenetration * 3.2 : 1.0;
  const intrusionPressure =
    intrusion.intersectCount > 0
      ? 1 + intrusion.maxPenetration * 4.0
      : intrusion.nearCount > 0
        ? 1 + intrusion.maxNearness * 3.0
        : 1.0;
  const cageBoost = caged ? 1.9 : 1.0;
  cat.nav.pickupTrapT += sampleDt * Math.max(overlapPressure, intrusionPressure) * cageBoost;
  if (cat.nav.pickupTrapT < 0.1) return false;

  let recovery = findNearestCatRecoveryPoint(cat.pos, true);
  if (!recovery) recovery = findNearestCatRecoveryPoint(cat.pos, false);
  if (!recovery || recovery.distanceToSquared(cat.pos) < 0.01) {
    nudgeBlockingPickupAwayFromCat();
    cat.nav.pickupTrapT = 0.12;
    return false;
  }

  cat.pos.copy(recovery);
  cat.group.position.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.goal.set(cat.pos.x, 0, cat.pos.z);
  clearCatNavPath(true);
  resetCatUnstuckTracking();
  cat.nav.stuckT = 0;
  cat.status = "Recovering";
  nudgeBlockingPickupAwayFromCat();

  if (goal) ensureCatPath(goal, true, true);
  return true;
}


function nudgeBlockingPickupAwayFromCat() {
  let best = null;
  let bestD2 = Infinity;
  for (const p of pickups) {
    if (!p.body) continue;
    if (isDraggingPickup(p)) continue;
    if (p.body.position.y > 1.2) continue;
    const dx = p.body.position.x - cat.pos.x;
    const dz = p.body.position.z - cat.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2 && d2 < 0.54 * 0.54) {
      best = p;
      bestD2 = d2;
    }
  }
  if (!best) return false;

  let dx = best.body.position.x - cat.pos.x;
  let dz = best.body.position.z - cat.pos.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    dx = Math.sin(cat.group.rotation.y);
    dz = Math.cos(cat.group.rotation.y);
    d = 1;
  }
  const nx = dx / d;
  const nz = dz / d;
  const minDist = 0.28 + pickupRadius(best) * 0.9;
  best.body.position.x = cat.pos.x + nx * (minDist + 0.08);
  best.body.position.z = cat.pos.z + nz * (minDist + 0.08);
  best.body.velocity.x += nx * (best.type === "trash" ? 1.25 : 0.95);
  best.body.velocity.z += nz * (best.type === "trash" ? 1.25 : 0.95);
  best.body.velocity.y = Math.max(best.body.velocity.y, best.type === "trash" ? 0.8 : 0.62);
  best.body.wakeUp();
  best.inMotion = true;
  if (best.motion === "drag") best.motion = "bounce";
  return true;
}


function getCurrentGroundGoal() {
  if (cat.state === "patrol") return cat.patrolTarget;
  if (cat.state === "toDesk") return cat.jumpAnchor || bestDeskJumpAnchor(cat.pos);
  if (cat.state === "toCatnip" && game.catnip) return game.catnip.pos;
  if (cat.state === "toCup") return new THREE.Vector3(desk.cup.x - 0.36, 0, desk.cup.z + 0.02);
  return null;
}


function keepCatAwayFromCup(minDist = CUP_COLLISION.catAvoidRadius) {
  if (cup.broken || cup.falling) return;
  const cx = cup.group.position.x;
  const cz = cup.group.position.z;
  let dx = cat.pos.x - cx;
  let dz = cat.pos.z - cz;
  let d = Math.hypot(dx, dz);
  if (d >= minDist) return;
  if (d < 1e-4) {
    const yaw = cat.group.rotation.y;
    dx = Math.sin(yaw);
    dz = Math.cos(yaw);
    d = 1;
  }
  const nx = dx / d;
  const nz = dz / d;
  cat.pos.x = cx + nx * minDist;
  cat.pos.z = cz + nz * minDist;
  cat.group.position.x = cat.pos.x;
  cat.group.position.z = cat.pos.z;
}


  return {
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    computeCatPath,
    canReachGroundTarget,
    ensureCatPath,
    bestDeskJumpAnchor,
    computeDeskJumpTargets,
    moveCatToward,
    findSafeGroundPoint,
    pickRandomPatrolPoint,
    sampleSwipePose,
    recoverCatFromPickupTrap,
    nudgeBlockingPickupAwayFromCat,
    getCurrentGroundGoal,
    keepCatAwayFromCup,
  };
}
