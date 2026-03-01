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
  const { THREE, CANNON, scene, physics, desk, CUP_COLLISION, cup, cat, game, shatterBits, getClockTime } = ctx;
  const tempV3 = new THREE.Vector3();
  const CUP_PHYSICS = {
    mass: 0.22,
    halfR: CUP_COLLISION.radius,
    halfH: 0.21,
    tableY: desk.topY + 0.01,
    breakFloorY: 0.06,
    edgePushDelay: 0.55,
    edgePushStrength: 0.52,
    minKnockSpeed2: 1.8 * 1.8,
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
    body.addShape(new CANNON.Box(new CANNON.Vec3(CUP_PHYSICS.halfR, CUP_PHYSICS.halfH, CUP_PHYSICS.halfR)));
    cup.body = body;
    return body;
  }

  function setCupBodyFromMeshStatic() {
    const body = ensureCupBody();
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
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

  function ensureCupBreaksAfterStrongKnock() {
    if (!cup.falling || cup.broken || !cup.body) return;
    const elapsed = getClockTime() - cup.knockedAt;
    if (elapsed < CUP_PHYSICS.edgePushDelay) return;
    const speed2 =
      cup.body.velocity.x * cup.body.velocity.x +
      cup.body.velocity.y * cup.body.velocity.y +
      cup.body.velocity.z * cup.body.velocity.z;
    if (speed2 >= CUP_PHYSICS.minKnockSpeed2) return;

    const edgeX = desk.pos.x + desk.sizeX * 0.5 - 0.05;
    const edgeZ = desk.pos.z + desk.sizeZ * 0.5 - 0.05;
    const dirX = Math.sign(edgeX - cup.body.position.x) || 1;
    const dirZ = Math.sign(edgeZ - cup.body.position.z) || 1;
    cup.body.applyImpulse(
      new CANNON.Vec3(dirX * CUP_PHYSICS.edgePushStrength, 0.12, dirZ * CUP_PHYSICS.edgePushStrength),
      cup.body.position
    );
  }

  function knockCup() {
    if (cup.falling || cup.broken || !cup.body) return;
    cup.falling = true;
    cup.knockedAt = getClockTime();
    cup.body.type = CANNON.Body.DYNAMIC;
    cup.body.mass = CUP_PHYSICS.mass;
    cup.body.updateMassProperties();
    cup.body.wakeUp();
    tempV3.copy(cup.group.position).sub(cat.group.position);
    tempV3.y = 0;
    if (tempV3.lengthSq() < 0.0001) tempV3.set(1, 0, 0);
    tempV3.normalize();
    cup.body.velocity.set(tempV3.x * 0.68, 0.5, tempV3.z * 0.65);
    cup.body.angularVelocity.set(-tempV3.z * 2.1, 0.35, tempV3.x * 2.1);
    cup.body.applyImpulse(new CANNON.Vec3(tempV3.x * 0.225, 0.105, tempV3.z * 0.225), cup.body.position);
  }

  function updateCup(dt) {
    if (!cup.body) return;
    if (!cup.falling || cup.broken) return;

    ensureCupBreaksAfterStrongKnock();
    syncCupMeshFromBody();

    if (cup.group.position.y <= CUP_PHYSICS.breakFloorY) {
      cup.group.position.y = CUP_PHYSICS.breakFloorY;
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
        game.reason = "The glass cup hit the floor.";
      }
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
