import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "./vendor/cannon-es.js";
import { buildRoomSceneFromLayout } from "./modules/room.js";
import {
  buildFloorSurfaceSpec,
  buildRoomDerivedData,
  buildRoomSurfaceSpecs,
  createDefaultRoomLayout,
  createRoomLayoutFromData,
} from "./modules/room-layout.js";
import { createSurfaceRegistry } from "./modules/surface-registry.js";
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
import { FLOOR_SURFACE_ID, catHasNonFloorSurface, ensureCatSurfaceState, isFloorSurfaceId, isNonFloorSurfaceId, normalizeSurfaceId, setCatSurfaceId } from "./modules/surface-ids.js";

// --- UI screens ---
const startMenu = document.getElementById("startMenu");
const endMenu = document.getElementById("endMenu");

const playBtn = document.getElementById("playBtn");
const editRoomBtn = document.getElementById("editRoomBtn");
const quitBtn = document.getElementById("quitBtn");
const replayBtn = document.getElementById("replayBtn");
const startModeBtn = document.getElementById("startModeBtn");
const rulesMenuBtn = document.getElementById("rulesMenuBtn");
const rulesHudBtn = document.getElementById("rulesHudBtn");
const optionsMenuBtn = document.getElementById("optionsMenuBtn");
const menuHudBtn = document.getElementById("menuHudBtn");
const gameMenuOverlay = document.getElementById("gameMenuOverlay");
const menuResumeBtn = document.getElementById("menuResumeBtn");
const menuHowToPlayBtn = document.getElementById("menuHowToPlayBtn");
const menuOptionsBtn = document.getElementById("menuOptionsBtn");
const menuRestartBtn = document.getElementById("menuRestartBtn");
const menuMainMenuBtn = document.getElementById("menuMainMenuBtn");
const optionsOverlay = document.getElementById("optionsOverlay");
const optionsCloseBtn = document.getElementById("optionsCloseBtn");
const optionsResetBtn = document.getElementById("optionsResetBtn");
const simpleHudBtn = document.getElementById("simpleHudBtn");
const advancedHudBtn = document.getElementById("advancedHudBtn");
const smallHudSizeBtn = document.getElementById("smallHudSizeBtn");
const normalHudSizeBtn = document.getElementById("normalHudSizeBtn");
const largeHudSizeBtn = document.getElementById("largeHudSizeBtn");
const debugOffOptionBtn = document.getElementById("debugOffOptionBtn");
const debugOnOptionBtn = document.getElementById("debugOnOptionBtn");
const debugOptionsToggleBtn = document.getElementById("debugOptionsToggleBtn");
const debugOptionsPanelEl = document.getElementById("debugOptionsPanel");
const rulesOverlay = document.getElementById("rulesOverlay");
const rulesCloseBtn = document.getElementById("rulesCloseBtn");
const quitConfirmOverlay = document.getElementById("quitConfirmOverlay");
const quitConfirmTitle = document.getElementById("quitConfirmTitle");
const quitConfirmMessage = document.getElementById("quitConfirmMessage");
const quitToMenuBtn = document.getElementById("quitToMenuBtn");
const quitCancelBtn = document.getElementById("quitCancelBtn");
const pauseBadge = document.getElementById("pauseBadge");
const catnipToastEl = document.getElementById("catnipToast");

const hud = document.getElementById("hud");

// Hide HUD until game starts
hud.style.display = "none";
let rulesPausedGame = false;
let menuPausedGame = false;
let optionsPausedGame = false;
let quitConfirmPausedGame = false;
let confirmAction = "quit";
const OPTIONS_STORAGE_KEY = "catCleanupOptions";
const DEFAULT_OPTIONS = Object.freeze({
  hudMode: "simple",
  hudSize: "normal",
  debugEnabled: false,
});
const HUD_SIZE_SCALE = Object.freeze({
  small: 0.8,
  normal: 1,
  large: 1.25,
});
let playerOptions = loadPlayerOptions();
let debugRuntime = null;

function loadPlayerOptions() {
  try {
    const raw = window.localStorage?.getItem(OPTIONS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_OPTIONS,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function savePlayerOptions() {
  try {
    window.localStorage?.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(playerOptions));
  } catch {
    // Options are convenience-only; ignore browsers that block localStorage.
  }
}

function setHudMode(mode) {
  playerOptions.hudMode = mode === "simple" ? "simple" : "advanced";
  savePlayerOptions();
  applyPlayerOptions();
}

function setHudSize(size) {
  playerOptions.hudSize = Object.prototype.hasOwnProperty.call(HUD_SIZE_SCALE, size) ? size : DEFAULT_OPTIONS.hudSize;
  savePlayerOptions();
  applyPlayerOptions();
}

function setDebugEnabled(enabled) {
  playerOptions.debugEnabled = !!enabled;
  savePlayerOptions();
  if (playerOptions.debugEnabled) {
    debugRuntime?.setDebugViewVisible?.(true, clockTime);
  } else {
    debugRuntime?.setAdvancedPanelVisible?.(false);
    debugRuntime?.setDebugViewVisible?.(false, clockTime);
  }
  applyPlayerOptions();
}

function toggleDebugOptionsPanel() {
  if (!playerOptions.debugEnabled) {
    setDebugEnabled(true);
  }
  const nextOpen = !debugOptionsPanelEl?.classList.contains("open");
  debugRuntime?.setAdvancedPanelVisible?.(nextOpen);
  applyPlayerOptions();
}

function setPaused(paused) {
  game.paused = !!paused;
  if (game.paused) {
    game.placeCatnipMode = false;
    catnipRuntime?.hideCatnipPreview?.();
    pickupsRuntime?.resetInteraction?.();
  }
  if (pauseBadge) {
    pauseBadge.style.display = game.paused && game.state === "playing" ? "block" : "none";
  }
}

function togglePaused() {
  if (game.state !== "playing") return;
  setPaused(!game.paused);
}

function launchGameSession() {
  gameMenuOverlay?.classList.add("hidden");
  optionsOverlay?.classList.add("hidden");
  menuPausedGame = false;
  optionsPausedGame = false;
  resetGame();
  game.state = "playing";
  startMenu.classList.add("hidden");
  endMenu.classList.add("hidden");
  hud.style.display = "block";
}

function showStartMenu() {
  game.state = "menu";
  setPaused(false);
  gameMenuOverlay?.classList.add("hidden");
  optionsOverlay?.classList.add("hidden");
  menuPausedGame = false;
  optionsPausedGame = false;
  endMenu.classList.add("hidden");
  startMenu.classList.remove("hidden");
  hud.style.display = "none";
}

function showRules() {
  rulesPausedGame = game.state === "playing" && !game.paused;
  if (rulesPausedGame) setPaused(true);
  rulesOverlay?.classList.remove("hidden");
}

function hideRules() {
  rulesOverlay?.classList.add("hidden");
  if (rulesPausedGame) setPaused(false);
  rulesPausedGame = false;
}

function isGameMenuOpen() {
  return !!gameMenuOverlay && !gameMenuOverlay.classList.contains("hidden");
}

function showGameMenu() {
  if (game.state !== "playing") return;
  menuPausedGame = !game.paused;
  if (menuPausedGame) setPaused(true);
  gameMenuOverlay?.classList.remove("hidden");
}

function hideGameMenu(resume = true) {
  gameMenuOverlay?.classList.add("hidden");
  if (resume && menuPausedGame) setPaused(false);
  menuPausedGame = false;
}

function showOptions() {
  optionsPausedGame = !isGameMenuOpen() && game.state === "playing" && !game.paused;
  if (optionsPausedGame) setPaused(true);
  optionsOverlay?.classList.remove("hidden");
  applyPlayerOptions();
}

function hideOptions() {
  optionsOverlay?.classList.add("hidden");
  if (optionsPausedGame) setPaused(false);
  optionsPausedGame = false;
}

function showRunEndConfirm(action = "quit") {
  if (game.state !== "playing") return;
  confirmAction = action === "restart" ? "restart" : "quit";
  if (quitConfirmTitle) {
    quitConfirmTitle.textContent = confirmAction === "restart" ? "Restart run?" : "Quit to main menu?";
  }
  if (quitConfirmMessage) {
    quitConfirmMessage.textContent =
      confirmAction === "restart"
        ? "Your current run will be reset."
        : "Your current run will be ended.";
  }
  if (quitToMenuBtn) {
    quitToMenuBtn.textContent = confirmAction === "restart" ? "Restart" : "Main Menu";
    quitToMenuBtn.classList.toggle("restartConfirm", confirmAction === "restart");
    quitToMenuBtn.classList.toggle("mainMenuConfirm", confirmAction !== "restart");
  }
  quitConfirmPausedGame = !game.paused;
  if (quitConfirmPausedGame) setPaused(true);
  quitConfirmOverlay?.classList.remove("hidden");
}

function hideQuitConfirm() {
  quitConfirmOverlay?.classList.add("hidden");
  if (quitConfirmPausedGame) setPaused(false);
  quitConfirmPausedGame = false;
}

function restartRun() {
  gameMenuOverlay?.classList.add("hidden");
  optionsOverlay?.classList.add("hidden");
  quitConfirmOverlay?.classList.add("hidden");
  menuPausedGame = false;
  optionsPausedGame = false;
  quitConfirmPausedGame = false;
  resetGame();
  game.state = "playing";
}

function confirmRunEndAction() {
  gameMenuOverlay?.classList.add("hidden");
  optionsOverlay?.classList.add("hidden");
  quitConfirmOverlay?.classList.add("hidden");
  menuPausedGame = false;
  optionsPausedGame = false;
  quitConfirmPausedGame = false;
  if (confirmAction === "restart") {
    restartRun();
    return;
  }
  resetGame();
  showStartMenu();
}

// Play button
playBtn.addEventListener("click", () => {
  launchGameSession();
});
if (editRoomBtn) {
  editRoomBtn.addEventListener("click", () => {
    window.location.href = `${import.meta.env.BASE_URL}room-editor.html`;
  });
}
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
  showStartMenu();
});

