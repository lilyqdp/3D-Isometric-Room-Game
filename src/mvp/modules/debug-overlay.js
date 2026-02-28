export function createDebugOverlayRuntime(ctx) {
  const { THREE, scene, physics, pickups, cat, cup, desk, ROOM, CAT_NAV, CAT_COLLISION, CUP_COLLISION, debugBtnEl } = ctx;

  const DEBUG_VIEW = {
    enabled: true,
    navRefreshInterval: 0.22,
    collisionColor: 0xffff00,
    navColor: 0xff8a00,
    pathColor: 0x1de9b6,
    targetColor: 0xff2f2f,
    pathRadius: 0.075,
  };

  const debugView = {
    root: new THREE.Group(),
    staticCollisionGroup: new THREE.Group(),
    dynamicCollisionGroup: new THREE.Group(),
    navObstacleGroup: new THREE.Group(),
    navMeshLines: null,
    pathMesh: null,
    targetMarker: null,
    nextNavRefreshAt: 0,
    visible: false,
  };
  debugView.root.name = "debugView";
  debugView.staticCollisionGroup.name = "debugStaticCollision";
  debugView.dynamicCollisionGroup.name = "debugDynamicCollision";
  debugView.navObstacleGroup.name = "debugNavObstacles";

  const DEBUG_COLLISION_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.collisionColor,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const DEBUG_NAV_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.navColor,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
  });
  const DEBUG_PATH_MAT = new THREE.MeshBasicMaterial({
    color: DEBUG_VIEW.pathColor,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const DEBUG_TARGET_MESH_MAT = new THREE.MeshBasicMaterial({
    color: DEBUG_VIEW.targetColor,
    depthTest: false,
  });

  function clearDebugChildren(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
  }

  function makeDebugBoxEdges(hx, hy, hz) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
    return new THREE.LineSegments(geo, DEBUG_COLLISION_MAT);
  }

  function makeDebugCircleLoop(radius, y = 0, segments = 28) {
    const verts = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      verts.push(new THREE.Vector3(Math.cos(t) * radius, y, Math.sin(t) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    return new THREE.LineLoop(geo, DEBUG_COLLISION_MAT);
  }

  function makeDebugRectLoop(hx, hz, y = 0) {
    const verts = [
      new THREE.Vector3(-hx, y, -hz),
      new THREE.Vector3(hx, y, -hz),
      new THREE.Vector3(hx, y, hz),
      new THREE.Vector3(-hx, y, hz),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    return new THREE.LineLoop(geo, DEBUG_COLLISION_MAT);
  }

  function rebuildStaticCollisionDebug() {
    if (!DEBUG_VIEW.enabled) return;
    clearDebugChildren(debugView.staticCollisionGroup);

    for (const box of physics.staticBoxes) {
      const line = makeDebugBoxEdges(box.hx, box.hy, box.hz);
      line.position.set(box.x, box.y, box.z);
      line.rotation.y = box.rotY || 0;
      line.renderOrder = 12;
      debugView.staticCollisionGroup.add(line);
    }
  }

  function rebuildDynamicCollisionDebug() {
    if (!DEBUG_VIEW.enabled) return;
    clearDebugChildren(debugView.dynamicCollisionGroup);

    for (const p of pickups) {
      const shape = p.body.shapes[0];
      if (!shape || !shape.halfExtents) continue;
      const line = makeDebugBoxEdges(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
      line.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
      line.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      line.renderOrder = 13;
      debugView.dynamicCollisionGroup.add(line);
    }

    const catRing = makeDebugCircleLoop(CAT_COLLISION.catBodyRadius, 0.03, 36);
    catRing.position.set(cat.pos.x, cat.group.position.y, cat.pos.z);
    catRing.renderOrder = 13;
    debugView.dynamicCollisionGroup.add(catRing);

    if (!cup.broken) {
      const cupRing = makeDebugCircleLoop(CUP_COLLISION.radius, 0.03, 24);
      cupRing.position.set(cup.group.position.x, cup.group.position.y, cup.group.position.z);
      cupRing.renderOrder = 13;
      debugView.dynamicCollisionGroup.add(cupRing);
    }
  }

  function rebuildNavObstacleDebug() {
    if (!DEBUG_VIEW.enabled) return;
    clearDebugChildren(debugView.navObstacleGroup);

    const obstacles = ctx.buildCatObstacles(true, true);
    for (const obs of obstacles) {
      let line;
      if (obs.kind === "circle") {
        line = makeDebugCircleLoop(obs.r, 0.04, 30);
        line.position.set(obs.x, 0, obs.z);
      } else {
        line = makeDebugRectLoop(obs.hx, obs.hz, 0.04);
        line.position.set(obs.x, 0, obs.z);
        if (obs.kind === "obb" && Number.isFinite(obs.yaw)) line.rotation.y = obs.yaw;
      }
      line.renderOrder = 14;
      debugView.navObstacleGroup.add(line);
    }
  }

  function rebuildNavMeshDebug() {
    if (!DEBUG_VIEW.enabled) return;
    if (debugView.navMeshLines) {
      debugView.root.remove(debugView.navMeshLines);
      debugView.navMeshLines.geometry.dispose();
      debugView.navMeshLines = null;
    }

    const points = [];
    const minX = ROOM.minX + CAT_NAV.margin;
    const maxX = ROOM.maxX - CAT_NAV.margin;
    const minZ = ROOM.minZ + CAT_NAV.margin;
    const maxZ = ROOM.maxZ - CAT_NAV.margin;
    const y = 0.02;
    const staticObstacles = ctx.buildCatObstacles(false);

    for (let x = minX; x <= maxX + 1e-6; x += CAT_NAV.step) {
      for (let z = minZ; z <= maxZ + 1e-6; z += CAT_NAV.step) {
        const blocked = ctx.isCatPointBlocked(x, z, staticObstacles, ctx.getCatPathClearance());
        if (blocked) continue;
        const tx = x + CAT_NAV.step;
        const tz = z + CAT_NAV.step;
        if (tx <= maxX + 1e-6 && !ctx.isCatPointBlocked(tx, z, staticObstacles, ctx.getCatPathClearance())) {
          points.push(x, y, z, tx, y, z);
        }
        if (tz <= maxZ + 1e-6 && !ctx.isCatPointBlocked(x, tz, staticObstacles, ctx.getCatPathClearance())) {
          points.push(x, y, z, x, y, tz);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const lines = new THREE.LineSegments(geo, DEBUG_NAV_MAT);
    lines.renderOrder = 10;
    debugView.navMeshLines = lines;
    debugView.root.add(lines);
  }

  function rebuildCurrentPathDebug(clockTime) {
    if (!DEBUG_VIEW.enabled) return;

    let path = cat.nav.path;
    if (!path || path.length < 2) {
      const target = cat.nav.debugDestination;
      if (Number.isFinite(target.x) && Number.isFinite(target.z)) {
        // Direct-move mode has no nav path array, so draw an exact direct segment.
        path = [cat.pos.clone(), new THREE.Vector3(target.x, 0, target.z)];
      }
    }

    if (!path || path.length < 2) {
      if (debugView.pathMesh) debugView.pathMesh.visible = false;
      return;
    }

    const polyline = path.map((p) => new THREE.Vector3(p.x, 0.08, p.z));
    const curvePath = new THREE.CurvePath();
    for (let i = 1; i < polyline.length; i++) {
      curvePath.add(new THREE.LineCurve3(polyline[i - 1], polyline[i]));
    }
    const tubularSegments = Math.max(8, (polyline.length - 1) * 6);
    const geo = new THREE.TubeGeometry(curvePath, tubularSegments, DEBUG_VIEW.pathRadius, 8, false);

    if (!debugView.pathMesh) {
      const mesh = new THREE.Mesh(geo, DEBUG_PATH_MAT);
      mesh.renderOrder = 15;
      debugView.pathMesh = mesh;
      debugView.root.add(mesh);
    } else {
      debugView.pathMesh.geometry.dispose();
      debugView.pathMesh.geometry = geo;
      debugView.pathMesh.visible = true;
    }
  }

  function rebuildTargetMarkerDebug() {
    if (!DEBUG_VIEW.enabled) return;
    if (debugView.targetMarker) {
      debugView.root.remove(debugView.targetMarker);
      if (debugView.targetMarker.isGroup) {
        for (const child of debugView.targetMarker.children) {
          if (child.geometry) child.geometry.dispose();
        }
      } else if (debugView.targetMarker.geometry) {
        debugView.targetMarker.geometry.dispose();
      }
      debugView.targetMarker = null;
    }

    const x = cat.nav.debugDestination.x;
    const z = cat.nav.debugDestination.z;
    const y = Math.max(0.08, cat.nav.debugDestination.y + 0.08);

    const group = new THREE.Group();
    group.position.set(x, y, z);

    const barLen = 0.72;
    const barThick = 0.075;
    const barGeo = new THREE.BoxGeometry(barLen, barThick, barThick);
    const barA = new THREE.Mesh(barGeo, DEBUG_TARGET_MESH_MAT);
    barA.rotation.y = Math.PI * 0.25;
    const barB = new THREE.Mesh(barGeo.clone(), DEBUG_TARGET_MESH_MAT);
    barB.rotation.y = -Math.PI * 0.25;
    group.add(barA, barB);

    group.renderOrder = 16;
    debugView.targetMarker = group;
    debugView.root.add(group);
  }

  function initDebugView(clockTime) {
    if (!DEBUG_VIEW.enabled) return;
    if (!debugView.root.parent) scene.add(debugView.root);
    if (!debugView.staticCollisionGroup.parent) debugView.root.add(debugView.staticCollisionGroup);
    if (!debugView.dynamicCollisionGroup.parent) debugView.root.add(debugView.dynamicCollisionGroup);
    if (!debugView.navObstacleGroup.parent) debugView.root.add(debugView.navObstacleGroup);
    debugView.root.visible = debugView.visible;
    rebuildStaticCollisionDebug();
    rebuildDynamicCollisionDebug();
    rebuildNavObstacleDebug();
    rebuildNavMeshDebug();
    rebuildCurrentPathDebug(clockTime);
    rebuildTargetMarkerDebug();
    debugView.nextNavRefreshAt = clockTime + DEBUG_VIEW.navRefreshInterval;
    updateDebugButtonLabel();
  }

  function updateDebugView(clockTime) {
    if (!DEBUG_VIEW.enabled) return;
    if (!debugView.visible) return;
    rebuildDynamicCollisionDebug();
    rebuildCurrentPathDebug(clockTime);
    rebuildTargetMarkerDebug();
    if (clockTime >= debugView.nextNavRefreshAt || !debugView.navMeshLines) {
      rebuildNavObstacleDebug();
      rebuildNavMeshDebug();
      debugView.nextNavRefreshAt = clockTime + DEBUG_VIEW.navRefreshInterval;
    }
  }

  function updateDebugButtonLabel() {
    if (!debugBtnEl) return;
    debugBtnEl.textContent = debugView.visible ? "Debug: On (B)" : "Debug: Off (B)";
  }

  function setDebugViewVisible(visible, clockTime) {
    debugView.visible = !!visible;
    debugView.root.visible = debugView.visible;
    if (debugView.visible) {
      debugView.nextNavRefreshAt = 0;
      updateDebugView(clockTime);
    }
    updateDebugButtonLabel();
  }

  function toggleDebugView(clockTime) {
    setDebugViewVisible(!debugView.visible, clockTime);
  }

  function onKeyDown(event, clockTime) {
    if (event.repeat) return;
    if ((event.key || "").toLowerCase() !== "b") return;
    if (event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")) return;
    event.preventDefault();
    toggleDebugView(clockTime);
  }

  return {
    enabled: DEBUG_VIEW.enabled,
    root: debugView.root,
    initDebugView,
    updateDebugView,
    toggleDebugView,
    onKeyDown,
  };
}
