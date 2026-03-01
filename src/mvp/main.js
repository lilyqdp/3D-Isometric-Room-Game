import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "./vendor/cannon-es.js";
import { makeBins, makeDesk, makeRoomCorner } from "./modules/room.js";
import { setupPhysicsWorld } from "./modules/physics.js";
import { addRandomPickups, pickRandomCatSpawnPoint } from "./modules/spawning.js";
import { updateCatStateMachineRuntime } from "./modules/cat-state-machine.js";
import { createPickupsRuntime } from "./modules/pickups.js";
import { createCatNavigationRuntime } from "./modules/cat-navigation.js";
import { createDebugOverlayRuntime } from "./modules/debug-overlay.js";
import { makeCup, createCupRuntime } from "./modules/cup-system.js";
import { createCatnipRuntime } from "./modules/catnip-system.js";
import { createUIRuntime } from "./modules/ui-system.js";

const sortedStatEl = document.getElementById("sortedStat");
const catStateStatEl = document.getElementById("catStateStat");
const cupStatEl = document.getElementById("cupStat");
const catnipStatEl = document.getElementById("catnipStat");
const resultEl = document.getElementById("result");
const catnipBtn = document.getElementById("catnipBtn");
const restartBtn = document.getElementById("restartBtn");
const debugBtnEl = document.getElementById("debugBtn");

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
  // Keep cup near edge so a swipe reliably sends it off the desk.
  cup: new THREE.Vector3(-0.98, 0, -2.22),
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
  pendingLoseAt: null,
  catnip: null, // {mesh,pos,expiresAt}
  catnipCooldownUntil: 0,
  placeCatnipMode: false,
  invalidCatnipUntil: 0,
};

const pickups = [];
const shatterBits = [];
let clockTime = 0;

const binVisuals = {
  hamper: { shells: [], ring: null },
  trash: { shells: [], ring: null },
};

const physics = {
  fixedStep: 1 / 180,
  world: new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) }),
  materials: {},
  staticBoxes: [],
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
const tempTo = new THREE.Vector3();

