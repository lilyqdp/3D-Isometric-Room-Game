import { computeCupSwipePlan } from "./cat-plans.js";
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
    { key: "showPerfTelemetry", label: "Live perf telemetry panel", default: false },
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
  const PERF_HISTORY_LIMIT = 300;
  const TELEMETRY_UPDATE_INTERVAL = 0.25;
  const perfTelemetry = {
    nextUpdateAt: 0,
    hasSample: false,
    lastSample: null,
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
      debugTelemetryWrap.style.display =
        debugView.visible &&
        debugView.advancedPanelVisible &&
        (isFlagOn("showNavTelemetry") || isFlagOn("showPerfTelemetry"))
          ? "block"
          : "none";
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

  function updatePerformanceSample(sample, clockTime = 0) {
    if (!sample || typeof sample !== "object") return;
    perfTelemetry.hasSample = true;
    perfTelemetry.lastSample = { ...sample };
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

  function buildNavTelemetryLines(clockTime = 0) {
    if (!isFlagOn("showNavTelemetry")) return [];
    const counters = cat.nav?.debugCounters || {};
    const step = cat.nav?.debugStep || {};
    const repathReasons = cat.nav?.debugRepathReasons || {};
    const lastRepathCause = cat.nav?.lastRepathCause || null;
    const events = Array.isArray(cat.nav?.debugEvents) ? cat.nav.debugEvents : [];
    const recent = events.slice(-8);
    const topRepathReasons = Object.entries(repathReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const recentRepathEvents = events
      .filter((e) => typeof e?.kind === "string" && e.kind.startsWith("repath-cause:"))
      .slice(-4);
    const jumpDown = cat.nav?.jumpDownDebug || null;
    const lines = [];
    lines.push(`state=${cat.state} status=${cat.status}`);
    if (cat.useClipLocomotion) {
      const activeSpecialClip = cat.clipSpecialAction?.getClip?.()?.name || "none";
      lines.push(`anim specialState=${cat.clipSpecialState || "none"} specialClip=${activeSpecialClip}`);
    }
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
      for (const e of recentRepathEvents) {
        const obs = e.obstacleLabel ? ` obs=${e.obstacleLabel}` : "";
        lines.push(`  - ${formatNum(clockTime - (e.t || clockTime), 2)}s ago | ${e.kind.replace("repath-cause:", "")}${obs}`);
      }
    }
    if (recent.length) {
      lines.push("events:");
      for (let i = 0; i < recent.length; i++) {
        const e = recent[i];
        const dt = clockTime - (e.t || clockTime);
        const obs = e.obstacleLabel ? ` | obs=${e.obstacleLabel}` : "";
        const sb = Number.isFinite(e.segmentBlockedFrames) ? ` | segF=${e.segmentBlockedFrames}` : "";
        lines.push(`  - ${formatNum(dt, 2)}s ago | ${e.kind || "evt"} | state=${e.state || "?"}${obs}${sb}`);
      }
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
    const frameAvg = perfMean(perfTelemetry.frameMs);
    const frameP95 = perfPercentile(perfTelemetry.frameMs, 0.95);
    const frameMax = perfMax(perfTelemetry.frameMs);
    const fpsAvg = Number.isFinite(frameAvg) && frameAvg > 0 ? 1000 / frameAvg : NaN;
    const simStepAvg = perfMean(perfTelemetry.simSteps);
    const simStepMax = perfMax(perfTelemetry.simSteps);
    const simOpsSec =
      Number.isFinite(frameAvg) && frameAvg > 0 && Number.isFinite(simStepAvg)
        ? (simStepAvg * 1000) / frameAvg
        : NaN;

    lines.push(`perf (rolling ${perfTelemetry.frameMs.length}f):`);
    lines.push(
      `frame ms avg=${formatNum(frameAvg, 2)} p95=${formatNum(frameP95, 2)} max=${formatNum(frameMax, 2)} | fps avg=${formatNum(fpsAvg, 1)}`
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

  function updateTelemetryPanel(clockTime = 0) {
    if (!debugTelemetryPre) return;
    if (
      !debugView.visible ||
      !debugView.advancedPanelVisible ||
      (!isFlagOn("showNavTelemetry") && !isFlagOn("showPerfTelemetry"))
    ) {
      debugTelemetryPre.textContent = "";
      return;
    }
    if (clockTime < perfTelemetry.nextUpdateAt) return;
    perfTelemetry.nextUpdateAt = clockTime + TELEMETRY_UPDATE_INTERVAL;

    const lines = [];
    const navLines = buildNavTelemetryLines(clockTime);
    const perfLines = buildPerfTelemetryLines();
    if (navLines.length) lines.push(...navLines);
    if (navLines.length && perfLines.length) lines.push("", "--------------------", "");
    if (perfLines.length) lines.push(...perfLines);
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

  function appendGroundNavPath(points, options = {}) {
    const preferStable = !!options.preferStable;
    const targetOverride = options.targetOverride || null;
    const planeY = Number.isFinite(cat.nav?.debugDestination?.y)
      ? cat.nav.debugDestination.y
      : (cat.group.position.y > 0.12 ? cat.group.position.y : 0);
    const step = cat.nav?.debugStep || {};
    const hasChase =
      Number.isFinite(step.chaseX) &&
      Number.isFinite(step.chaseZ);
    const chaseY = Number.isFinite(step.chaseY) ? step.chaseY : planeY;
    const chasePoint = hasChase
      ? new THREE.Vector3(step.chaseX, chaseY, step.chaseZ)
      : null;

    // If steering is currently direct, ignore stale cached path nodes and let caller draw direct line.
    if (step.direct) {
      if (chasePoint) {
        const chaseY = Number.isFinite(chasePoint.y) ? chasePoint.y : planeY;
        pushPathPoint(points, chasePoint.x, liftedY(chaseY), chasePoint.z);
        return true;
      }
      return false;
    }

    const path = cat.nav.path;
    if (!Array.isArray(path) || path.length < 2) {
      if (chasePoint) {
        const chaseY = Number.isFinite(chasePoint.y) ? chasePoint.y : planeY;
        pushPathPoint(points, chasePoint.x, liftedY(chaseY), chasePoint.z);
        return true;
      }
      return false;
    }

    const maxIdx = path.length - 1;
    let startIdx = Math.min(maxIdx, Math.max(1, cat.nav.index || 1));

    // First segment should match the actual active chase point used by steering.
    if (chasePoint && !preferStable) {
      const chaseY = Number.isFinite(chasePoint.y) ? chasePoint.y : planeY;
      pushPathPoint(points, chasePoint.x, liftedY(chaseY), chasePoint.z);
      while (startIdx < maxIdx && path[startIdx].distanceToSquared(chasePoint) < 0.12 * 0.12) {
        startIdx++;
      }
    }

    for (let i = startIdx; i < path.length; i++) {
      const p = path[i];
      const py = Number.isFinite(p.y) ? p.y : planeY;
      pushPathPoint(points, p.x, liftedY(py), p.z);
    }

    const target = targetOverride || cat.nav?.debugDestination;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      const targetY = Number.isFinite(target.y) ? target.y : planeY;
      pushPathPoint(points, target.x, liftedY(targetY), target.z);
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
      const hasNav = appendGroundNavPath(points, {
        preferStable: false,
        targetOverride: new THREE.Vector3(swipePlan.point.x, deskY, swipePlan.point.z),
      });
      if (!hasNav) appendSurfaceLine(points, cat.pos, swipePlan.point, deskY);
      appendSurfaceLine(points, swipePlan.point, cup.group.position, deskY);
      return points;
    }

    const isDeskJumpPlanState = cat.state === "toDesk" || cat.state === "prepareJump";
    if (isDeskJumpPlanState && cat.jumpAnchor) {
      const hasNav = appendGroundNavPath(points, {
        preferStable: false,
        targetOverride: cat.jumpAnchor,
      });
      if (!hasNav) appendSurfaceLine(points, cat.pos, cat.jumpAnchor, 0);
      else pushPathPoint(points, cat.jumpAnchor.x, liftedY(0), cat.jumpAnchor.z);

      // Use the runtime-cached jump targets only; avoid recomputing here because
      // planner fallback sampling is stochastic and causes debug-line jitter.
      const jumpTargets = cat.jumpTargets;
      if (jumpTargets?.hook) appendSurfaceLine(points, cat.jumpAnchor, jumpTargets.hook, 0);
      if (jumpTargets?.top) {
        const jumpFrom = jumpTargets.hook || cat.jumpAnchor;
        appendJumpArc(points, jumpFrom, 0, jumpTargets.top, desk.topY + 0.02, 0.46, 16);
        const desired = typeof ctx.getDeskDesiredTarget === "function" ? ctx.getDeskDesiredTarget() : null;
        if (desired && Number.isFinite(desired.x) && Number.isFinite(desired.z)) {
          appendSurfaceLine(points, jumpTargets.top, desired, desk.topY + 0.02);
        }
      }
      return points;
    }

    if (cat.state === "toCatnip" && !cat.onTable && cat.group.position.y <= 0.12) {
      if (appendGroundNavPath(points, { preferStable: false })) return points;
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
      const hasNav = appendGroundNavPath(points, {
        preferStable: false,
        targetOverride: new THREE.Vector3(cat.debugMoveTarget.x, y, cat.debugMoveTarget.z),
      });
      if (!hasNav) appendSurfaceLine(points, cat.pos, cat.debugMoveTarget, y);
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

  function buildPathKey() {
    const step = cat.nav?.debugStep || {};
    const dst = cat.nav?.debugDestination || {};
    const q = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : "na");
    return [
      `state:${cat.state || "na"}`,
      `jump:${cat.jump ? 1 : 0}`,
      `onTable:${cat.onTable ? 1 : 0}`,
      `dbgMove:${cat.debugMoveActive ? 1 : 0}`,
      `dst:${q(dst.x)},${q(dst.y)},${q(dst.z)}`,
      `chase:${q(step.chaseX)},${q(step.chaseZ)}`,
      `pi:${Number.isFinite(cat.nav?.index) ? cat.nav.index : "na"}`,
      `plen:${Array.isArray(cat.nav?.path) ? cat.nav.path.length : 0}`,
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

    const x = cat.nav.debugDestination.x;
    const z = cat.nav.debugDestination.z;
    const baseY = cat.nav.debugDestination.y;
    const y = Math.max(0.08, (Number.isFinite(baseY) ? baseY : 0) + 0.08);

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
    rebuildCurrentPathDebug(clockTime);
    rebuildTargetMarkerDebug();
    rebuildAStarDebug();
    rebuildSurfaceJumpDebug();
    updateTelemetryPanel(clockTime);
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
