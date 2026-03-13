export function createCatStateMachineDeskRuntime(ctx) {
  const {
    THREE,
    game,
    cat,
    desk,
    cup,
    pickups,
    pickupRadius,
    CAT_COLLISION,
  } = ctx;

  const tableRoamTarget = new THREE.Vector3();

  function isDeskLandingBlockedByObjects(point) {
    if (!point) return true;
    const landingClearance = CAT_COLLISION.catBodyRadius * 1.5;
    const landingClearance2 = landingClearance * landingClearance;

    if (!cup.broken && !cup.falling && cup.group.visible) {
      const dx = point.x - cup.group.position.x;
      const dz = point.z - cup.group.position.z;
      if (dx * dx + dz * dz < landingClearance2) return true;
    }

    const minY = desk.topY - 0.24;
    const maxY = desk.topY + 0.55;
    for (const pickup of pickups) {
      if (!pickup?.mesh || !pickup.mesh.visible) continue;
      const py = pickup.mesh.position.y;
      if (!Number.isFinite(py) || py < minY || py > maxY) continue;
      const dx = point.x - pickup.mesh.position.x;
      const dz = point.z - pickup.mesh.position.z;
      const pickupPad = Math.max(0.02, pickupRadius(pickup) * 0.2);
      const minDist = landingClearance + pickupPad;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }

    return false;
  }

  function getDeskDesiredTarget() {
    if (game.catnip && game.catnip.surface === "desk") return game.catnip.pos;
    if (!cup.broken && !cup.falling) return cup.group.position;
    return desk.perch;
  }

  function pickTableRoamTarget(nearCup = false) {
    const minX = desk.pos.x - desk.sizeX * 0.5 + 0.32;
    const maxX = desk.pos.x + desk.sizeX * 0.5 - 0.32;
    const minZ = desk.pos.z - desk.sizeZ * 0.5 + 0.28;
    const maxZ = desk.pos.z + desk.sizeZ * 0.5 - 0.28;

    if (nearCup && !cup.broken && !cup.falling) {
      const angle = Math.random() * Math.PI * 2;
      const radius = THREE.MathUtils.lerp(0.22, 0.46, Math.random());
      tableRoamTarget.set(
        cup.group.position.x + Math.cos(angle) * radius,
        0,
        cup.group.position.z + Math.sin(angle) * radius
      );
    } else {
      tableRoamTarget.set(
        THREE.MathUtils.lerp(minX, maxX, Math.random()),
        0,
        THREE.MathUtils.lerp(minZ, maxZ, Math.random())
      );
    }

    tableRoamTarget.x = THREE.MathUtils.clamp(tableRoamTarget.x, minX, maxX);
    tableRoamTarget.z = THREE.MathUtils.clamp(tableRoamTarget.z, minZ, maxZ);
    cat.tableRoamTarget.copy(tableRoamTarget);
  }

  return {
    isDeskLandingBlockedByObjects,
    getDeskDesiredTarget,
    pickTableRoamTarget,
  };
}
