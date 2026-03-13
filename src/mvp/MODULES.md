# MVP Code Map

This file maps the current MVP source files and what each one owns.

- `/src/mvp/main.js` (1541 lines)
  - app composition root and frame loop.
  - wires all subsystem runtimes, UI hooks, game-state transitions, and simulation steps.

- `/src/mvp/modules/main-debug-camera.js` (129 lines)
  - export: `createMainDebugCameraRuntime`.
  - debug camera key handling (`WASD`, arrows, `T`) and free-camera movement update.

- `/src/mvp/modules/cat-model-loader.js` (1006 lines)
  - export: `createCatModelRuntime`.
  - cat model load/normalize and animation-clip/action setup.

- `/src/mvp/modules/cat-animation.js` (397 lines)
  - export: `animateCatPoseRuntime`.
  - clip blending and per-state pose progression.

- `/src/mvp/modules/cat-state-machine.js` (1644 lines)
  - export: `updateCatStateMachineRuntime`.
  - top-level cat behavior orchestration and state transitions.

- `/src/mvp/modules/cat-state-machine-utils.js` (208 lines)
  - export: `createCatStateMachineUtilsRuntime`.
  - surface ID resolution, hop trail bookkeeping, catnip/window facing helpers.

- `/src/mvp/modules/cat-state-machine-desk.js` (80 lines)
  - export: `createCatStateMachineDeskRuntime`.
  - desk-specific helper logic (landing safety, desk target selection, desk roam sampling).

- `/src/mvp/modules/cat-state-machine-ground-bypass.js` (108 lines)
  - export: `createCatStateMachineGroundBypassRuntime`.
  - dynamic-obstacle bypass mode for ground navigation and shove timing.

- `/src/mvp/modules/cat-navigation.js` (205 lines)
  - export: `createCatNavigationRuntime`.
  - navigation composition facade that bundles pathfinding/steering/jump/recovery APIs.

- `/src/mvp/modules/cat-pathfinding.js` (1281 lines)
  - export: `createCatPathfindingRuntime`.
  - navmesh + recast/detour path computation, obstacle-aware reachability, nav debug data.

- `/src/mvp/modules/cat-path-signature.js` (77 lines)
  - export: `createCatPathSignatureRuntime`.
  - obstacle and tile-cache signature helpers plus quantized dynamic obstacle specs.

- `/src/mvp/modules/cat-steering.js` (1418 lines)
  - export: `createCatSteeringRuntime`.
  - low-level movement, turning, repath triggers, segment/block handling, path-following execution.

- `/src/mvp/modules/cat-steering-debug.js` (74 lines)
  - export: `createCatSteeringDebugRuntime`.
  - nav debug counters/events/repath-cause tracking helpers.

- `/src/mvp/modules/cat-jump-planning.js` (1420 lines)
  - export: `createCatJumpPlanningRuntime`.
  - jump probe/link generation and surface transition planning.

- `/src/mvp/modules/cat-jump-graph.js` (114 lines)
  - exports: `buildWeightedJumpGraph`, `dijkstraAllCostsFrom`, `dijkstraJumpCountsFrom`.
  - weighted directed graph construction and shortest-path utilities for jump planning.

- `/src/mvp/modules/cat-recovery.js` (325 lines)
  - export: `createCatRecoveryRuntime`.
  - stuck/trap recovery behavior.

- `/src/mvp/modules/cat-plans.js` (34 lines)
  - export: `computeCupSwipePlan`.
  - cup swipe approach point/yaw helper.

- `/src/mvp/modules/pickups.js` (789 lines)
  - export: `createPickupsRuntime`.
  - pickup spawning/drag/drop/bucket resolution and pickup body interaction data.

- `/src/mvp/modules/spawning.js` (265 lines)
  - exports: `pickRandomCatSpawnPoint`, `addRandomPickups`, `spawnRandomPickup`.
  - spawn search and endless-mode spawn budgeting.

- `/src/mvp/modules/cup-system.js` (335 lines)
  - exports: `makeCup`, `createCupRuntime`.
  - cup physics sync, knock/fall/shatter pipeline.

- `/src/mvp/modules/catnip-system.js` (349 lines)
  - export: `createCatnipRuntime`.
  - catnip placement validation/state and cooldown logic.

- `/src/mvp/modules/room.js` (567 lines)
  - exports: `makeRoomCorner`, `makeDesk`, `makeBins`, `makeChair`, `makeShelf`, `makeHoverShelf`, `makeWindowSill`.
  - room/furniture geometry setup.

- `/src/mvp/modules/physics.js` (94 lines)
  - export: `setupPhysicsWorld`.
  - cannon world init and static collider registration.

- `/src/mvp/modules/debug-overlay.js` (2045 lines)
  - export: `createDebugOverlayRuntime`.
  - debug render/toggle system, nav telemetry, perf telemetry, advanced debug visual layers.

- `/src/mvp/modules/debug-overlay-stats.js` (32 lines)
  - exports: `formatDebugNumber`, `pushDebugPerfValue`, `debugPerfMean`, `debugPerfMax`, `debugPerfPercentile`.
  - shared numeric/perf helper utilities for debug overlay telemetry.

- `/src/mvp/modules/debug-controls.js` (643 lines)
  - export: `createDebugControlsRuntime`.
  - debug targeting/teleport controls and debug interaction input behavior.

- `/src/mvp/modules/ui-system.js` (67 lines)
  - export: `createUIRuntime`.
  - HUD and end-state text updates.

- `/src/mvp/vendor/cannon-es.js`
  - vendored physics runtime.

Maintenance note:

- If module ownership changes meaningfully, update this file in the same commit.
