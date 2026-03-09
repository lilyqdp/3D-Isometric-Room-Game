export function createCatModelRuntime(ctx) {
  const { THREE, gltfLoader, catModelCandidates, catModelYawOffset } = ctx;

  const tempBox = new THREE.Box3();
  const tempSize = new THREE.Vector3();
  const tempCenter = new THREE.Vector3();
  const tempMin = new THREE.Vector3();

  function buildCat() {
    const group = new THREE.Group();
    const simpleParts = [];
    const addSimplePart = (mesh) => {
      simpleParts.push(mesh);
      group.add(mesh);
      return mesh;
    };
    const fur = new THREE.MeshStandardMaterial({ color: 0x8f7c69, roughness: 0.92 });
    const furDark = new THREE.MeshStandardMaterial({ color: 0x756555, roughness: 0.95 });
    const pawMat = new THREE.MeshStandardMaterial({ color: 0xd9c8b6, roughness: 0.9 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.95), fur);
    body.position.set(0, 0.24, 0);
    addSimplePart(body);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.19, 0.36), furDark);
    chest.position.set(0, 0.27, 0.44);
    addSimplePart(chest);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.22, 0.26), fur);
    head.position.set(0, 0.36, 0.58);
    addSimplePart(head);

    const leftEar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.06), furDark);
    leftEar.position.set(-0.11, 0.49, 0.65);
    addSimplePart(leftEar);
    const rightEar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.06), furDark);
    rightEar.position.set(0.11, 0.49, 0.65);
    addSimplePart(rightEar);

    const legGeo = new THREE.BoxGeometry(0.1, 0.22, 0.1);
    const legs = [];
    const legOffsets = [
      [-0.16, 0.12, 0.31],
      [0.16, 0.12, 0.31],
      [-0.16, 0.12, -0.29],
      [0.16, 0.12, -0.29],
    ];
    for (const [x, y, z] of legOffsets) {
      const leg = new THREE.Mesh(legGeo, pawMat);
      leg.position.set(x, y, z);
      addSimplePart(leg);
      legs.push(leg);
    }

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.44), furDark);
    tail.position.set(0, 0.35, -0.62);
    addSimplePart(tail);

    const paw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.16), pawMat);
    paw.position.set(0.21, 0.25, 0.42);
    addSimplePart(paw);

    const modelAnchor = new THREE.Group();
    group.add(modelAnchor);

    return {
      group,
      body,
      tail,
      legs,
      paw,
      simpleParts,
      modelAnchor,
      usingRealisticModel: false,
      rig: null,
      clipMixer: null,
      clipActions: new Map(),
      stateClipActions: {},
      walkAction: null,
      idleAction: null,
      activeClipAction: null,
      clipSpecialAction: null,
      clipSpecialState: "",
      clipSpecialPhase: "",
      useClipLocomotion: false,
      pos: new THREE.Vector3(1.5, 0, 1.7),
      state: "patrol", // patrol|toDesk|prepareJump|launchUp|forepawHook|pullUp|jumpSettle|toCup|swipe|jumpDown|landStop|sit|toCatnip|distracted
      lastState: "patrol",
      stateT: 0,
      status: "Patrolling",
      onTable: false,
      debugMoveActive: false,
      debugMoveSurface: "floor", // floor | elevated
      debugMoveY: 0,
      debugMoveJumpAnchor: new THREE.Vector3(0, 0, 0),
      debugMoveLanding: new THREE.Vector3(0, 0, 0),
      debugMoveJumpOff: new THREE.Vector3(0, 0, 0),
      debugMoveJumpDown: new THREE.Vector3(0, 0, 0),
      debugMoveSitSeconds: 0,
      debugMoveTarget: new THREE.Vector3(0, 0, 0),
      tableRoamTarget: new THREE.Vector3(0, 0, 0),
      nextTableRoamAt: 0,
      speed: 1.0,
      patrolTarget: new THREE.Vector3(1.5, 0, 1.7),
      nextTableRollAt: 0,
      tableRollStartAt: 0,
      manualPatrolActive: false,
      walkT: 0,
      motionBlend: 0,
      phaseT: 0,
      sitDuration: 1.25,
      swipeHitDone: false,
      jump: null, // {from,to,fromY,toY,dur,t,arc,next}
      landStopNextState: "patrol",
      jumpAnchor: null,
      jumpTargets: null, // {hook, top}
      jumpApproachLock: false,
      nav: {
        goal: new THREE.Vector3(1.5, 0, 1.7),
        debugDestination: new THREE.Vector3(1.5, 0, 1.7),
        path: [],
        index: 0,
        commandedSpeed: 0,
        speedNorm: 0,
        smoothedSpeed: 0,
        repathAt: 0,
        anchorReplanAt: 0,
        anchorLandingCheckAt: 0,
        jumpNoClip: false,
        jumpBypassCheckAt: 0,
        steerYaw: NaN,
        pickupTrapT: 0,
        unstuckCheckAt: 0,
        unstuckCheckPos: new THREE.Vector3(1.5, 0, 1.7),
        patrolPathCheckAt: 0,
        stuckT: 0,
        lastSpeed: 0,
      },
    };
  }

  function normalizeCatModel(model) {
    tempBox.setFromObject(model);
    if (tempBox.isEmpty()) return;

    tempBox.getSize(tempSize);
    const sourceLength = Math.max(tempSize.x, tempSize.z, 0.001);
    const targetLength = 0.92;
    const scale = targetLength / sourceLength;
    model.scale.multiplyScalar(scale);

    tempBox.setFromObject(model);
    tempBox.getCenter(tempCenter);
    tempMin.copy(tempBox.min);

    model.position.x -= tempCenter.x;
    model.position.y -= tempMin.y;
    model.position.z -= tempCenter.z;
  }

  function findBoneByAliases(model, aliases) {
    if (!aliases || aliases.length === 0) return null;

    const bones = [];
    model.traverse((node) => {
      if (
        node.isBone ||
        (node.name && !node.isMesh && !node.isCamera && !node.isLight)
      ) {
        bones.push(node);
      }
    });

    for (const alias of aliases) {
      if (!alias) continue;
      const exact = bones.find((b) => b.name === alias);
      if (exact) return exact;
    }

    const lowerNames = bones.map((b) => ({ bone: b, name: b.name.toLowerCase() }));
    for (const alias of aliases) {
      if (!alias) continue;
      const q = alias.toLowerCase();
      const loose = lowerNames.find((entry) => entry.name === q || entry.name.includes(q));
      if (loose) return loose.bone;
    }

    return null;
  }

  function cloneBoneRotation(bone) {
    return bone ? bone.rotation.clone() : new THREE.Euler();
  }

  function createCatRig(model) {
    const rig = {
      root: findBoneByAliases(model, ["j_root", "_rootJoint", "Root_00", "root"]),
      hips: findBoneByAliases(model, ["j_hips", "Hip_011", "hips", "hip"]),
      spine1: findBoneByAliases(model, ["j_spine_1", "spine_1", "spine1", "spine"]),
      spine2: findBoneByAliases(model, ["j_spine_2", "spine_2", "spine2"]),
      spine3: findBoneByAliases(model, ["j_spine_3", "spine_3", "spine3"]),
      neckBase: findBoneByAliases(model, ["j_neck_base", "Neck_01", "neck_base", "neck"]),
      neck1: findBoneByAliases(model, ["j_neck_1", "neck_1", "neck1"]),
      head: findBoneByAliases(model, ["j_head", "Head_02", "head"]),
      tail: [
        findBoneByAliases(model, ["j_tail_1", "Tail_1_012", "tail_1"]),
        findBoneByAliases(model, ["j_tail_2", "Tail_2_013", "tail_2"]),
        findBoneByAliases(model, ["j_tail_3", "Tail_3_014", "tail_3"]),
        findBoneByAliases(model, ["j_tail_4", "Tail_4_015", "tail_4"]),
        findBoneByAliases(model, ["j_tail_5", "Tail_5_016", "tail_5"]),
        findBoneByAliases(model, ["j_tail_6", "tail_6"]),
      ],
      frontL: {
        shoulder: findBoneByAliases(model, ["j_l_humerous", "Left_leg_front_09", "Slim_Cat_L_Front_Leg", "left_leg_front"]),
        elbow: findBoneByAliases(model, ["j_l_elbow", "Left_paw_front_010", "left_paw_front", "left_elbow"]),
        wrist: findBoneByAliases(model, ["j_l_wrist", "Left_paw_front_010", "left_wrist"]),
        paw: findBoneByAliases(model, ["j_l_palm", "Left_paw_front_010", "left_paw"]),
      },
      frontR: {
        shoulder: findBoneByAliases(model, ["j_r_humerous", "Right__leg_front_021", "Slim_Cat_R_Front_Leg", "right_leg_front"]),
        elbow: findBoneByAliases(model, ["j_r_elbow", "Right__paw_front_022", "right_paw_front", "right_elbow"]),
        wrist: findBoneByAliases(model, ["j_r_wrist", "Right__paw_front_022", "right_wrist"]),
        paw: findBoneByAliases(model, ["j_r_palm", "Right__paw_front_022", "right_paw"]),
      },
      backL: {
        hip: findBoneByAliases(model, ["j_l_femur", "Left_leg_back_017", "Slim_Cat_L_Hind_Leg", "left_leg_back"]),
        knee: findBoneByAliases(model, ["j_l_knee", "Left_paw_back_018", "left_paw_back", "left_knee"]),
        ankle: findBoneByAliases(model, ["j_l_ankle", "Left_paw_back_018", "left_ankle"]),
      },
      backR: {
        hip: findBoneByAliases(model, ["j_r_femur", "Right__leg_back_019", "Slim_Cat_R_Hind_Leg", "right_leg_back"]),
        knee: findBoneByAliases(model, ["j_r_knee", "Right__paw_back_020", "right_paw_back", "right_knee"]),
        ankle: findBoneByAliases(model, ["j_r_ankle", "Right__paw_back_020", "right_ankle"]),
      },
      base: {},
      profile: "default",
    };

    const hasWalkingCatBones = !!findBoneByAliases(model, [
      "Left_leg_front_09",
      "Right__leg_front_021",
      "Left_leg_back_017",
      "Right__leg_back_019",
    ]);
    if (hasWalkingCatBones) {
      rig.profile = "walkingcat";
    }

    const allBones = [
      rig.root, rig.hips, rig.spine1, rig.spine2, rig.spine3, rig.neckBase, rig.neck1, rig.head,
      ...rig.tail,
      rig.frontL.shoulder, rig.frontL.elbow, rig.frontL.wrist, rig.frontL.paw,
      rig.frontR.shoulder, rig.frontR.elbow, rig.frontR.wrist, rig.frontR.paw,
      rig.backL.hip, rig.backL.knee, rig.backL.ankle,
      rig.backR.hip, rig.backR.knee, rig.backR.ankle,
    ].filter(Boolean);

    for (const bone of allBones) {
      rig.base[bone.name] = cloneBoneRotation(bone);
    }

    return rig;
  }

  function setBonePose(rig, bone, x = 0, y = 0, z = 0, alpha = 1) {
    if (!bone) return;
    const base = rig.base[bone.name];
    if (!base) return;
    const targetX = base.x + x;
    const targetY = base.y + y;
    const targetZ = base.z + z;
    const lerpAngle = (current, target, t) => {
      const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
      return current + delta * t;
    };
    bone.rotation.x = lerpAngle(bone.rotation.x, targetX, alpha);
    bone.rotation.y = lerpAngle(bone.rotation.y, targetY, alpha);
    bone.rotation.z = lerpAngle(bone.rotation.z, targetZ, alpha);
  }

  function pickAnimationClip(clips, patterns) {
    for (const pattern of patterns) {
      const clip = clips.find((c) => pattern.test(c.name));
      if (clip) return clip;
    }
    return null;
  }

  function inferCatModelYawOffset(clips) {
    const looksLikeIndieCat = clips?.some((c) => /walk_f|trot_f|run_f|sit_idle/i.test(c.name));
    return looksLikeIndieCat ? 0 : catModelYawOffset;
  }

  function isRootMotionTrack(trackName) {
    const dot = trackName.lastIndexOf(".");
    if (dot === -1) return false;
    const node = trackName.slice(0, dot).toLowerCase();
    const prop = trackName.slice(dot + 1).toLowerCase();
    if (prop !== "position" && prop !== "quaternion") return false;
    const normalized = node.replace(/[^a-z0-9]+/g, " ").trim();
    if (/\b(armature|j root|rootjoint|root 00|root|hip|hips|j hips|cat)\b/.test(normalized)) return true;
    return false;
  }

  function makeInPlaceClip(clip) {
    const tracks = clip.tracks.filter((track) => !isRootMotionTrack(track.name));
    if (tracks.length === clip.tracks.length) return clip;
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }

  function makeFrameRangeClip(clip, name, startFrame, endFrame, fps = 30) {
    if (!clip) return null;
    const safeStart = Math.max(0, Math.floor(startFrame));
    const safeEnd = Math.max(safeStart + 1, Math.floor(endFrame));
    try {
      const sub = THREE.AnimationUtils.subclip(clip, name, safeStart, safeEnd, fps);
      if (!sub || !sub.tracks || sub.tracks.length === 0 || sub.duration <= 0) return null;
      return sub;
    } catch {
      return null;
    }
  }

  function setupCatClipAnimations(catObject, model, clips) {
    catObject.clipMixer = null;
    catObject.clipActions.clear();
    catObject.stateClipActions = {};
    catObject.walkAction = null;
    catObject.idleAction = null;
    catObject.activeClipAction = null;
    catObject.clipSpecialAction = null;
    catObject.clipSpecialState = "";
    catObject.clipSpecialPhase = "";
    catObject.useClipLocomotion = false;

    if (!clips || clips.length === 0) return;

    const inPlaceClips = clips.map((clip) => makeInPlaceClip(clip));
    const mixer = new THREE.AnimationMixer(model);
    catObject.clipMixer = mixer;
    for (const clip of inPlaceClips) {
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      catObject.clipActions.set(clip.name, action);
    }

    const walkClip =
      pickAnimationClip(inPlaceClips, [/walk/i, /locomot/i, /trot/i, /run/i, /move/i]) || inPlaceClips[0];
    const idleClip =
      pickAnimationClip(inPlaceClips, [/idle/i, /rest/i, /stand/i, /wait/i]) || walkClip || inPlaceClips[0];

    const walkAction = mixer.clipAction(walkClip);
    const idleAction = mixer.clipAction(idleClip);
    walkAction.play();
    if (idleAction !== walkAction) idleAction.play();

    walkAction.setEffectiveWeight(0);
    idleAction.setEffectiveWeight(1);
    idleAction.setEffectiveTimeScale(1);

    catObject.walkAction = walkAction;
    catObject.idleAction = idleAction;
    catObject.activeClipAction = idleAction;
    catObject.useClipLocomotion = true;

    const lookDownClip = pickAnimationClip(inPlaceClips, [/lookdown/i]);
    const eatIntroClip =
      makeFrameRangeClip(lookDownClip, "LookDown__eatIntro", 1, 28, 30) ||
      pickAnimationClip(inPlaceClips, [/eat_/i, /look/i, /licking_sit/i, /drink_/i, /sit_idle/i]);
    const eatLoopClip =
      makeFrameRangeClip(lookDownClip, "LookDown__eatLoop", 29, 32, 30) ||
      pickAnimationClip(inPlaceClips, [/licking_sit/i, /eat_/i, /drink_/i, /sit_idle/i, /look/i]);

    const clipStates = {
      jumpUp: {
        clip: pickAnimationClip(inPlaceClips, [/inplace/i, /jump/i, /crouch_f/i]),
        loop: false,
        speed: 1.0,
      },
      jumpSettle: {
        clip: pickAnimationClip(inPlaceClips, [/land_stop/i, /^idle$/i, /base/i]),
        loop: false,
        speed: 1.0,
      },
      jumpDown: {
        clip: pickAnimationClip(inPlaceClips, [/fall_low/i, /fall_high/i, /jump/i]),
        loop: false,
        speed: 1.0,
      },
      landStop: {
        clip: pickAnimationClip(inPlaceClips, [/land_stop/i, /land_run/i, /sit_to/i]),
        loop: false,
        speed: 1.0,
      },
      swipe: {
        clip: pickAnimationClip(inPlaceClips, [/paw_r/i, /^paw_/i, /bite_r/i, /bite_l/i]),
        loop: false,
        speed: 1.0,
      },
      sit: {
        clip: pickAnimationClip(inPlaceClips, [/sit_idle/i, /sit/i, /pet_sit/i]),
        loop: true,
        speed: 1.0,
      },
      eat: {
        introClip: eatIntroClip,
        loopClip: eatLoopClip,
        introSpeed: 1.0,
        loopSpeed: 1.0,
      },
    };
    for (const [stateKey, def] of Object.entries(clipStates)) {
      if (def.introClip || def.loopClip) {
        const introAction = def.introClip ? mixer.clipAction(def.introClip) : null;
        const loopAction = def.loopClip ? mixer.clipAction(def.loopClip) : null;
        if (!introAction && !loopAction) continue;
        clipStates[stateKey] = {
          introAction,
          loopAction,
          introSpeed: def.introSpeed ?? 1.0,
          loopSpeed: def.loopSpeed ?? 1.0,
        };
        continue;
      }
      if (!def.clip) continue;
      clipStates[stateKey] = {
        action: mixer.clipAction(def.clip),
        loop: def.loop,
        speed: def.speed,
      };
    }
    catObject.stateClipActions = clipStates;
  }

  function setCatClipSpecialPose(catObject, specialState, dt = 0) {
    if (!catObject.useClipLocomotion || !catObject.walkAction || !catObject.idleAction) return false;
    const def = specialState ? catObject.stateClipActions?.[specialState] : null;
    if (!def || !catObject.clipMixer) return false;
    const hasSequence = !!(def.introAction || def.loopAction);
    if (!hasSequence && !def.action) return false;
    const mixer = catObject.clipMixer;

    const startAction = (action, loop, speed, crossFade = true) => {
      action.enabled = true;
      action.clampWhenFinished = true;
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.setEffectiveTimeScale(speed ?? 1);
      if (catObject.clipSpecialAction !== action) {
        action.reset().play();
        action.setEffectiveWeight(1);
        if (crossFade && catObject.clipSpecialAction && catObject.clipSpecialAction !== action) {
          catObject.clipSpecialAction.crossFadeTo(action, 0.1, false);
        }
        catObject.clipSpecialAction = action;
      } else {
        action.play();
        action.setEffectiveWeight(1);
      }
    };

    if (hasSequence) {
      if (catObject.clipSpecialState !== specialState) {
        const firstAction = def.introAction || def.loopAction;
        const firstIsLoop = !def.introAction;
        startAction(firstAction, firstIsLoop, firstIsLoop ? def.loopSpeed : def.introSpeed, true);
        catObject.clipSpecialState = specialState;
        catObject.clipSpecialPhase = firstIsLoop ? "loop" : "intro";
      }
    } else if (catObject.clipSpecialState !== specialState) {
      startAction(def.action, def.loop, def.speed, true);
      catObject.clipSpecialState = specialState;
      catObject.clipSpecialPhase = def.loop ? "loop" : "single";
    }

    catObject.walkAction.enabled = true;
    catObject.idleAction.enabled = true;
    catObject.walkAction.play();
    catObject.idleAction.play();
    catObject.walkAction.setEffectiveWeight(0);
    catObject.idleAction.setEffectiveWeight(0);

    if (hasSequence) {
      if (catObject.clipSpecialPhase === "intro" && def.introAction && def.loopAction) {
        const introAction = def.introAction;
        if (catObject.clipSpecialAction !== introAction) {
          startAction(introAction, false, def.introSpeed, false);
        }
        const introDur = Math.max(introAction.getClip().duration, 0.001);
        if (introAction.time >= introDur - 1 / 60) {
          startAction(def.loopAction, true, def.loopSpeed, true);
          catObject.clipSpecialPhase = "loop";
        }
      } else if (def.loopAction) {
        if (catObject.clipSpecialAction !== def.loopAction) {
          startAction(def.loopAction, true, def.loopSpeed, false);
        } else {
          catObject.clipSpecialAction.setEffectiveWeight(1);
        }
      }
    } else if (catObject.clipSpecialAction) {
      catObject.clipSpecialAction.setEffectiveWeight(1);
    }

    catObject.activeClipAction = catObject.clipSpecialAction;
    mixer.update(dt);
    return true;
  }

  function updateCatClipLocomotion(catObject, dt, moving, speedNorm) {
    if (!catObject.useClipLocomotion || !catObject.clipMixer || !catObject.walkAction || !catObject.idleAction) return;
    if (catObject.clipSpecialAction) {
      catObject.clipSpecialAction.setEffectiveWeight(0);
      catObject.clipSpecialAction.stop();
      catObject.clipSpecialAction = null;
      catObject.clipSpecialState = "";
      catObject.clipSpecialPhase = "";
    }

    const walkAction = catObject.walkAction;
    const idleAction = catObject.idleAction;
    walkAction.enabled = true;
    idleAction.enabled = true;
    walkAction.play();
    idleAction.play();
    const target = moving ? walkAction : idleAction;

    if (catObject.activeClipAction !== target) {
      target.reset().play();
      if (catObject.activeClipAction && catObject.activeClipAction !== target) {
        catObject.activeClipAction.crossFadeTo(target, 0.22, false);
      } else {
        target.setEffectiveWeight(1);
      }
      catObject.activeClipAction = target;
    }

    const walkTimeScale = THREE.MathUtils.clamp(0.6 + speedNorm * 0.95, 0.6, 1.85);

    if (walkAction === idleAction) {
      walkAction.setEffectiveWeight(1);
      walkAction.setEffectiveTimeScale(moving ? walkTimeScale : 0.45);
    } else if (moving) {
      walkAction.setEffectiveWeight(1);
      idleAction.setEffectiveWeight(0);
      walkAction.setEffectiveTimeScale(walkTimeScale);
      idleAction.setEffectiveTimeScale(1.0);
    } else {
      walkAction.setEffectiveWeight(0);
      idleAction.setEffectiveWeight(1);
      idleAction.setEffectiveTimeScale(1.0);
    }

    catObject.clipMixer.update(dt);
  }

  function loadCatModel(catObject) {
    const tryLoad = (idx) => {
      if (idx >= catModelCandidates.length) {
        catObject.usingRealisticModel = false;
        console.warn("Failed to load cat model from all paths:", catModelCandidates);
        return;
      }

      const url = catModelCandidates[idx];
      gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          model.traverse((node) => {
            if (!node.isMesh) return;
            node.castShadow = false;
            node.receiveShadow = false;
            if (Array.isArray(node.material)) {
              for (const mat of node.material) {
                if (mat && "side" in mat) mat.side = THREE.DoubleSide;
              }
            } else if (node.material && "side" in node.material) {
              node.material.side = THREE.DoubleSide;
            }
          });

          model.rotation.y = inferCatModelYawOffset(gltf.animations || []);
          normalizeCatModel(model);
          catObject.modelAnchor.clear();
          catObject.modelAnchor.add(model);
          catObject.usingRealisticModel = true;
          catObject.rig = createCatRig(model);
          setupCatClipAnimations(catObject, model, gltf.animations || []);

          for (const mesh of catObject.simpleParts) {
            mesh.visible = false;
          }
        },
        undefined,
        (error) => {
          console.warn("Failed to load cat model path:", url, error);
          tryLoad(idx + 1);
        }
      );
    };

    tryLoad(0);
  }

  return {
    buildCat,
    loadCatModel,
    setBonePose,
    setCatClipSpecialPose,
    updateCatClipLocomotion,
  };
}
