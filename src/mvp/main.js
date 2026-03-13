import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "./vendor/cannon-es.js";
import { makeBins, makeChair, makeDesk, makeHoverShelf, makeRoomCorner, makeShelf, makeWindowSill } from "./modules/room.js";
import { setupPhysicsWorld } from "./modules/physics.js";
import { addRandomPickups, pickRandomCatSpawnPoint, spawnRandomPickup } from "./modules/spawning.js";
import { updateCatStateMachineRuntime } from "./modules/cat-state-machine.js";
import { createPickupsRuntime } from "./modules/pickups.js";
import { createCatNavigationRuntime } from "./modules/cat-navigation.js";
import { createDebugOverlayRuntime } from "./modules/debug-overlay.js";
import { makeCup, createCupRuntime } from "./modules/cup-system.js";
import { createCatnipRuntime } from "./modules/catnip-system.js";
import { createUIRuntime } from "./modules/ui-system.js";
import { createCatModelRuntime } from "./modules/cat-model-loader.js";
import { createDebugControlsRuntime } from "./modules/debug-controls.js";
import { createMainDebugCameraRuntime } from "./modules/main-debug-camera.js";

// --- UI screens ---
const startMenu = document.getElementById("startMenu");
const endMenu = document.getElementById("endMenu");

const playBtn = document.getElementById("playBtn");
const quitBtn = document.getElementById("quitBtn");
const replayBtn = document.getElementById("replayBtn");
const startModeBtn = document.getElementById("startModeBtn");

const hud = document.getElementById("hud");

// Hide HUD until game starts
hud.style.display = "none";

// Play button
playBtn.addEventListener("click", () => {
  resetGame();
  game.state = "playing";
  startMenu.classList.add("hidden");
  hud.style.display = "block";
});
//Connect Button
startModeBtn.addEventListener("click", () => {

  // toggle the mode directly
  game.endlessMode = !game.endlessMode;

  // update start menu label
  if (game.endlessMode) {
    startModeBtn.textContent = "Mode: Endless";
  } else {
    startModeBtn.textContent = "Mode: Casual";
  }

});

// Quit button
quitBtn.addEventListener("click", () => {
  window.close();

  // fallback if browser blocks closing
  alert("Thanks for playing!");
});

// Replay button
replayBtn.addEventListener("click", () => {
  resetGame();
  game.state = "menu";
  endMenu.classList.add("hidden");
  startMenu.classList.remove("hidden");
  hud.style.display = "none";
});

const sortedStatEl = document.getElementById("sortedStat");
const endMenuEl = document.getElementById("endMenu");
const endTitleEl = document.getElementById("endTitle");
const catStateStatEl = document.getElementById("catStateStat");
const cupStatEl = document.getElementById("cupStat");
const catnipStatEl = document.getElementById("catnipStat");
const windowStatEl = document.getElementById("windowStat");
const resultEl = document.getElementById("result");
const catnipBtn = document.getElementById("catnipBtn");
const windowBtn = document.getElementById("windowBtn");
const restartBtn = document.getElementById("restartBtn");
const modeBtnEl = document.getElementById("modeBtn");
const debugBtnEl = document.getElementById("debugBtn");
const messFillEl = document.getElementById("messFill");
const messValueEl = document.getElementById("messValue");
const modeStatEl = document.getElementById("modeStat");

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

const chair = {
  pos: new THREE.Vector3(0.45, 0, -1.65),
  sizeX: 0.92,
  sizeZ: 0.86,
  seatY: 0.68,
  seatThickness: 0.08,
  legHalfX: 0.05,
  legHalfZ: 0.05,
  legInsetX: 0.31,
  legInsetZ: 0.28,
  backHeight: 0.82,
  backThickness: 0.08,
};

const shelf = {
  pos: new THREE.Vector3(-2.70, 0, -5.40),
  width: 2.35,
  depth: 0.92,
  postHalf: 0.045,
  surfaceY: 1.22,
  boardThickness: 0.09,
};

const hoverShelf = {
  id: "hoverShelf",
  // Pulled closer to desk span while shifting away from the cup side.
  pos: new THREE.Vector3(0.10, 0, -3.05),
  width: 1.25,
  depth: 0.9,
  // Keep this much higher so floor->hoverShelf jump links are invalid.
  surfaceY: desk.topY * 2,
  thickness: 0.08,
};

const windowSill = {
  id: "windowSill",
  // To the right of shelf, slightly above it.
  pos: new THREE.Vector3(-1.15, 0, -5.51),
  width: 1.18,
  depth: 0.78,
  thickness: 0.06,
  surfaceY: shelf.surfaceY + 0.24,
  wallZ: -5.98,
  windowWidth: 1.24,
  windowHeight: 0.94,
  openingCenterY: shelf.surfaceY + 0.66,
  openDuration: 20,
  sitPoint: new THREE.Vector3(-1.15, 0, -5.51),
  outsideYaw: Math.PI,
};

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
  state: "menu", // playing | lost | won
  timeScale: 1.0,
  endlessMode: false,
  reason: "",
  sorted: 0,
  total: 0,
  mess: 0,
  elapsed: 0,
  laundrySpawnBudget: 0,
  trashSpawnBudget: 0,
  pendingLoseAt: null,
  catnip: null, // {mesh,pos,expiresAt}
  catnipCooldownUntil: 0,
  catnipNoRouteUntil: 0,
  placeCatnipMode: false,
  invalidCatnipUntil: 0,
  windowOpenUntil: 0,
};

const pickups = [];
const shatterBits = [];
let clockTime = 0;
const SIMULATION_HZ = 120;
const SIMULATION_DT = 1 / SIMULATION_HZ;
const MAX_FRAME_DT = 0.1;
const MAX_SIM_STEPS_PER_FRAME = 12;
let simAccumulator = 0;

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
const tempTo = new THREE.Vector3();

