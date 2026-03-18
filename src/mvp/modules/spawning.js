import * as THREE from "three";

function isPointVisibleOnScreen(camera, x, z, y = 0.1, margin = 0.95) {
  const p = new THREE.Vector3(x, y, z).project(camera);
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z) &&
    p.z > -1 &&
    p.z < 1 &&
    Math.abs(p.x) <= margin &&
    Math.abs(p.y) <= margin
  );
}

function surfaceSupportsCapability(surface, capability) {
  if (!surface || !capability) return false;
  const flags = surface.flags || {};
  const aliasMap = {
    allowCatSpawn: ["allowCatSpawn", "startSurface"],
    allowTrashSpawn: ["allowTrashSpawn", "spawnTrash"],
    allowLaundrySpawn: ["allowLaundrySpawn", "spawnLaundry"],
    allowCatnip: ["allowCatnip"],
  };
  const keys = aliasMap[capability] || [capability];
  return keys.some((key) => {
    if (flags[key] != null) return !!flags[key];
    return !!surface[key];
  });
}

function surfaceArea(surface) {
  return Math.max(0.01, (surface.maxX - surface.minX) * (surface.maxZ - surface.minZ));
}

function buildCandidateSurfaceList({ getSurfaceDefs, getSurfaceIdsByCapability, capability }) {
  const defs = typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: true }) : [];
  if (!defs.length) return [];
  const allowedIds = typeof getSurfaceIdsByCapability === "function"
    ? new Set(getSurfaceIdsByCapability(capability).map((id) => String(id)))
    : null;
  const filtered = defs.filter((surface) => {
    if (allowedIds && allowedIds.size) return allowedIds.has(String(surface.id));
    return surfaceSupportsCapability(surface, capability);
  });
  return filtered.length ? filtered : defs.filter((surface) => surfaceSupportsCapability(surface, capability));
}

function pickWeightedSurface(surfaces) {
  if (!Array.isArray(surfaces) || !surfaces.length) return null;
  let total = 0;
  for (const surface of surfaces) total += surfaceArea(surface);
  if (!(total > 0)) return surfaces[0] || null;
  let pick = Math.random() * total;
  for (const surface of surfaces) {
    pick -= surfaceArea(surface);
    if (pick <= 0) return surface;
  }
  return surfaces[surfaces.length - 1] || null;
}

function samplePointOnSurface(surface, inset = 0.2) {
  const usableInsetX = Math.min(inset, Math.max(0.04, (surface.maxX - surface.minX) * 0.24));
  const usableInsetZ = Math.min(inset, Math.max(0.04, (surface.maxZ - surface.minZ) * 0.24));
  const minX = surface.minX + usableInsetX;
  const maxX = surface.maxX - usableInsetX;
  const minZ = surface.minZ + usableInsetZ;
  const maxZ = surface.maxZ - usableInsetZ;
  const x = THREE.MathUtils.lerp(minX <= maxX ? minX : surface.minX, minX <= maxX ? maxX : surface.maxX, Math.random());
  const z = THREE.MathUtils.lerp(minZ <= maxZ ? minZ : surface.minZ, minZ <= maxZ ? maxZ : surface.maxZ, Math.random());
  return { x, z };
}

function buildFallbackPoints(surface) {
  const cx = (surface.minX + surface.maxX) * 0.5;
  const cz = (surface.minZ + surface.maxZ) * 0.5;
  const insetX = Math.min(0.2, Math.max(0.04, (surface.maxX - surface.minX) * 0.18));
  const insetZ = Math.min(0.2, Math.max(0.04, (surface.maxZ - surface.minZ) * 0.18));
  return [
    { x: cx, z: cz },
    { x: surface.minX + insetX, z: surface.minZ + insetZ },
    { x: surface.maxX - insetX, z: surface.minZ + insetZ },
    { x: surface.minX + insetX, z: surface.maxZ - insetZ },
    { x: surface.maxX - insetX, z: surface.maxZ - insetZ },
  ];
}

