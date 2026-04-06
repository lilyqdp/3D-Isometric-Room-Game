import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildRoomSceneFromLayout } from "./modules/room.js";
import { createMainDebugCameraRuntime } from "./modules/main-debug-camera.js";
import {
  addModelRoomObject,
  addPrimitiveRoomObject,
  buildFloorSurfaceSpec,
  buildRoomDerivedData,
  buildRoomSurfaceSpecs,
  calibrateRoomObjectDimensionsFromRuntimeBounds,
  createDefaultRoomLayout,
  createRoomLayoutFromData,
  duplicateRoomObject,
  getRoomObjectDisplayName,
  moveRoomObject,
  removeRoomObject,
  roomObjectSupportsObstacleSettings,
  roomObjectSupportsSurface,
  setRoomObjectRotationDegrees,
  rotateRoomObjectQuarterTurns,
  serializeRoomLayoutData,
  setRoomObjectEditorLocked,
  setRoomObjectFlag,
  setRoomObjectNumericField,
  setRoomObjectObstacleEnabled,
  setRoomObjectObstacleIgnoreSurfaceIds,
  setRoomObjectObstacleMode,
  setRoomObjectVisible,
  setRoomObjectRuntimeAsset,
  setRoomObjectSurfaceNumericField,
  setRoomObjectSurfaceShape,
  setRoomObjectSpecialFlag,
  setRoomObjectStringField,
  setRoomObjectSurfaceEnabled,
} from "./modules/room-layout.js";
import { createSurfaceRegistry } from "./modules/surface-registry.js";
import { createCatJumpPlanningRuntime } from "./modules/cat-jump-planning.js";
import { createCatPathfindingRuntime } from "./modules/cat-pathfinding.js";
import {
  getObjectRotationDegrees,
  getObjectRotationRadians,
  getRotatedRectAabb,
  getSurfaceCenter,
  getSurfaceHalfExtents,
  getSurfaceKind,
  getSurfaceRadius,
  normalizeRotationDegrees,
  rotateOffsetXZ,
} from "./modules/surface-shapes.js";

const objectCountEl = document.getElementById("objectCount");
const surfaceCountEl = document.getElementById("surfaceCount");
const objectListEl = document.getElementById("objectList");
const objectDetailsEl = document.getElementById("objectDetails");
const focusSelectionBtn = document.getElementById("focusSelectionBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const rotateLeftBtn = document.getElementById("rotateLeftBtn");
const rotateRightBtn = document.getElementById("rotateRightBtn");
const addCubeBtn = document.getElementById("addCubeBtn");
const addRectPrismBtn = document.getElementById("addRectPrismBtn");
const addSphereBtn = document.getElementById("addSphereBtn");
const addCylinderBtn = document.getElementById("addCylinderBtn");
const addTriPrismBtn = document.getElementById("addTriPrismBtn");
const addGlbModelBtn = document.getElementById("addGlbModelBtn");
const duplicateObjectBtn = document.getElementById("duplicateObjectBtn");
const deleteObjectBtn = document.getElementById("deleteObjectBtn");
const fallbackModelsBtn = document.getElementById("fallbackModelsBtn");
const downloadLayoutBtn = document.getElementById("downloadLayoutBtn");
const saveGameLayoutBtn = document.getElementById("saveGameLayoutBtn");
const revertSavedLayoutBtn = document.getElementById("revertSavedLayoutBtn");
const importLayoutBtn = document.getElementById("importLayoutBtn");
const importLayoutInput = document.getElementById("importLayoutInput");
const glbAssetInput = document.getElementById("glbAssetInput");
const resetLayoutBtn = document.getElementById("resetLayoutBtn");
const setDefaultLayoutBtn = document.getElementById("setDefaultLayoutBtn");
const editorStatusEl = document.getElementById("editorStatus");
const advShowSurfaceBoundsEl = document.getElementById("advShowSurfaceBounds");
const advShowSurfaceAnchorsEl = document.getElementById("advShowSurfaceAnchors");
const advShowSurfaceProbesEl = document.getElementById("advShowSurfaceProbes");
const advShowSurfaceLinksEl = document.getElementById("advShowSurfaceLinks");
const advShowSurfaceVectorBlockersEl = document.getElementById("advShowSurfaceVectorBlockers");
const advShowNavMeshLinesEl = document.getElementById("advShowNavMeshLines");
const advShowNavMeshFillEl = document.getElementById("advShowNavMeshFill");
const advShowObjectCollisionShapesEl = document.getElementById("advShowObjectCollisionShapes");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9dce2);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(13.5, 11.5, 13.5);

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

const defaultTarget = new THREE.Vector3(-1.2, 1.4, -1.2);
controls.target.copy(defaultTarget);
camera.lookAt(defaultTarget);

const hemi = new THREE.HemisphereLight(0xf5f7fb, 0x8792a1, 0.95);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(9, 12, 6);
scene.add(sun);

const floorGrid = new THREE.GridHelper(16, 16, 0x93a0b7, 0xb4bece);
floorGrid.position.y = 0.01;
scene.add(floorGrid);

const selectionHighlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0xf0b861 })
);
selectionHighlight.visible = false;
scene.add(selectionHighlight);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragPoint = new THREE.Vector3();
const gltfLoader = new GLTFLoader();
const TRASH_CAN_MODEL_URL = `${import.meta.env.BASE_URL}mvp/trash_can.glb`;
const TRASH_CAN_MODEL_CANDIDATES = Array.from(
  new Set([
    TRASH_CAN_MODEL_URL,
    "/mvp/trash_can.glb",
    `${import.meta.env.BASE_URL}public/mvp/trash_can.glb`,
    "/public/mvp/trash_can.glb",
  ])
);
const ROOM_LAYOUT_URL = `${import.meta.env.BASE_URL}mvp/room-layout.json`;
const DEFAULT_ROOM_LAYOUT_URL = `${import.meta.env.BASE_URL}mvp/default-room-layout.json`;
const ROOM_OBJECT_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const EDITOR_CAT_NAV = {
  step: 0.26,
  margin: 0.4,
  clearance: 0.2,
};
const EDITOR_CAT_COLLISION = {
  catBodyRadius: 0.26,
};
const EDITOR_ADVANCED_DEFAULTS = {
  showSurfaceBounds: false,
  showSurfaceAnchors: false,
  showSurfaceProbes: false,
  showSurfaceLinks: false,
  showSurfaceVectorBlockers: false,
  showNavMeshLines: false,
  showNavMeshFill: false,
  showObjectCollisionShapes: false,
};

const builtInDefaultSnapshot = serializeRoomLayoutData(createDefaultRoomLayout(THREE), { includeTransient: true });
let roomLayout = createRoomLayoutFromData(THREE, builtInDefaultSnapshot);
let surfaceSpecs = [];
let roomRoot = null;
let selectedObjectId = null;
let dragState = null;
let liveRotationState = null;
let useFallbackModels = false;
let pendingGlbTargetObjectId = null;
const undoHistory = [];
const redoHistory = [];
const MAX_UNDO_HISTORY = 80;
const transientAssetUrls = new Set();
let savedGameLayoutSnapshot = builtInDefaultSnapshot;
let defaultLayoutSnapshot = builtInDefaultSnapshot;
let editorPathRuntime = null;
let editorPathRuntimeInitPromise = null;
let editorPathRuntimeReady = false;
let editorPathRuntimeVersion = 0;
const editorDebug = {
  root: new THREE.Group(),
  flags: { ...EDITOR_ADVANCED_DEFAULTS },
};
editorDebug.root.name = "editorAdvancedDebug";
scene.add(editorDebug.root);

const editorDebugCameraRuntime = createMainDebugCameraRuntime({
  THREE,
  camera,
  controls,
  debugRuntime: {
    onKeyDown() {},
    isDebugVisible: () => true,
  },
  debugControlsRuntime: {
    teleportCatToDebugMouseTarget() {},
  },
  game: { state: "editing" },
  getClockTime: () => 0,
});

function sanitizeRuntimeModelBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const width = Number(bounds.width);
  const depth = Number(bounds.depth);
  const height = Number(bounds.height);
  if (![width, depth, height].every(Number.isFinite)) return null;
  return {
    width: Math.max(0.05, width),
    depth: Math.max(0.05, depth),
    height: Math.max(0.05, height),
  };
}

function runtimeModelBoundsEqual(a, b, epsilon = 1e-3) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(Number(a.width) - Number(b.width)) <= epsilon &&
    Math.abs(Number(a.depth) - Number(b.depth)) <= epsilon &&
    Math.abs(Number(a.height) - Number(b.height)) <= epsilon
  );
}

function updateRuntimeModelBounds(objectId, fittedBounds) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (!object || object.type !== "model") return false;
  const nextBounds = sanitizeRuntimeModelBounds(fittedBounds);
  const prevBounds = sanitizeRuntimeModelBounds(object.runtimeAssetBounds);
  if (runtimeModelBoundsEqual(prevBounds, nextBounds)) return false;
  if (nextBounds) object.runtimeAssetBounds = nextBounds;
  else delete object.runtimeAssetBounds;
  return true;
}

function setStatus(message) {
  if (editorStatusEl) editorStatusEl.textContent = message;
}

function updateUndoButton() {
  if (undoBtn) undoBtn.disabled = undoHistory.length === 0;
  if (redoBtn) redoBtn.disabled = redoHistory.length === 0;
}

function updateFallbackModelsButton() {
  if (!fallbackModelsBtn) return;
  fallbackModelsBtn.textContent = `Use Fallback Meshes: ${useFallbackModels ? "On" : "Off"}`;
}

function trackTransientAssetUrl(url) {
  if (!url) return "";
  transientAssetUrls.add(url);
  return url;
}

function syncAdvancedFlagsFromInputs() {
  editorDebug.flags.showSurfaceBounds = !!advShowSurfaceBoundsEl?.checked;
  editorDebug.flags.showSurfaceAnchors = !!advShowSurfaceAnchorsEl?.checked;
  editorDebug.flags.showSurfaceProbes = !!advShowSurfaceProbesEl?.checked;
  editorDebug.flags.showSurfaceLinks = !!advShowSurfaceLinksEl?.checked;
  editorDebug.flags.showSurfaceVectorBlockers = !!advShowSurfaceVectorBlockersEl?.checked;
  editorDebug.flags.showNavMeshLines = !!advShowNavMeshLinesEl?.checked;
  editorDebug.flags.showNavMeshFill = !!advShowNavMeshFillEl?.checked;
  editorDebug.flags.showObjectCollisionShapes = !!advShowObjectCollisionShapesEl?.checked;
}

function anyAdvancedDebugEnabled() {
  return Object.values(editorDebug.flags).some(Boolean);
}

function disposeGroupContents(group) {
  if (!group) return;
  const children = [...group.children];
  for (const child of children) {
    if (!child) continue;
    if (typeof child.traverse === "function") {
      child.traverse((node) => {
        if (node.geometry && typeof node.geometry.dispose === "function") node.geometry.dispose();
        if (Array.isArray(node.material)) {
          for (const material of node.material) {
            if (material && typeof material.dispose === "function") material.dispose();
          }
        } else if (node.material && typeof node.material.dispose === "function") {
          node.material.dispose();
        }
      });
    }
    group.remove(child);
  }
}

function addDebugLine(group, a, b, color, opacity = 1, renderOrder = 30) {
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = renderOrder;
  group.add(line);
  return line;
}

function addDebugRectLoop(group, rect, y, color, opacity = 1, renderOrder = 30) {
  if (!rect) return null;
  const points = [
    new THREE.Vector3(rect.minX, y, rect.minZ),
    new THREE.Vector3(rect.maxX, y, rect.minZ),
    new THREE.Vector3(rect.maxX, y, rect.maxZ),
    new THREE.Vector3(rect.minX, y, rect.maxZ),
    new THREE.Vector3(rect.minX, y, rect.minZ),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
  });
  const loop = new THREE.Line(geometry, material);
  loop.renderOrder = renderOrder;
  group.add(loop);
  return loop;
}

function addDebugCircleLoop(group, centerX, centerZ, radius, y, color, opacity = 1, renderOrder = 30) {
  const geometry = new THREE.BufferGeometry();
  const points = [];
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    points.push(new THREE.Vector3(centerX + Math.cos(t) * radius, y, centerZ + Math.sin(t) * radius));
  }
  geometry.setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
  });
  const loop = new THREE.Line(geometry, material);
  loop.renderOrder = renderOrder;
  group.add(loop);
  return loop;
}