const CAT_NAV = {
  step: 0.26,
  margin: 0.4,
  clearance: 0.2,
  useDetourCrowd: true,
  detourSpeedScale: 0.8,
  detourArriveSnapRadius: 0.1,
  detourLeadRadius: 0.9,
  detourLeadDistance: 0.45,
  locomotionSpeedScale: 3.0,
  locomotionScaleCap: 8.0,
  repathInterval: 0.18,
  jumpBypassCheckInterval: 0.18,
  stuckSpeed: 0.035,
  stuckReset: 2.8,
  maxTurnRate: 2.5, // rad/sec
  accel: 3.2, // m/s^2
  decel: 5.2, // m/s^2
  locomotionSwitchHold: 0.16,
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
  trash: 2,
};

const ENDLESS_SPAWN = {
  laundryRateStart: 1 / 20, // once every 20s
  trashRateStart: 1 / 12, // once every 12s
  laundryRateRamp: 1 / 400, // +0.0025 per second
  trashRateRamp: 1 / 240, // +0.0042 per second
  messPerItem: 10,
  loseThreshold: 100,
  maxSpawnAttemptsPerFrame: 6,
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

const catModelRuntime = createCatModelRuntime({
  THREE,
  gltfLoader,
  catModelCandidates: CAT_MODEL_CANDIDATES,
  catModelYawOffset: CAT_MODEL_YAW_OFFSET,
});

const cat = catModelRuntime.buildCat();
scene.add(cat.group);
catModelRuntime.loadCatModel(cat);

const cup = makeCup({ THREE, desk, CUP_COLLISION });
scene.add(cup.group);

makeRoomCorner(scene, {
  windowOpening: {
    centerX: windowSill.pos.x,
    centerY: windowSill.openingCenterY,
    width: windowSill.windowWidth + 0.04,
    height: windowSill.windowHeight + 0.04,
  },
});
makeDesk(scene, desk);
makeChair(scene, chair);
makeShelf(scene, shelf);
makeHoverShelf(scene, hoverShelf);
const windowSillRuntime = makeWindowSill(scene, windowSill);
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
if (windowBtn) {
  windowBtn.addEventListener("click", () => {
    if (game.state !== "playing") return;
    if (clockTime < game.windowOpenUntil) return;
    game.placeCatnipMode = false;
    game.windowOpenUntil = clockTime + windowSill.openDuration;
  });
}

restartBtn.addEventListener("click", () => {

  game.state = "menu";

  requestAnimationFrame(() => {
    resetGame();
    game.state = "playing";
  });

});
if (modeBtnEl) {
    modeBtnEl.addEventListener("click", () => {

    game.state = "menu";

    game.endlessMode = !game.endlessMode;

    requestAnimationFrame(() => {
      resetGame();
      game.state = "playing";
    });
  }
)};
if (debugBtnEl) {
  debugBtnEl.addEventListener("click", () => toggleDebugView());
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", onCanvasContextMenu);
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

const CHAIR_LEGS = [
  { x: chair.pos.x - chair.legInsetX, z: chair.pos.z - chair.legInsetZ, halfX: chair.legHalfX, halfZ: chair.legHalfZ, topY: chair.seatY - chair.seatThickness },
  { x: chair.pos.x + chair.legInsetX, z: chair.pos.z - chair.legInsetZ, halfX: chair.legHalfX, halfZ: chair.legHalfZ, topY: chair.seatY - chair.seatThickness },
  { x: chair.pos.x - chair.legInsetX, z: chair.pos.z + chair.legInsetZ, halfX: chair.legHalfX, halfZ: chair.legHalfZ, topY: chair.seatY - chair.seatThickness },
  { x: chair.pos.x + chair.legInsetX, z: chair.pos.z + chair.legInsetZ, halfX: chair.legHalfX, halfZ: chair.legHalfZ, topY: chair.seatY - chair.seatThickness },
];

const CHAIR_BACK_COLLIDER = {
  x: chair.pos.x,
  z: chair.pos.z - chair.sizeZ * 0.5 + chair.backThickness * 0.5,
  halfX: chair.sizeX * 0.5,
  halfZ: chair.backThickness * 0.5,
  y: chair.seatY + chair.backHeight * 0.5 - chair.seatThickness * 0.5,
  h: chair.backHeight,
};

const SHELF_POSTS = (() => {
  const insetX = shelf.width * 0.5 - shelf.postHalf;
  const insetZ = shelf.depth * 0.5 - shelf.postHalf;
  return [
    { x: shelf.pos.x - insetX, z: shelf.pos.z - insetZ, halfX: shelf.postHalf, halfZ: shelf.postHalf, topY: shelf.surfaceY - shelf.boardThickness },
    { x: shelf.pos.x + insetX, z: shelf.pos.z - insetZ, halfX: shelf.postHalf, halfZ: shelf.postHalf, topY: shelf.surfaceY - shelf.boardThickness },
    { x: shelf.pos.x - insetX, z: shelf.pos.z + insetZ, halfX: shelf.postHalf, halfZ: shelf.postHalf, topY: shelf.surfaceY - shelf.boardThickness },
    { x: shelf.pos.x + insetX, z: shelf.pos.z + insetZ, halfX: shelf.postHalf, halfZ: shelf.postHalf, topY: shelf.surfaceY - shelf.boardThickness },
  ];
})();

const SHELF_BACK_COLLIDER = {
  x: shelf.pos.x,
  z: shelf.pos.z - shelf.depth * 0.5 + 0.02,
  halfX: shelf.width * 0.5,
  halfZ: 0.02,
  y: (shelf.surfaceY + 0.2) * 0.5 - shelf.boardThickness * 0.5,
  h: shelf.surfaceY - 0.2 + 0.08,
};

const EXTRA_NAV_OBSTACLES = [
  ...CHAIR_LEGS.map((leg) => ({
    kind: "box",
    x: leg.x,
    z: leg.z,
    hx: leg.halfX + 0.03,
    hz: leg.halfZ + 0.03,
    navPad: 0.03,
    // Allow jump links to/from the chair seat to ignore chair legs only.
    jumpIgnoreSurfaceIds: ["chair"],
    y: leg.topY * 0.5,
    h: leg.topY + 0.04,
  })),
  {
    kind: "box",
    x: CHAIR_BACK_COLLIDER.x,
    z: CHAIR_BACK_COLLIDER.z,
    hx: CHAIR_BACK_COLLIDER.halfX + 0.02,
    hz: CHAIR_BACK_COLLIDER.halfZ + 0.02,
    navPad: 0.02,
    y: CHAIR_BACK_COLLIDER.y,
    h: CHAIR_BACK_COLLIDER.h + 0.04,
  },
  ...SHELF_POSTS.map((post) => ({
    kind: "box",
    x: post.x,
    z: post.z,
    hx: post.halfX + 0.02,
    hz: post.halfZ + 0.02,
    navPad: 0.02,
    // Allow jump links to/from the shelf top to ignore shelf posts only.
    jumpIgnoreSurfaceIds: ["shelf"],
    y: post.topY * 0.5,
    h: post.topY + 0.04,
  })),
  {
    kind: "box",
    x: SHELF_BACK_COLLIDER.x,
    z: SHELF_BACK_COLLIDER.z,
    hx: SHELF_BACK_COLLIDER.halfX + 0.02,
    hz: SHELF_BACK_COLLIDER.halfZ + 0.02,
    navPad: 0.02,
    y: SHELF_BACK_COLLIDER.y,
    h: SHELF_BACK_COLLIDER.h + 0.04,
  },
];

const EXTRA_STATIC_BOXES = [
  ...CHAIR_LEGS.map((leg) => ({
    x: leg.x,
    y: leg.topY * 0.5,
    z: leg.z,
    hx: leg.halfX,
    hy: leg.topY * 0.5,
    hz: leg.halfZ,
  })),
  {
    x: chair.pos.x,
    y: chair.seatY - chair.seatThickness * 0.5,
    z: chair.pos.z,
    hx: chair.sizeX * 0.5,
    hy: chair.seatThickness * 0.5,
    hz: chair.sizeZ * 0.5,
  },
  {
    x: CHAIR_BACK_COLLIDER.x,
    y: CHAIR_BACK_COLLIDER.y,
    z: CHAIR_BACK_COLLIDER.z,
    hx: CHAIR_BACK_COLLIDER.halfX,
    hy: CHAIR_BACK_COLLIDER.h * 0.5,
    hz: CHAIR_BACK_COLLIDER.halfZ,
  },
  ...SHELF_POSTS.map((post) => ({
    x: post.x,
    y: post.topY * 0.5,
    z: post.z,
    hx: post.halfX,
    hy: post.topY * 0.5,
    hz: post.halfZ,
  })),
  {
    x: shelf.pos.x,
    y: shelf.surfaceY - shelf.boardThickness * 0.5,
    z: shelf.pos.z,
    hx: shelf.width * 0.5,
    hy: shelf.boardThickness * 0.5,
    hz: shelf.depth * 0.5,
  },
  {
    x: SHELF_BACK_COLLIDER.x,
    y: SHELF_BACK_COLLIDER.y,
    z: SHELF_BACK_COLLIDER.z,
    hx: SHELF_BACK_COLLIDER.halfX,
    hy: SHELF_BACK_COLLIDER.h * 0.5,
    hz: SHELF_BACK_COLLIDER.halfZ,
  },
  {
    x: windowSill.pos.x,
    y: windowSill.surfaceY - windowSill.thickness * 0.5,
    z: windowSill.pos.z,
    hx: windowSill.width * 0.5,
    hy: windowSill.thickness * 0.5,
    hz: windowSill.depth * 0.5,
  },
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
  addMess,
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
  EXTRA_NAV_OBSTACLES,
  CUP_COLLISION,
  pickups,
  cat,
  cup,
  game,
  pickupRadius: (pickup) => pickupsRuntime.pickupRadius(pickup),
  isDraggingPickup: (pickup) => pickupsRuntime.isDraggingPickup(pickup),
  getElevatedSurfaceDefs,
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
  pickups,
  pickupRadius: (pickup) => pickupsRuntime.pickupRadius(pickup),
  isDraggingPickup: (pickup) => pickupsRuntime.isDraggingPickup(pickup),
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
  tempTo,
  ROOM,
  CAT_NAV,
  game,
  cat,
  cup,
  desk,
  pickups,
  pickupRadius: (pickup) => pickupsRuntime.pickupRadius(pickup),
  buildCatObstacles: navRuntime.buildCatObstacles,
  isCatPointBlocked: navRuntime.isCatPointBlocked,
  getCatPathClearance: navRuntime.getCatPathClearance,
  canReachGroundTarget: navRuntime.canReachGroundTarget,
  findSafeGroundPoint: navRuntime.findSafeGroundPoint,
  bestDeskJumpAnchor: navRuntime.bestDeskJumpAnchor,
  bestSurfaceJumpAnchor: navRuntime.bestSurfaceJumpAnchor,
  computeSurfaceJumpTargets: navRuntime.computeSurfaceJumpTargets,
  getElevatedSurfaceDefs,
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
  pickupRadius: (pickup) => pickupsRuntime.pickupRadius(pickup),
  ROOM,
  CAT_NAV,
  CAT_COLLISION,
  CUP_COLLISION,
  debugBtnEl,
  buildCatObstacles: navRuntime.buildCatObstacles,
  isCatPointBlocked: navRuntime.isCatPointBlocked,
  getCatPathClearance: navRuntime.getCatPathClearance,
  getNavMeshDebugData: navRuntime.getNavMeshDebugData,
  getActiveNavMeshDebugData: navRuntime.getActiveNavMeshDebugData,
  getLastAStarDebugData: navRuntime.getLastAStarDebugData,
  computeCatPath: navRuntime.computeCatPath,
  computeDeskJumpTargets: navRuntime.computeDeskJumpTargets,
  getSurfaceJumpDebugData: navRuntime.getSurfaceJumpDebugData,
  getDeskDesiredTarget: () => getDeskDesiredTarget(),
  getTimeScale: () => game.timeScale,
  setTimeScale: (value) => {
    const v = Number.isFinite(value) ? value : 1;
    game.timeScale = THREE.MathUtils.clamp(v, 0, 2);
  },
});

const debugControlsRuntime = createDebugControlsRuntime({
  THREE,
  scene,
  camera,
  raycaster,
  mouse,
  floorPlane,
  tempV3,
  ROOM,
  CAT_NAV,
  CAT_COLLISION,
  desk,
  cat,
  cup,
  pickups,
  game,
  navRuntime,
  getDebugRoot: () => debugRuntime.root,
  clearCatJumpTargets,
  clearCatNavPath,
  resetCatJumpBypass,
  resetCatUnstuckTracking,
  getElevatedSurfaceDefs,
});
const debugCameraRuntime = createMainDebugCameraRuntime({
  THREE,
  camera,
  controls,
  debugRuntime,
  debugControlsRuntime,
  game,
  getClockTime: () => clockTime,
});

window.addEventListener("keydown", debugCameraRuntime.onKeyDown);
window.addEventListener("keyup", debugCameraRuntime.onKeyUp);
window.addEventListener("blur", debugCameraRuntime.resetDebugCameraInput);

const uiRuntime = createUIRuntime({
  sortedStatEl,
  catStateStatEl,
  cupStatEl,
  catnipStatEl,
  windowStatEl,
  windowBtnEl: windowBtn,
  resultEl,
  game,
  cat,
  cup,
  endMenuEl,
  endTitleEl,
  getClockTime: () => clockTime,
});

setupPhysicsWorld({
  CANNON,
  physics,
  DESK_LEGS,
  ROOM,
  desk,
  hamper,
  trashCan,
  EXTRA_STATIC_BOXES,
});
await navRuntime.initPathfinding();
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

function updateDebugView() {
  debugRuntime.updateDebugView(clockTime);
}

function toggleDebugView() {
  debugRuntime.toggleDebugView(clockTime);
}
function addMess(amount) {
  game.mess = Math.max(0, game.mess + amount);
}

function spawnPickupOfType(type) {
  const reachStart = cat.onTable ? navRuntime.findSafeGroundPoint(desk.approach) : cat.pos;
  const spawned = spawnRandomPickup({
    type,
    catSpawn: reachStart,
    camera,
    ROOM,
    CAT_NAV,
    CAT_COLLISION,
    pickups,
    pickupRadius,
    buildCatObstacles: navRuntime.buildCatObstacles,
    isCatPointBlocked: navRuntime.isCatPointBlocked,
    canReachGroundTarget: navRuntime.canReachGroundTarget,
    addPickup: pickupsRuntime.addPickup,
  });
  if (!spawned) return false;
  game.total += 1;
  addMess(ENDLESS_SPAWN.messPerItem);
  return true;
}

function updateEndlessSpawning(dt) {
  if (!game.endlessMode || game.state !== "playing") return;

  game.elapsed += dt;
  const laundryRate = ENDLESS_SPAWN.laundryRateStart + game.elapsed * ENDLESS_SPAWN.laundryRateRamp;
  const trashRate = ENDLESS_SPAWN.trashRateStart + game.elapsed * ENDLESS_SPAWN.trashRateRamp;
  game.laundrySpawnBudget += laundryRate * dt;
  game.trashSpawnBudget += trashRate * dt;

  let attempts = 0;
  while (game.laundrySpawnBudget >= 1 && attempts < ENDLESS_SPAWN.maxSpawnAttemptsPerFrame) {
    game.laundrySpawnBudget -= 1;
    spawnPickupOfType("laundry");
    attempts++;
  }
  while (game.trashSpawnBudget >= 1 && attempts < ENDLESS_SPAWN.maxSpawnAttemptsPerFrame) {
    game.trashSpawnBudget -= 1;
    spawnPickupOfType("trash");
    attempts++;
  }
}

function resetGame() {
  game.state = "menu";
  game.reason = "";
  game.sorted = 0;
  game.mess = 0;
  game.elapsed = 0;
  game.laundrySpawnBudget = 0;
  game.trashSpawnBudget = 0;
  game.pendingLoseAt = null;
  game.placeCatnipMode = false;
  game.catnipCooldownUntil = 0;
  game.catnipNoRouteUntil = 0;
  game.invalidCatnipUntil = 0;
  game.windowOpenUntil = 0;
  catnipRuntime.clearCatnip();
  windowSillRuntime.setOpenAmount(0);

  cupRuntime.resetCup();

  cupRuntime.clearShatter();
  pickupsRuntime.resetInteraction();
  pickupsRuntime.clearAllPickups();
  const catSpawn = pickRandomCatSpawnPoint({
    camera,
    ROOM,
    CAT_NAV,
    desk,
    buildCatObstacles: navRuntime.buildCatObstacles,
    getCatPathClearance: navRuntime.getCatPathClearance,
    isCatPointBlocked: navRuntime.isCatPointBlocked,
    canReachGroundTarget: navRuntime.canReachGroundTarget,
  });
  addRandomPickups({
    catSpawn,
    camera,
    ROOM,
    CAT_NAV,
    CAT_COLLISION,
    SPAWN_COUNTS,
    buildCatObstacles: navRuntime.buildCatObstacles,
    isCatPointBlocked: navRuntime.isCatPointBlocked,
    canReachGroundTarget: navRuntime.canReachGroundTarget,
    addPickup: pickupsRuntime.addPickup,
  });
  game.total = pickups.length;
  game.mess = pickups.length * ENDLESS_SPAWN.messPerItem;

  cat.pos.copy(catSpawn);
  cat.group.position.set(cat.pos.x, 0, cat.pos.z);
  cat.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
  cat.state = "patrol";
  cat.lastState = "patrol";
  cat.stateT = 0;
  cat.status = "Patrolling";
  cat.onTable = false;
  cat.debugMoveActive = false;
  cat.debugMoveSurface = "floor";
  cat.debugMoveSurfaceId = "floor";
  cat.debugMoveFinalSurfaceId = "floor";
  cat.debugMoveY = 0;
  cat.debugMoveFinalY = 0;
  cat.debugMoveJumpAnchor.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveLanding.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveJumpOff.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveJumpDown.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveJumpDownY = 0;
  cat.debugMoveDirectJump = false;
  cat.debugMoveSitSeconds = 0;
  cat.debugMoveTarget.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveFinalTarget.set(cat.pos.x, 0, cat.pos.z);
  cat.tableRoamTarget.set(desk.pos.x, 0, desk.pos.z);
  cat.nextTableRoamAt = 0;
  cat.tableRollStartAt = clockTime + CAT_BEHAVIOR.initialRollDelay;
  cat.nextTableRollAt = cat.tableRollStartAt;
  cat.manualPatrolActive = false;
  cat.walkT = 0;
  cat.motionBlend = 0;
  cat.phaseT = 0;
  cat.sitDuration = 1.25;
  cat.swipeHitDone = false;
  cat.jump = null;
  cat.landStopNextState = "patrol";
  cat.landStopDuration = 0.22;
  cat.clipSpecialState = "";
  cat.clipSpecialPhase = "";
  if (cat.clipSpecialAction) {
    cat.clipSpecialAction.stop();
    cat.clipSpecialAction = null;
  }
  clearCatJumpTargets();
  cat.nav.goal.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.debugDestination.set(cat.pos.x, 0, cat.pos.z);
  clearCatNavPath(true);
  cat.nav.anchorReplanAt = 0;
  cat.nav.anchorLandingCheckAt = 0;
  cat.nav.lastSurfaceHopFrom = "";
  cat.nav.lastSurfaceHopTo = "";
  cat.nav.lastSurfaceHopAt = 0;
  if (Array.isArray(cat.nav.surfaceHopTrail)) cat.nav.surfaceHopTrail.length = 0;
  else cat.nav.surfaceHopTrail = [];
  cat.nav.jumpDownPlanAt = 0;
  cat.nav.jumpDownPlanValid = false;
  cat.nav.jumpDownNoMoveT = 0;
  cat.nav.jumpDownLandingSurfaceId = null;
  cat.nav.jumpDownDebug = {};
  resetCatJumpBypass();
  resetCatUnstuckTracking();
  cat.nav.stuckT = 0;
  cat.nav.lastSpeed = 0;
  cat.nav.commandedSpeed = 0;
  cat.nav.driveSpeed = 0;
  cat.nav.speedNorm = 0;
  cat.nav.smoothedSpeed = 0;
  cat.nav.turnBias = 0;
  cat.nav.turnDirLock = 0;
  cat.nav.locomotionHoldT = 0;
  cat.nav.catnipPathCheckAt = 0;
  cat.nav.catnipUseExactTarget = false;
  cat.nav.windowPathCheckAt = 0;
  cat.nav.windowHoldActive = false;
  if (cat.locomotion) {
    cat.locomotion.activeClip = "idle";
    cat.locomotion.clipScale = 0;
  }
  cat.modelAnchor.position.set(0, 0, 0);
  cat.modelAnchor.rotation.set(0, 0, 0);
  refreshCatPatrolTarget();
  simAccumulator = 0;
}

function clearCatJumpTargets(clearAnchor = true) {
  if (clearAnchor) cat.jumpAnchor = null;
  cat.jumpTargets = null;
  cat.jumpApproachLock = false;
}

function clearCatNavPath(resetRepath = false) {
  cat.nav.path.length = 0;
  cat.nav.index = 0;
  if (resetRepath) {
    cat.nav.repathAt = 0;
    navRuntime.resetDetourCrowd?.();
  }
}

function resetCatJumpBypass() {
  cat.nav.jumpNoClip = false;
  cat.nav.jumpBypassCheckAt = 0;
}

function getDeskDesiredTarget() {
  if (game.catnip && game.catnip.surface === "desk") return game.catnip.pos;
  if (!cup.broken && !cup.falling) return cup.group.position;
  return desk.perch;
}

function resetCatUnstuckTracking() {
  cat.nav.steerYaw = NaN;
  cat.nav.pickupTrapT = 0;
  cat.nav.unstuckCheckAt = clockTime;
  cat.nav.unstuckCheckPos.copy(cat.pos);
}

function refreshCatPatrolTarget() {
  cat.patrolTarget.copy(navRuntime.pickRandomPatrolPoint(cat.pos));
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

  if (event.button === 2 && debugRuntime.isDebugVisible()) {
    event.preventDefault();
    debugControlsRuntime.moveCatToDebugClickTarget();
    return;
  }

  if (game.placeCatnipMode) {
    placeCatnipFromMouse();
    return;
  }

  pickupsRuntime.onPointerDown(event);
}

function onCanvasContextMenu(event) {
  if (!debugRuntime.isDebugVisible()) return;
  event.preventDefault();
}

function onPointerMove(event) {
  setMouseFromEvent(event);
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

function getElevatedSurfaceDefs(includeDesk = true) {
  const surfaces = [];
  if (includeDesk) {
    surfaces.push({
      id: "desk",
      name: "desk",
      // Outer perimeter = real tabletop perimeter.
      minX: desk.pos.x - desk.sizeX * 0.5,
      maxX: desk.pos.x + desk.sizeX * 0.5,
      minZ: desk.pos.z - desk.sizeZ * 0.5,
      maxZ: desk.pos.z + desk.sizeZ * 0.5,
      y: desk.topY + 0.02,
    });
  }
  surfaces.push({
    id: "chair",
    name: "chair",
    minX: chair.pos.x - chair.sizeX * 0.5,
    maxX: chair.pos.x + chair.sizeX * 0.5,
    minZ: chair.pos.z - chair.sizeZ * 0.5,
    maxZ: chair.pos.z + chair.sizeZ * 0.5,
    y: chair.seatY + 0.02,
  });
  surfaces.push({
    id: "shelf",
    name: "shelf",
    minX: shelf.pos.x - shelf.width * 0.5,
    maxX: shelf.pos.x + shelf.width * 0.5,
    minZ: shelf.pos.z - shelf.depth * 0.5,
    maxZ: shelf.pos.z + shelf.depth * 0.5,
    y: shelf.surfaceY + 0.02,
  });
  surfaces.push({
    id: hoverShelf.id,
    name: hoverShelf.id,
    minX: hoverShelf.pos.x - hoverShelf.width * 0.5,
    maxX: hoverShelf.pos.x + hoverShelf.width * 0.5,
    minZ: hoverShelf.pos.z - hoverShelf.depth * 0.5,
    maxZ: hoverShelf.pos.z + hoverShelf.depth * 0.5,
    y: hoverShelf.surfaceY + 0.02,
  });
  surfaces.push({
    id: windowSill.id,
    name: windowSill.id,
    minX: windowSill.pos.x - windowSill.width * 0.5,
    maxX: windowSill.pos.x + windowSill.width * 0.5,
    minZ: windowSill.pos.z - windowSill.depth * 0.5,
    maxZ: windowSill.pos.z + windowSill.depth * 0.5,
    y: windowSill.surfaceY + 0.02,
  });
  return surfaces;
}

function computeJumpNoClipMinY(jump, x, z, progressU) {
  if (!jump || progressU >= 0.96) return null;
  const surfaces = getElevatedSurfaceDefs(true);
  if (!Array.isArray(surfaces) || surfaces.length === 0) return null;
  const pad = Math.max(0.08, CAT_COLLISION.catBodyRadius * 0.9);
  const jumpArc = Math.max(0.02, Number(jump.arc) || 0);
  const jumpTopY = Math.max(jump.fromY, jump.toY) + jumpArc;
  const jumpBottomY = Math.min(jump.fromY, jump.toY) - 0.08;
  let minY = -Infinity;
  for (const s of surfaces) {
    const sy = Number(s?.y);
    const minX = Number(s?.minX);
    const maxX = Number(s?.maxX);
    const minZ = Number(s?.minZ);
    const maxZ = Number(s?.maxZ);
    if (![sy, minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
    // Ignore surfaces that are clearly outside this jump's vertical travel band.
    // This prevents a low jump from being clamped up to an unrelated higher platform.
    if (sy > jumpTopY + 0.14 || sy < jumpBottomY - 0.14) continue;
    const targetIsThisSurface =
      Math.abs(sy - jump.toY) <= 0.14 &&
      jump.to.x >= minX - pad &&
      jump.to.x <= maxX + pad &&
      jump.to.z >= minZ - pad &&
      jump.to.z <= maxZ + pad;
    if (targetIsThisSurface) continue;
    const inside =
      x >= minX - pad &&
      x <= maxX + pad &&
      z >= minZ - pad &&
      z <= maxZ + pad;
    if (!inside) continue;
    minY = Math.max(minY, sy + 0.08);
  }
  return Number.isFinite(minY) ? minY : null;
}

function startJump(to, toY, dur, arc, nextState, opts = null) {
  const fromY = cat.group.position.y;
  const dropOrLevelJump = toY <= fromY + 0.03;
  const requestedNextState = nextState || "patrol";
  const resolvedNextState = dropOrLevelJump ? "landStop" : requestedNextState;
  let resolvedDur = dur;
  let preJumpDur = 0;
  const horizontalDist = Math.hypot(to.x - cat.pos.x, to.z - cat.pos.z);
  const downVerticalDist = Math.max(0, fromY - toY);
  const allowClamp = !!(opts && opts.allowClamp);
  if (dropOrLevelJump && requestedNextState !== "landStop") {
    cat.landStopNextState = requestedNextState;
  }
  if (dropOrLevelJump) {
    // Distance-aware down-jump timing:
    // shorter hops get shorter prep/air/land so clips transition earlier and smoother.
    const jumpSpan = horizontalDist + downVerticalDist * 0.75;
    const scaledPrepDur = THREE.MathUtils.clamp(0.14 + jumpSpan * 0.22, 0.14, 0.58);
    const scaledAirDur = THREE.MathUtils.clamp(0.22 + horizontalDist * 0.2 + downVerticalDist * 0.18, 0.2, 0.62);
    const scaledLandDur = THREE.MathUtils.clamp(0.12 + horizontalDist * 0.06 + downVerticalDist * 0.14, 0.12, 0.3);
    resolvedDur = scaledAirDur;
    preJumpDur = scaledPrepDur;
    cat.landStopDuration = scaledLandDur;
    // Force a fresh jump-down clip sequence (Edge_to -> Edge_from -> Land_stop)
    // when the actual drop starts, instead of continuing a stale preview pose.
    if (cat.clipSpecialAction) {
      cat.clipSpecialAction.stop();
      cat.clipSpecialAction = null;
    }
    cat.clipSpecialState = "";
    cat.clipSpecialPhase = "";
  } else {
    const disableUpPrep = !!(opts && opts.upPrep === false);
    if (!disableUpPrep) {
      const explicitUpPrepDur = Number(opts?.preDur);
      if (Number.isFinite(explicitUpPrepDur)) {
        preJumpDur = Math.max(0, explicitUpPrepDur);
      } else {
        // Default prep for up-jumps: Aim_U then Incline(40-48) before launch.
        preJumpDur = THREE.MathUtils.clamp(0.72 + horizontalDist * 0.12, 0.72, 0.95);
      }
    }
  }
  cat.jump = {
    from: cat.pos.clone(),
    to: to.clone(),
    fromY,
    toY,
    dur: resolvedDur,
    t: 0,
    preDur: preJumpDur,
    preT: 0,
    arc,
    nextState: resolvedNextState,
    allowClamp,
    easePos: !!(opts && opts.easePos),
    easeY: !!(opts && opts.easeY),
    avoidDeskClip: !!(opts && opts.avoidDeskClip),
  };
}

function updateJump(dt) {
  if (!cat.jump) return false;
  const isDownJump = cat.jump.toY <= cat.jump.fromY + 0.03;
  // Keep the cat oriented toward the jump destination during prep and airtime.
  const jumpDx = cat.jump.to.x - cat.jump.from.x;
  const jumpDz = cat.jump.to.z - cat.jump.from.z;
  if (jumpDx * jumpDx + jumpDz * jumpDz > 1e-6) {
    const jumpYaw = Math.atan2(jumpDx, jumpDz);
    const yawDelta = Math.atan2(
      Math.sin(jumpYaw - cat.group.rotation.y),
      Math.cos(jumpYaw - cat.group.rotation.y)
    );
    cat.group.rotation.y += yawDelta * Math.min(1, dt * 12.0);
  }
  let stepDt = dt;
  const hasPrep = (cat.jump.preDur || 0) > 1e-5;
  if (hasPrep && cat.jump.preT < cat.jump.preDur) {
    const remainPrep = Math.max(0, cat.jump.preDur - cat.jump.preT);
    const usedPrep = Math.min(stepDt, remainPrep);
    cat.jump.preT += usedPrep;
    stepDt -= usedPrep;
    cat.pos.copy(cat.jump.from);
    cat.group.position.set(cat.pos.x, cat.jump.fromY, cat.pos.z);
    if (cat.jump.preT < cat.jump.preDur - 1e-5) return false;
  }

  cat.jump.t += stepDt;
  const u = Math.min(1, cat.jump.t / cat.jump.dur);
  const uPos = cat.jump.easePos ? THREE.MathUtils.smootherstep(u, 0, 1) : u;
  let uY = u;
  if (cat.jump.easeY) {
    // Down-jumps need a softer launch so paws do not clip into the source surface.
    // Up-jumps keep the older snappier easing.
    uY = isDownJump ? THREE.MathUtils.smoothstep(u, 0, 1) : Math.pow(u, 0.74);
  }
  cat.pos.lerpVectors(cat.jump.from, cat.jump.to, uPos);
  let lift = Math.sin(Math.PI * u) * cat.jump.arc;
  if (isDownJump) {
    // Use an asymmetric arc for down-jumps: quick lift-off, faster settle.
    const apexU = 0.28;
    if (u <= apexU) {
      lift = cat.jump.arc * (u / Math.max(1e-5, apexU));
    } else {
      const downU = (u - apexU) / Math.max(1e-5, 1 - apexU);
      lift = cat.jump.arc * Math.pow(Math.max(0, 1 - downU), 1.8);
    }
  }
  let y = THREE.MathUtils.lerp(cat.jump.fromY, cat.jump.toY, uY) + lift;
  if (cat.jump.allowClamp) {
    const noClipMinY = computeJumpNoClipMinY(cat.jump, cat.pos.x, cat.pos.z, u);
    if (Number.isFinite(noClipMinY) && y < noClipMinY) y = noClipMinY;
    if (cat.jump.avoidDeskClip && y < desk.topY + 0.08) {
      const halfX = desk.sizeX * 0.5 + 0.12;
      const halfZ = desk.sizeZ * 0.5 + 0.12;
      if (Math.abs(cat.pos.x - desk.pos.x) <= halfX && Math.abs(cat.pos.z - desk.pos.z) <= halfZ) {
        y = desk.topY + 0.08;
      }
    }
  }
  cat.group.position.set(cat.pos.x, y, cat.pos.z);
  const downLandingReady = isDownJump && u >= 0.9 && y <= cat.jump.toY + 0.02;
  if (u >= 1 || downLandingReady) {
    cat.group.position.y = cat.jump.toY;
    const next = cat.jump.nextState;
    cat.jump = null;
    cat.state = next;
    return true;
  }
  return false;
}

function knockCup(...args) {
  cupRuntime.knockCup(...args);
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
      CAT_COLLISION,
      cup,
      desk,
      JUMP_UP_TIMING,
      CUP_COLLISION,
      pickups,
      pickupRadius,
      recoverCatFromPickupTrap: navRuntime.recoverCatFromPickupTrap,
      nudgeBlockingPickupAwayFromCat: navRuntime.nudgeBlockingPickupAwayFromCat,
      getCurrentGroundGoal: navRuntime.getCurrentGroundGoal,
      ensureCatPath: navRuntime.ensureCatPath,
      findSafeGroundPoint: navRuntime.findSafeGroundPoint,
      startJump,
      updateJump,
      clearCatJumpTargets,
      moveCatToward: navRuntime.moveCatToward,
      pickRandomPatrolPoint: navRuntime.pickRandomPatrolPoint,
      bestDeskJumpAnchor: navRuntime.bestDeskJumpAnchor,
      bestSurfaceJumpAnchor: navRuntime.bestSurfaceJumpAnchor,
      clearCatNavPath,
      resetCatJumpBypass,
      updateDebugJumpDownPlan: debugControlsRuntime.updateDebugJumpDownPlan,
      buildCatObstacles: navRuntime.buildCatObstacles,
      canReachGroundTarget: navRuntime.canReachGroundTarget,
      hasClearTravelLine: navRuntime.hasClearTravelLine,
      computeDeskJumpTargets: navRuntime.computeDeskJumpTargets,
      computeSurfaceJumpTargets: navRuntime.computeSurfaceJumpTargets,
      getElevatedSurfaceDefs,
      keepCatAwayFromCup: navRuntime.keepCatAwayFromCup,
      knockCup,
      sampleSwipePose: navRuntime.sampleSwipePose,
      resetCatUnstuckTracking,
      setCatClipSpecialPose: catModelRuntime.setCatClipSpecialPose,
      updateCatClipLocomotion: catModelRuntime.updateCatClipLocomotion,
      setBonePose: catModelRuntime.setBonePose,
      windowSill,
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
  if (modeStatEl) modeStatEl.textContent = game.endlessMode ? "Endless" : "Casual";
  if (modeBtnEl) modeBtnEl.textContent = game.endlessMode ? "Switch To Casual" : "Switch To Endless";
  updateMessMeter();
}

function updateMessMeter() {
  const percent = Math.max(0, Math.min(100, game.mess));

  messFillEl.style.width = percent + "%";
  messValueEl.textContent = percent + "%";

  if (percent < 40) {
    messFillEl.style.background = "#5fd36a";
  } else if (percent < 75) {
    messFillEl.style.background = "#f0b861";
  } else {
    messFillEl.style.background = "#d9534f";
  }
}

function simulateStep(stepDt, perfSample = null) {
  const simStartAt = perfSample ? performance.now() : 0;
  clockTime += stepDt;
  const openTarget = clockTime < game.windowOpenUntil ? 1 : 0;
  const openNow = Number(windowSillRuntime?.root?.userData?.openAmount || 0);
  const nextOpen = THREE.MathUtils.damp(openNow, openTarget, 9.0, stepDt);
  windowSillRuntime.setOpenAmount(nextOpen);

  if (game.state === "playing") {
    let tStart = perfSample ? performance.now() : 0;
    physics.world.step(physics.fixedStep, stepDt, 10);
    if (perfSample) {
      perfSample.physicsMs += performance.now() - tStart;
      tStart = performance.now();
    }
    updatePickups(stepDt);
    if (perfSample) {
      perfSample.pickupsMs += performance.now() - tStart;
      tStart = performance.now();
    }
    updateEndlessSpawning(stepDt);
    if (perfSample) {
      perfSample.spawnMs += performance.now() - tStart;
      tStart = performance.now();
    }
    updateCat(stepDt);
    if (perfSample) {
      perfSample.catMs += performance.now() - tStart;
      tStart = performance.now();
    }
    updateCup(stepDt);
    if (perfSample) {
      perfSample.cupMs += performance.now() - tStart;
      tStart = performance.now();
    }
    updateShatter(stepDt);
    if (perfSample) {
      perfSample.shatterMs += performance.now() - tStart;
    }
    if (game.pendingLoseAt != null && clockTime >= game.pendingLoseAt) {
      lose(game.reason || "A desk item hit the floor.");
      game.pendingLoseAt = null;
    }
    if (game.endlessMode && game.mess > ENDLESS_SPAWN.loseThreshold) {
      lose("Mess meter overflowed.");
    }
  }
  if (perfSample) {
    perfSample.simSteps += 1;
    perfSample.simulatedDtMs += stepDt * 1000;
    perfSample.simMs += performance.now() - simStartAt;
  }
}

function animate() {
  const frameStartAt = performance.now();
  const frameDt = Math.min(clock.getDelta(), MAX_FRAME_DT);
  const timeScale = THREE.MathUtils.clamp(game.timeScale, 0, 2);
  const perfSample = {
    frameDtMs: frameDt * 1000,
    simSteps: 0,
    simulatedDtMs: 0,
    simMs: 0,
    physicsMs: 0,
    pickupsMs: 0,
    spawnMs: 0,
    catMs: 0,
    cupMs: 0,
    shatterMs: 0,
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    timeScale,
  };

  if (timeScale <= 1e-6) {
    simAccumulator = 0;
  } else {
    simAccumulator = Math.min(
      simAccumulator + frameDt,
      SIMULATION_DT * MAX_SIM_STEPS_PER_FRAME
    );

    const scaledStepDt = SIMULATION_DT * timeScale;
    let simSteps = 0;
    while (simAccumulator >= SIMULATION_DT && simSteps < MAX_SIM_STEPS_PER_FRAME) {
      simulateStep(scaledStepDt, perfSample);
      simAccumulator -= SIMULATION_DT;
      simSteps++;
    }
    if (simSteps >= MAX_SIM_STEPS_PER_FRAME) {
      simAccumulator = 0;
    }
  }

  debugCameraRuntime.updateDebugCameraControls(frameDt);

  if (!debugRuntime.isDebugVisible()) {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);
  }

  updateDebugView();
  controls.update();
  updateUI();
  renderer.render(scene, camera);
  perfSample.frameMs = performance.now() - frameStartAt;
  perfSample.drawCalls = Number(renderer.info?.render?.calls || 0);
  perfSample.triangles = Number(renderer.info?.render?.triangles || 0);
  perfSample.lines = Number(renderer.info?.render?.lines || 0);
  perfSample.points = Number(renderer.info?.render?.points || 0);
  perfSample.geometries = Number(renderer.info?.memory?.geometries || 0);
  perfSample.textures = Number(renderer.info?.memory?.textures || 0);
  if (typeof debugRuntime.updatePerformanceSample === "function") {
    debugRuntime.updatePerformanceSample(perfSample, clockTime);
  }
  requestAnimationFrame(animate);
}
window.addEventListener("keydown", (e) => {
  if (e.key === "m") {
    game.mess += 10;
  }
});