function canReachSpawnSurfaceTarget({
  targetSurface,
  x,
  z,
  catSpawn,
  staticObstacles,
  canReachGroundTarget,
  bestSurfaceJumpAnchor,
  computeSurfaceJumpTargets,
  findSafeGroundPoint,
  tempTarget,
  tempStart,
}) {
  if (targetSurface.floorLike) {
    tempTarget.set(x, 0, z);
    return canReachGroundTarget(catSpawn, tempTarget, staticObstacles);
  }
  if (typeof bestSurfaceJumpAnchor !== "function" || typeof computeSurfaceJumpTargets !== "function") return false;
  tempStart.copy(
    typeof findSafeGroundPoint === "function"
      ? findSafeGroundPoint(new THREE.Vector3(catSpawn.x, 0, catSpawn.z))
      : new THREE.Vector3(catSpawn.x, 0, catSpawn.z)
  );
  tempStart.y = 0;
  tempTarget.set(x, targetSurface.y, z);
  const anchor = bestSurfaceJumpAnchor(targetSurface.id, tempStart, tempTarget, "floor");
  if (!anchor) return false;
  if (!canReachGroundTarget(tempStart, anchor, staticObstacles)) return false;
  const jumpTargets = computeSurfaceJumpTargets(targetSurface.id, anchor, tempTarget, "floor");
  return !!jumpTargets?.top;
}

function isPickupSpawnValid({
  type,
  surface,
  x,
  z,
  staticObstacles,
  placed,
  catSpawn,
  camera,
  CAT_COLLISION,
  isCatPointBlocked,
  canReachGroundTarget,
  bestSurfaceJumpAnchor,
  computeSurfaceJumpTargets,
  findSafeGroundPoint,
  tempTarget,
  tempStart,
}) {
  const radius = type === "laundry" ? 0.2 : 0.16;
  const queryY = surface.floorLike ? 0 : surface.y;
  const visualY = Math.max(0.09, queryY + 0.08);
  if (!isPointVisibleOnScreen(camera, x, z, visualY)) return false;
  if (isCatPointBlocked(x, z, staticObstacles, radius + 0.05, queryY)) return false;

  if (surface.floorLike) {
    const minCatDist = radius + CAT_COLLISION.catBodyRadius + 0.15;
    if ((x - catSpawn.x) * (x - catSpawn.x) + (z - catSpawn.z) * (z - catSpawn.z) < minCatDist * minCatDist) {
      return false;
    }
  }

  for (const p of placed) {
    const sameSurface = String(p.surfaceId || "floor") === String(surface.id);
    const similarHeight = Math.abs((Number(p.y) || 0) - queryY) <= 0.26;
    if (!sameSurface && !similarHeight) continue;
    const minDist = radius + p.radius + 0.13;
    if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < minDist * minDist) return false;
  }

  return canReachSpawnSurfaceTarget({
    targetSurface: surface,
    x,
    z,
    catSpawn,
    staticObstacles,
    canReachGroundTarget,
    bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets,
    findSafeGroundPoint,
    tempTarget,
    tempStart,
  });
}

function findPickupSpawnCandidate({
  type,
  staticObstacles,
  placed,
  catSpawn,
  camera,
  CAT_COLLISION,
  isCatPointBlocked,
  canReachGroundTarget,
  bestSurfaceJumpAnchor,
  computeSurfaceJumpTargets,
  findSafeGroundPoint,
  getSurfaceDefs,
  getSurfaceIdsByCapability,
  tempTarget,
  tempStart,
}) {
  const capability = type === "laundry" ? "allowLaundrySpawn" : "allowTrashSpawn";
  const spawnSurfaces = buildCandidateSurfaceList({ getSurfaceDefs, getSurfaceIdsByCapability, capability });
  if (!spawnSurfaces.length) return null;

  let placedItem = null;
  for (let i = 0; i < 420 && !placedItem; i++) {
    const surface = pickWeightedSurface(spawnSurfaces);
    if (!surface) break;
    const { x, z } = samplePointOnSurface(surface, 0.2);
    if (!isPickupSpawnValid({
      type,
      surface,
      x,
      z,
      staticObstacles,
      placed,
      catSpawn,
      camera,
      CAT_COLLISION,
      isCatPointBlocked,
      canReachGroundTarget,
      bestSurfaceJumpAnchor,
      computeSurfaceJumpTargets,
      findSafeGroundPoint,
      tempTarget,
      tempStart,
    })) continue;
    placedItem = { type, x, z, y: surface.floorLike ? 0.08 : surface.y + 0.08, surfaceId: surface.id, radius: type === "laundry" ? 0.2 : 0.16 };
  }

  if (!placedItem) {
    for (const surface of spawnSurfaces) {
      for (const point of buildFallbackPoints(surface)) {
        if (!isPickupSpawnValid({
          type,
          surface,
          x: point.x,
          z: point.z,
          staticObstacles,
          placed,
          catSpawn,
          camera,
          CAT_COLLISION,
          isCatPointBlocked,
          canReachGroundTarget,
          bestSurfaceJumpAnchor,
          computeSurfaceJumpTargets,
          findSafeGroundPoint,
          tempTarget,
          tempStart,
        })) {
          continue;
        }
        placedItem = { type, x: point.x, z: point.z, y: surface.floorLike ? 0.08 : surface.y + 0.08, surfaceId: surface.id, radius: type === "laundry" ? 0.2 : 0.16 };
        break;
      }
      if (placedItem) break;
    }
  }

  return placedItem;
}

