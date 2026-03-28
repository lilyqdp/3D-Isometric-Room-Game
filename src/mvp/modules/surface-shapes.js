const TAU = Math.PI * 2;

export function roundSurfaceNumber(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return numeric;
  const scale = 10 ** Math.max(0, digits | 0);
  return Math.round(numeric * scale) / scale;
}

export function normalizeRotationDegrees(value, fallback = 0) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  const normalized = ((numeric % 360) + 360) % 360;
  return roundSurfaceNumber(normalized);
}

export function degreesToRadians(value) {
  return (Number(value) || 0) * (Math.PI / 180);
}

export function radiansToDegrees(value) {
  return (Number(value) || 0) * (180 / Math.PI);
}

export function getObjectRotationDegrees(object) {
  if (Number.isFinite(Number(object?.rotYDeg))) {
    return normalizeRotationDegrees(Number(object.rotYDeg));
  }
  const turns = Math.round(Number(object?.rotQuarterTurns) || 0);
  const normalized = ((turns % 4) + 4) % 4;
  return normalized * 90;
}

export function getObjectRotationRadians(object) {
  return degreesToRadians(getObjectRotationDegrees(object));
}

export function getQuarterTurnsFromDegrees(value) {
  return ((Math.round(normalizeRotationDegrees(value) / 90) % 4) + 4) % 4;
}

export function rotateOffsetXZ(dx, dz, yawRadians = 0) {
  const c = Math.cos(Number(yawRadians) || 0);
  const s = Math.sin(Number(yawRadians) || 0);
  return {
    dx: dx * c + dz * s,
    dz: -dx * s + dz * c,
  };
}

export function rotatePointAroundCenterXZ(point, center, yawRadians = 0) {
  if (!point || !center || typeof point.set !== "function") return point;
  const rotated = rotateOffsetXZ(point.x - center.x, point.z - center.z, yawRadians);
  point.set(center.x + rotated.dx, point.y, center.z + rotated.dz);
  return point;
}

export function getRotatedRectAabb(width, depth, yawRadians = 0) {
  const w = Math.max(0, Number(width) || 0);
  const d = Math.max(0, Number(depth) || 0);
  const c = Math.abs(Math.cos(Number(yawRadians) || 0));
  const s = Math.abs(Math.sin(Number(yawRadians) || 0));
  return {
    width: w * c + d * s,
    depth: w * s + d * c,
  };
}

export function getSurfaceKind(surface) {
  const raw = String(surface?.shape || surface?.kind || surface?.shapeType || "").toLowerCase();
  if (raw === "circle" || raw === "disc" || raw === "disk") return "circle";
  if (raw === "obb" || raw === "orientedRect" || raw === "oriented-rect") return "obb";
  return "rect";
}

export function getSurfaceYaw(surface) {
  if (Number.isFinite(Number(surface?.yaw))) return Number(surface.yaw);
  if (Number.isFinite(Number(surface?.yawDeg))) return degreesToRadians(surface.yawDeg);
  return 0;
}

export function getSurfaceCenter(surface) {
  if (Number.isFinite(Number(surface?.centerX)) && Number.isFinite(Number(surface?.centerZ))) {
    return { x: Number(surface.centerX), z: Number(surface.centerZ) };
  }
  if (Number.isFinite(Number(surface?.cx)) && Number.isFinite(Number(surface?.cz))) {
    return { x: Number(surface.cx), z: Number(surface.cz) };
  }
  if (Number.isFinite(Number(surface?.x)) && Number.isFinite(Number(surface?.z))) {
    return { x: Number(surface.x), z: Number(surface.z) };
  }
  const minX = Number(surface?.minX);
  const maxX = Number(surface?.maxX);
  const minZ = Number(surface?.minZ);
  const maxZ = Number(surface?.maxZ);
  return {
    x: (minX + maxX) * 0.5,
    z: (minZ + maxZ) * 0.5,
  };
}