if (rulesMenuBtn) rulesMenuBtn.addEventListener("click", () => showRules());
if (rulesHudBtn) rulesHudBtn.addEventListener("click", () => showRules());
if (rulesCloseBtn) rulesCloseBtn.addEventListener("click", () => hideRules());
if (rulesOverlay) {
  rulesOverlay.addEventListener("click", (event) => {
    if (event.target === rulesOverlay) hideRules();
  });
}
if (optionsMenuBtn) optionsMenuBtn.addEventListener("click", () => showOptions());
if (menuHudBtn) menuHudBtn.addEventListener("click", () => showGameMenu());
if (menuResumeBtn) menuResumeBtn.addEventListener("click", () => hideGameMenu(true));
if (menuHowToPlayBtn) menuHowToPlayBtn.addEventListener("click", () => showRules());
if (menuOptionsBtn) menuOptionsBtn.addEventListener("click", () => showOptions());
if (menuRestartBtn) {
  menuRestartBtn.addEventListener("click", () => {
    showRunEndConfirm("restart");
  });
}
if (menuMainMenuBtn) {
  menuMainMenuBtn.addEventListener("click", () => {
    showRunEndConfirm("quit");
  });
}
if (gameMenuOverlay) {
  gameMenuOverlay.addEventListener("click", (event) => {
    if (event.target === gameMenuOverlay) hideGameMenu(true);
  });
}
if (optionsCloseBtn) optionsCloseBtn.addEventListener("click", () => hideOptions());
if (optionsOverlay) {
  optionsOverlay.addEventListener("click", (event) => {
    if (event.target === optionsOverlay) hideOptions();
  });
}
if (simpleHudBtn) simpleHudBtn.addEventListener("click", () => setHudMode("simple"));
if (advancedHudBtn) advancedHudBtn.addEventListener("click", () => setHudMode("advanced"));
if (smallHudSizeBtn) smallHudSizeBtn.addEventListener("click", () => setHudSize("small"));
if (normalHudSizeBtn) normalHudSizeBtn.addEventListener("click", () => setHudSize("normal"));
if (largeHudSizeBtn) largeHudSizeBtn.addEventListener("click", () => setHudSize("large"));
if (debugOffOptionBtn) debugOffOptionBtn.addEventListener("click", () => setDebugEnabled(false));
if (debugOnOptionBtn) debugOnOptionBtn.addEventListener("click", () => setDebugEnabled(true));
if (debugOptionsToggleBtn) debugOptionsToggleBtn.addEventListener("click", () => toggleDebugOptionsPanel());
if (optionsResetBtn) {
  optionsResetBtn.addEventListener("click", () => {
    playerOptions = { ...DEFAULT_OPTIONS };
    savePlayerOptions();
    if (!playerOptions.debugEnabled && debugRuntime?.isDebugVisible?.()) {
      debugRuntime.setDebugViewVisible?.(false, clockTime);
    }
    applyPlayerOptions();
  });
}
if (quitToMenuBtn) quitToMenuBtn.addEventListener("click", () => confirmRunEndAction());
if (quitCancelBtn) quitCancelBtn.addEventListener("click", () => hideQuitConfirm());
if (quitConfirmOverlay) {
  quitConfirmOverlay.addEventListener("click", (event) => {
    if (event.target === quitConfirmOverlay) hideQuitConfirm();
  });
}

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
const catnipTimerBubbleEl = document.getElementById("catnipTimerBubble");
const windowTimerBubbleEl = document.getElementById("windowTimerBubble");
const pauseBtn = document.getElementById("pauseBtn");
const restartBtn = document.getElementById("restartBtn");
const messFillEl = document.getElementById("messFill");
const messValueEl = document.getElementById("messValue");
const messMeterWrapEl = document.getElementById("messMeterWrap");
const modeStatEl = document.getElementById("modeStat");
const advancedHudRows = Array.from(document.querySelectorAll(".advancedHudRow"));