export function pickRandomCatSpawnPoint({
  camera,
  ROOM,
  CAT_NAV,
  desk,
  buildCatObstacles,
  getCatPathClearance,
  isCatPointBlocked,
  canReachGroundTarget,
}) {
  const staticObstacles = buildCatObstacles(false);
  const clearance = getCatPathClearance();
  const minX = ROOM.minX + CAT_NAV.margin + 0.2;
  const maxX = ROOM.maxX - CAT_NAV.margin - 0.2;
  const minZ = ROOM.minZ + CAT_NAV.margin + 0.2;
  const maxZ = ROOM.maxZ - CAT_NAV.margin - 0.2;
  const candidate = new THREE.Vector3();

  for (let i = 0; i < 320; i++) {
    const x = THREE.MathUtils.lerp(minX, maxX, Math.random());
    const z = THREE.MathUtils.lerp(minZ, maxZ, Math.random());
    if (!isPointVisibleOnScreen(camera, x, z, 0.09)) continue;
    if (isCatPointBlocked(x, z, staticObstacles, clearance)) continue;
    candidate.set(x, 0, z);
    if (!canReachGroundTarget(candidate, desk.approach, staticObstacles)) continue;
    return candidate.clone();
  }

  return new THREE.Vector3(1.5, 0, 1.7);
}

export function addRandomPickups({
  catSpawn,
  camera,
  CAT_COLLISION,
  SPAWN_COUNTS,
  buildCatObstacles,
  isCatPointBlocked,
  canReachGroundTarget,
  bestSurfaceJumpAnchor,
  computeSurfaceJumpTargets,
  findSafeGroundPoint,
  getSurfaceDefs,
  getSurfaceIdsByCapability,
  addPickup,
}) {
  const staticObstacles = buildCatObstacles(false);
  const placed = [];
  const spawnOrder = [
    ...Array.from({ length: SPAWN_COUNTS.laundry }, () => "laundry"),
    ...Array.from({ length: SPAWN_COUNTS.trash }, () => "trash"),
  ];
  const tempTarget = new THREE.Vector3();
  const tempStart = new THREE.Vector3();

  for (const type of spawnOrder) {
    const placedItem = findPickupSpawnCandidate({
      type,
      staticObstacles,
      placed,
      catSpawn,
      camera,
      CAT_COLLISION,
      isCatPointBlocked,
      canReachGroundTarget,
      bestSurfaceJumpAnchor,
      computeSurfaceJumpTargets,
      findSafeGroundPoint,
      getSurfaceDefs,
      getSurfaceIdsByCapability,
      tempTarget,
      tempStart,
    });
    if (placedItem) placed.push(placedItem);
  }

  for (const p of placed) addPickup(p.type, p.x, p.z, { y: p.y, surfaceId: p.surfaceId });
}

export function spawnRandomPickup({
  type,
  catSpawn,
  camera,
  CAT_COLLISION,
  pickups,
  pickupRadius,
  buildCatObstacles,
  isCatPointBlocked,
  canReachGroundTarget,
  bestSurfaceJumpAnchor,
  computeSurfaceJumpTargets,
  findSafeGroundPoint,
  getSurfaceDefs,
  getSurfaceIdsByCapability,
  addPickup,
}) {
  const staticObstacles = buildCatObstacles(false);
  const placed = pickups.map((p) => ({
    x: p.mesh.position.x,
    z: p.mesh.position.z,
    y: p.mesh.position.y,
    surfaceId: p.spawnSurfaceId || "floor",
    radius: pickupRadius(p),
  }));
  const tempTarget = new THREE.Vector3();
  const tempStart = new THREE.Vector3();

  const spawn = findPickupSpawnCandidate({
    type,
    staticObstacles,
    placed,
    catSpawn,
    camera,
    CAT_COLLISION,
    isCatPointBlocked,
    canReachGroundTarget,
    bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets,
    findSafeGroundPoint,
    getSurfaceDefs,
    getSurfaceIdsByCapability,
    tempTarget,
    tempStart,
  });

  if (!spawn) return false;
  addPickup(type, spawn.x, spawn.z, { y: spawn.y, surfaceId: spawn.surfaceId });
  return true;
}
