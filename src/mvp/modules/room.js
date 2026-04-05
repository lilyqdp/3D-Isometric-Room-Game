import * as THREE from "three";
import { buildRoomObjectSurfaceSpec } from "./room-layout.js";
import {
  getObjectRotationRadians,
  getRotatedRectAabb,
  getSurfaceHalfExtents,
  getSurfaceKind,
  getSurfaceRadius,
} from "./surface-shapes.js";

const loadedModelSceneCache = new Map();
const pendingModelSceneCache = new Map();

function tagRoomObject(node, object) {
  if (!node || !object?.id) return node;
  const apply = (target) => {
    if (!target?.userData) target.userData = {};
    target.userData.roomObjectId = object.id;
    target.userData.roomObjectType = object.type || "";
  };
  apply(node);
  if (typeof node.traverse === "function") node.traverse((target) => apply(target));
  return node;
}

function getObjectRotation(object) {
  return getObjectRotationRadians(object);
}

function isRoomObjectVisible(object) {
  return object?.visible !== false;
}

function getEffectiveRectSize(width, depth, object) {
  return getRotatedRectAabb(width, depth, getObjectRotation(object));
}

function getPrimitiveFootprint(object) {
  if (object?.shapeKind === "sphere" || object?.shapeKind === "cylinder") {
    const diameter = Math.max(0.1, (Number(object?.radius) || 0.5) * 2);
    return { width: diameter, depth: diameter };
  }
  return getEffectiveRectSize(
    Math.max(0.1, Number(object?.width) || 0.9),
    Math.max(0.1, Number(object?.depth) || 0.9),
    object
  );
}

function getRenderableObjectFootprint(object) {
  switch (object?.type) {
    case "desk":
      return getEffectiveRectSize(object.sizeX, object.sizeZ, object);
    case "chair":
      return getEffectiveRectSize(object.sizeX, object.sizeZ, object);
    case "shelf":
      return getEffectiveRectSize(object.width, object.depth, object);
    case "platform":
    case "windowSill":
      return getEffectiveRectSize(object.width, object.depth, object);
    case "primitive":
      return getPrimitiveFootprint(object);
    case "model":
      return getEffectiveRectSize(object.width, object.depth, object);
    default:
      return { width: 1, depth: 1 };
  }
}

function attachSurfaceData(mesh, object, surfaceSpec = null) {
  if (!mesh || !object?.surface?.enabled) return;
  const spec = surfaceSpec || buildRoomObjectSurfaceSpec(object);
  if (!spec) return;
  mesh.userData.catSurface = {
    id: spec.id || object.id || object.type || "surface",
    y: spec.y,
    minX: spec.minX,
    maxX: spec.maxX,
    minZ: spec.minZ,
    maxZ: spec.maxZ,
    shape: spec.shape || "rect",
    centerX: spec.centerX,
    centerZ: spec.centerZ,
    halfWidth: spec.halfWidth,
    halfDepth: spec.halfDepth,
    radius: spec.radius,
    yaw: spec.yaw,
  };
}

function addInvisibleSurfaceProxy(group, object, y) {
  if (!group || !object?.surface?.enabled) return null;
  const spec = buildRoomObjectSurfaceSpec(object);
  if (!spec) return null;
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  let proxy = null;
  if (getSurfaceKind(spec) === "circle") {
    proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(0.05, getSurfaceRadius(spec)), Math.max(0.05, getSurfaceRadius(spec)), 0.02, 32),
      material
    );
  } else {
    const { hx, hz } = getSurfaceHalfExtents(spec);
    proxy = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.05, hx * 2), 0.02, Math.max(0.05, hz * 2)),
      material
    );
  }
  proxy.position.set(
    Number.isFinite(Number(object?.surface?.offsetX)) ? Number(object.surface.offsetX) : 0,
    y,
    Number.isFinite(Number(object?.surface?.offsetZ)) ? Number(object.surface.offsetZ) : 0
  );
  attachSurfaceData(proxy, object, spec);
  tagRoomObject(proxy, object);
  group.add(proxy);
  return proxy;
}

function cloneCachedModelScene(scene) {
  return scene?.clone ? scene.clone(true) : null;
}

function tryGetLoadedModelScene(modelCandidates = []) {
  for (const url of modelCandidates) {
    if (loadedModelSceneCache.has(url)) return cloneCachedModelScene(loadedModelSceneCache.get(url));
  }
  return null;
}