function addDebugSurfaceLoop(group, surface, y, color, opacity = 1, renderOrder = 30) {
  if (!surface) return null;
  const kind = getSurfaceKind(surface);
  if (kind === "circle") {
    const center = getSurfaceCenter(surface);
    return addDebugCircleLoop(group, center.x, center.z, Math.max(0.02, getSurfaceRadius(surface)), y, color, opacity, renderOrder);
  }
  if (kind === "obb") {
    const center = getSurfaceCenter(surface);
    const { hx, hz } = getSurfaceHalfExtents(surface);
    const yaw = Number(surface.yaw || 0);
    const corners = [
      { x: -hx, z: -hz },
      { x: hx, z: -hz },
      { x: hx, z: hz },
      { x: -hx, z: hz },
      { x: -hx, z: -hz },
    ].map((corner) => {
      const rotated = rotateOffsetXZ(corner.x, corner.z, yaw);
      return new THREE.Vector3(center.x + rotated.dx, y, center.z + rotated.dz);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
    });
    const loop = new THREE.Line(geometry, material);
    loop.renderOrder = renderOrder;
    group.add(loop);
    return loop;
  }
  return addDebugRectLoop(group, surface, y, color, opacity, renderOrder);
}

function addDebugMarker(group, position, color, radius = 0.03, renderOrder = 31) {
  const geometry = new THREE.SphereGeometry(radius, 10, 10);
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.copy(position);
  marker.renderOrder = renderOrder;
  group.add(marker);
  return marker;
}

function addDebugObstacle(group, obstacle, color, opacity = 0.15, renderOrder = 29) {
  if (!obstacle) return null;
  const height = Number.isFinite(obstacle.h) ? Math.max(0.02, obstacle.h) : 0.02;
  const centerY = Number.isFinite(obstacle.y) ? obstacle.y : height * 0.5;
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  let mesh = null;
  if (obstacle.kind === "circle") {
    const radius = Math.max(0.01, obstacle.r || 0.01);
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material);
  } else {
    const hx = Math.max(0.01, obstacle.hx || 0.01);
    const hz = Math.max(0.01, obstacle.hz || 0.01);
    mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, height, hz * 2), material);
    if (obstacle.kind === "obb" && Number.isFinite(obstacle.yaw)) mesh.rotation.y = obstacle.yaw;
  }
  if (!mesh) return null;
  mesh.position.set(obstacle.x || 0, centerY, obstacle.z || 0);
  mesh.renderOrder = renderOrder;
  group.add(mesh);
  return mesh;
}

function getEditorObstaclePad(obstacle) {
  return Math.max(0, Number(obstacle?.navPad) || 0);
}

function editorObstacleOverlapsQueryY(obstacle, queryY) {
  if (!Number.isFinite(queryY)) return true;
  if (!Number.isFinite(obstacle?.y) || !Number.isFinite(obstacle?.h)) return true;
  const yTolerance = queryY <= 0.08 ? 0.08 : 0.025;
  const halfHeight = Math.max(0.001, Number(obstacle.h) * 0.5);
  return queryY >= obstacle.y - halfHeight - yTolerance && queryY <= obstacle.y + halfHeight + yTolerance;
}

function isEditorPointBlocked(x, z, obstacles, clearance = null, queryY = 0) {
  const navClearance = Number.isFinite(Number(clearance))
    ? Math.max(0, Number(clearance))
    : Math.max(0.01, EDITOR_CAT_COLLISION.catBodyRadius + 0.001);
  const room = roomLayout.roomBounds;
  const y = Number.isFinite(queryY) ? queryY : 0;
  const boundaryMargin = y <= 0.08 ? EDITOR_CAT_NAV.margin : 0.02;
  if (
    x < room.minX + boundaryMargin ||
    x > room.maxX - boundaryMargin ||
    z < room.minZ + boundaryMargin ||
    z > room.maxZ - boundaryMargin
  ) {
    return true;
  }
  for (const obstacle of obstacles || []) {
    if (obstacle?.blocksPath === false) continue;
    if (!editorObstacleOverlapsQueryY(obstacle, queryY)) continue;
    const dx = x - (obstacle.x || 0);
    const dz = z - (obstacle.z || 0);
    const obstacleClearance = navClearance + getEditorObstaclePad(obstacle);
    if (obstacle.kind === "box") {
      if (Math.abs(dx) <= (obstacle.hx || 0) + obstacleClearance && Math.abs(dz) <= (obstacle.hz || 0) + obstacleClearance) {
        return true;
      }
      continue;
    }
    if (obstacle.kind === "obb") {
      const c = Math.cos(obstacle.yaw || 0);
      const s = Math.sin(obstacle.yaw || 0);
      const lx = c * dx + s * dz;
      const lz = -s * dx + c * dz;
      if (Math.abs(lx) <= (obstacle.hx || 0) + obstacleClearance && Math.abs(lz) <= (obstacle.hz || 0) + obstacleClearance) {
        return true;
      }
      continue;
    }
    const radius = (obstacle.r || 0) + obstacleClearance;
    if (dx * dx + dz * dz <= radius * radius) return true;
  }
  return false;
}

function buildEditorStaticObstacles(roomDerived, extraNavObstacles) {
  const obstacles = [];
  const hamper = roomLayout.objectsById?.hamper || null;
  const trashCan = roomLayout.objectsById?.trashCan || null;
  if (hamper?.obstacle?.enabled) {
    obstacles.push({
      kind: "box",
      mode: "soft",
      tag: "hamper",
      x: hamper.pos.x,
      z: hamper.pos.z,
      hx: hamper.outerHalfX + 0.01,
      hz: hamper.outerHalfZ + 0.01,
      navPad: 0.03,
      steerPad: 0.012,
      collisionPad: 0,
      y: hamper.rimY * 0.5,
      h: hamper.rimY + 0.06,
    });
  }
  if (trashCan?.obstacle?.enabled) {
    obstacles.push({
      kind: "circle",
      mode: "soft",
      tag: "trashcan",
      x: trashCan.pos.x,
      z: trashCan.pos.z,
      r: trashCan.outerRadius + 0.08,
      navPad: 0.06,
      steerPad: 0.016,
      collisionPad: 0,
      y: trashCan.rimY * 0.5,
      h: trashCan.rimY + 0.08,
    });
  }
  for (const leg of roomDerived?.deskLegs || []) {
    obstacles.push({
      kind: "box",
      mode: "hard",
      x: leg.x,
      z: leg.z,
      hx: leg.halfX + 0.02,
      hz: leg.halfZ + 0.02,
      navPad: 0.025,
      steerPad: 0.02,
      collisionPad: 0,
      jumpIgnoreSurfaceIds: ["desk"],
      y: leg.topY * 0.5,
      h: leg.topY + 0.04,
      surfaceId: leg.surfaceId || null,
    });
  }
  for (const obstacle of extraNavObstacles || []) {
    if (!obstacle) continue;
    obstacles.push({ ...obstacle });
  }
  for (const obstacle of roomDerived?.extraNavObstacles || []) {
    if (!obstacle) continue;
    obstacles.push({ ...obstacle });
  }
  return obstacles;
}

function buildEditorObjectCollisionShapes() {
  const roomDerived = buildRoomDerivedData(roomLayout);
  const shapes = [];
  const pushBox = (x, y, z, hx, hz, height, yaw = 0) => {
    shapes.push({
      kind: Math.abs(yaw) > 1e-4 ? "obb" : "box",
      x,
      y,
      z,
      hx,
      hz,
      h: height,
      yaw,
    });
  };
  const pushCircle = (x, y, z, r, height) => {
    shapes.push({ kind: "circle", x, y, z, r, h: height });
  };

  const desk = roomLayout.objectsById?.desk || null;
  if (desk?.obstacle?.enabled) {
    for (const leg of roomDerived?.deskLegs || []) {
      pushBox(leg.x, 0.5, leg.z, leg.halfX, leg.halfZ, 1.0, 0);
    }
    pushBox(desk.pos.x, 1.02, desk.pos.z, desk.sizeX * 0.5, desk.sizeZ * 0.5, 0.12, getObjectRotationRadians(desk));
  }

  const hamper = roomLayout.objectsById?.hamper || null;
  if (hamper?.obstacle?.enabled) {
    pushBox(hamper.pos.x, hamper.rimY * 0.5, hamper.pos.z + hamper.outerHalfZ, hamper.outerHalfX, 0.03, hamper.rimY, 0);
    pushBox(hamper.pos.x, hamper.rimY * 0.5, hamper.pos.z - hamper.outerHalfZ, hamper.outerHalfX, 0.03, hamper.rimY, 0);
    pushBox(hamper.pos.x + hamper.outerHalfX, hamper.rimY * 0.5, hamper.pos.z, 0.03, hamper.outerHalfZ, hamper.rimY, 0);
    pushBox(hamper.pos.x - hamper.outerHalfX, hamper.rimY * 0.5, hamper.pos.z, 0.03, hamper.outerHalfZ, hamper.rimY, 0);
  }

  const trashCan = roomLayout.objectsById?.trashCan || null;
  if (trashCan?.obstacle?.enabled) {
    const segments = 24;
    const halfWallH = trashCan.rimY * 0.5;
    for (let i = 0; i < segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      const cx = trashCan.pos.x + Math.cos(t) * trashCan.outerRadius;
      const cz = trashCan.pos.z + Math.sin(t) * trashCan.outerRadius;
      pushBox(cx, halfWallH, cz, 0.12, 0.055, trashCan.rimY, t);
    }
  }

  for (const box of roomDerived?.extraStaticBoxes || []) {
    pushBox(box.x, box.y, box.z, box.hx, box.hz, box.hy * 2, box.rotY || 0);
  }

  return shapes;
}

function buildEditorJumpDebugData() {
  const floorSpec = buildFloorSurfaceSpec(roomLayout);
  const allSurfaceDefs = [floorSpec, ...surfaceSpecs].filter(Boolean);
  const surfaceRegistry = createSurfaceRegistry({
    floorBounds: {
      minX: roomLayout.roomBounds.minX + EDITOR_CAT_NAV.margin,
      maxX: roomLayout.roomBounds.maxX - EDITOR_CAT_NAV.margin,
      minZ: roomLayout.roomBounds.minZ + EDITOR_CAT_NAV.margin,
      maxZ: roomLayout.roomBounds.maxZ - EDITOR_CAT_NAV.margin,
    },
    floorY: roomLayout.roomBounds.floorY,
    floorSpec,
    surfaceSpecs,
  });
  const roomDerived = buildRoomDerivedData(roomLayout);
  const staticObstacles = buildEditorStaticObstacles(roomDerived, surfaceRegistry.buildNavObstacles());
  const jumpRuntime = createCatJumpPlanningRuntime({
    THREE,
    CAT_NAV: EDITOR_CAT_NAV,
    CAT_COLLISION: EDITOR_CAT_COLLISION,
    ROOM: roomLayout.roomBounds,
    getSurfaceDefs: ({ includeFloor = true } = {}) => (includeFloor ? allSurfaceDefs : surfaceSpecs),
    getSurfaceById: (surfaceId) => allSurfaceDefs.find((surface) => String(surface?.id || "") === String(surfaceId || "")) || null,
    CUP_COLLISION: {},
    pickups: [],
    cup: { broken: true, falling: false, group: { visible: false, position: new THREE.Vector3() } },
    pickupRadius: 0,
    buildCatObstacles: () => staticObstacles,
    isCatPointBlocked: (x, z, obstacles, clearance, queryY) =>
      isEditorPointBlocked(x, z, obstacles || staticObstacles, clearance, queryY),
    computeCatPath: () => [],
    isPathTraversable: () => false,
    catPathDistance: () => Infinity,
    hasClearTravelLine: () => true,
    recordFunctionTrace: () => {},
  });
  return jumpRuntime.getSurfaceJumpDebugData();
}

