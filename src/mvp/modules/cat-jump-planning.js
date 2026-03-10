export function createCatJumpPlanningRuntime(ctx) {
  const {
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
  } = ctx;

  const deskJumpPerimeter = (() => {
    if (Array.isArray(DESK_JUMP_ANCHORS) && DESK_JUMP_ANCHORS.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < DESK_JUMP_ANCHORS.length; i++) {
        const a = DESK_JUMP_ANCHORS[i];
        if (!a) continue;
        minX = Math.min(minX, a.x);
        maxX = Math.max(maxX, a.x);
        minZ = Math.min(minZ, a.z);
        maxZ = Math.max(maxZ, a.z);
      }
      if (
        Number.isFinite(minX) &&
        Number.isFinite(maxX) &&
        Number.isFinite(minZ) &&
        Number.isFinite(maxZ)
      ) {
        return { minX, maxX, minZ, maxZ };
      }
    }
    return {
      minX: desk.pos.x - desk.sizeX * 0.5 - 0.72,
      maxX: desk.pos.x + desk.sizeX * 0.5 + 0.72,
      minZ: desk.pos.z - desk.sizeZ * 0.5 - 0.68,
      maxZ: desk.pos.z + desk.sizeZ * 0.5 + 0.68,
    };
  })();

  function sampleDeskJumpPerimeter(step = 0.24) {
    const points = [];
    const { minX, maxX, minZ, maxZ } = deskJumpPerimeter;
    const spanX = Math.max(0.001, maxX - minX);
    const spanZ = Math.max(0.001, maxZ - minZ);
    const nx = Math.max(2, Math.ceil(spanX / step) + 1);
    const nz = Math.max(2, Math.ceil(spanZ / step) + 1);
    for (let i = 0; i < nx; i++) {
      const t = nx <= 1 ? 0 : i / (nx - 1);
      const x = THREE.MathUtils.lerp(minX, maxX, t);
      points.push(new THREE.Vector3(x, 0, minZ));
      points.push(new THREE.Vector3(x, 0, maxZ));
    }
    for (let i = 1; i < nz - 1; i++) {
      const t = nz <= 1 ? 0 : i / (nz - 1);
      const z = THREE.MathUtils.lerp(minZ, maxZ, t);
      points.push(new THREE.Vector3(minX, 0, z));
      points.push(new THREE.Vector3(maxX, 0, z));
    }
    return points;
  }

  const deskJumpPerimeterSamples = sampleDeskJumpPerimeter(Math.max(0.2, CAT_NAV.step * 0.8));

  function closestPointOnDeskJumpPerimeter(from) {
    const { minX, maxX, minZ, maxZ } = deskJumpPerimeter;
    const x = THREE.MathUtils.clamp(from.x, minX, maxX);
    const z = THREE.MathUtils.clamp(from.z, minZ, maxZ);

    const outX = from.x < minX || from.x > maxX;
    const outZ = from.z < minZ || from.z > maxZ;
    if (outX || outZ) {
      return new THREE.Vector3(x, 0, z);
    }

    const dxL = Math.abs(from.x - minX);
    const dxR = Math.abs(maxX - from.x);
    const dzB = Math.abs(from.z - minZ);
    const dzT = Math.abs(maxZ - from.z);
    let side = "left";
    let best = dxL;
    if (dxR < best) {
      best = dxR;
      side = "right";
    }
    if (dzB < best) {
      best = dzB;
      side = "bottom";
    }
    if (dzT < best) {
      side = "top";
    }

    if (side === "left") return new THREE.Vector3(minX, 0, z);
    if (side === "right") return new THREE.Vector3(maxX, 0, z);
    if (side === "bottom") return new THREE.Vector3(x, 0, minZ);
    return new THREE.Vector3(x, 0, maxZ);
  }

  function getDeskJumpCandidates(from) {
    const candidates = [closestPointOnDeskJumpPerimeter(from)];
    const seen = new Set();
    const add = (v) => {
      const key = `${v.x.toFixed(3)}:${v.z.toFixed(3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(v);
    };
    for (let i = 0; i < deskJumpPerimeterSamples.length; i++) {
      add(deskJumpPerimeterSamples[i]);
    }
    if (Array.isArray(DESK_JUMP_ANCHORS)) {
      for (let i = 0; i < DESK_JUMP_ANCHORS.length; i++) {
        const a = DESK_JUMP_ANCHORS[i];
        if (a) add(a);
      }
    }
    candidates.sort((a, b) => from.distanceToSquared(a) - from.distanceToSquared(b));
    return candidates;
  }

  function nearestDeskJumpAnchor(from) {
    const staticObstacles = buildCatObstacles(false);
    const candidates = getDeskJumpCandidates(from);
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (isCatPointBlocked(a.x, a.z, staticObstacles, CAT_NAV.clearance * 0.85)) continue;
      const d = from.distanceToSquared(a);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best || candidates[0] || new THREE.Vector3(desk.pos.x, 0, desk.pos.z);
  }

  function bestDeskJumpAnchor(from, desiredTopPoint = null) {
    const staticObstacles = buildCatObstacles(false);
    const dynamicObstacles = buildCatObstacles(true, true);
    const candidates = getDeskJumpCandidates(from);
    const valid = [];
    const maxChecks = Math.min(candidates.length, 32);
    const landingY = desk.topY + 0.02;
    const landingClearance = CAT_COLLISION.catBodyRadius * 1.5;

    for (let i = 0; i < maxChecks; i++) {
      const a = candidates[i];
      if (isCatPointBlocked(a.x, a.z, staticObstacles, CAT_NAV.clearance * 0.85)) continue;

      const path = computeCatPath(from, a, staticObstacles);
      if (!isPathTraversable(path, staticObstacles)) continue;
      const dynamicPath = computeCatPath(from, a, dynamicObstacles);
      if (!isPathTraversable(dynamicPath, dynamicObstacles)) continue;
      const jumpTargets = computeDeskJumpTargets(a, desiredTopPoint);
      if (!jumpTargets) continue;
      if (isCatPointBlocked(jumpTargets.top.x, jumpTargets.top.z, dynamicObstacles, landingClearance, landingY)) continue;
      if (!hasClearTravelLine(jumpTargets.hook, jumpTargets.top, dynamicObstacles, landingClearance, landingY)) continue;

      let score = catPathDistance(dynamicPath) + from.distanceTo(a) * 0.12;
      if (desiredTopPoint) {
        const dx = jumpTargets.top.x - desiredTopPoint.x;
        const dz = jumpTargets.top.z - desiredTopPoint.z;
        score += Math.hypot(dx, dz) * 0.9;
      }
      valid.push({ anchor: a, score });
    }

    if (valid.length > 0) {
      valid.sort((a, b) => a.score - b.score);
      return valid[0].anchor;
    }
    return nearestDeskJumpAnchor(from);
  }

  function computeDeskJumpTargets(anchor, desiredTopPoint = null) {
    const relX = anchor.x - desk.pos.x;
    const relZ = anchor.z - desk.pos.z;
    const hook = new THREE.Vector3();
    const top = new THREE.Vector3();
    const edgeOut = 0.24;
    const topIn = 0.34;

    const comingFromXSide = Math.abs(relX) >= Math.abs(relZ);
    if (comingFromXSide) {
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

    const landingY = desk.topY + 0.02;
    const dynamicObstacles = buildCatObstacles(true, true);
    // Must keep jump destination clear by at least 1.5x cat radius from nearby objects.
    const landingClearance = CAT_COLLISION.catBodyRadius * 1.5;
    const cupAvoid = CAT_COLLISION.catBodyRadius + CUP_COLLISION.radius + 0.18;
    const landingObjectRadius = CAT_COLLISION.catBodyRadius * 1.5;

    const isObjectNearLanding = (p, y) => {
      // Explicitly reject jump landings if cup/pickups are near the touchdown point on this surface.
      if (!cup.broken && !cup.falling && cup.group.visible) {
        const cupY = cup.group.position.y;
        if (Math.abs(cupY - y) <= 0.36) {
          const dx = p.x - cup.group.position.x;
          const dz = p.z - cup.group.position.z;
          const minDist = landingObjectRadius + CUP_COLLISION.radius;
          if (dx * dx + dz * dz < minDist * minDist) return true;
        }
      }
      for (const pickup of pickups) {
        if (!pickup?.mesh || !pickup.body) continue;
        if (!pickup.mesh.visible) continue;
        const py = pickup.mesh.position.y;
        if (!Number.isFinite(py) || Math.abs(py - y) > 0.36) continue;
        const dx = p.x - pickup.mesh.position.x;
        const dz = p.z - pickup.mesh.position.z;
        const minDist = landingObjectRadius + Math.max(0.04, pickupRadius(pickup));
        if (dx * dx + dz * dz < minDist * minDist) return true;
      }
      return false;
    };

    const isLandingSafeAtY = (p, y) => {
      if (isObjectNearLanding(p, y)) return false;
      if (isCatPointBlocked(p.x, p.z, dynamicObstacles, landingClearance, y)) return false;
      if (!cup.broken && !cup.falling) {
        const dx = p.x - cup.group.position.x;
        const dz = p.z - cup.group.position.z;
        if (dx * dx + dz * dz < cupAvoid * cupAvoid) return false;
      }
      return true;
    };

    const isLandingSafe = (p) => {
      // Validate both paw plane and upper body plane so obstacles above table are respected too.
      return isLandingSafeAtY(p, landingY) && isLandingSafeAtY(p, landingY + 0.18);
    };

    if (!isLandingSafe(top)) {
      const candidates = [];
      const tangentOffsets = [0, 0.18, -0.18, 0.34, -0.34, 0.48, -0.48];
      const inwardOffsets = [0, 0.12, 0.2];
      if (comingFromXSide) {
        const sx = Math.sign(relX || 1);
        const baseX = desk.pos.x + sx * (desk.sizeX * 0.5 - topIn);
        for (const t of tangentOffsets) {
          for (const inward of inwardOffsets) {
            const z = THREE.MathUtils.clamp(
              top.z + t,
              desk.pos.z - desk.sizeZ * 0.5 + 0.26,
              desk.pos.z + desk.sizeZ * 0.5 - 0.26
            );
            const x = baseX - sx * inward;
            candidates.push(new THREE.Vector3(x, 0, z));
          }
        }
      } else {
        const sz = Math.sign(relZ || 1);
        const baseZ = desk.pos.z + sz * (desk.sizeZ * 0.5 - topIn);
        for (const t of tangentOffsets) {
          for (const inward of inwardOffsets) {
            const x = THREE.MathUtils.clamp(
              top.x + t,
              desk.pos.x - desk.sizeX * 0.5 + 0.28,
              desk.pos.x + desk.sizeX * 0.5 - 0.28
            );
            const z = baseZ - sz * inward;
            candidates.push(new THREE.Vector3(x, 0, z));
          }
        }
      }

      let bestCandidate = null;
      let bestScore = Infinity;
      for (const c of candidates) {
        if (!isLandingSafe(c)) continue;
        if (!hasClearTravelLine(hook, c, dynamicObstacles, landingClearance, landingY)) continue;
        let score = c.distanceToSquared(top);
        if (desiredTopPoint) {
          const dx = c.x - desiredTopPoint.x;
          const dz = c.z - desiredTopPoint.z;
          score += (dx * dx + dz * dz) * 2.0;
        }
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = c;
        }
      }
      if (bestCandidate) top.copy(bestCandidate);
    }

    if (!isLandingSafe(top)) {
      // Hard fallback: pick any safe desk point instead of landing into an occupied zone.
      const minX = desk.pos.x - desk.sizeX * 0.5 + 0.32;
      const maxX = desk.pos.x + desk.sizeX * 0.5 - 0.32;
      const minZ = desk.pos.z - desk.sizeZ * 0.5 + 0.28;
      const maxZ = desk.pos.z + desk.sizeZ * 0.5 - 0.28;
      let best = null;
      let bestD2 = Infinity;
      for (let i = 0; i < 40; i++) {
        const c = new THREE.Vector3(
          THREE.MathUtils.lerp(minX, maxX, Math.random()),
          0,
          THREE.MathUtils.lerp(minZ, maxZ, Math.random())
        );
        if (!isLandingSafe(c)) continue;
        if (!hasClearTravelLine(hook, c, dynamicObstacles, landingClearance, landingY)) continue;
        let d2 = c.distanceToSquared(top);
        if (desiredTopPoint) {
          const dx = c.x - desiredTopPoint.x;
          const dz = c.z - desiredTopPoint.z;
          d2 += (dx * dx + dz * dz) * 2.0;
        }
        if (d2 < bestD2) {
          bestD2 = d2;
          best = c;
        }
      }
      if (best) top.copy(best);
    }

    if (!isLandingSafe(top)) return null;

    return { hook, top };
  }

  return {
    bestDeskJumpAnchor,
    computeDeskJumpTargets,
  };
}