function loadModelSceneCached(gltfLoader, modelCandidates = []) {
  const cacheKey = modelCandidates.join("|");
  if (pendingModelSceneCache.has(cacheKey)) {
    return pendingModelSceneCache.get(cacheKey).then((scene) => cloneCachedModelScene(scene));
  }

  const promise = new Promise((resolve, reject) => {
    const tryLoad = (idx) => {
      if (idx >= modelCandidates.length) {
        reject(new Error("Failed to load model from all candidate URLs"));
        return;
      }
      const url = modelCandidates[idx];
      if (loadedModelSceneCache.has(url)) {
        resolve(loadedModelSceneCache.get(url));
        return;
      }
      gltfLoader.load(
        url,
        (gltf) => {
          const sourceScene = gltf?.scene || null;
          if (!sourceScene) {
            tryLoad(idx + 1);
            return;
          }
          sourceScene.traverse((node) => {
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
          loadedModelSceneCache.set(url, sourceScene);
          resolve(sourceScene);
        },
        undefined,
        () => {
          tryLoad(idx + 1);
        }
      );
    };

    tryLoad(0);
  }).finally(() => {
    pendingModelSceneCache.delete(cacheKey);
  });

  pendingModelSceneCache.set(cacheKey, promise);
  return promise.then((scene) => cloneCachedModelScene(scene));
}

function fitModelToBounds(model, targetWidth, targetHeight, targetDepth, scaleMultiplier = 1) {
  if (!model) return false;
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return false;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  const rawSize = size.clone();
  box.getCenter(center);
  const sx = Math.max(0.001, targetWidth) / Math.max(size.x, 1e-3);
  const sy = Math.max(0.001, targetHeight) / Math.max(size.y, 1e-3);
  const sz = Math.max(0.001, targetDepth) / Math.max(size.z, 1e-3);
  const scale = Math.min(sx, sy, sz) * Math.max(0.001, Number(scaleMultiplier) || 1);
  model.scale.setScalar(scale);
  box.setFromObject(model);
  box.getCenter(center);
  box.getSize(size);
  const minY = box.min.y;
  model.position.set(-center.x, -minY, -center.z);
  model.renderOrder = 1;
  return {
    rawSize: {
      width: rawSize.x,
      height: rawSize.y,
      depth: rawSize.z,
    },
    fittedSize: {
      width: size.x,
      height: size.y,
      depth: size.z,
    },
  };
}

function getObjectTintColor(object) {
  const raw = String(object?.tint || "").trim();
  if (!raw) return null;
  try {
    return new THREE.Color(raw);
  } catch {
    return null;
  }
}

function getTintedColor(baseColor, object) {
  const tint = getObjectTintColor(object);
  return tint ? tint.clone() : new THREE.Color(baseColor);
}

function makeTintedStandardMaterial(baseColor, options = {}, object = null) {
  return new THREE.MeshStandardMaterial({
    ...options,
    color: getTintedColor(baseColor, object),
  });
}

function applyTintToLoadedModel(root, object) {
  const tint = getObjectTintColor(object);
  if (!root || !tint) return;
  root.traverse((node) => {
    if (!node?.isMesh) return;
    if (Array.isArray(node.material)) {
      node.material = node.material.map((material) => {
        if (!material) return material;
        const next = material.clone();
        if (next.color) next.color.copy(tint);
        return next;
      });
      return;
    }
    if (!node.material) return;
    node.material = node.material.clone();
    if (node.material.color) node.material.color.copy(tint);
  });
}

export function makeRoomCorner(scene, options = {}) {
  const bounds = options?.bounds || null;
  const floorObject = options?.floorObject || null;
  const floorWidth = Math.max(0.1, Number(bounds?.maxX) - Number(bounds?.minX) || 14);
  const floorDepth = Math.max(0.1, Number(bounds?.maxZ) - Number(bounds?.minZ) || 10);
  const floorCenterX = Number.isFinite(Number(bounds?.minX)) && Number.isFinite(Number(bounds?.maxX))
    ? (Number(bounds.minX) + Number(bounds.maxX)) * 0.5
    : -1;
  const floorCenterZ = Number.isFinite(Number(bounds?.minZ)) && Number.isFinite(Number(bounds?.maxZ))
    ? (Number(bounds.minZ) + Number(bounds.maxZ)) * 0.5
    : -1;
  const floorY = Number.isFinite(Number(bounds?.floorY)) ? Number(bounds.floorY) : 0;
  if (isRoomObjectVisible(floorObject)) {
    // Base floor slab (sits slightly below planks)
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(floorWidth, 0.2, floorDepth),
      makeTintedStandardMaterial(0xb8966e, { roughness: 0.95 }, floorObject)
    );
    floor.position.set(floorCenterX, floorY - 0.1, floorCenterZ);
    if (floorObject) tagRoomObject(floor, floorObject);
    scene.add(floor);

    // Wood planks running left-to-right across the floor
    const plankColors = [0xd4b896, 0xc9a47e, 0xdbbf98, 0xc4996e, 0xd8b48a];
    const plankCount = 11;
    const plankGap = 0.025;
    const plankThickness = 0.022;
    const plankDepth = floorDepth - 0.05;
    const totalGaps = (plankCount - 1) * plankGap;
    const plankWidth = (floorWidth - totalGaps - 0.1) / plankCount;
    const startX = floorCenterX - floorWidth * 0.5 + 0.05;

    for (let i = 0; i < plankCount; i++) {
      const px = startX + i * (plankWidth + plankGap) + plankWidth * 0.5;
      const color = plankColors[i % plankColors.length];
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(plankWidth, plankThickness, plankDepth),
        new THREE.MeshStandardMaterial({ color, roughness: 0.88 })
      );
      plank.position.set(px, floorY + plankThickness * 0.5, floorCenterZ);
      scene.add(plank);
    }
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8ddd0, roughness: 0.96 });
  const wallCenterX = floorCenterX;
  const wallCenterY = 1.6;
  const wallCenterZ = Number.isFinite(Number(bounds?.minZ)) ? Number(bounds.minZ) : -6;
  const wallWidth = floorWidth;
  const wallHeight = 3.2;
  const wallThickness = 0.2;
  const wallMinX = wallCenterX - wallWidth * 0.5;
  const wallMaxX = wallCenterX + wallWidth * 0.5;
  const wallMinY = wallCenterY - wallHeight * 0.5;
  const wallMaxY = wallCenterY + wallHeight * 0.5;

  const addBackWallPiece = (minX, maxX, minY, maxY) => {
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0.02 || h <= 0.02) return;
    const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThickness), wallMat);
    piece.position.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, wallCenterZ);
    scene.add(piece);
  };

  const opening = options?.windowOpening;
  if (opening) {
    const halfW = Math.max(0.1, Number(opening.width) * 0.5);
    const halfH = Math.max(0.1, Number(opening.height) * 0.5);
    const rawCenterX = Number(opening.centerX);
    const rawCenterY = Number(opening.centerY);
    const ox = THREE.MathUtils.clamp(
      Number.isFinite(rawCenterX) ? rawCenterX : wallCenterX,
      wallMinX + halfW,
      wallMaxX - halfW
    );
    const oy = THREE.MathUtils.clamp(
      Number.isFinite(rawCenterY) ? rawCenterY : wallCenterY,
      wallMinY + halfH,
      wallMaxY - halfH
    );
    const openMinX = ox - halfW;
    const openMaxX = ox + halfW;
    const openMinY = oy - halfH;
    const openMaxY = oy + halfH;

    // Build the back wall as 4 pieces around the window hole.
    addBackWallPiece(wallMinX, openMinX, wallMinY, wallMaxY); // left
    addBackWallPiece(openMaxX, wallMaxX, wallMinY, wallMaxY); // right
    addBackWallPiece(openMinX, openMaxX, wallMinY, openMinY); // bottom
    addBackWallPiece(openMinX, openMaxX, openMaxY, wallMaxY); // top

    // Window reveal so the wall opening has visible depth.
    const revealMat = new THREE.MeshStandardMaterial({ color: 0xd4c8b8, roughness: 0.84 });
    const revealT = 0.03;
    const revealLeft = new THREE.Mesh(new THREE.BoxGeometry(revealT, openMaxY - openMinY, wallThickness), revealMat);
    revealLeft.position.set(openMinX + revealT * 0.5, (openMinY + openMaxY) * 0.5, wallCenterZ);
    scene.add(revealLeft);

    const revealRight = new THREE.Mesh(new THREE.BoxGeometry(revealT, openMaxY - openMinY, wallThickness), revealMat);
    revealRight.position.set(openMaxX - revealT * 0.5, (openMinY + openMaxY) * 0.5, wallCenterZ);
    scene.add(revealRight);

    const revealTop = new THREE.Mesh(new THREE.BoxGeometry(openMaxX - openMinX, revealT, wallThickness), revealMat);
    revealTop.position.set((openMinX + openMaxX) * 0.5, openMaxY - revealT * 0.5, wallCenterZ);
    scene.add(revealTop);

    const revealBottom = new THREE.Mesh(new THREE.BoxGeometry(openMaxX - openMinX, revealT, wallThickness), revealMat);
    revealBottom.position.set((openMinX + openMaxX) * 0.5, openMinY + revealT * 0.5, wallCenterZ);
    scene.add(revealBottom);
  } else {
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(wallWidth, wallHeight, wallThickness), wallMat);
    backWall.position.set(wallCenterX, wallCenterY, wallCenterZ);
    scene.add(backWall);
  }

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, floorDepth), wallMat);
  leftWall.position.set(Number.isFinite(Number(bounds?.minX)) ? Number(bounds.minX) : -8, 1.6, floorCenterZ);
  scene.add(leftWall);
}

