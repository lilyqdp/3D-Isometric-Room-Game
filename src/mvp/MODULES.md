# MVP Code Map

This file maps the current MVP source files and what each one owns.

Line counts below are approximate and will drift as the project changes.

- `/src/mvp/main.js` (~1601 lines)
  - app composition root and frame loop.
  - wires subsystem runtimes, UI hooks, game-state transitions, simulation ticks, and top-level update order.

- `/src/mvp/modules/main-debug-camera.js` (~129 lines)
  - export: `createMainDebugCameraRuntime`.
  - debug/free-camera key handling (`WASD`, arrows, `T`) and camera movement update.

- `/src/mvp/modules/cat-model-loader.js` (~1167 lines)
  - export: `createCatModelRuntime`.
  - cat model load/normalize, animation setup, cat runtime bootstrap, and default nav/debug state seeding.

- `/src/mvp/modules/cat-animation.js` (~491 lines)
  - export: `animateCatPoseRuntime`.
  - animation clip blending, pose progression, turn/idle/walk/run selection, and state-driven animation helpers.

- `/src/mvp/modules/cat-state-machine.js` (~3048 lines)
  - export: `updateCatStateMachineRuntime`.
  - top-level cat behavior orchestration, patrol/catnip/window/cup state transitions, route requests, route execution handoff, and recovery decisions.

- `/src/mvp/modules/cat-state-machine-utils.js` (~524 lines)
  - export: `createCatStateMachineUtilsRuntime`.
  - authoritative surface resolution, hop history bookkeeping, catnip/window facing helpers, and shared state-machine utilities.

- `/src/mvp/modules/cat-state-machine-desk.js` (~80 lines)
  - export: `createCatStateMachineDeskRuntime`.
  - desk-specific helper logic such as landing safety, desk target selection, and desk roam sampling.

- `/src/mvp/modules/cat-state-machine-ground-bypass.js` (~179 lines)
  - export: `createCatStateMachineGroundBypassRuntime`.
  - dynamic-obstacle bypass mode for ground navigation and shove timing / unblock behavior.

- `/src/mvp/modules/cat-navigation.js` (~234 lines)
  - export: `createCatNavigationRuntime`.
  - navigation composition facade that bundles pathfinding, steering, jump runtime, recovery, and shared movement request helpers.

- `/src/mvp/modules/cat-locomotion.js` (~17 lines)
  - exports shared locomotion helpers.
  - small shared movement/clip selection utilities used by steering so ground and elevated locomotion stay aligned.

- `/src/mvp/modules/cat-pathfinding.js` (~2409 lines)
  - export: `createCatPathfindingRuntime`.
  - navmesh + recast/detour path computation, fallback A*, obstacle-aware reachability, jump-link path costs, cache management, and nav debug/profiler data.

- `/src/mvp/modules/cat-path-signature.js` (~91 lines)
  - export: `createCatPathSignatureRuntime`.
  - obstacle/tile-cache signature helpers and quantized dynamic-obstacle specs used for path/reachability caching.

- `/src/mvp/modules/cat-steering.js` (~2784 lines)
  - export: `createCatSteeringRuntime`.
  - low-level movement, turning, route-segment execution, repath triggers, local rescue behavior, elevated obstacle handling, and path-following runtime.

- `/src/mvp/modules/cat-steering-debug.js` (~77 lines)
  - export: `createCatSteeringDebugRuntime`.
  - nav debug counters, telemetry events, repath-cause tracking, and route-loop diagnostics helpers.

- `/src/mvp/modules/cat-jump-planning.js` (~1473 lines)
  - export: `createCatJumpPlanningRuntime`.
  - jump probes/links, weighted jump graph planning, surface transition routing, and jump approach/landing point generation.

- `/src/mvp/modules/cat-jump-runtime.js` (~215 lines)
  - export: `createCatJumpRuntime`.
  - active jump execution, jump state updates, landing finalization, and jump ownership moved out of `main.js`.

- `/src/mvp/modules/cat-jump-graph.js` (~114 lines)
  - exports: `buildWeightedJumpGraph`, `dijkstraAllCostsFrom`, `dijkstraJumpCountsFrom`.
  - weighted directed graph construction and shortest-path utilities for jump planning.

- `/src/mvp/modules/cat-recovery.js` (~325 lines)
  - export: `createCatRecoveryRuntime`.
  - stuck/trap recovery behavior and local unsticking helpers.

- `/src/mvp/modules/cat-plans.js` (~34 lines)
  - export: `computeCupSwipePlan`.
  - cup swipe approach point/yaw helper.

- `/src/mvp/modules/catnip-system.js` (~461 lines)
  - export: `createCatnipRuntime`.
  - catnip placement validation/state, timers, cooldown logic, and catnip interaction bookkeeping.

- `/src/mvp/modules/cup-system.js` (~335 lines)
  - exports: `makeCup`, `createCupRuntime`.
  - cup physics sync, knock/fall/shatter pipeline, and cup interaction state.

- `/src/mvp/modules/pickups.js` (~789 lines)
  - export: `createPickupsRuntime`.
  - pickup spawning/drag/drop/bucket resolution and pickup body interaction data.

- `/src/mvp/modules/spawning.js` (~265 lines)
  - exports: `pickRandomCatSpawnPoint`, `addRandomPickups`, `spawnRandomPickup`.
  - spawn search and endless-mode spawn budgeting.

- `/src/mvp/modules/room.js` (~567 lines)
  - exports: `makeRoomCorner`, `makeDesk`, `makeBins`, `makeChair`, `makeShelf`, `makeHoverShelf`, `makeWindowSill`.
  - room/furniture geometry setup.

- `/src/mvp/modules/surface-registry.js` (~238 lines)
  - exports shared surface registry helpers.
  - generalized surface metadata, per-surface lookup/ownership helpers, and surface descriptors used by routing/jump planning.

- `/src/mvp/modules/physics.js` (~94 lines)
  - export: `setupPhysicsWorld`.
  - cannon world init and static collider registration.

- `/src/mvp/modules/debug-overlay.js` (~2717 lines)
  - export: `createDebugOverlayRuntime`.
  - debug render/toggle system, nav telemetry, perf telemetry, route timeline/path profiler panels, and advanced debug visual layers.

- `/src/mvp/modules/debug-overlay-stats.js` (~32 lines)
  - exports: `formatDebugNumber`, `pushDebugPerfValue`, `debugPerfMean`, `debugPerfMax`, `debugPerfPercentile`.
  - shared numeric/perf helper utilities for debug overlay telemetry.

- `/src/mvp/modules/debug-controls.js` (~718 lines)
  - export: `createDebugControlsRuntime`.
  - debug target selection, right-click patrol requests, teleport controls, and debug interaction input behavior.

- `/src/mvp/modules/ui-system.js` (~67 lines)
  - export: `createUIRuntime`.
  - HUD, score/mess, and end-state text updates.

- `/src/mvp/vendor/cannon-es.js`
  - vendored physics runtime.

Maintenance note:

- If module files change meaningfully, update this file in the same commit.
