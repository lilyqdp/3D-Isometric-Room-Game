import {
  formatDebugNumber as formatNum,
  pushDebugPerfValue as pushPerfValue,
  debugPerfMean as perfMean,
  debugPerfMax as perfMax,
  debugPerfPercentile as perfPercentile,
} from "./debug-overlay-stats.js";

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
    { key: "showSurfaceBounds", label: "Jump surface bounds", default: false },
    { key: "showSurfaceAnchors", label: "Jump anchors/latch points", default: false },
    { key: "showSurfaceProbes", label: "Jump probes", default: false },
    { key: "showSurfaceLinks", label: "Jump links (valid/blocked)", default: false },
    { key: "showSurfaceLinkClearance", label: "Jump link clearance volumes", default: false },
    { key: "showSurfaceVectorBlockers", label: "Jump blocker spaces (red/orange)", default: false },
    { key: "showSurfaceUpLinksOnly", label: "Jump links: up only", default: false },
    { key: "showSurfaceDownLinksOnly", label: "Jump links: down only", default: false },
    { key: "showJumpCatCollision", label: "Cat jump keep-out (active)", default: false },
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
    { key: "showRouteLoopTelemetry", label: "Route loop diagnostics panel", default: false },
    { key: "showRouteEventTimeline", label: "Route event timeline panel", default: false },
    { key: "showPerfTelemetry", label: "Live perf telemetry panel", default: false },
    { key: "showPathProfiler", label: "Path lag profiler panel", default: false },
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
    "showSurfaceBounds",
    "showSurfaceAnchors",
    "showSurfaceProbes",
    "showSurfaceLinks",
    "showSurfaceLinkClearance",
    "showSurfaceVectorBlockers",
    "showJumpCatCollision",
  ];

  const debugView = {
    root: new THREE.Group(),
    staticCollisionGroup: new THREE.Group(),
    dynamicCollisionGroup: new THREE.Group(),
    navObstacleGroup: new THREE.Group(),
    surfaceJumpGroup: new THREE.Group(),
    astarGroup: new THREE.Group(),
    navMeshLines: null,
    navMeshFill: null,
    pathMesh: null,
    targetMarker: null,
    nextNavRefreshAt: 0,
    lastPathPoints: null,
    lastPathAt: 0,
    lastPathKey: "",
    visible: false,
    advancedPanelVisible: false,
    advancedFlags: { ...DEFAULT_ADVANCED_FLAGS },
  };
  const pickupTriggerFlashUntil = new WeakMap();
  debugView.root.name = "debugView";
  debugView.staticCollisionGroup.name = "debugStaticCollision";
  debugView.dynamicCollisionGroup.name = "debugDynamicCollision";
  debugView.navObstacleGroup.name = "debugNavObstacles";
  debugView.surfaceJumpGroup.name = "debugSurfaceJump";
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
  const DEBUG_SURFACE_OUTER_MAT = new THREE.LineBasicMaterial({
    color: 0x6bc3ff,
    transparent: true,
    opacity: 0.78,
    depthTest: false,
  });
  const DEBUG_SURFACE_INNER_MAT = new THREE.LineBasicMaterial({
    color: 0x2ee68c,
    transparent: true,
    opacity: 0.86,
    depthTest: false,
  });
  const DEBUG_SURFACE_ANCHOR_LINK_MAT = new THREE.LineBasicMaterial({
    color: 0xb784ff,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  });
  const DEBUG_SURFACE_PROBE_HIT_MAT = new THREE.LineBasicMaterial({
    color: 0x00ffd1,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const DEBUG_SURFACE_PROBE_MISS_MAT = new THREE.LineBasicMaterial({
    color: 0xffa12d,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
  });
  const DEBUG_SURFACE_PROBE_DOWN_ONLY_MAT = new THREE.LineBasicMaterial({
    color: 0x57b7ff,
    transparent: true,
    opacity: 0.88,
    depthTest: false,
  });
  const DEBUG_SURFACE_LINK_VALID_MAT = new THREE.LineBasicMaterial({
    color: 0x00f5a0,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  });
  const DEBUG_SURFACE_LINK_BLOCKED_MAT = new THREE.LineBasicMaterial({
    color: 0xffa12d,
    transparent: true,
    opacity: 0.88,
    depthTest: false,
  });
  const DEBUG_SURFACE_DOWN_LINK_VALID_MAT = new THREE.LineBasicMaterial({
    color: 0x57b7ff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const DEBUG_SURFACE_DOWN_LINK_BLOCKED_MAT = new THREE.LineBasicMaterial({
    color: 0xffa12d,
    transparent: true,
    opacity: 0.84,
    depthTest: false,
  });
  const DEBUG_SURFACE_BLOCKER_OBJECT_SOLID_MAT = new THREE.MeshBasicMaterial({
    color: 0xff3f3f,
    transparent: true,
    opacity: 0.23,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_SURFACE_BLOCKER_SURFACE_SOLID_MAT = new THREE.MeshBasicMaterial({
    color: 0xff9f2e,
    transparent: true,
    opacity: 0.2,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_SURFACE_ANCHOR_OUTER_MAT = new THREE.MeshBasicMaterial({
    color: 0x8f63ff,
    depthTest: false,
  });
  const DEBUG_SURFACE_ANCHOR_INNER_MAT = new THREE.MeshBasicMaterial({
    color: 0x00ff95,
    depthTest: false,
  });
  const DEBUG_SURFACE_PROBE_END_HIT_MAT = new THREE.MeshBasicMaterial({
    color: 0x00ffd1,
    depthTest: false,
  });
  const DEBUG_SURFACE_PROBE_END_DOWN_ONLY_MAT = new THREE.MeshBasicMaterial({
    color: 0x57b7ff,
    depthTest: false,
  });
  const DEBUG_SURFACE_PROBE_END_MISS_MAT = new THREE.MeshBasicMaterial({
    color: 0xffa12d,
    depthTest: false,
  });
  const DEBUG_SURFACE_LINK_POINT_MAT = new THREE.MeshBasicMaterial({
    color: 0x9cf7ff,
    depthTest: false,
  });
  const DEBUG_SURFACE_LINK_BLOCKED_POINT_MAT = new THREE.MeshBasicMaterial({
    color: 0xffa12d,
    depthTest: false,
  });
  const DEBUG_JUMP_CAT_HALF_RING_MAT = new THREE.LineBasicMaterial({
    color: 0x56e8ff,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const DEBUG_JUMP_CAT_HALF_SOLID_MAT = new THREE.MeshBasicMaterial({
    color: 0x56e8ff,
    transparent: true,
    opacity: 0.24,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_SURFACE_LINK_CLEARANCE_VALID_MAT = new THREE.MeshBasicMaterial({
    color: 0x40ffd6,
    transparent: true,
    opacity: 0.14,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_SURFACE_LINK_CLEARANCE_BLOCKED_MAT = new THREE.MeshBasicMaterial({
    color: 0xff8d4d,
    transparent: true,
    opacity: 0.16,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const DEBUG_UP_AXIS = new THREE.Vector3(0, 1, 0);
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
  const DEBUG_TARGET_MAT = new THREE.LineBasicMaterial({
    color: DEBUG_VIEW.targetColor,
    transparent: true,
    opacity: 0.92,
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
  let debugNavTelemetrySection = null;
  let debugNavTelemetryPre = null;
  let debugRouteTelemetrySection = null;
  let debugRouteTelemetryPre = null;
  let debugRouteEventSection = null;
  let debugRouteEventPre = null;
  let debugPerfTelemetrySection = null;
  let debugPerfTelemetryPre = null;
  let debugPathProfilerSection = null;
  let debugPathProfilerPre = null;

  const routeDiagState = {
    lastRouteSig: "",
    lastRouteDestSig: "",
    lastGoalSig: "",
    lastPathSig: "",
    lastStepSig: "",
    routeChanges: [],
    routeDestChanges: [],
    goalChanges: [],
    pathChanges: [],
    sameDestPathChanges: [],
    stepChanges: [],
    lastPathChangeAt: 0,
    lastGoalChangeAt: 0,
    lastRouteChangeAt: 0,
  };
  const debugAdvancedInputs = new Map();
  const PERF_HISTORY_LIMIT = 300;
  const TELEMETRY_UPDATE_INTERVAL = 0.25;
  const perfTelemetry = {
    nextUpdateAt: 0,
    hasSample: false,
    lastSample: null,
    frameIntervalMs: [],
    frameMs: [],
    simMs: [],
    simulatedDtMs: [],
    simSteps: [],
    physicsMs: [],
    pickupsMs: [],
    spawnMs: [],
    catMs: [],
    cupMs: [],
    shatterMs: [],
    drawCalls: [],
    triangles: [],
    geometries: [],
    textures: [],
    repathPerSec: [],
    lastRepathCount: null,
    lastRepathAt: 0,
  };

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
    rebuildSurfaceJumpDebug();
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
      const showAny =
        debugView.visible &&
        debugView.advancedPanelVisible &&
        (isFlagOn("showNavTelemetry") ||
          isFlagOn("showRouteLoopTelemetry") ||
          isFlagOn("showRouteEventTimeline") ||
          isFlagOn("showPerfTelemetry") ||
          isFlagOn("showPathProfiler"));
      debugTelemetryWrap.style.display = showAny ? "grid" : "none";
    }
    if (debugNavTelemetrySection) debugNavTelemetrySection.style.display = isFlagOn("showNavTelemetry") ? "block" : "none";
    if (debugRouteTelemetrySection) debugRouteTelemetrySection.style.display = isFlagOn("showRouteLoopTelemetry") ? "block" : "none";
    if (debugRouteEventSection) debugRouteEventSection.style.display = isFlagOn("showRouteEventTimeline") ? "block" : "none";
    if (debugPerfTelemetrySection) debugPerfTelemetrySection.style.display = isFlagOn("showPerfTelemetry") ? "block" : "none";
    if (debugPathProfilerSection) debugPathProfilerSection.style.display = isFlagOn("showPathProfiler") ? "block" : "none";
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
    debugTelemetryWrap.style.display = "grid";
    debugTelemetryWrap.style.gap = "8px";

    const makeTelemetrySection = (titleText, accent) => {
      const section = document.createElement("div");
      section.style.display = "none";
      section.style.padding = "8px 10px";
      section.style.border = `1px solid ${accent}`;
      section.style.borderRadius = "8px";
      section.style.background = "rgba(3, 8, 12, 0.74)";
      section.style.maxHeight = "240px";
      section.style.overflow = "auto";

      const title = document.createElement("div");
      title.textContent = titleText;
      title.style.fontSize = "11px";
      title.style.fontWeight = "700";
      title.style.letterSpacing = "0.04em";
      title.style.textTransform = "uppercase";
      title.style.color = accent;
      title.style.marginBottom = "6px";
      section.appendChild(title);

      const pre = document.createElement("pre");
      pre.style.margin = "0";
      pre.style.fontSize = "11px";
      pre.style.lineHeight = "1.35";
      pre.style.whiteSpace = "pre-wrap";
      pre.style.wordBreak = "break-word";
      pre.style.color = "#d6ecff";
      section.appendChild(pre);
      return { section, pre };
    };

    ({ section: debugNavTelemetrySection, pre: debugNavTelemetryPre } = makeTelemetrySection("Nav telemetry", "#8fd6ff"));
    ({ section: debugRouteTelemetrySection, pre: debugRouteTelemetryPre } = makeTelemetrySection("Route loop diagnostics", "#ffd27a"));
    ({ section: debugRouteEventSection, pre: debugRouteEventPre } = makeTelemetrySection("Route event timeline", "#ff9dc6"));
    ({ section: debugPerfTelemetrySection, pre: debugPerfTelemetryPre } = makeTelemetrySection("Performance telemetry", "#9bffad"));
    ({ section: debugPathProfilerSection, pre: debugPathProfilerPre } = makeTelemetrySection("Path lag profiler", "#7dffef"));

    debugTelemetryWrap.append(debugNavTelemetrySection, debugRouteTelemetrySection, debugRouteEventSection, debugPerfTelemetrySection, debugPathProfilerSection);

    debugAdvancedWrap.insertAdjacentElement("afterend", debugTelemetryWrap);
    syncAdvancedControlsFromState();
    setAdvancedControlVisible();
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

  function updatePerformanceSample(sample, clockTime = 0) {
    if (!sample || typeof sample !== "object") return;
    perfTelemetry.hasSample = true;
    perfTelemetry.lastSample = { ...sample };
    pushPerfValue(perfTelemetry.frameIntervalMs, sample.frameIntervalMs);
    pushPerfValue(perfTelemetry.frameMs, sample.frameMs);
    pushPerfValue(perfTelemetry.simMs, sample.simMs);
    pushPerfValue(perfTelemetry.simulatedDtMs, sample.simulatedDtMs);
    pushPerfValue(perfTelemetry.simSteps, sample.simSteps);
    pushPerfValue(perfTelemetry.physicsMs, sample.physicsMs);
    pushPerfValue(perfTelemetry.pickupsMs, sample.pickupsMs);
    pushPerfValue(perfTelemetry.spawnMs, sample.spawnMs);
    pushPerfValue(perfTelemetry.catMs, sample.catMs);
    pushPerfValue(perfTelemetry.cupMs, sample.cupMs);
    pushPerfValue(perfTelemetry.shatterMs, sample.shatterMs);
    pushPerfValue(perfTelemetry.drawCalls, sample.drawCalls);
    pushPerfValue(perfTelemetry.triangles, sample.triangles);
    pushPerfValue(perfTelemetry.geometries, sample.geometries);
    pushPerfValue(perfTelemetry.textures, sample.textures);

    const repathCount = cat.nav?.debugCounters?.repath;
    const now = Number.isFinite(clockTime) ? clockTime : 0;
    if (Number.isFinite(repathCount)) {
      if (
        Number.isFinite(perfTelemetry.lastRepathCount) &&
        Number.isFinite(perfTelemetry.lastRepathAt) &&
        now > perfTelemetry.lastRepathAt + 1e-4
      ) {
        const dt = now - perfTelemetry.lastRepathAt;
        const delta = repathCount - perfTelemetry.lastRepathCount;
        if (delta >= 0) pushPerfValue(perfTelemetry.repathPerSec, delta / dt);
      }
      perfTelemetry.lastRepathCount = repathCount;
      perfTelemetry.lastRepathAt = now;
    }
  }

  function buildNavTelemetryLines(clockTime = 0, includeRouteLoopExtras = false) {
    if (!isFlagOn("showNavTelemetry") && !includeRouteLoopExtras) return [];
    const counters = cat.nav?.debugCounters || {};
    const step = cat.nav?.debugStep || {};
    const repathReasons = cat.nav?.debugRepathReasons || {};
    const lastRepathCause = cat.nav?.lastRepathCause || null;
    const events = Array.isArray(cat.nav?.debugEvents) ? cat.nav.debugEvents : [];
    const compactEvents = (items, signatureFn, limit = 6) => {
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const sig = signatureFn(item);
        const prev = out[out.length - 1];
        if (prev && prev.sig === sig) {
          prev.count += 1;
          prev.item = item;
        } else {
          out.push({ sig, item, count: 1 });
        }
      }
      return out.slice(-limit);
    };
    const recent = compactEvents(
      events.slice(-20),
      (e) => `${e?.kind || "evt"}|${e?.state || "?"}|${e?.obstacleLabel || ""}|${e?.segmentBlockedFrames || ""}`,
      8
    );
    const topRepathReasons = Object.entries(repathReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const recentRepathEvents = compactEvents(
      events.filter((e) => typeof e?.kind === "string" && e.kind.startsWith("repath-cause:")).slice(-16),
      (e) => `${e?.kind || ""}|${e?.obstacleLabel || ""}|${e?.state || ""}`,
      4
    );
    const recentRoutePlannerEvents = compactEvents(
      events.filter((e) => typeof e?.kind === "string" && e.kind.startsWith("route-")).slice(-18),
      (e) => `${e?.kind || ""}|${e?.sourceSurfaceId || ""}|${e?.finalSurfaceId || ""}|${e?.hopSurfaceId || ""}`,
      6
    );
    const jumpDown = cat.nav?.jumpDownDebug || null;
    const route = cat.nav?.route || null;
    const routeInvalidation = cat.nav?.routeInvalidation || null;
    const lines = [];
    lines.push(`state=${cat.state} status=${cat.status}`);
    if (route?.active) {
      lines.push(
        `route src=${route.source || "na"} surf=${route.surfaceId || "floor"}->${route.finalSurfaceId || route.surfaceId || "floor"} y=${formatNum(route.y || 0, 2)} finalY=${formatNum(route.finalY || 0, 2)} recover=${formatNum((route.recoverAt || 0) - clockTime, 2)}s`
      );
      lines.push(
        `route target=(${formatNum(route.target?.x, 2)}, ${formatNum(route.target?.z, 2)}) final=(${formatNum(route.finalTarget?.x, 2)}, ${formatNum(route.finalTarget?.z, 2)}) directJump=${route.directJump ? "y" : "n"}`
      );
      lines.push(
        `route invalidation=${routeInvalidation?.pending ? routeInvalidation.kind || "pending" : "none"} count=${routeInvalidation?.count || 0} target=(${formatNum(routeInvalidation?.target?.x, 2)}, ${formatNum(routeInvalidation?.target?.z, 2)}) useDynamic=${routeInvalidation?.useDynamic ? "y" : "n"}`
      );
      if (includeRouteLoopExtras) {
        const surfaceResolve = cat.nav?.surfaceResolveDebug || {};
        lines.push(
          `surface resolved=${surfaceResolve.resolvedSurfaceId || "na"} auth=${surfaceResolve.authoritativeSurfaceId || "na"}@${surfaceResolve.authoritativeSource || "na"} strict=${surfaceResolve.strictSurfaceId || "na"} loose=${surfaceResolve.looseSurfaceId || "na"} hinted=${surfaceResolve.hintedSurfaceId || "na"}`
        );
        lines.push(
          `route approach=${route.approachSurfaceId || "na"} currentY=${formatNum(cat.group.position.y || 0, 2)} pathGoal=(${formatNum(cat.nav?.goal?.x, 2)}, ${formatNum(cat.nav?.goal?.z, 2)}) pendingGoal=(${formatNum(cat.nav?.goalChangePendingX, 2)}, ${formatNum(cat.nav?.goalChangePendingZ, 2)})`
        );
        lines.push(
          `window hold=${cat.nav?.windowHoldActive ? "y" : "n"} noRouteStreak=${cat.nav?.windowNoRouteStreak || 0} stallT=${formatNum(cat.nav?.windowStallT || 0, 2)} pathCheckIn=${formatNum((cat.nav?.windowPathCheckAt || 0) - clockTime, 2)}s`
        );
      }
    }
    const navAnimSpecialState = cat.nav?.animSpecialState;
    const navAnimSpecialClip = cat.nav?.animSpecialClip;
    const activeSpecialClip = cat.clipSpecialAction?.getClip?.()?.name;
    const activeAnyClip = cat.activeClipAction?.getClip?.()?.name;
    lines.push(
      `anim specialState=${navAnimSpecialState || cat.clipSpecialState || "none"} specialClip=${navAnimSpecialClip || activeSpecialClip || activeAnyClip || "none"}`
    );
    lines.push(`pos=(${formatNum(cat.pos.x, 2)}, ${formatNum(cat.group.position.y, 2)}, ${formatNum(cat.pos.z, 2)}) onTable=${cat.onTable ? "yes" : "no"}`);
    lines.push(`path len=${cat.nav?.path?.length || 0} idx=${cat.nav?.index || 0} stuckT=${formatNum(cat.nav?.stuckT || 0, 3)} repathAt=${formatNum((cat.nav?.repathAt || 0) - clockTime, 2)}s`);
    lines.push(`step reason=${step.reason || "na"} phase=${step.phase || "na"} direct=${step.direct ? "y" : "n"} dynIgnore=${step.ignoreDynamic ? "y" : "n"} turnOnly=${step.turnOnly ? "y" : "n"} turnOnlyT=${formatNum(step.turnOnlyT || 0, 2)} noSteerFrames=${step.noSteerFrames || 0} segBlockedFrames=${cat.nav?.segmentBlockedFrames || 0} staleInvalidFrames=${cat.nav?.staleInvalidFrames || 0}`);
    lines.push(`target=(${formatNum(step.targetX, 2)}, ${formatNum(step.targetZ, 2)}) chase=(${formatNum(step.chaseX, 2)}, ${formatNum(step.chaseZ, 2)}) d=${formatNum(step.distToChase || 0, 3)}`);
    lines.push(`yawDelta=${formatNum(step.rawYawDelta || 0, 3)} overlapDynamic=${formatNum(step.overlapDynamic || 0, 3)} overlapStatic=${formatNum(step.overlapStatic || 0, 3)} blockedPosS=${step.posBlockedStatic ? "y" : "n"} blockedPosD=${step.posBlockedDynamic ? "y" : "n"} speed=${formatNum(cat.nav?.lastSpeed || 0, 3)} cmd=${formatNum(cat.nav?.commandedSpeed || 0, 3)}`);
    lines.push(`segmentBlock obstacle=${step.blockedObstacle || "none"} kind=${step.blockedObstacleKind || "na"} at=(${formatNum(step.blockedAtX, 2)}, ${formatNum(step.blockedAtZ, 2)})`);
    if (jumpDown) {
      lines.push(
        `jumpDown phase=${jumpDown.phase || "na"} planPhase=${jumpDown.planPhase || "na"} planValid=${jumpDown.planValid ? "y" : "n"} refreshOk=${jumpDown.refreshOk ? "y" : "n"} fail=${jumpDown.failReason || jumpDown.planFailure || "none"}`
      );
      lines.push(
        `jumpDown dist=${formatNum(jumpDown.distToDrop, 3)} near=${jumpDown.nearDrop ? "y" : "n"} reached=${jumpDown.reachedJumpOff ? "y" : "n"} stallReady=${jumpDown.stallReady ? "y" : "n"} noMoveT=${formatNum(jumpDown.noMoveT, 2)} ready=${jumpDown.readyToDrop ? "y" : "n"} navReason=${jumpDown.navReason || "na"}`
      );
      lines.push(
        `jumpDown jumpOff=(${formatNum(jumpDown.jumpOffX, 2)}, ${formatNum(jumpDown.jumpOffY, 2)}, ${formatNum(jumpDown.jumpOffZ, 2)}) jumpTo=(${formatNum(jumpDown.jumpDownX, 2)}, ${formatNum(jumpDown.jumpDownY, 2)}, ${formatNum(jumpDown.jumpDownZ, 2)})`
      );
      lines.push(
        `jumpDown sourceSurface=${jumpDown.planSourceSurfaceId || "na"} desiredLanding=${jumpDown.desiredLandingSurfaceId || jumpDown.planDesiredLandingSurfaceId || "na"} toward=(${formatNum(jumpDown.preferredTowardX ?? jumpDown.planTowardX, 2)}, ${formatNum(jumpDown.preferredTowardZ ?? jumpDown.planTowardZ, 2)}) topClamped=${jumpDown.planTopWasClamped ? "y" : "n"}`
      );
    }
    lines.push(`counters noPath=${counters.noPath || 0} noSteer=${counters.noSteer || 0} repath=${counters.repath || 0} turnOnlyRepath=${counters.turnOnlyRepath || 0} segmentRescue=${counters.segmentRescue || 0} escape=${counters.escape || 0} rollback=${counters.rollback || 0} rescue=${counters.rescueSnap || 0}`);
    if (lastRepathCause && lastRepathCause.kind && lastRepathCause.kind !== "none") {
      lines.push(`last repath cause=${lastRepathCause.kind} dt=${formatNum(clockTime - (lastRepathCause.t || clockTime), 2)}s ago ignoreDyn=${lastRepathCause.ignoreDynamic ? "y" : "n"}`);
    }
    if (topRepathReasons.length) {
      lines.push(`repath causes total: ${topRepathReasons.map(([k, v]) => `${k}=${v}`).join(" | ")}`);
    }
    if (recentRepathEvents.length) {
      lines.push("recent repath triggers:");
      for (const entry of recentRepathEvents) {
        const e = entry.item;
        const obs = e.obstacleLabel ? ` obs=${e.obstacleLabel}` : "";
        const count = entry.count > 1 ? ` x${entry.count}` : "";
        lines.push(`  - ${formatNum(clockTime - (e.t || clockTime), 2)}s ago | ${e.kind.replace("repath-cause:", "")}${obs}${count}`);
      }
    }
    if (recentRoutePlannerEvents.length) {
      lines.push("route planner:");
      for (const entry of recentRoutePlannerEvents) {
        const e = entry.item;
        const dt = clockTime - (e.t || clockTime);
        const src = e.sourceSurfaceId ? ` src=${e.sourceSurfaceId}` : "";
        const dst = e.finalSurfaceId ? ` dst=${e.finalSurfaceId}` : "";
        const hop = e.hopSurfaceId ? ` hop=${e.hopSurfaceId}` : "";
        const count = entry.count > 1 ? ` x${entry.count}` : "";
        lines.push(`  - ${formatNum(dt, 2)}s ago | ${e.kind}${src}${dst}${hop}${count}`);
      }
    }
    if (recent.length) {
      lines.push("events:");
      for (let i = 0; i < recent.length; i++) {
        const entry = recent[i];
        const e = entry.item;
        const dt = clockTime - (e.t || clockTime);
        const obs = e.obstacleLabel ? ` | obs=${e.obstacleLabel}` : "";
        const sb = Number.isFinite(e.segmentBlockedFrames) ? ` | segF=${e.segmentBlockedFrames}` : "";
        const count = entry.count > 1 ? ` | x${entry.count}` : "";
        lines.push(`  - ${formatNum(dt, 2)}s ago | ${e.kind || "evt"} | state=${e.state || "?"}${obs}${sb}${count}`);
      }
    }
    return lines;
  }


  function quantizeDebugValue(value, quantum = 0.05) {
    return Math.round((Number.isFinite(value) ? value : 0) / quantum);
  }

  function makeVecSig(vec, quantum = 0.05) {
    if (!vec) return "na";
    return `${quantizeDebugValue(vec.x, quantum)},${quantizeDebugValue(vec.z, quantum)},${quantizeDebugValue(vec.y, quantum)}`;
  }

  function makePathSig(path) {
    if (!Array.isArray(path) || path.length === 0) return "none";
    const first = path[0];
    const second = path[Math.min(1, path.length - 1)];
    const mid = path[Math.floor(path.length * 0.5)];
    const last = path[path.length - 1];
    return `${path.length}|${makeVecSig(first)}|${makeVecSig(second)}|${makeVecSig(mid)}|${makeVecSig(last)}`;
  }

  function makeRouteSig(route) {
    if (!route?.active) return "inactive";
    return [
      String(route.approachSurfaceId || "na"),
      String(route.surfaceId || "floor"),
      String(route.finalSurfaceId || route.surfaceId || "floor"),
      route.directJump ? "1" : "0",
      makeVecSig(route.target),
      makeVecSig(route.finalTarget),
      quantizeDebugValue(route.y, 0.02),
      quantizeDebugValue(route.finalY, 0.02),
    ].join("|");
  }

  function makeRouteDestSig(route) {
    if (!route?.active) return "inactive";
    return [
      String(route.finalSurfaceId || route.surfaceId || "floor"),
      makeVecSig(route.finalTarget || route.target),
      quantizeDebugValue(route.finalY ?? route.y, 0.02),
    ].join("|");
  }

  function makeGoalSig() {
    const goal = cat.nav?.goal || null;
    return `${makeVecSig(goal)}|${quantizeDebugValue(cat.nav?.goalChangePendingX, 0.05)},${quantizeDebugValue(cat.nav?.goalChangePendingZ, 0.05)}`;
  }

  function makeStepSig() {
    const step = cat.nav?.debugStep || {};
    return [
      step.reason || "na",
      step.phase || "na",
      step.turnOnly ? "1" : "0",
      quantizeDebugValue(step.targetX, 0.05),
      quantizeDebugValue(step.targetZ, 0.05),
      quantizeDebugValue(step.chaseX, 0.05),
      quantizeDebugValue(step.chaseZ, 0.05),
      step.blockedObstacle || "none",
    ].join("|");
  }

  function pruneDiagChanges(list, clockTime, maxAge = 8) {
    while (list.length && clockTime - list[0].t > maxAge) list.shift();
  }

  function recordDiagChange(list, clockTime, label, from, to) {
    if (from === to) return;
    list.push({ t: clockTime, label, from, to });
    pruneDiagChanges(list, clockTime);
  }

  function countDiagChanges(list, clockTime, age = 1) {
    return list.reduce((sum, entry) => sum + (clockTime - entry.t <= age ? 1 : 0), 0);
  }

  function updateRouteDiagState(clockTime = 0) {
    const routeSig = makeRouteSig(cat.nav?.route || null);
    const routeDestSig = makeRouteDestSig(cat.nav?.route || null);
    const goalSig = makeGoalSig();
    const pathSig = makePathSig(cat.nav?.path || null);
    const stepSig = makeStepSig();

    if (routeDiagState.lastRouteSig) recordDiagChange(routeDiagState.routeChanges, clockTime, "route", routeDiagState.lastRouteSig, routeSig);
    if (routeDiagState.lastRouteDestSig) recordDiagChange(routeDiagState.routeDestChanges, clockTime, "dest", routeDiagState.lastRouteDestSig, routeDestSig);
    if (routeDiagState.lastGoalSig) recordDiagChange(routeDiagState.goalChanges, clockTime, "goal", routeDiagState.lastGoalSig, goalSig);
    if (routeDiagState.lastPathSig) {
      recordDiagChange(routeDiagState.pathChanges, clockTime, "path", routeDiagState.lastPathSig, pathSig);
      if (routeDiagState.lastRouteDestSig === routeDestSig && routeDiagState.lastPathSig !== pathSig) {
        recordDiagChange(routeDiagState.sameDestPathChanges, clockTime, "same-dst-path", routeDiagState.lastPathSig, pathSig);
      }
    }
    if (routeDiagState.lastStepSig) recordDiagChange(routeDiagState.stepChanges, clockTime, "step", routeDiagState.lastStepSig, stepSig);

    if (routeDiagState.lastPathSig !== pathSig) routeDiagState.lastPathChangeAt = clockTime;
    if (routeDiagState.lastGoalSig !== goalSig) routeDiagState.lastGoalChangeAt = clockTime;
    if (routeDiagState.lastRouteSig !== routeSig) routeDiagState.lastRouteChangeAt = clockTime;

    routeDiagState.lastRouteSig = routeSig;
    routeDiagState.lastRouteDestSig = routeDestSig;
    routeDiagState.lastGoalSig = goalSig;
    routeDiagState.lastPathSig = pathSig;
    routeDiagState.lastStepSig = stepSig;
  }

  function countEvents(events, age, clockTime, names) {
    const wanted = new Set(names);
    let count = 0;
    for (const e of events) {
      if (!e?.kind || !wanted.has(String(e.kind))) continue;
      if (clockTime - (e.t || clockTime) <= age) count += 1;
    }
    return count;
  }

  function buildRouteLoopTelemetryLines(clockTime = 0) {
    const route = cat.nav?.route || null;
    const events = Array.isArray(cat.nav?.debugEvents) ? cat.nav.debugEvents : [];
    const step = cat.nav?.debugStep || {};
    const jumpDown = cat.nav?.jumpDownDebug || null;
    const surfaceResolve = cat.nav?.surfaceResolveDebug || {};
    const routeInvalidation = cat.nav?.routeInvalidation || null;
    updateRouteDiagState(clockTime);

    const lines = [];
    lines.push(`routeSig=${routeDiagState.lastRouteSig}`);
    lines.push(`routeDestSig=${routeDiagState.lastRouteDestSig}`);
    lines.push(`goalSig=${routeDiagState.lastGoalSig}`);
    lines.push(`pathSig=${routeDiagState.lastPathSig}`);
    lines.push(`stepSig=${routeDiagState.lastStepSig}`);
    lines.push(`changes/1s route=${countDiagChanges(routeDiagState.routeChanges, clockTime, 1)} dest=${countDiagChanges(routeDiagState.routeDestChanges, clockTime, 1)} goal=${countDiagChanges(routeDiagState.goalChanges, clockTime, 1)} path=${countDiagChanges(routeDiagState.pathChanges, clockTime, 1)} sameDstPath=${countDiagChanges(routeDiagState.sameDestPathChanges, clockTime, 1)} step=${countDiagChanges(routeDiagState.stepChanges, clockTime, 1)}`);
    lines.push(`changes/5s route=${countDiagChanges(routeDiagState.routeChanges, clockTime, 5)} dest=${countDiagChanges(routeDiagState.routeDestChanges, clockTime, 5)} goal=${countDiagChanges(routeDiagState.goalChanges, clockTime, 5)} path=${countDiagChanges(routeDiagState.pathChanges, clockTime, 5)} sameDstPath=${countDiagChanges(routeDiagState.sameDestPathChanges, clockTime, 5)} step=${countDiagChanges(routeDiagState.stepChanges, clockTime, 5)}`);
    lines.push(`lastChangeAgo route=${formatNum(clockTime - (routeDiagState.lastRouteChangeAt || clockTime), 2)}s goal=${formatNum(clockTime - (routeDiagState.lastGoalChangeAt || clockTime), 2)}s path=${formatNum(clockTime - (routeDiagState.lastPathChangeAt || clockTime), 2)}s`);
    lines.push(`resolvedSurface auth=${surfaceResolve.authoritativeSurfaceId || "na"}@${surfaceResolve.authoritativeSource || "na"} strict=${surfaceResolve.strictSurfaceId || "na"} loose=${surfaceResolve.looseSurfaceId || "na"} hinted=${surfaceResolve.hintedSurfaceId || "na"} final=${surfaceResolve.resolvedSurfaceId || "na"}`);
    lines.push(`route active=${route?.active ? "y" : "n"} approach=${route?.approachSurfaceId || "na"} surf=${route?.surfaceId || "na"} final=${route?.finalSurfaceId || "na"} directJump=${route?.directJump ? "y" : "n"} seg=${route?.segments?.[route?.segmentIndex || 0]?.kind || "none"} segIdx=${route?.segmentIndex || 0}/${route?.segments?.length || 0}`);
    lines.push(`route target=${makeVecSig(route?.target)} finalTarget=${makeVecSig(route?.finalTarget)} queryY=${formatNum(route?.y,2)} finalY=${formatNum(route?.finalY,2)}`);
    lines.push(`goal current=${makeVecSig(cat.nav?.goal)} pending=${quantizeDebugValue(cat.nav?.goalChangePendingX,0.05)},${quantizeDebugValue(cat.nav?.goalChangePendingZ,0.05)} idx=${cat.nav?.index || 0} pathLen=${cat.nav?.path?.length || 0}`);
    lines.push(`window hold=${cat.nav?.windowHoldActive ? "y" : "n"} noRouteStreak=${cat.nav?.windowNoRouteStreak || 0} stallT=${formatNum(cat.nav?.windowStallT || 0, 2)} pathCheckIn=${formatNum((cat.nav?.windowPathCheckAt || 0) - clockTime, 2)}s`);
    lines.push(`invalidation pending=${routeInvalidation?.pending ? "y" : "n"} kind=${routeInvalidation?.kind || "none"} count=${routeInvalidation?.count || 0} target=${makeVecSig(routeInvalidation?.target)}`);
    lines.push(`step reason=${step.reason || "na"} phase=${step.phase || "na"} target=${quantizeDebugValue(step.targetX,0.05)},${quantizeDebugValue(step.targetZ,0.05)} chase=${quantizeDebugValue(step.chaseX,0.05)},${quantizeDebugValue(step.chaseZ,0.05)} blocked=${step.blockedObstacle || "none"}`);
    lines.push(`elev support=${step.supportSurfaceId || "na"} rawTarget=${quantizeDebugValue(step.rawTargetX,0.05)},${quantizeDebugValue(step.rawTargetZ,0.05)} resolvedTarget=${quantizeDebugValue(step.resolvedTargetX,0.05)},${quantizeDebugValue(step.resolvedTargetZ,0.05)} snapDist=${formatNum(step.targetSnapDist || 0, 3)}`);
    if (jumpDown) lines.push(`jumpDown phase=${jumpDown.phase || "na"} plan=${jumpDown.planPhase || "na"} valid=${jumpDown.planValid ? "y" : "n"} fail=${jumpDown.failReason || jumpDown.planFailure || "none"} source=${jumpDown.planSourceSurfaceId || "na"} desired=${jumpDown.desiredLandingSurfaceId || jumpDown.planDesiredLandingSurfaceId || "na"}`);
    lines.push(`events/1s skipExisting=${countEvents(events,1,clockTime,["route-plan-skip-existing"])} rejectJumpdown=${countEvents(events,1,clockTime,["route-queue-reject-no-jumpdown-link","route-move-reject-no-jumpdown-link"])} rejectElev=${countEvents(events,1,clockTime,["route-queue-reject-no-elevated-link"])} repathElevNoProg=${countEvents(events,1,clockTime,["repath-elevated-no-progress"])} routeInvalidate=${countEvents(events,1,clockTime,["route-invalidate"])}`);
    lines.push(`events/5s skipExisting=${countEvents(events,5,clockTime,["route-plan-skip-existing"])} rejectJumpdown=${countEvents(events,5,clockTime,["route-queue-reject-no-jumpdown-link","route-move-reject-no-jumpdown-link"])} rejectElev=${countEvents(events,5,clockTime,["route-queue-reject-no-elevated-link"])} repathElevNoProg=${countEvents(events,5,clockTime,["repath-elevated-no-progress"])} routeInvalidate=${countEvents(events,5,clockTime,["route-invalidate"])}`);
    const recent = routeDiagState.sameDestPathChanges.slice(-6);
    if (recent.length) {
      lines.push("recent same-destination path flips:");
      for (const entry of recent) lines.push(`  - ${formatNum(clockTime - entry.t, 2)}s ago | ${entry.from} -> ${entry.to}`);
    }
    return lines;
  }

  function buildRouteEventTimelineLines(clockTime = 0) {
    const events = Array.isArray(cat.nav?.debugEvents) ? cat.nav.debugEvents.slice(-30) : [];
    const lines = [];
    if (!events.length) {
      lines.push("route/nav events: none");
      return lines;
    }
    for (const e of events) {
      const dt = formatNum(clockTime - (e.t || clockTime), 2);
      const src = e.sourceSurfaceId ? ` src=${e.sourceSurfaceId}` : "";
      const dst = e.finalSurfaceId ? ` dst=${e.finalSurfaceId}` : "";
      const hop = e.hopSurfaceId ? ` hop=${e.hopSurfaceId}` : "";
      const obs = e.obstacleLabel ? ` obs=${e.obstacleLabel}` : "";
      const kind = e.kind || "evt";
      const target = Number.isFinite(e.targetX) || Number.isFinite(e.targetZ) ? ` target=${formatNum(e.targetX,2)},${formatNum(e.targetZ,2)}` : "";
      lines.push(`${dt}s | ${kind}${src}${dst}${hop}${obs}${target}`);
    }
    return lines;
  }

  function buildPerfTelemetryLines() {
    if (!isFlagOn("showPerfTelemetry")) return [];
    const lines = [];
    if (!perfTelemetry.hasSample) {
      lines.push("perf: waiting for samples...");
      return lines;
    }

    const sample = perfTelemetry.lastSample || {};
    const frameIntervalAvg = perfMean(perfTelemetry.frameIntervalMs);
    const frameIntervalP95 = perfPercentile(perfTelemetry.frameIntervalMs, 0.95);
    const frameIntervalP99 = perfPercentile(perfTelemetry.frameIntervalMs, 0.99);
    const frameIntervalMax = perfMax(perfTelemetry.frameIntervalMs);
    const fpsAvg =
      Number.isFinite(frameIntervalAvg) && frameIntervalAvg > 0
        ? 1000 / frameIntervalAvg
        : NaN;
    const fpsOnePercentLow =
      Number.isFinite(frameIntervalP99) && frameIntervalP99 > 0
        ? 1000 / frameIntervalP99
        : NaN;
    const frameWorkAvg = perfMean(perfTelemetry.frameMs);
    const frameWorkP95 = perfPercentile(perfTelemetry.frameMs, 0.95);
    const frameWorkMax = perfMax(perfTelemetry.frameMs);
    const simStepAvg = perfMean(perfTelemetry.simSteps);
    const simStepMax = perfMax(perfTelemetry.simSteps);
    const simOpsSec =
      Number.isFinite(frameIntervalAvg) && frameIntervalAvg > 0 && Number.isFinite(simStepAvg)
        ? (simStepAvg * 1000) / frameIntervalAvg
        : NaN;

    lines.push(`perf (rolling ${perfTelemetry.frameMs.length}f):`);
    lines.push(
      `frame interval ms avg=${formatNum(frameIntervalAvg, 2)} p95=${formatNum(frameIntervalP95, 2)} p99=${formatNum(frameIntervalP99, 2)} max=${formatNum(frameIntervalMax, 2)} | fps avg=${formatNum(fpsAvg, 1)} 1%low=${formatNum(fpsOnePercentLow, 1)}`
    );
    lines.push(
      `frame work ms avg=${formatNum(frameWorkAvg, 2)} p95=${formatNum(frameWorkP95, 2)} max=${formatNum(frameWorkMax, 2)}`
    );
    lines.push(
      `sim steps/frame avg=${formatNum(simStepAvg, 2)} max=${formatNum(simStepMax, 0)} | sim steps/sec=${formatNum(simOpsSec, 1)}`
    );
    lines.push(
      `sim ms avg=${formatNum(perfMean(perfTelemetry.simMs), 2)} | simulated dt/frame avg=${formatNum(perfMean(perfTelemetry.simulatedDtMs), 2)}`
    );
    lines.push(
      `subsystem ms avg: physics=${formatNum(perfMean(perfTelemetry.physicsMs), 2)} pickups=${formatNum(perfMean(perfTelemetry.pickupsMs), 2)} spawn=${formatNum(perfMean(perfTelemetry.spawnMs), 2)} cat=${formatNum(perfMean(perfTelemetry.catMs), 2)} cup=${formatNum(perfMean(perfTelemetry.cupMs), 2)} shatter=${formatNum(perfMean(perfTelemetry.shatterMs), 2)}`
    );
    lines.push(
      `render last: drawCalls=${formatNum(sample.drawCalls, 0)} tris=${formatNum(sample.triangles, 0)} geo=${formatNum(sample.geometries, 0)} tex=${formatNum(sample.textures, 0)}`
    );
    lines.push(
      `render avg: drawCalls=${formatNum(perfMean(perfTelemetry.drawCalls), 1)} tris=${formatNum(perfMean(perfTelemetry.triangles), 0)}`
    );
    lines.push(
      `repath/sec avg=${formatNum(perfMean(perfTelemetry.repathPerSec), 2)} max=${formatNum(perfMax(perfTelemetry.repathPerSec), 2)}`
    );
    lines.push(`timeScale=${formatNum(sample.timeScale, 2)}x`);

    const mem = globalThis?.performance?.memory;
    if (
      mem &&
      Number.isFinite(mem.usedJSHeapSize) &&
      Number.isFinite(mem.jsHeapSizeLimit)
    ) {
      const usedMb = mem.usedJSHeapSize / (1024 * 1024);
      const limitMb = mem.jsHeapSizeLimit / (1024 * 1024);
      const pct = limitMb > 0 ? (usedMb / limitMb) * 100 : NaN;
      lines.push(`heap: used=${formatNum(usedMb, 1)}MB / limit=${formatNum(limitMb, 1)}MB (${formatNum(pct, 1)}%)`);
    } else {
      lines.push("heap: unavailable (browser does not expose performance.memory)");
    }

    return lines;
  }

  function buildPathProfilerLines() {
    if (!isFlagOn("showPathProfiler")) return [];
    const lines = [];
    const profiler = cat.nav?.pathProfiler;
    if (!profiler || typeof profiler !== "object") {
      lines.push("path profiler: waiting for samples...");
      return lines;
    }
    const metrics = profiler.metrics || {};
    const counters = profiler.counters || {};
    const summarizeMetric = (name, label) => {
      const metric = metrics[name];
      if (!metric || !Array.isArray(metric.samples) || metric.samples.length === 0) return `${label}: no samples`;
      return `${label}: avg=${formatNum(perfMean(metric.samples), 2)} p95=${formatNum(perfPercentile(metric.samples, 0.95), 2)} max=${formatNum(perfMax(metric.samples), 2)} calls=${formatNum(metric.calls, 0)} slow=${formatNum(metric.slowCount, 0)}`;
    };
    const hitRate = (hits, misses) => {
      const total = (Number(hits) || 0) + (Number(misses) || 0);
      return total > 0 ? `${formatNum((100 * (Number(hits) || 0)) / total, 1)}%` : "na";
    };

    lines.push("path lag profiler:");
    lines.push(summarizeMetric("computeCatPath", "compute path"));
    lines.push(summarizeMetric("computeRecastPath", "recast solve"));
    lines.push(summarizeMetric("computeFallbackCatPath", "fallback A*"));
    lines.push(summarizeMetric("buildTriangleNavMesh", "triangle navmesh"));
    lines.push(summarizeMetric("buildRecastNavEntry", "navmesh entry"));
    lines.push(summarizeMetric("ensureCatPath", "ensure path"));
    lines.push(summarizeMetric("canReachGroundTarget", "reachability"));
    lines.push(summarizeMetric("buildCatObstacles", "build obstacles"));
    lines.push(summarizeMetric("findNearestWalkablePoint", "nearest walkable"));
    lines.push(summarizeMetric("stepDetourCrowdToward", "detour crowd step"));
    lines.push(
      `cache hit rates: path=${hitRate(counters.pathCacheHits, counters.pathCacheMisses)} family=${hitRate(counters.pathFamilyHits, counters.pathFamilyMisses)} corridor=${hitRate(counters.pathCorridorHits, counters.pathCorridorMisses)} reach=${hitRate(counters.reachabilityCacheHits, counters.reachabilityCacheMisses)} nearest=${hitRate(counters.nearestWalkableCacheHits, counters.nearestWalkableCacheMisses)} obstacles=${hitRate(counters.obstacleCacheHits, counters.obstacleCacheMisses)} tri=${hitRate(counters.triangleNavMeshCacheHits, counters.triangleNavMeshCacheMisses)}`
    );
    lines.push(
      `path modes: direct=${formatNum(counters.computeCatPathDirect, 0)} recast=${formatNum(counters.computeCatPathRecast, 0)} fallback=${formatNum(counters.computeCatPathFallback, 0)} fallbackMiss=${formatNum(counters.computeCatPathFallbackMiss, 0)} none=${formatNum(counters.computeCatPathNone, 0)}`
    );
    lines.push(
      `ensure path actions: computed=${formatNum(counters.ensureCatPathComputed, 0)} skipped=${formatNum(counters.ensureCatPathSkipped, 0)} throttled=${formatNum(counters.ensureCatPathThrottled, 0)} | recast entry cache hits=${formatNum(counters.recastEntryCacheHits, 0)} rebuilds=${formatNum(counters.recastEntryRebuilds, 0)}`
    );
    const slowEvents = Array.isArray(profiler.events) ? profiler.events.slice(-8) : [];
    if (slowEvents.length) {
      lines.push("recent slow events:");
      for (const evt of slowEvents) {
        const parts = [`- ${String(evt.kind || "path")}: ${formatNum(evt.ms, 2)}ms`];
        if (evt.mode) parts.push(`mode=${evt.mode}`);
        if (evt.reason) parts.push(`reason=${evt.reason}`);
        if (evt.cache) parts.push(`cache=${evt.cache}`);
        if (evt.ok != null) parts.push(`ok=${evt.ok ? 1 : 0}`);
        if (Number.isFinite(evt.pathLen)) parts.push(`len=${formatNum(evt.pathLen, 0)}`);
        if (evt.includePickups != null) parts.push(`dyn=${evt.includePickups ? 1 : 0}`);
        lines.push(parts.join(" | "));
      }
    } else {
      lines.push("recent slow events: none yet");
    }
    return lines;
  }

  function updateTelemetryPanel(clockTime = 0) {
    if (!debugTelemetryWrap) return;
    if (
      !debugView.visible ||
      !debugView.advancedPanelVisible ||
      (!isFlagOn("showNavTelemetry") &&
        !isFlagOn("showRouteLoopTelemetry") &&
        !isFlagOn("showRouteEventTimeline") &&
        !isFlagOn("showPerfTelemetry") &&
        !isFlagOn("showPathProfiler"))
    ) {
      if (debugNavTelemetryPre) debugNavTelemetryPre.textContent = "";
      if (debugRouteTelemetryPre) debugRouteTelemetryPre.textContent = "";
      if (debugRouteEventPre) debugRouteEventPre.textContent = "";
      if (debugPerfTelemetryPre) debugPerfTelemetryPre.textContent = "";
      if (debugPathProfilerPre) debugPathProfilerPre.textContent = "";
      return;
    }
    if (clockTime < perfTelemetry.nextUpdateAt) return;
    perfTelemetry.nextUpdateAt = clockTime + TELEMETRY_UPDATE_INTERVAL;

    if (debugNavTelemetryPre) debugNavTelemetryPre.textContent = buildNavTelemetryLines(clockTime, false).join("\n");
    if (debugRouteTelemetryPre) debugRouteTelemetryPre.textContent = buildRouteLoopTelemetryLines(clockTime).join("\n");
    if (debugRouteEventPre) debugRouteEventPre.textContent = buildRouteEventTimelineLines(clockTime).join("\n");
    if (debugPerfTelemetryPre) debugPerfTelemetryPre.textContent = buildPerfTelemetryLines().join("\n");
    if (debugPathProfilerPre) debugPathProfilerPre.textContent = buildPathProfilerLines().join("\n");
    setAdvancedControlVisible();
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

  function makeDebugHalfCircleLoop(
    radius,
    y = 0,
    segments = 24,
    material = DEBUG_JUMP_CAT_HALF_RING_MAT,
    thetaStart = -Math.PI * 0.5,
    thetaLength = Math.PI
  ) {
    const segs = Math.max(6, segments | 0);
    const verts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const theta = thetaStart + t * thetaLength;
      verts.push(new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    return new THREE.Line(geo, material);
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

  function makeDebugHalfCylinderSolid(
    radius,
    height = 0.12,
    segments = 28,
    material = DEBUG_JUMP_CAT_HALF_SOLID_MAT,
    thetaStart = -Math.PI * 0.5,
    thetaLength = Math.PI
  ) {
    const geo = new THREE.CylinderGeometry(
      Math.max(0.001, radius),
      Math.max(0.001, radius),
      Math.max(0.01, height),
      Math.max(8, segments | 0),
      1,
      false,
      thetaStart,
      thetaLength
    );
    return new THREE.Mesh(geo, material);
  }

  function makeDebugCenterMarker(size = 0.025, material = DEBUG_CAT_CENTER_MAT) {
    return new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), material);
  }

  function addLine(group, from, to, material, renderOrder = 15) {
    if (!from || !to || !material) return;
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, material);
    line.renderOrder = renderOrder;
    group.add(line);
  }

  function addClearanceTube(group, from, to, radius, material, renderOrder = 21) {
    if (!from || !to || !material) return;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len <= 1e-5) return;
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(
        Math.max(0.004, radius),
        Math.max(0.004, radius),
        len,
        12,
        1,
        true
      ),
      material
    );
    tube.position.copy(from).addScaledVector(dir, 0.5);
    tube.quaternion.setFromUnitVectors(DEBUG_UP_AXIS, dir.normalize());
    tube.renderOrder = renderOrder;
    group.add(tube);
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
      !isFlagOn("showJumpCatCollision") &&
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

    if (isFlagOn("showJumpCatCollision") && cat.jump) {
      const jumpDir = new THREE.Vector3(
        (cat.jump.to?.x ?? cat.pos.x) - (cat.jump.from?.x ?? cat.pos.x),
        0,
        (cat.jump.to?.z ?? cat.pos.z) - (cat.jump.from?.z ?? cat.pos.z)
      );
      if (jumpDir.lengthSq() < 1e-6) {
        jumpDir.set(Math.sin(cat.group.rotation.y), 0, Math.cos(cat.group.rotation.y));
      } else {
        jumpDir.normalize();
      }
      const jumpYaw = Math.atan2(jumpDir.x, jumpDir.z);
      const keepOutRadius = Math.max(catCollisionRadius, CAT_NAV.clearance * 0.9);
      const keepOutHeight = Math.max(0.12, CAT_COLLISION.catBodyRadius * 1.45);

      const jumpHalfSolid = makeDebugHalfCylinderSolid(
        keepOutRadius,
        keepOutHeight,
        30,
        DEBUG_JUMP_CAT_HALF_SOLID_MAT
      );
      jumpHalfSolid.position.set(cat.pos.x, catBaseY + keepOutHeight * 0.5, cat.pos.z);
      jumpHalfSolid.rotation.y = jumpYaw;
      jumpHalfSolid.renderOrder = 15;
      debugView.dynamicCollisionGroup.add(jumpHalfSolid);

      const jumpHalfRing = makeDebugHalfCircleLoop(keepOutRadius, 0, 28, DEBUG_JUMP_CAT_HALF_RING_MAT);
      jumpHalfRing.position.set(cat.pos.x, catBaseY + 0.03, cat.pos.z);
      jumpHalfRing.rotation.y = jumpYaw;
      jumpHalfRing.renderOrder = 16;
      debugView.dynamicCollisionGroup.add(jumpHalfRing);
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

  function rebuildSurfaceJumpDebug() {
    clearDebugChildren(debugView.surfaceJumpGroup);
    const showBounds = isFlagOn("showSurfaceBounds");
    const showAnchors = isFlagOn("showSurfaceAnchors");
    const showProbes = isFlagOn("showSurfaceProbes");
    const showLinks = isFlagOn("showSurfaceLinks");
    const showLinkClearance = isFlagOn("showSurfaceLinkClearance");
    const showBlockers = isFlagOn("showSurfaceVectorBlockers");
    if (!showBounds && !showAnchors && !showProbes && !showLinks && !showLinkClearance && !showBlockers) return;
    if (typeof ctx.getSurfaceJumpDebugData !== "function") return;

    const data = ctx.getSurfaceJumpDebugData();
    if (!data) return;

    const addRectLoop = (rect, y, mat, yLift = 0.02, renderOrder = 16) => {
      const hx = Math.max(0.01, (rect.maxX - rect.minX) * 0.5);
      const hz = Math.max(0.01, (rect.maxZ - rect.minZ) * 0.5);
      const cx = (rect.minX + rect.maxX) * 0.5;
      const cz = (rect.minZ + rect.maxZ) * 0.5;
      const loop = makeDebugRectLoop(hx, hz, 0, mat);
      loop.position.set(cx, y + yLift, cz);
      loop.renderOrder = renderOrder;
      debugView.surfaceJumpGroup.add(loop);
    };
    const addObstacleSolid = (obs, material, renderOrder = 21) => {
      const oy = Number.isFinite(obs?.y) ? obs.y : 0;
      const h = Number.isFinite(obs?.h) ? Math.max(0.01, obs.h) : 0.02;
      const y = oy;
      let solid = null;
      if (obs?.kind === "circle") {
        solid = makeDebugCylinderSolid(Math.max(0.01, obs.r || 0.01), h, 24, material);
      } else {
        solid = makeDebugBoxSolid(
          Math.max(0.01, obs.hx || 0.01),
          h * 0.5,
          Math.max(0.01, obs.hz || 0.01),
          material
        );
        if (obs?.kind === "obb" && Number.isFinite(obs?.yaw)) solid.rotation.y = obs.yaw;
      }
      if (!solid) return;
      solid.position.set(obs.x || 0, y, obs.z || 0);
      solid.renderOrder = renderOrder;
      debugView.surfaceJumpGroup.add(solid);
    };

    if (showBounds || showAnchors) {
      const surfaces = Array.isArray(data.surfaces) ? data.surfaces : [];
      for (const surface of surfaces) {
        const surfaceY = Number.isFinite(surface?.y) ? surface.y : 0;
        if (showBounds) {
          if (surface?.outer) addRectLoop(surface.outer, surfaceY, DEBUG_SURFACE_OUTER_MAT, 0.02, 16);
          if (surface?.inner) addRectLoop(surface.inner, surfaceY, DEBUG_SURFACE_INNER_MAT, 0.024, 17);
        }
        if (!showAnchors || !Array.isArray(surface?.anchors)) continue;
        for (const anchor of surface.anchors) {
          const outer = anchor?.outer;
          const inner = anchor?.inner;
          if (!outer || !inner) continue;
          const y = surfaceY + 0.026;
          const outerPt = new THREE.Vector3(outer.x, y, outer.z);
          const innerPt = new THREE.Vector3(inner.x, y, inner.z);
          addLine(debugView.surfaceJumpGroup, outerPt, innerPt, DEBUG_SURFACE_ANCHOR_LINK_MAT, 17);

          const outerMarker = makeDebugCenterMarker(0.018, DEBUG_SURFACE_ANCHOR_OUTER_MAT);
          outerMarker.position.copy(outerPt);
          outerMarker.renderOrder = 18;
          debugView.surfaceJumpGroup.add(outerMarker);

          const innerMarker = makeDebugCenterMarker(0.018, DEBUG_SURFACE_ANCHOR_INNER_MAT);
          innerMarker.position.copy(innerPt);
          innerMarker.renderOrder = 18;
          debugView.surfaceJumpGroup.add(innerMarker);
        }
      }
    }

    if (showProbes) {
      const probes = Array.isArray(data.probes) ? data.probes : [];
      for (const probe of probes) {
        const origin = probe?.origin;
        const end = probe?.end;
        if (!origin || !end) continue;
        const upValid = !!probe?.validUp;
        const downValid = !!probe?.validDown;
        const isHit = !!probe?.hit;
        const isDownOnly = isHit && !upValid && downValid;
        const mat = isHit
          ? (upValid ? DEBUG_SURFACE_PROBE_HIT_MAT : (isDownOnly ? DEBUG_SURFACE_PROBE_DOWN_ONLY_MAT : DEBUG_SURFACE_PROBE_MISS_MAT))
          : DEBUG_SURFACE_PROBE_MISS_MAT;
        addLine(debugView.surfaceJumpGroup, origin, end, mat, 18);

        const endMarker = makeDebugCenterMarker(
          isHit ? 0.014 : 0.012,
          isHit
            ? (upValid ? DEBUG_SURFACE_PROBE_END_HIT_MAT : (isDownOnly ? DEBUG_SURFACE_PROBE_END_DOWN_ONLY_MAT : DEBUG_SURFACE_PROBE_END_MISS_MAT))
            : DEBUG_SURFACE_PROBE_END_MISS_MAT
        );
        endMarker.position.copy(end);
        endMarker.renderOrder = 19;
        debugView.surfaceJumpGroup.add(endMarker);
      }
    }

    if (showLinks || showLinkClearance) {
      const downOnly = isFlagOn("showSurfaceDownLinksOnly");
      const upOnly = isFlagOn("showSurfaceUpLinksOnly");
      const showUp = !downOnly || upOnly;
      const showDown = !upOnly || downOnly;
      const links = Array.isArray(data.links) ? data.links : [];
      for (const link of links) {
        const jumpFrom = link?.jumpFrom;
        const hook = link?.hook;
        const top = link?.top;
        if (!jumpFrom || !hook || !top) continue;
        const fromY = Number.isFinite(link?.fromY) ? link.fromY : (Number.isFinite(jumpFrom.y) ? jumpFrom.y : 0);
        const toY = Number.isFinite(link?.toY) ? link.toY : (Number.isFinite(top.y) ? top.y : fromY);
        const launchStart = link?.upLaunchStart || new THREE.Vector3(jumpFrom.x, fromY, jumpFrom.z);
        const launchFullEnd = link?.upHookStart || new THREE.Vector3(hook.x, toY, hook.z);
        const launchEnd = link?.upLaunchEnd || launchFullEnd;
        const hookStart = launchFullEnd;
        const hookFullEnd = new THREE.Vector3(top.x, toY, top.z);
        const hookEnd = link?.upHookEnd || hookFullEnd;
        const jumpFromDown = new THREE.Vector3(jumpFrom.x, fromY, jumpFrom.z);
        const downStart = link?.downStart || hookFullEnd;
        const downEnd = link?.downEnd || jumpFromDown;
        const upMat = link.validUp ? DEBUG_SURFACE_LINK_VALID_MAT : DEBUG_SURFACE_LINK_BLOCKED_MAT;
        const downMat = link.validDown ? DEBUG_SURFACE_DOWN_LINK_VALID_MAT : DEBUG_SURFACE_DOWN_LINK_BLOCKED_MAT;
        if (showLinks && showUp) {
          addLine(debugView.surfaceJumpGroup, launchStart, launchEnd, upMat, 19);
          if (!link?.upLaunchBlocked) {
            addLine(debugView.surfaceJumpGroup, hookStart, hookEnd, upMat, 19);
          }
          if (!link.validUp && (link?.upLaunchBlocked || link?.upHookBlocked)) {
            const blockedAt = link?.upLaunchBlocked ? launchEnd : hookEnd;
            const blockedMarker = makeDebugCenterMarker(0.014, DEBUG_SURFACE_LINK_BLOCKED_POINT_MAT);
            blockedMarker.position.copy(blockedAt);
            blockedMarker.renderOrder = 20;
            debugView.surfaceJumpGroup.add(blockedMarker);
          }
        }
        if (showLinks && showDown) addLine(debugView.surfaceJumpGroup, downStart, downEnd, downMat, 20);
        if (showLinks && showDown && !showUp && !link.validDown && link?.downBlocked) {
          const blockedMarker = makeDebugCenterMarker(0.014, DEBUG_SURFACE_LINK_BLOCKED_POINT_MAT);
          blockedMarker.position.copy(downEnd);
          blockedMarker.renderOrder = 20;
          debugView.surfaceJumpGroup.add(blockedMarker);
        }

        if (showLinks && showUp) {
          const jumpFromMarker = makeDebugCenterMarker(0.016, DEBUG_SURFACE_LINK_POINT_MAT);
          jumpFromMarker.position.copy(jumpFromDown);
          jumpFromMarker.renderOrder = 20;
          debugView.surfaceJumpGroup.add(jumpFromMarker);
        } else if (showLinks && showDown) {
          const topMarker = makeDebugCenterMarker(0.016, DEBUG_SURFACE_LINK_POINT_MAT);
          topMarker.position.copy(hookFullEnd);
          topMarker.renderOrder = 20;
          debugView.surfaceJumpGroup.add(topMarker);
        }

        if (showLinkClearance) {
          const launchClearance = Math.max(
            0.02,
            Number.isFinite(link?.launchClearance) ? link.launchClearance : Math.max(CAT_COLLISION.catBodyRadius, CAT_NAV.clearance * 0.9)
          );
          const landingClearance = Math.max(
            0.02,
            Number.isFinite(link?.landingClearance) ? link.landingClearance : Math.max(CAT_COLLISION.catBodyRadius, CAT_COLLISION.catBodyRadius * 1.5)
          );
          const upClearMat = link.validUp ? DEBUG_SURFACE_LINK_CLEARANCE_VALID_MAT : DEBUG_SURFACE_LINK_CLEARANCE_BLOCKED_MAT;
          const downClearMat = link.validDown ? DEBUG_SURFACE_LINK_CLEARANCE_VALID_MAT : DEBUG_SURFACE_LINK_CLEARANCE_BLOCKED_MAT;

          if (showUp) {
            addClearanceTube(debugView.surfaceJumpGroup, launchStart, launchFullEnd, launchClearance, upClearMat, 21);
            addClearanceTube(debugView.surfaceJumpGroup, hookStart, hookFullEnd, landingClearance, upClearMat, 21);
          }
          if (showDown) {
            addClearanceTube(debugView.surfaceJumpGroup, downStart, jumpFromDown, launchClearance, downClearMat, 21);
          }
        }
      }
    }

    if (showBlockers) {
      const blockers = Array.isArray(data.vectorBlockers) ? data.vectorBlockers : [];
      for (const blocker of blockers) {
        const ignoredForSomeSurface =
          Array.isArray(blocker?.jumpIgnoreSurfaceIds) && blocker.jumpIgnoreSurfaceIds.length > 0;
        const mat =
          blocker?.blockerClass === "surface" || ignoredForSomeSurface
            ? DEBUG_SURFACE_BLOCKER_SURFACE_SOLID_MAT
            : DEBUG_SURFACE_BLOCKER_OBJECT_SOLID_MAT;
        addObstacleSolid(blocker, mat, 21);
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
    debugView.surfaceJumpGroup.visible = true;
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

  function getSurfaceY(surfaceId, fallback = 0) {
    const id = String(surfaceId || "floor");
    if (id === "floor") return 0;
    const surface = typeof ctx.getSurfaceById === "function" ? ctx.getSurfaceById(id) : null;
    return Number.isFinite(surface?.y) ? Number(surface.y) : fallback;
  }

  function getVecY(vec, fallback = 0) {
    return Number.isFinite(vec?.y) ? Number(vec.y) : fallback;
  }

  function cloneRoutePoint(point, fallbackY = 0) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
    return new THREE.Vector3(point.x, getVecY(point, fallbackY), point.z);
  }

  function cloneRoutePointForcedY(point, forcedY = 0, fallbackY = forcedY) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
    const y = Number.isFinite(forcedY) ? Number(forcedY) : getVecY(point, fallbackY);
    return new THREE.Vector3(point.x, y, point.z);
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

  function appendActiveJumpPath(points, jump, steps = 16) {
    if (!jump?.from || !jump?.to) return false;
    const start = new THREE.Vector3(jump.from.x, Number.isFinite(jump.fromY) ? jump.fromY : cat.group.position.y, jump.from.z);
    const end = new THREE.Vector3(jump.to.x, Number.isFinite(jump.toY) ? jump.toY : cat.group.position.y, jump.to.z);
    const dur = Math.max(1e-5, Number(jump.dur) || 0.00001);
    const elapsed = Math.max(0, Number(jump.t) || 0);
    const rawU = THREE.MathUtils.clamp(elapsed / dur, 0, 1);
    const isDownJump = end.y <= start.y + 0.03;
    const easePos = !!jump.easePos;
    const easeY = !!jump.easeY;
    const arc = Math.max(0.02, Number(jump.arc) || 0.4);

    const sampleAt = (u) => {
      const uPos = easePos ? THREE.MathUtils.smootherstep(u, 0, 1) : u;
      let uY = u;
      if (easeY) {
        uY = isDownJump ? THREE.MathUtils.smoothstep(u, 0, 1) : Math.pow(u, 0.74);
      }
      const x = THREE.MathUtils.lerp(start.x, end.x, uPos);
      const z = THREE.MathUtils.lerp(start.z, end.z, uPos);
      let lift = Math.sin(Math.PI * u) * arc;
      if (isDownJump) {
        const apexU = 0.28;
        if (u <= apexU) {
          lift = arc * (u / Math.max(1e-5, apexU));
        } else {
          const downU = (u - apexU) / Math.max(1e-5, 1 - apexU);
          lift = arc * Math.pow(Math.max(0, 1 - downU), 1.8);
        }
      }
      const y = THREE.MathUtils.lerp(start.y, end.y, uY) + lift;
      return new THREE.Vector3(x, y, z);
    };

    const current = sampleAt(rawU);
    pushPathPoint(points, cat.pos.x, liftedY(cat.group.position.y), cat.pos.z);
    if ((cat.pos.x - current.x) ** 2 + (cat.pos.z - current.z) ** 2 > 0.02 * 0.02 || Math.abs(cat.group.position.y - current.y) > 0.02) {
      pushPathPoint(points, current.x, liftedY(current.y), current.z);
    }
    for (let i = 1; i <= steps; i++) {
      const u = rawU + ((1 - rawU) * i) / steps;
      const p = sampleAt(Math.min(1, u));
      pushPathPoint(points, p.x, liftedY(p.y), p.z);
    }
    return true;
  }

  function appendGroundNavPath(points, options = {}) {
    const preferStable = !!options.preferStable;
    const targetOverride = options.targetOverride || null;
    const requireTargetAlignment = !!options.requireTargetAlignment;
    const requireEndAlignment = !!options.requireEndAlignment;
    const forcePlaneY = options.forcePlaneY !== false;
    const alignRadius = Number.isFinite(options.alignRadius) ? Math.max(0.05, Number(options.alignRadius)) : 0.38;
    const endAlignRadius = Number.isFinite(options.endAlignRadius) ? Math.max(0.05, Number(options.endAlignRadius)) : alignRadius;
    const planeY = Number.isFinite(options.planeY)
      ? Number(options.planeY)
      : (Number.isFinite(targetOverride?.y)
        ? Number(targetOverride.y)
        : (Number.isFinite(cat.nav?.debugDestination?.y)
          ? Number(cat.nav.debugDestination.y)
          : (cat.group.position.y > 0.12 ? cat.group.position.y : 0)));
    const step = cat.nav?.debugStep || {};
    const hasChase =
      Number.isFinite(step.chaseX) &&
      Number.isFinite(step.chaseZ);
    const chaseY = forcePlaneY
      ? planeY
      : (Number.isFinite(step.chaseY) ? step.chaseY : planeY);
    const chasePoint = hasChase
      ? new THREE.Vector3(step.chaseX, chaseY, step.chaseZ)
      : null;

    const target = targetOverride || cat.nav?.debugDestination || null;
    const targetHasXZ = !!(target && Number.isFinite(target.x) && Number.isFinite(target.z));
    const targetY = forcePlaneY ? planeY : (Number.isFinite(target?.y) ? Number(target.y) : planeY);
    const targetFlat = targetHasXZ ? new THREE.Vector3(target.x, planeY, target.z) : null;

    if (step.direct) {
      if (chasePoint) {
        const chaseDrawY = Number.isFinite(chasePoint.y) ? chasePoint.y : planeY;
        pushPathPoint(points, chasePoint.x, liftedY(chaseDrawY), chasePoint.z);
        if (targetHasXZ) {
          pushPathPoint(points, target.x, liftedY(targetY), target.z);
        }
        return true;
      }
      return false;
    }

    const path = cat.nav.path;
    if (!Array.isArray(path) || path.length < 2) {
      if (chasePoint) {
        const chaseDrawY = Number.isFinite(chasePoint.y) ? chasePoint.y : planeY;
        pushPathPoint(points, chasePoint.x, liftedY(chaseDrawY), chasePoint.z);
        if (targetHasXZ) {
          pushPathPoint(points, target.x, liftedY(targetY), target.z);
        }
        return true;
      }
      return false;
    }

    const maxIdx = path.length - 1;
    let startIdx = Math.min(maxIdx, Math.max(1, cat.nav.index || 1));

    if (chasePoint && !preferStable) {
      const chaseY = Number.isFinite(chasePoint.y) ? chasePoint.y : planeY;
      pushPathPoint(points, chasePoint.x, liftedY(chaseY), chasePoint.z);
      while (startIdx < maxIdx && path[startIdx].distanceToSquared(chasePoint) < 0.12 * 0.12) {
        startIdx++;
      }
    }

    let endIdx = path.length - 1;
    if (targetFlat) {
      let nearestIdx = -1;
      let nearestD2 = Infinity;
      for (let i = startIdx; i < path.length; i++) {
        const p = path[i];
        if (!p) continue;
        const dx = p.x - targetFlat.x;
        const dz = p.z - targetFlat.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < nearestD2) {
          nearestD2 = d2;
          nearestIdx = i;
        }
      }
      const endPoint = path[path.length - 1];
      const endDx = endPoint?.x - targetFlat.x;
      const endDz = endPoint?.z - targetFlat.z;
      const endD2 = Number.isFinite(endDx) && Number.isFinite(endDz)
        ? endDx * endDx + endDz * endDz
        : Infinity;
      const chaseDx = chasePoint?.x - targetFlat.x;
      const chaseDz = chasePoint?.z - targetFlat.z;
      const chaseD2 = chasePoint && Number.isFinite(chaseDx) && Number.isFinite(chaseDz)
        ? chaseDx * chaseDx + chaseDz * chaseDz
        : Infinity;
      const pathClearlyTargetsSomethingElse = endD2 > 0.75 * 0.75 && nearestD2 > alignRadius * alignRadius;
      const endAligned = endD2 <= endAlignRadius * endAlignRadius;
      if (requireEndAlignment && !endAligned) {
        if (chasePoint && chaseD2 <= 0.45 * 0.45) {
          pushPathPoint(points, target.x, liftedY(targetY), target.z);
          return true;
        }
        return false;
      }
      if (nearestIdx >= startIdx && nearestD2 <= alignRadius * alignRadius) {
        endIdx = nearestIdx;
      } else if (requireTargetAlignment && pathClearlyTargetsSomethingElse) {
        if (chasePoint && chaseD2 <= 0.45 * 0.45) {
          pushPathPoint(points, target.x, liftedY(targetY), target.z);
          return true;
        }
        return false;
      }
    }

    for (let i = startIdx; i <= endIdx && i < path.length; i++) {
      const p = path[i];
      const py = forcePlaneY ? planeY : (Number.isFinite(p.y) ? p.y : planeY);
      pushPathPoint(points, p.x, liftedY(py), p.z);
    }

    if (targetHasXZ) {
      pushPathPoint(points, target.x, liftedY(targetY), target.z);
    }
    return true;
  }

  function isPreJumpDebugPhase() {
    const status = String(cat.status || "");
    return status === 'Preparing jump' ||
      status === 'Approaching jump point' ||
      status === 'Preparing jump down' ||
      status === 'Repositioning';
  }

  function isLandingDebugPhase() {
    return cat.state === 'landStop' || String(cat.status || '') === 'Landing';
  }

  function resolveRemainingRouteStartIndex(route, startPoint, startIndex = null) {
    if (!route?.active || !Array.isArray(route.segments) || route.segments.length === 0) {
      return Number.isFinite(startIndex) ? Math.max(0, startIndex | 0) : 0;
    }
    let idx = Number.isFinite(startIndex) ? Math.max(0, startIndex | 0) : Math.max(0, route.segmentIndex | 0);
    if (idx >= route.segments.length) return route.segments.length;
    const cursor = cloneRoutePoint(startPoint, cat.group.position.y) || new THREE.Vector3(cat.pos.x, cat.group.position.y, cat.pos.z);
    const segment = route.segments[idx] || null;
    if (!segment) return idx;

    const skipIfPastJumpLanding = (landingPoint, anchorPoint) => {
      if (!landingPoint) return idx;
      const nearLanding = cursor.distanceToSquared(landingPoint) <= 0.32 * 0.32;
      const fartherFromAnchor = !anchorPoint || cursor.distanceToSquared(landingPoint) + 0.01 < cursor.distanceToSquared(anchorPoint);
      if (cat.jump || isLandingDebugPhase() || (nearLanding && fartherFromAnchor)) {
        return Math.min(route.segments.length, idx + 1);
      }
      return idx;
    };

    if (segment.kind === 'jump-up-approach') {
      const anchorPoint = cloneRoutePoint(route[segment.pointKey], getSurfaceY(segment.supportSurfaceId, cursor.y));
      const landingBaseY = segment.landingYMode === 'target'
        ? getVecY(route.target, getSurfaceY(route.surfaceId || route.finalSurfaceId || segment.supportSurfaceId, cursor.y))
        : getVecY(route[segment.landingKey], getSurfaceY(route.surfaceId || route.finalSurfaceId || segment.supportSurfaceId, cursor.y));
      const landingPoint = cloneRoutePointForcedY(route[segment.landingKey], landingBaseY, getSurfaceY(route.surfaceId || route.finalSurfaceId || segment.supportSurfaceId, cursor.y));
      return skipIfPastJumpLanding(landingPoint, anchorPoint);
    }

    if (segment.kind === 'jump-down-approach') {
      const anchorPoint = cloneRoutePoint(route[segment.pointKey], getSurfaceY(segment.supportSurfaceId, cursor.y));
      const landingPoint = cloneRoutePointForcedY(route[segment.jumpToKey], getSurfaceY(segment.desiredLandingSurfaceId || 'floor', 0));
      return skipIfPastJumpLanding(landingPoint, anchorPoint);
    }

    return idx;
  }

  function appendRemainingRouteSegments(points, route, startPoint, startIndex = null) {
    if (!route?.active || !Array.isArray(route.segments) || route.segments.length === 0) return false;
    let cursor = cloneRoutePoint(startPoint, cat.group.position.y) || new THREE.Vector3(cat.pos.x, cat.group.position.y, cat.pos.z);
    let appended = false;
    const firstIndex = resolveRemainingRouteStartIndex(route, cursor, startIndex);
    const preJumpPhase = isPreJumpDebugPhase();
    const landingPhase = isLandingDebugPhase();
    for (let i = firstIndex; i < route.segments.length; i++) {
      const segment = route.segments[i] || null;
      if (!segment) continue;
      const activeSegment = i === Math.max(0, route.segmentIndex | 0);
      if (segment.kind === 'jump-up-approach') {
        const jumpAnchor = cloneRoutePoint(route[segment.pointKey], getSurfaceY(segment.supportSurfaceId, cursor.y));
        const landingBaseY = segment.landingYMode === 'target'
          ? getVecY(route.target, getSurfaceY(route.surfaceId || route.finalSurfaceId || segment.supportSurfaceId, cursor.y))
          : getVecY(route[segment.landingKey], getSurfaceY(route.surfaceId || route.finalSurfaceId || segment.supportSurfaceId, cursor.y));
        const landing = cloneRoutePointForcedY(route[segment.landingKey], landingBaseY, getSurfaceY(route.surfaceId || route.finalSurfaceId || segment.supportSurfaceId, cursor.y));
        if (!jumpAnchor || !landing) continue;
        const supportY = getSurfaceY(segment.supportSurfaceId, cursor.y);
        if (activeSegment && !cat.jump) {
          const nearJumpAnchor = cursor.distanceToSquared(jumpAnchor) <= 0.24 * 0.24;
          const inLaunchPrep = String(cat.status || '') === 'Preparing jump';
          if (inLaunchPrep && nearJumpAnchor) {
            appendJumpArc(points, cursor, getVecY(cursor, supportY), landing, getVecY(landing, landingBaseY), 0.46, 14);
            cursor = landing.clone();
            const nextSegment = route.segments[i + 1] || null;
            if (nextSegment?.kind === 'walk-surface') {
              const settleTarget = cloneRoutePoint(
                route[nextSegment.pointKey],
                getSurfaceY(nextSegment.supportSurfaceId || route.surfaceId || route.finalSurfaceId, getVecY(landing, landingBaseY))
              );
              if (settleTarget) {
                appendSurfaceLine(
                  points,
                  cursor,
                  settleTarget,
                  getSurfaceY(nextSegment.supportSurfaceId || route.surfaceId || route.finalSurfaceId, getVecY(settleTarget, landingBaseY))
                );
                cursor = settleTarget.clone();
              }
            }
            appended = true;
            continue;
          }
          const useDirectSetupLine = preJumpPhase || nearJumpAnchor;
          if (useDirectSetupLine) {
            appendSurfaceLine(points, cursor, jumpAnchor, supportY);
          } else {
            const hasNav = appendGroundNavPath(points, {
              preferStable: false,
              targetOverride: jumpAnchor,
              planeY: supportY,
              requireTargetAlignment: true,
              requireEndAlignment: true,
              alignRadius: 0.22,
              endAlignRadius: 0.18,
            });
            if (!hasNav) appendSurfaceLine(points, cursor, jumpAnchor, supportY);
          }
        } else {
          appendSurfaceLine(points, cursor, jumpAnchor, supportY);
        }
        appendJumpArc(points, jumpAnchor, supportY, landing, getVecY(landing, landingBaseY), 0.46, 14);
        cursor = landing.clone();
        appended = true;
        // Keep the preview fully 3D through the landing and onto the next segment.
        // Stopping at the landing point makes the arc endpoint look like it drops
        // back to the floor, especially for lower->upper jump previews.
        continue;
      }
      if (segment.kind === 'jump-down-approach') {
        const jumpOff = cloneRoutePoint(route[segment.pointKey], getSurfaceY(segment.supportSurfaceId, cursor.y));
        const jumpDown = cloneRoutePointForcedY(route[segment.jumpToKey], getSurfaceY(segment.desiredLandingSurfaceId || 'floor', 0));
        if (!jumpOff || !jumpDown) continue;
        const supportY = getSurfaceY(segment.supportSurfaceId, cursor.y);
        const landingY = getVecY(jumpDown, getSurfaceY(segment.desiredLandingSurfaceId || 'floor', 0));
        if (activeSegment && !cat.jump) {
          const nearJumpOff = cursor.distanceToSquared(jumpOff) <= 0.24 * 0.24;
          const inLaunchPrep = String(cat.status || '') === 'Preparing jump down';
          if (inLaunchPrep && nearJumpOff) {
            appendJumpArc(points, cursor, getVecY(cursor, supportY), jumpDown, landingY, 0.34, 12);
            cursor = jumpDown.clone();
            const nextSegment = route.segments[i + 1] || null;
            if (nextSegment?.kind === 'walk-floor' || nextSegment?.kind === 'walk-surface') {
              const settleTarget = cloneRoutePoint(
                route[nextSegment.pointKey],
                nextSegment.kind === 'walk-floor'
                  ? 0
                  : getSurfaceY(nextSegment.supportSurfaceId || route.surfaceId || route.finalSurfaceId, landingY)
              );
              if (settleTarget) {
                appendSurfaceLine(
                  points,
                  cursor,
                  settleTarget,
                  nextSegment.kind === 'walk-floor'
                    ? 0
                    : getSurfaceY(nextSegment.supportSurfaceId || route.surfaceId || route.finalSurfaceId, getVecY(settleTarget, landingY))
                );
                cursor = settleTarget.clone();
              }
            }
            appended = true;
            continue;
          }
          const useDirectSetupLine = preJumpPhase || nearJumpOff;
          if (useDirectSetupLine) {
            appendSurfaceLine(points, cursor, jumpOff, supportY);
          } else {
            const hasNav = appendGroundNavPath(points, {
              preferStable: false,
              targetOverride: jumpOff,
              planeY: supportY,
              requireTargetAlignment: true,
              requireEndAlignment: true,
              alignRadius: 0.22,
              endAlignRadius: 0.18,
            });
            if (!hasNav) appendSurfaceLine(points, cursor, jumpOff, supportY);
          }
        } else {
          appendSurfaceLine(points, cursor, jumpOff, supportY);
        }
        appendJumpArc(points, jumpOff, supportY, jumpDown, landingY, 0.34, 12);
        cursor = jumpDown.clone();
        appended = true;
        continue;
      }
      if (segment.kind === 'walk-surface' || segment.kind === 'walk-floor') {
        const targetPoint = cloneRoutePoint(route[segment.pointKey], segment.kind === 'walk-floor'
          ? 0
          : getSurfaceY(segment.supportSurfaceId || route.surfaceId || route.finalSurfaceId, cursor.y));
        if (!targetPoint) continue;
        const surfaceY = segment.kind === 'walk-floor'
          ? 0
          : getSurfaceY(segment.supportSurfaceId || route.surfaceId || route.finalSurfaceId, getVecY(targetPoint, cursor.y));
        if (activeSegment && !cat.jump) {
          const useDirectSettleLine = landingPhase;
          if (useDirectSettleLine) {
            appendSurfaceLine(points, cursor, targetPoint, surfaceY);
          } else {
            const hasNav = appendGroundNavPath(points, {
              preferStable: false,
              targetOverride: targetPoint,
              planeY: surfaceY,
              requireTargetAlignment: segment.kind === 'walk-floor',
            });
            if (!hasNav) appendSurfaceLine(points, cursor, targetPoint, surfaceY);
          }
        } else {
          appendSurfaceLine(points, cursor, targetPoint, surfaceY);
        }
        cursor = targetPoint.clone();
        appended = true;
      }
    }
    return appended;
  }

  function buildPlannedPath() {
    const points = [];
    const route = cat.nav?.route || null;

    if (cat.jump) {
      const jumpTo = cat.jump.to || cat.pos;
      const jumpToY = Number.isFinite(cat.jump.toY) ? cat.jump.toY : cat.group.position.y;
      appendActiveJumpPath(points, cat.jump, 16);
      if (appendRemainingRouteSegments(points, route, new THREE.Vector3(jumpTo.x, jumpToY, jumpTo.z))) {
        return points;
      }
      const target = cat.nav?.debugDestination;
      if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
        appendSurfaceLine(points, new THREE.Vector3(jumpTo.x, jumpToY, jumpTo.z), target, getVecY(target, jumpToY));
      }
      return points;
    }

    const startPoint = new THREE.Vector3(cat.pos.x, cat.group.position.y, cat.pos.z);
    pushPathPoint(points, startPoint.x, liftedY(startPoint.y), startPoint.z);

    if (route?.active && appendRemainingRouteSegments(points, route, startPoint)) {
      return points;
    }

    if (appendGroundNavPath(points)) return points;

    const target = cat.nav?.debugDestination;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      appendSurfaceLine(points, startPoint, target, getVecY(target, startPoint.y));
    }
    return points;
  }

  function buildPathKey() {
    const step = cat.nav?.debugStep || {};
    const dst = cat.nav?.debugDestination || {};
    const route = cat.nav?.route || null;
    const q = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : "na");
    return [
      `state:${cat.state || "na"}`,
      `jump:${cat.jump ? 1 : 0}`,
      `onTable:${cat.onTable ? 1 : 0}`,
      `dbgMove:${cat.debugMoveActive ? 1 : 0}`,
      `dst:${q(dst.x)},${q(dst.y)},${q(dst.z)}`,
      `chase:${q(step.chaseX)},${q(step.chaseY)},${q(step.chaseZ)}`,
      `pi:${Number.isFinite(cat.nav?.index) ? cat.nav.index : "na"}`,
      `plen:${Array.isArray(cat.nav?.path) ? cat.nav.path.length : 0}`,
      `route:${makeRouteSig(route)}`,
      `seg:${route?.segmentIndex ?? "na"}/${route?.segments?.length ?? 0}`,
    ].join("|");
  }

  function rebuildCurrentPathDebug(clockTime) {
    if (!DEBUG_VIEW.enabled) return;
    if (!isFlagOn("showCurrentPath")) {
      if (debugView.pathMesh) debugView.pathMesh.visible = false;
      return;
    }

    const pathKey = buildPathKey();
    let path = buildPlannedPath();
    if (!path || path.length < 2) {
      const airborne = !!cat.jump || (!cat.onTable && cat.group.position.y > 0.08);
      if (
        airborne &&
        debugView.lastPathKey === pathKey &&
        Array.isArray(debugView.lastPathPoints) &&
        debugView.lastPathPoints.length >= 2 &&
        clockTime - debugView.lastPathAt <= 0.4
      ) {
        path = debugView.lastPathPoints;
      }
    } else {
      debugView.lastPathPoints = path.map((p) => p.clone());
      debugView.lastPathAt = clockTime;
      debugView.lastPathKey = pathKey;
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

    const route = cat.nav?.route || null;
    const activeSegment = route?.active && Array.isArray(route?.segments)
      ? route.segments[Math.max(0, route.segmentIndex | 0)] || null
      : null;
    const finalTarget = route?.active
      ? (route.finalTarget || route.target || cat.nav?.debugDestination)
      : cat.nav?.debugDestination;
    if (!finalTarget || !Number.isFinite(finalTarget.x) || !Number.isFinite(finalTarget.z)) return;

    const finalBaseY = getVecY(
      finalTarget,
      route?.active
        ? getSurfaceY(route.finalSurfaceId || route.surfaceId || activeSegment?.supportSurfaceId || 'floor', cat.group.position.y)
        : cat.group.position.y
    );
    const activePoint = activeSegment
      ? cloneRoutePoint(
          route?.[activeSegment.pointKey] || route?.target,
          activeSegment.kind === 'walk-floor'
            ? 0
            : getSurfaceY(activeSegment.supportSurfaceId || route?.surfaceId || route?.finalSurfaceId, finalBaseY)
        )
      : null;

    const group = new THREE.Group();
    const markerY = Math.max(0.08, finalBaseY + 0.08);
    group.position.set(finalTarget.x, markerY, finalTarget.z);

    const barLen = 0.72;
    const barThick = 0.075;
    const barGeo = new THREE.BoxGeometry(barLen, barThick, barThick);
    const barA = new THREE.Mesh(barGeo, DEBUG_TARGET_MESH_MAT);
    barA.rotation.y = Math.PI * 0.25;
    const barB = new THREE.Mesh(barGeo.clone(), DEBUG_TARGET_MESH_MAT);
    barB.rotation.y = -Math.PI * 0.25;
    group.add(barA, barB);

    const stemGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -(markerY - Math.max(0.02, finalBaseY + PATH_LIFT)), 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    const stem = new THREE.Line(stemGeo, DEBUG_TARGET_MAT);
    stem.renderOrder = 15;
    group.add(stem);

    if (activePoint && activePoint.distanceToSquared(new THREE.Vector3(finalTarget.x, finalBaseY, finalTarget.z)) > 0.04 * 0.04) {
      const ringGeo = new THREE.RingGeometry(0.12, 0.17, 24);
      const ringMat = new THREE.MeshBasicMaterial({
        color: DEBUG_VIEW.pathColor,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(activePoint.x - finalTarget.x, activePoint.y + PATH_LIFT - markerY, activePoint.z - finalTarget.z);
      ring.rotation.x = -Math.PI * 0.5;
      ring.renderOrder = 16;
      group.add(ring);
    }

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
        } else if (data.mode === "straight" || data.mode === "direct") {
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
    if (!debugView.surfaceJumpGroup.parent) debugView.root.add(debugView.surfaceJumpGroup);
    if (!debugView.astarGroup.parent) debugView.root.add(debugView.astarGroup);
    applyRenderModeVisibility();
    debugView.root.visible = debugView.visible;
    rebuildStaticCollisionDebug();
    rebuildDynamicCollisionDebug(clockTime);
    rebuildNavObstacleDebug();
    rebuildSurfaceJumpDebug();
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
    rebuildNavObstacleDebug();
    rebuildNavMeshDebug();
    rebuildSurfaceJumpDebug();
    rebuildCurrentPathDebug(clockTime);
    rebuildTargetMarkerDebug();
    rebuildAStarDebug();
    updateTelemetryPanel(clockTime);
  }

  function updateDebugButtonLabel() {
    if (!debugBtnEl) return;
    const modeLabel = debugView.advancedFlags.fullOverlayMode ? "Full" : "Clean";
    debugBtnEl.textContent = debugView.visible
      ? `Debug: On ${modeLabel} (B, N mode, A advanced, Right-click walk, T teleport, WASD move, Arrows rotate)`
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
    updatePerformanceSample,
  };
}
