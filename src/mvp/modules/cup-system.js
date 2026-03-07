export function makeCup({ THREE, desk, CUP_COLLISION }) {
  const group = new THREE.Group();
  group.position.set(desk.cup.x, desk.topY + 0.01, desk.cup.z);

  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.42, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xe6f5ff,
      transparent: true,
      opacity: 0.34,
      roughness: 0.15,
      metalness: 0.02,
    })
  );
  glass.position.y = 0.21;
  group.add(glass);

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(
      Math.max(0.01, CUP_COLLISION.waterRadius - 0.01),
      CUP_COLLISION.waterRadius,
      CUP_COLLISION.waterHeight,
      14
    ),
    new THREE.MeshStandardMaterial({
      color: 0x7ab9ff,
      transparent: true,
      opacity: 0.45,
      roughness: 0.2,
    })
  );
  water.position.y = CUP_COLLISION.waterCenterY;
  group.add(water);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.125, 0.01, 6, 20),
    new THREE.MeshStandardMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.28 })
  );
  rim.rotation.x = Math.PI * 0.5;
  rim.position.y = 0.42;
  group.add(rim);

  return {
    group,
    falling: false,
    broken: false,
    body: null,
    bodyInWorld: false,
    knockedAt: -1,
  };
}

export function createCupRuntime(ctx) {
  const {
    THREE,
    CANNON,
    scene,
    physics,
    desk,
    CUP_COLLISION,
    cup,
    cat,
    game,
    shatterBits,
    pickups,
    pickupRadius,
    isDraggingPickup,
    getClockTime,
  } = ctx;
  const tempV3 = new THREE.Vector3();
  const CUP_PHYSICS = {
    mass: 0.22,
    halfR: CUP_COLLISION.radius,
    halfH: 0.21,
    tableY: desk.topY + 0.01,
    breakFloorY: 0.06,
    contactGrace: 0.06,
    dynamicAngularDamping: 0.99,
  };
  const cupMat = physics.materials.rimMat || physics.materials.shellMat;

  function spawnCupShatter(x, z) {
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xdff2ff,
      transparent: true,
      opacity: 0.55,
      roughness: 0.2,
    });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.03), glassMat.clone());
      const ang = (i / 12) * Math.PI * 2;
      const sp = 0.7 + Math.random() * 0.8;
      m.position.set(x, 0.03, z);
      scene.add(m);
      shatterBits.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(ang) * sp, 0.2 + Math.random() * 0.4, Math.sin(ang) * sp),
        ttl: 1.5 + Math.random() * 0.6,
        t: 0,
      });
    }
  }

  function ensureCupBody() {
    if (cup.body) return cup.body;

    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: cupMat,
      linearDamping: 0.16,
      angularDamping: 0.18,
    });
    // Keep cylinder upright (Cannon cylinders are Y-up by default).
    const cyl = new CANNON.Cylinder(CUP_PHYSICS.halfR, CUP_PHYSICS.halfR, CUP_PHYSICS.halfH * 2, 14);
    body.addShape(cyl);
    cup.body = body;
    return body;
  }

  function setCupBodyFromMeshStatic() {
    const body = ensureCupBody();
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.angularFactor.set(1, 1, 1);
    body.updateMassProperties();
    body.position.set(cup.group.position.x, cup.group.position.y + CUP_PHYSICS.halfH, cup.group.position.z);
    body.quaternion.setFromEuler(0, cup.group.rotation.y, 0);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    if (!cup.bodyInWorld) {
      physics.world.addBody(body);
      cup.bodyInWorld = true;
    }
  }

  function syncCupMeshFromBody() {
    if (!cup.body) return;
    cup.group.position.set(
      cup.body.position.x,
      cup.body.position.y - CUP_PHYSICS.halfH,
      cup.body.position.z
    );
    cup.group.quaternion.set(cup.body.quaternion.x, cup.body.quaternion.y, cup.body.quaternion.z, cup.body.quaternion.w);
  }

  function isCupTouchingStaticSurface() {
    if (!cup.body) return false;
    const contacts = physics.world.contacts || [];
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if (!c || c.enabled === false) continue;
      if (c.bi === cup.body && c.bj?.type === CANNON.Body.STATIC) return true;
      if (c.bj === cup.body && c.bi?.type === CANNON.Body.STATIC) return true;
    }
    return false;
  }

  function shatterCupAtCurrentPosition() {
    if (cup.broken) return;
    cup.falling = false;
    cup.broken = true;
    cup.group.visible = false;
    if (cup.bodyInWorld) {
      physics.world.removeBody(cup.body);
      cup.bodyInWorld = false;
    }
    spawnCupShatter(cup.group.position.x, cup.group.position.z);
    if (game.pendingLoseAt == null) {
      game.pendingLoseAt = getClockTime() + 1.0;
      game.reason = "The glass cup hit a surface and shattered.";
    }
  }

  function knockCup(impulse = null) {
    if (cup.falling || cup.broken || !cup.body) return;
    cup.falling = true;
    cup.knockedAt = getClockTime();
    cup.body.type = CANNON.Body.DYNAMIC;
    cup.body.mass = CUP_PHYSICS.mass;
    cup.body.angularDamping = CUP_PHYSICS.dynamicAngularDamping;
    cup.body.angularFactor.set(0.16, 0.16, 0.16);
    cup.body.updateMassProperties();
    cup.body.wakeUp();
    if (impulse && Number.isFinite(impulse.dirX) && Number.isFinite(impulse.dirZ)) {
      tempV3.set(impulse.dirX, 0, impulse.dirZ);
    } else {
      tempV3.copy(cup.group.position).sub(cat.group.position);
      tempV3.y = 0;
    }
    if (tempV3.lengthSq() < 0.0001) tempV3.set(1, 0, 0);
    tempV3.normalize();
    const strength = THREE.MathUtils.clamp(impulse?.strength ?? 1.0, 0.4, 2.2);
    cup.body.velocity.set(tempV3.x * 0.145 * strength, 0.075, tempV3.z * 0.14 * strength);
    cup.body.angularVelocity.set(0, 0, 0);
    cup.body.applyImpulse(
      new CANNON.Vec3(tempV3.x * 0.05 * strength, 0.014, tempV3.z * 0.05 * strength),
      cup.body.position
    );
  }

  function maybeKnockCupFromPickupImpacts() {
    if (cup.falling || cup.broken || !cup.body || !Array.isArray(pickups)) return;
    const cupCenterY = cup.group.position.y + CUP_PHYSICS.halfH;
    for (const p of pickups) {
      if (!p?.body || !p?.mesh) continue;
      if (typeof isDraggingPickup === "function" && isDraggingPickup(p)) continue;

      const dx = p.body.position.x - cup.body.position.x;
      const dz = p.body.position.z - cup.body.position.z;
      const itemR =
        typeof pickupRadius === "function"
          ? Math.max(0.03, pickupRadius(p) * 0.86)
          : (p.type === "laundry" ? 0.17 : 0.13);
      const minDist = CUP_COLLISION.radius + itemR;
      if (dx * dx + dz * dz > minDist * minDist) continue;

      const dy = Math.abs(p.body.position.y - cupCenterY);
      if (dy > 0.28) continue;

      const speed = Math.hypot(p.body.velocity.x, p.body.velocity.z);
      if (speed < 0.28) continue;

      knockCup({
        dirX: p.body.velocity.x,
        dirZ: p.body.velocity.z,
        strength: THREE.MathUtils.clamp(0.55 + speed * 0.42, 0.6, 1.45),
      });
      break;
    }
  }

  function maybeKnockCupFromCatBump() {
    if (cup.falling || cup.broken || !cup.body) return;
    const dx = cup.group.position.x - cat.pos.x;
    const dz = cup.group.position.z - cat.pos.z;
    const minDist = CUP_COLLISION.radius + 0.24;
    if (dx * dx + dz * dz > minDist * minDist) return;
    if (Math.abs(cat.group.position.y - desk.topY) > 0.26) return;
    const catSpeed = Number.isFinite(cat.nav?.lastSpeed) ? cat.nav.lastSpeed : 0;
    if (catSpeed < 0.16) return;
    knockCup({ dirX: dx, dirZ: dz, strength: THREE.MathUtils.clamp(0.7 + catSpeed * 0.5, 0.7, 1.5) });
  }

  function updateCup(dt) {
    if (!cup.body) return;
    if (!cup.falling || cup.broken) {
      maybeKnockCupFromPickupImpacts();
      maybeKnockCupFromCatBump();
      return;
    }

    syncCupMeshFromBody();
    const elapsed = getClockTime() - cup.knockedAt;
    if (elapsed >= CUP_PHYSICS.contactGrace && isCupTouchingStaticSurface()) {
      shatterCupAtCurrentPosition();
      return;
    }

    if (cup.group.position.y <= CUP_PHYSICS.breakFloorY) {
      cup.group.position.y = CUP_PHYSICS.breakFloorY;
      shatterCupAtCurrentPosition();
    }
  }

  function updateShatter(dt) {
    for (let i = shatterBits.length - 1; i >= 0; i--) {
      const b = shatterBits[i];
      b.t += dt;
      if (b.t >= b.ttl) {
        scene.remove(b.mesh);
        shatterBits.splice(i, 1);
        continue;
      }
      b.vel.y -= 11.0 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.mesh.position.y <= 0.01) {
        b.mesh.position.y = 0.01;
        b.vel.y = Math.abs(b.vel.y) * 0.12;
        b.vel.x *= 0.78;
        b.vel.z *= 0.78;
      }
      b.mesh.material.opacity = Math.max(0, 0.6 * (1 - b.t / b.ttl));
    }
  }

  function clearShatter() {
    for (const bit of shatterBits) {
      scene.remove(bit.mesh);
    }
    shatterBits.length = 0;
  }

  function resetCup() {
    cup.falling = false;
    cup.broken = false;
    cup.knockedAt = -1;
    cup.group.visible = true;
    cup.group.position.set(desk.cup.x, CUP_PHYSICS.tableY, desk.cup.z);
    cup.group.rotation.set(0, 0, 0);
    setCupBodyFromMeshStatic();
  }

  // Ensure a collider exists from the first frame.
  resetCup();

  return {
    knockCup,
    updateCup,
    updateShatter,
    clearShatter,
    resetCup,
  };
}
