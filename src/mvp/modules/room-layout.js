import {
  degreesToRadians,
  getObjectRotationDegrees,
  getObjectRotationRadians,
  getQuarterTurnsFromDegrees,
  getRotatedRectAabb,
  getSurfaceAabb,
  normalizeRotationDegrees,
  rotateOffsetXZ,
  rotatePointAroundCenterXZ,
  roundSurfaceNumber,
} from "./surface-shapes.js";

function cloneVector3(THREE, value) {
  return new THREE.Vector3(
    Number.isFinite(Number(value?.x)) ? roundLayoutNumber(Number(value.x)) : 0,
    Number.isFinite(Number(value?.y)) ? roundLayoutNumber(Number(value.y)) : 0,
    Number.isFinite(Number(value?.z)) ? roundLayoutNumber(Number(value.z)) : 0
  );
}

function roundLayoutNumber(value) {
  return roundSurfaceNumber(value, 3);
}

function cloneFlags(flags = {}) {
  return { ...flags };
}

function cloneMeta(meta = {}) {
  return meta && typeof meta === "object" ? { ...meta } : {};
}

function cloneObstacleList(specs = []) {
  return specs.map((spec) => ({
    ...spec,
    jumpIgnoreSurfaceIds: Array.isArray(spec.jumpIgnoreSurfaceIds)
      ? [...spec.jumpIgnoreSurfaceIds]
      : spec.jumpIgnoreSurfaceIds,
  }));
}

function materializeRelativeSpecs(basePos, specs = []) {
  return specs.map((spec) => {
    const dx = Number.isFinite(Number(spec.dx)) ? Number(spec.dx) : 0;
    const dz = Number.isFinite(Number(spec.dz)) ? Number(spec.dz) : 0;
    const out = { ...spec };
    delete out.dx;
    delete out.dz;
    out.x = basePos.x + dx;
    out.z = basePos.z + dz;
    return out;
  });
}

function materializeRotatedRelativeSpecs(basePos, specs = [], rotationRadians = 0) {
  return materializeRelativeSpecs(basePos, specs).map((spec) => {
    const rotated = rotateOffsetXZ(spec.x - basePos.x, spec.z - basePos.z, rotationRadians);
    const out = {
      ...spec,
      x: basePos.x + rotated.dx,
      z: basePos.z + rotated.dz,
    };
    if (spec.kind !== "circle") {
      const explicitYaw = Number.isFinite(Number(spec.yaw)) ? Number(spec.yaw) : 0;
      if (Math.abs(rotationRadians) > 1e-6 || String(spec.kind || "") === "obb") {
        out.kind = "obb";
        out.yaw = explicitYaw + rotationRadians;
      }
    }
    return out;
  });
}

function buildSurfaceSpec(id, name, config = {}, surface = null) {
  if (!surface?.enabled) return null;
  const base = {
    id,
    name: name || id,
    y: Number(config.y),
    flags: cloneFlags(surface.flags),
    special: cloneMeta(surface.special),
    supports: cloneObstacleList(surface.supports),
    blockers: cloneObstacleList(surface.blockers),
  };
  if (config.shape === "circle") {
    const radius = Math.max(0.05, Number(config.radius) || 0.05);
    const centerX = Number(config.centerX);
    const centerZ = Number(config.centerZ);
    return {
      ...base,
      shape: "circle",
      centerX,
      centerZ,
      radius,
      minX: centerX - radius,
      maxX: centerX + radius,
      minZ: centerZ - radius,
      maxZ: centerZ + radius,
    };
  }
  const width = Math.max(0.05, Number(config.width) || 0.05);
  const depth = Math.max(0.05, Number(config.depth) || 0.05);
  const centerX = Number(config.centerX);
  const centerZ = Number(config.centerZ);
  const yaw = Number.isFinite(Number(config.yaw)) ? Number(config.yaw) : 0;
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const aabb = getSurfaceAabb({
    shape: Math.abs(yaw) > 1e-6 ? "obb" : "rect",
    centerX,
    centerZ,
    halfWidth,
    halfDepth,
    yaw,
  });
  return {
    ...base,
    shape: Math.abs(yaw) > 1e-6 ? "obb" : "rect",
    centerX,
    centerZ,
    halfWidth,
    halfDepth,
    yaw,
    minX: aabb.minX,
    maxX: aabb.maxX,
    minZ: aabb.minZ,
    maxZ: aabb.maxZ,
  };
}

function normalizeTintValue(value, allowEmpty = false) {
  const raw = String(value ?? "").trim();
  if (!raw) return allowEmpty ? "" : "#ffffff";
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const short = raw.slice(1).toLowerCase();
    return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
  }
  return "#ffffff";
}

function normalizeObjectName(value) {
  return String(value ?? "").trim();
}

function createDefaultSurfaceShape(objectType = "object") {
  if (objectType === "primitiveCylinder") return "circle";
  return "rect";
}

function getObjectSurfaceShape(object) {
  const explicit = String(object?.surface?.shape || "").trim().toLowerCase();
  if (explicit === "circle" || explicit === "disc" || explicit === "disk") return "circle";
  return "rect";
}

function getObjectSurfaceOffset(object) {
  return {
    x: Number.isFinite(Number(object?.surface?.offsetX)) ? Number(object.surface.offsetX) : 0,
    z: Number.isFinite(Number(object?.surface?.offsetZ)) ? Number(object.surface.offsetZ) : 0,
  };
}

function getObjectSurfaceCenter(object) {
  const yaw = getObjectRotationRadians(object);
  const offset = getObjectSurfaceOffset(object);
  const rotated = rotateOffsetXZ(offset.x, offset.z, yaw);
  return {
    x: Number(object?.pos?.x || 0) + rotated.dx,
    z: Number(object?.pos?.z || 0) + rotated.dz,
  };
}

function buildDeskLegs(desk) {
  const rotation = getObjectRotationRadians(desk);
  return materializeRelativeSpecs(desk.pos, desk.surface?.supportOffsets || []).map((spec) => {
    const rotated = rotateOffsetXZ(spec.x - desk.pos.x, spec.z - desk.pos.z, rotation);
    return {
      x: desk.pos.x + rotated.dx,
      z: desk.pos.z + rotated.dz,
      halfX: Math.max(0.02, Number(spec.hx || 0) - 0.03),
      halfZ: Math.max(0.02, Number(spec.hz || 0) - 0.03),
      topY: Number(spec.topY || desk.topY),
    };
  });
}

function buildChairLegs(chair) {
  const rotation = getObjectRotationRadians(chair);
  return materializeRelativeSpecs(chair.pos, chair.surface?.supportOffsets || []).map((spec) => {
    const rotated = rotateOffsetXZ(spec.x - chair.pos.x, spec.z - chair.pos.z, rotation);
    const dims = getRotatedRectSize(Number(spec.hx || 0) * 2, Number(spec.hz || 0) * 2, rotation);
    return {
      x: chair.pos.x + rotated.dx,
      z: chair.pos.z + rotated.dz,
      halfX: Math.max(0.02, dims.width * 0.5 - 0.03),
      halfZ: Math.max(0.02, dims.depth * 0.5 - 0.03),
      topY: Number(spec.topY || chair.seatY),
    };
  });
}

function buildChairBackCollider(chair) {
  const relative = chair.surface?.blockerOffsets?.[0];
  if (!relative) return null;
  const rotation = getObjectRotationRadians(chair);
  const [spec] = materializeRelativeSpecs(chair.pos, [relative]);
  const rotated = rotateOffsetXZ(spec.x - chair.pos.x, spec.z - chair.pos.z, rotation);
  const dims = getRotatedRectSize(Number(spec.hx || 0) * 2, Number(spec.hz || 0) * 2, rotation);
  return {
    x: chair.pos.x + rotated.dx,
    z: chair.pos.z + rotated.dz,
    halfX: Math.max(0.02, dims.width * 0.5 - 0.02),
    halfZ: Math.max(0.02, dims.depth * 0.5 - 0.02),
    y: Number(spec.y || 0),
    h: Number(spec.h || 0),
  };
}

function buildShelfPosts(shelf) {
  const rotation = getObjectRotationRadians(shelf);
  return materializeRelativeSpecs(shelf.pos, shelf.surface?.supportOffsets || []).map((spec) => {
    const rotated = rotateOffsetXZ(spec.x - shelf.pos.x, spec.z - shelf.pos.z, rotation);
    const dims = getRotatedRectSize(Number(spec.hx || 0) * 2, Number(spec.hz || 0) * 2, rotation);
    return {
      x: shelf.pos.x + rotated.dx,
      z: shelf.pos.z + rotated.dz,
      halfX: Math.max(0.02, dims.width * 0.5 - 0.02),
      halfZ: Math.max(0.02, dims.depth * 0.5 - 0.02),
      topY: Number(spec.topY || shelf.surfaceY),
    };
  });
}

function buildShelfBackCollider(shelf) {
  const relative = shelf.surface?.blockerOffsets?.[0];
  if (!relative) return null;
  const rotation = getObjectRotationRadians(shelf);
  const [spec] = materializeRelativeSpecs(shelf.pos, [relative]);
  const rotated = rotateOffsetXZ(spec.x - shelf.pos.x, spec.z - shelf.pos.z, rotation);
  const dims = getRotatedRectSize(Number(spec.hx || 0) * 2, Number(spec.hz || 0) * 2, rotation);
  return {
    x: shelf.pos.x + rotated.dx,
    z: shelf.pos.z + rotated.dz,
    halfX: Math.max(0.02, dims.width * 0.5 - 0.02),
    halfZ: Math.max(0.02, dims.depth * 0.5 - 0.02),
    y: Number(spec.y || 0),
    h: Number(spec.h || 0),
  };
}

