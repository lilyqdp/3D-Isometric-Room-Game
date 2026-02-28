import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "./vendor/cannon-es.js";

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

let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(44, aspect, 0.01, 100);
camera.position.set(13.5, 11.5, 13.5);
camera.lookAt(-1.2, 1.4, -1.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableRotate = false;
controls.enablePan = true;
controls.enableZoom = true;
controls.minDistance = 7.5;
controls.maxDistance = 30;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};
controls.target.set(-1.2, 1.4, -1.2);
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
  pos: new THREE.Vector3(-2.4, 0, -2.6),
  sizeX: 3.1,
  sizeZ: 1.8,
  topY: 1.08,
  approach: new THREE.Vector3(-0.8, 0, -1.8),
  perch: new THREE.Vector3(-1.9, 0, -2.3),
  cup: new THREE.Vector3(-1.85, 0, -2.4),
};
const DESK_JUMP_ANCHORS = [
  new THREE.Vector3(desk.pos.x + desk.sizeX * 0.5 + 0.72, 0, desk.pos.z - 0.1),
  new THREE.Vector3(desk.pos.x + desk.sizeX * 0.5 + 0.72, 0, desk.pos.z + 0.55),
  new THREE.Vector3(desk.pos.x - 0.25, 0, desk.pos.z + desk.sizeZ * 0.5 + 0.68),
  new THREE.Vector3(desk.pos.x + 0.55, 0, desk.pos.z + desk.sizeZ * 0.5 + 0.68),
];

const hamper = {
  pos: new THREE.Vector3(-5.8, 0, 2.4),
  outerHalfX: 0.48,
  outerHalfZ: 0.48,
  halfX: 0.45,
  halfZ: 0.45,
  openingHalfX: 0.34,
  openingHalfZ: 0.34,
  rimY: 0.92,
  sinkY: 0.2,
};

const trashCan = {
  pos: new THREE.Vector3(2.6, 0, 2.4),
  outerRadius: 0.52,
  radius: 0.5,
  openingRadius: 0.42,
  rimY: 0.62,
  sinkY: 0.14,
  modelWidthScale: 1.2,
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
  invalidCatnipUntil: 0,
};

const pickups = [];
const shatterBits = [];
let dragState = null;
let dragHover = { binType: null, topEntry: false };
let clockTime = 0;

const binVisuals = {
  hamper: { shells: [], ring: null },
  trash: { shells: [], ring: null },
};

const physics = {
  fixedStep: 1 / 180,
  world: new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) }),
  materials: {},
};

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tempV3 = new THREE.Vector3();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const gltfLoader = new GLTFLoader();
const CAT_MODEL_URL = `${import.meta.env.BASE_URL}mvp/cat.glb`;
const CAT_MODEL_YAW_OFFSET = Math.PI * 0.5;
const CAT_MODEL_CANDIDATES = Array.from(
  new Set([CAT_MODEL_URL, "/mvp/cat.glb", `${import.meta.env.BASE_URL}public/mvp/cat.glb`, "/public/mvp/cat.glb"])
);
const TRASH_CAN_MODEL_URL = `${import.meta.env.BASE_URL}mvp/trash_can.glb`;
const TRASH_CAN_MODEL_CANDIDATES = Array.from(
  new Set([
    TRASH_CAN_MODEL_URL,
    "/mvp/trash_can.glb",
    `${import.meta.env.BASE_URL}public/mvp/trash_can.glb`,
    "/public/mvp/trash_can.glb",
  ])
);
const tempBox = new THREE.Box3();
const tempSize = new THREE.Vector3();
const tempCenter = new THREE.Vector3();
const tempMin = new THREE.Vector3();
const tempQ = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempFrom = new THREE.Vector3();
const tempTo = new THREE.Vector3();

const CAT_NAV = {
  step: 0.26,
  margin: 0.4,
  clearance: 0.2,
  repathInterval: 0.4,
  stuckSpeed: 0.035,
  stuckReset: 2.8,
  maxTurnRate: 2.5, // rad/sec
  turnSlowThreshold: 0.65,
  turnStopThreshold: 1.35,
  localLookAhead: 0.56,
  steerSwitchPenalty: 0.36,
  steerFacingPenalty: 0.58,
  unstuckCheckInterval: 0.1,
  unstuckMinMove: 0.02,
};

const CAT_COLLISION = {
  catBodyRadius: 0.26,
  pickupRadiusBoost: 0.1,
  pickupClearance: 0.1,
  cupBodyClearance: 0.34,
};

const CUP_COLLISION = {
  radius: 0.11,
  topY: desk.topY + 0.015,
};

const SWIPE_TIMING = {
  windup: 0.62,
  strike: 0.22,
  recover: 0.58,
};
const JUMP_UP_TIME_SCALE = 2.0;
const JUMP_UP_TIMING = {
  prepare: 0.42 * JUMP_UP_TIME_SCALE,
  launch: 0.36 * JUMP_UP_TIME_SCALE,
  hook: 0.22 * JUMP_UP_TIME_SCALE,
  pull: 0.34 * JUMP_UP_TIME_SCALE,
  settle: 0.24 * JUMP_UP_TIME_SCALE,
};

const cat = buildCat();
scene.add(cat.group);
loadCatModel(cat);

const cup = makeCup();
scene.add(cup.group);

makeRoomCorner();
makeDesk();
makeBins();

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

const DESK_LEGS = [
  { x: desk.pos.x - 1.45, z: desk.pos.z - 0.8, halfX: 0.1, halfZ: 0.1, topY: 1.02 },
  { x: desk.pos.x + 1.45, z: desk.pos.z - 0.8, halfX: 0.1, halfZ: 0.1, topY: 1.02 },
  { x: desk.pos.x - 1.45, z: desk.pos.z + 0.8, halfX: 0.1, halfZ: 0.1, topY: 1.02 },
  { x: desk.pos.x + 1.45, z: desk.pos.z + 0.8, halfX: 0.1, halfZ: 0.1, topY: 1.02 },
];

setupPhysicsWorld();
resetGame();

const clock = new THREE.Clock();
animate();

