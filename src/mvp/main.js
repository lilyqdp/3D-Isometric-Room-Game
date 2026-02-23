import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const sortedStatEl = document.getElementById("sortedStat");
const catStateStatEl = document.getElementById("catStateStat");
const cupStatEl = document.getElementById("cupStat");
const catnipStatEl = document.getElementById("catnipStat");
const resultEl = document.getElementById("result");
const catnipBtn = document.getElementById("catnipBtn");
const restartBtn = document.getElementById("restartBtn");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9dce2);

const frustumSize = 18;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  (frustumSize * aspect) / -2,
  (frustumSize * aspect) / 2,
  frustumSize / 2,
  frustumSize / -2,
  0.01,
  100
);
camera.position.set(13, 12, 13);
camera.lookAt(0, 1.5, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableRotate = false;
controls.enablePan = true;
controls.enableZoom = true;
controls.minZoom = 0.8;
controls.maxZoom = 3.5;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};
controls.target.set(-1.2, 1.4, -1.2);
camera.zoom = 1.2;
camera.updateProjectionMatrix();

const hemi = new THREE.HemisphereLight(0xf5f7fb, 0x8792a1, 0.95);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(9, 12, 6);
scene.add(sun);

const ROOM = {
  minX: -8.0,
  maxX: 6.0,
  minZ: -6.0,
  maxZ: 4.0,
  floorY: 0.0,
};

const desk = {
  pos: new THREE.Vector3(-4.15, 0, -3.9),
  sizeX: 3.1,
  sizeZ: 1.8,
  topY: 1.08,
  approach: new THREE.Vector3(-2.55, 0, -3.1),
  perch: new THREE.Vector3(-3.65, 0, -3.6),
  cup: new THREE.Vector3(-3.6, 0, -3.7),
};

const hamper = {
  pos: new THREE.Vector3(-5.8, 0, 2.4),
  halfX: 0.45,
  halfZ: 0.45,
};

const trashCan = {
  pos: new THREE.Vector3(2.6, 0, 2.4),
  radius: 0.35,
};

const game = {
  state: "playing", // playing | lost | won
  reason: "",
  sorted: 0,
  total: 0,
  nextKnockAt: 12,
  pendingLoseAt: null,
  catnip: null, // {mesh,pos,expiresAt}
  catnipCooldownUntil: 0,
  placeCatnipMode: false,
};

const pickups = [];
const shatterBits = [];
let dragState = null;
let clockTime = 0;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tempV3 = new THREE.Vector3();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const cat = buildCat();
scene.add(cat.group);

const cup = makeCup();
scene.add(cup.group);

makeRoomCorner();
makeDesk();
makeBins();
addFixedPickups();
resetGame();

catnipBtn.addEventListener("click", () => {
  if (game.state !== "playing") return;
  if (clockTime < game.catnipCooldownUntil) return;
  game.placeCatnipMode = true;
});

restartBtn.addEventListener("click", () => {
  resetGame();
});

renderer.domElement.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

const TARGET_BOUNDS = {
  minX: -5.2,
  maxX: 1.5,
  minZ: -4.9,
  maxZ: 1.7,
  minY: 0.8,
  maxY: 3.2,
};

const clock = new THREE.Clock();
animate();

window.addEventListener("resize", () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = (frustumSize * aspect) / -2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = frustumSize / -2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

function makeRoomCorner() {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.2, 10),
    new THREE.MeshStandardMaterial({ color: 0xbcc3ce, roughness: 0.95 })
  );
  floor.position.set(-1, -0.1, -1);
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x7f8690, roughness: 0.98 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(14, 4.2, 0.2), wallMat);
  backWall.position.set(-1, 2.0, -6);
  scene.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.2, 10), wallMat);
  leftWall.position.set(-8, 2.0, -1);
  scene.add(leftWall);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x6f7680, roughness: 0.86 });
  const backTrim = new THREE.Mesh(new THREE.BoxGeometry(14, 0.14, 0.14), trimMat);
  backTrim.position.set(-1, 0.07, -5.88);
  scene.add(backTrim);

  const leftTrim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 10), trimMat);
  leftTrim.position.set(-7.88, 0.07, -1);
  scene.add(leftTrim);
}

