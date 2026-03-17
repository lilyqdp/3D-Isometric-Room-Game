export function createCatJumpRuntime(ctx) {
  const {
    THREE,
    CAT_COLLISION,
    desk,
    cat,
    getElevatedSurfaceDefs,
    getClockTime = () => 0,
  } = ctx;

  function computeJumpNoClipMinY(jump, x, z, progressU) {
    if (!jump || progressU >= 0.96) return null;
    const surfaces = getElevatedSurfaceDefs(true);
    if (!Array.isArray(surfaces) || surfaces.length === 0) return null;
    const pad = Math.max(0.08, CAT_COLLISION.catBodyRadius * 0.9);
    const jumpArc = Math.max(0.02, Number(jump.arc) || 0);
    const jumpTopY = Math.max(jump.fromY, jump.toY) + jumpArc;
    const jumpBottomY = Math.min(jump.fromY, jump.toY) - 0.08;
    let minY = -Infinity;
    for (const s of surfaces) {
      const sy = Number(s?.y);
      const minX = Number(s?.minX);
      const maxX = Number(s?.maxX);
      const minZ = Number(s?.minZ);
      const maxZ = Number(s?.maxZ);
      if (![sy, minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
      if (sy > jumpTopY + 0.14 || sy < jumpBottomY - 0.14) continue;
      const targetIsThisSurface =
        Math.abs(sy - jump.toY) <= 0.14 &&
        jump.to.x >= minX - pad &&
        jump.to.x <= maxX + pad &&
        jump.to.z >= minZ - pad &&
        jump.to.z <= maxZ + pad;
      if (targetIsThisSurface) continue;
      const inside =
        x >= minX - pad &&
        x <= maxX + pad &&
        z >= minZ - pad &&
        z <= maxZ + pad;
      if (!inside) continue;
      minY = Math.max(minY, sy + 0.08);
    }
    return Number.isFinite(minY) ? minY : null;
  }

  function clearActiveJump() {
    cat.jump = null;
  }

  function commitAuthoritativeSurface(surfaceId, authority = "jump-runtime", stickySeconds = 1.0) {
    if (!cat?.nav) return;
    if (!cat.nav.surfaceState || typeof cat.nav.surfaceState !== "object") {
      cat.nav.surfaceState = {};
    }
    const state = cat.nav.surfaceState;
    const resolvedSurfaceId = String(surfaceId || "floor");
    const now = Number(getClockTime?.() || 0);
    state.currentSurfaceId = resolvedSurfaceId;
    state.authority = authority ? String(authority) : "jump-runtime";
    state.updatedAt = now;
    state.authoritativeUntil = now + Math.max(0, Number(stickySeconds) || 0);
    state.lastStableSurfaceId = resolvedSurfaceId;
  }

  function startJump(to, toY, dur, arc, nextState, opts = null) {
    const fromY = cat.group.position.y;
    const dropOrLevelJump = toY <= fromY + 0.03;
    const requestedNextState = nextState || "patrol";
    const resolvedNextState = dropOrLevelJump ? "landStop" : requestedNextState;
    let resolvedDur = dur;
    let preJumpDur = 0;
    let launchDelay = 0;
    const horizontalDist = Math.hypot(to.x - cat.pos.x, to.z - cat.pos.z);
    const downVerticalDist = Math.max(0, fromY - toY);
    const allowClamp = !!(opts && opts.allowClamp);
    if (dropOrLevelJump && requestedNextState !== "landStop") {
      cat.landStopNextState = requestedNextState;
    }
    if (dropOrLevelJump) {
      const jumpSpan = horizontalDist + downVerticalDist * 0.75;
      const scaledPrepDur = THREE.MathUtils.clamp(0.14 + jumpSpan * 0.22, 0.14, 0.58);
      const scaledAirDur = THREE.MathUtils.clamp(0.22 + horizontalDist * 0.2 + downVerticalDist * 0.18, 0.2, 0.62);
      const scaledLandDur = THREE.MathUtils.clamp(0.12 + horizontalDist * 0.06 + downVerticalDist * 0.14, 0.12, 0.3);
      resolvedDur = scaledAirDur;
      preJumpDur = scaledPrepDur;
      launchDelay = THREE.MathUtils.clamp(0.16 + horizontalDist * 0.05, 0.16, 0.28);
      cat.landStopDuration = scaledLandDur;
      if (cat.clipSpecialAction) {
        cat.clipSpecialAction.stop();
        cat.clipSpecialAction = null;
      }
      cat.clipSpecialState = "";
      cat.clipSpecialPhase = "";
    } else {
      const disableUpPrep = !!(opts && opts.upPrep === false);
      if (!disableUpPrep) {
        const explicitUpPrepDur = Number(opts?.preDur);
        if (Number.isFinite(explicitUpPrepDur)) {
          preJumpDur = Math.max(0, explicitUpPrepDur);
        } else {
          preJumpDur = THREE.MathUtils.clamp(0.72 + horizontalDist * 0.12, 0.72, 0.95);
        }
      }
      launchDelay = THREE.MathUtils.clamp(0.14 + horizontalDist * 0.045, 0.14, 0.24);
    }
    const explicitLaunchDelay = Number(opts?.launchDelay);
    if (Number.isFinite(explicitLaunchDelay)) launchDelay = Math.max(0, explicitLaunchDelay);
    cat.jump = {
      from: cat.pos.clone(),
      to: to.clone(),
      fromY,
      toY,
      dur: resolvedDur,
      t: 0,
      preDur: preJumpDur,
      preT: 0,
      launchDelay,
      launchDelayT: 0,
      arc,
      nextState: resolvedNextState,
      allowClamp,
      easePos: !!(opts && opts.easePos),
      easeY: !!(opts && opts.easeY),
      avoidDeskClip: !!(opts && opts.avoidDeskClip),
      fromSurfaceId: String(opts?.fromSurfaceId || (fromY <= 0.08 ? "floor" : cat.nav?.surfaceState?.currentSurfaceId || "floor")),
      toSurfaceId: String(opts?.toSurfaceId || (toY <= 0.08 ? "floor" : cat.nav?.jumpDownLandingSurfaceId || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.currentSurfaceId || "desk")),
    };
  }

  function updateJump(dt) {
    if (!cat.jump) return false;
    const isDownJump = cat.jump.toY <= cat.jump.fromY + 0.03;
    const jumpDx = cat.jump.to.x - cat.jump.from.x;
    const jumpDz = cat.jump.to.z - cat.jump.from.z;
    if (jumpDx * jumpDx + jumpDz * jumpDz > 1e-6) {
      const jumpYaw = Math.atan2(jumpDx, jumpDz);
      const yawDelta = Math.atan2(
        Math.sin(jumpYaw - cat.group.rotation.y),
        Math.cos(jumpYaw - cat.group.rotation.y)
      );
      cat.group.rotation.y += yawDelta * Math.min(1, dt * 12.0);
    }
    let stepDt = dt;
    const hasPrep = (cat.jump.preDur || 0) > 1e-5;
    if (hasPrep && cat.jump.preT < cat.jump.preDur) {
      const remainPrep = Math.max(0, cat.jump.preDur - cat.jump.preT);
      const usedPrep = Math.min(stepDt, remainPrep);
      cat.jump.preT += usedPrep;
      stepDt -= usedPrep;
      cat.pos.copy(cat.jump.from);
      cat.group.position.set(cat.pos.x, cat.jump.fromY, cat.pos.z);
      if (cat.jump.preT < cat.jump.preDur - 1e-5) return false;
    }
    const hasLaunchDelay = (cat.jump.launchDelay || 0) > 1e-5;
    if (hasLaunchDelay && cat.jump.launchDelayT < cat.jump.launchDelay) {
      const remainLaunchDelay = Math.max(0, cat.jump.launchDelay - cat.jump.launchDelayT);
      const usedLaunchDelay = Math.min(stepDt, remainLaunchDelay);
      cat.jump.launchDelayT += usedLaunchDelay;
      stepDt -= usedLaunchDelay;
      cat.pos.copy(cat.jump.from);
      cat.group.position.set(cat.pos.x, cat.jump.fromY, cat.pos.z);
      if (cat.jump.launchDelayT < cat.jump.launchDelay - 1e-5 || stepDt <= 1e-6) return false;
    }

    cat.jump.t += stepDt;
    const u = Math.min(1, cat.jump.t / cat.jump.dur);
    const uPos = cat.jump.easePos ? THREE.MathUtils.smootherstep(u, 0, 1) : u;
    let uY = u;
    if (cat.jump.easeY) {
      uY = isDownJump ? THREE.MathUtils.smoothstep(u, 0, 1) : Math.pow(u, 0.74);
    }
    cat.pos.lerpVectors(cat.jump.from, cat.jump.to, uPos);
    let lift = Math.sin(Math.PI * u) * cat.jump.arc;
    if (isDownJump) {
      const apexU = 0.28;
      if (u <= apexU) {
        lift = cat.jump.arc * (u / Math.max(1e-5, apexU));
      } else {
        const downU = (u - apexU) / Math.max(1e-5, 1 - apexU);
        lift = cat.jump.arc * Math.pow(Math.max(0, 1 - downU), 1.8);
      }
    }
    let y = THREE.MathUtils.lerp(cat.jump.fromY, cat.jump.toY, uY) + lift;
    if (cat.jump.allowClamp) {
      const noClipMinY = computeJumpNoClipMinY(cat.jump, cat.pos.x, cat.pos.z, u);
      if (Number.isFinite(noClipMinY) && y < noClipMinY) y = noClipMinY;
      if (cat.jump.avoidDeskClip && y < desk.topY + 0.08) {
        const halfX = desk.sizeX * 0.5 + 0.12;
        const halfZ = desk.sizeZ * 0.5 + 0.12;
        if (Math.abs(cat.pos.x - desk.pos.x) <= halfX && Math.abs(cat.pos.z - desk.pos.z) <= halfZ) {
          y = desk.topY + 0.08;
        }
      }
    }
    cat.group.position.set(cat.pos.x, y, cat.pos.z);
    const downLandingReady = isDownJump && u >= 0.9 && y <= cat.jump.toY + 0.02;
    if (u >= 1 || downLandingReady) {
      cat.group.position.y = cat.jump.toY;
      const next = cat.jump.nextState;
      const landedSurfaceId = String(cat.jump.toSurfaceId || (cat.jump.toY <= 0.08 ? "floor" : "desk"));
      clearActiveJump();
      commitAuthoritativeSurface(landedSurfaceId, "jump-landed", 1.2);
      cat.state = next;
      return true;
    }
    return false;
  }

  return {
    computeJumpNoClipMinY,
    clearActiveJump,
    startJump,
    updateJump,
  };
}