window.addEventListener("resize", () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
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
  // Hamper: open basket + visible laundry so it's clearly the laundry bin.
  const hamperWallMat = new THREE.MeshStandardMaterial({ color: 0x5b9bd2, roughness: 0.84 });
  const hamperTrimMat = new THREE.MeshStandardMaterial({ color: 0xd5ecff, roughness: 0.56 });
  const hamperClothMat = new THREE.MeshStandardMaterial({ color: 0xe8eff8, roughness: 0.95 });

  const hamperGroup = new THREE.Group();
  hamperGroup.position.set(hamper.pos.x, 0, hamper.pos.z);

  const wallThick = 0.06;
  const wallH = 0.88;
  const xSpan = hamper.outerHalfX * 2;
  const zSpan = hamper.outerHalfZ * 2;
  const walls = [
    new THREE.Mesh(new THREE.BoxGeometry(xSpan, wallH, wallThick), hamperWallMat),
    new THREE.Mesh(new THREE.BoxGeometry(xSpan, wallH, wallThick), hamperWallMat),
    new THREE.Mesh(new THREE.BoxGeometry(wallThick, wallH, zSpan), hamperWallMat),
    new THREE.Mesh(new THREE.BoxGeometry(wallThick, wallH, zSpan), hamperWallMat),
  ];
  walls[0].position.set(0, wallH * 0.5, hamper.outerHalfZ);
  walls[1].position.set(0, wallH * 0.5, -hamper.outerHalfZ);
  walls[2].position.set(hamper.outerHalfX, wallH * 0.5, 0);
  walls[3].position.set(-hamper.outerHalfX, wallH * 0.5, 0);
  for (const w of walls) hamperGroup.add(w);

  const rimBars = [
    new THREE.Mesh(new THREE.BoxGeometry(xSpan + 0.08, 0.05, 0.05), hamperTrimMat),
    new THREE.Mesh(new THREE.BoxGeometry(xSpan + 0.08, 0.05, 0.05), hamperTrimMat),
    new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zSpan + 0.08), hamperTrimMat),
    new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zSpan + 0.08), hamperTrimMat),
  ];
  rimBars[0].position.set(0, hamper.rimY, hamper.outerHalfZ + 0.02);
  rimBars[1].position.set(0, hamper.rimY, -hamper.outerHalfZ - 0.02);
  rimBars[2].position.set(hamper.outerHalfX + 0.02, hamper.rimY, 0);
  rimBars[3].position.set(-hamper.outerHalfX - 0.02, hamper.rimY, 0);
  for (const bar of rimBars) hamperGroup.add(bar);

  for (let i = -1; i <= 1; i++) {
    const vent = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.24, 0.03),
      hamperTrimMat
    );
    vent.position.set(i * 0.2, 0.28, hamper.outerHalfZ + 0.04);
    hamperGroup.add(vent);
  }

  const hamperInside = new THREE.Mesh(
    new THREE.BoxGeometry(xSpan - 0.08, 0.48, zSpan - 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8ea6b9, roughness: 0.98, side: THREE.BackSide })
  );
  hamperInside.position.set(0, 0.29, 0);
  hamperGroup.add(hamperInside);

  // Laundry visible inside hamper, kept lower so top opening stays clear.
  const laundryA = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.13, 0.4), hamperClothMat);
  laundryA.position.set(-0.04, 0.56, 0.02);
  laundryA.rotation.z = -0.14;
  hamperGroup.add(laundryA);
  const laundryB = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.3), hamperClothMat);
  laundryB.position.set(0.09, 0.62, -0.04);
  laundryB.rotation.z = 0.11;
  laundryB.rotation.x = 0.08;
  hamperGroup.add(laundryB);

  // Opening helper ring.
  const hamperRing = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.43, 30),
    new THREE.MeshBasicMaterial({ color: 0x77c9ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide })
  );
  hamperRing.rotation.x = -Math.PI / 2;
  hamperRing.position.set(0, hamper.rimY + 0.03, 0);
  hamperGroup.add(hamperRing);

  scene.add(hamperGroup);
  binVisuals.hamper.shells = walls.concat(rimBars);
  binVisuals.hamper.ring = hamperRing;

  // Trash can with visible opening.
  const trashShellMat = new THREE.MeshStandardMaterial({
    color: 0x5b646f,
    roughness: 0.7,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const trashRimMat = new THREE.MeshStandardMaterial({ color: 0xb5bec7, roughness: 0.62 });
  const trashInsideMat = new THREE.MeshStandardMaterial({ color: 0x2f333b, roughness: 1.0 });

  const trashGroup = new THREE.Group();
  trashGroup.position.set(trashCan.pos.x, 0, trashCan.pos.z);
  const trashBodyHeight = trashCan.rimY + 0.08;
  const trashInsideHeight = Math.max(0.36, trashCan.rimY - 0.12);

  const trashBody = new THREE.Mesh(
    new THREE.CylinderGeometry(
      trashCan.outerRadius,
      trashCan.outerRadius - 0.08,
      trashBodyHeight,
      30,
      1,
      true
    ),
    trashShellMat
  );
  trashBody.position.y = trashBodyHeight * 0.5;
  trashGroup.add(trashBody);

  const trashBottom = new THREE.Mesh(
    new THREE.CircleGeometry(trashCan.outerRadius - 0.1, 28),
    new THREE.MeshStandardMaterial({ color: 0x3b434d, roughness: 0.9 })
  );
  trashBottom.rotation.x = -Math.PI / 2;
  trashBottom.position.y = 0.01;
  trashGroup.add(trashBottom);

  const trashRim = new THREE.Mesh(
    new THREE.TorusGeometry(trashCan.outerRadius + 0.03, 0.02, 12, 32),
    trashRimMat
  );
  trashRim.rotation.x = Math.PI / 2;
  trashRim.position.y = trashCan.rimY + 0.012;
  trashGroup.add(trashRim);

  const trashInside = new THREE.Mesh(
    new THREE.CylinderGeometry(
      trashCan.openingRadius - 0.03,
      trashCan.openingRadius - 0.08,
      trashInsideHeight,
      24,
      1,
      true
    ),
    trashInsideMat
  );
  trashInside.position.y = trashInsideHeight * 0.5 + 0.03;
  trashGroup.add(trashInside);

  const trashRing = new THREE.Mesh(
    new THREE.RingGeometry(trashCan.openingRadius - 0.07, trashCan.openingRadius + 0.09, 30),
    new THREE.MeshBasicMaterial({ color: 0xffd3a9, transparent: true, opacity: 0.0, side: THREE.DoubleSide })
  );
  trashRing.rotation.x = -Math.PI / 2;
  trashRing.position.set(0, trashCan.rimY + 0.035, 0);
  trashGroup.add(trashRing);

  const trashFallbackMeshes = [trashBody, trashBottom, trashRim, trashInside];
  loadTrashCanModel(trashGroup, trashFallbackMeshes);

  scene.add(trashGroup);
  binVisuals.trash.shells = [trashBody, trashRim];
  binVisuals.trash.ring = trashRing;

}

function loadTrashCanModel(trashGroup, fallbackMeshes) {
  const tryLoad = (idx) => {
    if (idx >= TRASH_CAN_MODEL_CANDIDATES.length) {
      console.warn("Failed to load trash can model from all paths:", TRASH_CAN_MODEL_CANDIDATES);
      return;
    }

    const url = TRASH_CAN_MODEL_CANDIDATES[idx];
    gltfLoader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((node) => {
          if (!node.isMesh) return;
          node.castShadow = false;
          node.receiveShadow = false;
          if (Array.isArray(node.material)) {
            for (const mat of node.material) {
              if (mat && "side" in mat) mat.side = THREE.DoubleSide;
            }
          } else if (node.material && "side" in node.material) {
            node.material.side = THREE.DoubleSide;
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) return;
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        const min = new THREE.Vector3();
        box.getSize(size);
        const targetHeight = trashCan.rimY + 0.08;
        const s = targetHeight / Math.max(size.y, 0.001);
        model.scale.multiplyScalar(s);
        if (trashCan.modelWidthScale && trashCan.modelWidthScale !== 1) {
          model.scale.x *= trashCan.modelWidthScale;
          model.scale.z *= trashCan.modelWidthScale;
        }

        box.setFromObject(model);
        box.getCenter(center);
        min.copy(box.min);
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= min.y;

        for (const m of fallbackMeshes) m.visible = false;
        trashGroup.add(model);
      },
      undefined,
      (error) => {
        console.warn("Failed to load trash can model path:", url, error);
        tryLoad(idx + 1);
      }
    );
  };

  tryLoad(0);
}

function setupPhysicsWorld() {
  const world = physics.world;
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

  // Laundry feels heavy/soft.
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, floorMat, { friction: 0.9, restitution: 0.02 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, shellMat, { friction: 0.94, restitution: 0.02 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, rimMat, { friction: 0.88, restitution: 0.05 }));
  // Paper feels light but should settle cleanly into bins instead of pinging around rims.
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, floorMat, { friction: 0.28, restitution: 0.16 }));
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, shellMat, { friction: 0.26, restitution: 0.09 }));
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, rimMat, { friction: 0.22, restitution: 0.12 }));
  // Item-item contacts.
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, paperMat, { friction: 0.55, restitution: 0.08 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laundryMat, laundryMat, { friction: 0.78, restitution: 0.03 }));
  world.addContactMaterial(new CANNON.ContactMaterial(paperMat, paperMat, { friction: 0.34, restitution: 0.1 }));

  const addStaticBox = (x, y, z, hx, hy, hz, rotY = 0, material = shellMat) => {
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, mass: 0, material });
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    b.position.set(x, y, z);
    if (rotY !== 0) b.quaternion.setFromEuler(0, rotY, 0);
    world.addBody(b);
  };

  // Floor and soft containment bounds.
  addStaticBox(-1, -0.05, -1, 7, 0.05, 5, 0, floorMat);
  addStaticBox(ROOM.minX - 0.03, 0.8, -1, 0.03, 0.8, 5);
  addStaticBox(ROOM.maxX + 0.03, 0.8, -1, 0.03, 0.8, 5);
  addStaticBox(-1, 0.8, ROOM.minZ - 0.03, 7, 0.8, 0.03);
  addStaticBox(-1, 0.8, ROOM.maxZ + 0.03, 7, 0.8, 0.03);

  // Desk legs are solid.
  for (const leg of DESK_LEGS) {
    addStaticBox(leg.x, 0.5, leg.z, leg.halfX, 0.5, leg.halfZ);
  }
  // Desk top is a solid surface so items can rest on it instead of falling through.
  addStaticBox(desk.pos.x, 1.02, desk.pos.z, desk.sizeX * 0.5, 0.06, desk.sizeZ * 0.5, 0, shellMat);

  // Hamper walls.
  addStaticBox(hamper.pos.x, hamper.rimY * 0.5, hamper.pos.z + hamper.outerHalfZ, hamper.outerHalfX, hamper.rimY * 0.5, 0.03);
  addStaticBox(hamper.pos.x, hamper.rimY * 0.5, hamper.pos.z - hamper.outerHalfZ, hamper.outerHalfX, hamper.rimY * 0.5, 0.03);
  addStaticBox(hamper.pos.x + hamper.outerHalfX, hamper.rimY * 0.5, hamper.pos.z, 0.03, hamper.rimY * 0.5, hamper.outerHalfZ);
  addStaticBox(hamper.pos.x - hamper.outerHalfX, hamper.rimY * 0.5, hamper.pos.z, 0.03, hamper.rimY * 0.5, hamper.outerHalfZ);
  // Hamper top rim edges.
  addStaticBox(hamper.pos.x, hamper.rimY + 0.02, hamper.pos.z + hamper.outerHalfZ, hamper.outerHalfX + 0.02, 0.02, 0.03, 0, rimMat);
  addStaticBox(hamper.pos.x, hamper.rimY + 0.02, hamper.pos.z - hamper.outerHalfZ, hamper.outerHalfX + 0.02, 0.02, 0.03, 0, rimMat);
  addStaticBox(hamper.pos.x + hamper.outerHalfX, hamper.rimY + 0.02, hamper.pos.z, 0.03, 0.02, hamper.outerHalfZ + 0.02, 0, rimMat);
  addStaticBox(hamper.pos.x - hamper.outerHalfX, hamper.rimY + 0.02, hamper.pos.z, 0.03, 0.02, hamper.outerHalfZ + 0.02, 0, rimMat);

  // Trash can hollow shell and rim approximation.
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
  let body;
  let mass;
  if (type === "laundry") {
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f9, roughness: 0.96 });
    const foldMat = new THREE.MeshStandardMaterial({ color: 0xe4e9f2, roughness: 0.95 });
    const pile = new THREE.Group();

    // Flat folded laundry look.
    const baseGeo = new THREE.BoxGeometry(0.48, 0.04, 0.36, 6, 1, 6);
    jitterGeometry(baseGeo, 0.01);
    const base = new THREE.Mesh(baseGeo, clothMat);
    base.position.set(0, 0.03, 0);
    pile.add(base);

    const foldGeo = new THREE.BoxGeometry(0.38, 0.035, 0.27, 6, 1, 6);
    jitterGeometry(foldGeo, 0.009);
    const fold = new THREE.Mesh(foldGeo, foldMat);
    fold.position.set(0.02, 0.055, -0.02);
    fold.rotation.y = 0.32;
    fold.rotation.x = 0.06;
    pile.add(fold);

    const flapGeo = new THREE.BoxGeometry(0.2, 0.03, 0.14, 4, 1, 4);
    jitterGeometry(flapGeo, 0.008);
    const flap = new THREE.Mesh(flapGeo, clothMat);
    flap.position.set(0.09, 0.08, 0.08);
    flap.rotation.y = -0.5;
    flap.rotation.x = -0.05;
    pile.add(flap);

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

    // Slightly larger invisible hit volume so small trash remains easy to click.
    const hitProxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitProxy.position.set(0, 0.02, 0);
    mesh.add(hitProxy);
  }
  mesh.position.set(x, 0.08, z);
  mesh.rotation.y = Math.random() * Math.PI;
  mesh.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });

  body.position.set(x, 0.08, z);
  body.quaternion.setFromEuler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
  body.sleepSpeedLimit = 0.09;
  body.sleepTimeLimit = 0.4;
  physics.world.addBody(body);

  scene.add(mesh);
  pickups.push({
    mesh,
    body,
    type,
    baseMass: mass,
    home: new THREE.Vector3(x, 0.08, z),
    pulseSeed: Math.random() * 6.28,
    inMotion: false,
    motion: null, // "drop" | "bounce" | "drag"
    targetBin: null,
  });
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
  const simpleParts = [];
  const addSimplePart = (mesh) => {
    simpleParts.push(mesh);
    group.add(mesh);
    return mesh;
  };
  const fur = new THREE.MeshStandardMaterial({ color: 0x8f7c69, roughness: 0.92 });
  const furDark = new THREE.MeshStandardMaterial({ color: 0x756555, roughness: 0.95 });
  const pawMat = new THREE.MeshStandardMaterial({ color: 0xd9c8b6, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.95), fur);
  body.position.set(0, 0.24, 0);
  addSimplePart(body);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.19, 0.36), furDark);
  chest.position.set(0, 0.27, 0.44);
  addSimplePart(chest);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.22, 0.26), fur);
  head.position.set(0, 0.36, 0.58);
  addSimplePart(head);

  const leftEar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.06), furDark);
  leftEar.position.set(-0.11, 0.49, 0.65);
  addSimplePart(leftEar);
  const rightEar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.06), furDark);
  rightEar.position.set(0.11, 0.49, 0.65);
  addSimplePart(rightEar);

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
    addSimplePart(leg);
    legs.push(leg);
  }

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.44), furDark);
  tail.position.set(0, 0.35, -0.62);
  addSimplePart(tail);

  const paw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.16), pawMat);
  paw.position.set(0.21, 0.25, 0.42);
  addSimplePart(paw);

  const modelAnchor = new THREE.Group();
  group.add(modelAnchor);

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
    simpleParts,
    modelAnchor,
    usingRealisticModel: false,
    rig: null,
    clipMixer: null,
    clipActions: new Map(),
    walkAction: null,
    idleAction: null,
    activeClipAction: null,
    useClipLocomotion: false,
    pos: new THREE.Vector3(1.5, 0, 1.7),
    state: "patrol", // patrol|toDesk|prepareJump|launchUp|forepawHook|pullUp|jumpSettle|toCup|swipe|jumpDown|sit|toCatnip|distracted
    lastState: "patrol",
    stateT: 0,
    status: "Patrolling",
    onTable: false,
    speed: 1.0,
    wpIndex: 0,
    walkT: 0,
    motionBlend: 0,
    phaseT: 0,
    swipeHitDone: false,
    jump: null, // {from,to,fromY,toY,dur,t,arc,next}
    jumpAnchor: null,
    jumpTargets: null, // {hook, top}
    jumpApproachLock: false,
    nav: {
      goal: new THREE.Vector3(1.5, 0, 1.7),
      path: [],
      index: 0,
      repathAt: 0,
      anchorReplanAt: 0,
      steerYaw: NaN,
      pickupTrapT: 0,
      unstuckCheckAt: 0,
      unstuckCheckPos: new THREE.Vector3(1.5, 0, 1.7),
      stuckT: 0,
      lastPos: new THREE.Vector3(1.5, 0, 1.7),
      lastSpeed: 0,
    },
    waypoints,
  };
}

function normalizeCatModel(model) {
  tempBox.setFromObject(model);
  if (tempBox.isEmpty()) return;

  tempBox.getSize(tempSize);
  const sourceLength = Math.max(tempSize.x, tempSize.z, 0.001);
  const targetLength = 0.92;
  const scale = targetLength / sourceLength;
  model.scale.multiplyScalar(scale);

  tempBox.setFromObject(model);
  tempBox.getCenter(tempCenter);
  tempMin.copy(tempBox.min);

  model.position.x -= tempCenter.x;
  model.position.y -= tempMin.y;
  model.position.z -= tempCenter.z;
}

function findBone(model, name) {
  const node = model.getObjectByName(name);
  return node && node.isBone ? node : null;
}

function findBoneByAliases(model, aliases) {
  if (!aliases || aliases.length === 0) return null;

  const bones = [];
  model.traverse((node) => {
    // Some GLB rigs expose joints as Object3D nodes (not Bone), so accept both.
    if (
      node.isBone ||
      (node.name && !node.isMesh && !node.isCamera && !node.isLight)
    ) {
      bones.push(node);
    }
  });

  for (const alias of aliases) {
    if (!alias) continue;
    const exact = bones.find((b) => b.name === alias);
    if (exact) return exact;
  }

  const lowerNames = bones.map((b) => ({ bone: b, name: b.name.toLowerCase() }));
  for (const alias of aliases) {
    if (!alias) continue;
    const q = alias.toLowerCase();
    const loose = lowerNames.find((entry) => entry.name === q || entry.name.includes(q));
    if (loose) return loose.bone;
  }

  return null;
}

function cloneBoneRotation(bone) {
  return bone ? bone.rotation.clone() : new THREE.Euler();
}

