function normalizeRect(bounds = {}) {
  const minX = Number(bounds.minX);
  const maxX = Number(bounds.maxX);
  const minZ = Number(bounds.minZ);
  const maxZ = Number(bounds.maxZ);
  return { minX, maxX, minZ, maxZ };
}

function cloneMeta(meta) {
  return meta && typeof meta === "object" ? { ...meta } : {};
}

function normalizeObstacle(spec, defaults = {}) {
  if (!spec || typeof spec !== "object") return null;
  const kind = spec.kind === "circle" ? "circle" : spec.kind === "obb" ? "obb" : "box";
  const out = {
    kind,
    x: Number(spec.x),
    z: Number(spec.z),
    y: Number(spec.y),
    h: Number(spec.h),
    navPad: Number.isFinite(Number(spec.navPad)) ? Number(spec.navPad) : (defaults.navPad ?? 0),
    steerPad: Number.isFinite(Number(spec.steerPad)) ? Number(spec.steerPad) : (defaults.steerPad ?? defaults.navPad ?? 0),
    collisionPad: Number.isFinite(Number(spec.collisionPad)) ? Number(spec.collisionPad) : (defaults.collisionPad ?? 0),
    mode: spec.mode || defaults.mode,
    tag: spec.tag || defaults.tag || "",
  };
  if (spec.blocksRuntime != null) out.blocksRuntime = !!spec.blocksRuntime;
  else if (defaults.blocksRuntime != null) out.blocksRuntime = !!defaults.blocksRuntime;
  if (spec.blocksPath != null) out.blocksPath = !!spec.blocksPath;
  else if (defaults.blocksPath != null) out.blocksPath = !!defaults.blocksPath;
  if (spec.pushable != null) out.pushable = !!spec.pushable;
  else if (defaults.pushable != null) out.pushable = !!defaults.pushable;
  if (kind === "circle") {
    out.r = Number(spec.r);
  } else {
    out.hx = Number(spec.hx);
    out.hz = Number(spec.hz);
    if (kind === "obb") out.yaw = Number.isFinite(Number(spec.yaw)) ? Number(spec.yaw) : 0;
  }
  if (spec.surfaceId != null) out.surfaceId = String(spec.surfaceId);
  if (defaults.surfaceId != null && out.surfaceId == null) out.surfaceId = String(defaults.surfaceId);
  if (spec.jumpIgnoreSurfaceIds != null) {
    out.jumpIgnoreSurfaceIds = Array.isArray(spec.jumpIgnoreSurfaceIds)
      ? spec.jumpIgnoreSurfaceIds.map((v) => String(v))
      : [String(spec.jumpIgnoreSurfaceIds)];
  } else if (defaults.jumpIgnoreSurfaceIds) {
    out.jumpIgnoreSurfaceIds = Array.isArray(defaults.jumpIgnoreSurfaceIds)
      ? defaults.jumpIgnoreSurfaceIds.map((v) => String(v))
      : [String(defaults.jumpIgnoreSurfaceIds)];
  }
  return out;
}

function normalizeSurfaceFlags(spec, floorLike) {
  const rawFlags = spec && typeof spec.flags === "object" && spec.flags ? spec.flags : {};
  const pickFlag = (primaryKey, legacyValue, defaultValue = false) => {
    if (rawFlags[primaryKey] != null) return !!rawFlags[primaryKey];
    if (legacyValue != null) return !!legacyValue;
    return !!defaultValue;
  };
  const flags = {
    randomPatrol: pickFlag("randomPatrol", spec?.randomPatrol, false),
    manualPatrol: pickFlag("manualPatrol", spec?.manualPatrol != null ? spec.manualPatrol : true, true),
    allowCatSpawn: pickFlag("allowCatSpawn", spec?.startSurface, false),
    allowTrashSpawn: pickFlag("allowTrashSpawn", spec?.spawnTrash, false),
    allowLaundrySpawn: pickFlag("allowLaundrySpawn", spec?.spawnLaundry, false),
    allowCatnip: pickFlag("allowCatnip", spec?.allowCatnip != null ? spec.allowCatnip : true, true),
    floorLike: pickFlag("floorLike", floorLike, floorLike),
  };
  for (const [key, value] of Object.entries(rawFlags)) {
    if (flags[key] != null) continue;
    flags[key] = !!value;
  }
  return flags;
}

function normalizeAssociatedObjectIds(spec) {
  const source = spec?.associatedObjectIds ?? spec?.associatedObjects ?? spec?.objectIds;
  if (source == null) return [];
  const values = Array.isArray(source) ? source : [source];
  return values.map((value) => String(value)).filter(Boolean);
}

