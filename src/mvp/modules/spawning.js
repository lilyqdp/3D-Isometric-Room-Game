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

function isPickupSpawnValid({
  type,
  x,
  z,
  staticObstacles,
  placed,
  catSpawn,
  camera,
  CAT_COLLISION,
  isCatPointBlocked,
  canReachGroundTarget,
  tempTarget,
}) {
  const radius = type === "laundry" ? 0.2 : 0.16;
  if (!isPointVisibleOnScreen(camera, x, z, 0.09)) return false;
  if (isCatPointBlocked(x, z, staticObstacles, radius + 0.05)) return false;

  const minCatDist = radius + CAT_COLLISION.catBodyRadius + 0.15;
  if ((x - catSpawn.x) * (x - catSpawn.x) + (z - catSpawn.z) * (z - catSpawn.z) < minCatDist * minCatDist) {
    return false;
  }

  for (const p of placed) {
    const minDist = radius + p.radius + 0.13;
    if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < minDist * minDist) return false;
  }

  tempTarget.set(x, 0, z);
  return canReachGroundTarget(catSpawn, tempTarget, staticObstacles);
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
  ROOM,
  CAT_NAV,
  CAT_COLLISION,
  SPAWN_COUNTS,
  buildCatObstacles,
  isCatPointBlocked,
  canReachGroundTarget,
  addPickup,
}) {
  const staticObstacles = buildCatObstacles(false);
  const minX = ROOM.minX + CAT_NAV.margin + 0.2;
  const maxX = ROOM.maxX - CAT_NAV.margin - 0.2;
  const minZ = ROOM.minZ + CAT_NAV.margin + 0.2;
  const maxZ = ROOM.maxZ - CAT_NAV.margin - 0.2;
  const placed = [];
  const spawnOrder = [
    ...Array.from({ length: SPAWN_COUNTS.laundry }, () => "laundry"),
    ...Array.from({ length: SPAWN_COUNTS.trash }, () => "trash"),
  ];
  const tempTarget = new THREE.Vector3();

  for (const type of spawnOrder) {
    let placedItem = null;
    for (let i = 0; i < 420; i++) {
      const x = THREE.MathUtils.lerp(minX, maxX, Math.random());
      const z = THREE.MathUtils.lerp(minZ, maxZ, Math.random());
      if (
        !isPickupSpawnValid({
          type,
          x,
          z,
          staticObstacles,
          placed,
          catSpawn,
          camera,
          CAT_COLLISION,
          isCatPointBlocked,
          canReachGroundTarget,
          tempTarget,
        })
      ) {
        continue;
      }
      placedItem = { type, x, z, radius: type === "laundry" ? 0.2 : 0.16 };
      break;
    }
    if (!placedItem) {
      const fallback = [
        [-2.8, 0.6],
        [-1.5, 1.3],
        [-0.2, 0.3],
        [1.0, 0.9],
        [0.5, -0.5],
        [-3.3, -0.3],
      ];
      for (const [fx, fz] of fallback) {
        if (
          !isPickupSpawnValid({
            type,
            x: fx,
            z: fz,
            staticObstacles,
            placed,
            catSpawn,
            camera,
            CAT_COLLISION,
            isCatPointBlocked,
            canReachGroundTarget,
            tempTarget,
          })
        ) {
          continue;
        }
        placedItem = { type, x: fx, z: fz, radius: type === "laundry" ? 0.2 : 0.16 };
        break;
      }
    }
    if (!placedItem) {
      for (let r = 0.7; r <= 5.0 && !placedItem; r += 0.28) {
        const steps = Math.max(12, Math.floor(r * 18));
        for (let i = 0; i < steps; i++) {
          const t = (i / steps) * Math.PI * 2;
          const x = catSpawn.x + Math.cos(t) * r;
          const z = catSpawn.z + Math.sin(t) * r;
          if (
            !isPickupSpawnValid({
              type,
              x,
              z,
              staticObstacles,
              placed,
              catSpawn,
              camera,
              CAT_COLLISION,
              isCatPointBlocked,
              canReachGroundTarget,
              tempTarget,
            })
          ) {
            continue;
          }
          placedItem = { type, x, z, radius: type === "laundry" ? 0.2 : 0.16 };
          break;
        }
      }
    }
    if (placedItem) placed.push(placedItem);
  }

  for (const p of placed) addPickup(p.type, p.x, p.z);
}