function createCatRig(model) {
  const rig = {
    root: findBoneByAliases(model, ["j_root", "_rootJoint", "Root_00", "root"]),
    hips: findBoneByAliases(model, ["j_hips", "Hip_011", "hips", "hip"]),
    spine1: findBoneByAliases(model, ["j_spine_1", "spine_1", "spine1", "spine"]),
    spine2: findBoneByAliases(model, ["j_spine_2", "spine_2", "spine2"]),
    spine3: findBoneByAliases(model, ["j_spine_3", "spine_3", "spine3"]),
    neckBase: findBoneByAliases(model, ["j_neck_base", "Neck_01", "neck_base", "neck"]),
    neck1: findBoneByAliases(model, ["j_neck_1", "neck_1", "neck1"]),
    head: findBoneByAliases(model, ["j_head", "Head_02", "head"]),
    tail: [
      findBoneByAliases(model, ["j_tail_1", "Tail_1_012", "tail_1"]),
      findBoneByAliases(model, ["j_tail_2", "Tail_2_013", "tail_2"]),
      findBoneByAliases(model, ["j_tail_3", "Tail_3_014", "tail_3"]),
      findBoneByAliases(model, ["j_tail_4", "Tail_4_015", "tail_4"]),
      findBoneByAliases(model, ["j_tail_5", "Tail_5_016", "tail_5"]),
      findBoneByAliases(model, ["j_tail_6", "tail_6"]),
    ],
    frontL: {
      shoulder: findBoneByAliases(model, ["j_l_humerous", "Left_leg_front_09", "Slim_Cat_L_Front_Leg", "left_leg_front"]),
      elbow: findBoneByAliases(model, ["j_l_elbow", "Left_paw_front_010", "left_paw_front", "left_elbow"]),
      wrist: findBoneByAliases(model, ["j_l_wrist", "Left_paw_front_010", "left_wrist"]),
      paw: findBoneByAliases(model, ["j_l_palm", "Left_paw_front_010", "left_paw"]),
    },
    frontR: {
      shoulder: findBoneByAliases(model, ["j_r_humerous", "Right__leg_front_021", "Slim_Cat_R_Front_Leg", "right_leg_front"]),
      elbow: findBoneByAliases(model, ["j_r_elbow", "Right__paw_front_022", "right_paw_front", "right_elbow"]),
      wrist: findBoneByAliases(model, ["j_r_wrist", "Right__paw_front_022", "right_wrist"]),
      paw: findBoneByAliases(model, ["j_r_palm", "Right__paw_front_022", "right_paw"]),
    },
    backL: {
      hip: findBoneByAliases(model, ["j_l_femur", "Left_leg_back_017", "Slim_Cat_L_Hind_Leg", "left_leg_back"]),
      knee: findBoneByAliases(model, ["j_l_knee", "Left_paw_back_018", "left_paw_back", "left_knee"]),
      ankle: findBoneByAliases(model, ["j_l_ankle", "Left_paw_back_018", "left_ankle"]),
    },
    backR: {
      hip: findBoneByAliases(model, ["j_r_femur", "Right__leg_back_019", "Slim_Cat_R_Hind_Leg", "right_leg_back"]),
      knee: findBoneByAliases(model, ["j_r_knee", "Right__paw_back_020", "right_paw_back", "right_knee"]),
      ankle: findBoneByAliases(model, ["j_r_ankle", "Right__paw_back_020", "right_ankle"]),
    },
    base: {},
    profile: "default",
  };

  const hasWalkingCatBones = !!findBoneByAliases(model, [
    "Left_leg_front_09",
    "Right__leg_front_021",
    "Left_leg_back_017",
    "Right__leg_back_019",
  ]);
  if (hasWalkingCatBones) {
    rig.profile = "walkingcat";
  }

  const allBones = [
    rig.root, rig.hips, rig.spine1, rig.spine2, rig.spine3, rig.neckBase, rig.neck1, rig.head,
    ...rig.tail,
    rig.frontL.shoulder, rig.frontL.elbow, rig.frontL.wrist, rig.frontL.paw,
    rig.frontR.shoulder, rig.frontR.elbow, rig.frontR.wrist, rig.frontR.paw,
    rig.backL.hip, rig.backL.knee, rig.backL.ankle,
    rig.backR.hip, rig.backR.knee, rig.backR.ankle,
  ].filter(Boolean);

  for (const bone of allBones) {
    rig.base[bone.name] = cloneBoneRotation(bone);
  }

  return rig;
}

function setBonePose(rig, bone, x = 0, y = 0, z = 0, alpha = 1) {
  if (!bone) return;
  const base = rig.base[bone.name];
  if (!base) return;
  const targetX = base.x + x;
  const targetY = base.y + y;
  const targetZ = base.z + z;
  const lerpAngle = (current, target, t) => {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + delta * t;
  };
  bone.rotation.x = lerpAngle(bone.rotation.x, targetX, alpha);
  bone.rotation.y = lerpAngle(bone.rotation.y, targetY, alpha);
  bone.rotation.z = lerpAngle(bone.rotation.z, targetZ, alpha);
}

function pickAnimationClip(clips, patterns) {
  for (const pattern of patterns) {
    const clip = clips.find((c) => pattern.test(c.name));
    if (clip) return clip;
  }
  return null;
}

function setupCatClipAnimations(catObject, model, clips) {
  catObject.clipMixer = null;
  catObject.clipActions.clear();
  catObject.walkAction = null;
  catObject.idleAction = null;
  catObject.activeClipAction = null;
  catObject.useClipLocomotion = false;

  if (!clips || clips.length === 0) return;

  const mixer = new THREE.AnimationMixer(model);
  catObject.clipMixer = mixer;
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setLoop(THREE.LoopRepeat, Infinity);
    catObject.clipActions.set(clip.name, action);
  }

  const walkClip =
    pickAnimationClip(clips, [/walk/i, /locomot/i, /trot/i, /run/i, /move/i]) || clips[0];
  const idleClip =
    pickAnimationClip(clips, [/idle/i, /rest/i, /stand/i, /wait/i]) || walkClip || clips[0];

  const walkAction = mixer.clipAction(walkClip);
  const idleAction = mixer.clipAction(idleClip);
  walkAction.play();
  if (idleAction !== walkAction) idleAction.play();

  walkAction.setEffectiveWeight(0);
  idleAction.setEffectiveWeight(1);
  idleAction.setEffectiveTimeScale(1);

  catObject.walkAction = walkAction;
  catObject.idleAction = idleAction;
  catObject.activeClipAction = idleAction;
  catObject.useClipLocomotion = true;
}

function setCatClipSpecialPose(catObject, special) {
  if (!catObject.useClipLocomotion || !catObject.walkAction || !catObject.idleAction) return;
  catObject.walkAction.enabled = true;
  catObject.idleAction.enabled = true;
  if (special) {
    catObject.walkAction.play();
    catObject.idleAction.play();
    catObject.walkAction.setEffectiveWeight(0);
    catObject.idleAction.setEffectiveWeight(0);
  }
}

function updateCatClipLocomotion(catObject, dt, moving, speedNorm) {
  if (!catObject.useClipLocomotion || !catObject.clipMixer || !catObject.walkAction || !catObject.idleAction) return;

  const walkAction = catObject.walkAction;
  const idleAction = catObject.idleAction;
  walkAction.enabled = true;
  idleAction.enabled = true;
  walkAction.play();
  idleAction.play();
  const target = moving ? walkAction : idleAction;

  if (catObject.activeClipAction !== target) {
    target.reset().play();
    if (catObject.activeClipAction && catObject.activeClipAction !== target) {
      catObject.activeClipAction.crossFadeTo(target, 0.22, false);
    } else {
      target.setEffectiveWeight(1);
    }
    catObject.activeClipAction = target;
  }

  if (walkAction === idleAction) {
    walkAction.setEffectiveWeight(1);
    walkAction.setEffectiveTimeScale(moving ? THREE.MathUtils.clamp(0.75 + speedNorm * 0.7, 0.7, 1.65) : 0.45);
  } else if (moving) {
    walkAction.setEffectiveWeight(1);
    idleAction.setEffectiveWeight(0);
    walkAction.setEffectiveTimeScale(THREE.MathUtils.clamp(0.75 + speedNorm * 0.7, 0.7, 1.65));
    idleAction.setEffectiveTimeScale(1.0);
  } else {
    walkAction.setEffectiveWeight(0);
    idleAction.setEffectiveWeight(1);
    idleAction.setEffectiveTimeScale(1.0);
  }

  catObject.clipMixer.update(dt);
}

function loadCatModel(catObject) {
  const tryLoad = (idx) => {
    if (idx >= CAT_MODEL_CANDIDATES.length) {
      catObject.usingRealisticModel = false;
      console.warn("Failed to load cat model from all paths:", CAT_MODEL_CANDIDATES);
      return;
    }

    const url = CAT_MODEL_CANDIDATES[idx];
    gltfLoader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((node) => {
          if (!node.isMesh) return;
          node.castShadow = false;
          node.receiveShadow = false;
          if (Array.isArray(node.material)) {
            for (const mat of node.material) {
              if (mat && "side" in mat) mat.side = THREE.DoubleSide;
            }
          } else if (node.material && "side" in node.material) {
            node.material.side = THREE.DoubleSide;
          }
        });

        model.rotation.y = CAT_MODEL_YAW_OFFSET;
        normalizeCatModel(model);
        catObject.modelAnchor.clear();
        catObject.modelAnchor.add(model);
        catObject.usingRealisticModel = true;
        catObject.rig = createCatRig(model);
        setupCatClipAnimations(catObject, model, gltf.animations || []);

        for (const mesh of catObject.simpleParts) {
          mesh.visible = false;
        }
      },
      undefined,
      (error) => {
        console.warn("Failed to load cat model path:", url, error);
        tryLoad(idx + 1);
      }
    );
  };

  tryLoad(0);
}

function resetGame() {
  game.state = "playing";
  game.reason = "";
  game.sorted = 0;
  game.nextKnockAt = 12;
  game.pendingLoseAt = null;
  game.placeCatnipMode = false;
  game.catnipCooldownUntil = 0;
  game.invalidCatnipUntil = 0;
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
  dragState = null;
  dragHover = { binType: null, topEntry: false };
  controls.enabled = true;
  setBinHighlight(null, false);

  for (const p of pickups) {
    scene.remove(p.mesh);
    if (p.body) physics.world.removeBody(p.body);
  }
  pickups.length = 0;
  addFixedPickups();
  game.total = pickups.length;

  cat.pos.set(1.5, 0, 1.7);
  cat.group.position.set(cat.pos.x, 0, cat.pos.z);
  cat.group.rotation.set(0, 2.4, 0);
  cat.state = "patrol";
  cat.lastState = "patrol";
  cat.stateT = 0;
  cat.status = "Patrolling";
  cat.onTable = false;
  cat.wpIndex = 0;
  cat.walkT = 0;
  cat.motionBlend = 0;
  cat.phaseT = 0;
  cat.swipeHitDone = false;
  cat.jump = null;
  cat.jumpAnchor = null;
  cat.jumpTargets = null;
  cat.jumpApproachLock = false;
  cat.nav.goal.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.path.length = 0;
  cat.nav.index = 0;
  cat.nav.repathAt = 0;
  cat.nav.anchorReplanAt = 0;
  cat.nav.steerYaw = NaN;
  cat.nav.pickupTrapT = 0;
  cat.nav.unstuckCheckAt = clockTime;
  cat.nav.unstuckCheckPos.copy(cat.pos);
  cat.nav.stuckT = 0;
  cat.nav.lastPos.copy(cat.pos);
  cat.nav.lastSpeed = 0;
  cat.modelAnchor.position.set(0, 0, 0);
  cat.modelAnchor.rotation.set(0, 0, 0);
}