export function makeDesk(scene, desk) {
  const topMat = makeTintedStandardMaterial(0x5f5347, { roughness: 0.76 }, desk);
  const legMat = makeTintedStandardMaterial(0x433a33, { roughness: 0.8 }, desk);
  const group = new THREE.Group();
  group.position.copy(desk.pos);
  group.rotation.y = getObjectRotation(desk);
  if (!isRoomObjectVisible(desk)) {
    addInvisibleSurfaceProxy(group, desk, Number(desk.topY) + 0.01);
    tagRoomObject(group, desk);
    scene.add(group);
    return;
  }

  const top = new THREE.Mesh(new THREE.BoxGeometry(desk.sizeX, 0.12, desk.sizeZ), topMat);
  top.position.set(0, 1.02, 0);
  attachSurfaceData(top, desk);
  tagRoomObject(top, desk);
  group.add(top);

  const legGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  const legOffsets = [
    [-1.45, -0.8],
    [1.45, -0.8],
    [-1.45, 0.8],
    [1.45, 0.8],
  ];
  for (const [dx, dz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(dx, 0.5, dz);
    tagRoomObject(leg, desk);
    group.add(leg);
  }
  tagRoomObject(group, desk);
  scene.add(group);
}

export function makeBed(scene, bed) {
  const group = new THREE.Group();
  group.position.copy(bed.pos);
  group.rotation.y = (bed.rotQuarterTurns || 0) * Math.PI * 0.5;

  // Frame
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3a, roughness: 0.82 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(bed.width, 0.18, bed.depth), frameMat);
  frame.position.set(0, 0.09, 0);
  group.add(frame);

  // Mattress
  const mattressMat = new THREE.MeshStandardMaterial({ color: 0xf0e6d8, roughness: 0.9 });
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(bed.width - 0.1, 0.22, bed.depth - 0.1), mattressMat);
  mattress.position.set(0, 0.29, 0);
  group.add(mattress);

  // Blanket (covers lower 2/3 of mattress)
  const blanketMat = new THREE.MeshStandardMaterial({ color: 0x7a9cbf, roughness: 0.95 });
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(bed.width - 0.12, 0.07, bed.depth * 0.68), blanketMat);
  blanket.position.set(0, 0.415, bed.depth * 0.16);
  group.add(blanket);

  // Pillow
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xfaf0e6, roughness: 0.88 });
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(bed.width * 0.55, 0.1, 0.38), pillowMat);
  pillow.position.set(0, 0.41, -(bed.depth * 0.5 - 0.28));
  group.add(pillow);

  // Headboard
  const headboardMat = new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 0.78 });
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(bed.width, 0.72, 0.1), headboardMat);
  headboard.position.set(0, 0.54, -(bed.depth * 0.5 + 0.05));
  group.add(headboard);

  tagRoomObject(group, bed);
  scene.add(group);
}
export function makeBedsideTable(scene, table) {
  const group = new THREE.Group();
  group.position.copy(table.pos);

  // Main body
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a6240, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.58, 0.42), bodyMat);
  body.position.set(0, 0.29, 0);
  group.add(body);

  // Table top
  const topMat = new THREE.MeshStandardMaterial({ color: 0x9e7250, roughness: 0.72 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.48), topMat);
  top.position.set(0, 0.605, 0);
  group.add(top);

  // Small drawer line
  const drawerMat = new THREE.MeshStandardMaterial({ color: 0x7a5535, roughness: 0.85 });
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.02), drawerMat);
  drawer.position.set(0, 0.32, 0.22);
  group.add(drawer);

  // Drawer handle
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xc8a870, roughness: 0.5, metalness: 0.3 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.025), handleMat);
  handle.position.set(0, 0.32, 0.235);
  group.add(handle);

  tagRoomObject(group, table);
  scene.add(group);
}
export function makeRug(scene, rug) {
  const group = new THREE.Group();
  group.position.copy(rug.pos);
  group.position.y = 0.055;

  const w = rug.width || 2.2;
  const d = rug.depth || 3.2;

  // Base — deep navy
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.018, d),
    new THREE.MeshStandardMaterial({ color: 0x0b3d6b, roughness: 0.95 })
  );
  group.add(base);

  // Middle band — medium blue
  const mid = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.78, 0.019, d * 0.78),
    new THREE.MeshStandardMaterial({ color: 0x3182bd, roughness: 0.93 })
  );
  group.add(mid);

  // Inner band — steel blue
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.56, 0.02, d * 0.56),
    new THREE.MeshStandardMaterial({ color: 0x6baed6, roughness: 0.92 })
  );
  group.add(inner);

  // Center — light blue
  const center = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.34, 0.021, d * 0.34),
    new THREE.MeshStandardMaterial({ color: 0x9ecae1, roughness: 0.9 })
  );
  group.add(center);

  // Cross stripes horizontal — white
  const stripeMatW = new THREE.MeshStandardMaterial({ color: 0xeff3ff, roughness: 0.9 });
  const stripeH = new THREE.Mesh(new THREE.BoxGeometry(w * 0.76, 0.022, d * 0.06), stripeMatW);
  group.add(stripeH);

  // Cross stripes vertical — white
  const stripeV = new THREE.Mesh(new THREE.BoxGeometry(w * 0.06, 0.022, d * 0.76), stripeMatW);
  group.add(stripeV);

  // Corner dots — dark navy accents
  const dotMat = new THREE.MeshStandardMaterial({ color: 0x08519c, roughness: 0.88 });
  const dotPositions = [
    [ w * 0.28,  d * 0.28],
    [-w * 0.28,  d * 0.28],
    [ w * 0.28, -d * 0.28],
    [-w * 0.28, -d * 0.28],
  ];
  for (const [dx, dz] of dotPositions) {
    const dot = new THREE.Mesh(new THREE.BoxGeometry(w * 0.09, 0.023, d * 0.09), dotMat);
    dot.position.set(dx, 0, dz);
    group.add(dot);
  }

  tagRoomObject(group, rug);
  scene.add(group);
}
export function makeWardrobe(scene, wardrobe) {
  const group = new THREE.Group();
  group.position.copy(wardrobe.pos);
  group.rotation.y = (wardrobe.rotQuarterTurns || 0) * Math.PI * 0.5;

  const w = wardrobe.width || 1.7;
  const h = wardrobe.height || 2.2;
  const d = wardrobe.depth || 0.55;

  const darkWood = new THREE.MeshStandardMaterial({ color: 0x5f5347, roughness: 0.82 });
  const midWood  = new THREE.MeshStandardMaterial({ color: 0x7a6352, roughness: 0.78 });
  const lightWood = new THREE.MeshStandardMaterial({ color: 0x9e8060, roughness: 0.72 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xc8a870, roughness: 0.4, metalness: 0.5 });

  // Main body
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkWood);
  body.position.set(0, h * 0.5, 0);
  group.add(body);

  // Cornice step 1 — slightly wider and shallower
  const cornice1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.1, d + 0.04), midWood);
  cornice1.position.set(0, h + 0.05, 0);
  group.add(cornice1);

  // Cornice step 2 — even wider, thin cap
  const cornice2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.06, d + 0.08), lightWood);
  cornice2.position.set(0, h + 0.13, 0);
  group.add(cornice2);

  // Cornice step 3 — narrow top ridge
  const cornice3 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.02), darkWood);
  cornice3.position.set(0, h + 0.21, 0);
  group.add(cornice3);

  // Door divider (center vertical line)
  const divider = new THREE.Mesh(new THREE.BoxGeometry(0.04, h - 0.1, 0.03), midWood);
  divider.position.set(0, h * 0.5, d * 0.5 + 0.01);
  group.add(divider);

  // Left door panel
  const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.46, h * 0.72, 0.025), midWood);
  leftPanel.position.set(-w * 0.25, h * 0.5, d * 0.5 + 0.01);
  group.add(leftPanel);

  // Right door panel
  const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.46, h * 0.72, 0.025), midWood);
  rightPanel.position.set(w * 0.25, h * 0.5, d * 0.5 + 0.01);
  group.add(rightPanel);

  // Left handle
  const leftHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), handleMat);
  leftHandle.position.set(-w * 0.08, h * 0.5, d * 0.5 + 0.03);
  group.add(leftHandle);

  // Right handle
  const rightHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), handleMat);
  rightHandle.position.set(w * 0.08, h * 0.5, d * 0.5 + 0.03);
  group.add(rightHandle);

  // Base plinth
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.1, d + 0.02), darkWood);
  plinth.position.set(0, 0.05, 0);
  group.add(plinth);

  tagRoomObject(group, wardrobe);
  scene.add(group);
}
export function makeBookcase(scene, bookcase) {
  const group = new THREE.Group();
  group.position.copy(bookcase.pos);
  group.rotation.y = (bookcase.rotQuarterTurns || 0) * Math.PI * 0.5;

  const w = bookcase.width || 1.1;
  const h = bookcase.height || 1.8;
  const d = bookcase.depth || 0.38;

  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc49a6c, roughness: 0.8 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0xd4aa7d, roughness: 0.75 });

  // Back panel
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), frameMat);
  back.position.set(0, h * 0.5, -d * 0.5 + 0.015);
  group.add(back);

  // Left side
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, d), frameMat);
  left.position.set(-w * 0.5 + 0.025, h * 0.5, 0);
  group.add(left);

  // Right side
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, d), frameMat);
  right.position.set(w * 0.5 - 0.025, h * 0.5, 0);
  group.add(right);

  // Bottom
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), frameMat);
  bottom.position.set(0, 0.025, 0);
  group.add(bottom);

  // Top
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.05, d + 0.03), shelfMat);
  top.position.set(0, h + 0.025, 0);
  group.add(top);

  // 3 shelves
  const shelfYs = [h * 0.28, h * 0.54, h * 0.78];
  for (const sy of shelfYs) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.05, 0.04, d), shelfMat);
    shelf.position.set(0, sy, 0);
    group.add(shelf);
  }

  // Books — each shelf gets a row of varied colored spines
  const bookColors = [
    0x3182bd, 0x9ecae1, 0x08519c, 0xc6e5f5,
    0x6baed6, 0x2c6e9e, 0xeff3ff, 0x4a90c4,
  ];
  const shelfBookYs = [h * 0.14, h * 0.41, h * 0.66];
  for (const by of shelfBookYs) {
    let curX = -w * 0.44;
    let i = Math.floor(Math.random() * bookColors.length);
    while (curX < w * 0.4) {
      const bw = 0.055 + (i % 3) * 0.018;
      const bh = 0.18 + (i % 4) * 0.04;
      const bookMat = new THREE.MeshStandardMaterial({ color: bookColors[i % bookColors.length], roughness: 0.85 });
      const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d * 0.72), bookMat);
      book.position.set(curX + bw * 0.5, by + bh * 0.5, 0);
      group.add(book);
      curX += bw + 0.008;
      i++;
    }
  }

  tagRoomObject(group, bookcase);
  scene.add(group);
}

