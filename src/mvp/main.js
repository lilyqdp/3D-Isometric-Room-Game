import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "./vendor/cannon-es.js";
import { makeBins, makeDesk, makeRoomCorner } from "./modules/room.js";
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

  // trigger the same logic as the in-game mode button
  if (modeBtnEl) modeBtnEl.click();

  // update the start menu label
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
const resultEl = document.getElementById("result");
const catnipBtn = document.getElementById("catnipBtn");
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

function buildDeskJumpAnchors(desk, options = {}) {
  const offsetX = options.offsetX ?? 0.72;
  const offsetZ = options.offsetZ ?? 0.68;
  const step = options.step ?? 0.5;
  const cornerPadX = options.cornerPadX ?? 0.28;
  const cornerPadZ = options.cornerPadZ ?? 0.24;

  const minX = desk.pos.x - desk.sizeX * 0.5 + cornerPadX;
  const maxX = desk.pos.x + desk.sizeX * 0.5 - cornerPadX;
  const minZ = desk.pos.z - desk.sizeZ * 0.5 + cornerPadZ;
  const maxZ = desk.pos.z + desk.sizeZ * 0.5 - cornerPadZ;
  const anchors = [];

  const addEdgeAlongX = (z) => {
    const span = Math.max(0.001, maxX - minX);
    const samples = Math.max(2, Math.ceil(span / step) + 1);
    for (let i = 0; i < samples; i++) {
      const t = samples <= 1 ? 0 : i / (samples - 1);
      anchors.push(new THREE.Vector3(THREE.MathUtils.lerp(minX, maxX, t), 0, z));
    }
  };

  const addEdgeAlongZ = (x) => {
    const span = Math.max(0.001, maxZ - minZ);
    const samples = Math.max(2, Math.ceil(span / step) + 1);
    for (let i = 0; i < samples; i++) {
      const t = samples <= 1 ? 0 : i / (samples - 1);
      anchors.push(new THREE.Vector3(x, 0, THREE.MathUtils.lerp(minZ, maxZ, t)));
    }
  };

  // Full perimeter at stable offsets from each desk edge.
  addEdgeAlongX(desk.pos.z + desk.sizeZ * 0.5 + offsetZ);
  addEdgeAlongX(desk.pos.z - desk.sizeZ * 0.5 - offsetZ);
  addEdgeAlongZ(desk.pos.x + desk.sizeX * 0.5 + offsetX);
  addEdgeAlongZ(desk.pos.x - desk.sizeX * 0.5 - offsetX);

  return anchors;
}

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
const DESK_JUMP_ANCHORS = buildDeskJumpAnchors(desk);

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
const tempTo = new THREE.Vector3();