function setBinHighlight(binType, topEntry) {
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

function isInsideHamperOpening(pos) {
  return (
    Math.abs(pos.x - hamper.pos.x) <= hamper.openingHalfX &&
    Math.abs(pos.z - hamper.pos.z) <= hamper.openingHalfZ
  );
}

function isInsideTrashOpening(pos) {
  const dx = pos.x - trashCan.pos.x;
  const dz = pos.z - trashCan.pos.z;
  return dx * dx + dz * dz <= trashCan.openingRadius * trashCan.openingRadius;
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

  if (topEntry(wantedBin)) return { binType: wantedBin, topEntry: true, valid: true };
  if (topEntry(otherBin)) return { binType: otherBin, topEntry: true, valid: false };
  if (sideHit(wantedBin)) return { binType: wantedBin, topEntry: false, valid: false };
  if (sideHit(otherBin)) return { binType: otherBin, topEntry: false, valid: false };
  return { binType: null, topEntry: false, valid: false };
}

function onPointerDown(event) {
  if (game.state !== "playing") return;
  setMouseFromEvent(event);

  if (game.placeCatnipMode) {
    placeCatnipFromMouse();
    return;
  }

  // Keep pickups selectable even while they are still settling after a drop.
  const pickupMeshes = pickups.map((p) => p.mesh);
  raycaster.setFromCamera(mouse, camera);
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
  dragHover = { binType: null, topEntry: false };
  setBinHighlight(null, false);
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
  setBinHighlight(dragHover.binType, dragHover.topEntry);
}

function onPointerUp() {
  if (!dragState) return;
  const p = dragState.pickup;
  const finalHit = classifyBinContactForPickup(p);
  setPickupBodyMode(p, CANNON.Body.DYNAMIC);
  p.body.wakeUp();

  if (finalHit.valid && finalHit.topEntry) {
    startPickupIntoBin(p, finalHit.binType);
  } else if (finalHit.binType != null) {
    startPickupBounce(p, finalHit.binType);
  } else {
    startPickupDrop(p);
  }

  dragState = null;
  dragHover = { binType: null, topEntry: false };
  setBinHighlight(null, false);
  controls.enabled = true;
}

function removePickup(pickup) {
  scene.remove(pickup.mesh);
  if (pickup.body) physics.world.removeBody(pickup.body);
  const idx = pickups.indexOf(pickup);
  if (idx !== -1) pickups.splice(idx, 1);
  game.sorted++;
  if (game.sorted >= game.total) win();
}

function setPickupBodyMode(pickup, mode) {
  pickup.body.type = mode;
  if (mode === CANNON.Body.DYNAMIC) {
    pickup.body.mass = pickup.baseMass;
  } else {
    pickup.body.mass = 0;
  }
  pickup.body.updateMassProperties();
}

function startPickupIntoBin(pickup, binType) {
  pickup.inMotion = true;
  pickup.motion = "drop";
  pickup.targetBin = binType;
  if (binType === "trash") {
    // Start clearly above the opening and bias inward for a clean drop.
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
  const out = new THREE.Vector3(
    pickup.body.position.x - center.x,
    0,
    pickup.body.position.z - center.z
  );
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

function pickupRadius(pickup) {
  return pickup.type === "laundry" ? 0.2 : 0.16;
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

  // If dragged over desk top, keep the item above the desk surface.
  const overDeskTop =
    Math.abs(pos.x - desk.pos.x) <= desk.sizeX * 0.5 - r * 0.2 &&
    Math.abs(pos.z - desk.pos.z) <= desk.sizeZ * 0.5 - r * 0.2;
  if (overDeskTop) {
    targetY = Math.max(targetY, desk.topY + r * 0.55);
  }

  for (const leg of DESK_LEGS) {
    if (pos.y <= leg.topY + 0.03) {
      pushOutFromAabbXZ(pos, leg.x, leg.z, leg.halfX, leg.halfZ, r);
    }
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
      if (penX < penZ) {
        pos.x = hamper.pos.x + Math.sign(dx || 1) * limX;
      } else {
        pos.z = hamper.pos.z + Math.sign(dz || 1) * limZ;
      }
      const penetration = Math.min(penX, penZ);
      const climb = THREE.MathUtils.clamp((0.14 - penetration) * 0.8, 0, 0.12);
      const mouseLiftInfluence = THREE.MathUtils.clamp((liftY - 0.22) * 0.35, 0, 0.18);
      targetY = Math.max(targetY, hamper.rimY - 0.02 + climb + mouseLiftInfluence);
    }
    if (pickup.type === "laundry" && inOpening) {
      targetY = Math.max(targetY, hamper.rimY + 0.14);
    }
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
      // Keep trash clearly above rim during drag so release falls in naturally.
      targetY = Math.max(targetY, trashCan.rimY + 0.32);
    }
  }

  pos.y = THREE.MathUtils.lerp(pos.y, targetY, 0.34);
}

function pickupTuning(pickup) {
  if (pickup.type === "laundry") {
    return {
      friction: 0.18,
      settleSpeed: 0.08,
    };
  }
  return {
    friction: 0.46,
    settleSpeed: 0.16,
  };
}

function isPickupRestingOnDesk(pickup) {
  const b = pickup.body;
  const halfY = pickup.type === "laundry" ? 0.04 : 0.03;
  const onDeskY = Math.abs(b.position.y - (desk.topY + halfY)) <= 0.08;
  const onDeskXZ =
    Math.abs(b.position.x - desk.pos.x) <= desk.sizeX * 0.5 + 0.03 &&
    Math.abs(b.position.z - desk.pos.z) <= desk.sizeZ * 0.5 + 0.03;
  return onDeskY && onDeskXZ;
}

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

function findPickupFromObject(object3D) {
  let node = object3D;
  while (node) {
    const hit = pickups.find((p) => p.mesh === node);
    if (hit) return hit;
    node = node.parent;
  }
  return null;
}

function placeCatnipFromMouse() {
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

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    const tuning = pickupTuning(p);
    const b = p.body;
    const maxLinear = p.type === "trash" ? 4.8 : 3.6;
    const maxAngular = p.type === "trash" ? 9.0 : 6.0;

    if (dragState && dragState.pickup === p) {
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
    if (linearSpeed > maxLinear) {
      b.velocity.scale(maxLinear / linearSpeed, b.velocity);
    }
    const angSpeed = b.angularVelocity.length();
    if (angSpeed > maxAngular) {
      b.angularVelocity.scale(maxAngular / angSpeed, b.angularVelocity);
    }

    if (cat.group.position.y <= 0.24 && b.position.y <= 1.2) {
      const catRadius = CAT_COLLISION.catBodyRadius;
      const itemRadius = pickupRadius(p) * 0.86;
      const minDist = catRadius + itemRadius;
      let dxCat = b.position.x - cat.pos.x;
      let dzCat = b.position.z - cat.pos.z;
      let dist = Math.hypot(dxCat, dzCat);
      if (dist < minDist) {
        if (dist < 1e-4) {
          dxCat = Math.sin(cat.group.rotation.y);
          dzCat = Math.cos(cat.group.rotation.y);
          dist = 1;
        }
        const nxCat = dxCat / dist;
        const nzCat = dzCat / dist;
        const push = minDist - dist + 0.05;
        b.position.x += nxCat * push;
        b.position.z += nzCat * push;
        const impact = Math.max(0, -b.velocity.y);
        const bounce = p.type === "trash" ? 1.35 + Math.min(0.45, impact * 0.16) : 1.28 + Math.min(0.36, impact * 0.14);
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
      }
    }

    const dxTrash = b.position.x - trashCan.pos.x;
    const dzTrash = b.position.z - trashCan.pos.z;
    const dTrash = Math.hypot(dxTrash, dzTrash);
    const dxHamper = b.position.x - hamper.pos.x;
    const dzHamper = b.position.z - hamper.pos.z;

    if (p.type === "trash") {
      if (p.targetBin === "trash" && dTrash <= trashCan.openingRadius + 0.2 && b.position.y <= trashCan.rimY + 0.46) {
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
        dTrash <= trashCan.openingRadius - 0.015 &&
        b.position.y <= trashCan.sinkY + 0.11 &&
        b.velocity.length() <= 0.5
      ) {
        removePickup(p);
        continue;
      }
    } else {
      if (
        p.targetBin === "hamper" &&
        Math.abs(dxHamper) <= hamper.openingHalfX + 0.04 &&
        Math.abs(dzHamper) <= hamper.openingHalfZ + 0.04 &&
        b.position.y <= hamper.rimY + 0.25
      ) {
        b.applyForce(new CANNON.Vec3(-dxHamper * 0.16, 0, -dzHamper * 0.16), b.position);
      }
      if (
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

    if ((b.position.y <= 0.082 || isPickupRestingOnDesk(p)) && speed < tuning.settleSpeed) {
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

function startJump(to, toY, dur, arc, nextState, opts = null) {
  cat.jump = {
    from: cat.pos.clone(),
    to: to.clone(),
    fromY: cat.group.position.y,
    toY,
    dur,
    t: 0,
    arc,
    nextState,
    easePos: !!(opts && opts.easePos),
    easeY: !!(opts && opts.easeY),
    avoidDeskClip: !!(opts && opts.avoidDeskClip),
  };
}

function updateJump(dt) {
  if (!cat.jump) return false;
  cat.jump.t += dt;
  const u = Math.min(1, cat.jump.t / cat.jump.dur);
  const uPos = cat.jump.easePos ? THREE.MathUtils.smootherstep(u, 0, 1) : u;
  const uY = cat.jump.easeY ? Math.pow(u, 0.74) : u;
  cat.pos.lerpVectors(cat.jump.from, cat.jump.to, uPos);
  const lift = Math.sin(Math.PI * u) * cat.jump.arc;
  let y = THREE.MathUtils.lerp(cat.jump.fromY, cat.jump.toY, uY) + lift;
  if (cat.jump.avoidDeskClip && y < desk.topY + 0.08) {
    const halfX = desk.sizeX * 0.5 + 0.12;
    const halfZ = desk.sizeZ * 0.5 + 0.12;
    if (Math.abs(cat.pos.x - desk.pos.x) <= halfX && Math.abs(cat.pos.z - desk.pos.z) <= halfZ) {
      y = desk.topY + 0.08;
    }
  }
  cat.group.position.set(cat.pos.x, y, cat.pos.z);
  if (u >= 1) {
    cat.group.position.y = cat.jump.toY;
    const next = cat.jump.nextState;
    cat.jump = null;
    cat.state = next;
    return true;
  }
  return false;
}

function buildCatObstacles(includePickups = false, includeClosePickups = false) {
  const obstacles = [
    {
      kind: "box",
      x: hamper.pos.x,
      z: hamper.pos.z,
      hx: hamper.outerHalfX + 0.02,
      hz: hamper.outerHalfZ + 0.02,
    },
    { kind: "circle", x: trashCan.pos.x, z: trashCan.pos.z, r: trashCan.outerRadius + 0.12 },
  ];
  for (const leg of DESK_LEGS) {
    obstacles.push({
      kind: "box",
      x: leg.x,
      z: leg.z,
      hx: leg.halfX + 0.03,
      hz: leg.halfZ + 0.03,
    });
  }
  if (includePickups) {
    for (const p of pickups) {
      if (p.mesh.position.y > 0.34) continue;
      const cdx = p.mesh.position.x - cat.pos.x;
      const cdz = p.mesh.position.z - cat.pos.z;
      if (!includeClosePickups && cdx * cdx + cdz * cdz < 0.22 * 0.22) continue;
      if (p.type === "laundry") {
        tempQ.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
        tempEuler.setFromQuaternion(tempQ, "YXZ");
        obstacles.push({
          kind: "obb",
          x: p.mesh.position.x,
          z: p.mesh.position.z,
          hx: 0.17,
          hz: 0.11,
          yaw: tempEuler.y,
        });
      } else {
        obstacles.push({
          kind: "circle",
          x: p.mesh.position.x,
          z: p.mesh.position.z,
          r: pickupRadius(p) + CAT_COLLISION.pickupRadiusBoost * 0.35,
        });
      }
    }
  }
  return obstacles;
}

function isCatPointBlocked(x, z, obstacles, clearance = CAT_NAV.clearance) {
  if (
    x < ROOM.minX + CAT_NAV.margin ||
    x > ROOM.maxX - CAT_NAV.margin ||
    z < ROOM.minZ + CAT_NAV.margin ||
    z > ROOM.maxZ - CAT_NAV.margin
  ) {
    return true;
  }
  for (const obs of obstacles) {
    const dx = x - obs.x;
    const dz = z - obs.z;
    if (obs.kind === "box") {
      if (Math.abs(dx) < obs.hx + clearance && Math.abs(dz) < obs.hz + clearance) return true;
      continue;
    }
    if (obs.kind === "obb") {
      const c = Math.cos(obs.yaw);
      const s = Math.sin(obs.yaw);
      const lx = c * dx + s * dz;
      const lz = -s * dx + c * dz;
      if (Math.abs(lx) < obs.hx + clearance && Math.abs(lz) < obs.hz + clearance) return true;
      continue;
    }
    const rr = obs.r + clearance;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

function hasClearTravelLine(a, b, obstacles) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return true;
  const samples = Math.max(2, Math.ceil(dist / 0.18));
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    if (isCatPointBlocked(x, z, obstacles)) return false;
  }
  return true;
}

function smoothCatPath(path, obstacles) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1) {
      if (hasClearTravelLine(path[i], path[j], obstacles)) break;
      j--;
    }
    out.push(path[j]);
    i = j;
  }
  return out;
}

function catPathDistance(path) {
  if (!path || path.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < path.length; i++) d += path[i - 1].distanceTo(path[i]);
  return d;
}

function computeCatPath(start, goal, obstacles) {
  if (hasClearTravelLine(start, goal, obstacles)) {
    return [start.clone(), goal.clone()];
  }

  const step = CAT_NAV.step;
  const minX = ROOM.minX + CAT_NAV.margin;
  const maxX = ROOM.maxX - CAT_NAV.margin;
  const minZ = ROOM.minZ + CAT_NAV.margin;
  const maxZ = ROOM.maxZ - CAT_NAV.margin;
  const w = Math.floor((maxX - minX) / step) + 1;
  const h = Math.floor((maxZ - minZ) / step) + 1;
  const size = w * h;

  const toIdx = (ix, iz) => iz * w + ix;
  const toCell = (v, out) => {
    out.x = THREE.MathUtils.clamp(Math.round((v.x - minX) / step), 0, w - 1);
    out.y = THREE.MathUtils.clamp(Math.round((v.z - minZ) / step), 0, h - 1);
  };
  const cellPos = (ix, iz, out) => {
    out.set(minX + ix * step, 0, minZ + iz * step);
  };
  const nearestFree = (sx, sz) => {
    if (!isCatPointBlocked(sx, sz, obstacles)) return new THREE.Vector2(sx, sz);
    for (let r = 1; r <= 8; r++) {
      for (let az = -r; az <= r; az++) {
        for (let ax = -r; ax <= r; ax++) {
          if (Math.abs(ax) !== r && Math.abs(az) !== r) continue;
          const x = sx + ax * step;
          const z = sz + az * step;
          if (!isCatPointBlocked(x, z, obstacles)) return new THREE.Vector2(x, z);
        }
      }
    }
    return new THREE.Vector2(sx, sz);
  };

  const freeStart = nearestFree(start.x, start.z);
  const freeGoal = nearestFree(goal.x, goal.z);
  tempFrom.set(freeStart.x, 0, freeStart.y);
  tempTo.set(freeGoal.x, 0, freeGoal.y);

  const startCell = new THREE.Vector2();
  const goalCell = new THREE.Vector2();
  toCell(tempFrom, startCell);
  toCell(tempTo, goalCell);

  const g = new Float32Array(size);
  const f = new Float32Array(size);
  const came = new Int32Array(size);
  const closed = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    g[i] = Infinity;
    f[i] = Infinity;
    came[i] = -1;
  }

  const open = [];
  const startId = toIdx(startCell.x, startCell.y);
  const goalId = toIdx(goalCell.x, goalCell.y);
  g[startId] = 0;
  f[startId] = tempFrom.distanceTo(tempTo);
  open.push(startId);

  const currentPos = new THREE.Vector3();
  const neighborPos = new THREE.Vector3();
  while (open.length) {
    let bestI = 0;
    let bestF = f[open[0]];
    for (let i = 1; i < open.length; i++) {
      const score = f[open[i]];
      if (score < bestF) {
        bestF = score;
        bestI = i;
      }
    }
    const current = open[bestI];
    open[bestI] = open[open.length - 1];
    open.pop();
    if (current === goalId) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % w;
    const cz = Math.floor(current / w);
    cellPos(cx, cz, currentPos);
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oz === 0) continue;
        const nx = cx + ox;
        const nz = cz + oz;
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;
        const nid = toIdx(nx, nz);
        if (closed[nid]) continue;
        cellPos(nx, nz, neighborPos);
        if (isCatPointBlocked(neighborPos.x, neighborPos.z, obstacles)) continue;
        if (ox !== 0 && oz !== 0) {
          const c1x = cx + ox;
          const c1z = cz;
          const c2x = cx;
          const c2z = cz + oz;
          cellPos(c1x, c1z, tempFrom);
          cellPos(c2x, c2z, tempTo);
          if (isCatPointBlocked(tempFrom.x, tempFrom.z, obstacles) || isCatPointBlocked(tempTo.x, tempTo.z, obstacles)) {
            continue;
          }
        }
        const stepCost = ox !== 0 && oz !== 0 ? 1.4142 : 1.0;
        const candidate = g[current] + stepCost;
        if (candidate >= g[nid]) continue;
        came[nid] = current;
        g[nid] = candidate;
        f[nid] = candidate + neighborPos.distanceTo(tempTo);
        open.push(nid);
      }
    }
  }

  if (came[goalId] === -1 && goalId !== startId) {
    return [start.clone(), goal.clone()];
  }

  const rev = [];
  let cur = goalId;
  while (cur !== -1) {
    const ix = cur % w;
    const iz = Math.floor(cur / w);
    cellPos(ix, iz, tempFrom);
    rev.push(tempFrom.clone());
    cur = came[cur];
  }
  rev.reverse();
  if (!rev.length) return [start.clone(), goal.clone()];
  rev[0].copy(start);
  rev[rev.length - 1].copy(goal);
  return smoothCatPath(rev, obstacles);
}