function applyPlayerOptions() {
  const simpleHud = playerOptions.hudMode === "simple";
  const hudSize = Object.prototype.hasOwnProperty.call(HUD_SIZE_SCALE, playerOptions.hudSize)
    ? playerOptions.hudSize
    : DEFAULT_OPTIONS.hudSize;
  const debugEnabled = !!playerOptions.debugEnabled;
  if (playerOptions.hudSize !== hudSize) playerOptions.hudSize = hudSize;
  for (const row of advancedHudRows) {
    row.style.display = simpleHud ? "none" : "";
  }
  hud?.style.setProperty("--hud-scale", String(HUD_SIZE_SCALE[hudSize]));
  simpleHudBtn?.classList.toggle("selected", simpleHud);
  advancedHudBtn?.classList.toggle("selected", !simpleHud);
  smallHudSizeBtn?.classList.toggle("selected", hudSize === "small");
  normalHudSizeBtn?.classList.toggle("selected", hudSize === "normal");
  largeHudSizeBtn?.classList.toggle("selected", hudSize === "large");
  debugOffOptionBtn?.classList.toggle("selected", !debugEnabled);
  debugOnOptionBtn?.classList.toggle("selected", debugEnabled);
  const debugPanelOpen = !!debugRuntime?.isAdvancedPanelVisible?.();
  if (debugOptionsToggleBtn) debugOptionsToggleBtn.style.display = debugEnabled ? "block" : "none";
  debugOptionsToggleBtn?.toggleAttribute("disabled", !debugEnabled);
  debugOptionsToggleBtn?.setAttribute("aria-expanded", debugPanelOpen ? "true" : "false");
  if (debugOptionsToggleBtn) debugOptionsToggleBtn.textContent = debugPanelOpen ? "^" : "v";
  debugOptionsPanelEl?.classList.toggle("open", debugEnabled && debugPanelOpen);
}

applyPlayerOptions();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde8f0);

let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(44, aspect, 0.1, 60);
camera.position.set(7.75, 6.95, 7.75);
camera.lookAt(0.35, 1.05, 0.1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableRotate = false;
controls.enablePan = true;
controls.enableZoom = true;
controls.minDistance = 6.2;
controls.maxDistance = 30;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};
controls.target.set(0.35, 1.05, 0.1);
camera.updateProjectionMatrix();

const hemi = new THREE.HemisphereLight(0xfff4e0, 0xc8b89a, 1.1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff8ec, 1.05);
sun.position.set(9, 12, 6);
scene.add(sun);

const ROOM_LAYOUT_URL = `${import.meta.env.BASE_URL}mvp/room-layout.json`;
const DEFAULT_ROOM_LAYOUT_URL = `${import.meta.env.BASE_URL}mvp/default-room-layout.json`;

async function loadGameRoomLayout() {
  const builtInFallback = createDefaultRoomLayout(THREE);
  try {
    const response = await fetch(ROOM_LAYOUT_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`room-layout HTTP ${response.status}`);
    const data = await response.json();
    return createRoomLayoutFromData(THREE, data);
  } catch (error) {
    try {
      const response = await fetch(DEFAULT_ROOM_LAYOUT_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`default-room-layout HTTP ${response.status}`);
      const data = await response.json();
      return createRoomLayoutFromData(THREE, data);
    } catch (defaultError) {
      console.warn("Failed to load room layout JSON, using built-in default layout.", error, defaultError);
      return builtInFallback;
    }
  }
}

const roomLayout = await loadGameRoomLayout();
const ROOM = roomLayout.roomBounds;
const TARGET_BOUNDS = roomLayout.targetBounds;
const {
  floor,
  desk,
  chair,
  shelf,
  hoverShelf,
  lowerPlatform,
  upperPlatform,
  windowSill,
  hamper,
  trashCan,
} = roomLayout;

const game = {
  state: "menu", // menu | playing | lost | won
  timeScale: 1.0,
  paused: false,
  endlessMode: false,
  reason: "",
  sorted: 0,
  total: 0,
  mess: 0,
  elapsed: 0,
  laundrySpawnBudget: 0,
  trashSpawnBudget: 0,
  pendingLoseAt: null,
  catnip: null, // {mesh,pos,placedAt,timeoutAt,eatenAt,expiresAt}
  catnipCooldownUntil: 0,
  catnipNoRouteUntil: 0,
  placeCatnipMode: false,
  invalidCatnipUntil: 0,
  windowOpenUntil: 0,
  windowCooldownUntil: 0,
};

const pickups = [];
const shatterBits = [];
let clockTime = 0;
const SIMULATION_HZ = 120;
const SIMULATION_DT = 1 / SIMULATION_HZ;
const MAX_FRAME_DT = 0.1;
const MAX_SIM_STEPS_PER_FRAME = 12;
const SECRET_SPEED_STEP = 0.1;
const SECRET_SPEED_MIN = 0.1;
const SECRET_SPEED_MAX = 2;
let simAccumulator = 0;
let lastAnimationFrameAt = 0;
const pressedKeys = new Set();

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
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.055);
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
  // Normal path solves stay on the Recast/Detour stack. If Recast cannot produce
  // a valid route, the planner now returns no path instead of falling back to A*.
  useFallbackPlanner: false,
  useDetourCrowd: true,
  detourSpeedScale: 0.8,
  detourArriveSnapRadius: 0.1,
  detourLeadRadius: 0.9,
  detourLeadDistance: 0.45,
  locomotionSpeedScale: 3.0,
  locomotionScaleCap: 8.0,
  runEnableDistance: 2.0,
  runDisableDistance: 1.6,
  runWalkTransitionDistance: 1.0,
  runMinStraightDistance: 2.0,
  runHardTurnAngle: 0.72,
  postSurfaceHopRunCooldown: 0.85,
  endpointSlowdownDistance: 2.0,
  runAccelerationDistance: 4.0,
  endpointWalkSpeedScale: 0.72,
  endpointDecelMultiplier: 2.35,
  runMaxYawDelta: 0.82,
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

const CASUAL_MESS = {
  start: 100,
  sortedItemValue: 25,
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

const { windowSillRuntime } = buildRoomSceneFromLayout({
  scene,
  layout: roomLayout,
  binVisuals,
  gltfLoader,
  trashCanModelCandidates: TRASH_CAN_MODEL_CANDIDATES,
});

function enterCatnipPlacementMode() {
  if (game.state !== "playing") return;
  if (game.paused) return;
  if (clockTime < (game.windowOpenUntil || 0)) {
    game.placeCatnipMode = false;
    catnipRuntime?.hideCatnipPreview?.();
    return;
  }
  if (game.catnip) return;
  if (clockTime < game.catnipCooldownUntil) return;
  game.placeCatnipMode = true;
  catnipRuntime?.updateCatnipPreview?.();
}

function openWindowSill() {
  if (game.state !== "playing") return;
  if (game.paused) return;
  if (windowSill?.specialFlags?.windowOpensOnButtonClick === false) return;
  if (clockTime < game.windowOpenUntil) return;
  if (clockTime < (game.windowCooldownUntil || 0)) return;
  game.placeCatnipMode = false;
  catnipRuntime?.hideCatnipPreview?.();
  catnipRuntime.clearCatnip();
  const openUntil = clockTime + windowSill.openDuration;
  game.windowOpenUntil = openUntil;
  game.windowCooldownUntil = openUntil + 10;
}

catnipBtn.addEventListener("click", () => {
  enterCatnipPlacementMode();
});
if (windowBtn) {
  windowBtn.addEventListener("click", () => {
    openWindowSill();
  });
}

if (restartBtn) restartBtn.addEventListener("click", () => showRunEndConfirm("restart"));
if (pauseBtn) pauseBtn.addEventListener("click", () => togglePaused());
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", onCanvasContextMenu);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

const SURFACE_SPECS = buildRoomSurfaceSpecs(roomLayout);
const FLOOR_SURFACE_SPEC = buildFloorSurfaceSpec(roomLayout);

const surfaceRegistry = createSurfaceRegistry({
  floorBounds: {
    minX: ROOM.minX + CAT_NAV.margin,
    maxX: ROOM.maxX - CAT_NAV.margin,
    minZ: ROOM.minZ + CAT_NAV.margin,
    maxZ: ROOM.maxZ - CAT_NAV.margin,
  },
  floorY: ROOM.floorY,
  floorSpec: FLOOR_SURFACE_SPEC,
  surfaceSpecs: SURFACE_SPECS,
});

const roomDerived = buildRoomDerivedData(roomLayout);
const DESK_LEGS = roomDerived.deskLegs;

const EXTRA_NAV_OBSTACLES = [
  ...surfaceRegistry.buildNavObstacles(),
  ...(roomDerived.extraNavObstacles || []),
];

const EXTRA_STATIC_BOXES = [
  ...surfaceRegistry.buildStaticBoxes(),
  ...(roomDerived.extraStaticBoxes || []),
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
  getSurfaceDefs,
  getClockTime: () => clockTime,
  getSortedMessDelta: () => (game.endlessMode ? -ENDLESS_SPAWN.messPerItem : -CASUAL_MESS.sortedItemValue),
  onAllSorted: win,
});