const CAT_NAV = {
  step: 0.26,
  margin: 0.4,
  clearance: 0.2,
  repathInterval: 0.18,
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
if (modeBtnEl) {
  modeBtnEl.addEventListener("click", () => {
    game.endlessMode = !game.endlessMode;
    resetGame();
  });
}
if (debugBtnEl) {
  debugBtnEl.addEventListener("click", () => toggleDebugView());
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", onCanvasContextMenu);
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
  tempV3,
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
  canReachGroundTarget: navRuntime.canReachGroundTarget,
  findSafeGroundPoint: navRuntime.findSafeGroundPoint,
  bestDeskJumpAnchor: navRuntime.bestDeskJumpAnchor,
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
  buildCatObstacles: navRuntime.buildCatObstacles,
  isCatPointBlocked: navRuntime.isCatPointBlocked,
  getCatPathClearance: navRuntime.getCatPathClearance,
  getNavMeshDebugData: navRuntime.getNavMeshDebugData,
  getActiveNavMeshDebugData: navRuntime.getActiveNavMeshDebugData,
  computeCatPath: navRuntime.computeCatPath,
  computeDeskJumpTargets: navRuntime.computeDeskJumpTargets,
  getDeskDesiredTarget: () => getDeskDesiredTarget(),
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

const uiRuntime = createUIRuntime({
  sortedStatEl,
  catStateStatEl,
  cupStatEl,
  catnipStatEl,
  resultEl,
  game,
  cat,
  cup,
  endMenuEl,
  endTitleEl,
  getClockTime: () => clockTime,
});

setupPhysicsWorld({ CANNON, physics, DESK_LEGS, ROOM, desk, hamper, trashCan });
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

function onKeyDown(event) {
  debugRuntime.onKeyDown(event, clockTime);
  if (event.repeat) return;
  if (game.state !== "playing") return;
  if (!debugRuntime.isDebugVisible()) return;
  if ((event.key || "").toLowerCase() !== "t") return;
  event.preventDefault();
  debugControlsRuntime.teleportCatToDebugMouseTarget();
}

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
  cat.debugMoveY = 0;
  cat.debugMoveJumpAnchor.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveLanding.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveJumpOff.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveJumpDown.set(cat.pos.x, 0, cat.pos.z);
  cat.debugMoveSitSeconds = 0;
  cat.debugMoveTarget.set(cat.pos.x, 0, cat.pos.z);
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
      name: "desk",
      minX: desk.pos.x - desk.sizeX * 0.5 + 0.2,
      maxX: desk.pos.x + desk.sizeX * 0.5 - 0.2,
      minZ: desk.pos.z - desk.sizeZ * 0.5 + 0.16,
      maxZ: desk.pos.z + desk.sizeZ * 0.5 - 0.16,
      y: desk.topY + 0.02,
    });
  }
  return surfaces;
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
      getCurrentGroundGoal: navRuntime.getCurrentGroundGoal,
      ensureCatPath: navRuntime.ensureCatPath,
      nudgeBlockingPickupAwayFromCat: navRuntime.nudgeBlockingPickupAwayFromCat,
      findSafeGroundPoint: navRuntime.findSafeGroundPoint,
      startJump,
      updateJump,
      clearCatJumpTargets,
      moveCatToward: navRuntime.moveCatToward,
      pickRandomPatrolPoint: navRuntime.pickRandomPatrolPoint,
      bestDeskJumpAnchor: navRuntime.bestDeskJumpAnchor,
      clearCatNavPath,
      resetCatJumpBypass,
      updateDebugJumpDownPlan: debugControlsRuntime.updateDebugJumpDownPlan,
      buildCatObstacles: navRuntime.buildCatObstacles,
      canReachGroundTarget: navRuntime.canReachGroundTarget,
      hasClearTravelLine: navRuntime.hasClearTravelLine,
      computeDeskJumpTargets: navRuntime.computeDeskJumpTargets,
      keepCatAwayFromCup: navRuntime.keepCatAwayFromCup,
      knockCup,
      sampleSwipePose: navRuntime.sampleSwipePose,
      resetCatUnstuckTracking,
      setCatClipSpecialPose: catModelRuntime.setCatClipSpecialPose,
      updateCatClipLocomotion: catModelRuntime.updateCatClipLocomotion,
      setBonePose: catModelRuntime.setBonePose,
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

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  clockTime += dt;

  controls.target.x = THREE.MathUtils.clamp(controls.target.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);

  if (game.state === "playing") {
    physics.world.step(physics.fixedStep, dt, 10);
    updatePickups(dt);
    updateEndlessSpawning(dt);
    updateCat(dt);
    updateCup(dt);
    updateShatter(dt);
    if (game.pendingLoseAt != null && clockTime >= game.pendingLoseAt) {
      lose(game.reason || "A desk item hit the floor.");
      game.pendingLoseAt = null;
    }
    if (game.endlessMode && game.mess > ENDLESS_SPAWN.loseThreshold) {
      lose("Mess meter overflowed.");
    }
  }

  updateDebugView();
  controls.update();
  updateUI();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
window.addEventListener("keydown", (e) => {
  if (e.key === "m") {
    game.mess += 10;
  }
});