function isPathTraversable(path, obstacles) {
  if (!path || path.length < 2) return false;
  for (let i = 1; i < path.length; i++) {
    if (!hasClearTravelLine(path[i - 1], path[i], obstacles)) return false;
  }
  return true;
}

function canReachGroundTarget(start, goal, obstacles) {
  if (isCatPointBlocked(goal.x, goal.z, obstacles, CAT_NAV.clearance * 0.9)) return false;
  if (start.distanceToSquared(goal) < 0.1 * 0.1) return true;
  const path = computeCatPath(start, goal, obstacles);
  return isPathTraversable(path, obstacles);
}

function ensureCatPath(target, force = false, useDynamic = false) {
  if (cat.group.position.y > 0.02) return;
  const goalDelta = cat.nav.goal.distanceToSquared(target);
  if (!force && cat.nav.path.length > 1 && goalDelta < 0.05 * 0.05) return;
  const obstacles = buildCatObstacles(useDynamic);
  cat.nav.path = computeCatPath(cat.pos, target, obstacles);
  cat.nav.index = cat.nav.path.length > 1 ? 1 : 0;
  cat.nav.goal.copy(target);
  cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
}

function nearestDeskJumpAnchor(from) {
  const staticObstacles = buildCatObstacles(false);
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < DESK_JUMP_ANCHORS.length; i++) {
    const a = DESK_JUMP_ANCHORS[i];
    if (isCatPointBlocked(a.x, a.z, staticObstacles, CAT_NAV.clearance * 0.85)) continue;
    const d = from.distanceToSquared(a);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best || DESK_JUMP_ANCHORS[0];
}

function bestDeskJumpAnchor(from) {
  const staticObstacles = buildCatObstacles(false);
  const dynamicObstacles = buildCatObstacles(true);
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < DESK_JUMP_ANCHORS.length; i++) {
    const a = DESK_JUMP_ANCHORS[i];
    if (isCatPointBlocked(a.x, a.z, staticObstacles, CAT_NAV.clearance * 0.85)) continue;

    const path = computeCatPath(from, a, staticObstacles);
    if (!isPathTraversable(path, staticObstacles)) continue;
    const dynamicClear = isPathTraversable(path, dynamicObstacles);
    const score = catPathDistance(path) + (dynamicClear ? 0 : 2.2);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best || nearestDeskJumpAnchor(from);
}

function computeDeskJumpTargets(anchor) {
  const relX = anchor.x - desk.pos.x;
  const relZ = anchor.z - desk.pos.z;
  const hook = new THREE.Vector3();
  const top = new THREE.Vector3();
  const edgeOut = 0.24;
  const topIn = 0.34;

  if (Math.abs(relX) >= Math.abs(relZ)) {
    const sx = Math.sign(relX || 1);
    const edgeX = desk.pos.x + sx * (desk.sizeX * 0.5 + edgeOut);
    const z = THREE.MathUtils.clamp(
      anchor.z,
      desk.pos.z - desk.sizeZ * 0.5 + 0.24,
      desk.pos.z + desk.sizeZ * 0.5 - 0.24
    );
    hook.set(edgeX, 0, z);
    top.set(desk.pos.x + sx * (desk.sizeX * 0.5 - topIn), 0, z);
  } else {
    const sz = Math.sign(relZ || 1);
    const edgeZ = desk.pos.z + sz * (desk.sizeZ * 0.5 + edgeOut);
    const x = THREE.MathUtils.clamp(
      anchor.x,
      desk.pos.x - desk.sizeX * 0.5 + 0.3,
      desk.pos.x + desk.sizeX * 0.5 - 0.3
    );
    hook.set(x, 0, edgeZ);
    top.set(x, 0, desk.pos.z + sz * (desk.sizeZ * 0.5 - topIn));
  }

  return { hook, top };
}

function rotateCatToward(yaw, dt) {
  const delta = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
  const maxStep = CAT_NAV.maxTurnRate * dt;
  const clamped = THREE.MathUtils.clamp(delta, -maxStep, maxStep);
  cat.group.rotation.y += clamped;
  return delta;
}

const GROUND_STEER_OFFSETS = [0, 0.2, -0.2, 0.42, -0.42, 0.66, -0.66, 0.92, -0.92, 1.22, -1.22, 1.48, -1.48];

function chooseGroundSteer(target, step, staticObstacles, dynamicObstacles, ignoreDynamic = false) {
  const toGoalX = target.x - cat.pos.x;
  const toGoalZ = target.z - cat.pos.z;
  const goalLen = Math.max(0.001, Math.hypot(toGoalX, toGoalZ));
  const goalYaw = Math.atan2(toGoalX, toGoalZ);
  const prevYaw = Number.isFinite(cat.nav.steerYaw) ? cat.nav.steerYaw : goalYaw;
  const dynamicClearance = CAT_NAV.clearance + CAT_COLLISION.pickupClearance;
  const lookAhead = Math.max(step, Math.min(CAT_NAV.localLookAhead, step * 2.2));

  let best = null;
  let bestScore = Infinity;

  const evaluate = (offset, allowBacktrack) => {
    const yaw = goalYaw + offset;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const faceDelta = Math.abs(
      Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y))
    );
    if (cat.nav.stuckT < 0.26 && faceDelta > 0.95) return;

    const tx = cat.pos.x + sx * step;
    const tz = cat.pos.z + sz * step;
    if (isCatPointBlocked(tx, tz, staticObstacles, CAT_NAV.clearance * 0.9)) return;
    if (!ignoreDynamic && isCatPointBlocked(tx, tz, dynamicObstacles, dynamicClearance)) return;

    const progress = (toGoalX * sx + toGoalZ * sz) / goalLen;
    if (!allowBacktrack && progress < -0.08) return;

    const lx = cat.pos.x + sx * lookAhead;
    const lz = cat.pos.z + sz * lookAhead;
    const dynamicAhead = !ignoreDynamic && isCatPointBlocked(lx, lz, dynamicObstacles, dynamicClearance * 0.9);
    const staticAhead = isCatPointBlocked(lx, lz, staticObstacles, CAT_NAV.clearance * 0.9);
    if (staticAhead) return;

    const remainingD2 = (target.x - tx) * (target.x - tx) + (target.z - tz) * (target.z - tz);
    let score = Math.abs(offset) * 0.52 + (1 - progress) * 1.4 + remainingD2 * 0.015;
    const steerDelta = Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw));
    score += Math.abs(steerDelta) * CAT_NAV.steerSwitchPenalty;
    score += faceDelta * CAT_NAV.steerFacingPenalty;
    if (dynamicAhead) score += 0.95;

    if (score < bestScore) {
      bestScore = score;
      best = { sx, sz, yaw };
    }
  };

  for (const offset of GROUND_STEER_OFFSETS) evaluate(offset, false);
  if (!best) {
    for (const offset of GROUND_STEER_OFFSETS) evaluate(offset, true);
  }
  return best;
}

function moveCatToward(target, dt, speed, yLevel, opts = {}) {
  let direct = !!opts.direct;
  let ignoreDynamic = !!opts.ignoreDynamic;
  let chase = target;
  if (yLevel <= 0.02) {
    if (direct) {
      const staticObstacles = buildCatObstacles(false);
      if (
        isCatPointBlocked(target.x, target.z, staticObstacles, CAT_NAV.clearance * 0.9) ||
        !hasClearTravelLine(cat.pos, target, staticObstacles)
      ) {
        direct = false;
        ignoreDynamic = false;
      }
    }
    tempTo.set(target.x, 0, target.z);
    if (!direct) {
      const goalChanged = cat.nav.goal.distanceToSquared(tempTo) > 0.1 * 0.1;
      const needsPath = cat.nav.path.length <= 1 && clockTime >= cat.nav.repathAt;
      const stalePath = clockTime >= cat.nav.repathAt;
      const force = goalChanged || needsPath || stalePath;
      const useDynamicPlan = !ignoreDynamic && cat.nav.stuckT > 0.28;
      ensureCatPath(tempTo, force, useDynamicPlan);
      if (cat.nav.path.length > 1) {
        let index = THREE.MathUtils.clamp(cat.nav.index, 1, cat.nav.path.length - 1);
        while (index < cat.nav.path.length - 1 && cat.pos.distanceToSquared(cat.nav.path[index]) < 0.15 * 0.15) {
          index++;
        }
        cat.nav.index = index;
        chase = cat.nav.path[index];
        const segmentObstacles = ignoreDynamic ? buildCatObstacles(false) : buildCatObstacles(true);
        if (!hasClearTravelLine(cat.pos, chase, segmentObstacles)) {
          ensureCatPath(tempTo, true, !ignoreDynamic);
          if (cat.nav.path.length > 1) {
            const nIndex = THREE.MathUtils.clamp(cat.nav.index, 1, cat.nav.path.length - 1);
            chase = cat.nav.path[nIndex];
          }
        }
      }
    }
  }

  const dx = chase.x - cat.pos.x;
  const dz = chase.z - cat.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.06) {
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    return cat.pos.distanceTo(target) < 0.14;
  }
  const nx = dx / d;
  const nz = dz / d;
  const yaw = Math.atan2(nx, nz);
  const dy = rotateCatToward(yaw, dt);
  let step = Math.min(d, speed * dt);
  if (yLevel <= 0.02 && Math.abs(dy) > CAT_NAV.turnSlowThreshold) {
    const t = THREE.MathUtils.clamp((Math.abs(dy) - CAT_NAV.turnSlowThreshold) / 0.9, 0, 1);
    step *= THREE.MathUtils.lerp(1.0, 0.2, t);
  }
  if (yLevel <= 0.02 && Math.abs(dy) > CAT_NAV.turnStopThreshold) {
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    cat.nav.lastSpeed = 0;
    cat.nav.stuckT += dt * 0.4;
    if (cat.nav.stuckT > 0.4 && clockTime >= cat.nav.repathAt) {
      ensureCatPath(target, true, !ignoreDynamic);
      cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
    }
    return false;
  }

  if (yLevel <= 0.02) {
    const staticObstacles = buildCatObstacles(false);
    const dynamicObstacles = ignoreDynamic ? staticObstacles : buildCatObstacles(true);
    const steerTarget = chase;
    const steer = chooseGroundSteer(steerTarget, step, staticObstacles, dynamicObstacles, ignoreDynamic);
    if (!steer) {
      cat.nav.stuckT += dt;
      if (cat.nav.stuckT > 0.55) {
        nudgeBlockingPickupAwayFromCat();
      }
      if (cat.nav.stuckT > 0.3 && clockTime >= cat.nav.repathAt) {
        ensureCatPath(target, true, !ignoreDynamic);
        cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
      }
      if (cat.nav.stuckT > 1.15) {
        cat.nav.path.length = 0;
        cat.nav.index = 0;
      }
      return false;
    }

    tempFrom.copy(cat.pos);
    const facingDelta = Math.abs(
      Math.atan2(Math.sin(steer.yaw - cat.group.rotation.y), Math.cos(steer.yaw - cat.group.rotation.y))
    );
    const forwardScale = THREE.MathUtils.clamp(1 - facingDelta / 1.7, 0.26, 1);
    const steerStep = step * forwardScale;
    cat.pos.x += steer.sx * steerStep;
    cat.pos.z += steer.sz * steerStep;
    cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);
    cat.nav.steerYaw = steer.yaw;
    rotateCatToward(steer.yaw, dt);

    const moved = cat.pos.distanceTo(tempFrom);
    if (moved < CAT_NAV.stuckSpeed * dt && d > 0.18) {
      cat.nav.stuckT += dt;
      if (cat.nav.stuckT > 0.36 && clockTime >= cat.nav.repathAt) {
        ensureCatPath(target, true, !ignoreDynamic);
        cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
      }
    } else {
      cat.nav.stuckT = Math.max(0, cat.nav.stuckT - dt * 0.9);
    }
    cat.nav.lastPos.copy(cat.pos);
    cat.nav.lastSpeed = moved / Math.max(dt, 1e-5);
    return cat.pos.distanceToSquared(target) < 0.14 * 0.14;
  }

  tempFrom.copy(cat.pos);
  cat.pos.x += nx * step;
  cat.pos.z += nz * step;
  cat.group.position.set(cat.pos.x, yLevel, cat.pos.z);

  const moved = cat.pos.distanceTo(tempFrom);
  cat.nav.lastPos.copy(cat.pos);
  cat.nav.lastSpeed = moved / Math.max(dt, 1e-5);

  return cat.pos.distanceToSquared(target) < 0.14 * 0.14;
}