const ROOM_LAYOUT_OBJECT_IDS = [
  "floor",
  "desk",
  "chair",
  "shelf",
  "hoverShelf",
  "lowerPlatform",
  "upperPlatform",
  "windowSill",
  "hamper",
  "trashCan",
];

const POSITIVE_NUMERIC_FIELDS = new Set([
  "sizeX",
  "sizeZ",
  "topY",
  "seatY",
  "seatThickness",
  "legHalfX",
  "legHalfZ",
  "legInsetX",
  "legInsetZ",
  "backHeight",
  "backThickness",
  "width",
  "depth",
  "postHalf",
  "surfaceY",
  "thickness",
  "windowWidth",
  "windowHeight",
  "openingCenterY",
  "openDuration",
  "outerHalfX",
  "outerHalfZ",
  "halfX",
  "halfZ",
  "openingHalfX",
  "openingHalfZ",
  "rimY",
  "sinkY",
  "outerRadius",
  "radius",
  "openingRadius",
  "modelWidthScale",
  "height",
  "centerY",
  "modelScale",
]);

function toSerializableValue(value, options = {}) {
  const includeTransient = !!options.includeTransient;
  if (value && typeof value === "object" && value.isVector3) {
    return {
      x: roundLayoutNumber(Number(value.x) || 0),
      y: roundLayoutNumber(Number(value.y) || 0),
      z: roundLayoutNumber(Number(value.z) || 0),
    };
  }
  if (Array.isArray(value)) return value.map((entry) => toSerializableValue(entry, options));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!includeTransient) {
        if (key === "runtimeAssetBounds") continue;
        if (key === "runtimeAssetUrl") {
          const url = String(entry || "");
          if (!url || !url.startsWith("data:")) continue;
        }
        if (key === "runtimeAssetName") {
          const runtimeUrl = String(value.runtimeAssetUrl || "");
          if (!runtimeUrl.startsWith("data:")) continue;
        }
      }
      out[key] = toSerializableValue(entry, options);
    }
    return out;
  }
  return value;
}

function sanitizeNumericField(field, value) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = roundLayoutNumber(Number(value));
  if (!POSITIVE_NUMERIC_FIELDS.has(field)) return numeric;
  return Math.max(0.05, numeric);
}

function vectorFieldKeys() {
  return ["pos", "approach", "perch", "cup", "sitPoint"];
}

const SUPPORTED_ROOM_OBJECT_TYPES = new Set([
  "floor",
  "desk",
  "chair",
  "shelf",
  "platform",
  "windowSill",
  "primitive",
  "model",
  "hamper",
  "trashCan",
  "bed",
  "bedsideTable",
  "rug",
  "wardrobe",
  "bookcase",
  "fishtank",
  "beanbag",
]);

function isSupportedRoomObjectType(type) {
  const normalized = String(type || "").trim();
  return !!normalized && SUPPORTED_ROOM_OBJECT_TYPES.has(normalized);
}

function coerceImportedObjectToSupportedType(sourceObject) {
  const sourceType = String(sourceObject?.type || "").trim();
  if (!sourceType || isSupportedRoomObjectType(sourceType)) return sourceObject;
  const coerced = {
    ...(sourceObject && typeof sourceObject === "object" ? sourceObject : {}),
  };
  if (!coerced.sourceType) coerced.sourceType = sourceType;
  const shapeKind = String(coerced.shapeKind || "").trim();
  const hasPrimitiveHints =
    !!shapeKind ||
    Number.isFinite(Number(coerced.radius)) ||
    Number.isFinite(Number(coerced.centerY));
  if (hasPrimitiveHints) {
    coerced.type = "primitive";
    if (!shapeKind) {
      coerced.shapeKind =
        Number.isFinite(Number(coerced.centerY)) && !Number.isFinite(Number(coerced.height))
          ? "sphere"
          : "box";
    }
    return coerced;
  }
  coerced.type = "model";
  return coerced;
}

