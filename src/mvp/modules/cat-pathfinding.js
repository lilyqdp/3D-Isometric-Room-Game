export function createCatPathfindingRuntime(ctx) {
  const {
    THREE,
    CAT_NAV,
    CAT_COLLISION,
    CAT_PATH_CLEARANCE_EPSILON,
    ASTAR_NEIGHBOR_OFFSETS,
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
  const tempTo = new THREE.Vector3();
  const tempFrom = new THREE.Vector3();

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

  function computeCatPath(start, goal, obstacles) {
    const navClearance = getCatPathClearance();
    if (hasClearTravelLine(start, goal, obstacles, navClearance)) {
      return [start.clone(), goal.clone()];
    }

    const step = CAT_NAV.step;
    const minX = ROOM.minX + CAT_NAV.margin;
    const maxX = ROOM.maxX - CAT_NAV.margin;
    const minZ = ROOM.minZ + CAT_NAV.margin;
    const maxZ = ROOM.maxZ - CAT_NAV.margin;
    const w = Math.floor((maxX - minX) / step) + 1;
    const h = Math.floor((maxZ - minZ) / step) + 1;
    const size = w * h;

    const toIdx = (ix, iz) => iz * w + ix;
    const toCell = (v, out) => {
      out.x = THREE.MathUtils.clamp(Math.round((v.x - minX) / step), 0, w - 1);
      out.y = THREE.MathUtils.clamp(Math.round((v.z - minZ) / step), 0, h - 1);
    };
    const cellPos = (ix, iz, out) => {
      out.set(minX + ix * step, 0, minZ + iz * step);
    };
    const nearestFree = (sx, sz) => {
      if (!isCatPointBlocked(sx, sz, obstacles, navClearance)) return new THREE.Vector2(sx, sz);
      for (let r = 1; r <= 8; r++) {
        for (let az = -r; az <= r; az++) {
          for (let ax = -r; ax <= r; ax++) {
            if (Math.abs(ax) !== r && Math.abs(az) !== r) continue;
            const x = sx + ax * step;
            const z = sz + az * step;
            if (!isCatPointBlocked(x, z, obstacles, navClearance)) return new THREE.Vector2(x, z);
          }
        }
      }
      return new THREE.Vector2(sx, sz);
    };

    const freeStart = nearestFree(start.x, start.z);
    const freeGoal = nearestFree(goal.x, goal.z);
    tempFrom.set(freeStart.x, 0, freeStart.y);
    tempTo.set(freeGoal.x, 0, freeGoal.y);

    const startCell = new THREE.Vector2();
    const goalCell = new THREE.Vector2();
    toCell(tempFrom, startCell);
    toCell(tempTo, goalCell);

    const g = new Float32Array(size);
    const f = new Float32Array(size);
    const came = new Int32Array(size);
    const closed = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      g[i] = Infinity;
      f[i] = Infinity;
      came[i] = -1;
    }

    const open = [];
    const startId = toIdx(startCell.x, startCell.y);
    const goalId = toIdx(goalCell.x, goalCell.y);
    g[startId] = 0;
    f[startId] = tempFrom.distanceTo(tempTo);
    open.push(startId);

    const currentPos = new THREE.Vector3();
    const neighborPos = new THREE.Vector3();
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
      if (current === goalId) break;
      if (closed[current]) continue;
      closed[current] = 1;

      const cx = current % w;
      const cz = Math.floor(current / w);
      cellPos(cx, cz, currentPos);
      for (const offset of ASTAR_NEIGHBOR_OFFSETS) {
        const nx = cx + offset.ox;
        const nz = cz + offset.oz;
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;

        const nid = toIdx(nx, nz);
        if (closed[nid]) continue;

        cellPos(nx, nz, neighborPos);
        if (isCatPointBlocked(neighborPos.x, neighborPos.z, obstacles, navClearance)) continue;
        if (!hasClearTravelLine(currentPos, neighborPos, obstacles, navClearance)) continue;

        const candidate = g[current] + offset.cost;
        if (candidate >= g[nid]) continue;
        came[nid] = current;
        g[nid] = candidate;
        f[nid] = candidate + neighborPos.distanceTo(tempTo);
        open.push(nid);
      }
    }

    if (came[goalId] === -1 && goalId !== startId) {
      return [];
    }

    const rev = [];
    let cur = goalId;
    while (cur !== -1) {
      const ix = cur % w;
      const iz = Math.floor(cur / w);
      cellPos(ix, iz, tempFrom);
      rev.push(tempFrom.clone());
      cur = came[cur];
    }
    rev.reverse();
    if (!rev.length) return [];
    rev[0].copy(start);
    rev[rev.length - 1].copy(goal);
    return smoothCatPath(rev, obstacles, navClearance);
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
    computeCatPath,
    isPathTraversable,
    canReachGroundTarget,
    ensureCatPath,
  };
}
