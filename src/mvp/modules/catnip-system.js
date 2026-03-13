export function createCatnipRuntime(ctx) {
  const {
    THREE,
    scene,
    camera,
    renderer,
    raycaster,
    mouse,
    floorPlane,
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
    getCatPathClearance,
    canReachGroundTarget,
    findSafeGroundPoint,
    bestDeskJumpAnchor,
    bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets,
    getElevatedSurfaceDefs,
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
  const CATNIP_MOUTH_OFFSET = 0.34;

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

  function getElevatedSurfaceById(surfaceId) {
    if (!surfaceId || surfaceId === "floor") return null;
    if (typeof getElevatedSurfaceDefs !== "function") return null;
    const defs = getElevatedSurfaceDefs(true);
    if (!Array.isArray(defs)) return null;
    return defs.find((s) => String(s?.id || s?.name || "") === String(surfaceId)) || null;
  }

  function findBestElevatedSurfaceAt(x, z, y, pad = 0.18, maxDy = 0.58) {
    if (typeof getElevatedSurfaceDefs !== "function") return null;
    const defs = getElevatedSurfaceDefs(true);
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
      const inside =
        x >= sx0 - pad &&
        x <= sx1 + pad &&
        z >= sz0 - pad &&
        z <= sz1 + pad;
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

  function clampToElevatedSurface(surfaceId, x, z, edgePad = 0.16) {
    const surface = getElevatedSurfaceById(surfaceId);
    if (!surface) return null;
    return {
      x: THREE.MathUtils.clamp(x, surface.minX + edgePad, surface.maxX - edgePad),
      z: THREE.MathUtils.clamp(z, surface.minZ + edgePad, surface.maxZ - edgePad),
      surface,
    };
  }

  function isInsideElevatedSurface(surfaceId, x, z, edgePad = 0.18) {
    const surface = getElevatedSurfaceById(surfaceId);
    if (!surface) return false;
    return (
      x >= surface.minX + edgePad &&
      x <= surface.maxX - edgePad &&
      z >= surface.minZ + edgePad &&
      z <= surface.maxZ - edgePad
    );
  }

  function getCurrentCatSurfaceId() {
    const y = Number.isFinite(cat.group.position.y) ? cat.group.position.y : 0;
    if (!cat.onTable && y <= 0.08) return "floor";
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

  function buildCatnipApproachPoint(x, z, start, surface) {
    let dx = x - start.x;
    let dz = z - start.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      dx = Math.sin(cat.group.rotation.y);
      dz = Math.cos(cat.group.rotation.y);
      len = 1;
    }
    const ux = dx / len;
    const uz = dz / len;
    let tx = x - ux * CATNIP_MOUTH_OFFSET;
    let tz = z - uz * CATNIP_MOUTH_OFFSET;
    if (surface !== "floor") {
      const clamped = clampToElevatedSurface(surface, tx, tz, 0.14);
      if (clamped) {
        tx = clamped.x;
        tz = clamped.z;
      }
    } else {
      tx = THREE.MathUtils.clamp(tx, ROOM.minX + 0.6, ROOM.maxX - 0.6);
      tz = THREE.MathUtils.clamp(tz, ROOM.minZ + 0.6, ROOM.maxZ - 0.6);
    }
    return new THREE.Vector3(tx, 0, tz);
  }

  function isValidCatnipSpot(x, z, surface) {
    tempTo.set(x, 0, z);
    const dynamicObstacles = buildCatObstacles(true, true);
    const staticObstacles = buildCatObstacles(false);
    const clearance = typeof getCatPathClearance === "function" ? getCatPathClearance() : CAT_NAV.clearance;

    if (surface !== "floor") {
      if (!isInsideElevatedSurface(surface, x, z)) return false;
      const surfaceDef = getElevatedSurfaceById(surface);
      if (!surfaceDef) return false;
      const surfaceY = surfaceDef.y;
      if (!cup.broken && !cup.falling) {
        if (Math.abs(cup.group.position.y - surfaceY) <= 0.36) {
          const dxCup = x - cup.group.position.x;
          const dzCup = z - cup.group.position.z;
          if (dxCup * dxCup + dzCup * dzCup < 0.42 * 0.42) return false;
        }
      }
      for (const p of pickups) {
        if (Math.abs(p.mesh.position.y - surfaceY) > 0.3) continue;
        const dx = x - p.mesh.position.x;
        const dz = z - p.mesh.position.z;
        const rr = pickupRadius(p) + 0.2;
        if (dx * dx + dz * dz < rr * rr) return false;
      }
      const sourceSurfaceId = getCurrentCatSurfaceId();
      if (sourceSurfaceId === surface && Math.abs(cat.group.position.y - surfaceY) <= 0.16) return true;
      tempFrom.set(cat.pos.x, sourceSurfaceId === "floor" ? 0 : Math.max(0.02, cat.group.position.y), cat.pos.z);
      const resolveWithSource = (sourceId, sourcePoint) => {
        const planningSource =
          sourceId === "floor"
            ? (() => {
                const s = findSafeGroundPoint(new THREE.Vector3(sourcePoint.x, 0, sourcePoint.z));
                s.y = 0;
                return s;
              })()
            : sourcePoint;
        const anchor =
          typeof bestSurfaceJumpAnchor === "function"
            ? bestSurfaceJumpAnchor(surface, planningSource, tempTo, sourceId)
            : bestDeskJumpAnchor(planningSource);
        if (!anchor) return false;
        if (sourceId === "floor" && !canReachGroundTarget(planningSource, anchor, dynamicObstacles)) return false;
        if (typeof computeSurfaceJumpTargets === "function") {
          const targets = computeSurfaceJumpTargets(surface, anchor, tempTo, sourceId);
          return !!targets?.top;
        }
        return surface === "desk";
      };
      if (resolveWithSource(sourceSurfaceId, tempFrom)) return true;
      if (sourceSurfaceId !== "floor") {
        const floorStart = findSafeGroundPoint(desk.approach.clone());
        floorStart.y = 0;
        if (resolveWithSource("floor", floorStart)) return true;
      }
      return false;
    }

    if (isCatPointBlocked(tempTo.x, tempTo.z, staticObstacles, clearance)) return false;
    for (const p of pickups) {
      if (p.mesh.position.y > 0.34) continue;
      const dx = x - p.mesh.position.x;
      const dz = z - p.mesh.position.z;
      const rr = pickupRadius(p) + 0.28;
      if (dx * dx + dz * dz < rr * rr) return false;
    }

    const start = cat.onTable
      ? findSafeGroundPoint(desk.approach)
      : findSafeGroundPoint(new THREE.Vector3(cat.pos.x, 0, cat.pos.z));
    if (!canReachGroundTarget(start, tempTo, dynamicObstacles)) return false;

    // Validate the same approach offset used by cat behavior; fall back to center path if offset is blocked.
    const approach = buildCatnipApproachPoint(x, z, start, "floor");
    const approachBlockedStatic = isCatPointBlocked(approach.x, approach.z, staticObstacles, clearance);
    if (!approachBlockedStatic && canReachGroundTarget(start, approach, dynamicObstacles)) return true;
    return canReachGroundTarget(start, tempTo, dynamicObstacles);
  }

  function getPlacementFromMouse() {
    raycaster.setFromCamera(mouse, camera);

    let floorHit = null;
    let deskHit = null;
    if (raycaster.ray.intersectPlane(floorPlane, tempFloorHit)) floorHit = tempFloorHit.clone();
    if (raycaster.ray.intersectPlane(deskPlane, tempDeskHit)) deskHit = tempDeskHit.clone();

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      if (!hit?.object || !hit?.point || !hit.face) continue;
      if (isDescendantOf(hit.object, cat.group)) continue;
      if (isDescendantOf(hit.object, cup.group)) continue;
      const surface = hit.object.userData?.catSurface;
      if (!surface) continue;
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (worldNormal.y < 0.45) continue;
      const surfaceId = String(surface.id || surface.name || "desk");
      const clamped = clampToElevatedSurface(surfaceId, hit.point.x, hit.point.z, 0.16);
      if (!clamped) continue;
      return {
        surface: surfaceId,
        x: clamped.x,
        z: clamped.z,
        y: clamped.surface.y - 0.02 + CATNIP_HALF_HEIGHT,
        surfaceY: clamped.surface.y,
      };
    }

    if (!floorHit && !deskHit) return null;
    if (deskHit && isInsideDeskTop(deskHit.x, deskHit.z, 0.05)) {
      return {
        surface: "desk",
        x: THREE.MathUtils.clamp(deskHit.x, desk.pos.x - desk.sizeX * 0.5 + 0.16, desk.pos.x + desk.sizeX * 0.5 - 0.16),
        z: THREE.MathUtils.clamp(deskHit.z, desk.pos.z - desk.sizeZ * 0.5 + 0.16, desk.pos.z + desk.sizeZ * 0.5 - 0.16),
        y: desk.topY + CATNIP_HALF_HEIGHT,
        surfaceY: desk.topY + 0.02,
      };
    }

    if (!floorHit) return null;
    return {
      surface: "floor",
      x: THREE.MathUtils.clamp(floorHit.x, ROOM.minX + 0.6, ROOM.maxX - 0.6),
      z: THREE.MathUtils.clamp(floorHit.z, ROOM.minZ + 0.6, ROOM.maxZ - 0.6),
      y: CATNIP_HALF_HEIGHT,
      surfaceY: 0,
    };
  }

  function placeCatnipFromMouse() {
    const clockTime = getClockTime();
    // Block new catnip placement while cat is mid-air / mid-jump.
    if (cat.jump || (!cat.onTable && cat.group.position.y > 0.08)) return;
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
      pos: new THREE.Vector3(placement.x, Number.isFinite(placement.surfaceY) ? placement.surfaceY : 0, placement.z),
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

  function isDescendantOf(node, parent) {
    let cur = node;
    while (cur) {
      if (cur === parent) return true;
      cur = cur.parent;
    }
    return false;
  }

  return {
    setMouseFromEvent,
    placeCatnipFromMouse,
    clearCatnip,
  };
}
