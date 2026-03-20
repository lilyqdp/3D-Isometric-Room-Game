# MVP Code Map

This file maps the current MVP source files and what each one owns.

Line counts below are approximate and will drift as the project changes.

- `/src/mvp/main.js` (~1601 lines)
  - app composition root and frame loop.
  - wires subsystem runtimes, normalized surface definitions/flags, room object specs, top-level update order, simulation ticks, and game-state transitions.
  - owns the top-level debug function-trace plumbing that feeds the advanced debug overlay panels.

- `/src/mvp/modules/main-debug-camera.js` (~129 lines)
  - export: `createMainDebugCameraRuntime`.
  - debug/free-camera key handling (`WASD`, arrows, `T`) and camera movement update.

- `/src/mvp/modules/cat-model-loader.js` (~1167 lines)
  - export: `createCatModelRuntime`.
  - cat model load/normalize, animation setup, cat runtime bootstrap, and default nav/debug state seeding.
  - seeds the cat's persistent nav/debug containers, including surface-state and function-trace buffers used by the runtime/debug overlay.

- `/src/mvp/modules/cat-animation.js` (~491 lines)
  - export: `animateCatPoseRuntime`.
  - animation clip blending, pose progression, turn/idle/walk/run selection, and state-driven animation helpers.

- `/src/mvp/modules/surface-ids.js` (~63 lines)
  - shared surface identity helpers.
  - normalizes surface IDs, treats floor as a first-class surface ID, and owns the cat's authoritative `surfaceState` helpers used by navigation, steering, debug, and state-machine code.

- `/src/mvp/modules/surface-registry.js` (~317 lines)
  - exports shared surface registry helpers.
  - generalized surface metadata, normalized shape/dimensions/flags, associated-object IDs, obstacle/support descriptors, and per-surface lookup/ownership helpers used by routing, spawning, and jump planning.

- `/src/mvp/modules/cat-state-machine.js` (~3063 lines)
  - export: `updateCatStateMachineRuntime`.
  - top-level cat behavior orchestration, patrol/catnip/window/cup state transitions, route requests, route execution handoff, and recovery decisions.
  - generic movement state should read/write concrete surface IDs here rather than old `onTable`/`elevated` terminology; desk-specific behavior still lives here only where it is truly desk/cup gameplay.
  - route execution now treats floor as just another support surface ID, with shared surface-segment handling instead of separate floor-vs-elevated route modes.

- `/src/mvp/modules/cat-state-machine-utils.js` (~524 lines)
  - export: `createCatStateMachineUtilsRuntime`.
  - authoritative surface resolution, hop history bookkeeping, catnip/window facing helpers, and shared state-machine utilities.
  - also owns the current-surface tracing hook used by the function-trace debug panel.

- `/src/mvp/modules/cat-state-machine-desk.js` (~80 lines)
  - export: `createCatStateMachineDeskRuntime`.
  - desk-specific helper logic such as landing safety, desk target selection, and desk roam sampling.

- `/src/mvp/modules/cat-state-machine-ground-bypass.js` (~179 lines)
  - export: `createCatStateMachineGroundBypassRuntime`.
  - dynamic-obstacle bypass mode for ground navigation and shove timing / unblock behavior.

- `/src/mvp/modules/cat-navigation.js` (~234 lines)
  - export: `createCatNavigationRuntime`.
  - navigation composition facade that bundles pathfinding, steering, jump runtime, jump planning, recovery, and shared movement request helpers.
  - exposes surface-path routing helpers and function-trace plumbing to the higher-level state machine.

- `/src/mvp/modules/cat-locomotion.js` (~17 lines)
  - exports shared locomotion helpers.
  - small shared movement/clip selection utilities used by steering so ground and surface locomotion stay aligned.

- `/src/mvp/modules/cat-pathfinding.js` (~2409 lines)
  - export: `createCatPathfindingRuntime`.
  - navmesh + recast/detour path computation, fallback A*, obstacle-aware reachability, jump-link path costs, cache management, and nav debug/profiler data.