export function makeChair(scene, chair) {
  const seatMat = makeTintedStandardMaterial(0x544a41, { roughness: 0.82 }, chair);
  const legMat = makeTintedStandardMaterial(0x39332d, { roughness: 0.84 }, chair);
  const backMat = makeTintedStandardMaterial(0x4c433b, { roughness: 0.8 }, chair);

  const group = new THREE.Group();
  group.position.copy(chair.pos);
  group.rotation.y = getObjectRotation(chair);
  if (!isRoomObjectVisible(chair)) {
    addInvisibleSurfaceProxy(group, chair, Number(chair.seatY) + 0.01);
    tagRoomObject(group, chair);
    scene.add(group);
    return;
  }

  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(chair.sizeX, chair.seatThickness, chair.sizeZ),
    seatMat
  );
  seat.position.set(0, chair.seatY - chair.seatThickness * 0.5, 0);
  attachSurfaceData(seat, chair);
  tagRoomObject(seat, chair);
  group.add(seat);

  const legHeight = Math.max(0.12, chair.seatY - chair.seatThickness);
  const legGeo = new THREE.BoxGeometry(chair.legHalfX * 2, legHeight, chair.legHalfZ * 2);
  const legOffsets = [
    [-chair.legInsetX, -chair.legInsetZ],
    [chair.legInsetX, -chair.legInsetZ],
    [-chair.legInsetX, chair.legInsetZ],
    [chair.legInsetX, chair.legInsetZ],
  ];
  for (const [dx, dz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(dx, legHeight * 0.5, dz);
    tagRoomObject(leg, chair);
    group.add(leg);
  }

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(chair.sizeX, chair.backHeight, chair.backThickness),
    backMat
  );
  back.position.set(
    0,
    chair.seatY + chair.backHeight * 0.5 - chair.seatThickness * 0.5,
    -chair.sizeZ * 0.5 + chair.backThickness * 0.5
  );
  tagRoomObject(back, chair);
  group.add(back);
  tagRoomObject(group, chair);
  scene.add(group);
}