function normalizeSurfaceSpec(spec, floorY) {
  if (!spec || typeof spec !== "object") return null;
  const id = String(spec.id || spec.name || "").trim();
  if (!id) return null;
  const rect = normalizeRect(spec);
  const y = Number(spec.y);
  if (![rect.minX, rect.maxX, rect.minZ, rect.maxZ, y].every(Number.isFinite)) return null;
  const floorLike = Math.abs(y - floorY) <= 0.04;
  const flags = normalizeSurfaceFlags(spec, floorLike);
  const surface = {
    id,
    name: String(spec.name || id),
    minX: rect.minX,
    maxX: rect.maxX,
    minZ: rect.minZ,
    maxZ: rect.maxZ,
    y,
    floorLike: !!flags.floorLike,
    randomPatrol: !!flags.randomPatrol,
    manualPatrol: !!flags.manualPatrol,
    startSurface: !!flags.allowCatSpawn,
    spawnTrash: !!flags.allowTrashSpawn,
    spawnLaundry: !!flags.allowLaundrySpawn,
    allowCatnip: !!flags.allowCatnip,
    flags,
    associatedObjectIds: normalizeAssociatedObjectIds(spec),
    special: cloneMeta(spec.special),
    supports: [],
    blockers: [],
  };

  const supports = Array.isArray(spec.supports) ? spec.supports : [];
  for (const support of supports) {
    const topY = Number(support.topY);
    if (!Number.isFinite(topY)) continue;
    const obstacle = normalizeObstacle(
      {
        ...support,
        kind: support.kind || "box",
        y: topY * 0.5,
        h: topY + (Number.isFinite(Number(support.extraHeight)) ? Number(support.extraHeight) : 0.04),
      },
      {
        surfaceId: id,
        mode: support.mode || "soft",
        navPad: Number.isFinite(Number(support.navPad)) ? Number(support.navPad) : 0.03,
        steerPad: Number.isFinite(Number(support.steerPad)) ? Number(support.steerPad) : 0.01,
        collisionPad: Number.isFinite(Number(support.collisionPad)) ? Number(support.collisionPad) : 0,
        blocksRuntime: support.blocksRuntime != null ? !!support.blocksRuntime : false,
        blocksPath: support.blocksPath != null ? !!support.blocksPath : true,
        pushable: support.pushable != null ? !!support.pushable : false,
        jumpIgnoreSurfaceIds: support.jumpIgnoreSurfaceIds || [id],
        tag: support.tag || "surfaceSupport",
      }
    );
    if (obstacle) surface.supports.push(obstacle);
  }

  const blockers = Array.isArray(spec.blockers) ? spec.blockers : [];
  for (const blocker of blockers) {
    const obstacle = normalizeObstacle(blocker, {
      surfaceId: id,
      mode: blocker.mode || "hard",
      navPad: Number.isFinite(Number(blocker.navPad)) ? Number(blocker.navPad) : 0.02,
      steerPad: Number.isFinite(Number(blocker.steerPad)) ? Number(blocker.steerPad) : 0.02,
      collisionPad: Number.isFinite(Number(blocker.collisionPad)) ? Number(blocker.collisionPad) : 0,
      blocksRuntime: blocker.blocksRuntime != null ? !!blocker.blocksRuntime : true,
      blocksPath: blocker.blocksPath != null ? !!blocker.blocksPath : true,
      pushable: blocker.pushable != null ? !!blocker.pushable : false,
      tag: blocker.tag || "surfaceBlocker",
    });
    if (obstacle) surface.blockers.push(obstacle);
  }

  return surface;
}