function findSafeGroundPoint(preferred) {
  const obstacles = buildCatObstacles(true);
  const clearance = CAT_NAV.clearance * 0.9;
  if (!isCatPointBlocked(preferred.x, preferred.z, obstacles, clearance)) {
    return preferred.clone();
  }

  let best = null;
  let bestD = Infinity;
  for (let r = 0.36; r <= 2.4; r += 0.24) {
    const steps = Math.max(8, Math.floor(r * 16));
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const x = preferred.x + Math.cos(t) * r;
      const z = preferred.z + Math.sin(t) * r;
      if (isCatPointBlocked(x, z, obstacles, clearance)) continue;
      const d = (x - preferred.x) * (x - preferred.x) + (z - preferred.z) * (z - preferred.z);
      if (d < bestD) {
        bestD = d;
        if (!best) best = new THREE.Vector3();
        best.set(x, 0, z);
      }
    }
    if (best) break;
  }
  return best || preferred.clone();
}

function sampleSwipePose(t) {
  const w = SWIPE_TIMING.windup;
  const s = SWIPE_TIMING.strike;
  const r = Math.max(0.01, SWIPE_TIMING.recover);
  const ws = w;
  const ss = w + s;
  const rs = w + s + r;

  const pose = {
    lift: 0,
    reach: 0,
    lean: 0,
    hit: false,
    done: false,
  };

  if (t < ws) {
    const u = THREE.MathUtils.smootherstep(t / Math.max(ws, 1e-5), 0, 1);
    pose.lift = u;
    pose.reach = -0.24 * u;
    pose.lean = 0.18 * u;
    return pose;
  }

  if (t < ss) {
    const u = THREE.MathUtils.smootherstep((t - ws) / Math.max(s, 1e-5), 0, 1);
    pose.lift = 1.0 - u * 0.58;
    pose.reach = -0.24 + u * 1.22;
    pose.lean = 0.18 - u * 0.34;
    pose.hit = u >= 0.55;
    return pose;
  }

  if (t < rs) {
    const u = THREE.MathUtils.smootherstep((t - ss) / Math.max(r, 1e-5), 0, 1);
    pose.lift = 0.42 * (1 - u);
    pose.reach = 0.98 - u * 0.76;
    pose.lean = -0.16 * (1 - u);
    return pose;
  }

  pose.done = true;
  return pose;
}

function getCatPickupOverlap() {
  let count = 0;
  let maxPenetration = 0;
  const catRadius = CAT_COLLISION.catBodyRadius + 0.04;
  for (const p of pickups) {
    if (!p.body) continue;
    if (dragState && dragState.pickup === p) continue;
    if (p.body.position.y > 1.25) continue;
    const itemRadius = pickupRadius(p) * 0.98;
    const minDist = catRadius + itemRadius;
    const dx = p.body.position.x - cat.pos.x;
    const dz = p.body.position.z - cat.pos.z;
    const dist = Math.hypot(dx, dz);
    const penetration = minDist - dist;
    if (penetration > 0) {
      count++;
      if (penetration > maxPenetration) maxPenetration = penetration;
    }
  }
  return { count, maxPenetration };
}

function getCatObstacleIntrusion() {
  const catRadius = CAT_COLLISION.catBodyRadius;
  const nearPadding = 0.08;
  const obstacles = buildCatObstacles(true, true);
  let intersectCount = 0;
  let nearCount = 0;
  let maxPenetration = 0;
  let maxNearness = 0;

  for (const obs of obstacles) {
    const dx = cat.pos.x - obs.x;
    const dz = cat.pos.z - obs.z;
    let penetration = 0;
    let nearness = 0;

    if (obs.kind === "circle") {
      const signed = Math.hypot(dx, dz) - (obs.r + catRadius);
      penetration = -Math.min(0, signed);
      if (signed > 0 && signed < nearPadding) nearness = nearPadding - signed;
    } else if (obs.kind === "box") {
      const ox = Math.abs(dx) - (obs.hx + catRadius);
      const oz = Math.abs(dz) - (obs.hz + catRadius);
      if (ox <= 0 && oz <= 0) {
        penetration = Math.min(-ox, -oz);
      } else {
        const outX = Math.max(0, ox);
        const outZ = Math.max(0, oz);
        const gap = Math.hypot(outX, outZ);
        if (gap < nearPadding) nearness = nearPadding - gap;
      }
    } else if (obs.kind === "obb") {
      const c = Math.cos(obs.yaw);
      const s = Math.sin(obs.yaw);
      const lx = c * dx + s * dz;
      const lz = -s * dx + c * dz;
      const ox = Math.abs(lx) - (obs.hx + catRadius);
      const oz = Math.abs(lz) - (obs.hz + catRadius);
      if (ox <= 0 && oz <= 0) {
        penetration = Math.min(-ox, -oz);
      } else {
        const outX = Math.max(0, ox);
        const outZ = Math.max(0, oz);
        const gap = Math.hypot(outX, outZ);
        if (gap < nearPadding) nearness = nearPadding - gap;
      }
    }

    if (penetration > 0) {
      intersectCount++;
      if (penetration > maxPenetration) maxPenetration = penetration;
    } else if (nearness > 0) {
      nearCount++;
      if (nearness > maxNearness) maxNearness = nearness;
    }
  }

  return { intersectCount, nearCount, maxPenetration, maxNearness };
}

function isCatCagedByPickups() {
  const staticObstacles = buildCatObstacles(false);
  const dynamicObstacles = buildCatObstacles(true, true);
  const clearance = CAT_NAV.clearance * 0.9;
  const radii = [0.28, 0.42];
  const dirs = 16;
  let staticFree = 0;
  let dynamicFree = 0;

  for (const r of radii) {
    for (let i = 0; i < dirs; i++) {
      const t = (i / dirs) * Math.PI * 2;
      const x = cat.pos.x + Math.cos(t) * r;
      const z = cat.pos.z + Math.sin(t) * r;
      const sFree = !isCatPointBlocked(x, z, staticObstacles, clearance);
      if (sFree) {
        staticFree++;
        if (!isCatPointBlocked(x, z, dynamicObstacles, clearance)) dynamicFree++;
      }
    }
  }

  return staticFree >= 3 && dynamicFree === 0;
}

function findNearestCatRecoveryPoint(preferred, includePickups = true) {
  const obstacles = buildCatObstacles(includePickups, includePickups);
  const clearance = CAT_NAV.clearance * 0.9;
  const isFree = (x, z) => !isCatPointBlocked(x, z, obstacles, clearance);
  const isNavigable = (x, z) => {
    if (!isFree(x, z)) return false;
    let exits = 0;
    const exitR = 0.26;
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      const ex = x + Math.cos(t) * exitR;
      const ez = z + Math.sin(t) * exitR;
      if (isFree(ex, ez)) exits++;
      if (exits >= 2) return true;
    }
    return false;
  };

  if (isNavigable(preferred.x, preferred.z)) return preferred.clone();

  let best = null;
  let bestD2 = Infinity;
  for (let r = 0.16; r <= 2.8; r += 0.12) {
    const steps = Math.max(12, Math.floor(r * 34));
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const x = preferred.x + Math.cos(t) * r;
      const z = preferred.z + Math.sin(t) * r;
      if (!isNavigable(x, z)) continue;
      const d2 = (x - preferred.x) * (x - preferred.x) + (z - preferred.z) * (z - preferred.z);
      if (d2 < bestD2) {
        bestD2 = d2;
        if (!best) best = new THREE.Vector3();
        best.set(x, 0, z);
      }
    }
    if (best) break;
  }
  return best;
}

function recoverCatFromPickupTrap(dt) {
  if (cat.jump || cat.onTable || cat.group.position.y > 0.04) {
    cat.nav.pickupTrapT = 0;
    cat.nav.unstuckCheckAt = clockTime;
    cat.nav.unstuckCheckPos.copy(cat.pos);
    return false;
  }

  const since = clockTime - cat.nav.unstuckCheckAt;
  if (since < CAT_NAV.unstuckCheckInterval) return false;

  const moved = cat.pos.distanceTo(cat.nav.unstuckCheckPos);
  const sampleDt = since;
  cat.nav.unstuckCheckAt = clockTime;
  cat.nav.unstuckCheckPos.copy(cat.pos);

  const overlap = getCatPickupOverlap();
  const intrusion = getCatObstacleIntrusion();
  const caged = isCatCagedByPickups();
  const goal = getCurrentGroundGoal();
  const hasGoal = !!goal;
  const goalDist2 = hasGoal ? cat.pos.distanceToSquared(goal) : 0;
  const nearGoal = hasGoal && goalDist2 < 0.18 * 0.18;
  const movementStalled = hasGoal && !nearGoal && moved < CAT_NAV.unstuckMinMove && cat.nav.stuckT > 0.16;
  const nearIntrusion = intrusion.nearCount > 0 && moved < CAT_NAV.unstuckMinMove * 1.25;
  const trapDetected = intrusion.intersectCount > 0 || nearIntrusion || overlap.count > 0 || caged || movementStalled;

  if (!trapDetected) {
    cat.nav.pickupTrapT = Math.max(0, cat.nav.pickupTrapT - sampleDt * 2.2);
    return false;
  }

  const overlapPressure = overlap.count > 0 ? 1 + overlap.maxPenetration * 3.2 : 1.0;
  const intrusionPressure =
    intrusion.intersectCount > 0
      ? 1 + intrusion.maxPenetration * 4.0
      : intrusion.nearCount > 0
        ? 1 + intrusion.maxNearness * 3.0
        : 1.0;
  const cageBoost = caged ? 1.9 : 1.0;
  cat.nav.pickupTrapT += sampleDt * Math.max(overlapPressure, intrusionPressure) * cageBoost;
  if (cat.nav.pickupTrapT < 0.1) return false;

  let recovery = findNearestCatRecoveryPoint(cat.pos, true);
  if (!recovery) recovery = findNearestCatRecoveryPoint(cat.pos, false);
  if (!recovery || recovery.distanceToSquared(cat.pos) < 0.01) {
    nudgeBlockingPickupAwayFromCat();
    cat.nav.pickupTrapT = 0.12;
    return false;
  }

  cat.pos.copy(recovery);
  cat.group.position.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.goal.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.path.length = 0;
  cat.nav.index = 0;
  cat.nav.repathAt = 0;
  cat.nav.steerYaw = NaN;
  cat.nav.stuckT = 0;
  cat.nav.pickupTrapT = 0;
  cat.nav.unstuckCheckAt = clockTime;
  cat.nav.unstuckCheckPos.copy(cat.pos);
  cat.status = "Recovering";
  nudgeBlockingPickupAwayFromCat();

  if (goal) ensureCatPath(goal, true, true);
  return true;
}

