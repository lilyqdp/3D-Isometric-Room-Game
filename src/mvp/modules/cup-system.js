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
    vel: new THREE.Vector3(),
    falling: false,
    broken: false,
  };
}

export function createCupRuntime(ctx) {
  const { THREE, scene, desk, DESK_LEGS, CUP_COLLISION, cup, cat, game, shatterBits, getClockTime } = ctx;
  const tempV3 = new THREE.Vector3();

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

  function resolveCupDeskCollision() {
    if (cup.broken) return;
    const p = cup.group.position;
    const v = cup.vel;
    const r = CUP_COLLISION.radius;

    const topHalfX = desk.sizeX * 0.5 - 0.06;
    const topHalfZ = desk.sizeZ * 0.5 - 0.06;
    const inTopX = Math.abs(p.x - desk.pos.x) <= topHalfX;
    const inTopZ = Math.abs(p.z - desk.pos.z) <= topHalfZ;
    if (inTopX && inTopZ && p.y < CUP_COLLISION.topY && v.y < 0) {
      p.y = CUP_COLLISION.topY;
      v.y = Math.max(0, -v.y * 0.14);
      v.x *= 0.92;
      v.z *= 0.92;
    }

    for (const leg of DESK_LEGS) {
      if (p.y > leg.topY + 0.16 || p.y < 0.02) continue;
      const dx = p.x - leg.x;
      const dz = p.z - leg.z;
      const limX = leg.halfX + r;
      const limZ = leg.halfZ + r;
      if (Math.abs(dx) >= limX || Math.abs(dz) >= limZ) continue;
      const penX = limX - Math.abs(dx);
      const penZ = limZ - Math.abs(dz);
      if (penX < penZ) {
        const sx = Math.sign(dx || 1);
        p.x = leg.x + sx * limX;
        v.x = Math.abs(v.x) * sx * 0.55;
        v.z *= 0.84;
      } else {
        const sz = Math.sign(dz || 1);
        p.z = leg.z + sz * limZ;
        v.z = Math.abs(v.z) * sz * 0.55;
        v.x *= 0.84;
      }
      v.y = Math.max(v.y, 0.12);
    }
  }

  function knockCup() {
    if (cup.falling || cup.broken) return;
    cup.falling = true;
    tempV3.copy(cup.group.position).sub(cat.group.position);
    tempV3.y = 0;
    if (tempV3.lengthSq() < 0.0001) tempV3.set(1, 0, 0);
    tempV3.normalize();
    cup.vel.set(tempV3.x * 2.2, 1.55, tempV3.z * 2.1);
  }

  function updateCup(dt) {
    if (!cup.falling || cup.broken) return;
    cup.vel.y -= 9.4 * dt;
    cup.group.position.addScaledVector(cup.vel, dt);
    cup.group.rotation.x += dt * 6.2;
    cup.group.rotation.z += dt * 5.2;
    resolveCupDeskCollision();

    if (cup.group.position.y <= 0.06) {
      cup.group.position.y = 0.06;
      cup.falling = false;
      cup.broken = true;
      cup.group.visible = false;
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

  return {
    knockCup,
    updateCup,
    updateShatter,
    clearShatter,
  };
}