export function makeShelf(scene, shelf) {
  const postMat = makeTintedStandardMaterial(0x7a5c48, { roughness: 0.84 }, shelf);
  const boardMat = makeTintedStandardMaterial(0x9c7355, { roughness: 0.78 }, shelf);
  const backMat = makeTintedStandardMaterial(0x8a6650, { roughness: 0.86 }, shelf);

  const group = new THREE.Group();
  group.position.copy(shelf.pos);
  group.rotation.y = getObjectRotation(shelf);
  if (!isRoomObjectVisible(shelf)) {
    addInvisibleSurfaceProxy(group, shelf, Number(shelf.surfaceY) + 0.01);
    tagRoomObject(group, shelf);
    scene.add(group);
    return;
  }
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(shelf.width, shelf.boardThickness, shelf.depth),
    boardMat
  );
  board.position.set(0, shelf.surfaceY - shelf.boardThickness * 0.5, 0);
  attachSurfaceData(board, shelf);
  tagRoomObject(board, shelf);
  group.add(board);

  const postHeight = Math.max(0.3, shelf.surfaceY - shelf.boardThickness);
  const postGeo = new THREE.BoxGeometry(shelf.postHalf * 2, postHeight, shelf.postHalf * 2);
  const postInsetX = shelf.width * 0.5 - shelf.postHalf;
  const postInsetZ = shelf.depth * 0.5 - shelf.postHalf;
  const postOffsets = [
    [-postInsetX, -postInsetZ],
    [postInsetX, -postInsetZ],
    [-postInsetX, postInsetZ],
    [postInsetX, postInsetZ],
  ];
  for (const [dx, dz] of postOffsets) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(dx, postHeight * 0.5, dz);
    tagRoomObject(post, shelf);
    group.add(post);
  }

  const backPanel = new THREE.Mesh(
    new THREE.BoxGeometry(shelf.width, shelf.surfaceY - 0.2 + 0.08, 0.04),
    backMat
  );
  backPanel.position.set(
    0,
    (shelf.surfaceY + 0.2) * 0.5 - shelf.boardThickness * 0.5,
    -shelf.depth * 0.5 + 0.02
  );
  tagRoomObject(backPanel, shelf);
  group.add(backPanel);
  tagRoomObject(group, shelf);
  scene.add(group);
}

