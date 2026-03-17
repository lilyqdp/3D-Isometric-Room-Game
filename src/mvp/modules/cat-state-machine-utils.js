export function createCatStateMachineUtilsRuntime(ctx) {
  const {
    THREE,
    getClockTime,
    game,
    cat,
    desk,
    windowSill,
    CAT_COLLISION,
    getSurfaceDefs,
    getSurfaceById,
    getElevatedSurfaceDefs,
    catnipMouthOffset = 0.34,
  } = ctx;

  const catnipApproachTarget = new THREE.Vector3();
  const CATNIP_LOCK_POS_EPS = 0.001;

  function ensureSurfaceState() {
    if (!cat.nav.surfaceState || typeof cat.nav.surfaceState !== "object") {
      cat.nav.surfaceState = {};
    }
    const state = cat.nav.surfaceState;
    state.currentSurfaceId = String(state.currentSurfaceId || "floor");
    state.authority = state.authority ? String(state.authority) : "spawn";
    state.authoritativeUntil = Number.isFinite(state.authoritativeUntil) ? state.authoritativeUntil : 0;
    state.updatedAt = Number.isFinite(state.updatedAt) ? state.updatedAt : 0;
    state.lastStableSurfaceId = String(state.lastStableSurfaceId || state.currentSurfaceId || "floor");
    return state;
  }

  function setAuthoritativeCatSurfaceId(surfaceId, authority = "runtime", stickySeconds = 0.9) {
    const state = ensureSurfaceState();
    const resolvedSurfaceId = String(surfaceId || "floor");
    const now = getClockTime();
    state.currentSurfaceId = resolvedSurfaceId;
    state.authority = authority ? String(authority) : "runtime";
    state.updatedAt = now;
    state.authoritativeUntil = now + Math.max(0, Number(stickySeconds) || 0);
    state.lastStableSurfaceId = resolvedSurfaceId;
    return resolvedSurfaceId;
  }

  function matchesAuthoritativeSurface(surfaceId, x, z, y, pad = 0.3, yPad = 0.85) {
    const resolvedSurfaceId = String(surfaceId || "floor");
    if (resolvedSurfaceId === "floor") {
      return y <= 0.2 || (!cat.onTable && y <= 0.26);
    }
    const surface = getElevatedSurfaceById(resolvedSurfaceId);
    if (!surface) return false;
    return isNearElevatedSurface(x, z, y, surface, pad, yPad);
  }

  function getActiveRouteSegment() {
    const route = cat.nav?.route;
    if (!route?.active || !Array.isArray(route.segments) || route.segments.length === 0) return null;
    const segmentIndex = Number.isFinite(route.segmentIndex) ? Math.max(0, route.segmentIndex | 0) : 0;
    return route.segments[segmentIndex] || null;
  }

  function getJumpAuthoritativeSurfaceId(y) {
    const jump = cat.jump;
    if (!jump) return "";
    const fromSurfaceId = String(jump.fromSurfaceId || (jump.fromY <= 0.08 ? "floor" : ""));
    const toSurfaceId = String(jump.toSurfaceId || (jump.toY <= 0.08 ? "floor" : ""));
    const u = Number.isFinite(jump.dur) && jump.dur > 1e-5 ? Math.min(1, Number(jump.t || 0) / jump.dur) : 0;
    if (u >= 0.82 && toSurfaceId && matchesAuthoritativeSurface(toSurfaceId, cat.pos.x, cat.pos.z, y, 0.48, 1.1)) {
      return toSurfaceId;
    }
    if (fromSurfaceId && matchesAuthoritativeSurface(fromSurfaceId, cat.pos.x, cat.pos.z, y, 0.48, 1.1)) {
      return fromSurfaceId;
    }
    return toSurfaceId || fromSurfaceId || "";
  }

  function getRouteAuthoritativeSurfaceId(y) {
    const route = cat.nav?.route;
    const segment = getActiveRouteSegment();
    if (!route?.active && !segment) return "";

    const candidates = [];
    if (segment?.supportSurfaceId != null) candidates.push(String(segment.supportSurfaceId || "floor"));
    if (route?.surface === "floor") candidates.push("floor");
    if (route?.surfaceId != null) candidates.push(String(route.surfaceId || "floor"));
    if (route?.approachSurfaceId != null) candidates.push(String(route.approachSurfaceId || "floor"));
    if (route?.finalSurfaceId != null) candidates.push(String(route.finalSurfaceId || "floor"));

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (matchesAuthoritativeSurface(candidate, cat.pos.x, cat.pos.z, y, 0.34, 0.92)) {
        return candidate;
      }
    }
    return candidates.find(Boolean) || "";
  }

  function getElevatedSurfaceById(surfaceId) {
    if (!surfaceId || surfaceId === "floor") return null;
    if (typeof getSurfaceById === "function") return getSurfaceById(surfaceId);
    if (typeof getElevatedSurfaceDefs !== "function") return null;
    const defs = getElevatedSurfaceDefs(true);
    if (!Array.isArray(defs)) return null;
    return defs.find((s) => String(s?.id || s?.name || "") === String(surfaceId)) || null;
  }

  function scoreElevatedSurfaceAtPoint(x, z, y, s, pad = 0.18, preferredSurfaceId = "") {
    if (!s) return null;
    const sx0 = Number(s.minX);
    const sx1 = Number(s.maxX);
    const sz0 = Number(s.minZ);
    const sz1 = Number(s.maxZ);
    const sy = Number(s.y);
    if (![sx0, sx1, sz0, sz1, sy].every(Number.isFinite)) return null;
    const inside = x >= sx0 - pad && x <= sx1 + pad && z >= sz0 - pad && z <= sz1 + pad;
    if (!inside) return null;
    const dy = Math.abs(sy - y);
    const edgeDist = Math.min(
      Math.abs(x - sx0),
      Math.abs(x - sx1),
      Math.abs(z - sz0),
      Math.abs(z - sz1)
    );
    const surfaceId = String(s.id || s.name || "");
    const preferredBias =
      preferredSurfaceId && surfaceId === String(preferredSurfaceId) ? -0.08 : 0;
    const score = dy + Math.max(0, 0.22 - edgeDist) * 0.2 + preferredBias;
    return { score, surface: s, dy };
  }

  function findBestElevatedSurfaceAt(x, z, y, pad = 0.18, maxDy = 0.58, preferredSurfaceId = "") {
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : (typeof getElevatedSurfaceDefs === "function" ? getElevatedSurfaceDefs(true) : []);
    if (!Array.isArray(defs)) return null;
    let best = null;
    let bestScore = Infinity;
    for (const strictPad of [0.03, pad]) {
      best = null;
      bestScore = Infinity;
      for (const s of defs) {
        const scored = scoreElevatedSurfaceAtPoint(x, z, y, s, strictPad, preferredSurfaceId);
        if (!scored || scored.dy > maxDy) continue;
        if (scored.score < bestScore) {
          bestScore = scored.score;
          best = scored.surface;
        }
      }
      if (best) return best;
    }
    return best;
  }

  function isNearElevatedSurface(x, z, y, surface, pad = 0.28, yPad = 0.7) {
    if (!surface) return false;
    return (
      x >= surface.minX - pad &&
      x <= surface.maxX + pad &&
      z >= surface.minZ - pad &&
      z <= surface.maxZ + pad &&
      Math.abs((surface.y || 0) - y) <= yPad
    );
  }

  function findLooseElevatedSurfaceAt(x, z, y, preferredSurfaceId = "") {
    const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : (typeof getElevatedSurfaceDefs === "function" ? getElevatedSurfaceDefs(true) : []);
    if (!Array.isArray(defs) || defs.length === 0) return null;

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

      const dx = x < sx0 ? sx0 - x : x > sx1 ? x - sx1 : 0;
      const dz = z < sz0 ? sz0 - z : z > sz1 ? z - sz1 : 0;
      const dy = Math.abs(sy - y);
      if (dy > 1.15) continue;

      const surfaceId = String(s.id || s.name || "");
      const preferredBias = preferredSurfaceId && surfaceId === String(preferredSurfaceId) ? -0.18 : 0;
      const score = dx * 1.25 + dz * 1.25 + dy * 1.8 + preferredBias;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  function getCurrentCatSurfaceId() {
    const y = Number.isFinite(cat.group.position.y) ? cat.group.position.y : 0;
    const state = ensureSurfaceState();
    const routeSurfaceId =
      cat.nav?.route?.active && cat.nav?.route?.surfaceId && cat.nav.route.surfaceId !== "floor"
        ? String(cat.nav.route.surfaceId)
        : "";
    const routeFinalSurfaceId =
      cat.nav?.route?.active && cat.nav?.route?.finalSurfaceId && cat.nav.route.finalSurfaceId !== "floor"
        ? String(cat.nav.route.finalSurfaceId)
        : "";
    const routeApproachSurfaceId =
      cat.nav?.route?.active && cat.nav?.route?.approachSurfaceId && cat.nav.route.approachSurfaceId !== "floor"
        ? String(cat.nav.route.approachSurfaceId)
        : "";
    const hintedSurfaceId =
      routeApproachSurfaceId ||
      routeSurfaceId ||
      routeFinalSurfaceId ||
      (cat.debugMoveSurfaceId && cat.debugMoveSurfaceId !== "floor" ? String(cat.debugMoveSurfaceId) : "");

    const jumpAuthoritySurfaceId = getJumpAuthoritativeSurfaceId(y);
    if (jumpAuthoritySurfaceId && matchesAuthoritativeSurface(jumpAuthoritySurfaceId, cat.pos.x, cat.pos.z, y, 0.52, 1.12)) {
      setAuthoritativeCatSurfaceId(jumpAuthoritySurfaceId, "jump", 0.45);
      cat.nav.surfaceResolveDebug = {
        strictSurfaceId: "",
        hintedSurfaceId,
        looseSurfaceId: "",
        authoritativeSurfaceId: jumpAuthoritySurfaceId,
        authoritativeSource: "jump",
        stateSurfaceId: state.currentSurfaceId || "",
        resolvedSurfaceId: jumpAuthoritySurfaceId,
        y,
      };
      return jumpAuthoritySurfaceId;
    }

    const routeAuthoritySurfaceId = getRouteAuthoritativeSurfaceId(y);
    if (routeAuthoritySurfaceId && matchesAuthoritativeSurface(routeAuthoritySurfaceId, cat.pos.x, cat.pos.z, y, 0.38, 0.96)) {
      setAuthoritativeCatSurfaceId(routeAuthoritySurfaceId, "route", 0.55);
      cat.nav.surfaceResolveDebug = {
        strictSurfaceId: "",
        hintedSurfaceId,
        looseSurfaceId: "",
        authoritativeSurfaceId: routeAuthoritySurfaceId,
        authoritativeSource: "route",
        stateSurfaceId: state.currentSurfaceId || "",
        resolvedSurfaceId: routeAuthoritySurfaceId,
        y,
      };
      return routeAuthoritySurfaceId;
    }

    const stickySurfaceId =
      state.currentSurfaceId &&
      (getClockTime() <= Number(state.authoritativeUntil || 0) || getClockTime() - Number(state.updatedAt || 0) <= 0.8)
        ? String(state.currentSurfaceId || "")
        : "";
    if (stickySurfaceId && matchesAuthoritativeSurface(stickySurfaceId, cat.pos.x, cat.pos.z, y, 0.32, 0.88)) {
      cat.nav.surfaceResolveDebug = {
        strictSurfaceId: "",
        hintedSurfaceId,
        looseSurfaceId: "",
        authoritativeSurfaceId: stickySurfaceId,
        authoritativeSource: state.authority || "sticky",
        stateSurfaceId: state.currentSurfaceId || "",
        resolvedSurfaceId: stickySurfaceId,
        y,
      };
      return stickySurfaceId;
    }

    if (y <= 0.08 && !cat.onTable) {
      const resolved = setAuthoritativeCatSurfaceId("floor", "grounded", 0.4);
      cat.nav.surfaceResolveDebug = {
        strictSurfaceId: "floor",
        hintedSurfaceId,
        looseSurfaceId: "",
        authoritativeSurfaceId: stickySurfaceId,
        authoritativeSource: state.authority || "grounded",
        stateSurfaceId: state.currentSurfaceId || "",
        resolvedSurfaceId: resolved,
        y,
      };
      return resolved;
    }

    const strict = findBestElevatedSurfaceAt(cat.pos.x, cat.pos.z, y, 0.08, 0.34, hintedSurfaceId || stickySurfaceId);
    if (strict) {
      const resolved = setAuthoritativeCatSurfaceId(String(strict.id || strict.name || hintedSurfaceId || "floor"), "strict-match", 0.8);
      cat.nav.surfaceResolveDebug = {
        strictSurfaceId: resolved,
        hintedSurfaceId,
        looseSurfaceId: "",
        authoritativeSurfaceId: routeAuthoritySurfaceId || jumpAuthoritySurfaceId || stickySurfaceId,
        authoritativeSource: state.authority || "strict-match",
        stateSurfaceId: state.currentSurfaceId || "",
        resolvedSurfaceId: resolved,
        y,
      };
      return resolved;
    }

    for (const fallbackId of [
      stickySurfaceId,
      hintedSurfaceId,
      routeApproachSurfaceId,
      routeSurfaceId,
      routeFinalSurfaceId,
      cat.debugMoveSurfaceId,
      cat.nav?.lastSurfaceHopTo,
      cat.nav?.lastSurfaceHopFrom,
    ]) {
      const surface = getElevatedSurfaceById(fallbackId);
      if (surface && isNearElevatedSurface(cat.pos.x, cat.pos.z, y, surface)) {
        const resolved = setAuthoritativeCatSurfaceId(String(surface.id || surface.name || fallbackId || "floor"), "near-match", 0.8);
        cat.nav.surfaceResolveDebug = {
          strictSurfaceId: "",
          hintedSurfaceId,
          looseSurfaceId: resolved,
          authoritativeSurfaceId: routeAuthoritySurfaceId || jumpAuthoritySurfaceId || stickySurfaceId,
          authoritativeSource: state.authority || "near-match",
          stateSurfaceId: state.currentSurfaceId || "",
          resolvedSurfaceId: resolved,
          y,
        };
        return resolved;
      }
    }

    const loose = findLooseElevatedSurfaceAt(cat.pos.x, cat.pos.z, y, hintedSurfaceId || stickySurfaceId);
    if (loose) {
      const resolved = setAuthoritativeCatSurfaceId(String(loose.id || loose.name || hintedSurfaceId || "floor"), "loose-match", 0.7);
      cat.nav.surfaceResolveDebug = {
        strictSurfaceId: "",
        hintedSurfaceId,
        looseSurfaceId: resolved,
        authoritativeSurfaceId: routeAuthoritySurfaceId || jumpAuthoritySurfaceId || stickySurfaceId,
        authoritativeSource: state.authority || "loose-match",
        stateSurfaceId: state.currentSurfaceId || "",
        resolvedSurfaceId: resolved,
        y,
      };
      return resolved;
    }

    const resolved = setAuthoritativeCatSurfaceId(y <= 0.12 ? "floor" : (hintedSurfaceId || routeFinalSurfaceId || state.lastStableSurfaceId || "floor"), "fallback", 0.45);
    cat.nav.surfaceResolveDebug = {
      strictSurfaceId: "",
      hintedSurfaceId,
      looseSurfaceId: "",
      authoritativeSurfaceId: routeAuthoritySurfaceId || jumpAuthoritySurfaceId || stickySurfaceId,
      authoritativeSource: state.authority || "fallback",
      stateSurfaceId: state.currentSurfaceId || "",
      resolvedSurfaceId: resolved,
      y,
    };
    return resolved;
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
    // Elevated-to-elevated travel often *needs* to revisit the previous helper
    // surface (for example hoverShelf -> desk -> shelf -> windowSill). Avoidance
    // heuristics were hiding those valid corridors, so only keep them for routes
    // that actually involve the floor.
    if (sourceId !== "floor" && finalId !== "floor") return [];

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

  function clearCatnipApproachLock() {
    cat.nav.catnipApproachKey = "";
    cat.nav.catnipApproachX = NaN;
    cat.nav.catnipApproachZ = NaN;
  }

  function getCatnipApproachKey() {
    if (!game.catnip) return "";
    const surface = String(game.catnip.surface || "floor");
    const x = Number(game.catnip.pos?.x || 0);
    const y = Number(game.catnip.pos?.y || 0);
    const z = Number(game.catnip.pos?.z || 0);
    return `${surface}|${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
  }

  function getCatnipApproachTarget() {
    if (!game.catnip) {
      clearCatnipApproachLock();
      return null;
    }

    const approachKey = getCatnipApproachKey();
    const hasLockedPoint =
      cat.nav.catnipApproachKey === approachKey &&
      Number.isFinite(cat.nav.catnipApproachX) &&
      Number.isFinite(cat.nav.catnipApproachZ);
    if (hasLockedPoint) {
      catnipApproachTarget.set(cat.nav.catnipApproachX, 0, cat.nav.catnipApproachZ);
      return catnipApproachTarget;
    }

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
        const minX = surface.minX + edgePad;
        const maxX = surface.maxX - edgePad;
        const minZ = surface.minZ + edgePad;
        const maxZ = surface.maxZ - edgePad;
        if (minX + CATNIP_LOCK_POS_EPS < maxX) tx = THREE.MathUtils.clamp(tx, minX, maxX);
        if (minZ + CATNIP_LOCK_POS_EPS < maxZ) tz = THREE.MathUtils.clamp(tz, minZ, maxZ);
      }
    }

    cat.nav.catnipApproachKey = approachKey;
    cat.nav.catnipApproachX = tx;
    cat.nav.catnipApproachZ = tz;
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
    setAuthoritativeCatSurfaceId,
    recordSurfaceHop,
    setJumpDownDebug,
    getAvoidSurfaceIdsForHop,
    isCatOnDeskNow,
    clearCatnipApproachLock,
    getCatnipApproachTarget,
    faceCatnip,
    faceWindowOutside,
  };
}