function createEditorPathfindingRuntime() {
  const floorSpec = buildFloorSurfaceSpec(roomLayout);
  const allSurfaceDefs = [floorSpec, ...surfaceSpecs].filter(Boolean);
  const surfaceRegistry = createSurfaceRegistry({
    floorBounds: {
      minX: roomLayout.roomBounds.minX + EDITOR_CAT_NAV.margin,
      maxX: roomLayout.roomBounds.maxX - EDITOR_CAT_NAV.margin,
      minZ: roomLayout.roomBounds.minZ + EDITOR_CAT_NAV.margin,
      maxZ: roomLayout.roomBounds.maxZ - EDITOR_CAT_NAV.margin,
    },
    floorY: roomLayout.roomBounds.floorY,
    floorSpec,
    surfaceSpecs,
  });
  const roomDerived = buildRoomDerivedData(roomLayout);
  const pathRuntime = createCatPathfindingRuntime({
    THREE,
    CAT_NAV: EDITOR_CAT_NAV,
    CAT_COLLISION: EDITOR_CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON: 0.001,
    ROOM: roomLayout.roomBounds,
    getSurfaceDefs: ({ includeFloor = true } = {}) => (includeFloor ? allSurfaceDefs : surfaceSpecs),
    getSurfaceById: (surfaceId) => allSurfaceDefs.find((surface) => String(surface?.id || "") === String(surfaceId || "")) || null,
    hamper: roomLayout.objectsById?.hamper || null,
    trashCan: roomLayout.objectsById?.trashCan || null,
    DESK_LEGS: roomDerived?.deskLegs || [],
    EXTRA_NAV_OBSTACLES: [
      ...surfaceRegistry.buildNavObstacles(),
      ...(roomDerived?.extraNavObstacles || []),
    ],
    CUP_COLLISION: {},
    pickups: [],
    cat: {
      pos: new THREE.Vector3(0, 0, 0),
      group: { position: new THREE.Vector3(0, 0, 0) },
      nav: {},
    },
    cup: {
      broken: true,
      falling: false,
      group: { visible: false, position: new THREE.Vector3(0, 0, 0) },
    },
    pickupRadius: 0,
    getClockTime: () => 0,
  });
  return pathRuntime;
}

function hasNavMeshDebugEnabled() {
  return !!(editorDebug.flags.showNavMeshLines || editorDebug.flags.showNavMeshFill);
}

function invalidateEditorPathfindingRuntime() {
  editorPathRuntime = null;
  editorPathRuntimeInitPromise = null;
  editorPathRuntimeReady = false;
  editorPathRuntimeVersion += 1;
}

function ensureEditorPathfindingRuntime() {
  if (editorPathRuntime) return editorPathRuntime;
  const runtime = createEditorPathfindingRuntime();
  const version = editorPathRuntimeVersion + 1;
  editorPathRuntimeVersion = version;
  editorPathRuntime = runtime;
  editorPathRuntimeReady = false;
  editorPathRuntimeInitPromise = runtime.initPathfinding()
    .then(() => {
      if (editorPathRuntime !== runtime || editorPathRuntimeVersion !== version) return;
      editorPathRuntimeReady = true;
      if (hasNavMeshDebugEnabled()) rebuildAdvancedDebug();
    })
    .catch((error) => {
      if (editorPathRuntime !== runtime || editorPathRuntimeVersion !== version) return;
      console.warn("Editor pathfinding init failed", error);
      editorPathRuntimeReady = false;
    });
  return runtime;
}

function buildEditorNavMeshDebugData() {
  const pathRuntime = ensureEditorPathfindingRuntime();
  if (!pathRuntime || !editorPathRuntimeReady) return null;
  return pathRuntime.getActiveNavMeshDebugData
    ? pathRuntime.getActiveNavMeshDebugData()
    : (pathRuntime.getNavMeshDebugData ? pathRuntime.getNavMeshDebugData(true, true) : null);
}

function rebuildAdvancedDebug() {
  disposeGroupContents(editorDebug.root);
  syncAdvancedFlagsFromInputs();
  if (!anyAdvancedDebugEnabled()) return;
  const needsJumpData =
    editorDebug.flags.showSurfaceBounds ||
    editorDebug.flags.showSurfaceAnchors ||
    editorDebug.flags.showSurfaceProbes ||
    editorDebug.flags.showSurfaceLinks ||
    editorDebug.flags.showSurfaceVectorBlockers;
  const needsNavMeshData =
    editorDebug.flags.showNavMeshLines ||
    editorDebug.flags.showNavMeshFill;
  const collisionShapes = editorDebug.flags.showObjectCollisionShapes
    ? buildEditorObjectCollisionShapes()
    : null;
  const data = needsJumpData ? buildEditorJumpDebugData() : null;
  const navMesh = needsNavMeshData ? buildEditorNavMeshDebugData() : null;

  if (editorDebug.flags.showSurfaceBounds) {
    for (const surface of data.surfaces || []) {
      const surfaceY = Number.isFinite(surface?.y) ? surface.y : 0;
      if (surface?.shape === "circle") {
        addDebugSurfaceLoop(editorDebug.root, surface, surfaceY + 0.02, 0x6bc3ff, 0.78, 20);
        if (Number.isFinite(Number(surface.innerRadius))) {
          addDebugCircleLoop(
            editorDebug.root,
            Number(surface.centerX ?? surface.cx ?? 0),
            Number(surface.centerZ ?? surface.cz ?? 0),
            Math.max(0.02, Number(surface.innerRadius)),
            surfaceY + 0.028,
            0xb5ecff,
            0.78,
            21
          );
        }
        continue;
      }
      if (surface?.shape === "obb") {
        addDebugSurfaceLoop(editorDebug.root, surface, surfaceY + 0.02, 0x6bc3ff, 0.78, 20);
        if (surface?.innerRect) {
          addDebugSurfaceLoop(
            editorDebug.root,
            {
              shape: "obb",
              centerX: surface.centerX,
              centerZ: surface.centerZ,
              halfWidth: surface.innerRect.hx,
              halfDepth: surface.innerRect.hz,
              yaw: surface.yaw,
            },
            surfaceY + 0.028,
            0xb5ecff,
            0.78,
            21
          );
        }
        continue;
      }
      if (surface?.outer) addDebugRectLoop(editorDebug.root, surface.outer, surfaceY + 0.02, 0x6bc3ff, 0.78, 20);
      if (surface?.inner) addDebugRectLoop(editorDebug.root, surface.inner, surfaceY + 0.028, 0xb5ecff, 0.78, 21);
    }
  }

  if (editorDebug.flags.showSurfaceAnchors) {
    for (const surface of data.surfaces || []) {
      const surfaceY = Number.isFinite(surface?.y) ? surface.y : 0;
      for (const anchor of surface?.anchors || []) {
        if (!anchor?.inner || !anchor?.outer) continue;
        const outer = new THREE.Vector3(anchor.outer.x, surfaceY + 0.03, anchor.outer.z);
        const inner = new THREE.Vector3(anchor.inner.x, surfaceY + 0.03, anchor.inner.z);
        addDebugLine(editorDebug.root, outer, inner, 0xffc361, 0.9, 22);
        addDebugMarker(editorDebug.root, outer, 0xff6f61, 0.016, 23);
        addDebugMarker(editorDebug.root, inner, 0x57f287, 0.016, 23);
      }
    }
  }

  if (editorDebug.flags.showSurfaceProbes) {
    for (const probe of data.probes || []) {
      if (!probe?.origin || !probe?.end) continue;
      let color = 0xff6b6b;
      if (probe.debugClass === "validUp") color = 0x57f287;
      else if (probe.debugClass === "validDown") color = 0x7aa2ff;
      else if (probe.debugClass === "dynamicBlocked") color = 0xffb347;
      addDebugLine(editorDebug.root, probe.origin, probe.end, color, 0.9, 24);
      addDebugMarker(editorDebug.root, probe.end, color, probe.hit ? 0.012 : 0.01, 25);
    }
  }

  if (editorDebug.flags.showSurfaceLinks) {
    for (const link of data.links || []) {
      const color = link.validUp ? 0x57f287 : (link.validDown ? 0x7aa2ff : 0xff6b6b);
      const jumpFrom = new THREE.Vector3(link.jumpFrom.x, link.fromY, link.jumpFrom.z);
      const hook = new THREE.Vector3(link.hook.x, link.toY, link.hook.z);
      const top = new THREE.Vector3(link.top.x, link.toY, link.top.z);
      addDebugLine(editorDebug.root, jumpFrom, hook, color, 0.92, 26);
      addDebugLine(editorDebug.root, hook, top, color, 0.92, 26);
      addDebugMarker(editorDebug.root, jumpFrom, 0xffcf66, 0.014, 27);
      addDebugMarker(editorDebug.root, hook, 0xffffff, 0.014, 27);
      addDebugMarker(editorDebug.root, top, 0x57f287, 0.014, 27);
    }
  }

  if (editorDebug.flags.showSurfaceVectorBlockers) {
    for (const obstacle of data.vectorBlockers || []) {
      const color = obstacle.blockerClass === "surface" ? 0xff8f5c : 0xff4d4d;
      addDebugObstacle(editorDebug.root, obstacle, color, 0.16, 19);
    }
  }

  if (editorDebug.flags.showObjectCollisionShapes) {
    for (const obstacle of collisionShapes || []) {
      addDebugObstacle(editorDebug.root, obstacle, 0x9adf9f, 0.16, 18);
    }
  }

  if (navMesh) {
    const linePoints = [];
    const facePoints = [];
    const y = 0.03;
    if (Array.isArray(navMesh.segments) && navMesh.segments.length > 0) {
      for (const segment of navMesh.segments) {
        if (!segment || segment.length < 6) continue;
        linePoints.push(
          segment[0], segment[1] + y, segment[2],
          segment[3], segment[4] + y, segment[5]
        );
      }
    }
    const hasFlatTriangleBuffer =
      Array.isArray(navMesh.triangles) &&
      navMesh.triangles.length >= 9 &&
      typeof navMesh.triangles[0] === "number";
    if (hasFlatTriangleBuffer) {
      for (let i = 0; i < navMesh.triangles.length; i += 9) {
        facePoints.push(
          navMesh.triangles[i], navMesh.triangles[i + 1] + y * 0.4, navMesh.triangles[i + 2],
          navMesh.triangles[i + 3], navMesh.triangles[i + 4] + y * 0.4, navMesh.triangles[i + 5],
          navMesh.triangles[i + 6], navMesh.triangles[i + 7] + y * 0.4, navMesh.triangles[i + 8]
        );
      }
    } else if (navMesh.vertices && navMesh.triangles && navMesh.triangles.length > 0) {
      for (const tri of navMesh.triangles) {
        const a = navMesh.vertices[tri.a];
        const b = navMesh.vertices[tri.b];
        const c = navMesh.vertices[tri.c];
        if (!a || !b || !c) continue;
        linePoints.push(a.x, y, a.z, b.x, y, b.z);
        linePoints.push(b.x, y, b.z, c.x, y, c.z);
        linePoints.push(c.x, y, c.z, a.x, y, a.z);
        facePoints.push(a.x, y * 0.4, a.z, b.x, y * 0.4, b.z, c.x, y * 0.4, c.z);
      }
    }
    if (editorDebug.flags.showNavMeshFill && facePoints.length) {
      const fillGeo = new THREE.BufferGeometry();
      fillGeo.setAttribute("position", new THREE.Float32BufferAttribute(facePoints, 3));
      fillGeo.computeVertexNormals();
      const fill = new THREE.Mesh(
        fillGeo,
        new THREE.MeshBasicMaterial({
          color: 0xff8a00,
          transparent: true,
          opacity: 0.18,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
      );
      fill.renderOrder = 9;
      editorDebug.root.add(fill);
    }
    if (editorDebug.flags.showNavMeshLines && linePoints.length) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePoints, 3));
      const lines = new THREE.LineSegments(
        lineGeo,
        new THREE.LineBasicMaterial({
          color: 0xff8a00,
          transparent: true,
          opacity: 0.68,
          depthTest: true,
          depthWrite: false,
        })
      );
      lines.renderOrder = 10;
      editorDebug.root.add(lines);
    }
  }
}

function captureLayoutSnapshot() {
  return serializeRoomLayoutData(roomLayout, { includeTransient: true });
}