function nudgeBlockingPickupAwayFromCat() {
  let best = null;
  let bestD2 = Infinity;
  for (const p of pickups) {
    if (!p.body) continue;
    if (dragState && dragState.pickup === p) continue;
    if (p.body.position.y > 1.2) continue;
    const dx = p.body.position.x - cat.pos.x;
    const dz = p.body.position.z - cat.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2 && d2 < 0.54 * 0.54) {
      best = p;
      bestD2 = d2;
    }
  }
  if (!best) return false;

  let dx = best.body.position.x - cat.pos.x;
  let dz = best.body.position.z - cat.pos.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    dx = Math.sin(cat.group.rotation.y);
    dz = Math.cos(cat.group.rotation.y);
    d = 1;
  }
  const nx = dx / d;
  const nz = dz / d;
  const minDist = 0.28 + pickupRadius(best) * 0.9;
  best.body.position.x = cat.pos.x + nx * (minDist + 0.08);
  best.body.position.z = cat.pos.z + nz * (minDist + 0.08);
  best.body.velocity.x += nx * (best.type === "trash" ? 1.25 : 0.95);
  best.body.velocity.z += nz * (best.type === "trash" ? 1.25 : 0.95);
  best.body.velocity.y = Math.max(best.body.velocity.y, best.type === "trash" ? 0.8 : 0.62);
  best.body.wakeUp();
  best.inMotion = true;
  if (best.motion === "drag") best.motion = "bounce";
  return true;
}

function getCurrentGroundGoal() {
  if (cat.state === "patrol") return cat.waypoints[cat.wpIndex];
  if (cat.state === "toDesk") return cat.jumpAnchor || bestDeskJumpAnchor(cat.pos);
  if (cat.state === "toCatnip" && game.catnip) return game.catnip.pos;
  if (cat.state === "toCup") return new THREE.Vector3(desk.cup.x - 0.36, 0, desk.cup.z + 0.02);
  return null;
}

