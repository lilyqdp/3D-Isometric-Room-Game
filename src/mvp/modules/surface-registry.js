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
    tag: spec.tag || defaults.tag || "",
  };
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

function normalizeSurfaceSpec(spec, floorY) {
  if (!spec || typeof spec !== "object") return null;
  const id = String(spec.id || spec.name || "").trim();
  if (!id) return null;
  const rect = normalizeRect(spec);
  const y = Number(spec.y);
  if (![rect.minX, rect.maxX, rect.minZ, rect.maxZ, y].every(Number.isFinite)) return null;
  const surface = {
    id,
    name: String(spec.name || id),
    minX: rect.minX,
    maxX: rect.maxX,
    minZ: rect.minZ,
    maxZ: rect.maxZ,
    y,
    floorLike: Math.abs(y - floorY) <= 0.04,
    randomPatrol: !!spec.randomPatrol,
    manualPatrol: spec.manualPatrol !== false,
    startSurface: !!spec.startSurface,
    spawnTrash: !!spec.spawnTrash,
    spawnLaundry: !!spec.spawnLaundry,
    allowCatnip: spec.allowCatnip !== false,
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
        jumpIgnoreSurfaceIds: support.jumpIgnoreSurfaceIds || [id],
        tag: support.tag || "surfaceSupport",
      }
    );
    if (obstacle) surface.supports.push(obstacle);
  }

  const blockers = Array.isArray(spec.blockers) ? spec.blockers : [];
  for (const blocker of blockers) {
    const obstacle = normalizeObstacle(blocker, { surfaceId: id, tag: blocker.tag || "surfaceBlocker" });
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
    randomPatrol: true,
    manualPatrol: true,
    startSurface: true,
    spawnTrash: true,
    spawnLaundry: true,
    allowCatnip: true,
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

  function getSurfaceIdsByCapability(capability) {
    const key = String(capability || "");
    return normalized
      .filter((surface) => {
        if (key === "randomPatrol") return surface.randomPatrol;
        if (key === "manualPatrol") return surface.manualPatrol;
        if (key === "startSurface") return surface.startSurface;
        if (key === "spawnTrash") return surface.spawnTrash;
        if (key === "spawnLaundry") return surface.spawnLaundry;
        if (key === "allowCatnip") return surface.allowCatnip;
        return false;
      })
      .map((surface) => surface.id);
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
    buildNavObstacles,
    buildStaticBoxes,
  };
}