export function makePlatform(scene, platform) {
  const boardMat = makeTintedStandardMaterial(0xc4a882, { roughness: 0.78 }, platform);
  const group = new THREE.Group();
  group.position.copy(platform.pos);
  group.rotation.y = getObjectRotation(platform);
  if (!isRoomObjectVisible(platform)) {
    addInvisibleSurfaceProxy(group, platform, Number(platform.surfaceY) + 0.01);
    tagRoomObject(group, platform);
    scene.add(group);
    return;
  }
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(platform.width, platform.thickness, platform.depth),
    boardMat
  );
  board.position.set(0, platform.surfaceY - platform.thickness * 0.5, 0);
  attachSurfaceData(board, platform);
  tagRoomObject(board, platform);
  group.add(board);
  tagRoomObject(group, platform);
  scene.add(group);
}

export function makeHoverShelf(scene, hoverShelf) {
  makePlatform(scene, hoverShelf);
}

export function makePrimitiveObject(scene, object) {
  const group = new THREE.Group();
  group.position.copy(object.pos);
  group.rotation.y = getObjectRotation(object);
  if (!isRoomObjectVisible(object)) {
    if (object.surface?.enabled && String(object.shapeKind || "box") !== "sphere") {
      addInvisibleSurfaceProxy(group, object, Number(object.surfaceY) + 0.01);
    }
    tagRoomObject(group, object);
    scene.add(group);
    return;
  }

  let mesh = null;
  let topY = 0;
  const shapeKind = String(object.shapeKind || "box");
  const material = makeTintedStandardMaterial(0x6c7686, { roughness: 0.78 }, object);

  if (shapeKind === "sphere") {
    const radius = Math.max(0.05, Number(object.radius) || 0.45);
    mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material);
    mesh.position.set(0, Number(object.centerY) || radius, 0);
  } else if (shapeKind === "cylinder") {
    const radius = Math.max(0.05, Number(object.radius) || 0.45);
    const height = Math.max(0.05, Number(object.height) || 0.9);
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 28), material);
    topY = (Number(object.surfaceY) || height) - height * 0.5;
    mesh.position.set(0, topY, 0);
    attachSurfaceData(mesh, object);
  } else if (shapeKind === "triPrism") {
    const width = Math.max(0.1, Number(object.width) || 0.9);
    const depth = Math.max(0.1, Number(object.depth) || 0.9);
    const height = Math.max(0.05, Number(object.height) || 0.9);
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, height, 3), material);
    mesh.scale.set(width, 1, depth);
    topY = (Number(object.surfaceY) || height) - height * 0.5;
    mesh.position.set(0, topY, 0);
    attachSurfaceData(mesh, object);
  } else {
    const width = Math.max(0.1, Number(object.width) || 0.9);
    const depth = Math.max(0.1, Number(object.depth) || 0.9);
    const height = Math.max(0.05, Number(object.height) || 0.9);
    mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    topY = (Number(object.surfaceY) || height) - height * 0.5;
    mesh.position.set(0, topY, 0);
    attachSurfaceData(mesh, object);
  }

  tagRoomObject(mesh, object);
  group.add(mesh);
  if (object.surface?.enabled && shapeKind !== "sphere") {
    const footprint = getRenderableObjectFootprint(object);
    addInvisibleSurfaceProxy(group, object, Number(object.surfaceY) + 0.01);
  }
  tagRoomObject(group, object);
  scene.add(group);
}

export function makeModelObject(scene, object, gltfLoader, options = {}) {
  const group = new THREE.Group();
  group.position.copy(object.pos);
  group.rotation.y = getObjectRotation(object);
  const onModelMetrics = typeof options?.onModelMetrics === "function" ? options.onModelMetrics : null;
  if (!isRoomObjectVisible(object)) {
    if (object.surface?.enabled) {
      addInvisibleSurfaceProxy(group, object, Number(object.surfaceY) + 0.01);
    }
    tagRoomObject(group, object);
    scene.add(group);
    return;
  }

  const width = Math.max(0.1, Number(object.width) || 1);
  const depth = Math.max(0.1, Number(object.depth) || 1);
  const height = Math.max(0.05, Number(object.height) || 1);
  const centerY = (Number(object.surfaceY) || height) - height * 0.5;
  const fallback = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    makeTintedStandardMaterial(0x718099, { roughness: 0.76, transparent: true, opacity: 0.72 }, object)
  );
  fallback.position.set(0, centerY, 0);
  attachSurfaceData(fallback, object);
  tagRoomObject(fallback, object);
  group.add(fallback);

  const modelCandidates = [];
  if (object.runtimeAssetUrl) modelCandidates.push(String(object.runtimeAssetUrl));
  if (object.assetPath) modelCandidates.push(String(object.assetPath));
  if (gltfLoader && modelCandidates.length) {
    const attachModel = (model) => {
      if (!model) return false;
      const metrics = fitModelToBounds(model, width, height, depth, object.modelScale || 1);
      if (!metrics) return false;
      applyTintToLoadedModel(model, object);
      model.position.y += (Number(object.surfaceY) || height) - metrics.fittedSize.height;
      fallback.visible = false;
      group.add(model);
      if (onModelMetrics) {
        onModelMetrics({
          objectId: object.id,
          rawBounds: metrics.rawSize,
          fittedBounds: metrics.fittedSize,
          usedFallback: false,
        });
      }
      return true;
    };
    const cachedModel = tryGetLoadedModelScene(modelCandidates);
    if (!attachModel(cachedModel)) {
      loadModelSceneCached(gltfLoader, modelCandidates)
        .then((model) => {
          if (!attachModel(model)) {
            fallback.visible = true;
            if (onModelMetrics) onModelMetrics({ objectId: object.id, fittedBounds: null, usedFallback: true });
          }
        })
        .catch(() => {
          fallback.visible = true;
          if (onModelMetrics) onModelMetrics({ objectId: object.id, fittedBounds: null, usedFallback: true });
        });
    }
  } else if (onModelMetrics) {
    onModelMetrics({ objectId: object.id, fittedBounds: null, usedFallback: true });
  }

  if (object.surface?.enabled) {
    addInvisibleSurfaceProxy(group, object, Number(object.surfaceY) + 0.01);
  }
  tagRoomObject(group, object);
  scene.add(group);
}