function shouldRecordFunctionTrace() {
  return !!debugRuntime?.shouldRecordFunctionTrace?.();
}

function recordFunctionTrace(name, details = "") {
  if (!shouldRecordFunctionTrace()) return;
  if (!cat?.nav) return;
  if (!Array.isArray(cat.nav.functionTrace)) cat.nav.functionTrace = [];
  const trace = cat.nav.functionTrace;
  const entry = {
    t: clockTime,
    name: String(name || "fn"),
    details: typeof details === "string" ? details : "",
    count: 1,
  };
  const prev = trace[trace.length - 1];
  if (
    prev &&
    prev.name === entry.name &&
    prev.details === entry.details &&
    Math.abs((entry.t || 0) - (prev.t || 0)) <= 0.18
  ) {
    prev.t = entry.t;
    prev.count = (Number(prev.count) || 1) + 1;
    return;
  }
  trace.push(entry);
  if (trace.length > 520) trace.splice(0, trace.length - 520);
}

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
  getSurfaceDefs,
  getSurfaceById,
  clearCatNavPath,
  resetCatUnstuckTracking,
  getClockTime: () => clockTime,
  recordFunctionTrace,
  shouldRecordPathProfiler: () => !!debugRuntime?.shouldRecordPathProfiler?.(),
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
  findSurfacePath: navRuntime.findSurfacePath,
  getSurfaceDefs,
  getSurfaceById,
  getClockTime: () => clockTime,
  shouldRecordPathProfiler: () => !!debugRuntime?.shouldRecordPathProfiler?.(),
});

debugRuntime = createDebugOverlayRuntime({
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
  debugOptionsMountEl: debugOptionsPanelEl,
  buildCatObstacles: navRuntime.buildCatObstacles,
  isCatPointBlocked: navRuntime.isCatPointBlocked,
  getCatPathClearance: navRuntime.getCatPathClearance,
  getNavMeshDebugData: navRuntime.getNavMeshDebugData,
  getActiveNavMeshDebugData: navRuntime.getActiveNavMeshDebugData,
  getLastAStarDebugData: navRuntime.getLastAStarDebugData,
  computeCatPath: navRuntime.computeCatPath,
  computeDeskJumpTargets: navRuntime.computeDeskJumpTargets,
  getSurfaceJumpDebugData: navRuntime.getSurfaceJumpDebugData,
  getSurfaceDefs,
  getSurfaceById,
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
  getClockTime: () => clockTime,
  getDebugRoot: () => debugRuntime.root,
  queueSharedDebugRouteRequest: (request) => {
    if (!cat.nav || typeof cat.nav !== "object") cat.nav = {};
    const windowRouteActive =
      !!cat.nav?.windowHoldActive || clockTime < Number(game.windowOpenUntil || 0);
    if (game.catnip || game.placeCatnipMode || windowRouteActive) return false;
    const finalPoint = request?.finalPoint;
    if (!finalPoint) return false;
    cat.nav.pendingSharedRouteRequest = {
      finalSurfaceId: String(request?.finalSurfaceId || "floor"),
      finalPoint: new THREE.Vector3(
        Number(finalPoint.x) || 0,
        Number(finalPoint.y) || 0,
        Number(finalPoint.z) || 0
      ),
      sitSeconds: Number.isFinite(request?.sitSeconds) ? Number(request.sitSeconds) : 0,
      source: String(request?.source || "debug-click"),
      forceReplan: request?.forceReplan !== false,
      lastState: String(request?.lastState || "debugMove"),
      failStatus: request?.failStatus ? String(request.failStatus) : "No route to click",
    };
    return true;
  },
  clearCatJumpTargets,
  clearCatNavPath,
  resetCatJumpBypass,
  resetCatUnstuckTracking,
  getSurfaceDefs,
  getSurfaceById,
});
const debugCameraRuntime = createMainDebugCameraRuntime({
  THREE,
  camera,
  controls,
  debugRuntime,
  debugControlsRuntime,
  game,
  getClockTime: () => clockTime,
  isDebugEnabled: () => !!playerOptions.debugEnabled,
  isKeyboardCameraEnabled: () =>
    (!rulesOverlay || rulesOverlay.classList.contains("hidden")) &&
    (!gameMenuOverlay || gameMenuOverlay.classList.contains("hidden")) &&
    (!optionsOverlay || optionsOverlay.classList.contains("hidden")) &&
    (!quitConfirmOverlay || quitConfirmOverlay.classList.contains("hidden")),
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
  windowSill,
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
   bed: roomLayout.objectsById?.bed || null,
  wardrobe: roomLayout.objectsById?.wardrobe || null,
  bookcase: roomLayout.objectsById?.bookcase || null,
  bedsideTable: roomLayout.objectsById?.bedsideTable || null,
  EXTRA_STATIC_BOXES,
});
await navRuntime.initPathfinding();
resetGame();
debugRuntime.initDebugView(clockTime);
if (playerOptions.debugEnabled) debugRuntime.setDebugViewVisible?.(true, clockTime);
applyPlayerOptions();

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

function addMess(amount) {
  game.mess = Math.max(0, game.mess + amount);
}

function getElevatedSurfaceById(surfaceId) {
  if (!surfaceId || surfaceId === "floor") return null;
  const defs = getSurfaceDefs({ includeFloor: false });
  if (!Array.isArray(defs)) return null;
  return defs.find((s) => String(s?.id || s?.name || "") === String(surfaceId)) || null;
}