async function tryLoadLayoutSnapshot(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function initializeEditorLayout() {
  const loadedDefaultSnapshot = await tryLoadLayoutSnapshot(DEFAULT_ROOM_LAYOUT_URL);
  if (loadedDefaultSnapshot) defaultLayoutSnapshot = loadedDefaultSnapshot;

  const loadedGameSnapshot = await tryLoadLayoutSnapshot(ROOM_LAYOUT_URL);
  savedGameLayoutSnapshot = loadedGameSnapshot || defaultLayoutSnapshot || builtInDefaultSnapshot;
  roomLayout = createRoomLayoutFromData(THREE, savedGameLayoutSnapshot);
  selectedObjectId = roomLayout.objects[0]?.id || null;
}

function clearUndoHistory() {
  undoHistory.length = 0;
  redoHistory.length = 0;
  updateUndoButton();
}

function pushUndoSnapshot(label = "Change", snapshot = captureLayoutSnapshot()) {
  if (!snapshot) return;
  undoHistory.push({ label, snapshot });
  if (undoHistory.length > MAX_UNDO_HISTORY) undoHistory.splice(0, undoHistory.length - MAX_UNDO_HISTORY);
  redoHistory.length = 0;
  updateUndoButton();
}

function undoLastAction() {
  const entry = undoHistory.pop();
  if (!entry?.snapshot) return;
  const current = captureLayoutSnapshot();
  if (current) {
    redoHistory.push({ label: entry.label, snapshot: current });
    if (redoHistory.length > MAX_UNDO_HISTORY) redoHistory.splice(0, redoHistory.length - MAX_UNDO_HISTORY);
  }
  updateUndoButton();
  roomLayout = createRoomLayoutFromData(THREE, entry.snapshot);
  if (!roomLayout.objectsById?.[selectedObjectId]) selectedObjectId = roomLayout.objects[0]?.id || null;
  rebuildRoomScene({ refreshSidebar: true });
  setStatus(`Undid: ${entry.label}`);
}

function redoLastAction() {
  const entry = redoHistory.pop();
  if (!entry?.snapshot) return;
  const current = captureLayoutSnapshot();
  if (current) {
    undoHistory.push({ label: entry.label, snapshot: current });
    if (undoHistory.length > MAX_UNDO_HISTORY) undoHistory.splice(0, undoHistory.length - MAX_UNDO_HISTORY);
  }
  updateUndoButton();
  roomLayout = createRoomLayoutFromData(THREE, entry.snapshot);
  if (!roomLayout.objectsById?.[selectedObjectId]) selectedObjectId = roomLayout.objects[0]?.id || null;
  rebuildRoomScene({ refreshSidebar: true });
  setStatus(`Redid: ${entry.label}`);
}

function formatNumber(value) {
  return Number(value || 0).toFixed(3);
}

function getRuntimeMeasuredBounds(object) {
  if (!object || !object.runtimeAssetBounds || typeof object.runtimeAssetBounds !== "object") {
    return null;
  }
  const width = Number(object.runtimeAssetBounds.width);
  const depth = Number(object.runtimeAssetBounds.depth);
  const height = Number(object.runtimeAssetBounds.height);
  if (![width, depth, height].every(Number.isFinite)) return null;
  return { width, depth, height };
}

function forEachBoundingCorner(box, callback) {
  if (!box || typeof callback !== "function") return;
  const xs = [box.min.x, box.max.x];
  const ys = [box.min.y, box.max.y];
  const zs = [box.min.z, box.max.z];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        callback(x, y, z);
      }
    }
  }
}

function nodeContributesToCalibration(node) {
  if (!node?.isMesh || !node.geometry) return false;
  if (node.visible === false) return false;
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  if (!materials.length) return true;
  return materials.some((material) => {
    if (!material) return false;
    if (material.transparent && Number(material.opacity) <= 0.001) return false;
    return true;
  });
}

function measureRenderedObjectBounds(objectId) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (!object || !roomRoot) return null;
  const objectWorldMatrix = new THREE.Matrix4().makeRotationY(getObjectRotationRadians(object));
  objectWorldMatrix.setPosition(object.pos.x, object.pos.y, object.pos.z);
  const objectWorldInverse = objectWorldMatrix.clone().invert();
  const localBounds = new THREE.Box3();
  const tempCorner = new THREE.Vector3();
  let hasPoints = false;

  roomRoot.traverse((node) => {
    if (!nodeContributesToCalibration(node)) return;
    if (String(node.userData?.roomObjectId || "") !== String(objectId)) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const geometryBounds = node.geometry.boundingBox;
    if (!geometryBounds) return;
    forEachBoundingCorner(geometryBounds, (x, y, z) => {
      tempCorner.set(x, y, z).applyMatrix4(node.matrixWorld).applyMatrix4(objectWorldInverse);
      if (!hasPoints) {
        localBounds.min.copy(tempCorner);
        localBounds.max.copy(tempCorner);
        hasPoints = true;
      } else {
        localBounds.expandByPoint(tempCorner);
      }
    });
  });

  if (!hasPoints || localBounds.isEmpty()) return null;
  const size = new THREE.Vector3();
  localBounds.getSize(size);
  const width = Math.max(0.05, size.x);
  const depth = Math.max(0.05, size.z);
  const height = Math.max(0.05, size.y);
  if (![width, depth, height].every(Number.isFinite)) return null;
  return { width, depth, height };
}

function getRotatedRectSize(width, depth, object) {
  return getRotatedRectAabb(width, depth, getObjectRotationRadians(object));
}

function getObjectHeight(object) {
  const runtimeModelBounds = getRuntimeMeasuredBounds(object);
  switch (object?.type) {
    case "floor":
      return 0.2;
    case "desk":
      return object.topY;
    case "chair":
      return object.backHeight + object.seatY;
    case "shelf":
      return object.surfaceY + object.boardThickness;
    case "platform":
    case "windowSill":
      return object.surfaceY + object.thickness;
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      return Math.max(0.1, Number(object.height) || 1);
    case "primitive":
      return object.shapeKind === "sphere"
        ? Math.max(0.1, (Number(object.radius) || 0.45) * 2)
        : Math.max(0.1, Number(object.height) || 0.9);
    case "model":
      return Math.max(0.1, Number.isFinite(runtimeModelBounds?.height) ? runtimeModelBounds.height : Number(object.height) || 1);
    case "hamper":
      return object.rimY;
    case "trashCan":
      return object.rimY;
    default:
      return 0.5;
  }
}

function getObjectFootprint(object) {
  const runtimeModelBounds = getRuntimeMeasuredBounds(object);
  switch (object?.type) {
    case "floor":
      return getRotatedRectSize(object.width, object.depth, object);
    case "desk":
      return getRotatedRectSize(object.sizeX, object.sizeZ, object);
    case "chair":
      return getRotatedRectSize(object.sizeX, object.sizeZ, object);
    case "shelf":
      return getRotatedRectSize(object.width, object.depth, object);
    case "platform":
    case "windowSill":
      return getRotatedRectSize(object.width, object.depth, object);
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      return getRotatedRectSize(object.width, object.depth, object);
    case "primitive":
      if (object.shapeKind === "sphere" || object.shapeKind === "cylinder") {
        const diameter = Math.max(0.1, (Number(object.radius) || 0.45) * 2);
        return { width: diameter, depth: diameter };
      }
      return getRotatedRectSize(object.width, object.depth, object);
    case "model":
      return getRotatedRectSize(
        Number.isFinite(runtimeModelBounds?.width) ? runtimeModelBounds.width : object.width,
        Number.isFinite(runtimeModelBounds?.depth) ? runtimeModelBounds.depth : object.depth,
        object
      );
    case "hamper":
      return { width: object.outerHalfX * 2, depth: object.outerHalfZ * 2 };
    case "trashCan":
      return { width: object.outerRadius * 2, depth: object.outerRadius * 2 };
    default:
      return { width: 1, depth: 1 };
  }
}

function getObjectBaseSurfaceDimensions(object) {
  const runtimeModelBounds = getRuntimeMeasuredBounds(object);
  switch (object?.type) {
    case "floor":
      return { width: Number(object.width) || 0, depth: Number(object.depth) || 0, radius: null };
    case "desk":
      return { width: Number(object.sizeX) || 0, depth: Number(object.sizeZ) || 0, radius: null };
    case "chair":
      return { width: Number(object.sizeX) || 0, depth: Number(object.sizeZ) || 0, radius: null };
    case "shelf":
    case "platform":
    case "windowSill":
      return { width: Number(object.width) || 0, depth: Number(object.depth) || 0, radius: null };
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      return { width: Number(object.width) || 0, depth: Number(object.depth) || 0, radius: null };
    case "hamper":
      return {
        width: Math.max(0.1, Number(object.openingHalfX) || Number(object.outerHalfX) || 0) * 2,
        depth: Math.max(0.1, Number(object.openingHalfZ) || Number(object.outerHalfZ) || 0) * 2,
        radius: null,
      };
    case "trashCan": {
      const radius = Math.max(0.05, Number(object.openingRadius) || Number(object.outerRadius) || 0);
      return { width: radius * 2, depth: radius * 2, radius };
    }
    case "model":
      return {
        width: Number.isFinite(runtimeModelBounds?.width) ? runtimeModelBounds.width : Number(object.width) || 0,
        depth: Number.isFinite(runtimeModelBounds?.depth) ? runtimeModelBounds.depth : Number(object.depth) || 0,
        radius: null,
      };
    case "primitive":
      if (object.shapeKind === "cylinder") {
        const radius = Number(object.radius) || 0.45;
        return { width: radius * 2, depth: radius * 2, radius };
      }
      if (object.shapeKind === "sphere") {
        const radius = Number(object.radius) || 0.45;
        return { width: radius * 2, depth: radius * 2, radius };
      }
      return { width: Number(object.width) || 0, depth: Number(object.depth) || 0, radius: null };
    default:
      return { width: 0, depth: 0, radius: null };
  }
}

function getObjectCenter(object) {
  const height = getObjectHeight(object);
  if (object?.type === "primitive" && object.shapeKind === "sphere") {
    return new THREE.Vector3(object.pos.x, Number(object.centerY) || height * 0.5, object.pos.z);
  }
  if (object?.type === "primitive" || object?.type === "model") {
    const top = Number(object.surfaceY);
    if (Number.isFinite(top)) {
      return new THREE.Vector3(object.pos.x, top - height * 0.5, object.pos.z);
    }
  }
  return new THREE.Vector3(object.pos.x, height * 0.5, object.pos.z);
}

function updateSelectionHighlight(object) {
  if (!object) {
    selectionHighlight.visible = false;
    return;
  }
  const footprint = getObjectFootprint(object);
  const height = Math.max(0.12, getObjectHeight(object));
  const center = getObjectCenter(object);
  selectionHighlight.visible = true;
  selectionHighlight.position.copy(center);
  selectionHighlight.scale.set(
    Math.max(0.12, footprint.width + 0.08),
    height + 0.08,
    Math.max(0.12, footprint.depth + 0.08)
  );
}

function buildFlagsLabel(object) {
  const flags = object?.surface?.flags || {};
  const enabled = Object.entries(flags)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  return enabled.length ? enabled.join(", ") : "none";
}

function buildSpecialFlagsLabel(object) {
  const flags = object?.specialFlags || {};
  const enabled = Object.entries(flags)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  return enabled.length ? enabled.join(", ") : "none";
}

function objectHasSpecialModel(object) {
  return !!object && (object.type === "trashCan" || object.type === "model");
}

function canCalibrateObjectDimensions(object) {
  if (!object) return false;
  if (["model", "desk", "chair", "shelf", "platform", "windowSill", "bed", "bedsideTable", "rug", "wardrobe", "bookcase", "hamper", "trashCan"].includes(object.type)) {
    return true;
  }
  if (object.type !== "primitive") return false;
  const shapeKind = String(object.shapeKind || "").toLowerCase();
  return shapeKind !== "sphere" && shapeKind !== "cylinder";
}

function getSpecialModelLabel(object) {
  if (!objectHasSpecialModel(object)) return "none";
  if (object.type === "model") {
    if (useFallbackModels) return "Fallback mesh preview";
    if (object.runtimeAssetName) return `Local GLB: ${object.runtimeAssetName}`;
    if (object.assetPath) return `GLB preview: ${object.assetPath}`;
    return "No GLB source set";
  }
  return useFallbackModels ? "Fallback mesh preview" : "Asset model preview";
}

function getSurfaceFlagNames(object) {
  const keys = Object.keys(object?.surface?.flags || {});
  return keys.length
    ? keys
    : ["randomPatrol", "manualPatrol", "allowCatSpawn", "allowTrashSpawn", "allowLaundrySpawn", "allowCatnip"];
}

