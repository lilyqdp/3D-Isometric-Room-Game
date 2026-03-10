import { computeCupSwipePlan } from "./cat-plans.js";

export function createDebugOverlayRuntime(ctx) {
  const {
    THREE,
    scene,
    physics,
    pickups,
    cat,
    cup,
    desk,
    ROOM,
    CAT_NAV,
    CAT_COLLISION,
    CUP_COLLISION,
    debugBtnEl,
    getTimeScale,
    setTimeScale,
  } = ctx;

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
  const ADVANCED_TOGGLE_DEFS = [
    { key: "fullOverlayMode", label: "N full overlay mode", default: false },
    { key: "showRoomBoundary", label: "Room boundary", default: false },
    { key: "showStaticBounds", label: "Static colliders", default: false },
    { key: "showPickupBodies", label: "Pickup body boxes", default: false },
    { key: "showPickupBodySolid", label: "Pickup collision solids", default: false },
    { key: "showPickupCenters", label: "Pickup center points", default: false },
    { key: "showCatBody", label: "Cat body radius", default: false },
    { key: "showCatBodySolid", label: "Cat collision solid", default: false },
    { key: "showCatPathClearance", label: "Cat path clearance", default: false },
    { key: "showCatShoveVolume", label: "Cat shove trigger volume", default: false },
    { key: "showCatCenter", label: "Cat center point", default: false },
    { key: "showCupCollider", label: "Cup collider", default: false },
    { key: "showCatPickupLinks", label: "Cat-pickup links", default: false },
    { key: "showPickupTriggerHits", label: "Pickup active shove hits", default: false },
    { key: "showNavObstacles", label: "Nav obstacles", default: false },
    { key: "showNavObstacleRaw", label: "Nav obstacle cores (raw)", default: false },
    { key: "showNavMeshLines", label: "NavMesh edges", default: true },
    { key: "showNavMeshFill", label: "NavMesh fill", default: true },
    { key: "showCurrentPath", label: "Current planned path", default: true },
    { key: "showTargetMarker", label: "Target marker", default: true },
    { key: "showAStarChecks", label: "A* checked edges", default: true },
    { key: "showAStarAcceptedOnly", label: "A* accepted only", default: false },
    { key: "showAStarBlocked", label: "A* blocked checks", default: true },
    { key: "showAStarEndpoints", label: "A* start/goal markers", default: true },
    { key: "showAStarFinalPath", label: "A* final path", default: true },
    { key: "showNavTelemetry", label: "Live nav telemetry panel", default: false },
  ];
  const DEFAULT_ADVANCED_FLAGS = Object.fromEntries(
    ADVANCED_TOGGLE_DEFS.map((def) => [def.key, !!def.default])
  );
  const FULL_OVERLAY_KEYS = [
    "showRoomBoundary",
    "showStaticBounds",
    "showPickupBodies",
    "showPickupBodySolid",
    "showCatBody",
    "showCatBodySolid",
    "showCatPathClearance",
    "showCatShoveVolume",
    "showCupCollider",
    "showCatPickupLinks",
    "showPickupTriggerHits",
    "showNavObstacles",
    "showNavObstacleRaw",
  ];

  const debugView = {
    root: new THREE.Group(),
    staticCollisionGroup: new THREE.Group(),
    dynamicCollisionGroup: new THREE.Group(),
    navObstacleGroup: new THREE.Group(),
    astarGroup: new THREE.Group(),
    navMeshLines: null,
    navMeshFill: null,
    pathMesh: null,
    targetMarker: null,
    nextNavRefreshAt: 0,
    lastPathPoints: null,
    lastPathAt: 0,
    visible: false,
    advancedPanelVisible: false,
    advancedFlags: { ...DEFAULT_ADVANCED_FLAGS },
  };
  const pickupTriggerFlashUntil = new WeakMap();
  debugView.root.name = "debugView";
  debugView.staticCollisionGroup.name = "debugStaticCollision";
  debugView.dynamicCollisionGroup.name = "debugDynamicCollision";
  debugView.navObstacleGroup.name = "debugNavObstacles";
  debugView.astarGroup.name = "debugAStar";

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
  const DEBUG_CAT_COLLISION_MAT = new THREE.LineBasicMaterial({
    color: 0x36f2ff,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  });
  const DEBUG_CAT_CLEARANCE_MAT = new THREE.LineBasicMaterial({
    color: 0xffc361,
    transparent: true,
    opacity: 0.78,
    depthTest: false,
  });
  const DEBUG_CAT_TRIGGER_ACTIVE_MAT = new THREE.LineBasicMaterial({
    color: 0xff3b3b,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const DEBUG_CAT_CENTER_MAT = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
  });
  const DEBUG_PICKUP_SOLID_MAT = new THREE.MeshBasicMaterial({
    color: 0x87b9ff,
    transparent: true,
    opacity: 0.15,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_CAT_SOLID_MAT = new THREE.MeshBasicMaterial({
    color: 0x35d9ff,
    transparent: true,
    opacity: 0.16,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_CAT_SHOVE_SOLID_MAT = new THREE.MeshBasicMaterial({
    color: 0xff9a3d,
    transparent: true,
    opacity: 0.14,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_PICKUP_CENTER_MAT = new THREE.MeshBasicMaterial({
    color: 0xff66ff,
    depthTest: false,
  });
  const DEBUG_CAT_LINK_INACTIVE_MAT = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
  });
  const DEBUG_CAT_LINK_ACTIVE_MAT = new THREE.LineBasicMaterial({
    color: 0xff3b3b,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const DEBUG_NAV_OBSTACLE_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.navObstacleColor,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
  });
  const DEBUG_NAV_OBSTACLE_RAW_MAT = new THREE.LineBasicMaterial({
    color: 0xf6f6d8,
    transparent: true,
    opacity: 0.55,
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
  const DEBUG_ASTAR_FINAL_PATH_MAT = new THREE.LineBasicMaterial({
    color: 0xff66d2,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const PATH_LIFT = 0.08;
  let debugTimeScaleWrap = null;
  let debugTimeScaleInput = null;
  let debugTimeScaleValue = null;
  let debugAdvancedWrap = null;
  let debugTelemetryWrap = null;
  let debugTelemetryPre = null;
  const debugAdvancedInputs = new Map();

  function clampTimeScale(value) {
    const v = Number.isFinite(value) ? value : 1;
    return THREE.MathUtils.clamp(v, 0, 2);
  }

  function getCurrentTimeScale() {
    return typeof getTimeScale === "function" ? clampTimeScale(getTimeScale()) : 1;
  }

  function updateTimeScaleValueLabel() {
    if (!debugTimeScaleValue) return;
    debugTimeScaleValue.textContent = `${getCurrentTimeScale().toFixed(2)}x`;
  }

  function syncTimeScaleControlsFromState() {
    if (debugTimeScaleInput) debugTimeScaleInput.value = String(getCurrentTimeScale());
    updateTimeScaleValueLabel();
  }

  function setTimeScaleControlVisible() {
    if (!debugTimeScaleWrap) return;
    debugTimeScaleWrap.style.display = debugView.visible ? "flex" : "none";
  }

  function initTimeScaleControl() {
    if (!debugBtnEl || debugTimeScaleWrap) return;
    const buttonsRow = debugBtnEl.parentElement;
    if (!buttonsRow || !buttonsRow.parentElement) return;

    debugTimeScaleWrap = document.createElement("div");
    debugTimeScaleWrap.style.display = "none";
    debugTimeScaleWrap.style.marginTop = "8px";
    debugTimeScaleWrap.style.alignItems = "center";
    debugTimeScaleWrap.style.gap = "8px";
    debugTimeScaleWrap.style.fontSize = "12px";

    const label = document.createElement("span");
    label.textContent = "Debug speed";
    label.style.opacity = "0.9";

    debugTimeScaleInput = document.createElement("input");
    debugTimeScaleInput.type = "range";
    debugTimeScaleInput.min = "0";
    debugTimeScaleInput.max = "2";
    debugTimeScaleInput.step = "0.05";
    debugTimeScaleInput.style.flex = "1";
    debugTimeScaleInput.style.minWidth = "140px";

    debugTimeScaleValue = document.createElement("span");
    debugTimeScaleValue.style.fontWeight = "700";
    debugTimeScaleValue.style.minWidth = "46px";
    debugTimeScaleValue.style.textAlign = "right";

    debugTimeScaleInput.addEventListener("input", () => {
      const next = clampTimeScale(Number(debugTimeScaleInput.value));
      if (typeof setTimeScale === "function") setTimeScale(next);
      syncTimeScaleControlsFromState();
    });

    debugTimeScaleWrap.append(label, debugTimeScaleInput, debugTimeScaleValue);
    buttonsRow.insertAdjacentElement("afterend", debugTimeScaleWrap);
    syncTimeScaleControlsFromState();
  }

  function syncAdvancedControlsFromState() {
    for (const [key, input] of debugAdvancedInputs.entries()) {
      input.checked = !!debugView.advancedFlags[key];
    }
  }

  function refreshDebugMeshes(clockTime = 0) {
    if (!debugView.visible) return;
    rebuildStaticCollisionDebug();
    rebuildDynamicCollisionDebug(clockTime);
    rebuildNavObstacleDebug();
    rebuildNavMeshDebug();
    rebuildCurrentPathDebug(clockTime);
    rebuildTargetMarkerDebug();
    rebuildAStarDebug();
  }

  function setFullOverlayMode(enabled, clockTime = 0) {
    const on = !!enabled;
    debugView.advancedFlags.fullOverlayMode = on;
    for (const key of FULL_OVERLAY_KEYS) {
      debugView.advancedFlags[key] = on;
    }
    syncAdvancedControlsFromState();
    applyRenderModeVisibility();
    refreshDebugMeshes(clockTime);
  }

  function setAdvancedControlVisible() {
    if (!debugAdvancedWrap) return;
    debugAdvancedWrap.style.display = debugView.visible && debugView.advancedPanelVisible ? "grid" : "none";
    if (debugTelemetryWrap) {
      debugTelemetryWrap.style.display =
        debugView.visible && debugView.advancedPanelVisible && isFlagOn("showNavTelemetry") ? "block" : "none";
    }
  }

  function initAdvancedControl() {
    if (!debugBtnEl || debugAdvancedWrap) return;
    const buttonsRow = debugBtnEl.parentElement;
    if (!buttonsRow || !buttonsRow.parentElement) return;

    debugAdvancedWrap = document.createElement("div");
    debugAdvancedWrap.style.display = "none";
    debugAdvancedWrap.style.marginTop = "10px";
    debugAdvancedWrap.style.padding = "8px 10px";
    debugAdvancedWrap.style.border = "1px solid rgba(255,255,255,0.2)";
    debugAdvancedWrap.style.borderRadius = "8px";
    debugAdvancedWrap.style.background = "rgba(8, 12, 18, 0.62)";
    debugAdvancedWrap.style.gridTemplateColumns = "repeat(2, minmax(180px, 1fr))";
    debugAdvancedWrap.style.gap = "6px 12px";
    debugAdvancedWrap.style.alignItems = "center";
    debugAdvancedWrap.style.fontSize = "12px";

    const title = document.createElement("div");
    title.textContent = "Advanced Debug Options";
    title.style.gridColumn = "1 / -1";
    title.style.fontWeight = "700";
    title.style.opacity = "0.95";
    debugAdvancedWrap.appendChild(title);

    for (const def of ADVANCED_TOGGLE_DEFS) {
      const row = document.createElement("label");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.cursor = "pointer";
      row.style.whiteSpace = "nowrap";
      row.style.userSelect = "none";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!debugView.advancedFlags[def.key];
      input.addEventListener("change", () => {
        if (def.key === "fullOverlayMode") {
          setFullOverlayMode(!!input.checked);
          updateDebugButtonLabel();
          return;
        }
        debugView.advancedFlags[def.key] = !!input.checked;
        if (FULL_OVERLAY_KEYS.includes(def.key)) {
          debugView.advancedFlags.fullOverlayMode = FULL_OVERLAY_KEYS.every((key) => !!debugView.advancedFlags[key]);
        }
        syncAdvancedControlsFromState();
        applyRenderModeVisibility();
        setAdvancedControlVisible();
        refreshDebugMeshes(0);
        updateDebugButtonLabel();
      });
      debugAdvancedInputs.set(def.key, input);

      const text = document.createElement("span");
      text.textContent = def.label;
      row.append(input, text);
      debugAdvancedWrap.appendChild(row);
    }

    const insertAfter = debugTimeScaleWrap || buttonsRow;
    insertAfter.insertAdjacentElement("afterend", debugAdvancedWrap);

    debugTelemetryWrap = document.createElement("div");
    debugTelemetryWrap.style.display = "none";
    debugTelemetryWrap.style.marginTop = "8px";
    debugTelemetryWrap.style.padding = "8px 10px";
    debugTelemetryWrap.style.border = "1px solid rgba(255,255,255,0.18)";
    debugTelemetryWrap.style.borderRadius = "8px";
    debugTelemetryWrap.style.background = "rgba(3, 8, 12, 0.74)";
    debugTelemetryWrap.style.maxHeight = "220px";
    debugTelemetryWrap.style.overflow = "auto";

    debugTelemetryPre = document.createElement("pre");
    debugTelemetryPre.style.margin = "0";
    debugTelemetryPre.style.fontSize = "11px";
    debugTelemetryPre.style.lineHeight = "1.35";
    debugTelemetryPre.style.whiteSpace = "pre-wrap";
    debugTelemetryPre.style.wordBreak = "break-word";
    debugTelemetryPre.style.color = "#d6ecff";
    debugTelemetryWrap.appendChild(debugTelemetryPre);

    debugAdvancedWrap.insertAdjacentElement("afterend", debugTelemetryWrap);
    syncAdvancedControlsFromState();
  }

  function clearDebugChildren(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.userData?.disposeMaterial && child.material) {
        if (Array.isArray(child.material)) {
          for (const mat of child.material) mat?.dispose?.();
        } else {
          child.material.dispose?.();
        }
      }
    }
  }

  function isFlagOn(key) {
    return !!debugView.advancedFlags[key];
  }

  function formatNum(v, digits = 3) {
    if (!Number.isFinite(v)) return "na";
    return v.toFixed(digits);
  }

  function updateNavTelemetry(clockTime = 0) {
    if (!debugTelemetryPre) return;
    if (!debugView.visible || !debugView.advancedPanelVisible || !isFlagOn("showNavTelemetry")) {
      debugTelemetryPre.textContent = "";
      return;
    }
    const counters = cat.nav?.debugCounters || {};
    const step = cat.nav?.debugStep || {};
    const events = Array.isArray(cat.nav?.debugEvents) ? cat.nav.debugEvents : [];
    const recent = events.slice(-8);
    const lines = [];
    lines.push(`state=${cat.state} status=${cat.status}`);
    lines.push(`pos=(${formatNum(cat.pos.x, 2)}, ${formatNum(cat.group.position.y, 2)}, ${formatNum(cat.pos.z, 2)}) onTable=${cat.onTable ? "yes" : "no"}`);
    lines.push(`path len=${cat.nav?.path?.length || 0} idx=${cat.nav?.index || 0} stuckT=${formatNum(cat.nav?.stuckT || 0, 3)} repathAt=${formatNum((cat.nav?.repathAt || 0) - clockTime, 2)}s`);
    lines.push(`step reason=${step.reason || "na"} phase=${step.phase || "na"} direct=${step.direct ? "y" : "n"} dynIgnore=${step.ignoreDynamic ? "y" : "n"} turnOnly=${step.turnOnly ? "y" : "n"} turnOnlyT=${formatNum(step.turnOnlyT || 0, 2)} noSteerFrames=${step.noSteerFrames || 0}`);
    lines.push(`target=(${formatNum(step.targetX, 2)}, ${formatNum(step.targetZ, 2)}) chase=(${formatNum(step.chaseX, 2)}, ${formatNum(step.chaseZ, 2)}) d=${formatNum(step.distToChase || 0, 3)}`);
    lines.push(`yawDelta=${formatNum(step.rawYawDelta || 0, 3)} overlapDynamic=${formatNum(step.overlapDynamic || 0, 3)} overlapStatic=${formatNum(step.overlapStatic || 0, 3)} blockedPosS=${step.posBlockedStatic ? "y" : "n"} blockedPosD=${step.posBlockedDynamic ? "y" : "n"} speed=${formatNum(cat.nav?.lastSpeed || 0, 3)} cmd=${formatNum(cat.nav?.commandedSpeed || 0, 3)}`);
    lines.push(`counters noPath=${counters.noPath || 0} noSteer=${counters.noSteer || 0} repath=${counters.repath || 0} turnOnlyRepath=${counters.turnOnlyRepath || 0} segmentRescue=${counters.segmentRescue || 0} escape=${counters.escape || 0} rollback=${counters.rollback || 0} rescue=${counters.rescueSnap || 0}`);
    if (recent.length) {
      lines.push("events:");
      for (let i = 0; i < recent.length; i++) {
        const e = recent[i];
        const dt = clockTime - (e.t || clockTime);
        lines.push(`  - ${formatNum(dt, 2)}s ago | ${e.kind || "evt"} | state=${e.state || "?"}`);
      }
    }
    debugTelemetryPre.textContent = lines.join("\n");
  }

  function makeDebugBoxEdges(hx, hy, hz, material = DEBUG_STATIC_COLLISION_MAT) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
    return new THREE.LineSegments(geo, material);
  }

  function makeDebugBoxSolid(hx, hy, hz, material = DEBUG_PICKUP_SOLID_MAT) {
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    return new THREE.Mesh(geo, material);
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

  function makeDebugCylinderWire(radius, height = 0.08, segments = 32, material = DEBUG_DYNAMIC_COLLISION_MAT) {
    const segs = Math.max(8, segments | 0);
    const h = Math.max(0.01, height);
    const y0 = -h * 0.5;
    const y1 = h * 0.5;
    const verts = [];
    const verticalStep = Math.max(1, Math.floor(segs / 8));

    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * Math.PI * 2;
      const t1 = ((i + 1) / segs) * Math.PI * 2;
      const x0 = Math.cos(t0) * radius;
      const z0 = Math.sin(t0) * radius;
      const x1 = Math.cos(t1) * radius;
      const z1 = Math.sin(t1) * radius;

      // Bottom ring
      verts.push(x0, y0, z0, x1, y0, z1);
      // Top ring
      verts.push(x0, y1, z0, x1, y1, z1);
      // Vertical ribs
      if (i % verticalStep === 0) {
        verts.push(x0, y0, z0, x0, y1, z0);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    return new THREE.LineSegments(geo, material);
  }

  function makeDebugCylinderSolid(radius, height = 0.08, segments = 32, material = DEBUG_CAT_SOLID_MAT) {
    const geo = new THREE.CylinderGeometry(Math.max(0.001, radius), Math.max(0.001, radius), Math.max(0.01, height), Math.max(8, segments | 0));
    return new THREE.Mesh(geo, material);
  }

  function makeDebugCenterMarker(size = 0.025, material = DEBUG_CAT_CENTER_MAT) {
    return new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), material);
  }

  function rebuildStaticCollisionDebug() {
    if (!DEBUG_VIEW.enabled) return;
    clearDebugChildren(debugView.staticCollisionGroup);
    if (!isFlagOn("showStaticBounds") && !isFlagOn("showRoomBoundary")) return;

    if (isFlagOn("showRoomBoundary")) {
      const hx = (ROOM.maxX - ROOM.minX) * 0.5;
      const hz = (ROOM.maxZ - ROOM.minZ) * 0.5;
      const centerX = (ROOM.minX + ROOM.maxX) * 0.5;
      const centerZ = (ROOM.minZ + ROOM.maxZ) * 0.5;
      const roomLoop = makeDebugRectLoop(hx, hz, 0.03, DEBUG_STATIC_COLLISION_MAT);
      roomLoop.position.set(centerX, 0, centerZ);
      roomLoop.renderOrder = 12;
      debugView.staticCollisionGroup.add(roomLoop);
    }

    if (isFlagOn("showStaticBounds")) {
      for (const box of physics.staticBoxes) {
        const line = makeDebugBoxEdges(box.hx, box.hy, box.hz);
        line.position.set(box.x, box.y, box.z);
        line.rotation.y = box.rotY || 0;
        line.renderOrder = 12;
        debugView.staticCollisionGroup.add(line);
      }
    }
  }

  function rebuildDynamicCollisionDebug(clockTime = 0) {
    if (!DEBUG_VIEW.enabled) return;
    clearDebugChildren(debugView.dynamicCollisionGroup);
    if (
      !isFlagOn("showPickupBodies") &&
      !isFlagOn("showPickupBodySolid") &&
      !isFlagOn("showPickupCenters") &&
      !isFlagOn("showCatBody") &&
      !isFlagOn("showCatBodySolid") &&
      !isFlagOn("showCatPathClearance") &&
      !isFlagOn("showCatShoveVolume") &&
      !isFlagOn("showCatCenter") &&
      !isFlagOn("showCatPickupLinks") &&
      !isFlagOn("showPickupTriggerHits") &&
      !isFlagOn("showCupCollider")
    ) {
      return;
    }

    if (isFlagOn("showPickupBodies") || isFlagOn("showPickupBodySolid")) {
      for (const p of pickups) {
        const shape = p.body.shapes[0];
        if (!shape || !shape.halfExtents) continue;
        if (isFlagOn("showPickupBodies")) {
          const line = makeDebugBoxEdges(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z, DEBUG_DYNAMIC_COLLISION_MAT);
          line.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
          line.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
          line.renderOrder = 13;
          debugView.dynamicCollisionGroup.add(line);
        }
        if (isFlagOn("showPickupBodySolid")) {
          const solid = makeDebugBoxSolid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z, DEBUG_PICKUP_SOLID_MAT);
          solid.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
          solid.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
          solid.renderOrder = 12;
          debugView.dynamicCollisionGroup.add(solid);
        }
      }
    }

    const catCollisionRadius = Math.max(0.01, CAT_COLLISION.catBodyRadius);
    const catPathClearance = typeof ctx.getCatPathClearance === "function"
      ? Math.max(catCollisionRadius, ctx.getCatPathClearance())
      : catCollisionRadius;
    const catMoveCollisionRadius = Math.max(catCollisionRadius, catPathClearance);
    const catLayerHeight = 0.06;
    const catBaseY = cat.group.position.y;

    // Exact cat collision footprint used by pathing checks (2.5D disk at query Y),
    // rendered as a thin 3D cylinder for better visibility.
    if (isFlagOn("showCatBody")) {
      const catCollisionBody = makeDebugCylinderWire(catCollisionRadius, catLayerHeight, 40, DEBUG_CAT_COLLISION_MAT);
      catCollisionBody.position.set(cat.pos.x, catBaseY + catLayerHeight * 0.5, cat.pos.z);
      catCollisionBody.renderOrder = 13;
      debugView.dynamicCollisionGroup.add(catCollisionBody);
    }
    if (isFlagOn("showCatBodySolid")) {
      const catCollisionSolid = makeDebugCylinderSolid(catCollisionRadius, catLayerHeight, 28, DEBUG_CAT_SOLID_MAT);
      catCollisionSolid.position.set(cat.pos.x, catBaseY + catLayerHeight * 0.5, cat.pos.z);
      catCollisionSolid.renderOrder = 12;
      debugView.dynamicCollisionGroup.add(catCollisionSolid);
    }

    // Exact radius used by "cat hits obstacle" movement collision checks.
    if (isFlagOn("showCatPathClearance") && catMoveCollisionRadius > catCollisionRadius + 1e-4) {
      const catClearanceBody = makeDebugCylinderWire(catMoveCollisionRadius, catLayerHeight, 40, DEBUG_CAT_CLEARANCE_MAT);
      catClearanceBody.position.set(cat.pos.x, catBaseY + catLayerHeight * 0.5, cat.pos.z);
      catClearanceBody.renderOrder = 13;
      debugView.dynamicCollisionGroup.add(catClearanceBody);
    }

    if (isFlagOn("showCatShoveVolume")) {
      const triggerHeight = 0.36;
      const shoveVol = makeDebugCylinderSolid(catCollisionRadius, triggerHeight, 28, DEBUG_CAT_SHOVE_SOLID_MAT);
      shoveVol.position.set(cat.pos.x, catBaseY + triggerHeight * 0.5, cat.pos.z);
      shoveVol.renderOrder = 11;
      debugView.dynamicCollisionGroup.add(shoveVol);
      const shoveWire = makeDebugCylinderWire(catCollisionRadius, triggerHeight, 32, DEBUG_CAT_TRIGGER_ACTIVE_MAT);
      shoveWire.position.set(cat.pos.x, catBaseY + triggerHeight * 0.5, cat.pos.z);
      shoveWire.renderOrder = 13;
      debugView.dynamicCollisionGroup.add(shoveWire);
    }

    if (isFlagOn("showCatPickupLinks") || isFlagOn("showCatCenter")) {
      const catCenterMarker = makeDebugCenterMarker(0.03, DEBUG_CAT_CENTER_MAT);
      catCenterMarker.position.set(cat.pos.x, catBaseY + 0.03, cat.pos.z);
      catCenterMarker.renderOrder = 14;
      debugView.dynamicCollisionGroup.add(catCenterMarker);
    }

    // Exact pickup-vs-cat shove test uses circle-vs-OBB in XZ + Y overlap.
    const catMinY = catBaseY - 0.02;
    const catMaxY = catBaseY + 0.34;
    // Show pickup centers/links and highlight current shove-trigger pickups.
    for (const p of pickups) {
      if (!p?.body) continue;
      const shape = p.body.shapes?.[0];
      if (!shape?.halfExtents) continue;
      const pHalfY = shape.halfExtents.y;
      const pickupMinY = p.body.position.y - pHalfY;
      const pickupMaxY = p.body.position.y + pHalfY;
      const overlapsCatHeight = pickupMaxY >= catMinY && pickupMinY <= catMaxY;
      const linkStart = new THREE.Vector3(cat.pos.x, catBaseY + 0.02, cat.pos.z);
      const linkEnd = new THREE.Vector3(p.body.position.x, p.body.position.y, p.body.position.z);

      if (isFlagOn("showCatPickupLinks") || isFlagOn("showPickupCenters")) {
        const pickupCenterMarker = makeDebugCenterMarker(0.028, DEBUG_PICKUP_CENTER_MAT);
        pickupCenterMarker.position.set(p.body.position.x, p.body.position.y + 0.03, p.body.position.z);
        pickupCenterMarker.renderOrder = 14;
        debugView.dynamicCollisionGroup.add(pickupCenterMarker);
      }

      const toLocal = linkStart.clone().sub(linkEnd);
      const invQuat = new THREE.Quaternion(
        p.body.quaternion.x,
        p.body.quaternion.y,
        p.body.quaternion.z,
        p.body.quaternion.w
      ).invert();
      toLocal.applyQuaternion(invQuat);
      const clampedX = THREE.MathUtils.clamp(toLocal.x, -shape.halfExtents.x, shape.halfExtents.x);
      const clampedZ = THREE.MathUtils.clamp(toLocal.z, -shape.halfExtents.z, shape.halfExtents.z);
      const sepX = toLocal.x - clampedX;
      const sepZ = toLocal.z - clampedZ;
      const distSq = sepX * sepX + sepZ * sepZ;
      const droppedOnCat =
        p.body.velocity.y < -0.42 &&
        (p.body.position.y - shape.halfExtents.y) >= (cat.group.position.y + 0.34) - 0.02;
      const triggerNow = overlapsCatHeight && distSq < catCollisionRadius * catCollisionRadius && droppedOnCat;
      if (triggerNow) {
        pickupTriggerFlashUntil.set(p, clockTime + 0.45);
      }

      if (isFlagOn("showCatPickupLinks")) {
        const linkGeo = new THREE.BufferGeometry().setFromPoints([linkStart, linkEnd]);
        const link = new THREE.Line(linkGeo, triggerNow ? DEBUG_CAT_LINK_ACTIVE_MAT : DEBUG_CAT_LINK_INACTIVE_MAT);
        link.renderOrder = 13;
        debugView.dynamicCollisionGroup.add(link);
      }

      const flashUntil = pickupTriggerFlashUntil.get(p) || 0;
      if (!isFlagOn("showPickupTriggerHits") || clockTime > flashUntil) continue;

      const activeRing = makeDebugCircleLoop(Math.max(0.05, Math.max(shape.halfExtents.x, shape.halfExtents.z) * 1.1), 0, 24, DEBUG_CAT_TRIGGER_ACTIVE_MAT);
      activeRing.position.set(p.body.position.x, p.body.position.y + pHalfY + 0.015, p.body.position.z);
      activeRing.scale.setScalar(1.15);
      activeRing.renderOrder = 14;
      debugView.dynamicCollisionGroup.add(activeRing);
    }

    if (isFlagOn("showCupCollider") && !cup.broken) {
      const cupRing = makeDebugCircleLoop(CUP_COLLISION.radius, 0.03, 24, DEBUG_DYNAMIC_COLLISION_MAT);
      cupRing.position.set(cup.group.position.x, cup.group.position.y, cup.group.position.z);
      cupRing.renderOrder = 13;
      debugView.dynamicCollisionGroup.add(cupRing);
    }
  }

  function rebuildNavObstacleDebug() {
    if (!DEBUG_VIEW.enabled) return;
    clearDebugChildren(debugView.navObstacleGroup);
    const showInflated = isFlagOn("showNavObstacles");
    const showRaw = isFlagOn("showNavObstacleRaw");
    if (!showInflated && !showRaw) return;

    const obstacles = ctx.buildCatObstacles(true, true);
    for (const obs of obstacles) {
      if (showInflated) {
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

      if (showRaw) {
        const pad = Math.max(0, Number.isFinite(obs.navPad) ? obs.navPad : 0);
        let raw;
        if (obs.kind === "circle") {
          raw = makeDebugCircleLoop(Math.max(0.01, obs.r - pad), 0.05, 30, DEBUG_NAV_OBSTACLE_RAW_MAT);
          raw.position.set(obs.x, 0, obs.z);
        } else {
          raw = makeDebugRectLoop(
            Math.max(0.01, obs.hx - pad),
            Math.max(0.01, obs.hz - pad),
            0.05,
            DEBUG_NAV_OBSTACLE_RAW_MAT
          );
          raw.position.set(obs.x, 0, obs.z);
          if (obs.kind === "obb" && Number.isFinite(obs.yaw)) raw.rotation.y = obs.yaw;
        }
        raw.renderOrder = 15;
        debugView.navObstacleGroup.add(raw);
      }
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

    if (isFlagOn("showNavMeshFill") && facePoints.length) {
      const fillGeo = new THREE.BufferGeometry();
      fillGeo.setAttribute("position", new THREE.Float32BufferAttribute(facePoints, 3));
      fillGeo.computeVertexNormals();
      const fill = new THREE.Mesh(fillGeo, DEBUG_NAV_FILL_MAT);
      fill.renderOrder = 9;
      debugView.navMeshFill = fill;
      debugView.root.add(fill);
    }

    if (isFlagOn("showNavMeshLines") && linePoints.length) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePoints, 3));
      const lines = new THREE.LineSegments(lineGeo, DEBUG_NAV_MAT);
      lines.renderOrder = 10;
      debugView.navMeshLines = lines;
      debugView.root.add(lines);
    }
  }

  function applyRenderModeVisibility() {
    debugView.staticCollisionGroup.visible = true;
    debugView.dynamicCollisionGroup.visible = true;
    debugView.navObstacleGroup.visible = true;
    debugView.astarGroup.visible = true;
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
    if (!isFlagOn("showCurrentPath")) {
      if (debugView.pathMesh) debugView.pathMesh.visible = false;
      return;
    }

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
    if (!isFlagOn("showTargetMarker")) {
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
      return;
    }
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

  function rebuildAStarDebug() {
    if (!DEBUG_VIEW.enabled) return;
    clearDebugChildren(debugView.astarGroup);
    if (typeof ctx.getLastAStarDebugData !== "function") return;
    const data = ctx.getLastAStarDebugData();
    if (!data || data.mode === "none") return;

    const edges = Array.isArray(data.edges) ? data.edges : [];
    if (isFlagOn("showAStarChecks") && edges.length > 0) {
      const positions = [];
      const colors = [];
      const startOrder = edges[0]?.order ?? 0;
      const endOrder = edges[edges.length - 1]?.order ?? startOrder;
      const span = Math.max(1, endOrder - startOrder);
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (!edge?.from || !edge?.to) continue;
        if (isFlagOn("showAStarAcceptedOnly") && !edge.accepted) continue;
        const t = THREE.MathUtils.clamp(((edge.order ?? i) - startOrder) / span, 0, 1);
        const lightness = 0.18 + t * 0.55; // darker for early checks
        if (!isFlagOn("showAStarBlocked") && !edge.accepted) continue;
        let color;
        if (!edge.accepted) {
          color = new THREE.Color().setHSL(0.0, 0.0, 0.24 + t * 0.42);
        } else if (data.mode === "recast") {
          color = new THREE.Color().setHSL(0.58, 0.9, 0.22 + t * 0.58);
        } else if (data.mode === "straight") {
          color = new THREE.Color().setHSL(0.32, 0.85, 0.32 + t * 0.35);
        } else {
          color = new THREE.Color().setHSL(0.12, 0.95, lightness);
        }
        positions.push(
          edge.from.x, (edge.from.y || 0) + 0.045, edge.from.z,
          edge.to.x, (edge.to.y || 0) + 0.045, edge.to.z
        );
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
      if (positions.length >= 6) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        const mat = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        });
        const lines = new THREE.LineSegments(geo, mat);
        lines.renderOrder = 17;
        lines.userData.disposeMaterial = true;
        debugView.astarGroup.add(lines);
      }
    }

    if (isFlagOn("showAStarFinalPath") && Array.isArray(data.finalPath) && data.finalPath.length >= 2) {
      const points = [];
      for (let i = 0; i < data.finalPath.length; i++) {
        const p = data.finalPath[i];
        if (!p) continue;
        points.push(new THREE.Vector3(p.x, (p.y || 0) + 0.07, p.z));
      }
      if (points.length >= 2) {
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, DEBUG_ASTAR_FINAL_PATH_MAT);
        line.renderOrder = 18;
        debugView.astarGroup.add(line);
      }
    }

    if (isFlagOn("showAStarEndpoints")) {
      if (data.start && Number.isFinite(data.start.x) && Number.isFinite(data.start.z)) {
        const startMarker = makeDebugCircleLoop(0.09, 0, 24, DEBUG_CAT_COLLISION_MAT);
        startMarker.position.set(data.start.x, (data.start.y || 0) + 0.05, data.start.z);
        startMarker.renderOrder = 19;
        debugView.astarGroup.add(startMarker);
      }
      if (data.goal && Number.isFinite(data.goal.x) && Number.isFinite(data.goal.z)) {
        const goalMarker = makeDebugCircleLoop(0.09, 0, 24, DEBUG_TARGET_MESH_MAT);
        goalMarker.position.set(data.goal.x, (data.goal.y || 0) + 0.05, data.goal.z);
        goalMarker.renderOrder = 19;
        debugView.astarGroup.add(goalMarker);
      }
    }
  }

  function initDebugView(clockTime) {
    if (!DEBUG_VIEW.enabled) return;
    initTimeScaleControl();
    initAdvancedControl();
    if (!debugView.root.parent) scene.add(debugView.root);
    if (!debugView.staticCollisionGroup.parent) debugView.root.add(debugView.staticCollisionGroup);
    if (!debugView.dynamicCollisionGroup.parent) debugView.root.add(debugView.dynamicCollisionGroup);
    if (!debugView.navObstacleGroup.parent) debugView.root.add(debugView.navObstacleGroup);
    if (!debugView.astarGroup.parent) debugView.root.add(debugView.astarGroup);
    applyRenderModeVisibility();
    debugView.root.visible = debugView.visible;
    rebuildStaticCollisionDebug();
    rebuildDynamicCollisionDebug(clockTime);
    rebuildNavObstacleDebug();
    rebuildNavMeshDebug();
    rebuildCurrentPathDebug(clockTime);
    rebuildTargetMarkerDebug();
    rebuildAStarDebug();
    debugView.nextNavRefreshAt = clockTime + DEBUG_VIEW.navRefreshInterval;
    updateDebugButtonLabel();
    setTimeScaleControlVisible();
    setAdvancedControlVisible();
  }

  function updateDebugView(clockTime) {
    if (!DEBUG_VIEW.enabled) return;
    if (!debugView.visible) return;
    updateTimeScaleValueLabel();
    rebuildDynamicCollisionDebug(clockTime);
    rebuildCurrentPathDebug(clockTime);
    rebuildTargetMarkerDebug();
    rebuildAStarDebug();
    updateNavTelemetry(clockTime);
    if (DEBUG_VIEW.navRefreshInterval <= 0 || clockTime >= debugView.nextNavRefreshAt || !debugView.navMeshLines) {
      rebuildNavObstacleDebug();
      rebuildNavMeshDebug();
      debugView.nextNavRefreshAt = clockTime + DEBUG_VIEW.navRefreshInterval;
    }
  }

  function updateDebugButtonLabel() {
    if (!debugBtnEl) return;
    const modeLabel = debugView.advancedFlags.fullOverlayMode ? "Full" : "Clean";
    debugBtnEl.textContent = debugView.visible
      ? `Debug: On ${modeLabel} (B, N mode, A advanced, Right-click walk, T teleport)`
      : "Debug: Off (B)";
  }

  function setDebugViewVisible(visible, clockTime) {
    debugView.visible = !!visible;
    debugView.root.visible = debugView.visible;
    setTimeScaleControlVisible();
    setAdvancedControlVisible();
    if (debugView.visible) {
      debugView.nextNavRefreshAt = 0;
      syncTimeScaleControlsFromState();
      syncAdvancedControlsFromState();
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
    if (key === "a") {
      if (!debugView.visible) return;
      event.preventDefault();
      debugView.advancedPanelVisible = !debugView.advancedPanelVisible;
      setAdvancedControlVisible();
      return;
    }
    if (key === "n") {
      event.preventDefault();
      setFullOverlayMode(!debugView.advancedFlags.fullOverlayMode, clockTime);
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