function scoreElevatedSurfaceAtPoint(x, z, y, surface, pad = 0.18, preferredSurfaceId = "") {
  if (!surface) return null;
  const sx0 = Number(surface.minX);
  const sx1 = Number(surface.maxX);
  const sz0 = Number(surface.minZ);
  const sz1 = Number(surface.maxZ);
  const sy = Number(surface.y);
  if (![sx0, sx1, sz0, sz1, sy].every(Number.isFinite)) return null;
  const inside = x >= sx0 - pad && x <= sx1 + pad && z >= sz0 - pad && z <= sz1 + pad;
  if (!inside) return null;
  const dy = Math.abs(sy - y);
  const edgeDist = Math.min(
    Math.abs(x - sx0),
    Math.abs(x - sx1),
    Math.abs(z - sz0),
    Math.abs(z - sz1)
  );
  const surfaceId = String(surface.id || surface.name || "");
  const preferredBias = preferredSurfaceId && surfaceId === String(preferredSurfaceId) ? -0.08 : 0;
  const score = dy + Math.max(0, 0.22 - edgeDist) * 0.2 + preferredBias;
  return { score, surface, dy };
}

function findBestElevatedSurfaceAt(x, z, y, pad = 0.18, maxDy = 0.58, preferredSurfaceId = "") {
  const defs = getSurfaceDefs({ includeFloor: false });
  if (!Array.isArray(defs)) return null;
  let best = null;
  let bestScore = Infinity;
  for (const strictPad of [0.03, pad]) {
    best = null;
    bestScore = Infinity;
    for (const surface of defs) {
      const scored = scoreElevatedSurfaceAtPoint(x, z, y, surface, strictPad, preferredSurfaceId);
      if (!scored || scored.dy > maxDy) continue;
      if (scored.score < bestScore) {
        bestScore = scored.score;
        best = scored.surface;
      }
    }
    if (best) return best;
  }
  return best;
}

function isNearElevatedSurface(x, z, y, surface, pad = 0.28, yPad = 0.7) {
  if (!surface) return false;
  return (
    x >= surface.minX - pad &&
    x <= surface.maxX + pad &&
    z >= surface.minZ - pad &&
    z <= surface.maxZ + pad &&
    Math.abs((surface.y || 0) - y) <= yPad
  );
}

function findLooseElevatedSurfaceAt(x, z, y, preferredSurfaceId = "") {
  const defs = getSurfaceDefs({ includeFloor: false });
  if (!Array.isArray(defs) || defs.length === 0) return null;

  let best = null;
  let bestScore = Infinity;
  for (const surface of defs) {
    if (!surface) continue;
    const sx0 = Number(surface.minX);
    const sx1 = Number(surface.maxX);
    const sz0 = Number(surface.minZ);
    const sz1 = Number(surface.maxZ);
    const sy = Number(surface.y);
    if (![sx0, sx1, sz0, sz1, sy].every(Number.isFinite)) continue;

    const dx = x < sx0 ? sx0 - x : x > sx1 ? x - sx1 : 0;
    const dz = z < sz0 ? sz0 - z : z > sz1 ? z - sz1 : 0;
    const dy = Math.abs(sy - y);
    if (dy > 1.15) continue;

    const surfaceId = String(surface.id || surface.name || "");
    const preferredBias = preferredSurfaceId && surfaceId === String(preferredSurfaceId) ? -0.18 : 0;
    const score = dx * 1.25 + dz * 1.25 + dy * 1.8 + preferredBias;
    if (score < bestScore) {
      bestScore = score;
      best = surface;
    }
  }
  return best;
}

function getCurrentCatSurfaceIdForSpawnReach() {
  const y = Number.isFinite(cat.group.position.y) ? cat.group.position.y : 0;
  if (isFloorSurfaceId(cat.nav?.surfaceState?.currentSurfaceId) && y <= 0.08) return FLOOR_SURFACE_ID;

  const routeSurfaceId =
    cat.nav?.route?.active && cat.nav?.route?.surfaceId && cat.nav.route.surfaceId !== "floor"
      ? String(cat.nav.route.surfaceId)
      : "";
  const routeFinalSurfaceId =
    cat.nav?.route?.active && cat.nav?.route?.finalSurfaceId && cat.nav.route.finalSurfaceId !== "floor"
      ? String(cat.nav.route.finalSurfaceId)
      : "";
  const hintedSurfaceId =
    routeSurfaceId ||
    routeFinalSurfaceId ||
    (cat.debugMoveSurfaceId && cat.debugMoveSurfaceId !== "floor" ? String(cat.debugMoveSurfaceId) : "");

  const best = findBestElevatedSurfaceAt(cat.pos.x, cat.pos.z, y, 0.18, 0.58, hintedSurfaceId);
  if (best) return String(best.id || best.name || hintedSurfaceId || "floor");

  for (const fallbackId of [
    hintedSurfaceId,
    routeFinalSurfaceId,
    cat.debugMoveSurfaceId,
    cat.nav?.lastSurfaceHopTo,
    cat.nav?.lastSurfaceHopFrom,
  ]) {
    const surface = getElevatedSurfaceById(fallbackId);
    if (surface && isNearElevatedSurface(cat.pos.x, cat.pos.z, y, surface)) {
      return String(surface.id || surface.name || fallbackId || "floor");
    }
  }

  const loose = findLooseElevatedSurfaceAt(cat.pos.x, cat.pos.z, y, hintedSurfaceId);
  if (loose) return String(loose.id || loose.name || hintedSurfaceId || "floor");

  return y <= 0.08 ? FLOOR_SURFACE_ID : normalizeSurfaceId(hintedSurfaceId || routeFinalSurfaceId);
}

function getSpawnReachStart() {
  const floorStart = new THREE.Vector3(cat.pos.x, 0, cat.pos.z);
  if (!catHasNonFloorSurface(cat)) {
    return navRuntime.findSafeGroundPoint(floorStart);
  }

  const surfaceId = getCurrentCatSurfaceIdForSpawnReach();
  if (isFloorSurfaceId(surfaceId)) {
    return navRuntime.findSafeGroundPoint(floorStart);
  }

  const fromTopPoint = new THREE.Vector3(
    cat.pos.x,
    Math.max(0.02, Number.isFinite(cat.group.position.y) ? cat.group.position.y : 0),
    cat.pos.z
  );
  const jumpDownPlan =
    typeof navRuntime.computeSurfaceJumpDownTargets === "function"
      ? navRuntime.computeSurfaceJumpDownTargets(surfaceId, fromTopPoint, null, "floor")
      : null;
  if (jumpDownPlan?.jumpFrom) {
    return navRuntime.findSafeGroundPoint(new THREE.Vector3(jumpDownPlan.jumpFrom.x, 0, jumpDownPlan.jumpFrom.z));
  }

  return navRuntime.findSafeGroundPoint(floorStart);
}