function getSpecialFlagNames(object) {
  return Object.keys(object?.specialFlags || {});
}

function objectSupportsObstacleSettings(object) {
  return roomObjectSupportsObstacleSettings(object);
}

function objectSupportsTint(object) {
  return !!object && object.type !== "none";
}

function getRotationDegrees(object) {
  return normalizeRotationDegrees(getObjectRotationDegrees(object));
}

function getSurfaceChoiceHint() {
  const ids = [];
  for (const candidate of roomLayout.objects || []) {
    if (!candidate?.surface?.enabled) continue;
    ids.push(String(candidate.id));
  }
  return ids.join(", ");
}

function getObjectLabel(object) {
  return getRoomObjectDisplayName(object);
}

function isObjectLocked(object) {
  return !!object?.editorLocked;
}

function canRotateObject(object) {
  if (!object) return false;
  if (["desk", "chair", "shelf", "platform", "model", "windowSill", "bed", "bedsideTable", "rug", "wardrobe", "bookcase"].includes(object.type)) return true;
  if (object.type === "primitive") return object.shapeKind !== "sphere";
  return false;
}

function canDuplicateObject(object) {
  return !!object && !isObjectLocked(object) && ["chair", "shelf", "platform", "primitive", "model", "bed", "bedsideTable", "rug", "wardrobe", "bookcase"].includes(object.type);
}

function suggestDuplicateId(object) {
  const base = String(object?.id || object?.type || "object").replace(/[^A-Za-z0-9_-]/g, "") || "object";
  let candidate = `${base}Copy`;
  let suffix = 2;
  while (roomLayout.objectsById?.[candidate]) {
    candidate = `${base}Copy${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function promptForUniqueObjectId(object) {
  let suggestion = suggestDuplicateId(object);
  while (true) {
    const raw = window.prompt("Choose a unique object name (letters, numbers, _ or -):", suggestion);
    if (raw == null) return null;
    const nextId = String(raw).trim();
    if (!ROOM_OBJECT_ID_RE.test(nextId)) {
      setStatus("Object names must start with a letter and use only letters, numbers, _ or -");
      suggestion = nextId || suggestion;
      continue;
    }
    if (roomLayout.objectsById?.[nextId]) {
      setStatus(`${nextId} already exists`);
      suggestion = nextId;
      continue;
    }
    return nextId;
  }
}

function getEditableFields(object) {
  switch (object?.type) {
    case "floor":
      return [
        { key: "width", label: "Width", step: 0.1 },
        { key: "depth", label: "Depth", step: 0.1 },
      ];
    case "desk":
      return [
        { key: "sizeX", label: "Width", step: 0.05 },
        { key: "sizeZ", label: "Depth", step: 0.05 },
        { key: "topY", label: "Top Y", step: 0.05 },
      ];
    case "chair":
      return [
        { key: "sizeX", label: "Width", step: 0.05 },
        { key: "sizeZ", label: "Depth", step: 0.05 },
        { key: "seatY", label: "Seat Y", step: 0.05 },
        { key: "backHeight", label: "Back H", step: 0.05 },
      ];
    case "shelf":
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "surfaceY", label: "Surface Y", step: 0.05 },
      ];
    case "platform":
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "surfaceY", label: "Surface Y", step: 0.05 },
      ];
    case "primitive":
      if (object.shapeKind === "sphere") {
        return [
          { key: "radius", label: "Radius", step: 0.05 },
          { key: "centerY", label: "Center Y", step: 0.05 },
        ];
      }
      if (object.shapeKind === "cylinder") {
        return [
          { key: "radius", label: "Radius", step: 0.05 },
          { key: "height", label: "Height", step: 0.05 },
          { key: "surfaceY", label: "Top Y", step: 0.05 },
        ];
      }
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "height", label: "Height", step: 0.05 },
        { key: "surfaceY", label: "Top Y", step: 0.05 },
      ];
    case "model":
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "height", label: "Height", step: 0.05 },
        { key: "surfaceY", label: "Top Y", step: 0.05 },
        { key: "modelScale", label: "Model Scale", step: 0.05 },
      ];
    case "bed":
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "height", label: "Height", step: 0.05 },
        { key: "surfaceY", label: "Top Y", step: 0.05 },
      ];
    case "bedsideTable":
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "height", label: "Height", step: 0.05 },
        { key: "surfaceY", label: "Top Y", step: 0.05 },
      ];
    case "rug":
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "height", label: "Thickness", step: 0.01 },
        { key: "surfaceY", label: "Top Y", step: 0.01 },
      ];
    case "wardrobe":
    case "bookcase":
      return [
        { key: "width", label: "Width", step: 0.05 },
        { key: "depth", label: "Depth", step: 0.05 },
        { key: "height", label: "Height", step: 0.05 },
        { key: "surfaceY", label: "Top Y", step: 0.05 },
      ];
    case "windowSill":
      return [
        { key: "width", label: "Sill W", step: 0.05 },
        { key: "depth", label: "Sill D", step: 0.05 },
        { key: "surfaceY", label: "Surface Y", step: 0.05 },
        { key: "windowWidth", label: "Window W", step: 0.05 },
        { key: "windowHeight", label: "Window H", step: 0.05 },
      ];
    case "hamper":
      return [
        { key: "outerHalfX", label: "Half W", step: 0.05 },
        { key: "outerHalfZ", label: "Half D", step: 0.05 },
        { key: "rimY", label: "Rim Y", step: 0.05 },
      ];
    case "trashCan":
      return [
        { key: "outerRadius", label: "Radius", step: 0.05 },
        { key: "openingRadius", label: "Open R", step: 0.05 },
        { key: "rimY", label: "Rim Y", step: 0.05 },
      ];
    default:
      return [];
  }
}

function createReadOnlyRow(labelText, valueText) {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = labelText;
  const value = document.createElement("span");
  value.textContent = valueText;
  row.append(label, value);
  return row;
}

function createDetailBlock(title) {
  const block = document.createElement("div");
  block.className = "detailBlock";
  const heading = document.createElement("h3");
  heading.textContent = title;
  block.appendChild(heading);
  return block;
}

function commitNumericField(objectId, key, rawValue) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (isObjectLocked(object)) {
    renderObjectDetails(object);
    setStatus(`${objectId} is locked`);
    return;
  }
  pushUndoSnapshot(`Update ${objectId}.${key}`);
  const updated = setRoomObjectNumericField(roomLayout, objectId, key, rawValue);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    renderObjectDetails(roomLayout.objectsById?.[objectId] || null);
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`Updated ${objectId}.${key}`);
}

function commitSurfaceEnabled(objectId, enabled) {
  pushUndoSnapshot(`Toggle ${objectId} walkable`);
  const updated = setRoomObjectSurfaceEnabled(roomLayout, objectId, enabled);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} walkable surface ${enabled ? "enabled" : "disabled"}`);
}

function commitFlag(objectId, flagName, enabled) {
  pushUndoSnapshot(`Toggle ${objectId}.${flagName}`);
  const updated = setRoomObjectFlag(roomLayout, objectId, flagName, enabled);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} flag ${flagName} ${enabled ? "enabled" : "disabled"}`);
}

function commitSpecialFlag(objectId, flagName, enabled) {
  pushUndoSnapshot(`Toggle ${objectId}.${flagName}`);
  const updated = setRoomObjectSpecialFlag(roomLayout, objectId, flagName, enabled);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} special flag ${flagName} ${enabled ? "enabled" : "disabled"}`);
}

function commitStringField(objectId, key, rawValue) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (isObjectLocked(object)) {
    renderObjectDetails(object);
    setStatus(`${objectId} is locked`);
    return;
  }
  pushUndoSnapshot(`Update ${objectId}.${key}`);
  const updated = setRoomObjectStringField(roomLayout, objectId, key, rawValue);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    renderObjectDetails(roomLayout.objectsById?.[objectId] || null);
    return;
  }
  if (updated.type === "model" && key === "assetPath") {
    delete updated.runtimeAssetBounds;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`Updated ${objectId}.${key}`);
}

function commitRuntimeAsset(objectId, { url = "", name = "" } = {}) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (isObjectLocked(object)) {
    renderObjectDetails(object);
    setStatus(`${objectId} is locked`);
    return;
  }
  pushUndoSnapshot(`Update ${objectId} local GLB`);
  const updated = setRoomObjectRuntimeAsset(roomLayout, objectId, { url, name });
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    if (url && transientAssetUrls.has(url)) {
      transientAssetUrls.delete(url);
      URL.revokeObjectURL(url);
    }
    return;
  }
  delete updated.runtimeAssetBounds;
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(name ? `${objectId} local GLB set to ${name}` : `${objectId} local GLB cleared`);
}

function commitCalibrateObjectDimensions(objectId) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (!object || !canCalibrateObjectDimensions(object)) return;
  if (isObjectLocked(object)) {
    setStatus(`${objectId} is locked`);
    return;
  }
  const measuredBounds = getRuntimeMeasuredBounds(object) || measureRenderedObjectBounds(objectId);
  if (!measuredBounds) {
    setStatus(`Could not measure rendered bounds for ${objectId}`);
    return;
  }
  pushUndoSnapshot(`Calibrate ${objectId} dimensions`);
  object.runtimeAssetBounds = {
    width: measuredBounds.width,
    depth: measuredBounds.depth,
    height: measuredBounds.height,
  };
  const updated = calibrateRoomObjectDimensionsFromRuntimeBounds(roomLayout, objectId);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`Calibrated ${objectId} dimensions to the loaded model bounds`);
}

function commitObstacleEnabled(objectId, enabled) {
  pushUndoSnapshot(`Toggle ${objectId} obstacle`);
  const updated = setRoomObjectObstacleEnabled(roomLayout, objectId, enabled);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} obstacle ${enabled ? "enabled" : "disabled"}`);
}

function commitObstacleMode(objectId, mode) {
  pushUndoSnapshot(`Set ${objectId} obstacle mode`);
  const updated = setRoomObjectObstacleMode(roomLayout, objectId, mode);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} obstacle mode ${mode}`);
}

function commitObstacleIgnoreSurfaces(objectId, rawValue) {
  pushUndoSnapshot(`Set ${objectId} obstacle jump ignore`);
  const updated = setRoomObjectObstacleIgnoreSurfaceIds(roomLayout, objectId, rawValue);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} jump-ignore surfaces updated`);
}

function commitEditorLocked(objectId, locked) {
  pushUndoSnapshot(`${locked ? "Lock" : "Unlock"} ${objectId}`);
  const updated = setRoomObjectEditorLocked(roomLayout, objectId, locked);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} ${locked ? "locked" : "unlocked"}`);
}