export function getSurfaceHalfExtents(surface) {
  if (Number.isFinite(Number(surface?.halfWidth)) && Number.isFinite(Number(surface?.halfDepth))) {
    return { hx: Math.max(0, Number(surface.halfWidth)), hz: Math.max(0, Number(surface.halfDepth)) };
  }
  if (Number.isFinite(Number(surface?.hx)) && Number.isFinite(Number(surface?.hz))) {
    return { hx: Math.max(0, Number(surface.hx)), hz: Math.max(0, Number(surface.hz)) };
  }
  if (Number.isFinite(Number(surface?.width)) && Number.isFinite(Number(surface?.depth))) {
    return {
      hx: Math.max(0, Number(surface.width) * 0.5),
      hz: Math.max(0, Number(surface.depth) * 0.5),
    };
  }
  const minX = Number(surface?.minX);
  const maxX = Number(surface?.maxX);
  const minZ = Number(surface?.minZ);
  const maxZ = Number(surface?.maxZ);
  return {
    hx: Math.max(0, (maxX - minX) * 0.5),
    hz: Math.max(0, (maxZ - minZ) * 0.5),
  };
}

export function getSurfaceRadius(surface) {
  if (Number.isFinite(Number(surface?.radius))) return Math.max(0, Number(surface.radius));
  if (Number.isFinite(Number(surface?.outerRadius))) return Math.max(0, Number(surface.outerRadius));
  const { hx, hz } = getSurfaceHalfExtents(surface);
  return Math.max(0, Math.min(hx, hz));
}

export function getSurfaceAabb(surface) {
  const kind = getSurfaceKind(surface);
  const center = getSurfaceCenter(surface);
  if (kind === "circle") {
    const radius = getSurfaceRadius(surface);
    return {
      minX: center.x - radius,
      maxX: center.x + radius,
      minZ: center.z - radius,
      maxZ: center.z + radius,
    };
  }
  if (kind === "obb") {
    const { hx, hz } = getSurfaceHalfExtents(surface);
    const yaw = getSurfaceYaw(surface);
    const size = getRotatedRectAabb(hx * 2, hz * 2, yaw);
    return {
      minX: center.x - size.width * 0.5,
      maxX: center.x + size.width * 0.5,
      minZ: center.z - size.depth * 0.5,
      maxZ: center.z + size.depth * 0.5,
    };
  }
  const minX = Number(surface?.minX);
  const maxX = Number(surface?.maxX);
  const minZ = Number(surface?.minZ);
  const maxZ = Number(surface?.maxZ);
  if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
    return { minX, maxX, minZ, maxZ };
  }
  const { hx, hz } = getSurfaceHalfExtents(surface);
  return {
    minX: center.x - hx,
    maxX: center.x + hx,
    minZ: center.z - hz,
    maxZ: center.z + hz,
  };
}

export function pointToSurfaceLocal(surface, x, z) {
  const center = getSurfaceCenter(surface);
  const yaw = getSurfaceKind(surface) === "obb" ? getSurfaceYaw(surface) : 0;
  return rotateOffsetXZ((Number(x) || 0) - center.x, (Number(z) || 0) - center.z, -yaw);
}

export function isPointInsideSurfaceXZ(surface, x, z, pad = 0) {
  const kind = getSurfaceKind(surface);
  const shrink = Math.max(0, Number(pad) || 0);
  if (kind === "circle") {
    const center = getSurfaceCenter(surface);
    const radius = Math.max(0, getSurfaceRadius(surface) - shrink);
    const dx = (Number(x) || 0) - center.x;
    const dz = (Number(z) || 0) - center.z;
    return dx * dx + dz * dz <= radius * radius;
  }
  const { hx, hz } = getSurfaceHalfExtents(surface);
  const local = pointToSurfaceLocal(surface, x, z);
  return Math.abs(local.dx) <= Math.max(0, hx - shrink) && Math.abs(local.dz) <= Math.max(0, hz - shrink);
}

export function getSurfacePlanarGap(surface, x, z, pad = 0) {
  const kind = getSurfaceKind(surface);
  const shrink = Math.max(0, Number(pad) || 0);
  if (kind === "circle") {
    const center = getSurfaceCenter(surface);
    const radius = Math.max(0, getSurfaceRadius(surface) - shrink);
    const dx = (Number(x) || 0) - center.x;
    const dz = (Number(z) || 0) - center.z;
    return Math.max(0, Math.hypot(dx, dz) - radius);
  }
  const { hx, hz } = getSurfaceHalfExtents(surface);
  const local = pointToSurfaceLocal(surface, x, z);
  const allowedHx = Math.max(0, hx - shrink);
  const allowedHz = Math.max(0, hz - shrink);
  const dx = Math.max(0, Math.abs(local.dx) - allowedHx);
  const dz = Math.max(0, Math.abs(local.dz) - allowedHz);
  return Math.hypot(dx, dz);
}

