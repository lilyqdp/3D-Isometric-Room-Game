export function createMainDebugCameraRuntime(ctx) {
  const {
    THREE,
    camera,
    controls,
    debugRuntime,
    debugControlsRuntime,
    game,
    getClockTime,
  } = ctx;

  const DEBUG_CAMERA = {
    moveSpeed: 3.8,
    rotateSpeed: 1.8,
    minPitch: 0.2,
    maxPitch: Math.PI - 0.2,
  };

  const debugCameraInput = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
  };

  const debugCameraMove = new THREE.Vector3();
  const debugCameraForward = new THREE.Vector3();
  const debugCameraRight = new THREE.Vector3();
  const debugCameraOffset = new THREE.Vector3();
  const debugCameraSpherical = new THREE.Spherical();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  function isDebugCameraKey(code) {
    return code in debugCameraInput;
  }

  function resetDebugCameraInput() {
    for (const code in debugCameraInput) {
      debugCameraInput[code] = false;
    }
  }

  function onKeyDown(event) {
    debugRuntime.onKeyDown(event, getClockTime());
    const code = event.code || "";
    if (
      debugRuntime.isDebugVisible() &&
      !event.repeat &&
      isDebugCameraKey(code) &&
      !(event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA"))
    ) {
      debugCameraInput[code] = true;
      event.preventDefault();
    }
    if (event.repeat) return;
    if (game.state !== "playing") return;
    if (!debugRuntime.isDebugVisible()) return;
    if ((event.key || "").toLowerCase() !== "t") return;
    event.preventDefault();
    debugControlsRuntime.teleportCatToDebugMouseTarget();
  }

  function onKeyUp(event) {
    const code = event.code || "";
    if (!isDebugCameraKey(code)) return;
    debugCameraInput[code] = false;
    if (debugRuntime.isDebugVisible()) event.preventDefault();
  }

  function updateDebugCameraControls(dt) {
    if (!debugRuntime.isDebugVisible()) {
      resetDebugCameraInput();
      return;
    }
    if (!controls.enabled) return;

    const moveScale = DEBUG_CAMERA.moveSpeed * dt;
    const yawStep = DEBUG_CAMERA.rotateSpeed * dt;
    const pitchStep = DEBUG_CAMERA.rotateSpeed * dt;

    debugCameraForward.subVectors(controls.target, camera.position);
    debugCameraForward.y = 0;
    if (debugCameraForward.lengthSq() < 1e-6) {
      debugCameraForward.set(0, 0, -1);
    } else {
      debugCameraForward.normalize();
    }
    debugCameraRight.crossVectors(debugCameraForward, WORLD_UP).normalize();

    debugCameraMove.set(0, 0, 0);
    if (debugCameraInput.KeyW) debugCameraMove.add(debugCameraForward);
    if (debugCameraInput.KeyS) debugCameraMove.sub(debugCameraForward);
    if (debugCameraInput.KeyD) debugCameraMove.add(debugCameraRight);
    if (debugCameraInput.KeyA) debugCameraMove.sub(debugCameraRight);
    if (debugCameraMove.lengthSq() > 1e-6) {
      debugCameraMove.normalize().multiplyScalar(moveScale);
      camera.position.add(debugCameraMove);
      controls.target.add(debugCameraMove);
    }

    const yawDir = (debugCameraInput.ArrowLeft ? 1 : 0) - (debugCameraInput.ArrowRight ? 1 : 0);
    const pitchDir = (debugCameraInput.ArrowUp ? 1 : 0) - (debugCameraInput.ArrowDown ? 1 : 0);
    if (yawDir !== 0 || pitchDir !== 0) {
      debugCameraOffset.subVectors(camera.position, controls.target);
      if (debugCameraOffset.lengthSq() < 1e-6) return;
      debugCameraSpherical.setFromVector3(debugCameraOffset);
      debugCameraSpherical.theta += yawDir * yawStep;
      debugCameraSpherical.phi -= pitchDir * pitchStep;
      debugCameraSpherical.phi = THREE.MathUtils.clamp(
        debugCameraSpherical.phi,
        DEBUG_CAMERA.minPitch,
        DEBUG_CAMERA.maxPitch
      );
      debugCameraOffset.setFromSpherical(debugCameraSpherical);
      camera.position.copy(controls.target).add(debugCameraOffset);
    }
  }

  return {
    onKeyDown,
    onKeyUp,
    resetDebugCameraInput,
    updateDebugCameraControls,
  };
}