function makeDesk() {
  const topMat = new THREE.MeshStandardMaterial({ color: 0x5f5347, roughness: 0.76 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x433a33, roughness: 0.8 });

  const top = new THREE.Mesh(new THREE.BoxGeometry(desk.sizeX, 0.12, desk.sizeZ), topMat);
  top.position.set(desk.pos.x, 1.02, desk.pos.z);
  scene.add(top);

  const legGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  const legOffsets = [
    [-1.45, -0.8],
    [1.45, -0.8],
    [-1.45, 0.8],
    [1.45, 0.8],
  ];
  for (const [dx, dz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(desk.pos.x + dx, 0.5, desk.pos.z + dz);
    scene.add(leg);
  }
}

function makeBins() {
  const hamperMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.95, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x4c84bc, roughness: 0.85 })
  );
  hamperMesh.position.set(hamper.pos.x, 0.48, hamper.pos.z);
  scene.add(hamperMesh);

  const trashCanMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.29, 0.7, 20),
    new THREE.MeshStandardMaterial({ color: 0xb66d3a, roughness: 0.8 })
  );
  trashCanMesh.position.set(trashCan.pos.x, 0.35, trashCan.pos.z);
  scene.add(trashCanMesh);
}

function addFixedPickups() {
  addPickup("laundry", -2.8, 0.6);
  addPickup("laundry", -1.5, 1.3);
  addPickup("trash", -0.2, 0.3);
  addPickup("trash", 1.0, 0.9);
  game.total = pickups.length;
}

function addPickup(type, x, z) {
  let mesh;
  if (type === "laundry") {
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.08, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xc7cfdb, roughness: 0.95 })
    );
  } else {
    mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.93 })
    );
  }
  mesh.position.set(x, 0.08, z);
  mesh.rotation.y = Math.random() * Math.PI;
  scene.add(mesh);
  pickups.push({
    mesh,
    type,
    home: new THREE.Vector3(x, 0.08, z),
    pulseSeed: Math.random() * 6.28,
  });
}

function makeCup() {
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
    new THREE.CylinderGeometry(0.1, 0.11, 0.27, 14),
    new THREE.MeshStandardMaterial({
      color: 0x7ab9ff,
      transparent: true,
      opacity: 0.45,
      roughness: 0.2,
    })
  );
  water.position.y = 0.14;
  group.add(water);

  return {
    group,
    falling: false,
    broken: false,
    vel: new THREE.Vector3(),
  };
}

function buildCat() {
  const group = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x8f7c69, roughness: 0.92 });
  const furDark = new THREE.MeshStandardMaterial({ color: 0x756555, roughness: 0.95 });
  const pawMat = new THREE.MeshStandardMaterial({ color: 0xd9c8b6, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.95), fur);
  body.position.set(0, 0.24, 0);
  group.add(body);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.19, 0.36), furDark);
  chest.position.set(0, 0.27, 0.44);
  group.add(chest);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.22, 0.26), fur);
  head.position.set(0, 0.36, 0.58);
  group.add(head);

  const leftEar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.06), furDark);
  leftEar.position.set(-0.11, 0.49, 0.65);
  group.add(leftEar);
  const rightEar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.06), furDark);
  rightEar.position.set(0.11, 0.49, 0.65);
  group.add(rightEar);

  const legGeo = new THREE.BoxGeometry(0.1, 0.22, 0.1);
  const legs = [];
  const legOffsets = [
    [-0.16, 0.12, 0.31],
    [0.16, 0.12, 0.31],
    [-0.16, 0.12, -0.29],
    [0.16, 0.12, -0.29],
  ];
  for (const [x, y, z] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, pawMat);
    leg.position.set(x, y, z);
    group.add(leg);
    legs.push(leg);
  }

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.44), furDark);
  tail.position.set(0, 0.35, -0.62);
  group.add(tail);

  const paw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.16), pawMat);
  paw.position.set(0.21, 0.25, 0.42);
  group.add(paw);

  const waypoints = [
    new THREE.Vector3(1.5, 0, 1.7),
    new THREE.Vector3(0.7, 0, -0.8),
    new THREE.Vector3(-1.4, 0, -2.4),
    new THREE.Vector3(-3.2, 0, -0.8),
    new THREE.Vector3(-5.2, 0, 1.3),
    new THREE.Vector3(-2.0, 0, 1.9),
  ];

  return {
    group,
    body,
    tail,
    legs,
    paw,
    pos: new THREE.Vector3(1.5, 0, 1.7),
    state: "patrol", // patrol|toDesk|jumpUp|toCup|swipe|jumpDown|toCatnip|distracted
    status: "Patrolling",
    onTable: false,
    speed: 1.0,
    wpIndex: 0,
    walkT: 0,
    phaseT: 0,
    jump: null, // {from,to,fromY,toY,dur,t,arc,next}
    waypoints,
  };
}