function commitVisibility(objectId, visible) {
  pushUndoSnapshot(`${visible ? "Show" : "Hide"} ${objectId}`);
  const updated = setRoomObjectVisible(roomLayout, objectId, visible);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} ${visible ? "shown" : "hidden"}`);
}

function commitRotateObject(objectId, deltaTurns) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (!object) return;
  if (isObjectLocked(object)) {
    setStatus(`${objectId} is locked`);
    return;
  }
  if (!canRotateObject(object)) {
    setStatus(`${objectId} cannot be rotated yet`);
    return;
  }
  pushUndoSnapshot(`Rotate ${objectId}`);
  const updated = rotateRoomObjectQuarterTurns(roomLayout, objectId, deltaTurns);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`Rotated ${objectId}`);
}

function beginLiveRotation(objectId) {
  if (liveRotationState?.objectId === objectId) return;
  liveRotationState = {
    objectId,
    beforeSnapshot: captureLayoutSnapshot(),
    changed: false,
  };
}

function previewSetRotation(objectId, degrees) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (!object) return;
  if (isObjectLocked(object)) {
    setStatus(`${objectId} is locked`);
    return;
  }
  if (!canRotateObject(object)) {
    setStatus(`${objectId} cannot be rotated yet`);
    return;
  }
  beginLiveRotation(objectId);
  const nextDegrees = normalizeRotationDegrees(degrees);
  const currentDegrees = getRotationDegrees(object);
  const updated = setRoomObjectRotationDegrees(roomLayout, objectId, nextDegrees);
  if (!updated) {
    return;
  }
  if (Math.abs(nextDegrees - currentDegrees) > 1e-4) {
    liveRotationState.changed = true;
  }
  rebuildRoomScene({ refreshSidebar: false, refreshInspector: false });
  setStatus(`Previewing ${objectId} rotation at ${formatNumber(getRotationDegrees(updated))}°`);
}

function commitSetRotation(objectId, degrees) {
  previewSetRotation(objectId, degrees);
  const state = liveRotationState;
  if (!state || state.objectId !== objectId) return;
  if (state.changed && state.beforeSnapshot) {
    pushUndoSnapshot(`Rotate ${objectId}`, state.beforeSnapshot);
  }
  liveRotationState = null;
  renderObjectList();
  setSelectedObject(objectId);
  setStatus(`Set ${objectId} rotation to ${formatNumber(getRotationDegrees(roomLayout.objectsById?.[objectId] || null))}°`);
}

function commitSurfaceShape(objectId, shape) {
  pushUndoSnapshot(`Set ${objectId} surface shape`);
  const updated = setRoomObjectSurfaceShape(roomLayout, objectId, shape);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`${objectId} surface shape set to ${String(shape || "rect")}`);
}

function commitSurfaceNumericField(objectId, field, rawValue) {
  pushUndoSnapshot(`Update ${objectId}.surface.${field}`);
  const updated = setRoomObjectSurfaceNumericField(roomLayout, objectId, field, rawValue);
  if (!updated) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  rebuildRoomScene({ refreshSidebar: true });
  setSelectedObject(objectId);
  setStatus(`Updated ${objectId} surface ${field}`);
}

function duplicateSelectedObject() {
  const object = roomLayout.objectsById?.[selectedObjectId] || null;
  if (!object) return;
  if (!canDuplicateObject(object)) {
    setStatus("This object type cannot be duplicated yet");
    return;
  }
  const nextId = promptForUniqueObjectId(object);
  if (!nextId) return;
  const footprint = getObjectFootprint(object);
  pushUndoSnapshot(`Duplicate ${object.id}`);
  const duplicate = duplicateRoomObject(THREE, roomLayout, object.id, nextId, {
    offsetX: Math.max(0.35, footprint.width * 0.35),
    offsetZ: Math.max(0.35, footprint.depth * 0.35),
  });
  if (!duplicate) {
    undoHistory.pop();
    updateUndoButton();
    setStatus(`Could not duplicate ${object.id}`);
    return;
  }
  selectedObjectId = duplicate.id;
  rebuildRoomScene({ refreshSidebar: true });
  focusObject(duplicate);
  setStatus(`Duplicated ${object.id} as ${duplicate.id}`);
}

function addPrimitiveShape(shapeKind, label) {
  pushUndoSnapshot(`Add ${label}`);
  const added = addPrimitiveRoomObject(THREE, roomLayout, shapeKind, {
    x: controls.target.x,
    z: controls.target.z,
    idBase: label.replace(/\s+/g, ""),
  });
  if (!added) {
    undoHistory.pop();
    updateUndoButton();
    setStatus(`Could not add ${label}`);
    return;
  }
  selectedObjectId = added.id;
  rebuildRoomScene({ refreshSidebar: true });
  focusObject(added);
  setStatus(`Added ${added.id}`);
}

function addGlbModelObject() {
  pushUndoSnapshot("Add GLB model");
  const added = addModelRoomObject(THREE, roomLayout, {
    x: controls.target.x,
    z: controls.target.z,
  });
  if (!added) {
    undoHistory.pop();
    updateUndoButton();
    setStatus("Could not add GLB model object");
    return;
  }
  selectedObjectId = added.id;
  rebuildRoomScene({ refreshSidebar: true });
  focusObject(added);
  pendingGlbTargetObjectId = added.id;
  if (glbAssetInput) {
    glbAssetInput.click();
    setStatus(`Added ${added.id}. Pick a local GLB or set a GLB path in the selection panel.`);
  } else {
    setStatus(`Added ${added.id}. Set its GLB path in the selection panel.`);
  }
}

function chooseLocalGlbForObject(objectId) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (!object || object.type !== "model") return;
  pendingGlbTargetObjectId = objectId;
  if (glbAssetInput) glbAssetInput.click();
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function applyLocalGlbFileToObject(objectId, file) {
  const object = roomLayout.objectsById?.[objectId] || null;
  if (!object || object.type !== "model" || !file) return;
  setStatus(`Embedding ${file.name}...`);
  const nextUrl = await readFileAsDataUrl(file);
  commitRuntimeAsset(objectId, {
    url: nextUrl,
    name: file.name || "local-model.glb",
  });
}

function deleteSelectedObject() {
  const object = roomLayout.objectsById?.[selectedObjectId] || null;
  if (!object) return;
  if (isObjectLocked(object)) {
    setStatus(`${object.id} is locked`);
    return;
  }
  pushUndoSnapshot(`Delete ${object.id}`);
  if (!removeRoomObject(roomLayout, object.id)) {
    undoHistory.pop();
    updateUndoButton();
    return;
  }
  selectedObjectId = roomLayout.objects[0]?.id || null;
  rebuildRoomScene({ refreshSidebar: true });
  setStatus(`Deleted ${object.id}`);
}

function appendNumericField(grid, object, field, disabled = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const title = document.createElement("span");
  title.textContent = field.label;
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(field.step || 0.05);
  input.disabled = disabled;
  const value = field.getValue
    ? field.getValue(object)
    : field.key === "x"
    ? object.pos.x
    : field.key === "y"
    ? object.pos.y
    : field.key === "z"
      ? object.pos.z
      : object[field.key];
  input.value = formatNumber(Number.isFinite(Number(value)) ? Number(value) : 0);
  input.addEventListener("change", () => {
    if (typeof field.onChange === "function") field.onChange(input.value);
    else commitNumericField(object.id, field.key, input.value);
  });
  wrapper.append(title, input);
  grid.appendChild(wrapper);
}

function appendColorField(grid, object, field, disabled = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const title = document.createElement("span");
  title.textContent = field.label;
  const input = document.createElement("input");
  input.type = "color";
  input.disabled = disabled;
  input.value = /^#[0-9a-fA-F]{6}$/.test(String(object?.[field.key] || ""))
    ? String(object[field.key]).toLowerCase()
    : "#ffffff";
  input.addEventListener("change", () => {
    commitStringField(object.id, field.key, input.value);
  });
  wrapper.append(title, input);
  grid.appendChild(wrapper);
}

function appendRangeField(grid, object, field, disabled = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "field fieldRange";
  const title = document.createElement("span");
  title.textContent = field.label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(field.min ?? 0);
  input.max = String(field.max ?? 100);
  input.step = String(field.step ?? 1);
  input.disabled = disabled;
  input.value = String(field.value ?? 0);
  const readout = document.createElement("strong");
  readout.textContent = field.formatValue ? field.formatValue(input.value) : String(input.value);
  if (typeof field.onBegin === "function") {
    const begin = () => field.onBegin(input.value);
    input.addEventListener("pointerdown", begin);
    input.addEventListener("focus", begin);
  }
  input.addEventListener("input", () => {
    readout.textContent = field.formatValue ? field.formatValue(input.value) : String(input.value);
    if (typeof field.onInput === "function") field.onInput(input.value);
  });
  input.addEventListener("change", () => {
    if (typeof field.onCommit === "function") field.onCommit(input.value);
    else if (typeof field.onChange === "function") field.onChange(input.value);
  });
  wrapper.append(title, input, readout);
  grid.appendChild(wrapper);
}

function appendCheckbox(container, labelText, checked, onChange, disabled = false) {
  const label = document.createElement("label");
  label.className = "checkItem";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  container.appendChild(label);
}

function appendTextField(grid, object, field, disabled = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const title = document.createElement("span");
  title.textContent = field.label;
  const input = document.createElement("input");
  input.type = "text";
  input.disabled = disabled;
  input.value = String(field.value != null ? field.value : (object?.[field.key] || ""));
  input.placeholder = field.placeholder || "";
  input.addEventListener("change", () => {
    if (typeof field.onChange === "function") field.onChange(input.value);
    else commitStringField(object.id, field.key, input.value);
  });
  wrapper.append(title, input);
  grid.appendChild(wrapper);
  return input;
}

function appendSelectField(grid, object, field, disabled = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const title = document.createElement("span");
  title.textContent = field.label;
  const select = document.createElement("select");
  select.disabled = disabled;
  for (const option of field.options || []) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    select.appendChild(opt);
  }
  select.value = String(field.value || "");
  select.addEventListener("change", () => {
    field.onChange(select.value);
  });
  wrapper.append(title, select);
  grid.appendChild(wrapper);
  return select;
}

function appendActionRow(container, buttons = []) {
  const row = document.createElement("div");
  row.className = "actionRow";
  for (const buttonSpec of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = buttonSpec.secondary ? "secondary" : "";
    button.textContent = buttonSpec.label;
    button.disabled = !!buttonSpec.disabled;
    button.addEventListener("click", () => buttonSpec.onClick());
    row.appendChild(button);
  }
  container.appendChild(row);
  return row;
}

function renderObjectDetails(object) {
  if (!objectDetailsEl) return;
  if (!object) {
    objectDetailsEl.innerHTML = "";
    objectDetailsEl.appendChild(createReadOnlyRow("Selection", "None"));
    return;
  }

  const wrapper = document.createElement("div");
  const locked = isObjectLocked(object);
  const runtimeBounds = getRuntimeMeasuredBounds(object);
  wrapper.appendChild(createReadOnlyRow("Id", object.id));
  wrapper.appendChild(createReadOnlyRow("Name", object.name || "(uses id)"));
  wrapper.appendChild(createReadOnlyRow("Type", object.type));
  if (object.sourceType && object.sourceType !== object.type) {
    wrapper.appendChild(createReadOnlyRow("Imported Type", object.sourceType));
  }
  if (object.type === "primitive") {
    wrapper.appendChild(createReadOnlyRow("Shape", object.shapeKind || "box"));
  }
  wrapper.appendChild(createReadOnlyRow("Locked", locked ? "Yes" : "No"));
  wrapper.appendChild(createReadOnlyRow("Visible", object.visible !== false ? "Yes" : "No"));
  wrapper.appendChild(createReadOnlyRow("Rotation", `${getRotationDegrees(object)}°`));
  wrapper.appendChild(createReadOnlyRow("Walkable", object.surface?.enabled ? "Yes" : "No"));
  wrapper.appendChild(createReadOnlyRow("Flags", buildFlagsLabel(object)));
  wrapper.appendChild(createReadOnlyRow("Special", buildSpecialFlagsLabel(object)));
  if (objectSupportsTint(object)) {
    wrapper.appendChild(createReadOnlyRow("Tint", object.tint || "(default)"));
  }
  if (objectHasSpecialModel(object)) {
    wrapper.appendChild(createReadOnlyRow("Model Preview", getSpecialModelLabel(object)));
    if (object.type === "model") {
      wrapper.appendChild(createReadOnlyRow("Local GLB", object.runtimeAssetName || "none"));
      wrapper.appendChild(
        createReadOnlyRow(
          "Loaded Bounds",
          runtimeBounds
            ? `${formatNumber(runtimeBounds.width)} × ${formatNumber(runtimeBounds.depth)} × ${formatNumber(runtimeBounds.height)}`
            : "not loaded"
        )
      );
    }
  }

  const identityBlock = createDetailBlock("Identity");
  const identityGrid = document.createElement("div");
  identityGrid.className = "fieldGrid";
  appendTextField(identityGrid, object, {
    key: "name",
    label: "Name",
    placeholder: "Optional display name",
  }, locked);
  identityBlock.appendChild(identityGrid);
  wrapper.appendChild(identityBlock);

  const editorBlock = createDetailBlock("Editor");
  const editorChecks = document.createElement("div");
  editorChecks.className = "checkList";
  appendCheckbox(editorChecks, "Locked", locked, (checked) => {
    commitEditorLocked(object.id, checked);
  });
  appendCheckbox(editorChecks, "Visible", object.visible !== false, (checked) => {
    commitVisibility(object.id, checked);
  }, locked);
  editorBlock.appendChild(editorChecks);
  wrapper.appendChild(editorBlock);

  const transformBlock = createDetailBlock("Transform");
  const transformGrid = document.createElement("div");
  transformGrid.className = "fieldGrid";
  appendNumericField(transformGrid, object, { key: "x", label: "X", step: 0.05 }, locked);
  appendNumericField(transformGrid, object, { key: "y", label: "Y", step: 0.05 }, locked);
  appendNumericField(transformGrid, object, { key: "z", label: "Z", step: 0.05 }, locked);
  if (canRotateObject(object)) {
    appendRangeField(transformGrid, object, {
      label: "Rotation",
      min: 0,
      max: 270,
      step: 90,
      value: getRotationDegrees(object),
      formatValue: (value) => `${formatNumber(value)}°`,
      onBegin: () => beginLiveRotation(object.id),
      onInput: (value) => previewSetRotation(object.id, value),
      onCommit: (value) => commitSetRotation(object.id, value),
    }, locked);
  }
  transformBlock.appendChild(transformGrid);
  wrapper.appendChild(transformBlock);

  const editableFields = getEditableFields(object);
  if (editableFields.length) {
    const shapeBlock = createDetailBlock("Shape");
    const shapeGrid = document.createElement("div");
    shapeGrid.className = "fieldGrid";
    for (const field of editableFields) appendNumericField(shapeGrid, object, field, locked);
    const shouldShowCalibrationActions = canCalibrateObjectDimensions(object);
    if (object.type === "model") {
      appendTextField(shapeGrid, object, {
        key: "assetPath",
        label: "GLB Path",
        placeholder: "mvp/chair.glb or /models/chair.glb",
      }, locked);
    }
    shapeBlock.appendChild(shapeGrid);
    if (shouldShowCalibrationActions || object.type === "model") {
      const actionButtons = [];
      if (shouldShowCalibrationActions) {
        actionButtons.push({
          label: "Calibrate Dimensions",
          secondary: true,
          disabled: locked,
          onClick: () => commitCalibrateObjectDimensions(object.id),
        });
      }
      if (object.type === "model") {
        actionButtons.push(
          {
            label: "Load Local GLB...",
            secondary: true,
            disabled: locked,
            onClick: () => chooseLocalGlbForObject(object.id),
          },
          {
            label: "Clear Local GLB",
            secondary: true,
            disabled: locked || !object.runtimeAssetUrl,
            onClick: () => commitRuntimeAsset(object.id, { url: "", name: "" }),
          }
        );
      }
      if (actionButtons.length) {
        appendActionRow(shapeBlock, actionButtons);
      }
    }
    wrapper.appendChild(shapeBlock);
  }

  if (roomObjectSupportsSurface(object)) {
    const surfaceKind = object.surface
      ? getSurfaceKind(object.surface)
      : (object.type === "primitive" && object.shapeKind === "cylinder" ? "circle" : "rect");
    const surfaceBlock = createDetailBlock("Surface");
    const checklist = document.createElement("div");
    checklist.className = "checkList";
    appendCheckbox(checklist, "Enabled", object.surface?.enabled, (checked) => {
      commitSurfaceEnabled(object.id, checked);
    }, locked);
    for (const flagName of getSurfaceFlagNames(object)) {
      appendCheckbox(checklist, flagName, object.surface?.flags?.[flagName], (checked) => {
        commitFlag(object.id, flagName, checked);
      }, locked);
    }
    surfaceBlock.appendChild(checklist);
    const surfaceGrid = document.createElement("div");
    surfaceGrid.className = "fieldGrid";
    appendSelectField(surfaceGrid, object, {
      label: "Shape",
      value: surfaceKind,
      options: [
        { value: "rect", label: "Rect" },
        { value: "circle", label: "Circle" },
      ],
      onChange: (value) => commitSurfaceShape(object.id, value),
    }, locked);
    appendNumericField(surfaceGrid, object, {
      key: "offsetX",
      label: "Offset X",
      step: 0.05,
      getValue: (target) => target.surface?.offsetX ?? 0,
      onChange: (value) => commitSurfaceNumericField(object.id, "offsetX", value),
    }, locked);
    appendNumericField(surfaceGrid, object, {
      key: "offsetZ",
      label: "Offset Z",
      step: 0.05,
      getValue: (target) => target.surface?.offsetZ ?? 0,
      onChange: (value) => commitSurfaceNumericField(object.id, "offsetZ", value),
    }, locked);
    if (surfaceKind === "circle") {
      appendNumericField(surfaceGrid, object, {
        key: "radius",
        label: "Surface R",
        step: 0.05,
        getValue: (target) =>
          target.surface?.radius ??
          getObjectBaseSurfaceDimensions(target).radius ??
          Math.min(getObjectBaseSurfaceDimensions(target).width, getObjectBaseSurfaceDimensions(target).depth) * 0.5,
        onChange: (value) => commitSurfaceNumericField(object.id, "radius", value),
      }, locked);
    } else {
      appendNumericField(surfaceGrid, object, {
        key: "width",
        label: "Surface W",
        step: 0.05,
        getValue: (target) => target.surface?.width ?? getObjectBaseSurfaceDimensions(target).width,
        onChange: (value) => commitSurfaceNumericField(object.id, "width", value),
      }, locked);
      appendNumericField(surfaceGrid, object, {
        key: "depth",
        label: "Surface D",
        step: 0.05,
        getValue: (target) => target.surface?.depth ?? getObjectBaseSurfaceDimensions(target).depth,
        onChange: (value) => commitSurfaceNumericField(object.id, "depth", value),
      }, locked);
    }
    surfaceBlock.appendChild(surfaceGrid);
    wrapper.appendChild(surfaceBlock);
  }

  if (objectSupportsObstacleSettings(object)) {
    const obstacleBlock = createDetailBlock("Object Obstacle");
    const checklist = document.createElement("div");
    checklist.className = "checkList";
    appendCheckbox(checklist, "Enabled", object.obstacle?.enabled, (checked) => {
      commitObstacleEnabled(object.id, checked);
    }, locked);
    obstacleBlock.appendChild(checklist);

    const obstacleGrid = document.createElement("div");
    obstacleGrid.className = "fieldGrid";
    appendSelectField(obstacleGrid, object, {
      label: "Mode",
      value: object.obstacle?.mode || "soft",
      options: [
        { value: "soft", label: "Soft (yellow)" },
        { value: "hard", label: "Hard (red)" },
      ],
      onChange: (value) => commitObstacleMode(object.id, value),
    }, locked);
    appendTextField(obstacleGrid, object, {
      key: "jumpIgnoreSurfaceIds",
      label: "Ignore Jump Surfaces",
      value: Array.isArray(object.obstacle?.jumpIgnoreSurfaceIds)
        ? object.obstacle.jumpIgnoreSurfaceIds.join(", ")
        : "",
      placeholder: getSurfaceChoiceHint() || "desk, shelf, bed",
      onChange: (value) => commitObstacleIgnoreSurfaces(object.id, value),
    }, locked);
    obstacleBlock.appendChild(obstacleGrid);
    wrapper.appendChild(obstacleBlock);
  }

  if (objectSupportsTint(object)) {
    const appearanceBlock = createDetailBlock("Appearance");
    const appearanceGrid = document.createElement("div");
    appearanceGrid.className = "fieldGrid";
    appendColorField(appearanceGrid, object, { key: "tint", label: "Tint" }, locked);
    appearanceBlock.appendChild(appearanceGrid);
    wrapper.appendChild(appearanceBlock);
  }

  const specialFlagNames = getSpecialFlagNames(object);
  if (specialFlagNames.length) {
    const specialBlock = createDetailBlock("Special Flags");
    const checklist = document.createElement("div");
    checklist.className = "checkList";
    for (const flagName of specialFlagNames) {
      appendCheckbox(checklist, flagName, object.specialFlags?.[flagName], (checked) => {
        commitSpecialFlag(object.id, flagName, checked);
      }, locked);
    }
    specialBlock.appendChild(checklist);
    wrapper.appendChild(specialBlock);
  }

  objectDetailsEl.replaceChildren(wrapper);
}

function focusObject(object) {
  if (!object) return;
  const target = getObjectCenter(object);
  const offset = camera.position.clone().sub(controls.target);
  controls.target.copy(target);
  camera.position.copy(target.clone().add(offset));
  camera.lookAt(target);
}

function updateObjectRowSelection() {
  const rows = objectListEl?.querySelectorAll(".objectRow") || [];
  rows.forEach((row) => {
    row.classList.toggle("isSelected", row.dataset.objectId === selectedObjectId);
  });
}

function updateActionButtons() {
  const object = selectedObjectId ? roomLayout.objectsById?.[selectedObjectId] : null;
  const locked = isObjectLocked(object);
  if (rotateLeftBtn) rotateLeftBtn.disabled = !object || locked || !canRotateObject(object);
  if (rotateRightBtn) rotateRightBtn.disabled = !object || locked || !canRotateObject(object);
  if (duplicateObjectBtn) duplicateObjectBtn.disabled = !canDuplicateObject(object);
  if (deleteObjectBtn) deleteObjectBtn.disabled = !object || locked;
}

function setSelectedObject(objectId, { focus = false } = {}) {
  selectedObjectId = objectId && roomLayout.objectsById?.[objectId] ? objectId : null;
  const selected = selectedObjectId ? roomLayout.objectsById[selectedObjectId] : null;
  renderObjectDetails(selected);
  updateSelectionHighlight(selected);
  updateObjectRowSelection();
  updateActionButtons();
  if (focus && selected) focusObject(selected);
}

function buildObjectRow(object) {
  const typeLabel = object.type === "primitive"
    ? `primitive:${object.shapeKind || "box"}`
    : object.type === "model"
      ? `model${object.runtimeAssetName ? `:${object.runtimeAssetName}` : object.assetPath ? `:${object.assetPath}` : ""}`
      : object.type;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "objectRow";
  button.dataset.objectId = object.id;
  const title = document.createElement("strong");
  title.textContent = getObjectLabel(object);
  const subtitle = document.createElement("span");
  subtitle.textContent = `${typeLabel} · ${object.surface?.enabled ? "walkable surface" : "object only"}${object.editorLocked ? " · locked" : ""}${object.visible === false ? " · hidden" : ""} · ${formatNumber(object.pos.x)}, ${formatNumber(object.pos.z)}${object.name ? ` · id:${object.id}` : ""}`;
  button.append(title, subtitle);
  button.addEventListener("click", () => {
    setSelectedObject(object.id, { focus: true });
  });
  return button;
}

function renderObjectList() {
  if (!objectListEl) return;
  objectListEl.innerHTML = "";
  for (const object of roomLayout.objects) {
    objectListEl.appendChild(buildObjectRow(object));
  }
  updateObjectRowSelection();
}

function updateSummary() {
  if (objectCountEl) objectCountEl.textContent = String(roomLayout.objects.length);
  const floorSurfaceCount = roomLayout.floor?.surface?.enabled ? 1 : 0;
  if (surfaceCountEl) surfaceCountEl.textContent = String(surfaceSpecs.length + floorSurfaceCount);
}

function disposeRoomRoot(root) {
  if (!root) return;
  root.traverse((node) => {
    if (node.geometry && typeof node.geometry.dispose === "function") node.geometry.dispose();
    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        if (material && typeof material.dispose === "function") material.dispose();
      }
    } else if (node.material && typeof node.material.dispose === "function") {
      node.material.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}

function rebuildRoomScene({ refreshSidebar = false, refreshInspector = true } = {}) {
  surfaceSpecs = buildRoomSurfaceSpecs(roomLayout);
  invalidateEditorPathfindingRuntime();
  if (roomRoot) disposeRoomRoot(roomRoot);
  roomRoot = new THREE.Group();
  roomRoot.name = "roomRoot";
  scene.add(roomRoot);
  buildRoomSceneFromLayout({
    scene: roomRoot,
    layout: roomLayout,
    binVisuals: {
      hamper: { shells: [], ring: null },
      trash: { shells: [], ring: null },
    },
    gltfLoader: useFallbackModels ? null : gltfLoader,
    trashCanModelCandidates: useFallbackModels ? [] : TRASH_CAN_MODEL_CANDIDATES,
    onModelMetrics: ({ objectId, fittedBounds }) => {
      if (!updateRuntimeModelBounds(objectId, fittedBounds)) return;
      if (selectedObjectId && String(selectedObjectId) === String(objectId)) {
        updateSelectionHighlight(roomLayout.objectsById?.[selectedObjectId] || null);
        renderObjectDetails(roomLayout.objectsById?.[selectedObjectId] || null);
      }
      rebuildAdvancedDebug();
    },
  });
  rebuildAdvancedDebug();
  updateSummary();
  if (refreshSidebar) renderObjectList();
  const fallbackId = roomLayout.objects[0]?.id || null;
  if (!selectedObjectId || !roomLayout.objectsById?.[selectedObjectId]) {
    selectedObjectId = fallbackId;
  }
  if (refreshInspector) {
    setSelectedObject(selectedObjectId);
  } else {
    const selected = selectedObjectId ? roomLayout.objectsById?.[selectedObjectId] || null : null;
    updateSelectionHighlight(selected);
    updateObjectRowSelection();
    updateActionButtons();
  }
}

function updatePointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function findRoomObjectId(node) {
  let current = node;
  while (current) {
    if (current.userData?.roomObjectId) return current.userData.roomObjectId;
    current = current.parent;
  }
  return null;
}

function pickRoomObject(event) {
  if (!roomRoot) return null;
  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(roomRoot, true);
  for (const hit of hits) {
    const objectId = findRoomObjectId(hit.object);
    if (objectId) return objectId;
  }
  return null;
}

function clampDraggedPosition(object, x, z) {
  if (object?.type === "floor") return { x, z };
  const footprint = getObjectFootprint(object);
  const halfW = footprint.width * 0.5;
  const halfD = footprint.depth * 0.5;
  const bounds = roomLayout.roomBounds;
  return {
    x: THREE.MathUtils.clamp(x, bounds.minX + halfW, bounds.maxX - halfW),
    z: THREE.MathUtils.clamp(z, bounds.minZ + halfD, bounds.maxZ - halfD),
  };
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const objectId = pickRoomObject(event);
  if (!objectId) {
    setSelectedObject(null);
    return;
  }
  const object = roomLayout.objectsById?.[objectId];
  if (!object?.pos) return;
  setSelectedObject(objectId);
  if (isObjectLocked(object)) {
    setStatus(`${objectId} is locked`);
    return;
  }
  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  dragState = {
    pointerId: event.pointerId,
    objectId,
    offsetX: dragPoint.x - object.pos.x,
    offsetZ: dragPoint.z - object.pos.z,
    beforeSnapshot: captureLayoutSnapshot(),
    moved: false,
  };
  controls.enabled = false;
  renderer.domElement.style.cursor = "grabbing";
  if (renderer.domElement.setPointerCapture) renderer.domElement.setPointerCapture(event.pointerId);
  setStatus(`Dragging ${objectId}`);
}

function onPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const object = roomLayout.objectsById?.[dragState.objectId];
  if (!object?.pos) return;
  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  const next = clampDraggedPosition(
    object,
    dragPoint.x - dragState.offsetX,
    dragPoint.z - dragState.offsetZ
  );
  if (Math.abs(next.x - object.pos.x) > 1e-4 || Math.abs(next.z - object.pos.z) > 1e-4) {
    dragState.moved = true;
  }
  moveRoomObject(roomLayout, dragState.objectId, next.x, next.z);
  rebuildRoomScene({ refreshSidebar: false, refreshInspector: false });
  setStatus(`Dragging ${dragState.objectId} to ${formatNumber(next.x)}, ${formatNumber(next.z)}`);
  event.preventDefault();
}

function onPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const finishedId = dragState.objectId;
  if (dragState.moved && dragState.beforeSnapshot) {
    pushUndoSnapshot(`Move ${finishedId}`, dragState.beforeSnapshot);
  }
  dragState = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = "";
  if (renderer.domElement.releasePointerCapture) renderer.domElement.releasePointerCapture(event.pointerId);
  renderObjectList();
  setSelectedObject(finishedId);
  setStatus(`Placed ${finishedId}`);
}

function downloadLayout() {
  const payload = serializeRoomLayoutData(roomLayout);
  if (!payload) return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "room-layout.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus("Downloaded room-layout.json");
}

async function saveLayoutOverGameJson() {
  const payload = serializeRoomLayoutData(roomLayout);
  if (!payload) return;
  const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
  const confirmed = window.confirm(
    "Replace public/mvp/room-layout.json with the current editor layout?\n\nThis will overwrite the game layout file used by play mode."
  );
  if (!confirmed) {
    setStatus("Replace canceled");
    return;
  }
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}__editor/save-room-layout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: jsonText }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.error || `HTTP ${response.status}`);
    }
    savedGameLayoutSnapshot = payload;
    setStatus("Replaced public/mvp/room-layout.json");
  } catch (error) {
    console.warn("Direct room-layout save unavailable; falling back to download.", error);
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: "room-layout.json",
          types: [
            {
              description: "Room layout JSON",
              accept: {
                "application/json": [".json"],
              },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonText);
        await writable.close();
        setStatus("Saved layout JSON copy. Replace public/mvp/room-layout.json with it.");
        return;
      } catch (saveError) {
        if (saveError?.name === "AbortError") {
          setStatus("Save canceled");
          return;
        }
        console.error("Failed fallback save for room layout JSON", saveError);
      }
    }
    downloadLayout();
    if (error?.name === "AbortError") {
      setStatus("Save canceled");
      return;
    }
    setStatus("Direct save unavailable here. Downloaded room-layout.json instead.");
  }
}

async function saveLayoutAsDefaultRoom() {
  const payload = serializeRoomLayoutData(roomLayout);
  if (!payload) return;
  const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
  const confirmed = window.confirm(
    "Replace public/mvp/default-room-layout.json with the current editor layout?\n\nThis changes the editor's default layout for future resets and fallback loading."
  );
  if (!confirmed) {
    setStatus("Set default canceled");
    return;
  }
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}__editor/save-default-room-layout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: jsonText }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.error || `HTTP ${response.status}`);
    }
    defaultLayoutSnapshot = payload;
    setStatus("Replaced public/mvp/default-room-layout.json");
  } catch (error) {
    console.warn("Direct default-room-layout save unavailable; falling back to download.", error);
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "default-room-layout.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatus("Direct save unavailable here. Downloaded default-room-layout.json instead.");
  }
}

async function importLayoutFile(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  pushUndoSnapshot(`Import ${file.name}`);
  roomLayout = createRoomLayoutFromData(THREE, parsed);
  selectedObjectId = roomLayout.objects[0]?.id || null;
  rebuildRoomScene({ refreshSidebar: true });
  setStatus(`Imported ${file.name}`);
}

function resetLayout() {
  pushUndoSnapshot("Reset layout");
  roomLayout = createRoomLayoutFromData(THREE, defaultLayoutSnapshot || builtInDefaultSnapshot);
  selectedObjectId = roomLayout.objects[0]?.id || null;
  rebuildRoomScene({ refreshSidebar: true });
  setStatus("Reset layout to defaults");
}

function revertAllUnsavedChanges() {
  roomLayout = createRoomLayoutFromData(THREE, savedGameLayoutSnapshot || defaultLayoutSnapshot || builtInDefaultSnapshot);
  selectedObjectId = roomLayout.objects[0]?.id || null;
  clearUndoHistory();
  rebuildRoomScene({ refreshSidebar: true });
  setStatus("Reverted all unsaved changes");
}

function toggleFallbackModels() {
  useFallbackModels = !useFallbackModels;
  updateFallbackModelsButton();
  rebuildRoomScene({ refreshSidebar: false });
  setStatus(useFallbackModels ? "Fallback meshes enabled" : "Asset models enabled where available");
}

function shouldIgnoreShortcut(event) {
  const target = event.target;
  if (!target) return false;
  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function onKeyDown(event) {
  if (shouldIgnoreShortcut(event)) return;
  editorDebugCameraRuntime.onKeyDown(event);
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redoLastAction();
    else undoLastAction();
    return;
  }
}

function onKeyUp(event) {
  editorDebugCameraRuntime.onKeyUp(event);
}

if (focusSelectionBtn) {
  focusSelectionBtn.addEventListener("click", () => {
    focusObject(roomLayout.objectsById?.[selectedObjectId] || null);
  });
}

if (undoBtn) {
  undoBtn.addEventListener("click", () => undoLastAction());
}
if (redoBtn) {
  redoBtn.addEventListener("click", () => redoLastAction());
}
if (rotateLeftBtn) {
  rotateLeftBtn.addEventListener("click", () => commitRotateObject(selectedObjectId, -1));
}
if (rotateRightBtn) {
  rotateRightBtn.addEventListener("click", () => commitRotateObject(selectedObjectId, 1));
}
if (addCubeBtn) {
  addCubeBtn.addEventListener("click", () => addPrimitiveShape("cube", "Cube"));
}
if (addRectPrismBtn) {
  addRectPrismBtn.addEventListener("click", () => addPrimitiveShape("rectPrism", "RectPrism"));
}
if (addSphereBtn) {
  addSphereBtn.addEventListener("click", () => addPrimitiveShape("sphere", "Sphere"));
}
if (addCylinderBtn) {
  addCylinderBtn.addEventListener("click", () => addPrimitiveShape("cylinder", "Cylinder"));
}
if (addTriPrismBtn) {
  addTriPrismBtn.addEventListener("click", () => addPrimitiveShape("triPrism", "TriPrism"));
}
if (addGlbModelBtn) {
  addGlbModelBtn.addEventListener("click", () => addGlbModelObject());
}
if (duplicateObjectBtn) {
  duplicateObjectBtn.addEventListener("click", () => duplicateSelectedObject());
}
if (deleteObjectBtn) {
  deleteObjectBtn.addEventListener("click", () => deleteSelectedObject());
}
if (fallbackModelsBtn) {
  fallbackModelsBtn.addEventListener("click", () => toggleFallbackModels());
}
for (const input of [
  advShowSurfaceBoundsEl,
  advShowSurfaceAnchorsEl,
  advShowSurfaceProbesEl,
  advShowSurfaceLinksEl,
  advShowSurfaceVectorBlockersEl,
  advShowNavMeshLinesEl,
  advShowNavMeshFillEl,
  advShowObjectCollisionShapesEl,
]) {
  if (!input) continue;
  input.addEventListener("change", () => {
    rebuildAdvancedDebug();
  });
}

if (downloadLayoutBtn) {
  downloadLayoutBtn.addEventListener("click", () => downloadLayout());
}
if (saveGameLayoutBtn) {
  saveGameLayoutBtn.addEventListener("click", async () => {
    await saveLayoutOverGameJson();
  });
}
if (revertSavedLayoutBtn) {
  revertSavedLayoutBtn.addEventListener("click", () => {
    revertAllUnsavedChanges();
  });
}
if (setDefaultLayoutBtn) {
  setDefaultLayoutBtn.addEventListener("click", async () => {
    await saveLayoutAsDefaultRoom();
  });
}

if (importLayoutBtn && importLayoutInput) {
  importLayoutBtn.addEventListener("click", () => importLayoutInput.click());
  importLayoutInput.addEventListener("change", async () => {
    const file = importLayoutInput.files?.[0] || null;
    if (!file) return;
    try {
      await importLayoutFile(file);
    } catch (error) {
      console.error("Failed to import layout", error);
      setStatus(`Import failed: ${error?.message || "invalid JSON layout"}`);
    } finally {
      importLayoutInput.value = "";
    }
  });
}

if (glbAssetInput) {
  glbAssetInput.addEventListener("change", async () => {
    const file = glbAssetInput.files?.[0] || null;
    const targetId = pendingGlbTargetObjectId;
    pendingGlbTargetObjectId = null;
    try {
      if (file && targetId) await applyLocalGlbFileToObject(targetId, file);
    } catch (error) {
      console.error("Failed to load local GLB", error);
      setStatus(`Local GLB failed: ${error?.message || "could not read file"}`);
    } finally {
      glbAssetInput.value = "";
    }
  });
}

if (resetLayoutBtn) {
  resetLayoutBtn.addEventListener("click", () => resetLayout());
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", () => editorDebugCameraRuntime.resetDebugCameraInput());
window.addEventListener("beforeunload", () => {
  for (const url of transientAssetUrls) URL.revokeObjectURL(url);
  transientAssetUrls.clear();
});
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

await initializeEditorLayout();
rebuildRoomScene({ refreshSidebar: true });
updateUndoButton();
updateFallbackModelsButton();
setStatus("Editor ready");

const editorClock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = editorClock.getDelta();
  editorDebugCameraRuntime.updateDebugCameraControls(dt);
  controls.update();
  renderer.render(scene, camera);
}

animate();