export function makeWindowSill(scene, windowSill) {
  const frameMat = makeTintedStandardMaterial(0x636d7b, { roughness: 0.64, metalness: 0.05 }, windowSill);
  const sillMat = makeTintedStandardMaterial(0x767f8c, { roughness: 0.62, metalness: 0.03 }, windowSill);
  const glassMat = makeTintedStandardMaterial(0xf1f2f4, {
    roughness: 0.05,
    metalness: 0.04,
    transparent: true,
    opacity: 0.2,
  }, windowSill);

  const root = new THREE.Group();
  root.position.set(windowSill.pos.x, 0, windowSill.pos.z);
  root.rotation.y = getObjectRotation(windowSill);
  if (!isRoomObjectVisible(windowSill)) {
    if (windowSill.surface?.enabled) {
      addInvisibleSurfaceProxy(root, windowSill, Number(windowSill.surfaceY) + 0.01);
    }
    root.userData.openAmount = 0;
    tagRoomObject(root, windowSill);
    scene.add(root);
    return {
      root,
      sill: null,
      setOpenAmount() {},
    };
  }

  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(windowSill.width, windowSill.thickness, windowSill.depth),
    sillMat
  );
  sill.position.set(0, windowSill.surfaceY - windowSill.thickness * 0.5, 0);
  attachSurfaceData(sill, windowSill);
  root.add(sill);

  const openingW = windowSill.windowWidth;
  const openingH = windowSill.windowHeight;
  const frameT = 0.055;
  const frameDepth = 0.1;
  const frameY = windowSill.openingCenterY;
  const frameZ = (windowSill.wallZ - windowSill.pos.z) + frameDepth * 0.5;

  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(openingW + frameT * 2, frameT, frameDepth), frameMat);
  frameTop.position.set(0, frameY + openingH * 0.5 + frameT * 0.5, frameZ);
  root.add(frameTop);

  const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(openingW + frameT * 2, frameT, frameDepth), frameMat);
  frameBottom.position.set(0, frameY - openingH * 0.5 - frameT * 0.5, frameZ);
  root.add(frameBottom);

  const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(frameT, openingH, frameDepth), frameMat);
  frameLeft.position.set(-openingW * 0.5 - frameT * 0.5, frameY, frameZ);
  root.add(frameLeft);

  const frameRight = new THREE.Mesh(new THREE.BoxGeometry(frameT, openingH, frameDepth), frameMat);
  frameRight.position.set(openingW * 0.5 + frameT * 0.5, frameY, frameZ);
  root.add(frameRight);

  // Sliding sash pane: opening the window moves the pane upward.
  const paneWidth = openingW * 0.92;
  const paneHeight = openingH * 0.9;
  const paneDepth = frameT * 0.45;
  const paneBaseY = frameY;
  const paneZ = frameZ + 0.012;
  const paneOpenLift = openingH * 0.78;

  const pane = new THREE.Mesh(
    new THREE.BoxGeometry(paneWidth, paneHeight, paneDepth),
    glassMat
  );
  pane.position.set(0, paneBaseY, paneZ);
  root.add(pane);

  // Bottom sash rail (the visible line is at the bottom of the glass, not center).
  const bottomRailHeight = frameT * 0.95;
  const bottomRailZ = frameZ + 0.016;
  const bottomRailBaseY = paneBaseY - paneHeight * 0.5 + bottomRailHeight * 0.5;
  const bottomRail = new THREE.Mesh(
    new THREE.BoxGeometry(paneWidth, bottomRailHeight, frameT * 0.62),
    frameMat
  );
  bottomRail.position.set(0, bottomRailBaseY, bottomRailZ);
  root.add(bottomRail);

  const sillLip = new THREE.Mesh(
    new THREE.BoxGeometry(windowSill.width + 0.08, 0.04, 0.08),
    frameMat
  );
  // Keep the sill crease toward the wall/window side rather than room-facing edge.
  sillLip.position.set(0, windowSill.surfaceY + 0.015, -windowSill.depth * 0.5 - 0.02);
  root.add(sillLip);

  root.userData.windowSill = {
    pane,
    bottomRail,
    paneBaseY,
    bottomRailBaseY,
    paneOpenLift,
  };
  if (windowSill.surface?.enabled) {
    addInvisibleSurfaceProxy(root, windowSill, Number(windowSill.surfaceY) + 0.01);
  }
  root.userData.openAmount = 0;
  tagRoomObject(root, windowSill);
  scene.add(root);

  function setOpenAmount(value) {
    const t = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
    root.userData.openAmount = t;
    const data = root.userData.windowSill;
    const dy = data.paneOpenLift * t;
    data.pane.position.y = data.paneBaseY + dy;
    data.bottomRail.position.y = data.bottomRailBaseY + dy;
  }

  setOpenAmount(0);
  return {
    root,
    sill,
    setOpenAmount,
  };
}

function loadTrashCanModel({ trashGroup, fallbackMeshes, gltfLoader, modelCandidates, trashCan }) {
  if (!gltfLoader || !Array.isArray(modelCandidates) || modelCandidates.length === 0) return;
  const attachModel = (model) => {
    if (!model) return false;
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return false;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const targetWidth = trashCan.outerRadius * 2 * trashCan.modelWidthScale;
    const targetHeight = trashCan.rimY + 0.06;
    const sx = targetWidth / Math.max(size.x, 1e-3);
    const sy = targetHeight / Math.max(size.y, 1e-3);
    const sz = targetWidth / Math.max(size.z, 1e-3);
    const s = Math.min(sx, sy, sz);

    model.scale.setScalar(s);
    box.setFromObject(model);
    box.getCenter(center);
    const minY = box.min.y;
    applyTintToLoadedModel(model, trashCan);
    model.position.set(-center.x, -minY, -center.z);
    model.renderOrder = 1;
    for (const m of fallbackMeshes) m.visible = false;
    trashGroup.add(model);
    return true;
  };

  const cachedModel = tryGetLoadedModelScene(modelCandidates);
  if (attachModel(cachedModel)) return;

  for (const m of fallbackMeshes) m.visible = false;
  loadModelSceneCached(gltfLoader, modelCandidates)
    .then((model) => {
      if (!attachModel(model)) {
        for (const m of fallbackMeshes) m.visible = true;
      }
    })
    .catch((error) => {
      console.warn("Failed to load trash can model from all paths:", modelCandidates, error);
      for (const m of fallbackMeshes) m.visible = true;
    });
}