function resetGame() {
  game.state = "playing";
  game.reason = "";
  game.sorted = 0;
  game.nextKnockAt = 12;
  game.pendingLoseAt = null;
  game.placeCatnipMode = false;
  game.catnipCooldownUntil = 0;
  if (game.catnip) {
    scene.remove(game.catnip.mesh);
    game.catnip = null;
  }

  cup.group.visible = true;
  cup.group.position.set(desk.cup.x, desk.topY + 0.01, desk.cup.z);
  cup.group.rotation.set(0, 0, 0);
  cup.falling = false;
  cup.broken = false;
  cup.vel.set(0, 0, 0);

  for (const bit of shatterBits) scene.remove(bit.mesh);
  shatterBits.length = 0;

  for (const p of pickups) scene.remove(p.mesh);
  pickups.length = 0;
  addFixedPickups();
  game.total = pickups.length;

  cat.pos.set(1.5, 0, 1.7);
  cat.group.position.set(cat.pos.x, 0, cat.pos.z);
  cat.group.rotation.set(0, 2.4, 0);
  cat.state = "patrol";
  cat.status = "Patrolling";
  cat.onTable = false;
  cat.wpIndex = 0;
  cat.walkT = 0;
  cat.phaseT = 0;
  cat.jump = null;
}

function onPointerDown(event) {
  if (game.state !== "playing") return;
  setMouseFromEvent(event);

  if (game.placeCatnipMode) {
    placeCatnipFromMouse();
    return;
  }

  const pickupMeshes = pickups.map((p) => p.mesh);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(pickupMeshes, false);
  if (!hits.length) return;

  const mesh = hits[0].object;
  const pickup = pickups.find((p) => p.mesh === mesh);
  if (!pickup) return;

  const planeY = 0.08;
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  if (!raycaster.ray.intersectPlane(dragPlane, tempV3)) return;

  dragState = {
    pickup,
    planeY,
    offsetX: mesh.position.x - tempV3.x,
    offsetZ: mesh.position.z - tempV3.z,
  };
  controls.enabled = false;
}

function onPointerMove(event) {
  if (!dragState) return;
  setMouseFromEvent(event);
  raycaster.setFromCamera(mouse, camera);
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragState.planeY);
  if (!raycaster.ray.intersectPlane(dragPlane, tempV3)) return;
  const x = tempV3.x + dragState.offsetX;
  const z = tempV3.z + dragState.offsetZ;
  dragState.pickup.mesh.position.x = THREE.MathUtils.clamp(x, ROOM.minX + 0.35, ROOM.maxX - 0.35);
  dragState.pickup.mesh.position.z = THREE.MathUtils.clamp(z, ROOM.minZ + 0.35, ROOM.maxZ - 0.35);
  dragState.pickup.mesh.position.y = 0.12;
}

function onPointerUp() {
  if (!dragState) return;
  const p = dragState.pickup;
  const pos = p.mesh.position;
  const inHamper = Math.abs(pos.x - hamper.pos.x) <= hamper.halfX && Math.abs(pos.z - hamper.pos.z) <= hamper.halfZ;
  const inTrashCan = pos.distanceTo(trashCan.pos) <= trashCan.radius + 0.05;

  if (p.type === "laundry" && inHamper) {
    removePickup(p);
  } else if (p.type === "trash" && inTrashCan) {
    removePickup(p);
  } else if ((p.type === "laundry" && inTrashCan) || (p.type === "trash" && inHamper)) {
    // Wrong bin: snap back to original spawn.
    p.mesh.position.copy(p.home);
  } else {
    p.mesh.position.y = 0.08;
  }

  dragState = null;
  controls.enabled = true;
}

function removePickup(pickup) {
  scene.remove(pickup.mesh);
  const idx = pickups.indexOf(pickup);
  if (idx !== -1) pickups.splice(idx, 1);
  game.sorted++;
  if (game.sorted >= game.total) win();
}

function setMouseFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function placeCatnipFromMouse() {
  if (clockTime < game.catnipCooldownUntil) return;
  raycaster.setFromCamera(mouse, camera);
  if (!raycaster.ray.intersectPlane(floorPlane, tempV3)) return;

  const x = THREE.MathUtils.clamp(tempV3.x, ROOM.minX + 0.6, ROOM.maxX - 0.6);
  const z = THREE.MathUtils.clamp(tempV3.z, ROOM.minZ + 0.6, ROOM.maxZ - 0.6);

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
  game.catnipCooldownUntil = clockTime + 30;
  game.placeCatnipMode = false;
}

function updatePickups(dt) {
  if (dragState) return;
  for (const p of pickups) {
    p.mesh.rotation.y += dt * 0.9;
    p.mesh.position.y = 0.08 + Math.sin(clockTime * 2.0 + p.pulseSeed) * 0.01;
  }
}

function startJump(to, toY, dur, arc, nextState) {
  cat.jump = {
    from: cat.pos.clone(),
    to: to.clone(),
    fromY: cat.group.position.y,
    toY,
    dur,
    t: 0,
    arc,
    nextState,
  };
}

function updateJump(dt) {
  if (!cat.jump) return false;
  cat.jump.t += dt;
  const u = Math.min(1, cat.jump.t / cat.jump.dur);
  cat.pos.lerpVectors(cat.jump.from, cat.jump.to, u);
  const lift = Math.sin(Math.PI * u) * cat.jump.arc;
  cat.group.position.set(cat.pos.x, THREE.MathUtils.lerp(cat.jump.fromY, cat.jump.toY, u) + lift, cat.pos.z);
  if (u >= 1) {
    cat.group.position.y = cat.jump.toY;
    const next = cat.jump.nextState;
    cat.jump = null;
    cat.state = next;
    return true;
  }
  return false;
}

function moveCatToward(target, dt, speed, yLevel) {
  const dx = target.x - cat.pos.x;
  const dz = target.z - cat.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.06) {
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    return true;
  }
  const nx = dx / d;
  const nz = dz / d;
  const step = Math.min(d, speed * dt);
  cat.pos.x += nx * step;
  cat.pos.z += nz * step;
  cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
  const yaw = Math.atan2(nx, nz);
  const dy = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
  cat.group.rotation.y += dy * Math.min(1, dt * 9.0);
  return d < 0.14;
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

