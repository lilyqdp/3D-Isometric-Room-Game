import { init as initRecast, NavMeshQuery } from "@recast-navigation/core";
import { NavMeshHelper, threeToSoloNavMesh } from "@recast-navigation/three";

export function createCatPathfindingRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ROOM,
    desk,
    hamper,
    trashCan,
    DESK_LEGS,
    CUP_COLLISION,
    pickups,
    cat,
    cup,
    pickupRadius,
    getClockTime,
  } = ctx;

  const tempQ = new THREE.Quaternion();
  const tempEuler = new THREE.Euler();
  const recastState = {
    ready: false,
    failed: false,
    initPromise: null,
  };
  const navMeshCache = {
    static: null,
    dynamic: null,
    active: null,
  };
  const lastPlannedSignature = {
    static: "",
    dynamic: "",
  };
  const recastConfig = {
    // Use a finer voxel size so dynamic pickup obstacles are reflected more accurately.
    cs: 0.08,
    ch: 0.05,
    walkableSlopeAngle: 50,
    walkableHeight: 0.25,
    walkableClimb: 0.08,
    walkableRadius: Math.max(0.05, CAT_COLLISION.catBodyRadius - CAT_PATH_CLEARANCE_EPSILON),
    maxEdgeLen: 12,
    maxSimplificationError: 0.7,
    minRegionArea: 0,
    mergeRegionArea: 0,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
  };
  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      ROOM.maxX - ROOM.minX - CAT_NAV.margin * 2,
      0.1,
      ROOM.maxZ - ROOM.minZ - CAT_NAV.margin * 2
    )
  );
  floorMesh.position.set(
    (ROOM.minX + ROOM.maxX) * 0.5,
    -0.05,
    (ROOM.minZ + ROOM.maxZ) * 0.5
  );
  floorMesh.updateMatrixWorld(true);
  const activeNavMeshMode = {
    includePickups: false,
    includeClosePickups: true,
  };

  function buildCatObstacles(includePickups = false, includeClosePickups = false) {
    const obstacles = [
      {
        kind: "box",
        x: hamper.pos.x,
        z: hamper.pos.z,
        hx: hamper.outerHalfX + 0.02,
        hz: hamper.outerHalfZ + 0.02,
        y: hamper.rimY * 0.5,
        h: hamper.rimY + 0.06,
      },
      {
        kind: "circle",
        x: trashCan.pos.x,
        z: trashCan.pos.z,
        r: trashCan.outerRadius + 0.12,
        y: trashCan.rimY * 0.5,
        h: trashCan.rimY + 0.08,
      },
    ];
    for (const leg of DESK_LEGS) {
      obstacles.push({
        kind: "box",
        x: leg.x,
        z: leg.z,
        hx: leg.halfX + 0.03,
        hz: leg.halfZ + 0.03,
        y: leg.topY * 0.5,
        h: leg.topY + 0.04,
      });
    }
    if (!cup.broken && !cup.falling && cup.group.visible) {
      obstacles.push({
        kind: "circle",
        tag: "cup",
        x: cup.group.position.x,
        z: cup.group.position.z,
        r: CUP_COLLISION.radius + 0.04,
        y: cup.group.position.y,
        h: (CUP_COLLISION.waterHeight || 0.27) + 0.14,
      });
    }
    if (includePickups) {
      for (const p of pickups) {
        const cdx = p.mesh.position.x - cat.pos.x;
        const cdz = p.mesh.position.z - cat.pos.z;
        if (!includeClosePickups && cdx * cdx + cdz * cdz < 0.22 * 0.22) continue;
        const shape = p.body?.shapes?.[0];
        const halfY = shape?.halfExtents?.y || (p.type === "laundry" ? 0.05 : 0.04);
        // Keep pickup obstacles tall enough that recast still blocks them after they settle flat.
        const height = p.type === "laundry" ? Math.max(0.2, halfY * 2 + 0.1) : Math.max(0.18, halfY * 2 + 0.1);
        const centerY = p.mesh.position.y + 0.05;
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
            y: centerY,
            h: height,
          });
        } else {
          obstacles.push({
            kind: "circle",
            x: p.mesh.position.x,
            z: p.mesh.position.z,
            r: pickupRadius(p) + CAT_COLLISION.pickupRadiusBoost * 0.35,
            y: centerY,
            h: height,
          });
        }
      }
    }
    obstacles._includePickups = !!includePickups;
    obstacles._includeClosePickups = !!includeClosePickups;
    return obstacles;
  }

  function obstacleOverlapsQueryY(obs, queryY, tolerance = 0.08) {
    if (!Number.isFinite(queryY)) return true;
    if (!Number.isFinite(obs.y) || !Number.isFinite(obs.h)) return true;
    const halfH = Math.max(0.001, obs.h * 0.5);
    const minY = obs.y - halfH - tolerance;
    const maxY = obs.y + halfH + tolerance;
    return queryY >= minY && queryY <= maxY;
  }

  function isCatPointBlocked(x, z, obstacles, clearance = CAT_NAV.clearance, queryY = 0) {
    if (
      x < ROOM.minX + CAT_NAV.margin ||
      x > ROOM.maxX - CAT_NAV.margin ||
      z < ROOM.minZ + CAT_NAV.margin ||
      z > ROOM.maxZ - CAT_NAV.margin
    ) {
      return true;
    }
    for (const obs of obstacles) {
      if (!obstacleOverlapsQueryY(obs, queryY)) continue;
      if (obs.tag === "cup" && (cat.state === "toCup" || cat.state === "swipe")) continue;
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

  function getCatPathClearance() {
    // Inflate path clearance a bit so paths do not graze obstacle edges.
    return Math.max(0.01, CAT_COLLISION.catBodyRadius + 0.03 - CAT_PATH_CLEARANCE_EPSILON);
  }

  function hasClearTravelLine(a, b, obstacles, clearance = CAT_NAV.clearance, queryY = 0) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const samples = Math.max(2, Math.ceil(dist / 0.18));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      if (isCatPointBlocked(x, z, obstacles, clearance, queryY)) return false;
    }
    return true;
  }

  function smoothCatPath(path, obstacles, clearance = CAT_NAV.clearance) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1) {
        if (hasClearTravelLine(path[i], path[j], obstacles, clearance)) break;
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

  function ensureRecastInitialized() {
    if (recastState.ready) return Promise.resolve();
    if (recastState.initPromise) return recastState.initPromise;
    recastState.initPromise = initRecast()
      .then(() => {
        recastState.ready = true;
        recastState.failed = false;
      })
      .catch((error) => {
        recastState.ready = false;
        recastState.failed = true;
        console.warn("Recast init failed, using fallback nav pathing.", error);
      })
      .finally(() => {
        if (!recastState.ready) recastState.initPromise = null;
      });
    return recastState.initPromise;
  }

  function obstacleSignature(obstacles, clearance) {
    const q = (v) => Math.round(v * 1000) / 1000;
    const parts = [`c:${q(clearance)}`, `n:${obstacles.length}`];
    for (const obs of obstacles) {
      if (obs.kind === "circle") {
        parts.push(`c:${q(obs.x)}:${q(obs.z)}:${q(obs.r)}:${q(obs.y || 0)}:${q(obs.h || 0)}`);
      } else if (obs.kind === "obb") {
        parts.push(`o:${q(obs.x)}:${q(obs.z)}:${q(obs.hx)}:${q(obs.hz)}:${q(obs.yaw || 0)}:${q(obs.y || 0)}:${q(obs.h || 0)}`);
      } else {
        parts.push(`b:${q(obs.x)}:${q(obs.z)}:${q(obs.hx)}:${q(obs.hz)}:${q(obs.y || 0)}:${q(obs.h || 0)}`);
      }
    }
    return parts.join("|");
  }

  function buildRecastSourceMeshes(obstacles) {
    const meshes = [floorMesh];

    // Extra walkable surfaces above floor.
    if (desk) {
      const deskTop = new THREE.Mesh(new THREE.BoxGeometry(desk.sizeX - 0.24, 0.06, desk.sizeZ - 0.24));
      deskTop.position.set(desk.pos.x, desk.topY + 0.03, desk.pos.z);
      deskTop.updateMatrixWorld(true);
      meshes.push(deskTop);
    }

    // Keep dynamic/static blockers in navmesh build so global routing avoids them.
    for (const obs of obstacles) {
      let mesh = null;
      const obsHeight = Math.max(0.06, Number.isFinite(obs.h) ? obs.h : 1.6);
      const obsY = Number.isFinite(obs.y) ? obs.y : obsHeight * 0.5;
      if (obs.kind === "circle") {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(obs.r, obs.r, obsHeight, 16));
        mesh.position.set(obs.x, obsY, obs.z);
      } else if (obs.kind === "obb") {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(obs.hx * 2, obsHeight, obs.hz * 2));
        mesh.position.set(obs.x, obsY, obs.z);
        mesh.rotation.y = obs.yaw || 0;
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(obs.hx * 2, obsHeight, obs.hz * 2));
        mesh.position.set(obs.x, obsY, obs.z);
      }
      mesh.updateMatrixWorld(true);
      meshes.push(mesh);
    }
    return meshes;
  }

  function getDebugWalkableSurfaces() {
    const surfaces = [];
    surfaces.push({
      minX: ROOM.minX + CAT_NAV.margin,
      maxX: ROOM.maxX - CAT_NAV.margin,
      minZ: ROOM.minZ + CAT_NAV.margin,
      maxZ: ROOM.maxZ - CAT_NAV.margin,
      y: 0,
      yTol: 0.14,
    });
    if (desk) {
      surfaces.push({
        minX: desk.pos.x - (desk.sizeX - 0.24) * 0.5,
        maxX: desk.pos.x + (desk.sizeX - 0.24) * 0.5,
        minZ: desk.pos.z - (desk.sizeZ - 0.24) * 0.5,
        maxZ: desk.pos.z + (desk.sizeZ - 0.24) * 0.5,
        y: desk.topY + 0.03,
        yTol: 0.1,
      });
    }
    return surfaces;
  }

  function isPointOnDebugWalkableSurface(x, y, z, surfaces) {
    for (const s of surfaces) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      if (Math.abs(y - s.y) <= s.yTol) return true;
    }
    return false;
  }

  function extractDebugGeometryFromNavMesh(navMesh) {
    const helper = new NavMeshHelper(navMesh);
    helper.update();
    const geometry = helper.navMeshGeometry || helper.mesh?.geometry;
    const positionAttr = geometry ? geometry.getAttribute("position") : null;
    if (!positionAttr) return { segments: [], triangles: [] };

    const segments = [];
    const triangles = [];
    const surfaces = getDebugWalkableSurfaces();
    const seen = new Set();
    const addEdge = (ia, ib) => {
      const ax = positionAttr.getX(ia);
      const ay = positionAttr.getY(ia);
      const az = positionAttr.getZ(ia);
      const bx = positionAttr.getX(ib);
      const by = positionAttr.getY(ib);
      const bz = positionAttr.getZ(ib);
      const keyA = `${Math.round(ax * 100)}:${Math.round(ay * 100)}:${Math.round(az * 100)}`;
      const keyB = `${Math.round(bx * 100)}:${Math.round(by * 100)}:${Math.round(bz * 100)}`;
      const edgeKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
      if (seen.has(edgeKey)) return;
      seen.add(edgeKey);
      segments.push([ax, ay, az, bx, by, bz]);
    };

    const addTri = (ia, ib, ic) => {
      const ax = positionAttr.getX(ia);
      const ay = positionAttr.getY(ia);
      const az = positionAttr.getZ(ia);
      const bx = positionAttr.getX(ib);
      const by = positionAttr.getY(ib);
      const bz = positionAttr.getZ(ib);
      const cx = positionAttr.getX(ic);
      const cy = positionAttr.getY(ic);
      const cz = positionAttr.getZ(ic);
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      const mz = (az + bz + cz) / 3;
      if (!isPointOnDebugWalkableSurface(mx, my, mz, surfaces)) return;
      addEdge(ia, ib);
      addEdge(ib, ic);
      addEdge(ic, ia);
      triangles.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    };

    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        addTri(a, b, c);
      }
    } else {
      for (let i = 0; i < positionAttr.count; i += 3) {
        addTri(i, i + 1, i + 2);
      }
    }

    if (helper.navMeshGeometry) helper.navMeshGeometry.dispose();
    return { segments, triangles };
  }

  function buildRecastNavEntry(obstacles, includePickups, clearance) {
    if (!recastState.ready) return null;
    const modeKey = includePickups ? "dynamic" : "static";
    const signature = obstacleSignature(obstacles, clearance);
    const cached = navMeshCache[modeKey];
    if (cached && cached.signature === signature) {
      navMeshCache.active = cached;
      return cached;
    }

    try {
      const sourceMeshes = buildRecastSourceMeshes(obstacles);
      const result = threeToSoloNavMesh(sourceMeshes, {
        ...recastConfig,
        walkableRadius: Math.max(clearance, 0.05),
      });
      if (!result?.success || !result.navMesh) return null;

      const navQuery = new NavMeshQuery(result.navMesh, { maxNodes: 4096 });
      navQuery.defaultQueryHalfExtents = { x: 2.5, y: 2.0, z: 2.5 };

      const debugGeometry = extractDebugGeometryFromNavMesh(result.navMesh);
      const entry = {
        signature,
        includePickups,
        navMesh: result.navMesh,
        navQuery,
        segments: debugGeometry.segments,
        triangles: debugGeometry.triangles,
        clearance,
      };
      if (cached) {
        cached.navQuery.destroy();
        cached.navMesh.destroy();
      }
      navMeshCache[modeKey] = entry;
      navMeshCache.active = entry;
      return entry;
    } catch (error) {
      recastState.ready = false;
      recastState.failed = true;
      console.warn("Recast navmesh build failed, using fallback nav pathing.", error);
      return null;
    }
  }

  function computeRecastPath(start, goal, obstacles, clearance) {
    if (!recastState.ready) return null;
    const includePickups = !!obstacles?._includePickups;
    const entry = buildRecastNavEntry(obstacles, includePickups, clearance);
    if (!entry) return null;

    const queryHalfExtents = { x: 2.5, y: 2.0, z: 2.5 };
    const result = entry.navQuery.computePath(
      { x: start.x, y: 0, z: start.z },
      { x: goal.x, y: 0, z: goal.z },
      {
        halfExtents: queryHalfExtents,
        maxPathPolys: 1024,
        maxStraightPathPoints: 1024,
      }
    );
    if (!result?.success || !Array.isArray(result.path) || result.path.length === 0) return [];

    const path = [];
    for (let i = 0; i < result.path.length; i++) {
      const p = result.path[i];
      path.push(new THREE.Vector3(p.x, 0, p.z));
    }

    if (path.length === 0) return [];
    if (path[0].distanceToSquared(start) > 0.01 * 0.01) path.unshift(start.clone());
    else path[0].copy(start);
    const last = path.length - 1;
    if (path[last].distanceToSquared(goal) > 0.01 * 0.01) path.push(goal.clone());
    else path[last].copy(goal);

    const smoothed = smoothCatPath(path, obstacles, clearance);
    if (!isPathTraversable(smoothed, obstacles, clearance)) return [];
    return smoothed;
  }

  function findNearestWalkablePoint(point, obstacles, clearance) {
    if (!isCatPointBlocked(point.x, point.z, obstacles, clearance)) return point.clone();
    const step = CAT_NAV.step;
    const candidate = new THREE.Vector3();
    for (let r = 1; r <= 10; r++) {
      const ringDist = r * step;
      const steps = Math.max(12, Math.floor(20 * r));
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        candidate.set(point.x + Math.cos(t) * ringDist, 0, point.z + Math.sin(t) * ringDist);
        if (!isCatPointBlocked(candidate.x, candidate.z, obstacles, clearance)) return candidate.clone();
      }
    }
    return point.clone();
  }

  function isPointInsideTriangleXZ(point, a, b, c) {
    const cross = (p1, p2, p3) => (p2.x - p1.x) * (p3.z - p1.z) - (p2.z - p1.z) * (p3.x - p1.x);
    const c1 = cross(a, b, point);
    const c2 = cross(b, c, point);
    const c3 = cross(c, a, point);
    const hasNeg = c1 < 0 || c2 < 0 || c3 < 0;
    const hasPos = c1 > 0 || c2 > 0 || c3 > 0;
    return !(hasNeg && hasPos);
  }

  function buildTriangleNavMesh(obstacles, clearance) {
    const step = CAT_NAV.step;
    const minX = ROOM.minX + CAT_NAV.margin;
    const maxX = ROOM.maxX - CAT_NAV.margin;
    const minZ = ROOM.minZ + CAT_NAV.margin;
    const maxZ = ROOM.maxZ - CAT_NAV.margin;
    const vxCount = Math.floor((maxX - minX) / step) + 1;
    const vzCount = Math.floor((maxZ - minZ) / step) + 1;
    if (vxCount < 2 || vzCount < 2) return { vertices: [], triangles: [] };

    const vertexId = (ix, iz) => iz * vxCount + ix;
    const vertices = new Array(vxCount * vzCount);
    const walkable = new Uint8Array(vertices.length);
    for (let iz = 0; iz < vzCount; iz++) {
      for (let ix = 0; ix < vxCount; ix++) {
        const id = vertexId(ix, iz);
        const v = new THREE.Vector3(minX + ix * step, 0, minZ + iz * step);
        vertices[id] = v;
        if (!isCatPointBlocked(v.x, v.z, obstacles, clearance)) walkable[id] = 1;
      }
    }

    const triangles = [];
    const edgeOwner = new Map();
    const addAdjacencyEdge = (a, b, triIndex) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const owner = edgeOwner.get(key);
      if (owner == null) {
        edgeOwner.set(key, triIndex);
        return;
      }
      triangles[owner].neighbors.push(triIndex);
      triangles[triIndex].neighbors.push(owner);
    };

    const addTriangle = (a, b, c) => {
      if (!walkable[a] || !walkable[b] || !walkable[c]) return;
      const va = vertices[a];
      const vb = vertices[b];
      const vc = vertices[c];
      if (!hasClearTravelLine(va, vb, obstacles, clearance)) return;
      if (!hasClearTravelLine(vb, vc, obstacles, clearance)) return;
      if (!hasClearTravelLine(vc, va, obstacles, clearance)) return;
      const triIndex = triangles.length;
      triangles.push({
        a,
        b,
        c,
        centroid: new THREE.Vector3((va.x + vb.x + vc.x) / 3, 0, (va.z + vb.z + vc.z) / 3),
        neighbors: [],
      });
      addAdjacencyEdge(a, b, triIndex);
      addAdjacencyEdge(b, c, triIndex);
      addAdjacencyEdge(c, a, triIndex);
    };

    for (let iz = 0; iz < vzCount - 1; iz++) {
      for (let ix = 0; ix < vxCount - 1; ix++) {
        const a = vertexId(ix, iz);
        const b = vertexId(ix + 1, iz);
        const c = vertexId(ix, iz + 1);
        const d = vertexId(ix + 1, iz + 1);
        addTriangle(a, b, c);
        addTriangle(b, d, c);
      }
    }

    return { vertices, triangles };
  }

  function getNavMeshDebugData(includePickups = false, includeClosePickups = false) {
    const obstacles = buildCatObstacles(includePickups, includeClosePickups);
    const clearance = getCatPathClearance();
    if (recastState.ready) {
      const recastEntry = buildRecastNavEntry(obstacles, includePickups, clearance);
      if (recastEntry) {
        return {
          engine: "recast",
          segments: recastEntry.segments,
          triangles: recastEntry.triangles,
          includePickups,
          includeClosePickups,
          clearance,
        };
      }
    }

    const fallback = buildTriangleNavMesh(obstacles, clearance);
    return {
      engine: "triangle-fallback",
      ...fallback,
      includePickups,
      includeClosePickups,
      clearance,
    };
  }

  function getActiveNavMeshDebugData() {
    // Always resolve against current obstacles so debug reflects live navmesh changes.
    return getNavMeshDebugData(activeNavMeshMode.includePickups, activeNavMeshMode.includeClosePickups);
  }

  function findTriangleForPoint(point, navMesh, obstacles, clearance) {
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < navMesh.triangles.length; i++) {
      const tri = navMesh.triangles[i];
      const va = navMesh.vertices[tri.a];
      const vb = navMesh.vertices[tri.b];
      const vc = navMesh.vertices[tri.c];
      if (isPointInsideTriangleXZ(point, va, vb, vc)) return i;
      const d2 = tri.centroid.distanceToSquared(point);
      if (d2 >= bestD2) continue;
      if (!hasClearTravelLine(point, tri.centroid, obstacles, clearance)) continue;
      bestD2 = d2;
      best = i;
    }
    return best;
  }

  function computeFallbackCatPath(start, goal, obstacles, navClearance) {
    if (hasClearTravelLine(start, goal, obstacles, navClearance)) {
      return [start.clone(), goal.clone()];
    }

    const freeStart = findNearestWalkablePoint(start, obstacles, navClearance);
    const freeGoal = findNearestWalkablePoint(goal, obstacles, navClearance);
    const navMesh = buildTriangleNavMesh(obstacles, navClearance);
    if (!navMesh.triangles.length) return [];

    const startTri = findTriangleForPoint(freeStart, navMesh, obstacles, navClearance);
    const goalTri = findTriangleForPoint(freeGoal, navMesh, obstacles, navClearance);
    if (startTri < 0 || goalTri < 0) return [];
    if (startTri === goalTri) return [start.clone(), goal.clone()];

    const triCount = navMesh.triangles.length;
    const g = new Float32Array(triCount);
    const f = new Float32Array(triCount);
    const came = new Int32Array(triCount);
    const closed = new Uint8Array(triCount);
    for (let i = 0; i < triCount; i++) {
      g[i] = Infinity;
      f[i] = Infinity;
      came[i] = -1;
    }

    const open = [startTri];
    g[startTri] = 0;
    f[startTri] = navMesh.triangles[startTri].centroid.distanceTo(navMesh.triangles[goalTri].centroid);

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
      if (current === goalTri) break;
      if (closed[current]) continue;
      closed[current] = 1;

      const currentCenter = navMesh.triangles[current].centroid;
      for (const neighbor of navMesh.triangles[current].neighbors) {
        if (closed[neighbor]) continue;
        const neighborCenter = navMesh.triangles[neighbor].centroid;
        if (!hasClearTravelLine(currentCenter, neighborCenter, obstacles, navClearance)) continue;
        const candidate = g[current] + currentCenter.distanceTo(neighborCenter);
        if (candidate >= g[neighbor]) continue;
        came[neighbor] = current;
        g[neighbor] = candidate;
        f[neighbor] = candidate + neighborCenter.distanceTo(navMesh.triangles[goalTri].centroid);
        open.push(neighbor);
      }
    }

    if (came[goalTri] === -1) return [];

    const triPath = [];
    let cur = goalTri;
    while (cur !== -1) {
      triPath.push(cur);
      cur = came[cur];
    }
    triPath.reverse();

    const waypoints = [start.clone()];
    for (let i = 1; i < triPath.length - 1; i++) {
      waypoints.push(navMesh.triangles[triPath[i]].centroid.clone());
    }
    waypoints.push(goal.clone());
    return smoothCatPath(waypoints, obstacles, navClearance);
  }

  function computeCatPath(start, goal, obstacles) {
    const navClearance = getCatPathClearance();
    if (hasClearTravelLine(start, goal, obstacles, navClearance)) {
      return [start.clone(), goal.clone()];
    }

    const freeStart = findNearestWalkablePoint(start, obstacles, navClearance);
    const freeGoal = findNearestWalkablePoint(goal, obstacles, navClearance);

    const recastPath = computeRecastPath(freeStart, freeGoal, obstacles, navClearance);
    if (Array.isArray(recastPath) && recastPath.length >= 2) {
      recastPath[0] = start.clone();
      recastPath[recastPath.length - 1] = goal.clone();
      return recastPath;
    }

    return computeFallbackCatPath(start, goal, obstacles, navClearance);
  }

  function isPathTraversable(path, obstacles, clearance = CAT_NAV.clearance) {
    if (!path || path.length < 2) return false;
    for (let i = 1; i < path.length; i++) {
      if (!hasClearTravelLine(path[i - 1], path[i], obstacles, clearance)) return false;
    }
    return true;
  }

  function canReachGroundTarget(start, goal, obstacles) {
    const navClearance = getCatPathClearance();
    if (isCatPointBlocked(goal.x, goal.z, obstacles, navClearance)) return false;
    if (start.distanceToSquared(goal) < 0.1 * 0.1) return true;
    const path = computeCatPath(start, goal, obstacles);
    return isPathTraversable(path, obstacles, navClearance);
  }

  function ensureCatPath(target, force = false, useDynamic = false) {
    if (cat.group.position.y > 0.02) return;
    const navClearance = getCatPathClearance();
    const obstacles = buildCatObstacles(useDynamic, true);
    const modeKey = useDynamic ? "dynamic" : "static";
    const navSignature = obstacleSignature(obstacles, navClearance);
    const navChanged = lastPlannedSignature[modeKey] !== navSignature;
    const goalDelta = cat.nav.goal.distanceToSquared(target);
    if (!force && !navChanged && cat.nav.path.length > 1 && goalDelta < 0.05 * 0.05) return;
    activeNavMeshMode.includePickups = !!useDynamic;
    activeNavMeshMode.includeClosePickups = true;
    cat.nav.path = computeCatPath(cat.pos, target, obstacles);
    cat.nav.index = cat.nav.path.length > 1 ? 1 : 0;
    cat.nav.goal.copy(target);
    cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
    lastPlannedSignature[modeKey] = navSignature;
  }

  async function initPathfinding() {
    await ensureRecastInitialized();
  }

  return {
    initPathfinding,
    buildCatObstacles,
    isCatPointBlocked,
    getCatPathClearance,
    hasClearTravelLine,
    catPathDistance,
    getNavMeshDebugData,
    getActiveNavMeshDebugData,
    computeCatPath,
    isPathTraversable,
    canReachGroundTarget,
    ensureCatPath,
  };
}
