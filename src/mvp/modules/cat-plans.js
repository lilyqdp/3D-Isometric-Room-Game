export function computeCupSwipePlan(THREE, desk, cupPosition, outPoint = null, outEdgeDir = null) {
  const point = outPoint || new THREE.Vector3();
  const edgeDir = outEdgeDir || new THREE.Vector3();

  const edgePadX = 0.34;
  const edgePadZ = 0.3;
  const minX = desk.pos.x - desk.sizeX * 0.5 + edgePadX;
  const maxX = desk.pos.x + desk.sizeX * 0.5 - edgePadX;
  const minZ = desk.pos.z - desk.sizeZ * 0.5 + edgePadZ;
  const maxZ = desk.pos.z + desk.sizeZ * 0.5 - edgePadZ;

  const dPosX = Math.abs(maxX - cupPosition.x);
  const dNegX = Math.abs(cupPosition.x - minX);
  const dPosZ = Math.abs(maxZ - cupPosition.z);
  const dNegZ = Math.abs(cupPosition.z - minZ);
  const nearest = Math.min(dPosX, dNegX, dPosZ, dNegZ);

  if (nearest === dPosX) edgeDir.set(1, 0, 0);
  else if (nearest === dNegX) edgeDir.set(-1, 0, 0);
  else if (nearest === dPosZ) edgeDir.set(0, 0, 1);
  else edgeDir.set(0, 0, -1);

  const standDist = 0.34;
  point.set(
    cupPosition.x - edgeDir.x * standDist,
    0,
    cupPosition.z - edgeDir.z * standDist
  );
  point.x = THREE.MathUtils.clamp(point.x, minX, maxX);
  point.z = THREE.MathUtils.clamp(point.z, minZ, maxZ);

  const faceYaw = Math.atan2(cupPosition.x - point.x, cupPosition.z - point.z);
  return { point, edgeDir, faceYaw };
}