function updateCup(dt) {
  if (!cup.falling || cup.broken) return;
  cup.vel.y -= 9.4 * dt;
  cup.group.position.addScaledVector(cup.vel, dt);
  cup.group.rotation.x += dt * 6.2;
  cup.group.rotation.z += dt * 5.2;

  if (cup.group.position.y <= 0.06) {
    cup.group.position.y = 0.06;
    cup.falling = false;
    cup.broken = true;
    cup.group.visible = false;
    spawnCupShatter(cup.group.position.x, cup.group.position.z);
    if (game.pendingLoseAt == null) {
      game.pendingLoseAt = clockTime + 1.0;
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

function updateCat(dt) {
  if (game.state !== "playing") return;

  if (game.catnip && clockTime >= game.catnip.expiresAt) {
    scene.remove(game.catnip.mesh);
    game.catnip = null;
    if (cat.state === "toCatnip" || cat.state === "distracted") {
      cat.state = "patrol";
    }
  }

  if (cat.jump) {
    updateJump(dt);
    cat.status = "Jumping";
    animateCatPose(dt, false);
    return;
  }

  // Catnip overrides knock behavior.
  if (game.catnip) {
    if (cat.onTable) {
      cat.onTable = false;
      startJump(desk.approach, 0, 0.55, 0.28, "toCatnip");
      return;
    }
    cat.state = "toCatnip";
    const atCatnip = moveCatToward(game.catnip.pos, dt, 1.0, 0);
    cat.status = atCatnip ? "Distracted" : "Going to catnip";
    animateCatPose(dt, !atCatnip);
    return;
  }

  if ((clockTime >= game.nextKnockAt) && !cup.broken && !cup.falling && cat.state === "patrol") {
    cat.state = "toDesk";
  }

  if (cat.state === "patrol") {
    const target = cat.waypoints[cat.wpIndex];
    const reached = moveCatToward(target, dt, 0.95, 0);
    cat.status = "Patrolling";
    if (reached) cat.wpIndex = (cat.wpIndex + 1) % cat.waypoints.length;
    animateCatPose(dt, true);
    return;
  }

  if (cat.state === "toDesk") {
    const reachedDesk = moveCatToward(desk.approach, dt, 1.0, 0);
    cat.status = "Approaching desk";
    animateCatPose(dt, true);
    if (reachedDesk) {
      cat.onTable = true;
      startJump(desk.perch, desk.topY + 0.02, 0.62, 0.34, "toCup");
    }
    return;
  }

  if (cat.state === "toCup") {
    const target = new THREE.Vector3(desk.cup.x - 0.36, 0, desk.cup.z + 0.02);
    const reachedCup = moveCatToward(target, dt, 0.65, desk.topY + 0.02);
    cat.status = "Stalking cup";
    animateCatPose(dt, true);
    if (reachedCup) {
      cat.state = "swipe";
      cat.phaseT = 0;
    }
    return;
  }

  if (cat.state === "swipe") {
    cat.phaseT += dt;
    cat.status = "Swiping";
    cat.group.position.y = desk.topY + 0.02;
    cat.paw.position.y = 0.28 + Math.min(0.19, cat.phaseT * 0.8);
    if (cat.phaseT > 0.52) {
      knockCup();
      cat.paw.position.y = 0.25;
      cat.state = "jumpDown";
      cat.onTable = false;
      startJump(desk.approach, 0, 0.56, 0.2, "patrol");
      game.nextKnockAt = clockTime + 12;
    }
    animateCatPose(dt, false);
    return;
  }

  if (cat.state === "jumpDown") {
    cat.status = "Jumping down";
    animateCatPose(dt, false);
    return;
  }
}

function animateCatPose(dt, moving) {
  if (moving) {
    cat.walkT += dt * 8.0;
  } else {
    cat.walkT *= Math.max(0, 1 - dt * 8.0);
  }
  const swing = Math.sin(cat.walkT) * (moving ? 0.06 : 0);
  cat.legs[0].position.z = 0.31 + swing;
  cat.legs[1].position.z = 0.31 - swing;
  cat.legs[2].position.z = -0.29 - swing;
  cat.legs[3].position.z = -0.29 + swing;
  cat.tail.rotation.x = Math.sin(clockTime * 3.0) * 0.3;
}

function lose(reason) {
  if (game.state !== "playing") return;
  game.state = "lost";
  game.reason = reason;
}

function win() {
  if (game.state !== "playing") return;
  game.state = "won";
}

function updateUI() {
  sortedStatEl.textContent = `${game.sorted} / ${game.total}`;
  catStateStatEl.textContent = cat.status;

  if (cup.broken) cupStatEl.textContent = "Broken";
  else if (cup.falling) cupStatEl.textContent = "Falling";
  else cupStatEl.textContent = "On desk";

  if (game.placeCatnipMode) {
    catnipStatEl.textContent = "Click floor to place";
  } else if (game.catnip) {
    catnipStatEl.textContent = `Active (${Math.max(0, Math.ceil(game.catnip.expiresAt - clockTime))}s)`;
  } else if (clockTime < game.catnipCooldownUntil) {
    catnipStatEl.textContent = `Cooldown (${Math.ceil(game.catnipCooldownUntil - clockTime)}s)`;
  } else {
    catnipStatEl.textContent = "Ready";
  }

  if (game.state === "lost") {
    resultEl.textContent = `You Lost - ${game.reason}`;
    resultEl.style.color = "#ffb3b3";
  } else if (game.state === "won") {
    resultEl.textContent = "You Won - all items sorted before the knock loss.";
    resultEl.style.color = "#b8f5be";
  } else {
    resultEl.textContent = "";
  }
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  clockTime += dt;

  controls.target.x = THREE.MathUtils.clamp(controls.target.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);

  if (game.state === "playing") {
    updatePickups(dt);
    updateCat(dt);
    updateCup(dt);
    updateShatter(dt);
    if (game.pendingLoseAt != null && clockTime >= game.pendingLoseAt) {
      lose(game.reason || "A desk item hit the floor.");
      game.pendingLoseAt = null;
    }
  }

  controls.update();
  updateUI();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