- `/src/mvp/modules/cat-path-signature.js` (~91 lines)
  - export: `createCatPathSignatureRuntime`.
  - obstacle/tile-cache signature helpers and quantized dynamic-obstacle specs used for path/reachability caching.

- `/src/mvp/modules/cat-steering.js` (~2784 lines)
  - export: `createCatSteeringRuntime`.
  - low-level movement, turning, route-segment execution, repath triggers, local rescue behavior, surface obstacle handling, and path-following runtime.

- `/src/mvp/modules/cat-steering-debug.js` (~77 lines)
  - export: `createCatSteeringDebugRuntime`.
  - nav debug counters, telemetry events, repath-cause tracking, and route-loop diagnostics helpers.

- `/src/mvp/modules/cat-jump-planning.js` (~1608 lines)
  - export: `createCatJumpPlanningRuntime`.
  - jump probes/links, directed surface-graph path selection, surface transition routing, and jump approach/landing point generation.
  - owns the generalized probe/link classification used by the debug overlay, including floor-as-surface probes, per-shape anchor counts, and blocked-state distinctions (valid, down-only, no-target, immovable-blocked, movable-blocked).
  - also traces surface-path / jump-target selection for the optional function-trace debug panel.

- `/src/mvp/modules/cat-jump-runtime.js` (~215 lines)
  - export: `createCatJumpRuntime`.
  - active jump execution, jump state updates, landing finalization, and jump ownership moved out of `main.js`.
  - emits jump start/landing trace events for the optional function-trace debug panel.

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
  - pickup spawning/drag/drop/bucket resolution, pickup body interaction data, and spawn-surface bookkeeping for loose clutter.

- `/src/mvp/modules/spawning.js` (~382 lines)
  - exports: `pickRandomCatSpawnPoint`, `addRandomPickups`, `spawnRandomPickup`.
  - spawn search and endless-mode spawn budgeting.
  - surface capability/flag-driven spawn selection for trash/laundry/catnip-style placement instead of hardcoding floor-only checks.

- `/src/mvp/modules/room.js` (~567 lines)
  - exports: `makeRoomCorner`, `makeDesk`, `makeBins`, `makeChair`, `makeShelf`, `makePlatform`, `makeHoverShelf`, `makeWindowSill`.
  - visible room/furniture/platform geometry helpers.
  - this is the visual room-object layer; walkable nav surface records are still authored separately in `main.js`/surface helpers.

- `/src/mvp/modules/physics.js` (~94 lines)
  - export: `setupPhysicsWorld`.
  - cannon world init and static collider registration.

- `/src/mvp/modules/debug-overlay.js` (~2845 lines)
  - export: `createDebugOverlayRuntime`.
  - debug render/toggle system, nav telemetry, perf telemetry, route timeline/path profiler panels, function-trace panel, and advanced debug visual layers.
  - jump-link/probe visuals should stay aligned with jump-planning classifications so blocked colors mean the same thing in both panels and line overlays.

- `/src/mvp/modules/debug-overlay-stats.js` (~32 lines)
  - exports: `formatDebugNumber`, `pushDebugPerfValue`, `debugPerfMean`, `debugPerfMax`, `debugPerfPercentile`.
  - shared numeric/perf helper utilities for debug overlay telemetry.

- `/src/mvp/modules/debug-controls.js` (~717 lines)
  - export: `createDebugControlsRuntime`.
  - debug target selection, right-click patrol requests, teleport controls, and debug interaction input behavior.
  - debug route requests and teleports should carry concrete `surfaceId` data instead of generic floor/elevated labels.
  - right-click debug movement should queue shared surface-aware route requests rather than maintaining a parallel floor/elevated routing model.

- `/src/mvp/modules/ui-system.js` (~67 lines)
  - export: `createUIRuntime`.
  - HUD, score/mess, and end-state text updates.

- `/src/mvp/vendor/cannon-es.js`
  - vendored physics runtime.

Maintenance note:

- If module files change meaningfully, update this file in the same commit.
- Keep this file focused on ownership changes and architectural shifts; avoid restating small helper-level edits.