function spawnPickupOfType(type) {
  const reachStart = getSpawnReachStart();
  const spawned = spawnRandomPickup({
    type,
    catSpawn: reachStart,
    camera,
    CAT_COLLISION,
    pickups,
    pickupRadius,
    buildCatObstacles: navRuntime.buildCatObstacles,
    isCatPointBlocked: navRuntime.isCatPointBlocked,
    canReachGroundTarget: navRuntime.canReachGroundTarget,
    bestSurfaceJumpAnchor: navRuntime.bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets: navRuntime.computeSurfaceJumpTargets,
    findSafeGroundPoint: navRuntime.findSafeGroundPoint,
    getSurfaceDefs,
    getSurfaceIdsByCapability,
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
    attempts++;
    if (!spawnPickupOfType("laundry")) break;
    game.laundrySpawnBudget -= 1;
  }
  while (game.trashSpawnBudget >= 1 && attempts < ENDLESS_SPAWN.maxSpawnAttemptsPerFrame) {
    attempts++;
    if (!spawnPickupOfType("trash")) break;
    game.trashSpawnBudget -= 1;
  }
}

function resetGame() {
  game.state = "menu";
  setPaused(false);
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
  game.windowCooldownUntil = 0;
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
    buildCatObstacles: navRuntime.buildCatObstacles,
    getCatPathClearance: navRuntime.getCatPathClearance,
    isCatPointBlocked: navRuntime.isCatPointBlocked,
    canReachGroundTarget: navRuntime.canReachGroundTarget,
  });
  addRandomPickups({
    catSpawn,
    camera,
    CAT_COLLISION,
    SPAWN_COUNTS,
    buildCatObstacles: navRuntime.buildCatObstacles,
    isCatPointBlocked: navRuntime.isCatPointBlocked,
    canReachGroundTarget: navRuntime.canReachGroundTarget,
    bestSurfaceJumpAnchor: navRuntime.bestSurfaceJumpAnchor,
    computeSurfaceJumpTargets: navRuntime.computeSurfaceJumpTargets,
    findSafeGroundPoint: navRuntime.findSafeGroundPoint,
    getSurfaceDefs,
    getSurfaceIdsByCapability,
    addPickup: pickupsRuntime.addPickup,
  });
  navRuntime.invalidateNavCaches();
  navRuntime.getActiveNavMeshDebugData();
  game.total = pickups.length;
  game.mess = game.endlessMode ? pickups.length * ENDLESS_SPAWN.messPerItem : CASUAL_MESS.start;

  cat.pos.copy(catSpawn);
  cat.group.position.set(cat.pos.x, 0, cat.pos.z);
  cat.group.visible = true;
  cup.group.visible = true;
  cat.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
  cat.state = "patrol";
  cat.lastState = "patrol";
  cat.stateT = 0;
  cat.status = "Patrolling";
  cat.debugMoveActive = false;
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
  if (!cat.nav.route || typeof cat.nav.route !== "object") cat.nav.route = {};
  if (!cat.nav.route.target || typeof cat.nav.route.target.set !== "function") cat.nav.route.target = new THREE.Vector3();
  if (!cat.nav.route.finalTarget || typeof cat.nav.route.finalTarget.set !== "function") cat.nav.route.finalTarget = new THREE.Vector3();
  if (!cat.nav.route.jumpAnchor || typeof cat.nav.route.jumpAnchor.set !== "function") cat.nav.route.jumpAnchor = new THREE.Vector3();
  if (!cat.nav.route.landing || typeof cat.nav.route.landing.set !== "function") cat.nav.route.landing = new THREE.Vector3();
  if (!cat.nav.route.jumpOff || typeof cat.nav.route.jumpOff.set !== "function") cat.nav.route.jumpOff = new THREE.Vector3();
  if (!cat.nav.route.jumpDown || typeof cat.nav.route.jumpDown.set !== "function") cat.nav.route.jumpDown = new THREE.Vector3();
  cat.nav.route.active = false;
  cat.nav.route.source = "";
    cat.nav.route.surfaceId = "floor";
  cat.nav.route.finalSurfaceId = "floor";
  cat.nav.route.y = 0;
  cat.nav.route.finalY = 0;
  cat.nav.route.jumpDownY = 0;
  cat.nav.route.directJump = false;
  cat.nav.route.sitSeconds = 0;
  cat.nav.route.recoverAt = 0;
  cat.nav.route.approachSurfaceId = "floor";
  cat.nav.route.createdAt = 0;
  cat.nav.route.blockedSince = 0;
  cat.nav.route.blockedReason = "";
  cat.nav.route.lastProgressAt = 0;
  cat.nav.route.lastProgressX = cat.pos.x;
  cat.nav.route.lastProgressZ = cat.pos.z;
  cat.nav.route.segments = [];
  cat.nav.route.segmentIndex = 0;
  cat.nav.route.segmentEnteredAt = 0;
  cat.nav.route.segmentReason = "";
  cat.nav.route.target.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.route.finalTarget.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.route.jumpAnchor.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.route.landing.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.route.jumpOff.set(cat.pos.x, 0, cat.pos.z);
  cat.nav.route.jumpDown.set(cat.pos.x, 0, cat.pos.z);
  const surfaceState = ensureCatSurfaceState(cat);
  if (surfaceState) {
    surfaceState.currentSurfaceId = FLOOR_SURFACE_ID;
    surfaceState.lastStableSurfaceId = FLOOR_SURFACE_ID;
    surfaceState.authority = "spawn";
    surfaceState.authoritativeUntil = 0;
    surfaceState.updatedAt = clockTime;
  } else {
    setCatSurfaceId(cat, FLOOR_SURFACE_ID, "spawn", clockTime, 0);
  }
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
  cat.nav.jumpDownLinkId = "";
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
  cat.nav.catnipApproachKey = "";
  cat.nav.catnipApproachX = NaN;
  cat.nav.catnipApproachZ = NaN;
  cat.nav.windowPathCheckAt = 0;
  cat.nav.windowHoldActive = false;
  cat.nav.suppressCupUntil = 0;
  cat.nav.goalChangePendingSince = 0;
  cat.nav.goalChangePendingX = NaN;
  cat.nav.goalChangePendingZ = NaN;
  cat.nav.goalRepathCooldownUntil = 0;
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
    cat.nav.goalChangePendingSince = 0;
    cat.nav.goalRepathCooldownUntil = 0;
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

function ensurePathProfilerMetric(name) {
  if (!debugRuntime?.shouldRecordPathProfiler?.()) return { profiler: null, metric: null };
  if (!cat.nav || typeof cat.nav !== "object") cat.nav = {};
  if (!cat.nav.pathProfiler || typeof cat.nav.pathProfiler !== "object") {
    cat.nav.pathProfiler = {
      createdAt: clockTime,
      metrics: {},
      counters: {},
      events: [],
      lastSlowEvent: null,
    };
  }
  const profiler = cat.nav.pathProfiler;
  if (!profiler.metrics || typeof profiler.metrics !== "object") profiler.metrics = {};
  if (!Array.isArray(profiler.events)) profiler.events = [];
  if (!profiler.metrics[name] || typeof profiler.metrics[name] !== "object") {
    profiler.metrics[name] = {
      calls: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      slowCount: 0,
      samples: [],
      lastMeta: null,
    };
  }
  const metric = profiler.metrics[name];
  if (!Array.isArray(metric.samples)) metric.samples = [];
  return { profiler, metric };
}

