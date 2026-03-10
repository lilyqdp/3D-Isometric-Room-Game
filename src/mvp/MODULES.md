# MVP Code Map

This file maps the current MVP source files and what each one owns.

- `/src/mvp/main.js` (1049 lines)
  - app entry point and wiring layer.
  - sets up Three.js scene, camera, lights, controls, and DOM listeners.
  - defines core constants (`ROOM`, `CAT_NAV`, `CAT_BEHAVIOR`, spawn/collision/jump timing).
  - creates and connects runtimes (navigation, state machine, debug, pickups, cup, catnip, UI).
  - owns reset flow, win/lose flow, mode switch (casual/endless), and the `animate` loop.

- `/src/mvp/modules/cat-model-loader.js` (836 lines)
  - export: `createCatModelRuntime`.
  - builds initial cat object/state shape.
  - loads/normalizes cat GLB, detects rig bones, sets up animation clips/actions.
  - stores locomotion profile metadata used by steering + animation blending.

- `/src/mvp/modules/cat-animation.js` (338 lines)
  - export: `animateCatPoseRuntime`.
  - per-frame animation blending for walk/turn/sit/swipe/jump/catnip phases.
  - applies clip crossfades and pose adjustments against current cat state and movement metrics.

- `/src/mvp/modules/cat-state-machine.js` (822 lines)
  - export: `updateCatStateMachineRuntime`.
  - high-level cat AI state flow (`patrol`, `toDesk`, `prepareJump`, `toCup`, `swipe`, `jumpDown`, `distracted`, etc.).
  - controls transitions, timing gates, jump/swipe sequencing, and behavior priorities (catnip over patrol).
  - integrates navigation helpers, jump planners, and recovery hooks.

- `/src/mvp/modules/cat-navigation.js` (184 lines)
  - export: `createCatNavigationRuntime`.
  - composition module that bundles pathfinding, jump planning, steering, and recovery into one nav API.
  - gives `main.js` and state machine a stable navigation surface.

- `/src/mvp/modules/cat-pathfinding.js` (890 lines)
  - export: `createCatPathfindingRuntime`.
  - builds dynamic obstacle sets from room geometry + pickups + cup.
  - generates nav data (Recast navmesh + fallback triangle mesh) and computes paths/reachability.
  - exposes nav debug geometry + A* debug traces used in advanced debug mode.

- `/src/mvp/modules/cat-steering.js` (893 lines)
  - export: `createCatSteeringRuntime`.
  - low-level motion execution (`moveCatToward`) for floor and elevated surfaces.
  - handles local steering, turn rate control, collision-safe stepping, repath triggers, and no-steer recovery.
  - maintains movement diagnostics (debug counters/events/step reasons).

- `/src/mvp/modules/cat-jump-planning.js` (357 lines)
  - export: `createCatJumpPlanningRuntime`.
  - chooses jump anchors/landings around the desk perimeter.
  - validates jump approach + landing clearance against obstacles/cup/pickups.

- `/src/mvp/modules/cat-recovery.js` (325 lines)
  - export: `createCatRecoveryRuntime`.
  - trap detection and rescue logic when cat is blocked/intersecting dynamic obstacles.
  - cup safety spacing helpers and fallback goal handling.

- `/src/mvp/modules/cat-plans.js` (34 lines)
  - export: `computeCupSwipePlan`.
  - shared utility to compute where cat should stand and face before swiping cup.

- `/src/mvp/modules/pickups.js` (754 lines)
  - export: `createPickupsRuntime`.
  - creates/manages laundry + trash pickup objects and Cannon bodies.
  - drag/drop handling, hover/pick state, bin acceptance checks, score/mess updates.
  - owns pickup collision body sizing and interaction filtering.

- `/src/mvp/modules/spawning.js` (265 lines)
  - exports: `pickRandomCatSpawnPoint`, `addRandomPickups`, `spawnRandomPickup`.
  - valid spawn search for cat/pickups (visibility/reachability/collision-safe constraints).
  - endless-mode spawn budget helpers.

- `/src/mvp/modules/cup-system.js` (314 lines)
  - exports: `makeCup`, `createCupRuntime`.
  - cup mesh/physics body setup and sync.
  - knock/fall/shatter logic, delayed lose trigger after break, shatter bit lifecycle.

- `/src/mvp/modules/catnip-system.js` (167 lines)
  - export: `createCatnipRuntime`.
  - catnip placement raycast and validity checks on floor/desk.
  - cooldown/state tracking and visual placement helpers.

- `/src/mvp/modules/room.js` (279 lines)
  - exports: `makeRoomCorner`, `makeDesk`, `makeBins`.
  - static geometry and materials for corner room, desk, hamper, and trash can visuals.
  - includes external trash can model load fallback paths.

- `/src/mvp/modules/physics.js` (71 lines)
  - export: `setupPhysicsWorld`.
  - static Cannon colliders for floor/walls/desk/bins.

- `/src/mvp/modules/debug-overlay.js` (1305 lines)
  - export: `createDebugOverlayRuntime`.
  - full debug rendering and advanced debug panel.
  - toggles for navmesh, obstacles, collision volumes, path lines, A* checks/final path, telemetry text.

- `/src/mvp/modules/debug-controls.js` (558 lines)
  - export: `createDebugControlsRuntime`.
  - debug input features: right-click walk target, `T` teleport, nav/surface-aware target selection.
  - jump-aware debug move planning for floor <-> elevated surfaces.

- `/src/mvp/modules/ui-system.js` (50 lines)
  - export: `createUIRuntime`.
  - updates HUD and end-state UI text values.

- `/src/mvp/vendor/cannon-es.js`
  - vendored physics library source used by the MVP.

Maintenance note:

- If module responsibilities change meaningfully (new subsystem, major API move, major state ownership move), update this file in the same PR/commit.
