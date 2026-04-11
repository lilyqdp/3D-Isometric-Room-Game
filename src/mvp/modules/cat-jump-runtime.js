export function createCatJumpRuntime(ctx) {
  const {
    THREE,
    CAT_COLLISION,
    cat,
    getSurfaceDefs,
    getSurfaceById,
    getClockTime = () => 0,
    recordFunctionTrace = null,
  } = ctx;

  function traceFunction(name, details = "") {
    if (typeof recordFunctionTrace === "function") {
      recordFunctionTrace(name, details);
    }
  }

  function getSurfaceClipIds(opts = null) {
    const explicitIds = Array.isArray(opts?.clipSurfaceIds)
      ? opts.clipSurfaceIds
      : (opts?.clipSurfaceIds != null ? [opts.clipSurfaceIds] : []);
    const sourceIds = explicitIds.length
      ? explicitIds
      : (opts?.preventSurfaceClip ? [opts?.fromSurfaceId, opts?.toSurfaceId] : []);
    const out = [];
    const seen = new Set();
    for (const value of sourceIds) {
      const surfaceId = String(value || "");
      if (!surfaceId || surfaceId === "floor" || seen.has(surfaceId)) continue;
      seen.add(surfaceId);
      out.push(surfaceId);
    }
    return out;
  }

  function resolveClipSurfaces(surfaceIds = []) {
    const out = [];
    for (const surfaceId of surfaceIds) {
      const surface = typeof getSurfaceById === "function" ? getSurfaceById(surfaceId) : null;
      if (!surface || surface.id === "floor") continue;
      const minX = Number(surface.minX);
      const maxX = Number(surface.maxX);
      const minZ = Number(surface.minZ);
      const maxZ = Number(surface.maxZ);
      const y = Number(surface.y);
      if (![minX, maxX, minZ, maxZ, y].every(Number.isFinite)) continue;
      out.push(surface);
    }
    return out;
  }

  function computeJumpNoClipMinY(jump, x, z, progressU) {
    if (!jump || progressU >= 0.96) return null;
    const surfaces = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : [];
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

  function resolveSurfaceIdForPoint(point, y, preferredSurfaceId = "") {
    const explicit = String(preferredSurfaceId || "");
    if (explicit) {
      if (explicit === "floor") return "floor";
      const explicitSurface = typeof getSurfaceById === "function" ? getSurfaceById(explicit) : null;
      if (explicitSurface) return explicit;
    }
    if (y <= 0.08) return "floor";

    for (const surfaceId of [
      cat.nav?.jumpDownLandingSurfaceId,
      cat.nav?.route?.surfaceId,
      cat.nav?.route?.finalSurfaceId,
      cat.nav?.surfaceState?.currentSurfaceId,
      cat.nav?.surfaceState?.lastStableSurfaceId,
    ]) {
      const resolved = String(surfaceId || "");
      if (resolved && resolved !== "floor") return resolved;
    }

    const surfaces = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : [];
    if (!Array.isArray(surfaces) || !surfaces.length) return "floor";

    const sampleX = Number(point?.x ?? cat.pos.x);
    const sampleZ = Number(point?.z ?? cat.pos.z);
    let bestId = "";
    let bestScore = Infinity;
    for (const surface of surfaces) {
      const surfaceId = String(surface?.id || surface?.name || "");
      const sy = Number(surface?.y);
      const minX = Number(surface?.minX);
      const maxX = Number(surface?.maxX);
      const minZ = Number(surface?.minZ);
      const maxZ = Number(surface?.maxZ);
      if (!surfaceId || ![sy, minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
      if (sy <= 0.04) continue;
      const dx = sampleX < minX ? minX - sampleX : sampleX > maxX ? sampleX - maxX : 0;
      const dz = sampleZ < minZ ? minZ - sampleZ : sampleZ > maxZ ? sampleZ - maxZ : 0;
      const dy = Math.abs(y - sy);
      if (dy > 0.72) continue;
      const score = dx * dx + dz * dz + dy * dy * 2;
      if (score < bestScore) {
        bestScore = score;
        bestId = surfaceId;
      }
    }
    return bestId || "floor";
  }

  function startJump(to, toY, dur, arc, nextState, opts = null) {
    const fromY = cat.group.position.y;
    const dropOrLevelJump = toY < fromY - 0.03;
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
      clipSurfaces: resolveClipSurfaces(getSurfaceClipIds(opts)),
      fromSurfaceId: resolveSurfaceIdForPoint(cat.pos, fromY, opts?.fromSurfaceId || (fromY <= 0.08 ? "floor" : cat.nav?.surfaceState?.currentSurfaceId)),
      toSurfaceId: resolveSurfaceIdForPoint(
        to,
        toY,
        opts?.toSurfaceId || (toY <= 0.08 ? "floor" : cat.nav?.jumpDownLandingSurfaceId || cat.nav?.route?.surfaceId || cat.nav?.surfaceState?.currentSurfaceId || cat.nav?.surfaceState?.lastStableSurfaceId)
      ),
    };
    traceFunction(
      "startJump",
      `from=${cat.jump.fromSurfaceId || "na"} to=${cat.jump.toSurfaceId || "na"} next=${resolvedNextState} y=${cat.jump.fromY.toFixed(2)}->${cat.jump.toY.toFixed(2)}`
    );
  }

  function updateJump(dt) {
    if (!cat.jump) return false;
    const isDownJump = cat.jump.toY < cat.jump.fromY - 0.03;
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
      for (const surface of cat.jump.clipSurfaces || []) {
        if (y >= surface.y + 0.08) continue;
        if (
          cat.pos.x >= surface.minX - 0.12 &&
          cat.pos.x <= surface.maxX + 0.12 &&
          cat.pos.z >= surface.minZ - 0.12 &&
          cat.pos.z <= surface.maxZ + 0.12
        ) {
          y = surface.y + 0.08;
        }
      }
    }
    cat.group.position.set(cat.pos.x, y, cat.pos.z);
    const downLandingReady = isDownJump && u >= 0.9 && y <= cat.jump.toY + 0.02;
    if (u >= 1 || downLandingReady) {
      const landedSurfaceId = resolveSurfaceIdForPoint(cat.jump.to, cat.jump.toY, cat.jump.toSurfaceId);
      const landedSurface = landedSurfaceId !== "floor" && typeof getSurfaceById === "function"
        ? getSurfaceById(landedSurfaceId)
        : null;
      const landedY = landedSurfaceId === "floor"
        ? 0
        : (
            Number.isFinite(landedSurface?.y)
              ? Number(landedSurface.y)
              : Number.isFinite(cat.jump.toY)
                ? cat.jump.toY
                : Math.max(0.02, Number(cat.group.position.y) || 0.02)
          );
      traceFunction(
        "updateJump",
        `landed=${landedSurfaceId || "na"} next=${cat.jump.nextState || "na"} down=${isDownJump ? 1 : 0}`
      );
      cat.pos.copy(cat.jump.to);
      cat.group.position.set(cat.pos.x, landedY, cat.pos.z);
      const next = cat.jump.nextState;
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