function cloneRoomObjectFromTemplate(THREE, template) {
  const serial = toSerializableValue(template || {}, { includeTransient: true });
  const clone = {};
  for (const [key, value] of Object.entries(serial)) {
    if (vectorFieldKeys().includes(key) && value && typeof value === "object") {
      clone[key] = cloneVector3(THREE, value);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

function instantiateRoomObject(THREE, source, templateLayout) {
  const sourceObject = coerceImportedObjectToSupportedType(source && typeof source === "object" ? source : {});
  const templateById = templateLayout?.objectsById || {};
  const templateObjects = Array.isArray(templateLayout?.objects) ? templateLayout.objects : [];
  const fallbackTemplate =
    sourceObject.type === "primitive"
      ? createPrimitiveObject(THREE, { id: sourceObject.id || "primitive", shapeKind: sourceObject.shapeKind || "box" })
      : sourceObject.type === "model"
        ? createModelObject(THREE, { id: sourceObject.id || "model" })
        : {
            id: sourceObject.id || "object",
            type: sourceObject.type || "platform",
            pos: new THREE.Vector3(0, 0, 0),
            visible: true,
            specialFlags: {},
            surface: null,
          };
  const template =
    templateById?.[sourceObject.id] ||
    templateObjects.find((object) => object.type === sourceObject.type) ||
    fallbackTemplate;
  const target = cloneRoomObjectFromTemplate(THREE, template);

  for (const key of vectorFieldKeys()) {
    if (sourceObject[key]) target[key] = cloneVector3(THREE, sourceObject[key]);
  }
  for (const [key, value] of Object.entries(sourceObject)) {
    if (vectorFieldKeys().includes(key) || key === "surface") continue;
    target[key] = value && typeof value === "object" ? toSerializableValue(value, { includeTransient: true }) : value;
  }
  target.visible = target.visible !== false;

  if (sourceObject.surface === null) {
    target.surface = null;
  } else if (sourceObject.surface) {
    if (!target.surface || typeof target.surface !== "object") {
      target.surface = { enabled: true, flags: {}, special: {}, supportOffsets: [], blockerOffsets: [] };
    }
    target.surface.enabled = sourceObject.surface.enabled !== false;
    target.surface.shape = String(sourceObject.surface.shape || target.surface.shape || "rect").toLowerCase();
    target.surface.width = sourceObject.surface.width ?? target.surface.width ?? null;
    target.surface.depth = sourceObject.surface.depth ?? target.surface.depth ?? null;
    target.surface.radius = sourceObject.surface.radius ?? target.surface.radius ?? null;
    target.surface.offsetX = sourceObject.surface.offsetX ?? target.surface.offsetX ?? 0;
    target.surface.offsetZ = sourceObject.surface.offsetZ ?? target.surface.offsetZ ?? 0;
    target.surface.flags = cloneFlags(sourceObject.surface.flags || {});
    target.surface.special = cloneMeta(sourceObject.surface.special || {});
    target.surface.supportOffsets = cloneObstacleList(sourceObject.surface.supportOffsets || []);
    target.surface.blockerOffsets = cloneObstacleList(sourceObject.surface.blockerOffsets || []);
    target.surface.supports = cloneObstacleList(sourceObject.surface.supports || []);
    target.surface.blockers = cloneObstacleList(sourceObject.surface.blockers || []);
  }

  return target;
}

function normalizeQuarterTurns(value) {
  const turns = Math.round(Number(value) || 0);
  return ((turns % 4) + 4) % 4;
}

function getRotatedRectSize(width, depth, rotationRadians = 0) {
  return getRotatedRectAabb(width, depth, rotationRadians);
}

function createDefaultSurfaceConfig({ enabled = false, specialType = "object", shape = null } = {}) {
  return {
    enabled: !!enabled,
    shape: String(shape || createDefaultSurfaceShape(specialType)).toLowerCase(),
    width: null,
    depth: null,
    radius: null,
    offsetX: 0,
    offsetZ: 0,
    flags: {
      randomPatrol: false,
      manualPatrol: true,
      allowCatSpawn: false,
      allowTrashSpawn: false,
      allowLaundrySpawn: false,
      allowCatnip: true,
    },
    special: { type: specialType },
    supportOffsets: [],
    blockerOffsets: [],
    supports: [],
    blockers: [],
  };
}

function createDefaultObstacleConfig({ enabled = false, mode = "soft", jumpIgnoreSurfaceIds = [] } = {}) {
  return {
    enabled: !!enabled,
    mode: mode === "hard" ? "hard" : "soft",
    navPad: mode === "hard" ? 0.02 : 0.03,
    // Recast already bakes the cat radius into the navmesh solve; keep runtime hard
    // blockers close to their actual footprint so corners don't gain a second margin.
    steerPad: mode === "hard" ? 0.005 : 0.01,
    collisionPad: 0,
    jumpIgnoreSurfaceIds: Array.isArray(jumpIgnoreSurfaceIds)
      ? jumpIgnoreSurfaceIds.map((value) => String(value))
      : jumpIgnoreSurfaceIds
        ? [String(jumpIgnoreSurfaceIds)]
        : [],
  };
}

function objectSupportsObstacleSettings(object) {
  return !!object && [
    "desk",
    "chair",
    "shelf",
    "platform",
    "windowSill",
    "primitive",
    "model",
    "hamper",
    "trashCan",
    "bed",
    "bedsideTable",
    "rug",
    "wardrobe",
    "bookcase",
    "fishtank",
    "beanbag",
  ].includes(object.type);
}

function objectSupportsGenericObstacle(object) {
  return !!object && [
    "chair",
    "shelf",
    "platform",
    "windowSill",
    "primitive",
    "model",
    "bed",
    "bedsideTable",
    "rug",
    "wardrobe",
    "bookcase",
  ].includes(object.type);
}

function getDefaultSurfaceSpecialType(object) {
  if (!object) return "object";
  if (object.type === "model") return "model";
  if (object.type === "primitive") return `primitive${String(object.shapeKind || "box")}`;
  return String(object.type || "object");
}

function getDefaultObstacleConfigForObject(object) {
  if (["desk", "hamper", "trashCan", "bed", "bedsideTable", "wardrobe", "bookcase", "fishtank", "beanbag"].includes(object?.type)) {
    return createDefaultObstacleConfig({ enabled: true, mode: "hard" });
  }
  return createDefaultObstacleConfig({ enabled: false, mode: "soft" });
}

function ensureRoomObjectDefaults(object) {
  if (!object || typeof object !== "object") return object;
  object.name = normalizeObjectName(object.name);

  switch (object.type) {
    case "bed":
      if (!Number.isFinite(Number(object.width))) object.width = 2.0;
      if (!Number.isFinite(Number(object.depth))) object.depth = 3.4;
      if (!Number.isFinite(Number(object.height))) object.height = 0.78;
      if (!Number.isFinite(Number(object.surfaceY))) object.surfaceY = 0.44;
      break;
    case "bedsideTable":
      if (!Number.isFinite(Number(object.width))) object.width = 0.58;
      if (!Number.isFinite(Number(object.depth))) object.depth = 0.48;
      if (!Number.isFinite(Number(object.height))) object.height = 0.63;
      if (!Number.isFinite(Number(object.surfaceY))) object.surfaceY = 0.63;
      break;
    case "rug":
      if (!Number.isFinite(Number(object.width))) object.width = 2.2;
      if (!Number.isFinite(Number(object.depth))) object.depth = 3.2;
      if (!Number.isFinite(Number(object.height))) object.height = 0.022;
      if (!Number.isFinite(Number(object.surfaceY))) {
        const posY = Number.isFinite(Number(object.pos?.y)) ? Number(object.pos.y) : 0;
        object.surfaceY = posY + object.height;
      }
      break;
    case "wardrobe":
      if (!Number.isFinite(Number(object.width))) object.width = 1.7;
      if (!Number.isFinite(Number(object.depth))) object.depth = 0.55;
      if (!Number.isFinite(Number(object.height))) object.height = 2.2;
      if (!Number.isFinite(Number(object.surfaceY))) object.surfaceY = object.height;
      break;
    case "bookcase":
      if (!Number.isFinite(Number(object.width))) object.width = 1.1;
      if (!Number.isFinite(Number(object.depth))) object.depth = 0.38;
      if (!Number.isFinite(Number(object.height))) object.height = 1.8;
      if (!Number.isFinite(Number(object.surfaceY))) object.surfaceY = object.height;
      break;
    default:
      break;
  }

  if (objectCanSupportSurface(object) && (!object.surface || typeof object.surface !== "object")) {
    object.surface = createDefaultSurfaceConfig({
      enabled: false,
      shape: object.type === "primitive" && object.shapeKind === "cylinder" ? "circle" : "rect",
      specialType: getDefaultSurfaceSpecialType(object),
    });
  }
  if (objectCanSupportSurface(object) && object.surface && typeof object.surface === "object") {
    const defaults = createDefaultSurfaceConfig({
      enabled: false,
      shape: object.type === "primitive" && object.shapeKind === "cylinder" ? "circle" : "rect",
      specialType: getDefaultSurfaceSpecialType(object),
    });
    object.surface.enabled = object.surface.enabled != null ? !!object.surface.enabled : defaults.enabled;
    object.surface.shape = String(
      object.surface.shape || defaults.shape || createDefaultSurfaceShape(getDefaultSurfaceSpecialType(object))
    ).toLowerCase();
    if (!Number.isFinite(Number(object.surface.width))) object.surface.width = defaults.width;
    if (!Number.isFinite(Number(object.surface.depth))) object.surface.depth = defaults.depth;
    if (!Number.isFinite(Number(object.surface.radius))) object.surface.radius = defaults.radius;
    if (!Number.isFinite(Number(object.surface.offsetX))) object.surface.offsetX = defaults.offsetX;
    if (!Number.isFinite(Number(object.surface.offsetZ))) object.surface.offsetZ = defaults.offsetZ;
    object.surface.flags = {
      ...defaults.flags,
      ...(object.surface.flags && typeof object.surface.flags === "object" ? object.surface.flags : {}),
    };
    object.surface.special = {
      ...defaults.special,
      ...(object.surface.special && typeof object.surface.special === "object" ? object.surface.special : {}),
    };
    object.surface.supportOffsets = Array.isArray(object.surface.supportOffsets) ? object.surface.supportOffsets : [];
    object.surface.blockerOffsets = Array.isArray(object.surface.blockerOffsets) ? object.surface.blockerOffsets : [];
    object.surface.supports = Array.isArray(object.surface.supports) ? object.surface.supports : [];
    object.surface.blockers = Array.isArray(object.surface.blockers) ? object.surface.blockers : [];
  }

  if (objectSupportsObstacleSettings(object)) {
    const defaults = getDefaultObstacleConfigForObject(object);
    if (!object.obstacle || typeof object.obstacle !== "object") {
      object.obstacle = defaults;
    } else {
      object.obstacle.enabled = object.obstacle.enabled != null ? !!object.obstacle.enabled : defaults.enabled;
      object.obstacle.mode = object.obstacle.mode === "hard" ? "hard" : "soft";
      object.obstacle.jumpIgnoreSurfaceIds = Array.isArray(object.obstacle.jumpIgnoreSurfaceIds)
        ? object.obstacle.jumpIgnoreSurfaceIds.map((value) => String(value))
        : object.obstacle.jumpIgnoreSurfaceIds
          ? [String(object.obstacle.jumpIgnoreSurfaceIds)]
          : [];
      if (!Number.isFinite(Number(object.obstacle.navPad))) object.obstacle.navPad = defaults.navPad;
      if (!Number.isFinite(Number(object.obstacle.steerPad))) object.obstacle.steerPad = defaults.steerPad;
      if (!Number.isFinite(Number(object.obstacle.collisionPad))) object.obstacle.collisionPad = defaults.collisionPad;
      // Migrate the previous hard-mode runtime padding default down to the newer value.
      if (
        object.obstacle.mode === "hard" &&
        Number.isFinite(Number(object.obstacle.steerPad)) &&
        Math.abs(Number(object.obstacle.steerPad) - 0.02) <= 1e-6
      ) {
        object.obstacle.steerPad = defaults.steerPad;
      }
    }
  }

  return object;
}

function createPrimitiveObject(THREE, options = {}) {
  const rawShapeKind = String(options.shapeKind || "box");
  const shapeKind = rawShapeKind === "cube" || rawShapeKind === "rectPrism" ? rawShapeKind : rawShapeKind;
  const object = {
    id: String(options.id || "primitive"),
    name: normalizeObjectName(options.name),
    type: "primitive",
    shapeKind,
    pos: cloneVector3(THREE, options.pos || { x: 0, y: 0, z: 0 }),
    rotYDeg: normalizeRotationDegrees(options.rotYDeg ?? ((options.rotQuarterTurns || 0) * 90)),
    rotQuarterTurns: normalizeQuarterTurns(options.rotQuarterTurns ?? getQuarterTurnsFromDegrees(options.rotYDeg ?? 0)),
    visible: options.visible !== false,
    editorLocked: !!options.editorLocked,
    tint: normalizeTintValue(options.tint, true),
    specialFlags: cloneMeta(options.specialFlags || {}),
    obstacle: cloneMeta(options.obstacle || createDefaultObstacleConfig({ enabled: false, mode: "soft" })),
  };

  if (shapeKind === "sphere") {
    object.radius = Number.isFinite(Number(options.radius)) ? Number(options.radius) : 0.45;
    object.centerY = Number.isFinite(Number(options.centerY)) ? Number(options.centerY) : object.radius;
    object.surface = null;
  } else if (shapeKind === "cylinder") {
    object.radius = Number.isFinite(Number(options.radius)) ? Number(options.radius) : 0.45;
    object.height = Number.isFinite(Number(options.height)) ? Number(options.height) : 0.8;
    object.surfaceY = Number.isFinite(Number(options.surfaceY)) ? Number(options.surfaceY) : object.height;
    object.surface = cloneMeta(options.surface || createDefaultSurfaceConfig({ enabled: false, specialType: "primitiveCylinder", shape: "circle" }));
  } else {
    object.width = Number.isFinite(Number(options.width)) ? Number(options.width) : 0.9;
    object.depth = Number.isFinite(Number(options.depth)) ? Number(options.depth) : 0.9;
    object.height = Number.isFinite(Number(options.height)) ? Number(options.height) : 0.9;
    object.surfaceY = Number.isFinite(Number(options.surfaceY)) ? Number(options.surfaceY) : object.height;
    object.surface = cloneMeta(
      options.surface ||
        createDefaultSurfaceConfig({
          enabled: false,
          shape: "rect",
          specialType:
            shapeKind === "triPrism"
              ? "primitiveTriPrism"
              : shapeKind === "cube"
                ? "primitiveCube"
                : shapeKind === "rectPrism"
                  ? "primitiveRectPrism"
                  : "primitiveBox",
        })
    );
  }

  return object;
}

function createModelObject(THREE, options = {}) {
  return {
    id: String(options.id || "model"),
    name: normalizeObjectName(options.name),
    type: "model",
    pos: cloneVector3(THREE, options.pos || { x: 0, y: 0, z: 0 }),
    width: Number.isFinite(Number(options.width)) ? Number(options.width) : 1.0,
    depth: Number.isFinite(Number(options.depth)) ? Number(options.depth) : 1.0,
    height: Number.isFinite(Number(options.height)) ? Number(options.height) : 1.0,
    surfaceY: Number.isFinite(Number(options.surfaceY)) ? Number(options.surfaceY) : (Number.isFinite(Number(options.height)) ? Number(options.height) : 1.0),
    rotYDeg: normalizeRotationDegrees(options.rotYDeg ?? ((options.rotQuarterTurns || 0) * 90)),
    rotQuarterTurns: normalizeQuarterTurns(options.rotQuarterTurns ?? getQuarterTurnsFromDegrees(options.rotYDeg ?? 0)),
    visible: options.visible !== false,
    modelScale: Number.isFinite(Number(options.modelScale)) ? Number(options.modelScale) : 1.0,
    assetPath: String(options.assetPath || ""),
    runtimeAssetUrl: options.runtimeAssetUrl || "",
    runtimeAssetName: options.runtimeAssetName || "",
    editorLocked: !!options.editorLocked,
    tint: normalizeTintValue(options.tint, true),
    specialFlags: cloneMeta(options.specialFlags || {}),
    surface: cloneMeta(options.surface || createDefaultSurfaceConfig({ enabled: false, specialType: "model", shape: "rect" })),
    obstacle: cloneMeta(options.obstacle || createDefaultObstacleConfig({ enabled: false, mode: "soft" })),
  };
}

function getPrimitiveFootprint(object) {
  if (!object) return { width: 1, depth: 1 };
  if (object.shapeKind === "sphere" || object.shapeKind === "cylinder") {
    const diameter = Math.max(0.1, (Number(object.radius) || 0.5) * 2);
    return { width: diameter, depth: diameter };
  }
  return getRotatedRectSize(
    Math.max(0.1, Number(object.width) || 0.9),
    Math.max(0.1, Number(object.depth) || 0.9),
    getObjectRotationRadians(object)
  );
}

function getLayoutObjectLocalFootprint(object) {
  const runtimeModelBounds =
    object?.type === "model" && object.runtimeAssetBounds && typeof object.runtimeAssetBounds === "object"
      ? {
          width: Number(object.runtimeAssetBounds.width),
          depth: Number(object.runtimeAssetBounds.depth),
        }
      : null;
  switch (object?.type) {
    case "floor":
      return { width: Math.max(0.1, Number(object.width) || 0.1), depth: Math.max(0.1, Number(object.depth) || 0.1) };
    case "desk":
    case "chair":
      return { width: Math.max(0.1, Number(object.sizeX) || 0.1), depth: Math.max(0.1, Number(object.sizeZ) || 0.1) };
    case "shelf":
    case "platform":
    case "windowSill":
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      return { width: Math.max(0.1, Number(object.width) || 0.1), depth: Math.max(0.1, Number(object.depth) || 0.1) };
    case "primitive":
      if (object.shapeKind === "sphere" || object.shapeKind === "cylinder") {
        const diameter = Math.max(0.1, (Number(object.radius) || 0.5) * 2);
        return { width: diameter, depth: diameter };
      }
      return {
        width: Math.max(0.1, Number(object.width) || 0.9),
        depth: Math.max(0.1, Number(object.depth) || 0.9),
      };
    case "model":
      return {
        width: Math.max(0.1, Number.isFinite(runtimeModelBounds?.width) ? runtimeModelBounds.width : Number(object.width) || 1),
        depth: Math.max(0.1, Number.isFinite(runtimeModelBounds?.depth) ? runtimeModelBounds.depth : Number(object.depth) || 1),
      };
    case "hamper":
      return { width: object.outerHalfX * 2, depth: object.outerHalfZ * 2 };
    case "trashCan":
      return { width: object.outerRadius * 2, depth: object.outerRadius * 2 };
    default:
      return { width: 1, depth: 1 };
  }
}

function getLayoutObjectFootprint(object) {
  const local = getLayoutObjectLocalFootprint(object);
  const runtimeModelBounds =
    object?.type === "model" && object.runtimeAssetBounds && typeof object.runtimeAssetBounds === "object"
      ? {
          width: Number(object.runtimeAssetBounds.width),
          depth: Number(object.runtimeAssetBounds.depth),
        }
      : null;
  switch (object?.type) {
    case "floor":
      return local;
    case "desk":
    case "chair":
    case "shelf":
    case "platform":
    case "windowSill":
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      return getRotatedRectSize(local.width, local.depth, getObjectRotationRadians(object));
    case "primitive":
      return getPrimitiveFootprint(object);
    case "model":
      return getRotatedRectSize(local.width, local.depth, getObjectRotationRadians(object));
    case "hamper":
      return local;
    case "trashCan":
      return local;
    default:
      return { width: 1, depth: 1 };
  }
}

function getLayoutObjectCenterY(object) {
  const runtimeModelHeight =
    object?.type === "model" && Number.isFinite(Number(object?.runtimeAssetBounds?.height))
      ? Number(object.runtimeAssetBounds.height)
      : null;
  switch (object?.type) {
    case "floor":
      return (Number(object.y) || 0) - 0.1;
    case "desk":
      return Number(object.topY || 0) * 0.5;
    case "chair":
      return (Number(object.seatY || 0) + Number(object.backHeight || 0)) * 0.5;
    case "shelf":
      return Number(object.surfaceY || 0) * 0.5;
    case "platform":
    case "windowSill":
      return Number(object.surfaceY || 0) - Number(object.thickness || 0.08) * 0.5;
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      return Number(object.surfaceY || object.height || 0.9) - Number(object.height || 0.9) * 0.5;
    case "primitive":
      if (object.shapeKind === "sphere") return Number(object.centerY) || Number(object.radius) || 0.45;
      return Number(object.surfaceY || 0) - Number(object.height || 0.8) * 0.5;
    case "model":
      return Number(object.surfaceY || 0) - (Number.isFinite(runtimeModelHeight) ? runtimeModelHeight : Number(object.height) || 1) * 0.5;
    case "hamper":
    case "trashCan":
      return Number(object.rimY || 0) * 0.5;
    default:
      return 0.5;
  }
}

function objectCanSupportSurface(object) {
  if (!object) return false;
  if (["floor", "desk", "chair", "shelf", "platform", "windowSill", "model", "hamper", "trashCan", "bed", "bedsideTable", "rug", "wardrobe", "bookcase", "fishtank","beanbag"].includes(object.type)) return true;
  if (object.type === "primitive") return object.shapeKind !== "sphere";
  return false;
}

export function refreshRoomLayout(layout) {
  if (!layout || typeof layout !== "object") return layout;
  const objects = Array.isArray(layout.objects) ? layout.objects : [];
  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    ensureRoomObjectDefaults(object);
    object.visible = object.visible !== false;
    if (Number.isFinite(Number(object.rotYDeg))) {
      object.rotYDeg = normalizeRotationDegrees(object.rotYDeg);
      object.rotQuarterTurns = getQuarterTurnsFromDegrees(object.rotYDeg);
    } else if (Number.isFinite(Number(object.rotQuarterTurns))) {
      object.rotQuarterTurns = normalizeQuarterTurns(object.rotQuarterTurns);
    }
  }
  layout.objectsById = Object.fromEntries(objects.map((object) => [object.id, object]));
  for (const id of ROOM_LAYOUT_OBJECT_IDS) {
    layout[id] = layout.objectsById?.[id] || null;
  }
  const floor = layout.objectsById?.floor || null;
  if (floor?.pos) {
    const width = Math.max(0.1, Number(floor.width) || 0.1);
    const depth = Math.max(0.1, Number(floor.depth) || 0.1);
    const floorY = Number.isFinite(Number(floor.y)) ? Number(floor.y) : 0;
    layout.roomBounds = {
      ...(layout.roomBounds || {}),
      minX: floor.pos.x - width * 0.5,
      maxX: floor.pos.x + width * 0.5,
      minZ: floor.pos.z - depth * 0.5,
      maxZ: floor.pos.z + depth * 0.5,
      floorY,
    };
  }
  const windowSill = layout.objectsById?.windowSill || null;
  layout.roomShell = {
    ...(layout.roomShell || {}),
    windowOpening: windowSill
      ? {
          centerX: windowSill.pos.x,
          centerY: windowSill.openingCenterY,
          width: windowSill.windowWidth + 0.04,
          height: windowSill.windowHeight + 0.04,
        }
      : null,
  };
  return layout;
}

export function createDefaultRoomLayout(THREE) {
  const roomBounds = {
    minX: -8.0,
    maxX: 6.0,
    minZ: -6.0,
    maxZ: 4.0,
    floorY: 0.0,
  };

  const targetBounds = {
    minX: -5.2,
    maxX: 1.5,
    minZ: -4.9,
    maxZ: 1.7,
    minY: 0.8,
    maxY: 3.2,
  };

  const floor = {
    id: "floor",
    type: "floor",
    pos: new THREE.Vector3(
      (roomBounds.minX + roomBounds.maxX) * 0.5,
      0,
      (roomBounds.minZ + roomBounds.maxZ) * 0.5
    ),
    width: roomBounds.maxX - roomBounds.minX,
    depth: roomBounds.maxZ - roomBounds.minZ,
    y: roomBounds.floorY,
    rotQuarterTurns: 0,
    editorLocked: true,
    tint: "",
    specialFlags: {},
    surface: {
      enabled: true,
      flags: {
        randomPatrol: true,
        manualPatrol: true,
        allowCatSpawn: true,
        allowTrashSpawn: true,
        allowLaundrySpawn: true,
        allowCatnip: true,
      },
      special: { type: "floor" },
      supportOffsets: [],
      blockerOffsets: [],
    },
  };

  const desk = {
    id: "desk",
    type: "desk",
    pos: new THREE.Vector3(-2.4, 0, -2.6),
    sizeX: 1.950,
    sizeZ: 1.550,
    topY: 1.08,
    rotQuarterTurns: 0,
    approach: new THREE.Vector3(-0.8, 0, -1.8),
    perch: new THREE.Vector3(-1.9, 0, -2.3),
    cup: new THREE.Vector3(-0.98, 0, -2.22),
    editorLocked: false,
    tint: "",
    specialFlags: {
      allowCupLoseCondition: true,
    },
    surface: {
      enabled: true,
      flags: {
        randomPatrol: true,
        manualPatrol: true,
        allowCatnip: true,
      },
      special: { type: "desk", cupLoss: true },
      supportOffsets: [
        { dx: -0.88, dz: -0.47, hx: 0.13, hz: 0.13, topY: 1.02, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
        { dx: 0.88, dz: -0.47, hx: 0.13, hz: 0.13, topY: 1.02, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
        { dx: -0.88, dz: 0.47, hx: 0.13, hz: 0.13, topY: 1.02, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
        { dx: 0.88, dz: 0.47, hx: 0.13, hz: 0.13, topY: 1.02, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
      ],
      blockerOffsets: [],
    },
  };

  const chair = {
    id: "chair",
    type: "chair",
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
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {},
    surface: {
      enabled: true,
      flags: {
        randomPatrol: false,
        manualPatrol: true,
        allowCatnip: true,
      },
      special: {},
      supportOffsets: [
        { dx: -0.31, dz: -0.28, hx: 0.08, hz: 0.08, topY: 0.6, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
        { dx: 0.31, dz: -0.28, hx: 0.08, hz: 0.08, topY: 0.6, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
        { dx: -0.31, dz: 0.28, hx: 0.08, hz: 0.08, topY: 0.6, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
        { dx: 0.31, dz: 0.28, hx: 0.08, hz: 0.08, topY: 0.6, mode: "soft", navPad: 0.03, steerPad: 0.01, collisionPad: 0 },
      ],
      blockerOffsets: [
        {
          kind: "box",
          dx: 0,
          dz: -0.39,
          hx: 0.48,
          hz: 0.06,
          y: 1.05,
          h: 0.86,
          navPad: 0.02,
        },
      ],
    },
  };

  const shelf = {
    id: "shelf",
    type: "shelf",
    pos: new THREE.Vector3(-2.7, 0, -5.4),
    width: 2.35,
    depth: 0.92,
    postHalf: 0.045,
    surfaceY: 1.22,
    boardThickness: 0.09,
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {},
    surface: {
      enabled: true,
      flags: {
        randomPatrol: false,
        manualPatrol: true,
        allowCatnip: true,
      },
      special: {},
      supportOffsets: [
        { dx: -(2.35 * 0.5 - 0.045), dz: -(0.92 * 0.5 - 0.045), hx: 0.065, hz: 0.065, topY: 1.13, mode: "soft", navPad: 0.02, steerPad: 0.01, collisionPad: 0 },
        { dx: 2.35 * 0.5 - 0.045, dz: -(0.92 * 0.5 - 0.045), hx: 0.065, hz: 0.065, topY: 1.13, mode: "soft", navPad: 0.02, steerPad: 0.01, collisionPad: 0 },
        { dx: -(2.35 * 0.5 - 0.045), dz: 0.92 * 0.5 - 0.045, hx: 0.065, hz: 0.065, topY: 1.13, mode: "soft", navPad: 0.02, steerPad: 0.01, collisionPad: 0 },
        { dx: 2.35 * 0.5 - 0.045, dz: 0.92 * 0.5 - 0.045, hx: 0.065, hz: 0.065, topY: 1.13, mode: "soft", navPad: 0.02, steerPad: 0.01, collisionPad: 0 },
      ],
      blockerOffsets: [
        {
          kind: "box",
          dx: 0,
          dz: -0.92 * 0.5 + 0.02,
          hx: 2.35 * 0.5 + 0.02,
          hz: 0.04,
          y: (1.22 + 0.2) * 0.5 - 0.09 * 0.5,
          h: 1.22 - 0.2 + 0.12,
          navPad: 0.02,
        },
      ],
    },
  };

  const hoverShelf = {
    id: "hoverShelf",
    type: "platform",
    pos: new THREE.Vector3(0.1, 0, -3.05),
    width: 1.25,
    depth: 0.9,
    surfaceY: desk.topY * 2,
    thickness: 0.08,
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {},
    surface: {
      enabled: true,
      flags: {
        randomPatrol: false,
        manualPatrol: true,
        allowCatnip: true,
      },
      special: { type: "platform" },
      supportOffsets: [],
      blockerOffsets: [],
    },
  };

  const lowerPlatform = {
    id: "lowerPlatform",
    type: "platform",
    pos: new THREE.Vector3(hoverShelf.pos.x, 0, -3.95),
    width: 0.95,
    depth: 0.72,
    surfaceY: hoverShelf.surfaceY,
    thickness: 0.08,
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {},
    surface: {
      enabled: true,
      flags: {
        randomPatrol: false,
        manualPatrol: true,
        allowCatnip: true,
      },
      special: { type: "platform" },
      supportOffsets: [],
      blockerOffsets: [],
    },
  };

  const upperPlatform = {
    id: "upperPlatform",
    type: "platform",
    pos: new THREE.Vector3(lowerPlatform.pos.x, 0, -4.7),
    width: lowerPlatform.width,
    depth: lowerPlatform.depth,
    surfaceY: lowerPlatform.surfaceY + 0.6,
    thickness: lowerPlatform.thickness,
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {},
    surface: {
      enabled: true,
      flags: {
        randomPatrol: false,
        manualPatrol: true,
        allowCatnip: true,
      },
      special: { type: "platform" },
      supportOffsets: [],
      blockerOffsets: [],
    },
  };

  const windowSill = {
    id: "windowSill",
    type: "windowSill",
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
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {
      catGoesToSillOnButtonClick: true,
      windowOpensOnButtonClick: true,
    },
    surface: {
      enabled: true,
      flags: {
        randomPatrol: false,
        manualPatrol: true,
        allowCatnip: true,
      },
      special: { type: "windowSill", windowTarget: true },
      supportOffsets: [],
      blockerOffsets: [],
    },
  };

  const hamper = {
    id: "hamper",
    type: "hamper",
    pos: new THREE.Vector3(-5.8, 0, 2.4),
    outerHalfX: 0.48,
    outerHalfZ: 0.48,
    halfX: 0.45,
    halfZ: 0.45,
    openingHalfX: 0.34,
    openingHalfZ: 0.34,
    rimY: 0.92,
    sinkY: 0.2,
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {
      allowCleanLaundry: true,
    },
    surface: null,
  };

  const trashCan = {
    id: "trashCan",
    type: "trashCan",
    pos: new THREE.Vector3(2.6, 0, 2.4),
    outerRadius: 0.52,
    radius: 0.5,
    openingRadius: 0.42,
    rimY: 0.62,
    sinkY: 0.14,
    modelWidthScale: 1.2,
    rotQuarterTurns: 0,
    editorLocked: false,
    tint: "",
    specialFlags: {
      allowCleanTrash: true,
    },
    surface: null,
  };

   const fishtank = {
    id: "fishtank",
    type: "fishtank",
    pos: new THREE.Vector3(2.2, 0, -3.0),
    width: 1.0,
    depth: 0.45,
    height: 0.65,
    surfaceY: 0.65,
    editorLocked: false,
    tint: "",
    surface: { enabled: false },
  };
  const beanbag = {
    id: "beanbag",
    type: "beanbag",
    pos: new THREE.Vector3(-5.0, 0, 1.5),
    radius: 0.52,
    editorLocked: false,
    tint: "",
    specialFlags: {},
    surface: { enabled: false },
  };

  const objects = [
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
    fishtank,
    "beanbag",
  ];

  const objectsById = Object.fromEntries(objects.map((object) => [object.id, object]));

  const roomShell = {
    windowOpening: {
      centerX: windowSill.pos.x,
      centerY: windowSill.openingCenterY,
      width: windowSill.windowWidth + 0.04,
      height: windowSill.windowHeight + 0.04,
    },
  };

  return refreshRoomLayout({
    roomBounds,
    targetBounds,
    roomShell,
    objects,
    objectsById,
    desk,
    chair,
    shelf,
    hoverShelf,
    lowerPlatform,
    upperPlatform,
    windowSill,
    hamper,
    trashCan,
    fishtank,
    beanbag,
  });
}

function getObjectBaseSurfaceDimensions(object) {
  if (!object) return null;
  const runtimeModelBounds =
    object.type === "model" && object.runtimeAssetBounds && typeof object.runtimeAssetBounds === "object"
      ? {
          width: Number(object.runtimeAssetBounds.width),
          depth: Number(object.runtimeAssetBounds.depth),
        }
      : null;
  switch (object.type) {
    case "floor":
      return { width: Number(object.width) || 0, depth: Number(object.depth) || 0, y: Number(object.y) || 0 };
    case "desk":
      return { width: Number(object.sizeX) || 0, depth: Number(object.sizeZ) || 0, y: Number(object.topY) || 0 };
    case "chair":
      return { width: Number(object.sizeX) || 0, depth: Number(object.sizeZ) || 0, y: Number(object.seatY) || 0 };
    case "shelf":
    case "platform":
    case "windowSill":
      return { width: Number(object.width) || 0, depth: Number(object.depth) || 0, y: Number(object.surfaceY) || 0 };
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      return {
        width: Number(object.width) || 0,
        depth: Number(object.depth) || 0,
        y: Number(object.surfaceY) || Number(object.height) || 0,
      };
    case "hamper":
      return {
        width: Math.max(0.1, Number(object.openingHalfX) || Number(object.outerHalfX) || 0) * 2,
        depth: Math.max(0.1, Number(object.openingHalfZ) || Number(object.outerHalfZ) || 0) * 2,
        y: Number(object.rimY) || 0,
      };
    case "trashCan": {
      const radius = Math.max(0.05, Number(object.openingRadius) || Number(object.outerRadius) || 0);
      return {
        width: radius * 2,
        depth: radius * 2,
        radius,
        y: Number(object.rimY) || 0,
      };
    }
    case "model":
      return {
        width: Number.isFinite(runtimeModelBounds?.width) ? runtimeModelBounds.width : Number(object.width) || 0,
        depth: Number.isFinite(runtimeModelBounds?.depth) ? runtimeModelBounds.depth : Number(object.depth) || 0,
        y: Number(object.surfaceY) || 0,
      };
    case "primitive":
      if (object.shapeKind === "cylinder") {
        const diameter = Math.max(0.1, (Number(object.radius) || 0.45) * 2);
        return { width: diameter, depth: diameter, radius: diameter * 0.5, y: Number(object.surfaceY) || 0 };
      }
      return { width: Number(object.width) || 0, depth: Number(object.depth) || 0, y: Number(object.surfaceY) || 0 };
    default:
      return null;
  }
}

function getObjectSurfaceSupports(object) {
  if (!object?.surface) return { supports: [], blockers: [] };
  const rotation = getObjectRotationRadians(object);
  if (["desk", "chair", "shelf"].includes(object.type)) {
    return {
      supports: materializeRotatedRelativeSpecs(object.pos, object.surface.supportOffsets || [], rotation),
      blockers: materializeRotatedRelativeSpecs(object.pos, object.surface.blockerOffsets || [], rotation),
    };
  }
  return {
    supports: cloneObstacleList(object.surface.supports || []),
    blockers: cloneObstacleList(object.surface.blockers || []),
  };
}

export function buildRoomObjectSurfaceSpec(object) {
  if (!object?.surface?.enabled || !objectCanSupportSurface(object)) return null;
  const base = getObjectBaseSurfaceDimensions(object);
  if (!base || !Number.isFinite(base.y)) return null;
  const center = getObjectSurfaceCenter(object);
  const yaw = getObjectRotationRadians(object);
  const supports = getObjectSurfaceSupports(object);
  const surfaceShape = getObjectSurfaceShape(object);
  const surfaceY = base.y + (object.type === "floor" ? 0 : 0.02);
  const width = Math.max(0.05, Number(object.surface?.width) || Number(base.width) || 0.05);
  const depth = Math.max(0.05, Number(object.surface?.depth) || Number(base.depth) || 0.05);
  const radius = Math.max(
    0.05,
    Number(object.surface?.radius) || Number(base.radius) || Math.min(width, depth) * 0.5
  );
  return buildSurfaceSpec(
    object.id,
    object.id,
    surfaceShape === "circle"
      ? {
          shape: "circle",
          centerX: center.x,
          centerZ: center.z,
          radius,
          y: surfaceY,
        }
      : {
          shape: Math.abs(yaw) > 1e-6 ? "obb" : "rect",
          centerX: center.x,
          centerZ: center.z,
          width,
          depth,
          yaw,
          y: surfaceY,
        },
    {
      ...object.surface,
      supports: supports.supports,
      blockers: supports.blockers,
    }
  );
}

function buildObjectObstacleSpec(object) {
  const obstacle = object?.obstacle;
  if (!object || !obstacle?.enabled) return null;
  const mode = obstacle.mode === "hard" ? "hard" : "soft";
  const jumpIgnoreSurfaceIds = new Set(
    Array.isArray(obstacle.jumpIgnoreSurfaceIds)
      ? obstacle.jumpIgnoreSurfaceIds.map((value) => String(value))
      : obstacle.jumpIgnoreSurfaceIds
        ? [String(obstacle.jumpIgnoreSurfaceIds)]
        : []
  );
  if (object.surface?.enabled && object.id) jumpIgnoreSurfaceIds.add(String(object.id));
  const base = {
    mode,
    tag: "layoutObject",
    surfaceId: object.id,
    jumpIgnoreSurfaceIds: Array.from(jumpIgnoreSurfaceIds),
    navPad: Number.isFinite(Number(obstacle.navPad)) ? Number(obstacle.navPad) : (mode === "hard" ? 0.02 : 0.03),
    steerPad: Number.isFinite(Number(obstacle.steerPad)) ? Number(obstacle.steerPad) : (mode === "hard" ? 0.005 : 0.01),
    collisionPad: Number.isFinite(Number(obstacle.collisionPad)) ? Number(obstacle.collisionPad) : 0,
    blocksRuntime: mode === "hard",
    blocksPath: true,
    pushable: false,
  };
  const centerY = getLayoutObjectCenterY(object);
  if (object.type === "primitive" && (object.shapeKind === "sphere" || object.shapeKind === "cylinder")) {
    const radius = Math.max(0.05, Number(object.radius) || 0.45);
    const height = object.shapeKind === "sphere" ? radius * 2 : Math.max(0.05, Number(object.height) || radius * 2);
    return {
      ...base,
      kind: "circle",
      x: object.pos.x,
      z: object.pos.z,
      y: centerY,
      h: height,
      r: radius,
    };
  }
  const runtimeModelBounds =
    object.type === "model" && object.runtimeAssetBounds && typeof object.runtimeAssetBounds === "object"
      ? {
          width: Number(object.runtimeAssetBounds.width),
          depth: Number(object.runtimeAssetBounds.depth),
          height: Number(object.runtimeAssetBounds.height),
        }
      : null;
  const footprint =
    object.type === "model"
      ? {
          width: Math.max(
            0.1,
            Number.isFinite(runtimeModelBounds?.width) ? runtimeModelBounds.width : Number(object.width) || 1
          ),
          depth: Math.max(
            0.1,
            Number.isFinite(runtimeModelBounds?.depth) ? runtimeModelBounds.depth : Number(object.depth) || 1
          ),
        }
      : object.type === "primitive" && object.shapeKind !== "sphere" && object.shapeKind !== "cylinder"
        ? {
            width: Math.max(0.1, Number(object.width) || 0.9),
            depth: Math.max(0.1, Number(object.depth) || 0.9),
          }
        : getLayoutObjectFootprint(object);
  const localFootprint = getLayoutObjectLocalFootprint(object);
  const height = object.type === "primitive" || object.type === "model"
    ? Math.max(
        0.05,
        object.type === "model" && Number.isFinite(runtimeModelBounds?.height)
          ? runtimeModelBounds.height
          : Number(object.height) || 0.9
      )
    : ["bed", "bedsideTable", "rug", "wardrobe", "bookcase"].includes(object.type)
      ? Math.max(0.05, Number(object.height) || 0.9)
    : Math.max(0.05, Number(object.topY || object.surfaceY || object.rimY || 0.9));
  const yaw = getObjectRotationRadians(object);
  return {
    ...base,
    kind: Math.abs(yaw) > 1e-4 ? "obb" : "box",
    x: object.pos.x,
    z: object.pos.z,
    y: centerY,
    h: height,
    hx: Math.max(0.05, localFootprint.width * 0.5),
    hz: Math.max(0.05, localFootprint.depth * 0.5),
    yaw,
  };
}

function buildStaticBoxFromObstacle(obstacle) {
  if (!obstacle) return null;
  if (obstacle.kind === "circle") {
    const radius = Math.max(0.05, Number(obstacle.r) || 0.05);
    return {
      x: obstacle.x,
      y: obstacle.y,
      z: obstacle.z,
      hx: radius,
      hy: Math.max(0.025, Number(obstacle.h || 0.05) * 0.5),
      hz: radius,
      rotY: 0,
    };
  }
  return {
    x: obstacle.x,
    y: obstacle.y,
    z: obstacle.z,
    hx: Math.max(0.05, Number(obstacle.hx) || 0.05),
    hy: Math.max(0.025, Number(obstacle.h || 0.05) * 0.5),
    hz: Math.max(0.05, Number(obstacle.hz) || 0.05),
    rotY: Number.isFinite(Number(obstacle.yaw)) ? Number(obstacle.yaw) : 0,
  };
}

export function buildFloorSurfaceSpec(layout) {
  const floor = layout?.floor || layout?.objectsById?.floor || null;
  return buildRoomObjectSurfaceSpec(floor);
}

export function buildRoomSurfaceSpecs(layout) {
  const objects = Array.isArray(layout?.objects) ? layout.objects : [];
  const specs = [];
  for (const object of objects) {
    if (object?.type === "floor") continue;
    const spec = buildRoomObjectSurfaceSpec(object);
    if (spec) specs.push(spec);
  }
  return specs;
}

export function buildRoomDerivedData(layout) {
  const desk = layout?.desk || layout?.objectsById?.desk || null;
  const chair = layout?.chair || layout?.objectsById?.chair || null;
  const shelf = layout?.shelf || layout?.objectsById?.shelf || null;
  const objects = Array.isArray(layout?.objects) ? layout.objects : [];
  const extraNavObstacles = [];
  const extraStaticBoxes = [];
  for (const object of objects) {
    if (!object || !objectSupportsGenericObstacle(object)) continue;
    const obstacle = buildObjectObstacleSpec(object);
    if (!obstacle) continue;
    extraNavObstacles.push(obstacle);
    const staticBox = buildStaticBoxFromObstacle(obstacle);
    if (staticBox) extraStaticBoxes.push(staticBox);
  }
  return {
    deskLegs: desk?.obstacle?.enabled ? buildDeskLegs(desk) : [],
    chairLegs: chair ? buildChairLegs(chair) : [],
    chairBackCollider: chair ? buildChairBackCollider(chair) : null,
    shelfPosts: shelf ? buildShelfPosts(shelf) : [],
    shelfBackCollider: shelf ? buildShelfBackCollider(shelf) : null,
    extraNavObstacles,
    extraStaticBoxes,
  };
}

export function cloneRoomLayoutData(THREE, layout) {
  if (!layout) return null;
  return createRoomLayoutFromData(THREE, serializeRoomLayoutData(layout, { includeTransient: true }));
}

export function serializeRoomLayoutData(layout, options = {}) {
  if (!layout) return null;
  const includeTransient = !!options.includeTransient;
  return {
    roomBounds: toSerializableValue(layout.roomBounds || {}, { includeTransient }),
    targetBounds: toSerializableValue(layout.targetBounds || {}, { includeTransient }),
    objects: Array.isArray(layout.objects)
      ? layout.objects.map((object) => toSerializableValue(object, { includeTransient }))
      : [],
  };
}

export function createRoomLayoutFromData(THREE, data) {
  const source = data && typeof data === "object" ? data : {};
  const templateLayout = createDefaultRoomLayout(THREE);
  const sourceObjects = Array.isArray(source.objects) && source.objects.length
    ? source.objects
    : templateLayout.objects.map((object) => toSerializableValue(object));
  const hasFloor = sourceObjects.some((object) => object && object.id === "floor");
  const finalObjects = hasFloor
    ? sourceObjects
    : [toSerializableValue(templateLayout.floor), ...sourceObjects];
  const layout = {
    roomBounds: { ...(templateLayout.roomBounds || {}) },
    targetBounds: { ...(templateLayout.targetBounds || {}) },
    roomShell: { ...(templateLayout.roomShell || {}) },
    objects: finalObjects.map((object) => instantiateRoomObject(THREE, object, templateLayout)),
  };
  if (source.roomBounds && typeof source.roomBounds === "object") {
    Object.assign(layout.roomBounds, source.roomBounds);
  }
  if (source.targetBounds && typeof source.targetBounds === "object") {
    Object.assign(layout.targetBounds, source.targetBounds);
  }
  return refreshRoomLayout(layout);
}

export function moveRoomObject(layout, objectId, nextX, nextZ) {
  const object = layout?.objectsById?.[objectId];
  if (!object?.pos) return null;
  const x = roundLayoutNumber(Number(nextX));
  const z = roundLayoutNumber(Number(nextZ));
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const dx = x - object.pos.x;
  const dz = z - object.pos.z;
  object.pos.set(x, object.pos.y, z);
  for (const key of ["approach", "perch", "cup", "sitPoint"]) {
    const value = object[key];
    if (value && typeof value.set === "function") {
      value.set(
        roundLayoutNumber(value.x + dx),
        roundLayoutNumber(value.y),
        roundLayoutNumber(value.z + dz)
      );
    }
  }
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectNumericField(layout, objectId, field, rawValue) {
  const object = layout?.objectsById?.[objectId];
  if (!object || typeof field !== "string") return null;
  if (field === "x") return moveRoomObject(layout, objectId, rawValue, object.pos?.z ?? 0);
  if (field === "z") return moveRoomObject(layout, objectId, object.pos?.x ?? 0, rawValue);
  if (field === "y") {
    if (!object.pos || typeof object.pos.set !== "function") return null;
    const numeric = roundLayoutNumber(Number(rawValue));
    if (!Number.isFinite(numeric)) return null;
    object.pos.set(object.pos.x, numeric, object.pos.z);
    return refreshRoomLayout(layout).objectsById?.[objectId] || null;
  }
  if (!Object.prototype.hasOwnProperty.call(object, field)) return null;
  const numeric = sanitizeNumericField(field, rawValue);
  if (numeric == null) return null;
  object[field] = numeric;
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectSurfaceEnabled(layout, objectId, enabled) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  if (!object.surface) {
    if (!objectCanSupportSurface(object)) return null;
    object.surface = createDefaultSurfaceConfig({
      enabled: false,
      shape: object.type === "primitive" && object.shapeKind === "cylinder" ? "circle" : "rect",
      specialType: getDefaultSurfaceSpecialType(object),
    });
  }
  object.surface.enabled = Boolean(enabled);
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectSurfaceShape(layout, objectId, rawShape) {
  const object = layout?.objectsById?.[objectId];
  if (!object || !objectCanSupportSurface(object)) return null;
  if (!object.surface || typeof object.surface !== "object") {
    object.surface = createDefaultSurfaceConfig({
      enabled: false,
      shape: rawShape,
      specialType: getDefaultSurfaceSpecialType(object),
    });
  }
  object.surface.shape = String(rawShape || "rect").toLowerCase() === "circle" ? "circle" : "rect";
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectSurfaceNumericField(layout, objectId, field, rawValue) {
  const object = layout?.objectsById?.[objectId];
  if (!object || !objectCanSupportSurface(object)) return null;
  if (!object.surface || typeof object.surface !== "object") {
    object.surface = createDefaultSurfaceConfig({
      enabled: false,
      specialType: getDefaultSurfaceSpecialType(object),
    });
  }
  const numeric = roundLayoutNumber(Number(rawValue));
  if (!Number.isFinite(numeric)) return null;
  const positiveFields = new Set(["width", "depth", "radius"]);
  object.surface[field] = positiveFields.has(field) ? Math.max(0.05, numeric) : numeric;
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectFlag(layout, objectId, flagName, enabled) {
  const object = layout?.objectsById?.[objectId];
  if (!object || !flagName || !objectCanSupportSurface(object)) return null;
  if (!object.surface || typeof object.surface !== "object") {
    object.surface = createDefaultSurfaceConfig({
      enabled: false,
      shape: object.type === "primitive" && object.shapeKind === "cylinder" ? "circle" : "rect",
      specialType: getDefaultSurfaceSpecialType(object),
    });
  }
  if (!object.surface.flags || typeof object.surface.flags !== "object") object.surface.flags = {};
  object.surface.flags[flagName] = Boolean(enabled);
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectEditorLocked(layout, objectId, locked) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  object.editorLocked = Boolean(locked);
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectVisible(layout, objectId, visible) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  object.visible = Boolean(visible);
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectSpecialFlag(layout, objectId, flagName, enabled) {
  const object = layout?.objectsById?.[objectId];
  if (!object || !flagName) return null;
  if (!object.specialFlags || typeof object.specialFlags !== "object") object.specialFlags = {};
  object.specialFlags[flagName] = Boolean(enabled);
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectStringField(layout, objectId, field, rawValue) {
  const object = layout?.objectsById?.[objectId];
  if (!object || typeof field !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(object, field) && field !== "tint" && field !== "name") return null;
  object[field] = field === "tint"
    ? normalizeTintValue(rawValue)
    : field === "name"
      ? normalizeObjectName(rawValue)
      : String(rawValue ?? "");
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectRuntimeAsset(layout, objectId, { url = "", name = "" } = {}) {
  const object = layout?.objectsById?.[objectId];
  if (!object || object.type !== "model") return null;
  object.runtimeAssetUrl = String(url || "");
  object.runtimeAssetName = String(name || "");
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function calibrateRoomObjectDimensionsFromRuntimeBounds(layout, objectId) {
  const object = layout?.objectsById?.[objectId];
  if (!object || !object.runtimeAssetBounds || typeof object.runtimeAssetBounds !== "object") {
    return null;
  }
  const width = Math.max(0.05, Number(object.runtimeAssetBounds.width) || 0);
  const depth = Math.max(0.05, Number(object.runtimeAssetBounds.depth) || 0);
  const height = Math.max(0.05, Number(object.runtimeAssetBounds.height) || 0);
  if (![width, depth, height].every(Number.isFinite)) return null;
  switch (object.type) {
    case "model":
      object.width = roundLayoutNumber(width);
      object.depth = roundLayoutNumber(depth);
      object.height = roundLayoutNumber(height);
      object.surfaceY = roundLayoutNumber(height);
      object.modelScale = 1;
      break;
    case "primitive":
      if (["sphere", "cylinder"].includes(String(object.shapeKind || "").toLowerCase())) return null;
      object.width = roundLayoutNumber(width);
      object.depth = roundLayoutNumber(depth);
      object.height = roundLayoutNumber(height);
      object.surfaceY = roundLayoutNumber(height);
      break;
    case "desk":
      object.sizeX = roundLayoutNumber(width);
      object.sizeZ = roundLayoutNumber(depth);
      object.topY = roundLayoutNumber(height);
      break;
    case "chair": {
      const prevSeatY = Math.max(0.05, Number(object.seatY) || 0.45);
      const prevBackHeight = Math.max(0.05, Number(object.backHeight) || 0.5);
      const prevTotal = Math.max(0.1, prevSeatY + prevBackHeight);
      const seatRatio = Math.min(0.8, Math.max(0.18, prevSeatY / prevTotal));
      const seatY = Math.max(0.05, height * seatRatio);
      object.sizeX = roundLayoutNumber(width);
      object.sizeZ = roundLayoutNumber(depth);
      object.seatY = roundLayoutNumber(seatY);
      object.backHeight = roundLayoutNumber(Math.max(0.05, height - seatY));
      break;
    }
    case "shelf": {
      const boardThickness = Math.max(0.02, Number(object.boardThickness) || 0.08);
      object.width = roundLayoutNumber(width);
      object.depth = roundLayoutNumber(depth);
      object.surfaceY = roundLayoutNumber(Math.max(0.05, height - boardThickness));
      break;
    }
    case "platform":
    case "windowSill": {
      const thickness = Math.max(0.02, Number(object.thickness) || 0.08);
      object.width = roundLayoutNumber(width);
      object.depth = roundLayoutNumber(depth);
      object.surfaceY = roundLayoutNumber(Math.max(0.05, height - thickness));
      break;
    }
    case "bed":
    case "bedsideTable":
    case "rug":
    case "wardrobe":
    case "bookcase":
      object.width = roundLayoutNumber(width);
      object.depth = roundLayoutNumber(depth);
      object.height = roundLayoutNumber(height);
      object.surfaceY = roundLayoutNumber(height);
      break;
    case "hamper":
      object.outerHalfX = roundLayoutNumber(width * 0.5);
      object.outerHalfZ = roundLayoutNumber(depth * 0.5);
      object.rimY = roundLayoutNumber(height);
      break;
    case "trashCan": {
      const outerRadius = Math.max(0.05, Math.min(width, depth) * 0.5);
      const previousOuterRadius = Math.max(0.05, Number(object.outerRadius) || outerRadius);
      const openingRatio = Math.min(
        0.98,
        Math.max(0.45, (Number(object.openingRadius) || outerRadius * 0.85) / previousOuterRadius)
      );
      object.outerRadius = roundLayoutNumber(outerRadius);
      object.openingRadius = roundLayoutNumber(Math.max(0.04, outerRadius * openingRatio));
      object.rimY = roundLayoutNumber(height);
      break;
    }
    default:
      return null;
  }
  if (object.surface && typeof object.surface === "object") {
    if (String(object.surface.shape || "rect").toLowerCase() === "circle") {
      object.surface.radius = roundLayoutNumber(Math.min(width, depth) * 0.5);
    } else {
      object.surface.width = roundLayoutNumber(width);
      object.surface.depth = roundLayoutNumber(depth);
    }
  }
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectObstacleEnabled(layout, objectId, enabled) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  if (!object.obstacle || typeof object.obstacle !== "object") {
    object.obstacle = getDefaultObstacleConfigForObject(object);
  }
  object.obstacle.enabled = Boolean(enabled);
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectObstacleMode(layout, objectId, mode) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  if (!object.obstacle || typeof object.obstacle !== "object") {
    object.obstacle = getDefaultObstacleConfigForObject(object);
  }
  const prevMode = object.obstacle.mode === "hard" ? "hard" : "soft";
  const nextMode = mode === "hard" ? "hard" : "soft";
  const prevDefaults = createDefaultObstacleConfig({ enabled: !!object.obstacle.enabled, mode: prevMode });
  const nextDefaults = createDefaultObstacleConfig({ enabled: !!object.obstacle.enabled, mode: nextMode });
  object.obstacle.mode = nextMode;
  if (
    !Number.isFinite(Number(object.obstacle.navPad)) ||
    Math.abs(Number(object.obstacle.navPad) - prevDefaults.navPad) <= 1e-6
  ) {
    object.obstacle.navPad = nextDefaults.navPad;
  }
  if (
    !Number.isFinite(Number(object.obstacle.steerPad)) ||
    Math.abs(Number(object.obstacle.steerPad) - prevDefaults.steerPad) <= 1e-6 ||
    (prevMode === "hard" && Math.abs(Number(object.obstacle.steerPad) - 0.02) <= 1e-6)
  ) {
    object.obstacle.steerPad = nextDefaults.steerPad;
  }
  if (!Number.isFinite(Number(object.obstacle.collisionPad))) {
    object.obstacle.collisionPad = nextDefaults.collisionPad;
  }
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function setRoomObjectObstacleIgnoreSurfaceIds(layout, objectId, rawValue) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  if (!object.obstacle || typeof object.obstacle !== "object") {
    object.obstacle = getDefaultObstacleConfigForObject(object);
  }
  const values = String(rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  object.obstacle.jumpIgnoreSurfaceIds = values;
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function rotateRoomObjectQuarterTurns(layout, objectId, deltaTurns = 1) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  return setRoomObjectRotationDegrees(layout, objectId, getObjectRotationDegrees(object) + deltaTurns * 90);
}

export function setRoomObjectQuarterTurns(layout, objectId, quarterTurns = 0) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  return setRoomObjectRotationDegrees(layout, objectId, normalizeQuarterTurns(quarterTurns) * 90);
}

export function setRoomObjectRotationDegrees(layout, objectId, degrees = 0) {
  const object = layout?.objectsById?.[objectId];
  if (!object) return null;
  const currentRadians = getObjectRotationRadians(object);
  const nextDegrees = getQuarterTurnsFromDegrees(degrees) * 90;
  const nextRadians = degreesToRadians(nextDegrees);
  const delta = nextRadians - currentRadians;
  object.rotYDeg = nextDegrees;
  object.rotQuarterTurns = getQuarterTurnsFromDegrees(nextDegrees);
  for (const key of ["approach", "perch", "cup", "sitPoint"]) {
    rotatePointAroundCenterXZ(object[key], object.pos, delta);
  }
  return refreshRoomLayout(layout).objectsById?.[objectId] || null;
}

export function addRoomObjectFromType(THREE, layout, type, options = {}) {
  const templateLayout = createDefaultRoomLayout(THREE);
  const template = templateLayout.objects.find((object) => object.type === type);
  if (!template || type === "floor" || type === "windowSill" || type === "desk") return null;
  const clone = cloneRoomObjectFromTemplate(THREE, template);
  const baseId = String(options.idBase || type || "object").replace(/\s+/g, "");
  let suffix = 1;
  let nextId = `${baseId}${suffix}`;
  while (layout?.objectsById?.[nextId]) {
    suffix += 1;
    nextId = `${baseId}${suffix}`;
  }
  clone.id = nextId;
  if (clone.pos) {
    clone.pos.set(
      Number.isFinite(Number(options.x)) ? Number(options.x) : clone.pos.x,
      clone.pos.y,
      Number.isFinite(Number(options.z)) ? Number(options.z) : clone.pos.z
    );
  }
  clone.editorLocked = false;
  layout.objects.push(clone);
  return refreshRoomLayout(layout).objectsById?.[nextId] || null;
}

export function addPrimitiveRoomObject(THREE, layout, shapeKind, options = {}) {
  const baseId = String(options.idBase || shapeKind || "shape").replace(/\s+/g, "");
  let suffix = 1;
  let nextId = `${baseId}${suffix}`;
  while (layout?.objectsById?.[nextId]) {
    suffix += 1;
    nextId = `${baseId}${suffix}`;
  }

  let object = null;
  const x = Number.isFinite(Number(options.x)) ? Number(options.x) : 0;
  const z = Number.isFinite(Number(options.z)) ? Number(options.z) : 0;
  switch (String(shapeKind || "box")) {
    case "sphere":
      object = createPrimitiveObject(THREE, {
        id: nextId,
        shapeKind: "sphere",
        pos: { x, y: 0, z },
        radius: 0.45,
        centerY: 0.45,
      });
      break;
    case "cylinder":
      object = createPrimitiveObject(THREE, {
        id: nextId,
        shapeKind: "cylinder",
        pos: { x, y: 0, z },
        radius: 0.42,
        height: 0.9,
        surfaceY: 0.9,
      });
      break;
    case "triPrism":
      object = createPrimitiveObject(THREE, {
        id: nextId,
        shapeKind: "triPrism",
        pos: { x, y: 0, z },
        width: 0.95,
        depth: 0.85,
        height: 0.9,
        surfaceY: 0.9,
      });
      break;
    case "rectPrism":
      object = createPrimitiveObject(THREE, {
        id: nextId,
        shapeKind: "rectPrism",
        pos: { x, y: 0, z },
        width: 1.2,
        depth: 0.8,
        height: 0.9,
        surfaceY: 0.9,
      });
      break;
    case "cube":
      object = createPrimitiveObject(THREE, {
        id: nextId,
        shapeKind: "cube",
        pos: { x, y: 0, z },
        width: 0.9,
        depth: 0.9,
        height: 0.9,
        surfaceY: 0.9,
      });
      break;
    default:
      object = createPrimitiveObject(THREE, {
        id: nextId,
        shapeKind: "box",
        pos: { x, y: 0, z },
        width: 0.9,
        depth: 0.9,
        height: 0.9,
        surfaceY: 0.9,
      });
      break;
  }

  layout.objects.push(object);
  return refreshRoomLayout(layout).objectsById?.[nextId] || null;
}

export function addModelRoomObject(THREE, layout, options = {}) {
  const baseId = String(options.idBase || "model").replace(/\s+/g, "");
  let suffix = 1;
  let nextId = `${baseId}${suffix}`;
  while (layout?.objectsById?.[nextId]) {
    suffix += 1;
    nextId = `${baseId}${suffix}`;
  }
  const object = createModelObject(THREE, {
    id: nextId,
    pos: {
      x: Number.isFinite(Number(options.x)) ? Number(options.x) : 0,
      y: 0,
      z: Number.isFinite(Number(options.z)) ? Number(options.z) : 0,
    },
    width: 1.0,
    depth: 1.0,
    height: 1.0,
    surfaceY: 1.0,
    assetPath: String(options.assetPath || ""),
  });
  layout.objects.push(object);
  return refreshRoomLayout(layout).objectsById?.[nextId] || null;
}

export function roomObjectSupportsObstacleSettings(object) {
  return objectSupportsObstacleSettings(object);
}

export function roomObjectSupportsSurface(object) {
  return objectCanSupportSurface(object);
}

export function getRoomObjectDisplayName(object) {
  if (!object) return "";
  const name = normalizeObjectName(object.name);
  return name || String(object.id || object.type || "object");
}

export function duplicateRoomObject(THREE, layout, objectId, nextId, options = {}) {
  const source = layout?.objectsById?.[objectId] || null;
  const candidateId = String(nextId || "").trim();
  if (!source || !candidateId || layout?.objectsById?.[candidateId]) return null;
  if (!["chair", "shelf", "platform", "primitive", "model", "bed", "bedsideTable", "rug", "wardrobe", "bookcase"].includes(source.type)) return null;

  const clone = instantiateRoomObject(THREE, toSerializableValue(source), createDefaultRoomLayout(THREE));
  clone.id = candidateId;
  clone.editorLocked = false;
  if (clone.pos) {
    const offsetX = Number.isFinite(Number(options.offsetX)) ? Number(options.offsetX) : 0.45;
    const offsetZ = Number.isFinite(Number(options.offsetZ)) ? Number(options.offsetZ) : 0.45;
    clone.pos.set(clone.pos.x + offsetX, clone.pos.y, clone.pos.z + offsetZ);
  }
  layout.objects.push(clone);
  return refreshRoomLayout(layout).objectsById?.[candidateId] || null;
}

export function removeRoomObject(layout, objectId) {
  if (!layout || !Array.isArray(layout.objects)) return false;
  const idx = layout.objects.findIndex((object) => object?.id === objectId);
  if (idx < 0) return false;
  layout.objects.splice(idx, 1);
  refreshRoomLayout(layout);
  return true;
}
