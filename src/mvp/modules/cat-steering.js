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
  } = ctx;

  const tempTo = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();

  function ensureNavDebugStore() {
    if (!cat.nav.debugStep || typeof cat.nav.debugStep !== "object") cat.nav.debugStep = {};
    if (!cat.nav.debugCounters || typeof cat.nav.debugCounters !== "object") {
      cat.nav.debugCounters = {
        noPath: 0,
        noSteer: 0,
        repath: 0,
        escape: 0,
        rollback: 0,
        rescueSnap: 0,
        turnOnlyRepath: 0,
        segmentRescue: 0,
      };
    }
    if (!Array.isArray(cat.nav.debugEvents)) cat.nav.debugEvents = [];
  }

  function bumpDebugCounter(name) {
    ensureNavDebugStore();
    cat.nav.debugCounters[name] = (cat.nav.debugCounters[name] || 0) + 1;
  }

  function recordNavEvent(kind, data = null) {
    ensureNavDebugStore();
    const evt = {
      t: getClockTime(),
      kind,
      state: cat.state,
    };
    if (data && typeof data === "object") Object.assign(evt, data);
    cat.nav.debugEvents.push(evt);
    if (cat.nav.debugEvents.length > 60) {
      cat.nav.debugEvents.splice(0, cat.nav.debugEvents.length - 60);
    }
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
    const fallback = {
      idle: { planarSpeed: 0, turnRate: 0, localX: 0, localZ: 0 },
      walkF: { planarSpeed: 0.9, turnRate: 1.1, localX: 0, localZ: 1 },
      walkL: { planarSpeed: 0.78, turnRate: 0.7, localX: 0.32, localZ: 0.95 },
      walkR: { planarSpeed: 0.78, turnRate: 0.7, localX: -0.32, localZ: 0.95 },
      turn45L: { planarSpeed: 0, turnRate: 0.76, localX: 0, localZ: 0 },
      turn45R: { planarSpeed: 0, turnRate: 0.76, localX: 0, localZ: 0 },
      turn90L: { planarSpeed: 0, turnRate: 1.52, localX: 0, localZ: 0 },
      turn90R: { planarSpeed: 0, turnRate: 1.52, localX: 0, localZ: 0 },
    };
    return (
      (cat.locomotion && cat.locomotion.profiles && cat.locomotion.profiles[clipKey]) ||
      fallback[clipKey] ||
      fallback.walkF
    );
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

  function chooseGroundLocomotion(rawYawDelta, dt) {
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

    const isTurn90 = prev === "turn90L" || prev === "turn90R";
    const lockedSide = prev.endsWith("L") ? 1 : prev.endsWith("R") ? -1 : side;

    // Single-turn-clip policy: avoids visible frame popping from turn90<->turn45 transitions.
    let desired = "walkF";
    if (isTurn90) {
      // Hysteresis while already turning.
      desired = absDy > 0.24 ? (lockedSide > 0 ? "turn90L" : "turn90R") : "walkF";
    } else if (absDy > 0.36) {
      desired = side > 0 ? "turn90L" : "turn90R";
    }

    const hold = Number.isFinite(cat.nav.locomotionHoldT) ? cat.nav.locomotionHoldT : 0;
    const holdThreshold = Math.max(0.04, Number.isFinite(CAT_NAV.locomotionSwitchHold) ? CAT_NAV.locomotionSwitchHold : 0.12);
    if (desired !== prev) {
      const isLeftRightFlip =
        (prev === "turn90L" && desired === "turn90R") ||
        (prev === "turn90R" && desired === "turn90L");
      if (isLeftRightFlip && absDy < 1.05) {
        // Keep previous side near the end of turns; prevents visual jitter/back-step.
        cat.nav.locomotionHoldT = Math.min(0.2, hold + dt);
        return prev;
      }
      const promoteToSharpTurn = desired.startsWith("turn90") && !prev.startsWith("turn90");
      if (!promoteToSharpTurn && hold < holdThreshold) {
        cat.nav.locomotionHoldT = hold + dt;
        return prev;
      }
      cat.nav.locomotionHoldT = 0;
      return desired;
    }

    cat.nav.locomotionHoldT = Math.min(0.2, hold + dt);
    return desired;
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
      const turnOnlyT = Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0;
      if (cat.nav.stuckT < 0.18 && turnOnlyT < 0.25 && faceDelta > 1.15) return;

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
      for (const offset of GROUND_STEER_OFFSETS_FULL) evaluate(offset, true);
    }
    return best;
  }

  function sampleObstacleOverlapScore(x, z, obstacles, clearance) {
    let score = 0;
    for (const obs of obstacles) {
      const dx = x - obs.x;
      const dz = z - obs.z;
      if (obs.kind === "circle") {
        const rr = obs.r + clearance;
        const dist = Math.hypot(dx, dz);
        if (dist < rr) score += 1 + (rr - dist);
        continue;
      }
      if (obs.kind === "obb") {
        const c = Math.cos(obs.yaw || 0);
        const s = Math.sin(obs.yaw || 0);
        const lx = c * dx + s * dz;
        const lz = -s * dx + c * dz;
        const ex = obs.hx + clearance;
        const ez = obs.hz + clearance;
        const ox = ex - Math.abs(lx);
        const oz = ez - Math.abs(lz);
        if (ox > 0 && oz > 0) score += 1 + Math.min(ox, oz);
        continue;
      }
      const ox = obs.hx + clearance - Math.abs(dx);
      const oz = obs.hz + clearance - Math.abs(dz);
      if (ox > 0 && oz > 0) score += 1 + Math.min(ox, oz);
    }
    return score;
  }

  function chooseGroundEscapeStep(target, step, staticObstacles, dynamicObstacles, clearance) {
    const currentOverlap = sampleObstacleOverlapScore(cat.pos.x, cat.pos.z, dynamicObstacles, clearance);
    if (currentOverlap <= 0.0001) return null;

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
        if (isCatPointBlocked(tx, tz, staticObstacles, clearance)) continue;
        const overlap = sampleObstacleOverlapScore(tx, tz, dynamicObstacles, clearance);
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

  function findNearestNavigablePoint(origin, target, staticObstacles, dynamicObstacles, clearance) {
    const baseYaw = Math.atan2(target.x - origin.x, target.z - origin.z);
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
        if (isCatPointBlocked(x, z, staticObstacles, clearance)) continue;
        if (isCatPointBlocked(x, z, dynamicObstacles, clearance)) continue;
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

  function moveCatToward(target, dt, speed, yLevel, opts = {}) {
    ensureNavDebugStore();
    let direct = !!opts.direct;
    let ignoreDynamic = !!opts.ignoreDynamic;
    let chase = target;
    const speedRef = getSpeedRef(speed);
    cat.nav.commandedSpeed = speedRef;
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
            bumpDebugCounter("repath");
            recordNavEvent("repath-segment-blocked", { ignoreDynamic: !!ignoreDynamic });
            if (cat.nav.path.length > 1) {
              const nIndex = THREE.MathUtils.clamp(cat.nav.index, 1, cat.nav.path.length - 1);
              chase = cat.nav.path[nIndex];
              if (!hasClearTravelLine(cat.pos, chase, segmentObstacles, segmentClearance)) {
                const rescueChase = findNearestNavigablePoint(cat.pos, tempTo, buildCatObstacles(false), segmentObstacles, segmentClearance);
                if (rescueChase) {
                  chase = rescueChase;
                  bumpDebugCounter("segmentRescue");
                  recordNavEvent("segment-blocked-local-rescue", { x: rescueChase.x, z: rescueChase.z });
                }
              }
            }
          }
        }
        if (cat.nav.path.length <= 1) {
          cat.nav.debugStep = {
            phase: "ground",
            reason: "noPath",
            direct,
            ignoreDynamic,
            targetX: target.x,
            targetZ: target.z,
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

    }

    cat.nav.debugDestination.set(target.x, yLevel, target.z);

    const dx = chase.x - cat.pos.x;
    const dz = chase.z - cat.pos.z;
    const d = Math.hypot(dx, dz);
    cat.nav.debugStep = {
      phase: yLevel <= 0.02 ? "ground" : "elevated",
      reason: "active",
      direct,
      ignoreDynamic,
      targetX: target.x,
      targetZ: target.z,
      chaseX: chase.x,
      chaseZ: chase.z,
      distToChase: d,
      pathLen: cat.nav.path.length,
      pathIndex: cat.nav.index,
      stuckT: cat.nav.stuckT,
      turnOnlyT: Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0,
      time: getClockTime(),
    };
    if (d < 0.06) {
      cat.nav.debugStep.reason = "nearTarget";
      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      setLocomotionIntent("idle", 0);
      updateDriveSpeed(0, dt);
      clearNavMotionMetrics();
      return cat.pos.distanceTo(target) < 0.14;
    }
    const nx = dx / d;
    const nz = dz / d;
    const yaw = Math.atan2(nx, nz);
    const rawDy = angleDelta(yaw, cat.group.rotation.y);
    let moveSpeed = 0;
    let step = 0;
    let locomotionClip = "walkF";
    const maxLocoScale = Math.max(1.0, Number.isFinite(CAT_NAV.locomotionScaleCap) ? CAT_NAV.locomotionScaleCap : 8.0);
    let locomotionScale = THREE.MathUtils.clamp(speedRef, 0.35, maxLocoScale);
    let turnOnly = false;

    if (yLevel <= 0.02) {
      locomotionClip = chooseGroundLocomotion(rawDy, dt);
      turnOnly = locomotionClip.startsWith("turn");
      cat.nav.debugStep.rawYawDelta = rawDy;
      cat.nav.debugStep.turnOnly = turnOnly;
      if (turnOnly) {
        locomotionScale = THREE.MathUtils.clamp(locomotionScale * 0.86, 0.55, Math.min(maxLocoScale, 2.0));
      } else {
        locomotionScale = THREE.MathUtils.clamp(locomotionScale, 0.55, maxLocoScale);
      }
      const profile = getLocomotionProfile(locomotionClip);
      const turnRate = Math.max(0.28, profile.turnRate || CAT_NAV.maxTurnRate * (turnOnly ? 0.46 : 0.7));
      // Keep world yaw speed aligned to the turn clip playback speed to reduce visible foot skating.
      const turnClipScale = turnOnly ? THREE.MathUtils.clamp(locomotionScale, 0.7, 1.8) : locomotionScale;
      let turnBlend = 1;
      if (turnOnly && cat.locomotionActions && cat.locomotionWeights instanceof Map) {
        const turnAction = cat.locomotionActions[locomotionClip];
        const w = turnAction ? cat.locomotionWeights.get(turnAction) : null;
        if (Number.isFinite(w)) turnBlend = THREE.MathUtils.clamp(w, 0.15, 1);
      }
      const maxYawStep = turnRate * turnClipScale * 0.92 * turnBlend * Math.max(dt, 0);
      const yawStep = THREE.MathUtils.clamp(rawDy, -maxYawStep, maxYawStep);
      cat.group.rotation.y += yawStep;
      const clipPlanarSpeed = Math.max(0, profile.planarSpeed) * locomotionScale;
      moveSpeed = updateDriveSpeed(turnOnly ? 0 : clipPlanarSpeed, dt);
      step = turnOnly ? 0 : Math.min(d, moveSpeed * dt);
      cat.nav.commandedSpeed = Math.max(0.05, turnOnly ? turnRate * turnClipScale * CAT_COLLISION.catBodyRadius : clipPlanarSpeed);
      setLocomotionIntent(
        locomotionClip,
        turnOnly ? turnClipScale : Math.max(0.01, moveSpeed / Math.max(profile.planarSpeed, 1e-5))
      );
    } else {
      const profile = getLocomotionProfile("walkF");
      const clipPlanarSpeed = Math.max(0.1, profile.planarSpeed) * THREE.MathUtils.clamp(speedRef, 0.5, maxLocoScale);
      moveSpeed = updateDriveSpeed(clipPlanarSpeed, dt);
      step = Math.min(d, moveSpeed * dt);
      cat.nav.commandedSpeed = Math.max(0.05, clipPlanarSpeed);
      setLocomotionIntent("walkF", Math.max(0.01, moveSpeed / Math.max(profile.planarSpeed, 1e-5)));
    }

    if (yLevel <= 0.02) {
      if (turnOnly) {
        cat.nav.debugStep.reason = "turnOnly";
        cat.nav.turnOnlyT = (Number.isFinite(cat.nav.turnOnlyT) ? cat.nav.turnOnlyT : 0) + dt;
        if (d > 0.35 && Math.abs(rawDy) > 0.9) {
          cat.nav.stuckT += dt * 0.45;
        } else {
          cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.2);
        }
        if (cat.nav.turnOnlyT > 0.7 && d > 0.35 && getClockTime() >= cat.nav.repathAt) {
          ensureCatPath(target, true, !ignoreDynamic);
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.8;
          bumpDebugCounter("turnOnlyRepath");
          bumpDebugCounter("repath");
          recordNavEvent("repath-turnonly", {
            d,
            rawYawDelta: rawDy,
            ignoreDynamic: !!ignoreDynamic,
          });
          cat.nav.turnOnlyT = 0;
        }
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        cat.nav.lastSpeed = 0;
        cat.nav.smoothedSpeed = 0;
        cat.nav.speedNorm = 0;
        return false;
      }
      cat.nav.turnOnlyT = 0;
      const staticClearance = getCatPathClearance();
      const staticObstacles = buildCatObstacles(false);
      const dynamicObstacles = ignoreDynamic ? staticObstacles : buildCatObstacles(true, true);
      const posBlockedStatic = isCatPointBlocked(cat.pos.x, cat.pos.z, staticObstacles, staticClearance * 0.98);
      const posBlockedDynamic = !ignoreDynamic && isCatPointBlocked(cat.pos.x, cat.pos.z, dynamicObstacles, staticClearance * 0.98);
      cat.nav.debugStep.posBlockedStatic = posBlockedStatic;
      cat.nav.debugStep.posBlockedDynamic = posBlockedDynamic;
      if (posBlockedStatic || posBlockedDynamic) {
        const rescued = findNearestNavigablePoint(cat.pos, chase, staticObstacles, dynamicObstacles, staticClearance);
        if (rescued) {
          cat.pos.copy(rescued);
          cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
          cat.nav.stuckT = 0;
          cat.nav.noSteerFrames = 0;
          ensureCatPath(target, true, !ignoreDynamic);
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.6;
          bumpDebugCounter("rescueSnap");
          recordNavEvent("rescue-from-blocked-pos", { x: rescued.x, z: rescued.z });
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
        const escape = chooseGroundEscapeStep(steerTarget, step, staticObstacles, dynamicObstacles, staticClearance);
        if (escape) {
          cat.nav.debugStep.reason = "escapeStep";
          tempFrom.copy(cat.pos);
          cat.pos.x += escape.sx * escape.step;
          cat.pos.z += escape.sz * escape.step;
          if (isCatPointBlocked(cat.pos.x, cat.pos.z, staticObstacles, staticClearance * 0.98)) {
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
            cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.25);
            cat.nav.noSteerFrames = 0;
            bumpDebugCounter("escape");
            recordNavEvent("escape-step", { moved });
            return false;
          }
        }
        cat.nav.debugStep.reason = "noSteer";
        cat.nav.debugStep.overlapDynamic = sampleObstacleOverlapScore(cat.pos.x, cat.pos.z, dynamicObstacles, staticClearance);
        setLocomotionIntent("idle", 0);
        updateDriveSpeed(0, dt);
        cat.nav.stuckT += dt;
        cat.nav.noSteerFrames = (cat.nav.noSteerFrames || 0) + 1;
        cat.nav.debugStep.noSteerFrames = cat.nav.noSteerFrames;
        bumpDebugCounter("noSteer");
        const now = getClockTime();
        const shouldForceRepath = cat.nav.noSteerFrames > 0;
        if ((cat.nav.stuckT > 0.06 || shouldForceRepath) && now >= cat.nav.repathAt) {
          ensureCatPath(target, true, !ignoreDynamic);
          cat.nav.repathAt = now + CAT_NAV.repathInterval * (shouldForceRepath ? 0.15 : 0.35);
          bumpDebugCounter("repath");
          recordNavEvent("repath-stuck", {
            ignoreDynamic: !!ignoreDynamic,
            stuckT: cat.nav.stuckT,
            noSteerFrames: cat.nav.noSteerFrames,
          });
        }
        if (cat.nav.stuckT > 0.14 || cat.nav.noSteerFrames > 1) {
          const rescued = findNearestNavigablePoint(cat.pos, steerTarget, staticObstacles, dynamicObstacles, staticClearance);
          if (rescued) {
            cat.pos.copy(rescued);
            cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
            cat.nav.stuckT = 0;
            cat.nav.noSteerFrames = 0;
            ensureCatPath(target, true, !ignoreDynamic);
            cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval * 0.6;
            bumpDebugCounter("rescueSnap");
            recordNavEvent("rescue-snap", { x: rescued.x, z: rescued.z });
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
      if (isCatPointBlocked(cat.pos.x, cat.pos.z, collisionObstacles, collisionClearance * 0.98)) {
        cat.nav.debugStep.reason = "rollback-blocked";
        cat.pos.copy(tempFrom);
        cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
        setLocomotionIntent("idle", 0);
        updateDriveSpeed(0, dt);
        clearNavMotionMetrics();
        cat.nav.stuckT += dt;
        bumpDebugCounter("rollback");
        if (getClockTime() >= cat.nav.repathAt) {
          ensureCatPath(target, true, !ignoreDynamic);
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
          bumpDebugCounter("repath");
          recordNavEvent("repath-rollback", { ignoreDynamic: !!ignoreDynamic, stuckT: cat.nav.stuckT });
        }
        return false;
      }

      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      cat.nav.steerYaw = steer.yaw;

      const moved = cat.pos.distanceTo(tempFrom);
      if (moved > 0.003) cat.nav.noSteerFrames = 0;
      const movingExpected = moveSpeed > CAT_NAV.stuckSpeed * 1.5;
      if (movingExpected && moved < CAT_NAV.stuckSpeed * dt && d > 0.18) {
        cat.nav.stuckT += dt;
        if (cat.nav.stuckT > 0.36 && getClockTime() >= cat.nav.repathAt) {
          ensureCatPath(target, true, !ignoreDynamic);
          cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
        }
      } else {
        cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.9);
      }
      setNavMotionMetrics(moved, dt, Math.max(0.05, cat.nav.commandedSpeed));
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
      cat.nav.debugStep.reason = "elevated-noStep";
      cat.pos.copy(tempFrom);
      cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
      setLocomotionIntent("idle", 0);
      updateDriveSpeed(0, dt);
      clearNavMotionMetrics();
      cat.nav.stuckT += dt * 0.5;
      return false;
    }
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    cat.nav.steerYaw = pickedYaw;
    rotateCatToward(pickedYaw, dt);

    const moved = cat.pos.distanceTo(tempFrom);
    setNavMotionMetrics(moved, dt, Math.max(0.05, cat.nav.commandedSpeed));

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