export function createSurfaceRegistry({ floorBounds, floorY = 0, surfaceSpecs = [] } = {}) {
  const normalized = [];
  const byId = new Map();
  const seen = new Set();
  const floorRect = normalizeRect(floorBounds || {});

  const addSurface = (spec) => {
    const surface = normalizeSurfaceSpec(spec, floorY);
    if (!surface || seen.has(surface.id)) return;
    seen.add(surface.id);
    normalized.push(surface);
    byId.set(surface.id, surface);
  };

  addSurface({
    id: "floor",
    name: "floor",
    y: floorY,
    minX: floorRect.minX,
    maxX: floorRect.maxX,
    minZ: floorRect.minZ,
    maxZ: floorRect.maxZ,
    flags: {
      randomPatrol: true,
      manualPatrol: true,
      allowCatSpawn: true,
      allowTrashSpawn: true,
      allowLaundrySpawn: true,
      allowCatnip: true,
      floorLike: true,
    },
    special: { type: "floor" },
  });

  for (const spec of surfaceSpecs) addSurface(spec);

  function cloneSurface(surface) {
    if (!surface) return null;
    return {
      id: surface.id,
      name: surface.name,
      minX: surface.minX,
      maxX: surface.maxX,
      minZ: surface.minZ,
      maxZ: surface.maxZ,
      y: surface.y,
      floorLike: surface.floorLike,
      randomPatrol: surface.randomPatrol,
      manualPatrol: surface.manualPatrol,
      startSurface: surface.startSurface,
      spawnTrash: surface.spawnTrash,
      spawnLaundry: surface.spawnLaundry,
      allowCatnip: surface.allowCatnip,
      flags: cloneMeta(surface.flags),
      associatedObjectIds: Array.isArray(surface.associatedObjectIds) ? [...surface.associatedObjectIds] : [],
      special: cloneMeta(surface.special),
    };
  }

  function getSurfaceById(id) {
    return cloneSurface(byId.get(String(id || "floor"))) || null;
  }

  function getSurfaceDefs(options = {}) {
    const includeFloor = options.includeFloor !== false;
    const onlyRandomPatrol = !!options.onlyRandomPatrol;
    const onlyManualPatrol = !!options.onlyManualPatrol;
    const out = [];
    for (const surface of normalized) {
      if (!includeFloor && surface.id === "floor") continue;
      if (onlyRandomPatrol && !surface.randomPatrol) continue;
      if (onlyManualPatrol && !surface.manualPatrol) continue;
      out.push(cloneSurface(surface));
    }
    return out;
  }

  function getElevatedSurfaceDefs(includeDesk = true) {
    return normalized
      .filter((surface) => !surface.floorLike && (includeDesk || surface.id !== "desk"))
      .map(cloneSurface);
  }

  function surfaceHasCapability(surfaceOrId, capability) {
    const key = String(capability || "").trim();
    if (!key) return false;
    const surface = typeof surfaceOrId === "string" ? byId.get(surfaceOrId) : surfaceOrId;
    if (!surface) return false;
    const aliasMap = {
      randomPatrol: "randomPatrol",
      manualPatrol: "manualPatrol",
      startSurface: "allowCatSpawn",
      allowCatSpawn: "allowCatSpawn",
      spawnTrash: "allowTrashSpawn",
      allowTrashSpawn: "allowTrashSpawn",
      spawnLaundry: "allowLaundrySpawn",
      allowLaundrySpawn: "allowLaundrySpawn",
      allowCatnip: "allowCatnip",
      floorLike: "floorLike",
    };
    const flagKey = aliasMap[key] || key;
    if (surface.flags && Object.prototype.hasOwnProperty.call(surface.flags, flagKey)) {
      return !!surface.flags[flagKey];
    }
    return !!surface[flagKey];
  }

  function getSurfaceIdsByCapability(capability) {
    return normalized.filter((surface) => surfaceHasCapability(surface, capability)).map((surface) => surface.id);
  }

  function buildNavObstacles() {
    const out = [];
    for (const surface of normalized) {
      for (const obs of surface.supports) out.push({ ...obs });
      for (const obs of surface.blockers) out.push({ ...obs });
    }
    return out;
  }

  function buildStaticBoxes() {
    const out = [];
    for (const surface of normalized) {
      if (!surface.floorLike) {
        out.push({
          x: (surface.minX + surface.maxX) * 0.5,
          y: surface.y,
          z: (surface.minZ + surface.maxZ) * 0.5,
          hx: Math.max(0.02, (surface.maxX - surface.minX) * 0.5),
          hy: 0.04,
          hz: Math.max(0.02, (surface.maxZ - surface.minZ) * 0.5),
          surfaceId: surface.id,
        });
      }
      for (const obs of surface.supports) {
        if (obs.kind !== "box") continue;
        out.push({ x: obs.x, y: obs.y, z: obs.z, hx: obs.hx, hy: obs.h * 0.5, hz: obs.hz, surfaceId: surface.id });
      }
      for (const obs of surface.blockers) {
        if (obs.kind !== "box") continue;
        out.push({ x: obs.x, y: obs.y, z: obs.z, hx: obs.hx, hy: obs.h * 0.5, hz: obs.hz, surfaceId: surface.id });
      }
    }
    return out;
  }

  return {
    getSurfaceDefs,
    getElevatedSurfaceDefs,
    getSurfaceById,
    getSurfaceIdsByCapability,
    surfaceHasCapability,
    buildNavObstacles,
    buildStaticBoxes,
  };
}
