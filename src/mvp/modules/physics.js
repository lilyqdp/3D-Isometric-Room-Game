export function setupPhysicsWorld({
  CANNON,
  physics,
  DESK_LEGS,
  ROOM,
  desk,
  hamper,
  trashCan,
  bed,
  wardrobe,
  bookcase,
  bedsideTable,
  EXTRA_STATIC_BOXES = [],
}) {
  const world = physics.world;
  physics.staticBoxes = [];
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 30;
  world.solver.tolerance = 0.001;
  world.gravity.set(0, -9.8, 0);

  const floorMat = new CANNON.Material("floor");
  const laundryMat = new CANNON.Material("laundry");
  const paperMat = new CANNON.Material("paper");
  const shellMat = new CANNON.Material("shell");
  const rimMat = new CANNON.Material("rim");
  physics.materials = { floorMat, laundryMat, paperMat, shellMat, rimMat };
  world.defaultContactMaterial = new CANNON.ContactMaterial(shellMat, shellMat, {
    friction: 0.5,
    restitution: 0.06,
  });

  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, floorMat, { friction: 0.9, restitution: 0.02 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, shellMat, { friction: 0.94, restitution: 0.02 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, rimMat, { friction: 0.88, restitution: 0.05 }));
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, floorMat, { friction: 0.28, restitution: 0.16 }));
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, shellMat, { friction: 0.26, restitution: 0.09 }));
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, rimMat, { friction: 0.22, restitution: 0.12 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, paperMat, { friction: 0.55, restitution: 0.08 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, laundryMat, { friction: 0.78, restitution: 0.03 }));
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, paperMat, { friction: 0.34, restitution: 0.1 }));

  const addStaticBox = (x, y, z, hx, hy, hz, rotY = 0, material = shellMat) => {
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, mass: 0, material });
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    b.position.set(x, y, z);
    if (rotY !== 0) b.quaternion.setFromEuler(0, rotY, 0);
    world.addBody(b);
    physics.staticBoxes.push({ x, y, z, hx, hy, hz, rotY });
  };

  // Floor at plank surface height
  const floorCX = (ROOM.minX + ROOM.maxX) * 0.5;
  const floorCZ = (ROOM.minZ + ROOM.maxZ) * 0.5;
  const floorHX = (ROOM.maxX - ROOM.minX) * 0.5;
  const floorHZ = (ROOM.maxZ - ROOM.minZ) * 0.5;
  addStaticBox(floorCX, 0.055, floorCZ, floorHX, 0.055, floorHZ, 0, floorMat);

  // Walls
  const wallH = 1.6;
  addStaticBox(ROOM.minX - 0.03, wallH, floorCZ, 0.03, wallH, floorHZ);
  addStaticBox(ROOM.maxX + 0.03, wallH, floorCZ, 0.03, wallH, floorHZ);
  addStaticBox(floorCX, wallH, ROOM.minZ - 0.03, floorHX, wallH, 0.03);
  addStaticBox(floorCX, wallH, ROOM.maxZ + 0.03, floorHX, wallH, 0.03);

  // Desk
  for (const leg of DESK_LEGS) {
    addStaticBox(leg.x, 0.5, leg.z, leg.halfX, 0.5, leg.halfZ);
  }
  addStaticBox(desk.pos.x, 1.02, desk.pos.z, desk.sizeX * 0.5, 0.06, desk.sizeZ * 0.5, 0, shellMat);

  // Bed
  if (bed) {
    const bedW = (bed.width || 2.0) * 0.5;
    const bedD = (bed.depth || 3.4) * 0.5;
    addStaticBox(bed.pos.x, 0.4, bed.pos.z, bedW, 0.02, bedD, 0, shellMat);
    addStaticBox(bed.pos.x, 0.2, bed.pos.z, bedW, 0.2, bedD, 0, shellMat);
  }

  // Wardrobe
  if (wardrobe) {
    const ww = (wardrobe.width || 1.7) * 0.5;
    const wd = (wardrobe.depth || 0.55) * 0.5;
    const wh = (wardrobe.height || 2.2) * 0.5;
    addStaticBox(wardrobe.pos.x, wh, wardrobe.pos.z, ww, wh, wd, (wardrobe.rotQuarterTurns || 0) * Math.PI * 0.5, shellMat);
  }

  // Bookcase
  if (bookcase) {
    const bw = (bookcase.width || 1.1) * 0.5;
    const bd = (bookcase.depth || 0.38) * 0.5;
    const bh = (bookcase.height || 1.8) * 0.5;
    addStaticBox(bookcase.pos.x, bh, bookcase.pos.z, bw, bh, bd, 0, shellMat);
  }

  // Bedside table
  if (bedsideTable) {
    addStaticBox(bedsideTable.pos.x, 0.32, bedsideTable.pos.z, 0.29, 0.32, 0.24, 0, shellMat);
  }

  // Hamper
  addStaticBox(hamper.pos.x, hamper.rimY * 0.5, hamper.pos.z + hamper.outerHalfZ, hamper.outerHalfX, hamper.rimY * 0.5, 0.03);
  addStaticBox(hamper.pos.x, hamper.rimY * 0.5, hamper.pos.z - hamper.outerHalfZ, hamper.outerHalfX, hamper.rimY * 0.5, 0.03);
  addStaticBox(hamper.pos.x + hamper.outerHalfX, hamper.rimY * 0.5, hamper.pos.z, 0.03, hamper.rimY * 0.5, hamper.outerHalfZ);
  addStaticBox(hamper.pos.x - hamper.outerHalfX, hamper.rimY * 0.5, hamper.pos.z, 0.03, hamper.rimY * 0.5, hamper.outerHalfZ);
  addStaticBox(hamper.pos.x, hamper.rimY + 0.02, hamper.pos.z + hamper.outerHalfZ, hamper.outerHalfX + 0.02, 0.02, 0.03, 0, rimMat);
  addStaticBox(hamper.pos.x, hamper.rimY + 0.02, hamper.pos.z - hamper.outerHalfZ, hamper.outerHalfX + 0.02, 0.02, 0.03, 0, rimMat);
  addStaticBox(hamper.pos.x + hamper.outerHalfX, hamper.rimY + 0.02, hamper.pos.z, 0.03, 0.02, hamper.outerHalfZ + 0.02, 0, rimMat);
  addStaticBox(hamper.pos.x - hamper.outerHalfX, hamper.rimY + 0.02, hamper.pos.z, 0.03, 0.02, hamper.outerHalfZ + 0.02, 0, rimMat);

  // Trash can
  const segments = 48;
  const halfWallH = trashCan.rimY * 0.5;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const cx = trashCan.pos.x + Math.cos(t) * trashCan.outerRadius;
    const cz = trashCan.pos.z + Math.sin(t) * trashCan.outerRadius;
    addStaticBox(cx, halfWallH, cz, 0.12, halfWallH, 0.055, t, shellMat);
    const rx = trashCan.pos.x + Math.cos(t) * (trashCan.outerRadius + 0.02);
    const rz = trashCan.pos.z + Math.sin(t) * (trashCan.outerRadius + 0.02);
    addStaticBox(rx, trashCan.rimY + 0.015, rz, 0.14, 0.025, 0.06, t, rimMat);
  }

  for (const box of EXTRA_STATIC_BOXES) {
    if (!box) continue;
    addStaticBox(
      box.x,
      box.y,
      box.z,
      box.hx,
      box.hy,
      box.hz,
      box.rotY || 0,
      box.material === "rim" ? rimMat : shellMat
    );
  }
}