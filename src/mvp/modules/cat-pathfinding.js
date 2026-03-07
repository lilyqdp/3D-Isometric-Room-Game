export function createCatPathfindingRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ROOM,
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
      },
      { kind: "circle", x: trashCan.pos.x, z: trashCan.pos.z, r: trashCan.outerRadius + 0.12 },
    ];
    for (const leg of DESK_LEGS) {
      obstacles.push({
        kind: "box",
        x: leg.x,
        z: leg.z,
        hx: leg.halfX + 0.03,
        hz: leg.halfZ + 0.03,
      });
    }
    if (!cup.broken && !cup.falling && cup.group.visible && cup.group.position.y <= 0.35) {
      obstacles.push({
        kind: "circle",
        x: cup.group.position.x,
        z: cup.group.position.z,
        r: CUP_COLLISION.radius + 0.04,
      });
    }
    if (includePickups) {
      for (const p of pickups) {
        if (p.mesh.position.y > 0.34) continue;
        const cdx = p.mesh.position.x - cat.pos.x;
        const cdz = p.mesh.position.z - cat.pos.z;
        if (!includeClosePickups && cdx * cdx + cdz * cdz < 0.22 * 0.22) continue;
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
          });
        } else {
          obstacles.push({
            kind: "circle",
            x: p.mesh.position.x,
            z: p.mesh.position.z,
            r: pickupRadius(p) + CAT_COLLISION.pickupRadiusBoost * 0.35,
          });
        }
      }
    }
    return obstacles;
  }

  function isCatPointBlocked(x, z, obstacles, clearance = CAT_NAV.clearance) {
    if (
      x < ROOM.minX + CAT_NAV.margin ||
      x > ROOM.maxX - CAT_NAV.margin ||
      z < ROOM.minZ + CAT_NAV.margin ||
      z > ROOM.maxZ - CAT_NAV.margin
    ) {
      return true;
    }
    for (const obs of obstacles) {
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
    return Math.max(0.01, CAT_COLLISION.catBodyRadius - CAT_PATH_CLEARANCE_EPSILON);
  }

  function hasClearTravelLine(a, b, obstacles, clearance = CAT_NAV.clearance) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const samples = Math.max(2, Math.ceil(dist / 0.18));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      if (isCatPointBlocked(x, z, obstacles, clearance)) return false;
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
    const navMesh = buildTriangleNavMesh(obstacles, clearance);
    return {
      ...navMesh,
      includePickups,
      includeClosePickups,
      clearance,
    };
  }

  function getActiveNavMeshDebugData() {
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

  function computeCatPath(start, goal, obstacles) {
    const navClearance = getCatPathClearance();
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
    const goalDelta = cat.nav.goal.distanceToSquared(target);
    if (!force && cat.nav.path.length > 1 && goalDelta < 0.05 * 0.05) return;
    activeNavMeshMode.includePickups = !!useDynamic;
    activeNavMeshMode.includeClosePickups = true;
    const obstacles = buildCatObstacles(useDynamic, true);
    cat.nav.path = computeCatPath(cat.pos, target, obstacles);
    cat.nav.index = cat.nav.path.length > 1 ? 1 : 0;
    cat.nav.goal.copy(target);
    cat.nav.repathAt = getClockTime() + CAT_NAV.repathInterval;
  }

  return {
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