function finishPointerProfilerMetric(name, startedAt, meta = null, slowMs = 4) {
  const elapsed = Math.max(0, performance.now() - startedAt);
  const { profiler, metric } = ensurePathProfilerMetric(name);
  if (!profiler || !metric) return elapsed;
  metric.calls += 1;
  metric.totalMs += elapsed;
  metric.lastMs = elapsed;
  metric.maxMs = Math.max(metric.maxMs || 0, elapsed);
  metric.lastMeta = meta && typeof meta === "object" ? { ...meta, t: clockTime } : null;
  metric.samples.push(elapsed);
  if (metric.samples.length > 180) metric.samples.splice(0, metric.samples.length - 180);
  if (elapsed >= slowMs) {
    metric.slowCount = (Number(metric.slowCount) || 0) + 1;
    profiler.events.push({
      kind: String(name || "pointer"),
      ms: elapsed,
      t: clockTime,
      ...(meta && typeof meta === "object" ? meta : {}),
    });
    if (profiler.events.length > 24) profiler.events.splice(0, profiler.events.length - 24);
    profiler.lastSlowEvent = profiler.events[profiler.events.length - 1] || null;
  }
  return elapsed;
}

function onPointerDown(event) {
  const startedAt = performance.now();
  let phase = "noop";
  try {
    if (game.state !== "playing") {
      phase = "not-playing";
      return;
    }
    if (game.paused) {
      phase = "paused";
      return;
    }
    setMouseFromEvent(event);

    if (event.button === 2 && playerOptions.debugEnabled && debugRuntime.isDebugVisible()) {
      event.preventDefault();
      debugControlsRuntime.moveCatToDebugClickTarget();
      phase = "debug-click";
      return;
    }

    if (game.placeCatnipMode) {
      placeCatnipFromMouse();
      phase = "catnip-click";
      return;
    }

    pickupsRuntime.onPointerDown(event);
    phase = "pickup-pointer";
  } finally {
    finishPointerProfilerMetric(
      phase === "catnip-click" ? "pointerCatnipClick" : "pointerDown",
      startedAt,
      {
        phase,
        button: Number.isFinite(event?.button) ? event.button : -1,
        result: phase,
      },
      phase === "catnip-click" ? 2.5 : 4
    );
  }
}

function onCanvasContextMenu(event) {
  if (!playerOptions.debugEnabled || !debugRuntime.isDebugVisible()) return;
  event.preventDefault();
}

function onPointerMove(event) {
  setMouseFromEvent(event);
  if (game.paused) return;
  if (game.placeCatnipMode) {
    catnipRuntime.updateCatnipPreview?.();
    return;
  }
  catnipRuntime.hideCatnipPreview?.();
  pickupsRuntime.onPointerMove(event);
}

function onPointerUp() {
  if (game.paused) {
    pickupsRuntime.resetInteraction();
    return;
  }
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

function getSurfaceDefs(options = undefined) {
  if (typeof options === "object" && options) return surfaceRegistry.getSurfaceDefs(options);
  return surfaceRegistry.getSurfaceDefs();
}

function getSurfaceById(surfaceId) {
  return surfaceRegistry.getSurfaceById(surfaceId);
}

function getSurfaceIdsByCapability(capability) {
  return typeof surfaceRegistry.getSurfaceIdsByCapability === "function"
    ? surfaceRegistry.getSurfaceIdsByCapability(capability)
    : [];
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
      startJump: navRuntime.startJump,
      updateJump: navRuntime.updateJump,
      clearActiveJump: navRuntime.clearActiveJump,
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
      findSurfacePath: navRuntime.findSurfacePath,
      computeDeskJumpTargets: navRuntime.computeDeskJumpTargets,
      computeSurfaceJumpTargets: navRuntime.computeSurfaceJumpTargets,
      computeSurfaceJumpDownTargets: navRuntime.computeSurfaceJumpDownTargets,
      getSurfaceDefs,
      getSurfaceById,
      keepCatAwayFromCup: navRuntime.keepCatAwayFromCup,
      knockCup,
      sampleSwipePose: navRuntime.sampleSwipePose,
      resetCatUnstuckTracking,
      clearCatClipSpecialPose: catModelRuntime.clearCatClipSpecialPose,
      setCatClipSpecialPose: catModelRuntime.setCatClipSpecialPose,
      updateCatClipLocomotion: catModelRuntime.updateCatClipLocomotion,
      setBonePose: catModelRuntime.setBonePose,
      windowSill,
      recordFunctionTrace,
    },
    dt
  );
}


function lose(reason) {
  if (game.state !== "playing") return;
  game.state = "lost";
  setPaused(false);
  game.reason = reason;
}

function win() {
  if (game.state !== "playing") return;
  game.state = "won";
  setPaused(false);
}