function keepCatAwayFromCup(minDist) {
  if (cup.broken || cup.falling) return;
  const cx = cup.group.position.x;
  const cz = cup.group.position.z;
  let dx = cat.pos.x - cx;
  let dz = cat.pos.z - cz;
  let d = Math.hypot(dx, dz);
  if (d >= minDist) return;
  if (d < 1e-4) {
    const yaw = cat.group.rotation.y;
    dx = Math.sin(yaw);
    dz = Math.cos(yaw);
    d = 1;
  }
  const nx = dx / d;
  const nz = dz / d;
  cat.pos.x = cx + nx * minDist;
  cat.pos.z = cz + nz * minDist;
  cat.group.position.x = cat.pos.x;
  cat.group.position.z = cat.pos.z;
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

  if (cat.state !== cat.lastState) {
    cat.lastState = cat.state;
    cat.stateT = 0;
    cat.phaseT = 0;
    cat.nav.steerYaw = NaN;
    cat.nav.pickupTrapT = 0;
    cat.nav.unstuckCheckAt = clockTime;
    cat.nav.unstuckCheckPos.copy(cat.pos);
  } else {
    cat.stateT += dt;
  }

  if (!cat.jump && recoverCatFromPickupTrap(dt)) {
    animateCatPose(dt, false);
    return;
  }

  if (!cat.jump && cat.group.position.y <= 0.03 && cat.nav.stuckT > CAT_NAV.stuckReset) {
    cat.state = "patrol";
    cat.jumpAnchor = null;
    cat.jumpTargets = null;
    cat.jumpApproachLock = false;
    cat.nav.path.length = 0;
    cat.nav.index = 0;
    cat.nav.repathAt = 0;
    cat.nav.steerYaw = NaN;
    cat.nav.pickupTrapT = 0;
    cat.nav.unstuckCheckAt = clockTime;
    cat.nav.unstuckCheckPos.copy(cat.pos);
    cat.nav.stuckT = 0;
    cat.wpIndex = (cat.wpIndex + 1) % cat.waypoints.length;
  }

  if (!cat.jump && cat.group.position.y <= 0.03 && cat.nav.stuckT > 0.7) {
    const rescueGoal = getCurrentGroundGoal();
    if (rescueGoal) {
      ensureCatPath(rescueGoal, true, true);
      cat.nav.repathAt = clockTime + CAT_NAV.repathInterval;
    }
    if (cat.nav.stuckT > 1.1 && nudgeBlockingPickupAwayFromCat()) {
      cat.nav.repathAt = 0;
      cat.nav.stuckT = Math.max(0.25, cat.nav.stuckT * 0.55);
    }
  }

  if (game.catnip && clockTime >= game.catnip.expiresAt) {
    scene.remove(game.catnip.mesh);
    game.catnip = null;
    if (cat.state === "toCatnip" || cat.state === "distracted") {
      cat.state = "patrol";
    }
  }

  if (cat.jump) {
    updateJump(dt);
    if (cat.state === "launchUp") cat.status = "Jumping up";
    else if (cat.state === "pullUp") cat.status = "Pulling up";
    else if (cat.state === "jumpDown") cat.status = "Jumping down";
    else cat.status = "Jumping";
    animateCatPose(dt, false);
    return;
  }

  // Catnip overrides knock behavior.
  if (game.catnip) {
    if (cat.onTable) {
      cat.onTable = false;
      const downPoint = findSafeGroundPoint(desk.approach);
      startJump(downPoint, 0, 0.62, 0.34, "toCatnip", {
        easePos: true,
        easeY: true,
        avoidDeskClip: true,
      });
      return;
    }
    cat.jumpAnchor = null;
    cat.jumpTargets = null;
    cat.jumpApproachLock = false;
    cat.state = "toCatnip";
    const atCatnip = moveCatToward(game.catnip.pos, dt, 1.0, 0);
    cat.status = atCatnip ? "Distracted" : "Going to catnip";
    animateCatPose(dt, !atCatnip);
    return;
  }

  if ((clockTime >= game.nextKnockAt) && !cup.broken && !cup.falling && cat.state === "patrol") {
    cat.jumpAnchor = null;
    cat.jumpTargets = null;
    cat.jumpApproachLock = false;
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
    const shouldReplanAnchor =
      cat.stateT > 8.0 ||
      !cat.jumpAnchor ||
      (cat.nav.stuckT > 0.46 && clockTime >= cat.nav.anchorReplanAt);
    if (shouldReplanAnchor) {
      cat.jumpAnchor = bestDeskJumpAnchor(cat.pos);
      cat.jumpTargets = null;
      cat.jumpApproachLock = false;
      cat.nav.path.length = 0;
      cat.nav.index = 0;
      cat.nav.repathAt = 0;
      cat.nav.anchorReplanAt = clockTime + 0.55;
      if (cat.stateT > 8.0) cat.stateT = 0;
    }
    if (!cat.jumpApproachLock && cat.pos.distanceToSquared(cat.jumpAnchor) < 0.4 * 0.4) {
      const staticObstacles = buildCatObstacles(false);
      if (hasClearTravelLine(cat.pos, cat.jumpAnchor, staticObstacles)) {
        cat.jumpApproachLock = true;
      }
    }
    if (cat.jumpApproachLock && cat.pos.distanceToSquared(cat.jumpAnchor) > 0.56 * 0.56) {
      cat.jumpApproachLock = false;
    }
    const reachedDesk = moveCatToward(cat.jumpAnchor, dt, 0.92, 0, {
      direct: cat.jumpApproachLock,
      ignoreDynamic: false,
    });
    cat.status = "Approaching jump point";
    animateCatPose(dt, true);
    if (reachedDesk) {
      cat.state = "prepareJump";
      cat.phaseT = 0;
      cat.jumpTargets = null;
      cat.nav.path.length = 0;
      cat.nav.index = 0;
    }
    return;
  }

  if (cat.state === "prepareJump") {
    cat.phaseT += dt;
    if (cat.jumpAnchor) {
      cat.pos.x = cat.jumpAnchor.x;
      cat.pos.z = cat.jumpAnchor.z;
      cat.group.position.set(cat.pos.x, 0, cat.pos.z);
    }
    if (!cat.jumpTargets && cat.jumpAnchor) {
      cat.jumpTargets = computeDeskJumpTargets(cat.jumpAnchor);
    }
    const lookTarget = cat.jumpTargets ? cat.jumpTargets.hook : desk.perch;
    const dx = lookTarget.x - cat.pos.x;
    const dz = lookTarget.z - cat.pos.z;
    const yaw = Math.atan2(dx, dz);
    const dy = Math.atan2(Math.sin(yaw - cat.group.rotation.y), Math.cos(yaw - cat.group.rotation.y));
    cat.group.rotation.y += dy * Math.min(1, dt * 5.5);
    cat.status = "Preparing jump";
    animateCatPose(dt, false);
    if (cat.phaseT >= JUMP_UP_TIMING.prepare && cat.jumpTargets) {
      cat.jumpApproachLock = false;
      cat.state = "launchUp";
      startJump(cat.jumpTargets.hook, desk.topY - 0.18, JUMP_UP_TIMING.launch, 0.4, "forepawHook", {
        easePos: true,
        easeY: true,
        avoidDeskClip: true,
      });
    }
    return;
  }

  if (cat.state === "forepawHook") {
    cat.phaseT += dt;
    cat.status = "Grabbing edge";
    animateCatPose(dt, false);
    if (cat.phaseT >= JUMP_UP_TIMING.hook && cat.jumpTargets) {
      cat.state = "pullUp";
      startJump(cat.jumpTargets.top, desk.topY + 0.02, JUMP_UP_TIMING.pull, 0.26, "jumpSettle", {
        easePos: true,
        easeY: true,
        avoidDeskClip: true,
      });
    }
    return;
  }

  if (cat.state === "jumpSettle") {
    cat.phaseT += dt;
    if (cat.stateT <= 0.001) {
      cat.onTable = true;
      cat.jumpAnchor = null;
      cat.jumpTargets = null;
      cat.jumpApproachLock = false;
      cat.nav.path.length = 0;
      cat.nav.index = 0;
    }
    cat.status = "Settling on desk";
    animateCatPose(dt, false);
    if (cat.phaseT >= JUMP_UP_TIMING.settle) {
      cat.state = "toCup";
      cat.phaseT = 0;
    }
    return;
  }

  if (cat.state === "toCup") {
    const target = new THREE.Vector3(desk.cup.x - 0.36, 0, desk.cup.z + 0.02);
    const reachedCup = moveCatToward(target, dt, 0.65, desk.topY + 0.02);
    keepCatAwayFromCup(CAT_COLLISION.cupBodyClearance);
    const closeEnough = cat.pos.distanceToSquared(target) < 0.18 * 0.18;
    cat.status = "Stalking cup";
    animateCatPose(dt, true);
    if (reachedCup || closeEnough) {
      cat.state = "swipe";
      cat.phaseT = 0;
      cat.swipeHitDone = false;
    }
    return;
  }

  if (cat.state === "swipe") {
    cat.phaseT += dt;
    cat.status = "Swiping";
    cat.group.position.y = desk.topY + 0.02;
    keepCatAwayFromCup(CAT_COLLISION.cupBodyClearance);
    const swipePose = sampleSwipePose(cat.phaseT);
    cat.paw.position.y = 0.25 + swipePose.lift * 0.24;
    cat.paw.position.x = 0.21 + swipePose.reach * 0.32;
    if (swipePose.hit && !cat.swipeHitDone) {
      knockCup();
      cat.swipeHitDone = true;
    }
    if (swipePose.done) {
      cat.paw.position.y = 0.25;
      cat.paw.position.x = 0.21;
      cat.state = "jumpDown";
      cat.onTable = false;
      cat.phaseT = 0;
      cat.jumpAnchor = null;
      cat.jumpTargets = null;
      cat.jumpApproachLock = false;
      cat.nav.path.length = 0;
      cat.nav.index = 0;
      const downPoint = findSafeGroundPoint(desk.approach);
      startJump(downPoint, 0, 0.64, 0.34, "sit", {
        easePos: true,
        easeY: true,
        avoidDeskClip: true,
      });
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

  if (cat.state === "sit") {
    cat.phaseT += dt;
    cat.status = "Sitting";
    animateCatPose(dt, false);
    if (cat.phaseT >= 1.25) {
      cat.state = "patrol";
      cat.phaseT = 0;
    }
    return;
  }
}

function animateCatPose(dt, moving) {
  const isPrepareJump = cat.state === "prepareJump";
  const isLaunchUp = cat.state === "launchUp";
  const isForepawHook = cat.state === "forepawHook";
  const isPullUp = cat.state === "pullUp";
  const isJumpSettle = cat.state === "jumpSettle";
  const forceStill =
    cat.state === "swipe" ||
    cat.state === "sit" ||
    isPrepareJump ||
    isForepawHook ||
    isJumpSettle ||
    !!cat.jump;
  const movingTarget = forceStill ? 0 : (moving || cat.nav.lastSpeed > 0.24 ? 1 : 0);
  cat.motionBlend = THREE.MathUtils.damp(cat.motionBlend, movingTarget, 8, dt);
  const movingAmt = cat.motionBlend;

  if (movingAmt > 0.02) {
    cat.walkT += dt * 8.0;
  } else {
    cat.walkT *= Math.max(0, 1 - dt * 8.0);
  }

  if (cat.usingRealisticModel) {
    const isSit = cat.state === "sit";
    const usesSpecialPose =
      cat.state === "swipe" ||
      isPrepareJump ||
      isLaunchUp ||
      isForepawHook ||
      isPullUp ||
      isJumpSettle ||
      isSit ||
      !!cat.jump;
    if (cat.useClipLocomotion && cat.clipMixer) {
      setCatClipSpecialPose(cat, usesSpecialPose);
      if (!usesSpecialPose) {
        const speedNorm = THREE.MathUtils.clamp(cat.nav.lastSpeed / Math.max(cat.speed, 0.001), 0, 1.5);
        updateCatClipLocomotion(cat, dt, movingAmt > 0.08, speedNorm);

        cat.modelAnchor.position.y = THREE.MathUtils.damp(cat.modelAnchor.position.y, 0, 10, dt);
        cat.modelAnchor.rotation.x = THREE.MathUtils.damp(cat.modelAnchor.rotation.x, 0, 10, dt);
        cat.modelAnchor.rotation.z = THREE.MathUtils.damp(cat.modelAnchor.rotation.z, 0, 10, dt);
        return;
      }
      cat.clipMixer.update(dt);
    }

    const rig = cat.rig;
    if (!rig) return;

    const gaitL = Math.sin(cat.walkT) * movingAmt;
    const gaitR = Math.sin(cat.walkT + Math.PI) * movingAmt;
    const breathe = Math.sin(clockTime * 2.2) * 0.03;
    const isSwipe = cat.state === "swipe";
    const swipePose = isSwipe ? sampleSwipePose(cat.phaseT) : null;
    const swipeLift = swipePose ? swipePose.lift : 0;
    const swipeReach = swipePose ? swipePose.reach : 0;
    const swipeLean = swipePose ? swipePose.lean : 0;
    const swipeForward = Math.max(0, swipeReach);
    const swipeBack = Math.max(0, -swipeReach);
    const isJumping = !!cat.jump;
    const jumpU = isJumping ? THREE.MathUtils.clamp(cat.jump.t / cat.jump.dur, 0, 1) : 0;
    const jumpArc = isJumping ? Math.sin(Math.PI * jumpU) : 0;
    const jumpPush = isJumping ? Math.sin(Math.PI * THREE.MathUtils.clamp(jumpU * 1.15, 0, 1)) : 0;
    const jumpReach = isJumping ? Math.sin(Math.PI * THREE.MathUtils.clamp(jumpU * 0.9, 0, 1)) : 0;
    const crouchBase =
      isPrepareJump
        ? 0.46
        : cat.state === "toCup"
          ? 0.2
          : isForepawHook
            ? 0.28
            : isJumpSettle
              ? 0.2
              : isSit
                ? 0.52
                : 0;
    const crouch = crouchBase + (isJumping ? (1 - jumpU) * 0.26 : 0);
    const baseAlpha = THREE.MathUtils.clamp(dt * 12, 0.08, 0.55);

    cat.modelAnchor.position.y = Math.max(0, gaitL) * 0.02 + jumpArc * 0.015;
    cat.modelAnchor.position.z = THREE.MathUtils.damp(cat.modelAnchor.position.z, 0, 10, dt);
    cat.modelAnchor.rotation.z = gaitL * 0.028;
    const targetPitch = -swipeLean * 0.42 - jumpArc * 0.12;
    cat.modelAnchor.rotation.x = THREE.MathUtils.damp(cat.modelAnchor.rotation.x, targetPitch, 10, dt);

    setBonePose(rig, rig.spine1, -0.11 - crouch * 0.09 + breathe * 0.2 + swipeLean * 0.11 - jumpArc * 0.1, 0, 0, baseAlpha);
    setBonePose(rig, rig.spine2, -0.05 - crouch * 0.05 + breathe * 0.15 + swipeLean * 0.08 - jumpArc * 0.06, 0, 0, baseAlpha);
    setBonePose(rig, rig.spine3, -0.03 + breathe * 0.15 + swipeLean * 0.04, 0, 0, baseAlpha);
    setBonePose(rig, rig.neckBase, -0.03 + crouch * 0.06 - swipeLean * 0.06 + jumpArc * 0.02, 0, 0, baseAlpha);
    setBonePose(rig, rig.neck1, 0.03 + crouch * 0.05 - swipeLean * 0.12 + jumpArc * 0.05, 0, 0, baseAlpha);
    setBonePose(rig, rig.head, 0.05 + crouch * 0.08 - swipeLean * 0.2 + jumpArc * 0.09, 0, 0, baseAlpha);

    for (let i = 0; i < rig.tail.length; i++) {
      const tailBone = rig.tail[i];
      const wave = Math.sin(clockTime * 3.2 + i * 0.6) * 0.08;
      const sway = moving ? Math.sin(cat.walkT + i * 0.5) * 0.03 : 0;
      const jumpSway = isJumping ? Math.sin(clockTime * 7 + i * 0.3) * 0.04 : 0;
      setBonePose(rig, tailBone, 0.02 + wave * 0.35, sway, wave * 0.2, baseAlpha);
      if (isJumping) setBonePose(rig, tailBone, 0.18 + jumpSway, sway, wave * 0.2, baseAlpha);
    }

    const foreStrideL = isSwipe ? 0 : gaitL;
    const foreStrideR = isSwipe ? 0 : gaitR;
    const hindStrideL = isSwipe ? 0 : gaitR;
    const hindStrideR = isSwipe ? 0 : gaitL;

    setBonePose(rig, rig.frontL.shoulder, foreStrideL * 0.28 - 0.1 - jumpArc * 0.2 + jumpReach * 0.08, 0, 0, baseAlpha);
    setBonePose(rig, rig.frontL.elbow, -foreStrideL * 0.22 + 0.18 + jumpArc * 0.26 - jumpReach * 0.2, 0, 0, baseAlpha);
    setBonePose(rig, rig.frontL.wrist, foreStrideL * 0.15 - 0.06 + jumpArc * 0.14 - jumpReach * 0.12, 0, 0, baseAlpha);

    setBonePose(
      rig,
      rig.frontR.shoulder,
      foreStrideR * 0.28 - 0.1 - swipeLift * 0.5 - jumpArc * 0.18 + jumpReach * 0.07,
      0,
      -swipeForward * 0.95 + swipeBack * 0.16,
      baseAlpha
    );
    setBonePose(
      rig,
      rig.frontR.elbow,
      -foreStrideR * 0.2 + 0.2 + swipeLift * 0.62 - swipeForward * 0.24 + jumpArc * 0.22 - jumpReach * 0.17,
      0,
      -swipeForward * 0.35,
      baseAlpha
    );
    setBonePose(
      rig,
      rig.frontR.wrist,
      foreStrideR * 0.14 - 0.04 + swipeLift * 0.22 - swipeForward * 0.36 + jumpArc * 0.11 - jumpReach * 0.1,
      0,
      -swipeForward * 0.66,
      baseAlpha
    );
    setBonePose(rig, rig.frontR.paw, 0, 0, -swipeForward * 0.35, baseAlpha);

    setBonePose(rig, rig.backL.hip, hindStrideL * 0.24 + 0.08 + jumpPush * 0.24, 0, 0, baseAlpha);
    setBonePose(rig, rig.backL.knee, -hindStrideL * 0.24 - 0.1 - jumpPush * 0.42, 0, 0, baseAlpha);
    setBonePose(rig, rig.backL.ankle, hindStrideL * 0.13 + 0.04 + jumpPush * 0.26, 0, 0, baseAlpha);

    setBonePose(rig, rig.backR.hip, hindStrideR * 0.24 + 0.08 + jumpPush * 0.24, 0, 0, baseAlpha);
    setBonePose(rig, rig.backR.knee, -hindStrideR * 0.24 - 0.1 - jumpPush * 0.42, 0, 0, baseAlpha);
    setBonePose(rig, rig.backR.ankle, hindStrideR * 0.13 + 0.04 + jumpPush * 0.26, 0, 0, baseAlpha);

    if (isPrepareJump) {
      const u = THREE.MathUtils.clamp(cat.phaseT / JUMP_UP_TIMING.prepare, 0, 1);
      // Rear-up prep: front body lifts while hind legs stay planted to load jump force.
      setBonePose(rig, rig.spine1, 0.16 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine2, 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine3, 0.16 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.neckBase, -0.22 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.neck1, -0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.head, -0.08 * u, 0, 0, baseAlpha);

      setBonePose(rig, rig.frontL.shoulder, -0.64 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.64 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 1.0 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 1.0 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.68 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.68 * u, 0, 0, baseAlpha);

      setBonePose(rig, rig.backL.hip, 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.32 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.32 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.12 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.12 * u, 0, 0, baseAlpha);

      // Make the rear-up clearly visible from gameplay camera.
      cat.modelAnchor.position.y += 0.16 * u;
      cat.modelAnchor.rotation.x = THREE.MathUtils.damp(cat.modelAnchor.rotation.x, 0.44 * u, 12, dt);
    }

    if (isLaunchUp) {
      const u = jumpU;
      setBonePose(rig, rig.frontL.shoulder, -0.52 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.52 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.66 - 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.66 - 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.34 + 0.12 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.34 + 0.12 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.hip, 0.4 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.4 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.62 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.62 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.26 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.26 * (1 - u), 0, 0, baseAlpha);
    }

    if (isForepawHook) {
      const u = THREE.MathUtils.clamp(cat.phaseT / JUMP_UP_TIMING.hook, 0, 1);
      setBonePose(rig, rig.frontL.shoulder, -0.44, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.44, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.74, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.74, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.38, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.38, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.hip, 0.14 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.14 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.24 - 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.24 - 0.2 * u, 0, 0, baseAlpha);
    }

    if (isPullUp) {
      const u = jumpU;
      setBonePose(rig, rig.frontL.shoulder, -0.38 + 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.38 + 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.88 - 0.46 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.88 - 0.46 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.48 + 0.24 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.48 + 0.24 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.hip, 0.56 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.56 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.84 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.84 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.36 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.36 * u, 0, 0, baseAlpha);
    }

    if (isJumpSettle) {
      const u = THREE.MathUtils.clamp(cat.phaseT / JUMP_UP_TIMING.settle, 0, 1);
      setBonePose(rig, rig.frontL.elbow, 0.42 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.42 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.34 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.34 * (1 - u), 0, 0, baseAlpha);
    }

    if (isSwipe) {
      // Keep non-swiping limbs planted: swipe is a single front-paw action.
      setBonePose(rig, rig.frontL.shoulder, -0.16, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.32, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.12, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.paw, 0, 0, 0, baseAlpha);

      setBonePose(rig, rig.backL.hip, 0.12, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.24, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.08, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.12, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.24, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.08, 0, 0, baseAlpha);
    }

    if (isSit) {
      const sitIn = THREE.MathUtils.clamp(cat.phaseT / 0.35, 0, 1);
      setBonePose(rig, rig.spine1, 0.04 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine2, 0.08 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine3, 0.12 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.neckBase, -0.08 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.neck1, -0.06 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.head, 0.02 * sitIn, 0, 0, baseAlpha);

      setBonePose(rig, rig.frontL.shoulder, -0.2 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.2 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.34 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.34 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.16 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.16 * sitIn, 0, 0, baseAlpha);

      setBonePose(rig, rig.backL.hip, 0.64 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.64 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.94 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.94 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.34 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.34 * sitIn, 0, 0, baseAlpha);
    }

    if (movingAmt < 0.18 && !isSwipe && !isJumping && !isSit) {
      const idleBlend = 0.18 + breathe * 0.08;
      setBonePose(rig, rig.frontL.elbow, 0.2 + idleBlend, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.2 + idleBlend, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.15 - idleBlend * 0.6, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.15 - idleBlend * 0.6, 0, 0, baseAlpha);
    }

    return;
  }

  const swing = Math.sin(cat.walkT) * (moving ? 0.06 : 0);
  if (cat.state === "sit") {
    cat.legs[0].position.z = 0.26;
    cat.legs[1].position.z = 0.26;
    cat.legs[2].position.z = -0.21;
    cat.legs[3].position.z = -0.21;
    cat.tail.rotation.x = 0.48;
    return;
  }
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
    catnipStatEl.textContent = clockTime < game.invalidCatnipUntil ? "Invalid spot" : "Click floor to place";
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
    physics.world.step(physics.fixedStep, dt, 10);
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
