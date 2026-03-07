export function createCatSteeringRuntime(ctx) {
  const {
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
    nudgeBlockingPickupAwayFromCat,
  } = ctx;

  const tempTo = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();

  function rotateCatToward(yaw, dt) {
    const delta = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
    const maxStep = CAT_NAV.maxTurnRate * dt;
    const clamped = THREE.MathUtils.clamp(delta, -maxStep, maxStep);
    cat.group.rotation.y += clamped;
    return delta;
  }

  const GROUND_STEER_OFFSETS = [0, 0.2, -0.2, 0.42, -0.42, 0.66, -0.66, 0.92, -0.92, 1.22, -1.22, 1.48, -1.48];
  const ELEVATED_STEER_OFFSETS = [0, 0.22, -0.22, 0.44, -0.44, 0.7, -0.7, 1.0, -1.0];

  function getElevatedSurfaceCandidates(yLevel) {
    const surfaces = [];
    if (desk) {
      surfaces.push({
        y: desk.topY + 0.02,
        minX: desk.pos.x - desk.sizeX * 0.5,
        maxX: desk.pos.x + desk.sizeX * 0.5,
        minZ: desk.pos.z - desk.sizeZ * 0.5,
        maxZ: desk.pos.z + desk.sizeZ * 0.5,
      });
    }
    const out = [];
    for (const s of surfaces) {
      if (Math.abs(s.y - yLevel) <= 0.4) out.push(s);
    }
    out.sort((a, b) => Math.abs(a.y - yLevel) - Math.abs(b.y - yLevel));
    return out;
  }

  function nearestSupportedElevatedPoint(x, z, yLevel, margin) {
    const surfaces = getElevatedSurfaceCandidates(yLevel);
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

      const collisionObstacles = ignoreDynamic ? staticObstacles : dynamicObstacles;
      const collisionClearance = getCatPathClearance();
      if (isCatPointBlocked(cat.pos.x, cat.pos.z, collisionObstacles, collisionClearance * 0.98)) {
        cat.pos.copy(tempFrom);
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        cat.nav.lastSpeed = 0;
        cat.nav.stuckT += dt;
        if (getClockTime() >= cat.nav.repathAt) {
          ensureCatPath(target, true, !ignoreDynamic);
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
        }
        return false;
      }

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
    // Elevated movement uses local steering (not global A*); expose a direct 2-point path for debug display.
    cat.nav.path = [
      new THREE.Vector3(cat.pos.x, yLevel, cat.pos.z),
      new THREE.Vector3(target.x, yLevel, target.z),
    ];
    cat.nav.index = 1;
    const elevatedObstacles = ignoreDynamic ? buildCatObstacles(false, true) : buildCatObstacles(true, true);
    const elevatedClearance = getCatPathClearance();
    const supportMargin = CAT_COLLISION.catBodyRadius + 0.04;
    const supportedNow = nearestSupportedElevatedPoint(cat.pos.x, cat.pos.z, yLevel, supportMargin);
    if (supportedNow && ((supportedNow.x - cat.pos.x) ** 2 + (supportedNow.z - cat.pos.z) ** 2) > 0.0016) {
      cat.pos.x = supportedNow.x;
      cat.pos.z = supportedNow.z;
    }
    let pickedYaw = yaw;
    let foundStep = false;
    for (const offset of ELEVATED_STEER_OFFSETS) {
      const testYaw = yaw + offset;
      const sx = Math.sin(testYaw);
      const sz = Math.cos(testYaw);
      const tx = tempFrom.x + sx * step;
      const tz = tempFrom.z + sz * step;
      const supported = nearestSupportedElevatedPoint(tx, tz, yLevel, supportMargin);
      if (!supported || (supported.x - tx) * (supported.x - tx) + (supported.z - tz) * (supported.z - tz) > 0.0025) continue;
      if (isCatPointBlocked(tx, tz, elevatedObstacles, elevatedClearance, yLevel)) continue;
      cat.pos.x = tx;
      cat.pos.z = tz;
      pickedYaw = testYaw;
      foundStep = true;
      break;
    }
    if (!foundStep) {
      cat.pos.copy(tempFrom);
      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      cat.nav.lastSpeed = 0;
      cat.nav.stuckT += dt * 0.5;
      return false;
    }
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    cat.nav.steerYaw = pickedYaw;
    rotateCatToward(pickedYaw, dt);

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

  function pickRandomPatrolPoint(from = cat.pos, allowFallback = true) {
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

    if (!allowFallback) return null;
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

  return {
    moveCatToward,
    findSafeGroundPoint,
    pickRandomPatrolPoint,
    sampleSwipePose,
  };
}
