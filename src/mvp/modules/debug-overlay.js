import { computeCupSwipePlan } from "./cat-plans.js";

export function createDebugOverlayRuntime(ctx) {
  const { THREE, scene, physics, pickups, cat, cup, desk, ROOM, CAT_NAV, CAT_COLLISION, CUP_COLLISION, debugBtnEl } = ctx;

  const DEBUG_VIEW = {
    enabled: true,
    navRefreshInterval: 0,
    staticCollisionColor: 0x9adf9f,
    dynamicCollisionColor: 0x9ec8ff,
    navObstacleColor: 0xe0d26a,
    navColor: 0xff8a00,
    pathColor: 0x1de9b6,
    targetColor: 0xff2f2f,
    pathRadius: 0.075,
  };
  const DEBUG_RENDER_MODE = {
    CLEAN_NAV: "cleanNav",
    FULL: "full",
  };

  const debugView = {
    root: new THREE.Group(),
    staticCollisionGroup: new THREE.Group(),
    dynamicCollisionGroup: new THREE.Group(),
    navObstacleGroup: new THREE.Group(),
    navMeshLines: null,
    navMeshFill: null,
    pathMesh: null,
    targetMarker: null,
    nextNavRefreshAt: 0,
    lastPathPoints: null,
    lastPathAt: 0,
    visible: false,
    renderMode: DEBUG_RENDER_MODE.CLEAN_NAV,
  };
  debugView.root.name = "debugView";
  debugView.staticCollisionGroup.name = "debugStaticCollision";
  debugView.dynamicCollisionGroup.name = "debugDynamicCollision";
  debugView.navObstacleGroup.name = "debugNavObstacles";

  const DEBUG_STATIC_COLLISION_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.staticCollisionColor,
    transparent: true,
    opacity: 0.34,
    depthTest: false,
  });
  const DEBUG_DYNAMIC_COLLISION_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.dynamicCollisionColor,
    transparent: true,
    opacity: 0.34,
    depthTest: false,
  });
  const DEBUG_NAV_OBSTACLE_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.navObstacleColor,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
  });
  const DEBUG_NAV_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.navColor,
    transparent: true,
    opacity: 0.68,
    depthTest: true,
    depthWrite: false,
  });
  const DEBUG_NAV_FILL_MAT = new THREE.MeshBasicMaterial({
    color: DEBUG_VIEW.navColor,
    transparent: true,
    opacity: 0.18,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
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
  const PATH_LIFT = 0.08;

  function clearDebugChildren(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
  }

  function makeDebugBoxEdges(hx, hy, hz, material = DEBUG_STATIC_COLLISION_MAT) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
    return new THREE.LineSegments(geo, material);
  }

  function makeDebugCircleLoop(radius, y = 0, segments = 28, material = DEBUG_STATIC_COLLISION_MAT) {
    const verts = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      verts.push(new THREE.Vector3(Math.cos(t) * radius, y, Math.sin(t) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    return new THREE.LineLoop(geo, material);
  }

  function makeDebugRectLoop(hx, hz, y = 0, material = DEBUG_STATIC_COLLISION_MAT) {
    const verts = [
      new THREE.Vector3(-hx, y, -hz),
      new THREE.Vector3(hx, y, -hz),
      new THREE.Vector3(hx, y, hz),
      new THREE.Vector3(-hx, y, hz),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    return new THREE.LineLoop(geo, material);
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
      const line = makeDebugBoxEdges(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z, DEBUG_DYNAMIC_COLLISION_MAT);
      line.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
      line.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      line.renderOrder = 13;
      debugView.dynamicCollisionGroup.add(line);
    }

    const catRing = makeDebugCircleLoop(CAT_COLLISION.catBodyRadius, 0.03, 36, DEBUG_DYNAMIC_COLLISION_MAT);
    catRing.position.set(cat.pos.x, cat.group.position.y, cat.pos.z);
    catRing.renderOrder = 13;
    debugView.dynamicCollisionGroup.add(catRing);

    if (!cup.broken) {
      const cupRing = makeDebugCircleLoop(CUP_COLLISION.radius, 0.03, 24, DEBUG_DYNAMIC_COLLISION_MAT);
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
        line = makeDebugCircleLoop(obs.r, 0.04, 30, DEBUG_NAV_OBSTACLE_MAT);
        line.position.set(obs.x, 0, obs.z);
      } else {
        line = makeDebugRectLoop(obs.hx, obs.hz, 0.04, DEBUG_NAV_OBSTACLE_MAT);
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
    if (debugView.navMeshFill) {
      debugView.root.remove(debugView.navMeshFill);
      debugView.navMeshFill.geometry.dispose();
      debugView.navMeshFill = null;
    }

    const linePoints = [];
    const facePoints = [];
    const navMesh = ctx.getNavMeshDebugData
      ? ctx.getNavMeshDebugData(true, true)
      : (ctx.getActiveNavMeshDebugData ? ctx.getActiveNavMeshDebugData() : null);
    if (!navMesh) return;
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

    if (Array.isArray(navMesh.triangles) && navMesh.triangles.length >= 9) {
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

    if (facePoints.length) {
      const fillGeo = new THREE.BufferGeometry();
      fillGeo.setAttribute("position", new THREE.Float32BufferAttribute(facePoints, 3));
      fillGeo.computeVertexNormals();
      const fill = new THREE.Mesh(fillGeo, DEBUG_NAV_FILL_MAT);
      fill.renderOrder = 9;
      debugView.navMeshFill = fill;
      debugView.root.add(fill);
    }

    if (linePoints.length) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePoints, 3));
      const lines = new THREE.LineSegments(lineGeo, DEBUG_NAV_MAT);
      lines.renderOrder = 10;
      debugView.navMeshLines = lines;
      debugView.root.add(lines);
    }
  }

  function applyRenderModeVisibility() {
    const clean = debugView.renderMode === DEBUG_RENDER_MODE.CLEAN_NAV;
    debugView.staticCollisionGroup.visible = !clean;
    debugView.dynamicCollisionGroup.visible = !clean;
    debugView.navObstacleGroup.visible = !clean;
  }

  function pushPathPoint(points, x, y, z, minGap = 0.01) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const p = new THREE.Vector3(x, y, z);
    const prev = points[points.length - 1];
    if (!prev || prev.distanceToSquared(p) > minGap * minGap) {
      points.push(p);
    }
  }

  function appendLine(points, from, to, yOverride = null) {
    if (!from || !to) return;
    const fy = yOverride == null ? (Number.isFinite(from.y) ? from.y : 0) : yOverride;
    const ty = yOverride == null ? (Number.isFinite(to.y) ? to.y : 0) : yOverride;
    pushPathPoint(points, from.x, fy, from.z);
    pushPathPoint(points, to.x, ty, to.z);
  }

  function liftedY(y = 0) {
    return (Number.isFinite(y) ? y : 0) + PATH_LIFT;
  }

  function appendSurfaceLine(points, from, to, surfaceY = 0) {
    appendLine(points, from, to, liftedY(surfaceY));
  }

  function appendJumpArc(points, from, fromY, to, toY, arc = 0.46, steps = 14) {
    if (!from || !to) return;
    const start = new THREE.Vector3(from.x, Number.isFinite(fromY) ? fromY : 0, from.z);
    const end = new THREE.Vector3(to.x, Number.isFinite(toY) ? toY : 0, to.z);
    pushPathPoint(points, start.x, liftedY(start.y), start.z);
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const uPos = THREE.MathUtils.smootherstep(u, 0, 1);
      const uY = Math.pow(u, 0.74);
      const x = THREE.MathUtils.lerp(start.x, end.x, uPos);
      const z = THREE.MathUtils.lerp(start.z, end.z, uPos);
      const y = THREE.MathUtils.lerp(start.y, end.y, uY) + Math.sin(Math.PI * u) * arc;
      pushPathPoint(points, x, liftedY(y), z);
    }
  }

  function appendGroundNavPath(points) {
    // Ground nav paths become stale/incorrect once the cat is on elevated surfaces.
    if (cat.group.position.y > 0.12) return false;
    const path = cat.nav.path;
    if (!Array.isArray(path) || path.length < 2) return false;
    const maxIdx = path.length - 1;
    const startIdx = Math.min(maxIdx, Math.max(1, cat.nav.index || 1));
    for (let i = startIdx; i < path.length; i++) {
      const p = path[i];
      pushPathPoint(points, p.x, liftedY(0), p.z);
    }
    return true;
  }

  function buildPlannedPath() {
    const points = [];

    if (cat.jump) {
      const jumpFrom = cat.jump.from || cat.pos;
      const jumpTo = cat.jump.to || cat.pos;
      const jumpToY = Number.isFinite(cat.jump.toY) ? cat.jump.toY : cat.group.position.y;
      pushPathPoint(
        points,
        jumpFrom.x,
        liftedY(Number.isFinite(cat.jump.fromY) ? cat.jump.fromY : cat.group.position.y),
        jumpFrom.z
      );
      appendJumpArc(
        points,
        jumpFrom,
        Number.isFinite(cat.jump.fromY) ? cat.jump.fromY : cat.group.position.y,
        jumpTo,
        jumpToY,
        Number.isFinite(cat.jump.arc) ? cat.jump.arc : 0.4,
        16
      );

      // Keep showing the full planned route after jump landing (do not truncate mid-air).
      const jumpLandingPoint = new THREE.Vector3(jumpTo.x, 0, jumpTo.z);
      if (cat.debugMoveActive) {
        if (cat.debugMoveSurface === "elevated") {
          const topY = Math.max(0.02, cat.debugMoveY || jumpToY || desk.topY + 0.02);
          appendSurfaceLine(points, jumpLandingPoint, cat.debugMoveTarget, topY);
        } else {
          appendSurfaceLine(points, jumpLandingPoint, cat.debugMoveTarget, 0);
        }
      } else if (jumpToY > 0.2) {
        const desired = typeof ctx.getDeskDesiredTarget === "function" ? ctx.getDeskDesiredTarget() : null;
        if (desired && Number.isFinite(desired.x) && Number.isFinite(desired.z)) {
          appendSurfaceLine(points, jumpLandingPoint, desired, Math.max(desk.topY + 0.02, jumpToY));
        }
      } else {
        const target = cat.nav?.debugDestination;
        if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
          appendSurfaceLine(points, jumpLandingPoint, new THREE.Vector3(target.x, 0, target.z), 0);
        }
      }
      return points;
    }

    pushPathPoint(points, cat.pos.x, liftedY(cat.group.position.y), cat.pos.z);

    if ((cat.state === "toCup" || cat.state === "swipe") && cat.group.position.y > 0.12 && !cup.broken && !cup.falling) {
      const swipePlan = computeCupSwipePlan(THREE, desk, cup.group.position);
      const deskY = desk.topY + 0.02;
      appendSurfaceLine(points, cat.pos, swipePlan.point, deskY);
      appendSurfaceLine(points, swipePlan.point, cup.group.position, deskY);
      return points;
    }

    const isDeskJumpPlanState = cat.state === "toDesk" || cat.state === "prepareJump";
    if (isDeskJumpPlanState && cat.jumpAnchor) {
      const hasNav = appendGroundNavPath(points);
      if (!hasNav) appendSurfaceLine(points, cat.pos, cat.jumpAnchor, 0);
      else pushPathPoint(points, cat.jumpAnchor.x, liftedY(0), cat.jumpAnchor.z);

      let jumpTargets = cat.jumpTargets;
      if (!jumpTargets && typeof ctx.computeDeskJumpTargets === "function") {
        const desiredTarget = typeof ctx.getDeskDesiredTarget === "function" ? ctx.getDeskDesiredTarget() : null;
        jumpTargets = ctx.computeDeskJumpTargets(cat.jumpAnchor, desiredTarget);
      }
      if (jumpTargets?.hook) appendSurfaceLine(points, cat.jumpAnchor, jumpTargets.hook, 0);
      if (jumpTargets?.top) {
        const jumpFrom = jumpTargets.hook || cat.jumpAnchor;
        appendJumpArc(points, jumpFrom, 0, jumpTargets.top, desk.topY + 0.02, 0.46, 16);
      }
      return points;
    }

    if (cat.debugMoveActive && cat.debugMoveSurface === "elevated" && !cat.onTable) {
      const hasNav = appendGroundNavPath(points);
      if (!hasNav) appendSurfaceLine(points, cat.pos, cat.debugMoveJumpAnchor, 0);
      else pushPathPoint(points, cat.debugMoveJumpAnchor.x, liftedY(0), cat.debugMoveJumpAnchor.z);
      appendJumpArc(
        points,
        cat.debugMoveJumpAnchor,
        0,
        cat.debugMoveLanding,
        Math.max(0.02, cat.debugMoveY || desk.topY + 0.02),
        0.46,
        14
      );
      appendLine(
        points,
        cat.debugMoveLanding,
        cat.debugMoveTarget,
        liftedY(Math.max(0.02, cat.debugMoveY || desk.topY + 0.02))
      );
      return points;
    }

    if (cat.debugMoveActive && cat.debugMoveSurface === "elevated" && cat.onTable) {
      const y = Math.max(0.02, cat.debugMoveY || desk.topY + 0.02);
      appendSurfaceLine(points, cat.pos, cat.debugMoveTarget, y);
      return points;
    }

    if (cat.debugMoveActive && cat.debugMoveSurface === "floor" && (cat.onTable || cat.group.position.y > 0.08)) {
      appendSurfaceLine(points, cat.pos, cat.debugMoveJumpOff, cat.group.position.y);
      appendJumpArc(points, cat.debugMoveJumpOff, cat.group.position.y, cat.debugMoveJumpDown, 0, 0.34, 12);
      appendSurfaceLine(points, cat.debugMoveJumpDown, cat.debugMoveTarget, 0);
      return points;
    }

    if (appendGroundNavPath(points)) return points;

    const target = cat.nav.debugDestination;
    if (Number.isFinite(target.x) && Number.isFinite(target.z)) {
      const samePlane = Math.abs((target.y || 0) - cat.group.position.y) <= 0.35;
      if (cat.group.position.y <= 0.12 || samePlane) {
        const surfaceY = cat.group.position.y <= 0.12 ? 0 : (target.y || cat.group.position.y);
        appendSurfaceLine(points, cat.pos, new THREE.Vector3(target.x, target.y || 0, target.z), surfaceY);
      }
    }
    return points;
  }

  function rebuildCurrentPathDebug(clockTime) {
    if (!DEBUG_VIEW.enabled) return;

    let path = buildPlannedPath();
    if (!path || path.length < 2) {
      const airborne = !!cat.jump || (!cat.onTable && cat.group.position.y > 0.08);
      if (airborne && Array.isArray(debugView.lastPathPoints) && debugView.lastPathPoints.length >= 2 && clockTime - debugView.lastPathAt <= 0.4) {
        path = debugView.lastPathPoints;
      }
    } else {
      debugView.lastPathPoints = path.map((p) => p.clone());
      debugView.lastPathAt = clockTime;
    }

    if (!path || path.length < 2) {
      if (debugView.pathMesh) debugView.pathMesh.visible = false;
      return;
    }

    const polyline = path.map((p) => new THREE.Vector3(p.x, Number.isFinite(p.y) ? p.y : 0.08, p.z));
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
    applyRenderModeVisibility();
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
    if (DEBUG_VIEW.navRefreshInterval <= 0 || clockTime >= debugView.nextNavRefreshAt || !debugView.navMeshLines) {
      rebuildNavObstacleDebug();
      rebuildNavMeshDebug();
      debugView.nextNavRefreshAt = clockTime + DEBUG_VIEW.navRefreshInterval;
    }
  }

  function updateDebugButtonLabel() {
    if (!debugBtnEl) return;
    const modeLabel = debugView.renderMode === DEBUG_RENDER_MODE.CLEAN_NAV ? "Clean" : "Full";
    debugBtnEl.textContent = debugView.visible
      ? `Debug: On ${modeLabel} (B, N mode, Right-click walk, T teleport)`
      : "Debug: Off (B)";
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
    const key = (event.key || "").toLowerCase();
    if (event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")) return;
    if (key === "n") {
      event.preventDefault();
      debugView.renderMode =
        debugView.renderMode === DEBUG_RENDER_MODE.CLEAN_NAV
          ? DEBUG_RENDER_MODE.FULL
          : DEBUG_RENDER_MODE.CLEAN_NAV;
      applyRenderModeVisibility();
      updateDebugButtonLabel();
      return;
    }
    if (key !== "b") return;
    event.preventDefault();
    toggleDebugView(clockTime);
  }

  function isDebugVisible() {
    return !!debugView.visible;
  }

  return {
    enabled: DEBUG_VIEW.enabled,
    root: debugView.root,
    initDebugView,
    updateDebugView,
    toggleDebugView,
    onKeyDown,
    isDebugVisible,
  };
}
