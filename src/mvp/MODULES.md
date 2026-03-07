# MVP Code Map

This file summarizes the entry point and all module files used by the MVP.

- `main.js`
  - role: entry point and runtime wiring.
  - contains:
    - scene/camera/lighting setup.
    - UI event hookups (start, mode switch, restart, debug, catnip).
    - shared constants/config for room, cat behavior, spawn rates, collision tuning.
    - creation of all runtime modules.
    - game loop (`animate`) and per-frame updates.
    - reset/spawn/win/lose/mess meter flow.

- `modules/cat-animation.js`
  - export: `animateCatPoseRuntime`
  - contains: pose blending for walk, sit, swipe, jump prep/landing, and special pose handling.

- `modules/cat-model-loader.js`
  - export: `createCatModelRuntime`
  - contains: cat GLB loading, normalization, rig/bone discovery, animation clip setup, and clip playback helpers.

- `modules/cat-state-machine.js`
  - export: `updateCatStateMachineRuntime`
  - contains: cat behavior states (`patrol`, `toDesk`, jump flow, swipe flow, catnip distraction, recovery transitions).

- `modules/cat-navigation.js`
  - export: `createCatNavigationRuntime`
  - contains: composition layer wiring pathfinding + jump planning + steering + recovery.

- `modules/cat-pathfinding.js`
  - export: `createCatPathfindingRuntime`
  - contains: navmesh build/query integration, obstacle projection, path computation, reachability checks, repath helpers.

- `modules/cat-jump-planning.js`
  - export: `createCatJumpPlanningRuntime`
  - contains: desk perimeter sampling, jump anchor scoring, landing safety checks, jump target generation.

- `modules/cat-steering.js`
  - export: `createCatSteeringRuntime`
  - contains: turning/steering logic, ground vs elevated movement, patrol movement, swipe pose sampling.

- `modules/cat-recovery.js`
  - export: `createCatRecoveryRuntime`
  - contains: stuck detection, recovery point search, nudge logic for blocking pickups, cat/cup spacing guard.

- `modules/cat-plans.js`
  - export: `computeCupSwipePlan`
  - contains: shared cup swipe positioning utility used by behavior/debug systems.

- `modules/catnip-system.js`
  - export: `createCatnipRuntime`
  - contains: catnip placement raycast, validity checks, cooldown and placement state.

- `modules/room.js`
  - exports: `makeRoomCorner`, `makeDesk`, `makeBins`
  - contains: static room geometry, desk surface metadata (`catSurface`), hamper/trash visuals, trash can model load.

- `modules/cup-system.js`
  - exports: `makeCup`, `createCupRuntime`
  - contains: cup mesh/body sync, knock impulse handling, fall/break detection, shatter lifecycle.

- `modules/pickups.js`
  - export: `createPickupsRuntime`
  - contains: trash/laundry drag/drop, pickup physics tuning, bin drop validation/scoring hooks.

- `modules/spawning.js`
  - exports: `pickRandomCatSpawnPoint`, `addRandomPickups`, `spawnRandomPickup`
  - contains: random spawn selection with reachability and collision validation.

- `modules/physics.js`
  - export: `setupPhysicsWorld`
  - contains: Cannon static colliders for room bounds, desk legs/top, and bins.

- `modules/debug-overlay.js`
  - export: `createDebugOverlayRuntime`
  - contains: debug rendering for navmesh triangles, collision outlines, path lines, toggle/key controls.

- `modules/debug-controls.js`
  - export: `createDebugControlsRuntime`
  - contains: debug right-click waypoint, teleport targeting, surface-aware point selection, jump plan setup.

- `modules/ui-system.js`
  - export: `createUIRuntime`
  - contains: HUD/end-state text updates.

- `vendor/cannon-es.js`
  - role: third-party physics engine source.
