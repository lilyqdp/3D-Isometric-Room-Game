import { catHasNonFloorSurface } from "./surface-ids.js";

export function createCatRecoveryRuntime(ctx) {
  const {
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
    bestDeskJumpAnchor,
  } = ctx;

  const tempToCatLocal = new THREE.Vector3();
  const tempPickupQuat = new THREE.Quaternion();

  function getCatPickupOverlap() {
    let count = 0;
    let maxPenetration = 0;
    const catRadius = CAT_COLLISION.catBodyRadius + 0.04;
    const catMinY = cat.group.position.y - 0.02;
    const catMaxY = cat.group.position.y + 0.34;
    for (const p of pickups) {
      if (!p.body) continue;
      if (isDraggingPickup(p)) continue;
      if (p.body.position.y > 1.25) continue;
      const shape = p.body.shapes?.[0];
      if (!shape?.halfExtents) continue;
      const pickupMinY = p.body.position.y - shape.halfExtents.y;
      const pickupMaxY = p.body.position.y + shape.halfExtents.y;
      if (pickupMaxY < catMinY || pickupMinY > catMaxY) continue;

      tempToCatLocal.set(cat.pos.x - p.body.position.x, 0, cat.pos.z - p.body.position.z);
      tempPickupQuat
        .set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w)
        .invert();
      tempToCatLocal.applyQuaternion(tempPickupQuat);
      const clampedX = THREE.MathUtils.clamp(tempToCatLocal.x, -shape.halfExtents.x, shape.halfExtents.x);
      const clampedZ = THREE.MathUtils.clamp(tempToCatLocal.z, -shape.halfExtents.z, shape.halfExtents.z);
      const sepX = tempToCatLocal.x - clampedX;
      const sepZ = tempToCatLocal.z - clampedZ;
      const dist = Math.hypot(sepX, sepZ);
      const penetration = catRadius - dist;
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

  function nudgeNearbyPickupsAwayFromCat(radius = CAT_COLLISION.catBodyRadius * 3) {
    const pushRadius = Math.max(0.2, Number.isFinite(radius) ? radius : CAT_COLLISION.catBodyRadius * 2);
    let nudgedCount = 0;
    for (const p of pickups) {
      if (!p.body) continue;
      if (isDraggingPickup(p)) continue;
      if (p.body.position.y > 1.2) continue;
      let dx = p.body.position.x - cat.pos.x;
      let dz = p.body.position.z - cat.pos.z;
      let d = Math.hypot(dx, dz);
      if (d > pushRadius) continue;
      if (d < 1e-4) {
        dx = Math.sin(cat.group.rotation.y);
        dz = Math.cos(cat.group.rotation.y);
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const minDist = Math.max(pushRadius + 0.02, 0.28 + pickupRadius(p) * 0.9 + 0.08);
      p.body.position.x = cat.pos.x + nx * minDist;
      p.body.position.z = cat.pos.z + nz * minDist;
      p.body.velocity.x += nx * (p.type === "trash" ? 1.35 : 1.05);
      p.body.velocity.z += nz * (p.type === "trash" ? 1.35 : 1.05);
      p.body.velocity.y = Math.max(p.body.velocity.y, p.type === "trash" ? 0.82 : 0.64);
      p.body.wakeUp();
      p.inMotion = true;
      if (p.motion === "drag") p.motion = "bounce";
      nudgedCount += 1;
    }
    return nudgedCount;
  }

  function getCurrentGroundGoal() {
    if (cat.state === "patrol") return cat.patrolTarget;
    if (cat.state === "toDesk") return cat.jumpAnchor || bestDeskJumpAnchor(cat.pos);
    if (cat.state === "toCatnip" && game.catnip) return game.catnip.pos;
    if (cat.state === "toCup") return new THREE.Vector3(desk.cup.x - 0.36, 0, desk.cup.z + 0.02);
    return null;
  }

  function recoverCatFromPickupTrap(dt) {
    if (cat.jump || catHasNonFloorSurface(cat, cat.group.position.y, 0.04)) {
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
    const trapDetected =
      intrusion.intersectCount > 0 || nearIntrusion || overlap.count > 0 || caged || movementStalled;

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
    // Pickups should resolve by being shoved out of the cat's radius, not by
    // teleporting the cat into a recovery position.
    if (nudgeBlockingPickupAwayFromCat()) {
      cat.nav.pickupTrapT = Math.max(0, cat.nav.pickupTrapT - 0.08);
      cat.nav.stuckT = Math.max(0, cat.nav.stuckT - sampleDt * 0.6);
      return false;
    }

    cat.nav.pickupTrapT = Math.min(cat.nav.pickupTrapT, 0.16);
    return false;
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
    recoverCatFromPickupTrap,
    nudgeBlockingPickupAwayFromCat,
    nudgeNearbyPickupsAwayFromCat,
    getCurrentGroundGoal,
    keepCatAwayFromCup,
  };
}
