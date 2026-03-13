export function createCatStateMachineUtilsRuntime(ctx) {
  const {
    THREE,
    getClockTime,
    game,
    cat,
    desk,
    windowSill,
    CAT_COLLISION,
    getElevatedSurfaceDefs,
    catnipMouthOffset = 0.34,
  } = ctx;

  const catnipApproachTarget = new THREE.Vector3();

  function getElevatedSurfaceById(surfaceId) {
    if (!surfaceId || surfaceId === "floor") return null;
    if (typeof getElevatedSurfaceDefs !== "function") return null;
    const defs = getElevatedSurfaceDefs(true);
    if (!Array.isArray(defs)) return null;
    return defs.find((s) => String(s?.id || s?.name || "") === String(surfaceId)) || null;
  }

  function findBestElevatedSurfaceAt(x, z, y, pad = 0.18, maxDy = 0.58) {
    const defs = typeof getElevatedSurfaceDefs === "function" ? getElevatedSurfaceDefs(true) : [];
    if (!Array.isArray(defs)) return null;
    let best = null;
    let bestScore = Infinity;
    for (const s of defs) {
      if (!s) continue;
      const sx0 = Number(s.minX);
      const sx1 = Number(s.maxX);
      const sz0 = Number(s.minZ);
      const sz1 = Number(s.maxZ);
      const sy = Number(s.y);
      if (![sx0, sx1, sz0, sz1, sy].every(Number.isFinite)) continue;
      const inside = x >= sx0 - pad && x <= sx1 + pad && z >= sz0 - pad && z <= sz1 + pad;
      if (!inside) continue;
      const dy = Math.abs(sy - y);
      if (dy > maxDy) continue;
      const edgeDist = Math.min(
        Math.abs(x - sx0),
        Math.abs(x - sx1),
        Math.abs(z - sz0),
        Math.abs(z - sz1)
      );
      const score = dy + Math.max(0, 0.22 - edgeDist) * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  function getCurrentCatSurfaceId() {
    const y = Number.isFinite(cat.group.position.y) ? cat.group.position.y : 0;
    if (y <= 0.08 && !cat.onTable) return "floor";

    const best = findBestElevatedSurfaceAt(cat.pos.x, cat.pos.z, y, 0.18, 0.58);
    if (best) return String(best.id || best.name || "desk");

    if (cat.debugMoveSurfaceId && cat.debugMoveSurfaceId !== "floor") {
      const hinted = getElevatedSurfaceById(cat.debugMoveSurfaceId);
      if (hinted) {
        const nearHint =
          cat.pos.x >= hinted.minX - 0.28 &&
          cat.pos.x <= hinted.maxX + 0.28 &&
          cat.pos.z >= hinted.minZ - 0.28 &&
          cat.pos.z <= hinted.maxZ + 0.28 &&
          Math.abs((hinted.y || 0) - y) <= 0.7;
        if (nearHint) return String(hinted.id || hinted.name || "desk");
      }
    }

    return y <= 0.08 ? "floor" : "desk";
  }

  function ensureSurfaceHopTrail() {
    if (!Array.isArray(cat.nav.surfaceHopTrail)) cat.nav.surfaceHopTrail = [];
    return cat.nav.surfaceHopTrail;
  }

  function recordSurfaceHop(fromSurfaceId, toSurfaceId) {
    const fromId = String(fromSurfaceId || "floor");
    const toId = String(toSurfaceId || "floor");
    const trail = ensureSurfaceHopTrail();
    trail.push({ from: fromId, to: toId, at: getClockTime() });
    if (trail.length > 16) trail.splice(0, trail.length - 16);
    cat.nav.lastSurfaceHopFrom = fromId;
    cat.nav.lastSurfaceHopTo = toId;
    cat.nav.lastSurfaceHopAt = getClockTime();
  }

  function setJumpDownDebug(fields = {}, reset = false) {
    if (reset || !cat.nav.jumpDownDebug || typeof cat.nav.jumpDownDebug !== "object") {
      cat.nav.jumpDownDebug = {};
    }
    Object.assign(cat.nav.jumpDownDebug, fields);
    cat.nav.jumpDownDebug.updatedAt = getClockTime();
  }

  function getAvoidSurfaceIdsForHop(sourceSurfaceId, finalSurfaceId) {
    const sourceId = String(sourceSurfaceId || "floor");
    const finalId = String(finalSurfaceId || "floor");
    const avoid = new Set();
    const clockTime = getClockTime();

    const lastHopAge = clockTime - Number(cat.nav.lastSurfaceHopAt || 0);
    if (
      lastHopAge <= 2.1 &&
      cat.nav.lastSurfaceHopTo &&
      cat.nav.lastSurfaceHopFrom &&
      String(cat.nav.lastSurfaceHopTo) === sourceId
    ) {
      const backtrackId = String(cat.nav.lastSurfaceHopFrom);
      if (backtrackId && backtrackId !== sourceId && backtrackId !== finalId) avoid.add(backtrackId);
    }

    const trail = ensureSurfaceHopTrail();
    const seenRecent = new Set();
    for (let i = trail.length - 1; i >= 0 && seenRecent.size < 2; i--) {
      const hop = trail[i];
      if (!hop || !Number.isFinite(hop.at) || clockTime - hop.at > 8.0) continue;
      const hopTo = String(hop.to || "");
      if (!hopTo || hopTo === "floor" || hopTo === sourceId || hopTo === finalId) continue;
      if (seenRecent.has(hopTo)) continue;
      seenRecent.add(hopTo);
      avoid.add(hopTo);
    }

    return Array.from(avoid);
  }

  function isCatOnDeskNow() {
    const y = Number.isFinite(cat.group.position.y) ? cat.group.position.y : 0;
    if (Math.abs(y - (desk.topY + 0.02)) > 0.24) return false;
    const pad = 0.2;
    return (
      cat.pos.x >= desk.pos.x - desk.sizeX * 0.5 - pad &&
      cat.pos.x <= desk.pos.x + desk.sizeX * 0.5 + pad &&
      cat.pos.z >= desk.pos.z - desk.sizeZ * 0.5 - pad &&
      cat.pos.z <= desk.pos.z + desk.sizeZ * 0.5 + pad
    );
  }

  function getCatnipApproachTarget() {
    if (!game.catnip) return null;

    let dx = game.catnip.pos.x - cat.pos.x;
    let dz = game.catnip.pos.z - cat.pos.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      dx = Math.sin(cat.group.rotation.y);
      dz = Math.cos(cat.group.rotation.y);
      len = 1;
    }

    const ux = dx / len;
    const uz = dz / len;
    let tx = game.catnip.pos.x - ux * catnipMouthOffset;
    let tz = game.catnip.pos.z - uz * catnipMouthOffset;

    if (game.catnip.surface && game.catnip.surface !== "floor") {
      const surface = getElevatedSurfaceById(game.catnip.surface);
      if (surface) {
        const edgePad = CAT_COLLISION.catBodyRadius + 0.06;
        tx = THREE.MathUtils.clamp(tx, surface.minX + edgePad, surface.maxX - edgePad);
        tz = THREE.MathUtils.clamp(tz, surface.minZ + edgePad, surface.maxZ - edgePad);
      }
    }

    catnipApproachTarget.set(tx, 0, tz);
    return catnipApproachTarget;
  }

  function faceCatnip(stepDt) {
    if (!game.catnip) return;
    const dx = game.catnip.pos.x - cat.pos.x;
    const dz = game.catnip.pos.z - cat.pos.z;
    if (dx * dx + dz * dz < 1e-6) return;
    const yaw = Math.atan2(dx, dz);
    const dy = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
    cat.group.rotation.y += dy * Math.min(1, stepDt * 7.2);
  }

  function faceWindowOutside(stepDt) {
    const outsideYaw = Number.isFinite(windowSill?.outsideYaw) ? windowSill.outsideYaw : Math.PI;
    const dy = Math.atan2(
      Math.sin(outsideYaw - cat.group.rotation.y),
      Math.cos(outsideYaw - cat.group.rotation.y)
    );
    cat.group.rotation.y += dy * Math.min(1, stepDt * 6.8);
  }

  return {
    getElevatedSurfaceById,
    getCurrentCatSurfaceId,
    recordSurfaceHop,
    setJumpDownDebug,
    getAvoidSurfaceIdsForHop,
    isCatOnDeskNow,
    getCatnipApproachTarget,
    faceCatnip,
    faceWindowOutside,
  };
}

