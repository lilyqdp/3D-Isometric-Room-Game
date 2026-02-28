export function createCatnipRuntime(ctx) {
  const {
    THREE,
    scene,
    camera,
    renderer,
    raycaster,
    mouse,
    floorPlane,
    tempV3,
    tempTo,
    ROOM,
    CAT_NAV,
    game,
    cat,
    desk,
    pickups,
    pickupRadius,
    buildCatObstacles,
    isCatPointBlocked,
    canReachGroundTarget,
    findSafeGroundPoint,
    getClockTime,
  } = ctx;

  function setMouseFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function isValidCatnipSpot(x, z) {
    tempTo.set(x, 0, z);
    const staticObstacles = buildCatObstacles(false);
    if (isCatPointBlocked(tempTo.x, tempTo.z, staticObstacles, CAT_NAV.clearance * 0.9)) return false;

    for (const p of pickups) {
      if (p.mesh.position.y > 0.34) continue;
      const dx = x - p.mesh.position.x;
      const dz = z - p.mesh.position.z;
      const rr = pickupRadius(p) + 0.28;
      if (dx * dx + dz * dz < rr * rr) return false;
    }

    const start = cat.onTable ? findSafeGroundPoint(desk.approach) : cat.pos;
    const dynamicObstacles = buildCatObstacles(true);
    return canReachGroundTarget(start, tempTo, dynamicObstacles);
  }

  function placeCatnipFromMouse() {
    const clockTime = getClockTime();
    if (clockTime < game.catnipCooldownUntil) return;
    raycaster.setFromCamera(mouse, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, tempV3)) return;

    const x = THREE.MathUtils.clamp(tempV3.x, ROOM.minX + 0.6, ROOM.maxX - 0.6);
    const z = THREE.MathUtils.clamp(tempV3.z, ROOM.minZ + 0.6, ROOM.maxZ - 0.6);
    if (!isValidCatnipSpot(x, z)) {
      game.invalidCatnipUntil = clockTime + 1.1;
      return;
    }

    if (game.catnip) scene.remove(game.catnip.mesh);
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.04, 18),
      new THREE.MeshStandardMaterial({ color: 0x71bf62, roughness: 0.8 })
    );
    marker.position.set(x, 0.02, z);
    scene.add(marker);

    game.catnip = {
      mesh: marker,
      pos: new THREE.Vector3(x, 0, z),
      expiresAt: clockTime + 7,
    };
    game.catnipCooldownUntil = game.catnip.expiresAt;
    game.placeCatnipMode = false;
    game.invalidCatnipUntil = 0;
  }

  function clearCatnip() {
    if (!game.catnip) return;
    scene.remove(game.catnip.mesh);
    game.catnip = null;
  }

  return {
    setMouseFromEvent,
    placeCatnipFromMouse,
    clearCatnip,
  };
}