function updateUI() {
  uiRuntime.updateUI();
  const setTimerBubble = (el, text) => {
    if (!el) return;
    const show = !!text;
    el.textContent = show ? text : "";
    el.classList.toggle("active", show);
  };
  if (modeStatEl) {
    const modeText = game.endlessMode ? "Endless" : "Casual";
    modeStatEl.textContent = game.paused && game.state === "playing" ? `${modeText} (Paused)` : modeText;
  }
  if (!game.placeCatnipMode) catnipRuntime?.hideCatnipPreview?.();
  catnipToastEl?.classList.toggle(
    "active",
    game.state === "playing" && clockTime < (game.invalidCatnipUntil || 0)
  );
  if (catnipBtn) {
    const windowActive = clockTime < (game.windowOpenUntil || 0);
    const cooldown = Math.max(0, Math.ceil((game.catnipCooldownUntil || 0) - clockTime));
    const catnipPlacedRemaining = game.catnip
      ? Math.max(
          0,
          Math.ceil(
            Number.isFinite(game.catnip.expiresAt)
              ? game.catnip.expiresAt - clockTime
              : (Number(game.catnip.timeoutAt) || game.catnip.placedAt + 30) - clockTime
          )
        )
      : 0;
    catnipBtn.style.display = "";
    catnipBtn.disabled = game.paused || windowActive || !!game.catnip || cooldown > 0;
    if (game.paused) catnipBtn.textContent = "Catnip (C)";
    else if (windowActive) catnipBtn.textContent = "Window Active";
    else if (game.placeCatnipMode) catnipBtn.textContent = "Placing...";
    else if (game.catnip) catnipBtn.textContent = Number.isFinite(game.catnip.expiresAt) ? "Catnip Active" : "Catnip Placed";
    else if (clockTime < (game.catnipNoRouteUntil || 0)) catnipBtn.textContent = "No Route";
    else if (cooldown > 0) catnipBtn.textContent = "Catnip";
    else catnipBtn.textContent = "Catnip (C)";
    if (windowActive || cooldown > 0) catnipBtn.style.background = "#4f6f55";
    else if (game.catnip || game.placeCatnipMode) catnipBtn.style.background = "#a8e3ae";
    else catnipBtn.style.background = "";
    setTimerBubble(catnipTimerBubbleEl, game.catnip ? `${catnipPlacedRemaining}s` : cooldown > 0 ? `${cooldown}s` : "");
  }
  if (windowBtn) {
    const windowActive = clockTime < (game.windowOpenUntil || 0);
    const windowCooldown = Math.max(0, Math.ceil((game.windowCooldownUntil || 0) - clockTime));
    const coolingDown = !windowActive && windowCooldown > 0;
    const windowEnabled = windowSill?.specialFlags?.windowOpensOnButtonClick !== false;
    const windowActiveRemaining = Math.max(0, Math.ceil((game.windowOpenUntil || 0) - clockTime));
    windowBtn.style.display = "";
    windowBtn.disabled = game.paused || windowActive || coolingDown || !windowEnabled;
    if (!windowEnabled) windowBtn.textContent = "Window Disabled";
    else if (windowActive) windowBtn.textContent = "Window Open";
    else if (coolingDown) windowBtn.textContent = "Window";
    else windowBtn.textContent = "Window (Space)";
    if (windowActive) windowBtn.style.background = "#bdeeff";
    else if (coolingDown) windowBtn.style.background = "#617386";
    else windowBtn.style.background = "";
    setTimerBubble(windowTimerBubbleEl, windowActive ? `${windowActiveRemaining}s` : coolingDown ? `${windowCooldown}s` : "");
  }
  if (pauseBtn) {
    pauseBtn.textContent = game.paused ? "Resume (P)" : "Pause (P)";
    pauseBtn.style.background = game.paused ? "#78d17f" : "";
    pauseBtn.style.color = game.paused ? "#102312" : "";
    pauseBtn.style.display = "";
  }
  if (messMeterWrapEl) messMeterWrapEl.style.display = "";
  if (restartBtn) restartBtn.textContent = "Restart";
  if (resultEl) resultEl.textContent = "";
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
  const windowStartAt = perfSample ? performance.now() : 0;
  const nextOpen = THREE.MathUtils.damp(openNow, openTarget, 9.0, stepDt);
  windowSillRuntime.setOpenAmount(nextOpen);
  if (perfSample) {
    perfSample.windowMs += performance.now() - windowStartAt;
  }

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
    if (game.endlessMode && game.mess >= ENDLESS_SPAWN.loseThreshold) {
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
  const frameIntervalMs =
    lastAnimationFrameAt > 0 ? frameStartAt - lastAnimationFrameAt : NaN;
  lastAnimationFrameAt = frameStartAt;
  const frameDt = Math.min(clock.getDelta(), MAX_FRAME_DT);
  const timeScale = game.paused ? 0 : THREE.MathUtils.clamp(game.timeScale, 0, 2);
  const perfSample = {
    frameIntervalMs,
    frameDtMs: frameDt * 1000,
    simSteps: 0,
    simulatedDtMs: 0,
    simMs: 0,
    windowMs: 0,
    physicsMs: 0,
    pickupsMs: 0,
    spawnMs: 0,
    catMs: 0,
    cupMs: 0,
    shatterMs: 0,
    debugCameraMs: 0,
    debugViewMs: 0,
    controlsMs: 0,
    uiMs: 0,
    renderMs: 0,
    postRenderMs: 0,
    accountedMs: 0,
    unaccountedMs: 0,
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

  let stageStartAt = performance.now();
  debugCameraRuntime.updateDebugCameraControls(frameDt);
  perfSample.debugCameraMs += performance.now() - stageStartAt;

  if (!debugRuntime.isDebugVisible()) {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);
  }

  stageStartAt = performance.now();
  updateDebugView();
  perfSample.debugViewMs += performance.now() - stageStartAt;

  stageStartAt = performance.now();
  controls.update();
  perfSample.controlsMs += performance.now() - stageStartAt;

  stageStartAt = performance.now();
  updateUI();
  perfSample.uiMs += performance.now() - stageStartAt;

  stageStartAt = performance.now();
  renderer.render(scene, camera);
  perfSample.renderMs += performance.now() - stageStartAt;

  const postRenderStartAt = performance.now();
  perfSample.frameMs = postRenderStartAt - frameStartAt;
  perfSample.drawCalls = Number(renderer.info?.render?.calls || 0);
  perfSample.triangles = Number(renderer.info?.render?.triangles || 0);
  perfSample.lines = Number(renderer.info?.render?.lines || 0);
  perfSample.points = Number(renderer.info?.render?.points || 0);
  perfSample.geometries = Number(renderer.info?.memory?.geometries || 0);
  perfSample.textures = Number(renderer.info?.memory?.textures || 0);
  perfSample.postRenderMs += performance.now() - postRenderStartAt;
  perfSample.accountedMs =
    perfSample.simMs +
    perfSample.debugCameraMs +
    perfSample.debugViewMs +
    perfSample.controlsMs +
    perfSample.uiMs +
    perfSample.renderMs +
    perfSample.postRenderMs;
  perfSample.unaccountedMs = Math.max(0, perfSample.frameMs - perfSample.accountedMs);
  if (typeof debugRuntime.updatePerformanceSample === "function") {
    debugRuntime.updatePerformanceSample(perfSample, clockTime);
  }
  requestAnimationFrame(animate);
}

function normalizeShortcutKey(event) {
  const key = String(event?.key || "").toLowerCase();
  return key === " " ? "space" : key;
}

function adjustSecretGameSpeed(direction) {
  const current = Number.isFinite(game.timeScale) ? game.timeScale : 1;
  const stepped = Math.round((current + direction * SECRET_SPEED_STEP) * 10) / 10;
  game.timeScale = THREE.MathUtils.clamp(stepped, SECRET_SPEED_MIN, SECRET_SPEED_MAX);
}

window.addEventListener("keydown", (e) => {
  const normalizedKey = normalizeShortcutKey(e);
  if (normalizedKey) pressedKeys.add(normalizedKey);
  const target = e.target;
  const tagName = typeof target?.tagName === "string" ? target.tagName.toLowerCase() : "";
  const shortcutBlocked = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
  const rulesOpen = !!rulesOverlay && !rulesOverlay.classList.contains("hidden");
  const menuOpen = isGameMenuOpen();
  const optionsOpen = !!optionsOverlay && !optionsOverlay.classList.contains("hidden");
  const quitConfirmOpen = !!quitConfirmOverlay && !quitConfirmOverlay.classList.contains("hidden");
  if (e.key === "Escape" && rulesOpen) {
    hideRules();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === "Escape" && optionsOpen) {
    hideOptions();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === "Escape" && menuOpen) {
    hideGameMenu(true);
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === "Escape" && quitConfirmOpen) {
    hideQuitConfirm();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (rulesOpen || menuOpen || optionsOpen || quitConfirmOpen) return;
  if (
    !shortcutBlocked &&
    game.state === "playing" &&
    (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
    pressedKeys.has("l")
  ) {
    adjustSecretGameSpeed(e.key === "ArrowLeft" ? -1 : 1);
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!shortcutBlocked && game.state === "playing" && (e.key || "").toLowerCase() === "b") {
    setDebugEnabled(!playerOptions.debugEnabled);
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === "Escape" && game.state === "playing") {
    showGameMenu();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!shortcutBlocked && (e.key || "").toLowerCase() === "p") {
    togglePaused();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!shortcutBlocked && game.state === "playing" && (e.key || "").toLowerCase() === "r") {
    showRunEndConfirm("restart");
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!shortcutBlocked && game.state === "playing" && (e.key || "").toLowerCase() === "m") {
    showRunEndConfirm("quit");
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!shortcutBlocked && game.state === "playing" && !game.paused && (e.key || "").toLowerCase() === "c") {
    enterCatnipPlacementMode();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!shortcutBlocked && game.state === "playing" && !game.paused && e.code === "Space") {
    openWindowSill();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
}, { capture: true });

window.addEventListener("keyup", (e) => {
  const normalizedKey = normalizeShortcutKey(e);
  if (normalizedKey) pressedKeys.delete(normalizedKey);
});