const CAT_NAV = {
  step: 0.26,
  margin: 0.4,
  clearance: 0.2,
  repathInterval: 0.4,
  jumpBypassCheckInterval: 0.18,
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

const CAT_BEHAVIOR = {
  tableApproachChancePerSecond: 0.1,
  tableApproachRollInterval: 1.0,
  initialRollDelay: 1.0,
};

const A_STAR_NEIGHBOR_COUNT = 128;
const A_STAR_NEIGHBOR_RADIUS = 6;
const ASTAR_NEIGHBOR_OFFSETS = (() => {
  const offsets = [];
  for (let oz = -A_STAR_NEIGHBOR_RADIUS; oz <= A_STAR_NEIGHBOR_RADIUS; oz++) {
    for (let ox = -A_STAR_NEIGHBOR_RADIUS; ox <= A_STAR_NEIGHBOR_RADIUS; ox++) {
      if (ox === 0 && oz === 0) continue;
      offsets.push({ ox, oz, cost: Math.hypot(ox, oz) });
    }
  }
  offsets.sort((a, b) => a.cost - b.cost);
  return offsets.slice(0, A_STAR_NEIGHBOR_COUNT);
})();

const CAT_COLLISION = {
  catBodyRadius: 0.26,
  pickupRadiusBoost: 0.1,
};
const CAT_PATH_CLEARANCE_EPSILON = 0.001;

const SPAWN_COUNTS = {
  laundry: 2,
  trash: 3,
};

const CUP_COLLISION = {
  radius: 0.11,
  topY: desk.topY + 0.015,
  catAvoidRadius: 0.34,
  waterRadius: 0.11,
  waterHeight: 0.27,
  waterCenterY: 0.14,
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

const cup = makeCup({ THREE, desk, CUP_COLLISION });
scene.add(cup.group);

makeRoomCorner(scene);
makeDesk(scene, desk);
makeBins({
  scene,
  hamper,
  trashCan,
  binVisuals,
  gltfLoader,
  trashCanModelCandidates: TRASH_CAN_MODEL_CANDIDATES,
});

catnipBtn.addEventListener("click", () => {
  if (game.state !== "playing") return;
  if (clockTime < game.catnipCooldownUntil) return;
  game.placeCatnipMode = true;
});

restartBtn.addEventListener("click", () => {
  resetGame();
});
if (debugBtnEl) {
  debugBtnEl.addEventListener("click", () => toggleDebugView());
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("keydown", onKeyDown);

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

const pickupsRuntime = createPickupsRuntime({
  THREE,
  CANNON,
  scene,
  camera,
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
  getClockTime: () => clockTime,
  onAllSorted: win,
});

const navRuntime = createCatNavigationRuntime({
  THREE,
  CAT_NAV,
  CAT_COLLISION,
  CAT_PATH_CLEARANCE_EPSILON,
  ASTAR_NEIGHBOR_OFFSETS,
  SWIPE_TIMING,
  ROOM,
  desk,
  hamper,
  trashCan,
  DESK_LEGS,
  DESK_JUMP_ANCHORS,
  CUP_COLLISION,
  pickups,
  cat,
  cup,
  game,
  pickupRadius: (pickup) => pickupsRuntime.pickupRadius(pickup),
  isDraggingPickup: (pickup) => pickupsRuntime.isDraggingPickup(pickup),
  clearCatNavPath,
  resetCatUnstuckTracking,
  getClockTime: () => clockTime,
});

const cupRuntime = createCupRuntime({
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
  getClockTime: () => clockTime,
});

const catnipRuntime = createCatnipRuntime({
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
  pickupRadius: (pickup) => pickupsRuntime.pickupRadius(pickup),
  buildCatObstacles: (...args) => navRuntime.buildCatObstacles(...args),
  isCatPointBlocked: (...args) => navRuntime.isCatPointBlocked(...args),
  canReachGroundTarget: (...args) => navRuntime.canReachGroundTarget(...args),
  findSafeGroundPoint: (...args) => navRuntime.findSafeGroundPoint(...args),
  getClockTime: () => clockTime,
});

const debugRuntime = createDebugOverlayRuntime({
  THREE,
  scene,
  physics,
  pickups,
  cat,
  cup,
  desk,
  ROOM,
  CAT_NAV,
  CAT_COLLISION,
  CUP_COLLISION,
  debugBtnEl,
  buildCatObstacles: (...args) => navRuntime.buildCatObstacles(...args),
  isCatPointBlocked: (...args) => navRuntime.isCatPointBlocked(...args),
  getCatPathClearance: (...args) => navRuntime.getCatPathClearance(...args),
  computeCatPath: (...args) => navRuntime.computeCatPath(...args),
});

const uiRuntime = createUIRuntime({
  sortedStatEl,
  catStateStatEl,
  cupStatEl,
  catnipStatEl,
  resultEl,
  game,
  cat,
  cup,
  getClockTime: () => clockTime,
});

setupPhysicsWorld({ CANNON, physics, DESK_LEGS, ROOM, desk, hamper, trashCan });
resetGame();
debugRuntime.initDebugView(clockTime);

const clock = new THREE.Clock();
animate();

window.addEventListener("resize", () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

function onKeyDown(event) {
  debugRuntime.onKeyDown(event, clockTime);
}

function initDebugView() {
  debugRuntime.initDebugView(clockTime);
}

function updateDebugView() {
  debugRuntime.updateDebugView(clockTime);
}

function toggleDebugView() {
  debugRuntime.toggleDebugView(clockTime);
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
    patrolTarget: new THREE.Vector3(1.5, 0, 1.7),
    nextTableRollAt: 0,
    tableRollStartAt: 0,
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
      debugDestination: new THREE.Vector3(1.5, 0, 1.7),
      path: [],
      index: 0,
      repathAt: 0,
      anchorReplanAt: 0,
      jumpNoClip: false,
      jumpBypassCheckAt: 0,
      steerYaw: NaN,
      pickupTrapT: 0,
      unstuckCheckAt: 0,
      unstuckCheckPos: new THREE.Vector3(1.5, 0, 1.7),
      stuckT: 0,
      lastSpeed: 0,
    },
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
  game.pendingLoseAt = null;
  game.placeCatnipMode = false;
  game.catnipCooldownUntil = 0;
  game.invalidCatnipUntil = 0;
  catnipRuntime.clearCatnip();

  cupRuntime.resetCup();

  cupRuntime.clearShatter();
  pickupsRuntime.resetInteraction();
  pickupsRuntime.clearAllPickups();
  const catSpawn = pickRandomCatSpawnPoint({
    camera,
    ROOM,
    CAT_NAV,
    desk,
    buildCatObstacles,
    getCatPathClearance,
    isCatPointBlocked,
    canReachGroundTarget,
  });
  addRandomPickups({
    catSpawn,
    camera,
    ROOM,
    CAT_NAV,
    CAT_COLLISION,
    SPAWN_COUNTS,
    buildCatObstacles,
    isCatPointBlocked,
    canReachGroundTarget,
    addPickup: pickupsRuntime.addPickup,
  });
  game.total = pickups.length;

  cat.pos.copy(catSpawn);
  cat.group.position.set(cat.pos.x, 0, cat.pos.z);
  cat.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
  cat.state = "patrol";
  cat.lastState = "patrol";
  cat.stateT = 0;
  cat.status = "Patrolling";
  cat.onTable = false;
  cat.tableRollStartAt = clockTime + CAT_BEHAVIOR.initialRollDelay;
  cat.nextTableRollAt = cat.tableRollStartAt;
  cat.walkT = 0;
  cat.motionBlend = 0;
  cat.phaseT = 0;
  cat.swipeHitDone = false;
  cat.jump = null;
  clearCatJumpTargets();
  cat.nav.goal.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.debugDestination.set(cat.pos.x, 0, cat.pos.z);
  clearCatNavPath(true);
  cat.nav.anchorReplanAt = 0;
  resetCatJumpBypass();
  resetCatUnstuckTracking();
  cat.nav.stuckT = 0;
  cat.nav.lastSpeed = 0;
  cat.modelAnchor.position.set(0, 0, 0);
  cat.modelAnchor.rotation.set(0, 0, 0);
  refreshCatPatrolTarget();
}

function clearCatJumpTargets(clearAnchor = true) {
  if (clearAnchor) cat.jumpAnchor = null;
  cat.jumpTargets = null;
  cat.jumpApproachLock = false;
}

function clearCatNavPath(resetRepath = false) {
  cat.nav.path.length = 0;
  cat.nav.index = 0;
  if (resetRepath) cat.nav.repathAt = 0;
}

function resetCatJumpBypass() {
  cat.nav.jumpNoClip = false;
  cat.nav.jumpBypassCheckAt = 0;
}

function resetCatUnstuckTracking() {
  cat.nav.steerYaw = NaN;
  cat.nav.pickupTrapT = 0;
  cat.nav.unstuckCheckAt = clockTime;
  cat.nav.unstuckCheckPos.copy(cat.pos);
}

function refreshCatPatrolTarget() {
  cat.patrolTarget.copy(pickRandomPatrolPoint(cat.pos));
}

function pickupRadius(pickup) {
  return pickupsRuntime.pickupRadius(pickup);
}

function isDraggingPickup(pickup) {
  return pickupsRuntime.isDraggingPickup(pickup);
}

function onPointerDown(event) {
  if (game.state !== "playing") return;
  setMouseFromEvent(event);

  if (game.placeCatnipMode) {
    placeCatnipFromMouse();
    return;
  }

  pickupsRuntime.onPointerDown(event);
}

function onPointerMove(event) {
  pickupsRuntime.onPointerMove(event);
}

function onPointerUp() {
  pickupsRuntime.onPointerUp();
}

function updatePickups(dt) {
  pickupsRuntime.updatePickups(dt);
}

function setMouseFromEvent(event) {
  catnipRuntime.setMouseFromEvent(event);
}

function placeCatnipFromMouse() {
  catnipRuntime.placeCatnipFromMouse();
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
  return navRuntime.buildCatObstacles(includePickups, includeClosePickups);
}

function isCatPointBlocked(x, z, obstacles, clearance = CAT_NAV.clearance) {
  return navRuntime.isCatPointBlocked(x, z, obstacles, clearance);
}

function getCatPathClearance() {
  return navRuntime.getCatPathClearance();
}

function hasClearTravelLine(a, b, obstacles, clearance = CAT_NAV.clearance) {
  return navRuntime.hasClearTravelLine(a, b, obstacles, clearance);
}

function computeCatPath(start, goal, obstacles) {
  return navRuntime.computeCatPath(start, goal, obstacles);
}

function canReachGroundTarget(start, goal, obstacles) {
  return navRuntime.canReachGroundTarget(start, goal, obstacles);
}

function ensureCatPath(target, force = false, useDynamic = false) {
  return navRuntime.ensureCatPath(target, force, useDynamic);
}

function bestDeskJumpAnchor(from) {
  return navRuntime.bestDeskJumpAnchor(from);
}

function computeDeskJumpTargets(anchor) {
  return navRuntime.computeDeskJumpTargets(anchor);
}

function moveCatToward(target, dt, speed, yLevel, opts = {}) {
  return navRuntime.moveCatToward(target, dt, speed, yLevel, opts);
}

function findSafeGroundPoint(preferred) {
  return navRuntime.findSafeGroundPoint(preferred);
}

function pickRandomPatrolPoint(from = cat.pos) {
  return navRuntime.pickRandomPatrolPoint(from);
}

function sampleSwipePose(t) {
  return navRuntime.sampleSwipePose(t);
}

function recoverCatFromPickupTrap(dt) {
  return navRuntime.recoverCatFromPickupTrap(dt);
}

function nudgeBlockingPickupAwayFromCat() {
  return navRuntime.nudgeBlockingPickupAwayFromCat();
}

function getCurrentGroundGoal() {
  return navRuntime.getCurrentGroundGoal();
}

function keepCatAwayFromCup(minDist = CUP_COLLISION.catAvoidRadius) {
  return navRuntime.keepCatAwayFromCup(minDist);
}

function knockCup() {
  cupRuntime.knockCup();
}

function updateCup(dt) {
  cupRuntime.updateCup(dt);
}

function updateShatter(dt) {
  cupRuntime.updateShatter(dt);
}

function updateCat(dt) {
  return updateCatStateMachineRuntime(
    {
      THREE,
      scene,
      clockTime,
      game,
      cat,
      CAT_NAV,
      CAT_BEHAVIOR,
      cup,
      desk,
      JUMP_UP_TIMING,
      CUP_COLLISION,
      recoverCatFromPickupTrap,
      getCurrentGroundGoal,
      ensureCatPath,
      nudgeBlockingPickupAwayFromCat,
      findSafeGroundPoint,
      startJump,
      updateJump,
      clearCatJumpTargets,
      moveCatToward,
      refreshCatPatrolTarget,
      bestDeskJumpAnchor,
      clearCatNavPath,
      resetCatJumpBypass,
      buildCatObstacles,
      canReachGroundTarget,
      hasClearTravelLine,
      computeDeskJumpTargets,
      keepCatAwayFromCup,
      knockCup,
      sampleSwipePose,
      resetCatUnstuckTracking,
      setCatClipSpecialPose,
      updateCatClipLocomotion,
      setBonePose,
    },
    dt
  );
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
  uiRuntime.updateUI();
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

  updateDebugView();
  controls.update();
  updateUI();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