export function makeBins({
  scene,
  hamper,
  trashCan,
  binVisuals,
  gltfLoader,
  trashCanModelCandidates,
}) {
  binVisuals.hamper.shells = [];
  binVisuals.hamper.ring = null;
  binVisuals.trash.shells = [];
  binVisuals.trash.ring = null;

  if (!isRoomObjectVisible(hamper) && !isRoomObjectVisible(trashCan)) {
    return { hamperRoot: null, trashCanRoot: null };
  }

  // Hamper: open basket + visible laundry so it's clearly the laundry bin.
  const hamperWallMat = makeTintedStandardMaterial(0x5b9bd2, { roughness: 0.84 }, hamper);
  const hamperTrimMat = makeTintedStandardMaterial(0xd5ecff, { roughness: 0.56 }, hamper);
  const hamperClothMat = makeTintedStandardMaterial(0xe8eff8, { roughness: 0.95 }, hamper);

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
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.03), hamperTrimMat);
    vent.position.set(i * 0.2, 0.28, hamper.outerHalfZ + 0.04);
    hamperGroup.add(vent);
  }

  const hamperInside = new THREE.Mesh(
    new THREE.BoxGeometry(xSpan - 0.08, 0.48, zSpan - 0.08),
    makeTintedStandardMaterial(0x8ea6b9, { roughness: 0.98, side: THREE.BackSide }, hamper)
  );
  hamperInside.position.set(0, 0.29, 0);
  hamperGroup.add(hamperInside);

  const laundryA = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.13, 0.4), hamperClothMat);
  laundryA.position.set(-0.04, 0.56, 0.02);
  laundryA.rotation.z = -0.14;
  hamperGroup.add(laundryA);
  const laundryB = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.3), hamperClothMat);
  laundryB.position.set(0.09, 0.62, -0.04);
  laundryB.rotation.z = 0.11;
  laundryB.rotation.x = 0.08;
  hamperGroup.add(laundryB);

  const hamperRing = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.43, 30),
    new THREE.MeshBasicMaterial({ color: 0x77c9ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide })
  );
  hamperRing.rotation.x = -Math.PI / 2;
  hamperRing.position.set(0, hamper.rimY + 0.03, 0);
  hamperGroup.add(hamperRing);

  if (isRoomObjectVisible(hamper)) {
    scene.add(hamperGroup);
    tagRoomObject(hamperGroup, hamper);
    binVisuals.hamper.shells = walls.concat(rimBars);
    binVisuals.hamper.ring = hamperRing;
  }

  // Trash can with visible opening.
  const trashShellMat = makeTintedStandardMaterial(0x5b646f, {
    roughness: 0.7,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: true,
  }, trashCan);
  const trashRimMat = makeTintedStandardMaterial(0xb5bec7, { roughness: 0.62 }, trashCan);
  const trashInsideMat = makeTintedStandardMaterial(0x2f333b, { roughness: 1.0 }, trashCan);

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
    makeTintedStandardMaterial(0x3b434d, { roughness: 0.9 }, trashCan)
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
  loadTrashCanModel({
    trashGroup,
    fallbackMeshes: trashFallbackMeshes,
    gltfLoader,
    modelCandidates: trashCanModelCandidates,
    trashCan,
  });

  if (isRoomObjectVisible(trashCan)) {
    scene.add(trashGroup);
    tagRoomObject(trashGroup, trashCan);
    binVisuals.trash.shells = [trashBody, trashRim];
    binVisuals.trash.ring = trashRing;
  }
  return { hamperRoot: hamperGroup, trashCanRoot: trashGroup };
}

export function buildRoomSceneFromLayout({
  scene,
  layout,
  binVisuals,
  gltfLoader,
  trashCanModelCandidates,
  onModelMetrics,
}) {
  if (!scene || !layout) return { windowSillRuntime: null };

  makeRoomCorner(scene, {
    ...(layout.roomShell || {}),
    bounds: layout.roomBounds || null,
    floorObject: layout.floor || layout.objectsById?.floor || null,
  });

  let windowSillRuntime = null;
  const objects = Array.isArray(layout.objects) ? layout.objects : [];
  for (const object of objects) {
    if (!object?.type) continue;
    switch (object.type) {
      case "bed":
        makeBed(scene, object);
        break;
      case "bedsideTable":
        makeBedsideTable(scene, object);
        break;
      case "rug":
        makeRug(scene, object);
        break;
      case "wardrobe":
        makeWardrobe(scene, object);
        break;
      case "bookcase":
        makeBookcase(scene, object);
        break;
      case "desk":
        makeDesk(scene, object);
        break;
      case "chair":
        makeChair(scene, object);
        break;
      case "shelf":
        makeShelf(scene, object);
        break;
      case "platform":
        makePlatform(scene, object);
        break;
      case "primitive":
        makePrimitiveObject(scene, object);
        break;
      case "model":
        makeModelObject(scene, object, gltfLoader, { onModelMetrics });
        break;
      case "windowSill":
        windowSillRuntime = makeWindowSill(scene, object);
        break;
      default:
        break;
    }
  }

  const hamper = layout.objectsById?.hamper || layout.hamper || null;
  const trashCan = layout.objectsById?.trashCan || layout.trashCan || null;
  if (hamper && trashCan) {
    makeBins({
      scene,
      hamper,
      trashCan,
      binVisuals,
      gltfLoader,
      trashCanModelCandidates,
    });
  }

  return { windowSillRuntime };
}