export function getSurfaceEdgeDistance(surface, x, z, pad = 0) {
  if (!isPointInsideSurfaceXZ(surface, x, z, pad)) {
    return -getSurfacePlanarGap(surface, x, z, pad);
  }
  const kind = getSurfaceKind(surface);
  const shrink = Math.max(0, Number(pad) || 0);
  if (kind === "circle") {
    const center = getSurfaceCenter(surface);
    const radius = Math.max(0, getSurfaceRadius(surface) - shrink);
    return radius - Math.hypot((Number(x) || 0) - center.x, (Number(z) || 0) - center.z);
  }
  const { hx, hz } = getSurfaceHalfExtents(surface);
  const local = pointToSurfaceLocal(surface, x, z);
  return Math.min(Math.max(0, hx - shrink) - Math.abs(local.dx), Math.max(0, hz - shrink) - Math.abs(local.dz));
}

export function clampPointToSurfaceXZ(surface, x, z, pad = 0) {
  const kind = getSurfaceKind(surface);
  const shrink = Math.max(0, Number(pad) || 0);
  if (kind === "circle") {
    const center = getSurfaceCenter(surface);
    const radius = Math.max(0, getSurfaceRadius(surface) - shrink);
    const dx = (Number(x) || 0) - center.x;
    const dz = (Number(z) || 0) - center.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= radius || dist <= 1e-6) {
      return dist <= 1e-6 && radius > 0
        ? { x: center.x + radius, z: center.z }
        : { x: Number(x) || 0, z: Number(z) || 0 };
    }
    const inv = radius / dist;
    return { x: center.x + dx * inv, z: center.z + dz * inv };
  }
  const { hx, hz } = getSurfaceHalfExtents(surface);
  const local = pointToSurfaceLocal(surface, x, z);
  const yaw = getSurfaceKind(surface) === "obb" ? getSurfaceYaw(surface) : 0;
  const center = getSurfaceCenter(surface);
  const clampedLocalX = Math.min(Math.max(local.dx, -Math.max(0, hx - shrink)), Math.max(0, hx - shrink));
  const clampedLocalZ = Math.min(Math.max(local.dz, -Math.max(0, hz - shrink)), Math.max(0, hz - shrink));
  const rotated = rotateOffsetXZ(clampedLocalX, clampedLocalZ, yaw);
  return { x: center.x + rotated.dx, z: center.z + rotated.dz };
}

export function getSurfaceArea(surface) {
  if (getSurfaceKind(surface) === "circle") {
    const radius = getSurfaceRadius(surface);
    return Math.PI * radius * radius;
  }
  const { hx, hz } = getSurfaceHalfExtents(surface);
  return Math.max(0, hx * 2) * Math.max(0, hz * 2);
}

export function samplePointOnSurfaceXZ(surface, pad = 0, random = Math.random) {
  const kind = getSurfaceKind(surface);
  const shrink = Math.max(0, Number(pad) || 0);
  if (kind === "circle") {
    const center = getSurfaceCenter(surface);
    const radius = Math.max(0, getSurfaceRadius(surface) - shrink);
    const angle = random() * TAU;
    const dist = Math.sqrt(random()) * radius;
    return {
      x: center.x + Math.cos(angle) * dist,
      z: center.z + Math.sin(angle) * dist,
    };
  }
  const { hx, hz } = getSurfaceHalfExtents(surface);
  const center = getSurfaceCenter(surface);
  const yaw = kind === "obb" ? getSurfaceYaw(surface) : 0;
  const localX = THREEClampLerp(-Math.max(0, hx - shrink), Math.max(0, hx - shrink), random());
  const localZ = THREEClampLerp(-Math.max(0, hz - shrink), Math.max(0, hz - shrink), random());
  const rotated = rotateOffsetXZ(localX, localZ, yaw);
  return { x: center.x + rotated.dx, z: center.z + rotated.dz };
}

function THREEClampLerp(a, b, t) {
  return a + (b - a) * (Number(t) || 0);
}
