export function createPickupsRuntime(ctx) {
  const {
    THREE,
    CANNON,
    scene,
    renderer,
    raycaster,
    mouse,
    tempV3,
    ROOM,
    desk,
    DESK_LEGS,
    hamper,
    trashCan,
    cat,
    cup,
    CUP_COLLISION,
    CAT_COLLISION,
    physics,
    pickups,
    game,
    controls,
    binVisuals,
    getSurfaceDefs,
    getClockTime,
    onAllSorted,
    addMess,
  } = ctx;

  let dragState = null;
  let dragHover = { binType: null, topEntry: false };
  const tempCatRel = new CANNON.Vec3();
  const tempCatLocal = new CANNON.Vec3();
  const tempInvQuat = new CANNON.Quaternion();
  const tempNormalLocal = new CANNON.Vec3();
  const tempNormalWorld = new CANNON.Vec3();

  function setMouseFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function setBinHighlight(binType) {
    const hamperOn = binType === "hamper";
    const trashOn = binType === "trash";
    const activeColor = 0x91f0ff;

    if (binVisuals.hamper.ring) {
      binVisuals.hamper.ring.material.opacity = hamperOn ? 0.55 : 0.0;
      binVisuals.hamper.ring.material.color.setHex(hamperOn ? activeColor : 0x77c9ff);
    }
    if (binVisuals.trash.ring) {
      binVisuals.trash.ring.material.opacity = trashOn ? 0.58 : 0.0;
      binVisuals.trash.ring.material.color.setHex(trashOn ? activeColor : 0xffd3a9);
    }

    for (const m of binVisuals.hamper.shells) {
      if (!m.material.emissive) continue;
      m.material.emissive.setHex(hamperOn ? 0x12313a : 0x000000);
    }
    for (const m of binVisuals.trash.shells) {
      if (!m.material.emissive) continue;
      m.material.emissive.setHex(trashOn ? 0x12313a : 0x000000);
    }
  }

  function resetDragHoverState() {
    dragHover = { binType: null, topEntry: false };
    setBinHighlight(null);
  }

  function isDraggingPickup(pickup) {
    return !!(dragState && dragState.pickup === pickup);
  }

  function pickupRadius(pickup) {
    return pickup.type === "laundry" ? 0.2 : 0.16;
  }

  function pickupHalfExtents(pickup) {
    const shape = pickup?.body?.shapes?.[0];
    if (shape?.halfExtents) {
      return {
        x: shape.halfExtents.x,
        y: shape.halfExtents.y,
        z: shape.halfExtents.z,
      };
    }
    return pickup.type === "laundry"
      ? { x: 0.24, y: 0.04, z: 0.18 }
      : { x: 0.15, y: 0.03, z: 0.12 };
  }

  function binAllowsPickup(binType, pickupType = "") {
    if (binType === "hamper") return pickupType === "laundry" && hamper?.specialFlags?.allowCleanLaundry !== false;
    if (binType === "trash") return pickupType === "trash" && trashCan?.specialFlags?.allowCleanTrash !== false;
    return false;
  }

  function getRaisedSurfaces() {
    return typeof getSurfaceDefs === "function" ? getSurfaceDefs({ includeFloor: false }) : [];
  }

  function getTopSurfaceAt(x, z) {
    let best = null;
    for (const surface of getRaisedSurfaces()) {
      const minX = Number(surface?.minX);
      const maxX = Number(surface?.maxX);
      const minZ = Number(surface?.minZ);
      const maxZ = Number(surface?.maxZ);
      const y = Number(surface?.y);
      if (![minX, maxX, minZ, maxZ, y].every(Number.isFinite)) continue;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (!best || y > best.y) best = surface;
    }
    return best;
  }

  function sampleCatPickupShoveContact(pickup) {
    const b = pickup.body;
    if (!b) return null;

    const catMinY = cat.group.position.y - 0.02;
    const catMaxY = cat.group.position.y + 0.34;
    const half = pickupHalfExtents(pickup);
    const pickupMinY = b.position.y - half.y;
    const pickupMaxY = b.position.y + half.y;
    if (pickupMaxY < catMinY || pickupMinY > catMaxY) return null;

    const catRadius = CAT_COLLISION.catBodyRadius;
    tempCatRel.set(cat.pos.x - b.position.x, 0, cat.pos.z - b.position.z);
    b.quaternion.inverse(tempInvQuat);
    tempInvQuat.vmult(tempCatRel, tempCatLocal);

    const clampedX = THREE.MathUtils.clamp(tempCatLocal.x, -half.x, half.x);
    const clampedZ = THREE.MathUtils.clamp(tempCatLocal.z, -half.z, half.z);
    const sepX = tempCatLocal.x - clampedX;
    const sepZ = tempCatLocal.z - clampedZ;
    const distSq = sepX * sepX + sepZ * sepZ;
    if (distSq >= catRadius * catRadius) return null;

    const dist = Math.sqrt(Math.max(1e-12, distSq));
    let nx = 0;
    let nz = 0;

    if (distSq > 1e-8) {
      // Local normal points from pickup bounds to cat center; invert to push pickup away from cat.
      tempNormalLocal.set(sepX / dist, 0, sepZ / dist);
      b.quaternion.vmult(tempNormalLocal, tempNormalWorld);
      nx = -tempNormalWorld.x;
      nz = -tempNormalWorld.z;
    } else {
      // Cat center is inside projected pickup bounds; push from cat center toward pickup center.
      nx = b.position.x - cat.pos.x;
      nz = b.position.z - cat.pos.z;
      const nLen = Math.hypot(nx, nz);
      if (nLen < 1e-4) {
        nx = Math.sin(cat.group.rotation.y);
        nz = Math.cos(cat.group.rotation.y);
      } else {
        nx /= nLen;
        nz /= nLen;
      }
    }

    const nMag = Math.hypot(nx, nz);
    if (nMag > 1e-6) {
      nx /= nMag;
      nz /= nMag;
    }

    return {
      nx,
      nz,
      penetration: catRadius - Math.sqrt(distSq),
    };
  }

  function jitterGeometry(geometry, amount) {
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const dx = (Math.random() - 0.5) * amount;
      const dy = (Math.random() - 0.5) * amount;
      const dz = (Math.random() - 0.5) * amount;
      pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  function addPickup(type, x, z, options = null) {
    let mesh;
    let body;
    let mass;
    if (type === "laundry") {
      // Pick a random clothing color each spawn
      const clothColors = [0x3182bd, 0x9ecae1, 0xc45c8a, 0xe8a838, 0x6db86d, 0xd45f5f, 0x9b6dd4, 0x4a90c4];
      const foldColors = [0x2c6e9e, 0x7ab8d8, 0xb04878, 0xc88c28, 0x4a9e4a, 0xb84040, 0x7a50b0, 0x3278a8];
      const ci = Math.floor(Math.random() * clothColors.length);
      const clothMat = new THREE.MeshStandardMaterial({ color: clothColors[ci], roughness: 0.97 });
      const foldMat = new THREE.MeshStandardMaterial({ color: foldColors[ci], roughness: 0.96 });
      const pile = new THREE.Group();

      // Main crumpled body — wider and thicker than before
      const baseGeo = new THREE.BoxGeometry(0.52, 0.07, 0.4, 6, 1, 6);
      jitterGeometry(baseGeo, 0.025);
      const base = new THREE.Mesh(baseGeo, clothMat);
      base.position.set(0, 0.04, 0);
      pile.add(base);

      // Second layer — angled like a sleeve or fold
      const foldGeo = new THREE.BoxGeometry(0.42, 0.055, 0.28, 6, 1, 6);
      jitterGeometry(foldGeo, 0.02);
      const fold = new THREE.Mesh(foldGeo, foldMat);
      fold.position.set(0.03, 0.09, -0.03);
      fold.rotation.y = 0.45;
      fold.rotation.x = 0.1;
      pile.add(fold);

      // Top flap — like a sleeve or collar sticking up
      const flapGeo = new THREE.BoxGeometry(0.22, 0.05, 0.16, 4, 1, 4);
      jitterGeometry(flapGeo, 0.018);
      const flap = new THREE.Mesh(flapGeo, clothMat);
      flap.position.set(0.1, 0.13, 0.07);
      flap.rotation.y = -0.6;
      flap.rotation.x = -0.18;
      pile.add(flap);

      // Extra scrunch — small piece poking out the other side
      const scrunchGeo = new THREE.BoxGeometry(0.16, 0.04, 0.12, 4, 1, 4);
      jitterGeometry(scrunchGeo, 0.015);
      const scrunch = new THREE.Mesh(scrunchGeo, foldMat);
      scrunch.position.set(-0.14, 0.07, 0.1);
      scrunch.rotation.y = 0.8;
      scrunch.rotation.x = 0.12;
      pile.add(scrunch);

      mesh = pile;
      mesh.rotation.x = (Math.random() - 0.5) * 0.07;
      mesh.rotation.z = (Math.random() - 0.5) * 0.07;
      mass = 0.56;
      body = new CANNON.Body({
        mass,
        material: physics.materials.laundryMat,
        linearDamping: 0.8,
        angularDamping: 0.93,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.24, 0.04, 0.18)));
    } else {
      const geo = new THREE.IcosahedronGeometry(0.16, 1);
      jitterGeometry(geo, 0.03);
      mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xefefef, roughness: 0.95 })
      );
      mesh.rotation.x = (Math.random() - 0.5) * 0.28;
      mesh.rotation.z = (Math.random() - 0.5) * 0.28;
      mass = 0.2;
      body = new CANNON.Body({
        mass,
        material: physics.materials.paperMat,
        linearDamping: 0.18,
        angularDamping: 0.24,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.03, 0.12)));

      const hitProxy = new THREE.Mesh(
        new THREE.SphereGeometry(0.23, 10, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitProxy.position.set(0, 0.02, 0);
      mesh.add(hitProxy);
    }
    const spawnY = Number.isFinite(options?.y) ? Number(options.y) : 0.08;
    const spawnSurfaceId = options?.surfaceId != null ? String(options.surfaceId) : "floor";
    mesh.position.set(x, spawnY, z);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
      }
    });

    body.position.set(x, spawnY, z);
    body.quaternion.setFromEuler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
    body.sleepSpeedLimit = 0.09;
    body.sleepTimeLimit = 0.4;
    physics.world.addBody(body);

    scene.add(mesh);
    pickups.push({
      mesh,
      body,
      type,
      spawnSurfaceId,
      baseMass: mass,
      pulseSeed: Math.random() * 6.28,
      catShovePulseAt: 0,
      inMotion: false,
      motion: null, // "drop" | "bounce" | "drag"
      targetBin: null,
    });
  }

  function hitBinFromSide(pos, binType) {
    if (binType === "hamper") {
      const dx = Math.abs(pos.x - hamper.pos.x);
      const dz = Math.abs(pos.z - hamper.pos.z);
      const inOuter = dx <= hamper.outerHalfX + 0.1 && dz <= hamper.outerHalfZ + 0.1;
      return inOuter && pos.y <= hamper.rimY + 0.1;
    }

    const dx = pos.x - trashCan.pos.x;
    const dz = pos.z - trashCan.pos.z;
    const d = Math.hypot(dx, dz);
    return d <= trashCan.outerRadius + 0.11 && pos.y <= trashCan.rimY + 0.1;
  }

  function classifyBinContactForPickup(pickup) {
    const pos = pickup.mesh.position;
    const wantedBin = pickup.type === "laundry" ? "hamper" : "trash";
    const otherBin = wantedBin === "hamper" ? "trash" : "hamper";
    const r = pickupRadius(pickup);

    function topEntry(binType) {
      if (binType === "hamper") {
        return (
          Math.abs(pos.x - hamper.pos.x) <= hamper.openingHalfX - r * 0.2 &&
          Math.abs(pos.z - hamper.pos.z) <= hamper.openingHalfZ - r * 0.2 &&
          pos.y >= hamper.rimY + 0.03
        );
      }
      const dx = pos.x - trashCan.pos.x;
      const dz = pos.z - trashCan.pos.z;
      const dist = Math.hypot(dx, dz);
      return dist <= trashCan.openingRadius - r * 0.08 && pos.y >= trashCan.rimY - 0.01;
    }

    function sideHit(binType) {
      return hitBinFromSide(pos, binType);
    }

    if (topEntry(wantedBin)) return { binType: wantedBin, topEntry: true, valid: binAllowsPickup(wantedBin, pickup.type) };
    if (topEntry(otherBin)) return { binType: otherBin, topEntry: true, valid: false };
    if (sideHit(wantedBin)) return { binType: wantedBin, topEntry: false, valid: false };
    if (sideHit(otherBin)) return { binType: otherBin, topEntry: false, valid: false };
    return { binType: null, topEntry: false, valid: false };
  }

  function findPickupFromObject(object3D) {
    let node = object3D;
    while (node) {
      const hit = pickups.find((p) => p.mesh === node);
      if (hit) return hit;
      node = node.parent;
    }
    return null;
  }

  function setPickupBodyMode(pickup, mode) {
    pickup.body.type = mode;
    if (mode === CANNON.Body.DYNAMIC) pickup.body.mass = pickup.baseMass;
    else pickup.body.mass = 0;
    pickup.body.updateMassProperties();
  }

  function pushOutFromAabbXZ(pos, cx, cz, hx, hz, radius) {
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const limX = hx + radius;
    const limZ = hz + radius;
    if (Math.abs(dx) >= limX || Math.abs(dz) >= limZ) return;
    const penX = limX - Math.abs(dx);
    const penZ = limZ - Math.abs(dz);
    if (penX < penZ) pos.x = cx + Math.sign(dx || 1) * limX;
    else pos.z = cz + Math.sign(dz || 1) * limZ;
  }

  function constrainDragPosition(pickup, liftY) {
    const pos = pickup.mesh.position;
    const r = pickupRadius(pickup);
    let targetY = liftY;

    const topSurface = getTopSurfaceAt(pos.x, pos.z);
    if (topSurface) targetY = Math.max(targetY, Number(topSurface.y || 0) + r * 0.55);

    for (const leg of DESK_LEGS) {
      if (pos.y <= leg.topY + 0.03) pushOutFromAabbXZ(pos, leg.x, leg.z, leg.halfX, leg.halfZ, r);
    }

    if (pos.y <= hamper.rimY + 0.2) {
      const dx = pos.x - hamper.pos.x;
      const dz = pos.z - hamper.pos.z;
      const limX = hamper.outerHalfX + r;
      const limZ = hamper.outerHalfZ + r;
      const inOuter = Math.abs(dx) < limX && Math.abs(dz) < limZ;
      const inOpening =
        Math.abs(dx) <= hamper.openingHalfX - r * 0.45 &&
        Math.abs(dz) <= hamper.openingHalfZ - r * 0.45;
      if (inOuter && !inOpening) {
        const penX = limX - Math.abs(dx);
        const penZ = limZ - Math.abs(dz);
        if (penX < penZ) pos.x = hamper.pos.x + Math.sign(dx || 1) * limX;
        else pos.z = hamper.pos.z + Math.sign(dz || 1) * limZ;
        const penetration = Math.min(penX, penZ);
        const climb = THREE.MathUtils.clamp((0.14 - penetration) * 0.8, 0, 0.12);
        const mouseLiftInfluence = THREE.MathUtils.clamp((liftY - 0.22) * 0.35, 0, 0.18);
        targetY = Math.max(targetY, hamper.rimY - 0.02 + climb + mouseLiftInfluence);
      }
      if (pickup.type === "laundry" && inOpening) targetY = Math.max(targetY, hamper.rimY + 0.14);
    }

    if (pos.y <= trashCan.rimY + 0.22) {
      const dx = pos.x - trashCan.pos.x;
      const dz = pos.z - trashCan.pos.z;
      const d = Math.hypot(dx, dz);
      const inOpening = d <= trashCan.openingRadius - r * 0.12;
      if (!inOpening && d < trashCan.outerRadius + r * 0.8) {
        const n = d || 1;
        const targetR = trashCan.outerRadius + r * 0.8;
        pos.x = trashCan.pos.x + (dx / n) * targetR;
        pos.z = trashCan.pos.z + (dz / n) * targetR;
        const penetration = targetR - d;
        const climb = THREE.MathUtils.clamp(penetration * 0.55, 0, 0.14);
        const mouseLiftInfluence = THREE.MathUtils.clamp((liftY - 0.2) * 0.36, 0, 0.2);
        targetY = Math.max(targetY, trashCan.rimY - 0.02 + climb + mouseLiftInfluence);
      }
      if (pickup.type === "trash" && d <= trashCan.openingRadius + 0.12) {
        targetY = Math.max(targetY, trashCan.rimY + 0.32);
      }
    }

    pos.y = THREE.MathUtils.lerp(pos.y, targetY, 0.34);
  }

  function startPickupIntoBin(pickup, binType) {
    if (!binAllowsPickup(binType, pickup?.type)) {
      startPickupBounce(pickup, binType);
      return;
    }
    pickup.inMotion = true;
    pickup.motion = "drop";
    pickup.targetBin = binType;
    if (binType === "trash") {
      pickup.body.position.y = Math.max(pickup.body.position.y, trashCan.rimY + 0.34);
      const dx = pickup.body.position.x - trashCan.pos.x;
      const dz = pickup.body.position.z - trashCan.pos.z;
      pickup.body.velocity.x = pickup.body.velocity.x * 0.35 + (-dx * 0.62);
      pickup.body.velocity.z = pickup.body.velocity.z * 0.35 + (-dz * 0.62);
      pickup.body.angularVelocity.scale(0.45, pickup.body.angularVelocity);
    } else if (binType === "hamper") {
      pickup.body.position.y = Math.max(pickup.body.position.y, hamper.rimY + 0.18);
    }
    pickup.body.velocity.y = Math.min(pickup.body.velocity.y, -0.48);
  }

  function startPickupBounce(pickup, binType) {
    pickup.inMotion = true;
    pickup.motion = "bounce";
    pickup.targetBin = null;

    const center = binType === "hamper" ? hamper.pos : trashCan.pos;
    const out = new THREE.Vector3(pickup.body.position.x - center.x, 0, pickup.body.position.z - center.z);
    if (out.lengthSq() < 1e-4) out.set(1, 0, 0);
    out.normalize();
    pickup.body.velocity.set(out.x * 1.6, 1.05, out.z * 1.6);
    pickup.body.angularVelocity.set(0, 2.1, 0);
  }

  function startPickupDrop(pickup) {
    pickup.inMotion = true;
    pickup.motion = "drop";
    pickup.targetBin = null;
    pickup.body.velocity.y = Math.min(pickup.body.velocity.y, 0.0);
  }

  function pickupTuning(pickup) {
    if (pickup.type === "laundry") return { friction: 0.18, settleSpeed: 0.08 };
    return { friction: 0.46, settleSpeed: 0.16 };
  }

  function isPickupRestingOnRaisedSurface(pickup) {
    const b = pickup.body;
    const halfY = pickup.type === "laundry" ? 0.04 : 0.03;
    const supportSurface = getTopSurfaceAt(b.position.x, b.position.z);
    if (!supportSurface) return false;
    return Math.abs(b.position.y - (Number(supportSurface.y || 0) + halfY)) <= 0.08;
  }

  function resolvePickupCupWaterCollision(pickup) {
    if (cup.broken || cup.falling || !cup.group.visible) return;
    const b = pickup.body;
    const pickupRadiusXZ = pickupRadius(pickup) * 0.86;
    const pickupHalfY = pickup.type === "laundry" ? 0.04 : 0.03;

    const cupX = cup.group.position.x;
    const cupZ = cup.group.position.z;
    const waterCenterY = cup.group.position.y + CUP_COLLISION.waterCenterY;
    const waterHalfH = CUP_COLLISION.waterHeight * 0.5;
    const waterMinY = waterCenterY - waterHalfH;
    const waterMaxY = waterCenterY + waterHalfH;

    const itemMinY = b.position.y - pickupHalfY;
    const itemMaxY = b.position.y + pickupHalfY;
    if (itemMaxY < waterMinY || itemMinY > waterMaxY) return;

    let dx = b.position.x - cupX;
    let dz = b.position.z - cupZ;
    let dist = Math.hypot(dx, dz);
    const minDist = CUP_COLLISION.waterRadius + pickupRadiusXZ;
    if (dist >= minDist) return;

    if (dist < 1e-4) {
      dx = 1;
      dz = 0;
      dist = 1;
    }
    const nx = dx / dist;
    const nz = dz / dist;
    const topContact = b.position.y >= waterMaxY - pickupHalfY * 0.4 && b.velocity.y <= 0;

    if (topContact) {
      b.position.y = Math.max(b.position.y, waterMaxY + pickupHalfY + 0.004);
      if (b.velocity.y < 0) b.velocity.y = -b.velocity.y * 0.14;
      b.velocity.x *= 0.9;
      b.velocity.z *= 0.9;
      b.angularVelocity.scale(0.86, b.angularVelocity);
    } else {
      const push = minDist - dist + 0.003;
      b.position.x += nx * push;
      b.position.z += nz * push;
      const radialVel = b.velocity.x * nx + b.velocity.z * nz;
      if (radialVel < 0) {
        const sideBounce = pickup.type === "trash" ? 0.32 : 0.24;
        b.velocity.x -= (1 + sideBounce) * radialVel * nx;
        b.velocity.z -= (1 + sideBounce) * radialVel * nz;
      }
      b.velocity.y = Math.max(b.velocity.y, 0.1);
    }
    pickup.inMotion = true;
  }

  function removePickup(pickup) {
    scene.remove(pickup.mesh);
    if (pickup.body) physics.world.removeBody(pickup.body);
    const idx = pickups.indexOf(pickup);
    if (idx !== -1) pickups.splice(idx, 1);
    game.sorted++;
    addMess(-10);
    if (!game.endlessMode && game.sorted >= game.total) onAllSorted();
  }

  function onPointerDown(event) {
    const pickupMeshes = pickups.map((p) => p.mesh);
    setMouseFromEvent(event);
    raycaster.setFromCamera(mouse, ctx.camera);
    const hits = raycaster.intersectObjects(pickupMeshes, true);
    if (!hits.length) return;

    const pickup = findPickupFromObject(hits[0].object);
    if (!pickup) return;

    const planeY = 0.08;
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    if (!raycaster.ray.intersectPlane(dragPlane, tempV3)) return;

    dragState = {
      pickup,
      planeY,
      offsetX: pickup.mesh.position.x - tempV3.x,
      offsetZ: pickup.mesh.position.z - tempV3.z,
    };
    setPickupBodyMode(pickup, CANNON.Body.KINEMATIC);
    pickup.body.velocity.setZero();
    pickup.body.angularVelocity.setZero();
    pickup.inMotion = false;
    pickup.motion = "drag";
    pickup.targetBin = null;
    pickup.mesh.position.y = 0.28;
    pickup.body.position.copy(pickup.mesh.position);
    pickup.body.quaternion.setFromEuler(pickup.mesh.rotation.x, pickup.mesh.rotation.y, pickup.mesh.rotation.z);
    resetDragHoverState();
    controls.enabled = false;
  }

  function onPointerMove(event) {
    if (!dragState) return;
    setMouseFromEvent(event);
    raycaster.setFromCamera(mouse, ctx.camera);
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragState.planeY);
    if (!raycaster.ray.intersectPlane(dragPlane, tempV3)) return;
    const x = tempV3.x + dragState.offsetX;
    const z = tempV3.z + dragState.offsetZ;
    dragState.pickup.mesh.position.x = THREE.MathUtils.clamp(x, ROOM.minX + 0.35, ROOM.maxX - 0.35);
    dragState.pickup.mesh.position.z = THREE.MathUtils.clamp(z, ROOM.minZ + 0.35, ROOM.maxZ - 0.35);
    const baseLift = THREE.MathUtils.clamp(0.16 + ((mouse.y + 1) * 0.5) * 1.35, 0.14, 1.6);
    const lift = dragState.pickup.type === "trash" ? baseLift * 2.0 : baseLift;
    dragState.pickup.mesh.position.y = lift;
    constrainDragPosition(dragState.pickup, lift);
    dragState.pickup.body.position.set(
      dragState.pickup.mesh.position.x,
      dragState.pickup.mesh.position.y,
      dragState.pickup.mesh.position.z
    );
    dragState.pickup.body.velocity.setZero();
    dragState.pickup.body.angularVelocity.setZero();

    dragHover = classifyBinContactForPickup(dragState.pickup);
    setBinHighlight(dragHover.binType);
  }

  function onPointerUp() {
    if (!dragState) return;
    const p = dragState.pickup;
    const finalHit = classifyBinContactForPickup(p);
    setPickupBodyMode(p, CANNON.Body.DYNAMIC);
    p.body.wakeUp();

    if (finalHit.valid && finalHit.topEntry) startPickupIntoBin(p, finalHit.binType);
    else if (finalHit.binType != null) startPickupBounce(p, finalHit.binType);
    else startPickupDrop(p);

    dragState = null;
    resetDragHoverState();
    controls.enabled = true;
  }

  function updatePickups(dt) {
    const clockTime = getClockTime();
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      const tuning = pickupTuning(p);
      const b = p.body;
      const maxLinear = p.type === "trash" ? 4.8 : 3.6;
      const maxAngular = p.type === "trash" ? 9.0 : 6.0;

      if (isDraggingPickup(p)) {
        p.mesh.scale.x = THREE.MathUtils.damp(p.mesh.scale.x, 1, 10, dt);
        p.mesh.scale.y = THREE.MathUtils.damp(p.mesh.scale.y, 1, 10, dt);
        p.mesh.scale.z = THREE.MathUtils.damp(p.mesh.scale.z, 1, 10, dt);
        continue;
      }

      if (p.type === "trash" && p.inMotion && b.position.y > 0.14) {
        const fx = Math.sin(clockTime * 8 + p.pulseSeed) * 0.24;
        const fz = Math.cos(clockTime * 9 + p.pulseSeed * 1.6) * 0.2;
        b.applyForce(new CANNON.Vec3(fx, 0, fz), b.position);
        b.angularVelocity.x += Math.cos(clockTime * 6 + p.pulseSeed) * 0.02;
        b.angularVelocity.z += Math.sin(clockTime * 7 + p.pulseSeed) * 0.02;
        b.angularVelocity.y += Math.sin(clockTime * 5 + p.pulseSeed) * 0.01;
      }

      const linearSpeed = b.velocity.length();
      if (linearSpeed > maxLinear) b.velocity.scale(maxLinear / linearSpeed, b.velocity);
      const angSpeed = b.angularVelocity.length();
      if (angSpeed > maxAngular) b.angularVelocity.scale(maxAngular / angSpeed, b.angularVelocity);

      const shoveContact = sampleCatPickupShoveContact(p);
      const half = pickupHalfExtents(p);
      const pickupBottomY = b.position.y - half.y;
      const catTopY = cat.group.position.y + 0.34;
      const droppedOnCat = b.velocity.y < -0.42 && pickupBottomY >= catTopY - 0.02;
      if (shoveContact) {
        const nxCat = shoveContact.nx;
        const nzCat = shoveContact.nz;

        if (droppedOnCat) {
          const push = shoveContact.penetration + 0.05;
          b.wakeUp();
          b.position.x += nxCat * push;
          b.position.z += nzCat * push;
          const impact = Math.max(0, -b.velocity.y);
          const bounce =
            p.type === "trash"
              ? 1.35 + Math.min(0.45, impact * 0.16)
              : 1.28 + Math.min(0.36, impact * 0.14);
          b.velocity.x += nxCat * bounce;
          b.velocity.z += nzCat * bounce;
          if (p.type === "laundry") {
            const side = (Math.random() - 0.5) * 0.28;
            b.velocity.x += -nzCat * side;
            b.velocity.z += nxCat * side;
          }
          b.velocity.y = Math.max(b.velocity.y, p.type === "trash" ? 0.9 : 0.82);
          b.angularVelocity.y += (Math.random() - 0.5) * 2.1;
          b.angularVelocity.x += (Math.random() - 0.5) * 1.4;
          b.angularVelocity.z += (Math.random() - 0.5) * 1.4;
          p.inMotion = true;
          if (p.motion === "drag") p.motion = "bounce";
        } else {
          // Cat physically shoves movable clutter out of its path while walking.
          const catSpeed = Math.max(
            Number.isFinite(cat.nav?.lastSpeed) ? cat.nav.lastSpeed : 0,
            Number.isFinite(cat.nav?.commandedSpeed) ? cat.nav.commandedSpeed : 0
          );
          const contactPressure = THREE.MathUtils.clamp(shoveContact.penetration / 0.08, 0, 1.8);
          const catEngaged = !!cat.jump || catSpeed > 0.03 || shoveContact.penetration > 0.012;
          if (catEngaged) {
            const push = THREE.MathUtils.clamp(
              shoveContact.penetration + 0.012 + contactPressure * 0.018,
              0.012,
              0.085
            );
            b.wakeUp();
            b.position.x += nxCat * push;
            b.position.z += nzCat * push;

            const outwardSpeed = b.velocity.x * nxCat + b.velocity.z * nzCat;
            const targetOutward = THREE.MathUtils.clamp(
              (p.type === "trash" ? 0.42 : 0.34) + catSpeed * 0.46 + contactPressure * 0.22,
              0.26,
              p.type === "trash" ? 1.2 : 0.96
            );
            if (outwardSpeed < targetOutward) {
              const add = targetOutward - outwardSpeed;
              b.velocity.x += nxCat * add;
              b.velocity.z += nzCat * add;
            }

            if (clockTime >= (Number(p.catShovePulseAt) || 0)) {
              const pulse = THREE.MathUtils.clamp(
                (p.type === "trash" ? 0.54 : 0.44) + contactPressure * 0.38 + catSpeed * 0.28,
                0.34,
                p.type === "trash" ? 1.28 : 1.0
              );
              b.velocity.x += nxCat * pulse;
              b.velocity.z += nzCat * pulse;
              p.catShovePulseAt = clockTime + 0.125;
            }

            const tangent = p.type === "trash" ? 0.14 : 0.1;
            b.velocity.x += -nzCat * tangent * 0.5;
            b.velocity.z += nxCat * tangent * 0.5;
            b.velocity.y = Math.max(b.velocity.y, 0.02);
            p.inMotion = true;
            if (!p.motion || p.motion === "drag") p.motion = "bounce";
          }
        }
      }

      resolvePickupCupWaterCollision(p);

      const dxTrash = b.position.x - trashCan.pos.x;
      const dzTrash = b.position.z - trashCan.pos.z;
      const dTrash = Math.hypot(dxTrash, dzTrash);
      const dxHamper = b.position.x - hamper.pos.x;
      const dzHamper = b.position.z - hamper.pos.z;

      if (p.type === "trash") {
        if (binAllowsPickup("trash", p.type) && p.targetBin === "trash" && dTrash <= trashCan.openingRadius + 0.2 && b.position.y <= trashCan.rimY + 0.46) {
          const radial = Math.max(dTrash - trashCan.openingRadius * 0.25, 0);
          const inward = THREE.MathUtils.clamp(radial * 0.9, 0.22, 1.05);
          const down = dTrash <= trashCan.openingRadius ? 0.54 : 0.22;
          b.applyForce(new CANNON.Vec3(-dxTrash * inward, -down, -dzTrash * inward), b.position);
          if (dTrash <= trashCan.openingRadius + 0.02) {
            b.velocity.x *= 0.9;
            b.velocity.z *= 0.9;
            b.angularVelocity.scale(0.88, b.angularVelocity);
          }
        }
        const nearRim = dTrash > trashCan.openingRadius - 0.01 && dTrash < trashCan.outerRadius + 0.02;
        if (p.targetBin !== "trash" && nearRim && b.position.y <= trashCan.rimY + 0.06 && b.velocity.y < 0) {
          const nx = dxTrash / (dTrash || 1);
          const nz = dzTrash / (dTrash || 1);
          b.applyImpulse(new CANNON.Vec3(nx * 0.06, 0.04, nz * 0.06), b.position);
        }
        if (
          binAllowsPickup("trash", p.type) &&
          dTrash <= trashCan.openingRadius - 0.015 &&
          b.position.y <= trashCan.sinkY + 0.11 &&
          b.velocity.length() <= 0.5
        ) {
          removePickup(p);
          continue;
        }
      } else {
        if (
          binAllowsPickup("hamper", p.type) &&
          p.targetBin === "hamper" &&
          Math.abs(dxHamper) <= hamper.openingHalfX + 0.04 &&
          Math.abs(dzHamper) <= hamper.openingHalfZ + 0.04 &&
          b.position.y <= hamper.rimY + 0.25
        ) {
          b.applyForce(new CANNON.Vec3(-dxHamper * 0.16, 0, -dzHamper * 0.16), b.position);
        }
        if (
          binAllowsPickup("hamper", p.type) &&
          Math.abs(dxHamper) <= hamper.outerHalfX - 0.015 &&
          Math.abs(dzHamper) <= hamper.outerHalfZ - 0.015 &&
          b.position.y <= hamper.sinkY + 0.12 &&
          Math.abs(dxHamper) <= hamper.openingHalfX + 0.04 &&
          Math.abs(dzHamper) <= hamper.openingHalfZ + 0.04 &&
          b.velocity.length() <= 0.45
        ) {
          removePickup(p);
          continue;
        }
      }

      p.mesh.position.set(b.position.x, b.position.y, b.position.z);
      p.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);

      const speed = b.velocity.length();
      if (p.type === "laundry") {
        const squash = THREE.MathUtils.clamp(speed * 0.08, 0, 0.28);
        p.mesh.scale.set(1 + squash * 0.35, 1 - squash, 1 + squash * 0.35);
      } else {
        const squash = THREE.MathUtils.clamp(speed * 0.12, 0, 0.35);
        p.mesh.scale.set(1 + squash * 0.35, 1 - squash, 1 + squash * 0.35);
      }

      if ((b.position.y <= 0.082 || isPickupRestingOnRaisedSurface(p)) && speed < tuning.settleSpeed) {
        b.velocity.scale(tuning.friction, b.velocity);
        if (speed < tuning.settleSpeed * 0.6) {
          p.inMotion = false;
          p.motion = null;
          p.targetBin = null;
        }
      }

      p.mesh.scale.x = THREE.MathUtils.damp(p.mesh.scale.x, 1, 10, dt);
      p.mesh.scale.y = THREE.MathUtils.damp(p.mesh.scale.y, 1, 10, dt);
      p.mesh.scale.z = THREE.MathUtils.damp(p.mesh.scale.z, 1, 10, dt);
    }
  }

  function clearAllPickups() {
    for (const p of pickups) {
      scene.remove(p.mesh);
      if (p.body) physics.world.removeBody(p.body);
    }
    pickups.length = 0;
  }

  function resetInteraction() {
    dragState = null;
    resetDragHoverState();
    controls.enabled = true;
  }

  return {
    addPickup,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    updatePickups,
    clearAllPickups,
    resetInteraction,
    isDraggingPickup,
    pickupRadius,
  };
}
