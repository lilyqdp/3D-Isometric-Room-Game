export function animateCatPoseRuntime(ctx, dt, moving) {
  const {
    THREE,
    clockTime,
    cat,
    JUMP_UP_TIMING,
    sampleSwipePose,
    setCatClipSpecialPose,
    updateCatClipLocomotion,
    setBonePose,
  } = ctx;

function animateCatPose(dt, moving) {
  const isPrepareJump = cat.state === "prepareJump";
  const isLaunchUp = cat.state === "launchUp";
  const isForepawHook = cat.state === "forepawHook";
  const isPullUp = cat.state === "pullUp";
  const isJumpSettle = cat.state === "jumpSettle";
  const forceStill =
    cat.state === "swipe" ||
    cat.state === "sit" ||
    isPrepareJump ||
    isForepawHook ||
    isJumpSettle ||
    !!cat.jump;
  const movingTarget = forceStill ? 0 : (moving || cat.nav.lastSpeed > 0.24 ? 1 : 0);
  cat.motionBlend = THREE.MathUtils.damp(cat.motionBlend, movingTarget, 8, dt);
  const movingAmt = cat.motionBlend;

  if (movingAmt > 0.02) {
    cat.walkT += dt * 8.0;
  } else {
    cat.walkT *= Math.max(0, 1 - dt * 8.0);
  }

  if (cat.usingRealisticModel) {
    const isSit = cat.state === "sit";
    const usesSpecialPose =
      cat.state === "swipe" ||
      isPrepareJump ||
      isLaunchUp ||
      isForepawHook ||
      isPullUp ||
      isJumpSettle ||
      isSit ||
      !!cat.jump;
    if (cat.useClipLocomotion && cat.clipMixer) {
      setCatClipSpecialPose(cat, usesSpecialPose);
      if (!usesSpecialPose) {
        const speedNorm = THREE.MathUtils.clamp(cat.nav.lastSpeed / Math.max(cat.speed, 0.001), 0, 1.5);
        updateCatClipLocomotion(cat, dt, movingAmt > 0.08, speedNorm);

        cat.modelAnchor.position.y = THREE.MathUtils.damp(cat.modelAnchor.position.y, 0, 10, dt);
        cat.modelAnchor.rotation.x = THREE.MathUtils.damp(cat.modelAnchor.rotation.x, 0, 10, dt);
        cat.modelAnchor.rotation.z = THREE.MathUtils.damp(cat.modelAnchor.rotation.z, 0, 10, dt);
        return;
      }
      cat.clipMixer.update(dt);
    }

    const rig = cat.rig;
    if (!rig) return;

    const gaitL = Math.sin(cat.walkT) * movingAmt;
    const gaitR = Math.sin(cat.walkT + Math.PI) * movingAmt;
    const breathe = Math.sin(clockTime * 2.2) * 0.03;
    const isSwipe = cat.state === "swipe";
    const swipePose = isSwipe ? sampleSwipePose(cat.phaseT) : null;
    const swipeLift = swipePose ? swipePose.lift : 0;
    const swipeReach = swipePose ? swipePose.reach : 0;
    const swipeLean = swipePose ? swipePose.lean : 0;
    const swipeForward = Math.max(0, swipeReach);
    const swipeBack = Math.max(0, -swipeReach);
    const isJumping = !!cat.jump;
    const jumpU = isJumping ? THREE.MathUtils.clamp(cat.jump.t / cat.jump.dur, 0, 1) : 0;
    const jumpArc = isJumping ? Math.sin(Math.PI * jumpU) : 0;
    const jumpPush = isJumping ? Math.sin(Math.PI * THREE.MathUtils.clamp(jumpU * 1.15, 0, 1)) : 0;
    const jumpReach = isJumping ? Math.sin(Math.PI * THREE.MathUtils.clamp(jumpU * 0.9, 0, 1)) : 0;
    const crouchBase =
      isPrepareJump
        ? 0.46
        : cat.state === "toCup"
          ? 0.2
          : isForepawHook
            ? 0.28
            : isJumpSettle
              ? 0.2
              : isSit
                ? 0.52
                : 0;
    const crouch = crouchBase + (isJumping ? (1 - jumpU) * 0.26 : 0);
    const baseAlpha = THREE.MathUtils.clamp(dt * 12, 0.08, 0.55);

    cat.modelAnchor.position.y = Math.max(0, gaitL) * 0.02 + jumpArc * 0.015;
    cat.modelAnchor.position.z = THREE.MathUtils.damp(cat.modelAnchor.position.z, 0, 10, dt);
    cat.modelAnchor.rotation.z = gaitL * 0.028;
    const targetPitch = -swipeLean * 0.42 - jumpArc * 0.12;
    cat.modelAnchor.rotation.x = THREE.MathUtils.damp(cat.modelAnchor.rotation.x, targetPitch, 10, dt);

    setBonePose(rig, rig.spine1, -0.11 - crouch * 0.09 + breathe * 0.2 + swipeLean * 0.11 - jumpArc * 0.1, 0, 0, baseAlpha);
    setBonePose(rig, rig.spine2, -0.05 - crouch * 0.05 + breathe * 0.15 + swipeLean * 0.08 - jumpArc * 0.06, 0, 0, baseAlpha);
    setBonePose(rig, rig.spine3, -0.03 + breathe * 0.15 + swipeLean * 0.04, 0, 0, baseAlpha);
    setBonePose(rig, rig.neckBase, -0.03 + crouch * 0.06 - swipeLean * 0.06 + jumpArc * 0.02, 0, 0, baseAlpha);
    setBonePose(rig, rig.neck1, 0.03 + crouch * 0.05 - swipeLean * 0.12 + jumpArc * 0.05, 0, 0, baseAlpha);
    setBonePose(rig, rig.head, 0.05 + crouch * 0.08 - swipeLean * 0.2 + jumpArc * 0.09, 0, 0, baseAlpha);

    for (let i = 0; i < rig.tail.length; i++) {
      const tailBone = rig.tail[i];
      const wave = Math.sin(clockTime * 3.2 + i * 0.6) * 0.08;
      const sway = moving ? Math.sin(cat.walkT + i * 0.5) * 0.03 : 0;
      const jumpSway = isJumping ? Math.sin(clockTime * 7 + i * 0.3) * 0.04 : 0;
      setBonePose(rig, tailBone, 0.02 + wave * 0.35, sway, wave * 0.2, baseAlpha);
      if (isJumping) setBonePose(rig, tailBone, 0.18 + jumpSway, sway, wave * 0.2, baseAlpha);
    }

    const foreStrideL = isSwipe ? 0 : gaitL;
    const foreStrideR = isSwipe ? 0 : gaitR;
    const hindStrideL = isSwipe ? 0 : gaitR;
    const hindStrideR = isSwipe ? 0 : gaitL;

    setBonePose(rig, rig.frontL.shoulder, foreStrideL * 0.28 - 0.1 - jumpArc * 0.2 + jumpReach * 0.08, 0, 0, baseAlpha);
    setBonePose(rig, rig.frontL.elbow, -foreStrideL * 0.22 + 0.18 + jumpArc * 0.26 - jumpReach * 0.2, 0, 0, baseAlpha);
    setBonePose(rig, rig.frontL.wrist, foreStrideL * 0.15 - 0.06 + jumpArc * 0.14 - jumpReach * 0.12, 0, 0, baseAlpha);

    setBonePose(
      rig,
      rig.frontR.shoulder,
      foreStrideR * 0.28 - 0.1 - swipeLift * 0.5 - jumpArc * 0.18 + jumpReach * 0.07,
      0,
      -swipeForward * 0.95 + swipeBack * 0.16,
      baseAlpha
    );
    setBonePose(
      rig,
      rig.frontR.elbow,
      -foreStrideR * 0.2 + 0.2 + swipeLift * 0.62 - swipeForward * 0.24 + jumpArc * 0.22 - jumpReach * 0.17,
      0,
      -swipeForward * 0.35,
      baseAlpha
    );
    setBonePose(
      rig,
      rig.frontR.wrist,
      foreStrideR * 0.14 - 0.04 + swipeLift * 0.22 - swipeForward * 0.36 + jumpArc * 0.11 - jumpReach * 0.1,
      0,
      -swipeForward * 0.66,
      baseAlpha
    );
    setBonePose(rig, rig.frontR.paw, 0, 0, -swipeForward * 0.35, baseAlpha);

    setBonePose(rig, rig.backL.hip, hindStrideL * 0.24 + 0.08 + jumpPush * 0.24, 0, 0, baseAlpha);
    setBonePose(rig, rig.backL.knee, -hindStrideL * 0.24 - 0.1 - jumpPush * 0.42, 0, 0, baseAlpha);
    setBonePose(rig, rig.backL.ankle, hindStrideL * 0.13 + 0.04 + jumpPush * 0.26, 0, 0, baseAlpha);

    setBonePose(rig, rig.backR.hip, hindStrideR * 0.24 + 0.08 + jumpPush * 0.24, 0, 0, baseAlpha);
    setBonePose(rig, rig.backR.knee, -hindStrideR * 0.24 - 0.1 - jumpPush * 0.42, 0, 0, baseAlpha);
    setBonePose(rig, rig.backR.ankle, hindStrideR * 0.13 + 0.04 + jumpPush * 0.26, 0, 0, baseAlpha);

    if (isPrepareJump) {
      const u = THREE.MathUtils.clamp(cat.phaseT / JUMP_UP_TIMING.prepare, 0, 1);
      // Rear-up prep: front body lifts while hind legs stay planted to load jump force.
      setBonePose(rig, rig.spine1, 0.16 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine2, 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine3, 0.16 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.neckBase, -0.22 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.neck1, -0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.head, -0.08 * u, 0, 0, baseAlpha);

      setBonePose(rig, rig.frontL.shoulder, -0.64 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.64 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 1.0 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 1.0 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.68 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.68 * u, 0, 0, baseAlpha);

      setBonePose(rig, rig.backL.hip, 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.32 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.32 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.12 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.12 * u, 0, 0, baseAlpha);

      // Make the rear-up clearly visible from gameplay camera.
      cat.modelAnchor.position.y += 0.16 * u;
      cat.modelAnchor.rotation.x = THREE.MathUtils.damp(cat.modelAnchor.rotation.x, 0.44 * u, 12, dt);
    }

    if (isLaunchUp) {
      const u = jumpU;
      setBonePose(rig, rig.frontL.shoulder, -0.52 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.52 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.66 - 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.66 - 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.34 + 0.12 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.34 + 0.12 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.hip, 0.4 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.4 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.62 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.62 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.26 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.26 * (1 - u), 0, 0, baseAlpha);
    }

    if (isForepawHook) {
      const u = THREE.MathUtils.clamp(cat.phaseT / JUMP_UP_TIMING.hook, 0, 1);
      setBonePose(rig, rig.frontL.shoulder, -0.44, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.44, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.74, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.74, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.38, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.38, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.hip, 0.14 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.14 + 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.24 - 0.2 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.24 - 0.2 * u, 0, 0, baseAlpha);
    }

    if (isPullUp) {
      const u = jumpU;
      setBonePose(rig, rig.frontL.shoulder, -0.38 + 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.38 + 0.18 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.88 - 0.46 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.88 - 0.46 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.48 + 0.24 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.48 + 0.24 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.hip, 0.56 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.56 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.84 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.84 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.36 * u, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.36 * u, 0, 0, baseAlpha);
    }

    if (isJumpSettle) {
      const u = THREE.MathUtils.clamp(cat.phaseT / JUMP_UP_TIMING.settle, 0, 1);
      setBonePose(rig, rig.frontL.elbow, 0.42 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.42 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.34 * (1 - u), 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.34 * (1 - u), 0, 0, baseAlpha);
    }

    if (isSwipe) {
      // Keep non-swiping limbs planted: swipe is a single front-paw action.
      setBonePose(rig, rig.frontL.shoulder, -0.16, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.32, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.12, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.paw, 0, 0, 0, baseAlpha);

      setBonePose(rig, rig.backL.hip, 0.12, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.24, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.08, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.12, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.24, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.08, 0, 0, baseAlpha);
    }

    if (isSit) {
      const sitIn = THREE.MathUtils.clamp(cat.phaseT / 0.35, 0, 1);
      setBonePose(rig, rig.spine1, 0.04 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine2, 0.08 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.spine3, 0.12 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.neckBase, -0.08 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.neck1, -0.06 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.head, 0.02 * sitIn, 0, 0, baseAlpha);

      setBonePose(rig, rig.frontL.shoulder, -0.2 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.shoulder, -0.2 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.elbow, 0.34 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.34 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontL.wrist, -0.16 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.wrist, -0.16 * sitIn, 0, 0, baseAlpha);

      setBonePose(rig, rig.backL.hip, 0.64 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.hip, 0.64 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.94 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.94 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.ankle, 0.34 * sitIn, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.ankle, 0.34 * sitIn, 0, 0, baseAlpha);
    }

    if (movingAmt < 0.18 && !isSwipe && !isJumping && !isSit) {
      const idleBlend = 0.18 + breathe * 0.08;
      setBonePose(rig, rig.frontL.elbow, 0.2 + idleBlend, 0, 0, baseAlpha);
      setBonePose(rig, rig.frontR.elbow, 0.2 + idleBlend, 0, 0, baseAlpha);
      setBonePose(rig, rig.backL.knee, -0.15 - idleBlend * 0.6, 0, 0, baseAlpha);
      setBonePose(rig, rig.backR.knee, -0.15 - idleBlend * 0.6, 0, 0, baseAlpha);
    }

    return;
  }

  const swing = Math.sin(cat.walkT) * (moving ? 0.06 : 0);
  if (cat.state === "sit") {
    cat.legs[0].position.z = 0.26;
    cat.legs[1].position.z = 0.26;
    cat.legs[2].position.z = -0.21;
    cat.legs[3].position.z = -0.21;
    cat.tail.rotation.x = 0.48;
    return;
  }
  cat.legs[0].position.z = 0.31 + swing;
  cat.legs[1].position.z = 0.31 - swing;
  cat.legs[2].position.z = -0.29 - swing;
  cat.legs[3].position.z = -0.29 + swing;
  cat.tail.rotation.x = Math.sin(clockTime * 3.0) * 0.3;
}

  return animateCatPose(dt, moving);
}
