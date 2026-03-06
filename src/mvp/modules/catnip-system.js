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
    cup,
    desk,
    pickups,
    pickupRadius,
    buildCatObstacles,
    isCatPointBlocked,
    canReachGroundTarget,
    findSafeGroundPoint,
    bestDeskJumpAnchor,
    getClockTime,
  } = ctx;
  const deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -desk.topY);
  const tempFloorHit = new THREE.Vector3();
  const tempDeskHit = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();
  const CATNIP_SCALE = 0.5;
  const CATNIP_RADIUS = 0.22 * CATNIP_SCALE;
  const CATNIP_HEIGHT = 0.04 * CATNIP_SCALE;
  const CATNIP_HALF_HEIGHT = CATNIP_HEIGHT * 0.5;

  function setMouseFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function isInsideDeskTop(x, z, edgePad = 0.18) {
    return (
      x >= desk.pos.x - desk.sizeX * 0.5 + edgePad &&
      x <= desk.pos.x + desk.sizeX * 0.5 - edgePad &&
      z >= desk.pos.z - desk.sizeZ * 0.5 + edgePad &&
      z <= desk.pos.z + desk.sizeZ * 0.5 - edgePad
    );
  }

  function catCanReachDeskFromFloor(from, dynamicObstacles) {
    const anchor = bestDeskJumpAnchor(from);
    if (!anchor) return false;
    if (isCatPointBlocked(anchor.x, anchor.z, dynamicObstacles, CAT_NAV.clearance * 0.9)) return false;
    return canReachGroundTarget(from, anchor, dynamicObstacles);
  }

  function isValidCatnipSpot(x, z, surface) {
    tempTo.set(x, 0, z);
    const dynamicObstacles = buildCatObstacles(true);

    if (surface === "desk") {
      if (!isInsideDeskTop(x, z)) return false;
      if (!cup.broken && !cup.falling) {
        const dxCup = x - cup.group.position.x;
        const dzCup = z - cup.group.position.z;
        if (dxCup * dxCup + dzCup * dzCup < 0.42 * 0.42) return false;
      }
      for (const p of pickups) {
        if (p.mesh.position.y < desk.topY - 0.12) continue;
        const dx = x - p.mesh.position.x;
        const dz = z - p.mesh.position.z;
        const rr = pickupRadius(p) + 0.2;
        if (dx * dx + dz * dz < rr * rr) return false;
      }
      if (cat.onTable) return true;
      tempFrom.copy(cat.pos);
      return catCanReachDeskFromFloor(tempFrom, dynamicObstacles);
    }

    const staticObstacles = buildCatObstacles(false);
    if (isCatPointBlocked(tempTo.x, tempTo.z, staticObstacles, CAT_NAV.clearance * 0.9)) return false;
    for (const p of pickups) {
      if (p.mesh.position.y > 0.34) continue;
      const dx = x - p.mesh.position.x;
      const dz = z - p.mesh.position.z;
      const rr = pickupRadius(p) + 0.28;
      if (dx * dx + dz * dz < rr * rr) return false;
    }

    const start = cat.onTable
      ? bestDeskJumpAnchor(cat.pos) || findSafeGroundPoint(desk.approach)
      : cat.pos;
    return canReachGroundTarget(start, tempTo, dynamicObstacles);
  }

  function getPlacementFromMouse() {
    raycaster.setFromCamera(mouse, camera);

    let floorHit = null;
    let deskHit = null;
    if (raycaster.ray.intersectPlane(floorPlane, tempFloorHit)) floorHit = tempFloorHit.clone();
    if (raycaster.ray.intersectPlane(deskPlane, tempDeskHit)) deskHit = tempDeskHit.clone();

    if (!floorHit && !deskHit) return null;
    if (deskHit && isInsideDeskTop(deskHit.x, deskHit.z, 0.05)) {
      return {
        surface: "desk",
        x: THREE.MathUtils.clamp(deskHit.x, desk.pos.x - desk.sizeX * 0.5 + 0.16, desk.pos.x + desk.sizeX * 0.5 - 0.16),
        z: THREE.MathUtils.clamp(deskHit.z, desk.pos.z - desk.sizeZ * 0.5 + 0.16, desk.pos.z + desk.sizeZ * 0.5 - 0.16),
        y: desk.topY + CATNIP_HALF_HEIGHT,
      };
    }

    if (!floorHit) return null;
    return {
      surface: "floor",
      x: THREE.MathUtils.clamp(floorHit.x, ROOM.minX + 0.6, ROOM.maxX - 0.6),
      z: THREE.MathUtils.clamp(floorHit.z, ROOM.minZ + 0.6, ROOM.maxZ - 0.6),
      y: CATNIP_HALF_HEIGHT,
    };
  }

  function placeCatnipFromMouse() {
    const clockTime = getClockTime();
    if (clockTime < game.catnipCooldownUntil) return;
    const placement = getPlacementFromMouse();
    if (!placement) return;

    if (!isValidCatnipSpot(placement.x, placement.z, placement.surface)) {
      game.invalidCatnipUntil = clockTime + 1.1;
      return;
    }

    if (game.catnip) scene.remove(game.catnip.mesh);
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(CATNIP_RADIUS, CATNIP_RADIUS, CATNIP_HEIGHT, 18),
      new THREE.MeshStandardMaterial({ color: 0x71bf62, roughness: 0.8 })
    );
    marker.position.set(placement.x, placement.y, placement.z);
    scene.add(marker);

    game.catnip = {
      mesh: marker,
      pos: new THREE.Vector3(placement.x, placement.surface === "desk" ? desk.topY + 0.02 : 0, placement.z),
      surface: placement.surface,
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
