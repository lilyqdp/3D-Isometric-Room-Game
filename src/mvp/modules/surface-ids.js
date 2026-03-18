export const FLOOR_SURFACE_ID = "floor";
export const FLOOR_SURFACE_Y_EPSILON = 0.08;

export function normalizeSurfaceId(surfaceId, fallback = FLOOR_SURFACE_ID) {
  const resolved = String(surfaceId ?? "").trim();
  return resolved || String(fallback || FLOOR_SURFACE_ID);
}

export function isFloorSurfaceId(surfaceId) {
  return normalizeSurfaceId(surfaceId) === FLOOR_SURFACE_ID;
}

export function isNonFloorSurfaceId(surfaceId) {
  return !isFloorSurfaceId(surfaceId);
}

export function targetSurfaceId(target, fallback = FLOOR_SURFACE_ID) {
  if (target && typeof target === "object") {
    if (target.surfaceId != null) return normalizeSurfaceId(target.surfaceId, fallback);
    if (target.surface != null) return normalizeSurfaceId(target.surface, fallback);
  }
  return normalizeSurfaceId(fallback);
}

export function ensureCatSurfaceState(cat) {
  if (!cat?.nav || typeof cat.nav !== "object") return null;
  if (!cat.nav.surfaceState || typeof cat.nav.surfaceState !== "object") {
    cat.nav.surfaceState = {};
  }
  const state = cat.nav.surfaceState;
  state.currentSurfaceId = normalizeSurfaceId(state.currentSurfaceId);
  state.authority = state.authority ? String(state.authority) : "runtime";
  state.authoritativeUntil = Number.isFinite(state.authoritativeUntil) ? state.authoritativeUntil : 0;
  state.updatedAt = Number.isFinite(state.updatedAt) ? state.updatedAt : 0;
  state.lastStableSurfaceId = normalizeSurfaceId(state.lastStableSurfaceId || state.currentSurfaceId);
  return state;
}

export function getCatSurfaceId(cat, fallback = FLOOR_SURFACE_ID) {
  return normalizeSurfaceId(ensureCatSurfaceState(cat)?.currentSurfaceId, fallback);
}

export function setCatSurfaceId(cat, surfaceId, authority = "runtime", now = 0, stickySeconds = 0) {
  const state = ensureCatSurfaceState(cat);
  if (!state) return normalizeSurfaceId(surfaceId);
  const resolvedSurfaceId = normalizeSurfaceId(surfaceId);
  state.currentSurfaceId = resolvedSurfaceId;
  state.authority = authority ? String(authority) : "runtime";
  state.updatedAt = Number.isFinite(now) ? now : 0;
  state.authoritativeUntil = (Number.isFinite(now) ? now : 0) + Math.max(0, Number(stickySeconds) || 0);
  state.lastStableSurfaceId = resolvedSurfaceId;
  return resolvedSurfaceId;
}

export function catHasFloorContact(cat, y = null, epsilon = FLOOR_SURFACE_Y_EPSILON) {
  const resolvedY = Number.isFinite(y) ? Number(y) : Number(cat?.group?.position?.y) || 0;
  return isFloorSurfaceId(getCatSurfaceId(cat)) && resolvedY <= epsilon;
}

export function catHasNonFloorSurface(cat, y = null, epsilon = FLOOR_SURFACE_Y_EPSILON) {
  const resolvedY = Number.isFinite(y) ? Number(y) : Number(cat?.group?.position?.y) || 0;
  return isNonFloorSurfaceId(getCatSurfaceId(cat)) || resolvedY > epsilon;
}
