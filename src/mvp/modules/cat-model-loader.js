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
      clipSpecialSeqIndex: 0,
      useClipLocomotion: false,
      clipWalkActive: false,
      clipWalkScale: 0,
      locomotionActions: {},
      locomotionActionKeys: new Map(),
      locomotionWeights: new Map(),
      locomotionLastTargetKey: "idle",
      locomotion: {
        activeClip: "idle",
        clipScale: 0,
        profiles: {
          idle: { planarSpeed: 0, turnRate: 0, localX: 0, localZ: 0 },
          walkF: { planarSpeed: 0.9, turnRate: 1.1, localX: 0, localZ: 1 },
          walkL: { planarSpeed: 0.78, turnRate: 0.7, localX: 0.32, localZ: 0.95 },
          walkR: { planarSpeed: 0.78, turnRate: 0.7, localX: -0.32, localZ: 0.95 },
          turn45L: { planarSpeed: 0, turnRate: 0.76, localX: 0, localZ: 0 },
          turn45R: { planarSpeed: 0, turnRate: 0.76, localX: 0, localZ: 0 },
          turn90L: { planarSpeed: 0, turnRate: 1.52, localX: 0, localZ: 0 },
          turn90R: { planarSpeed: 0, turnRate: 1.52, localX: 0, localZ: 0 },
        },
      },
      pos: new THREE.Vector3(1.5, 0, 1.7),
      state: "patrol", // patrol|toDesk|prepareJump|launchUp|forepawHook|pullUp|jumpSettle|toCup|swipe|jumpDown|landStop|sit|toCatnip|distracted
      lastState: "patrol",
      stateT: 0,
      status: "Patrolling",
      onTable: false,
      debugMoveActive: false,
      debugMoveSurface: "floor", // floor | elevated
      debugMoveFinalSurfaceId: "floor",
      debugMoveY: 0,
      debugMoveFinalY: 0,
      debugMoveJumpAnchor: new THREE.Vector3(0, 0, 0),
      debugMoveLanding: new THREE.Vector3(0, 0, 0),
      debugMoveJumpOff: new THREE.Vector3(0, 0, 0),
      debugMoveJumpDown: new THREE.Vector3(0, 0, 0),
      debugMoveJumpDownY: 0,
      debugMoveDirectJump: false,
      debugMoveSitSeconds: 0,
      debugMoveTarget: new THREE.Vector3(0, 0, 0),
      debugMoveFinalTarget: new THREE.Vector3(0, 0, 0),
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
      landStopDuration: 0.22,
      jumpAnchor: null,
      jumpTargets: null, // {hook, top}
      jumpApproachLock: false,
      nav: {
        goal: new THREE.Vector3(1.5, 0, 1.7),
        debugDestination: new THREE.Vector3(1.5, 0, 1.7),
        path: [],
        index: 0,
        commandedSpeed: 0,
        driveSpeed: 0,
        speedNorm: 0,
        smoothedSpeed: 0,
        turnBias: 0,
        turnDirLock: 0,
        locomotionHoldT: 0,
        repathAt: 0,
        anchorReplanAt: 0,
        anchorLandingCheckAt: 0,
        jumpDownPlanAt: 0,
        jumpDownPlanValid: false,
        jumpDownNoMoveT: 0,
        jumpDownDebug: {},
        jumpNoClip: false,
        jumpBypassCheckAt: 0,
        lastSurfaceHopFrom: "",
        lastSurfaceHopTo: "",
        lastSurfaceHopAt: 0,
        surfaceHopTrail: [],
        steerYaw: NaN,
        pickupTrapT: 0,
        unstuckCheckAt: 0,
        unstuckCheckPos: new THREE.Vector3(1.5, 0, 1.7),
        patrolPathCheckAt: 0,
        catnipPathCheckAt: 0,
        catnipUseExactTarget: false,
        windowPathCheckAt: 0,
        windowHoldActive: false,
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
    model.userData.motionScale = scale;

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

  function isRootRotationTrack(trackName) {
    const dot = trackName.lastIndexOf(".");
    if (dot === -1) return false;
    const prop = trackName.slice(dot + 1).toLowerCase();
    if (prop !== "quaternion") return false;
    return isRootMotionTrack(trackName);
  }

  function isJumpSpecialClipName(name = "") {
    return /edge_to|edge_from|land_stop|fall_low|fall_high/i.test(name);
  }

  function makeInPlaceClip(clip, options = {}) {
    const keepRootRotation = !!options.keepRootRotation;
    const tracks = clip.tracks.filter((track) => {
      if (!isRootMotionTrack(track.name)) return true;
      if (keepRootRotation && isRootRotationTrack(track.name)) return true;
      return false;
    });
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

  function findRootPositionTrack(clip) {
    const posTracks = clip?.tracks?.filter((track) => track.name.endsWith(".position")) || [];
    if (!posTracks.length) return null;
    return (
      posTracks.find((track) => /^root(\.|$)/i.test(track.name)) ||
      posTracks.find((track) => /(^|[_.])root([_.]|$)/i.test(track.name)) ||
      posTracks.find((track) => /hips?/i.test(track.name)) ||
      posTracks[0]
    );
  }

  function findRootQuaternionTrack(clip) {
    const rotTracks = clip?.tracks?.filter((track) => track.name.endsWith(".quaternion")) || [];
    if (!rotTracks.length) return null;
    return (
      rotTracks.find((track) => /^root(\.|$)/i.test(track.name)) ||
      rotTracks.find((track) => /(^|[_.])root([_.]|$)/i.test(track.name)) ||
      rotTracks.find((track) => /hips?/i.test(track.name)) ||
      rotTracks[0]
    );
  }

  function extractClipPlanarMotion(clip) {
    const track = findRootPositionTrack(clip);
    if (!track || !track.values || track.values.length < 6) return null;
    const values = track.values;
    const sx = values[0];
    const sz = values[2];
    const ex = values[values.length - 3];
    const ez = values[values.length - 1];
    const dx = ex - sx;
    const dz = ez - sz;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-5) return null;
    const duration = Math.max(clip.duration, 1e-5);
    return {
      planarSpeed: dist / duration,
      localX: dx / dist,
      localZ: dz / dist,
    };
  }

  function extractClipTurnRate(clip) {
    const track = findRootQuaternionTrack(clip);
    if (!track || !track.values || track.values.length < 8) return 0;
    const values = track.values;
    const qStart = new THREE.Quaternion(values[0], values[1], values[2], values[3]);
    const qEnd = new THREE.Quaternion(
      values[values.length - 4],
      values[values.length - 3],
      values[values.length - 2],
      values[values.length - 1]
    );
    // In this rig, local +Y maps to the horizontal heading vector after root rest rotation.
    const dirStart = new THREE.Vector3(0, 1, 0).applyQuaternion(qStart);
    const dirEnd = new THREE.Vector3(0, 1, 0).applyQuaternion(qEnd);
    dirStart.y = 0;
    dirEnd.y = 0;
    if (dirStart.lengthSq() < 1e-5 || dirEnd.lengthSq() < 1e-5) return 0;
    dirStart.normalize();
    dirEnd.normalize();
    const yawStart = Math.atan2(dirStart.x, dirStart.z);
    const yawEnd = Math.atan2(dirEnd.x, dirEnd.z);
    const yawDelta = Math.atan2(Math.sin(yawEnd - yawStart), Math.cos(yawEnd - yawStart));
    return Math.abs(yawDelta) / Math.max(clip.duration, 1e-5);
  }

  function makeLocomotionProfile(sourceClip, fallback) {
    const base = fallback || { planarSpeed: 0, turnRate: 0, localX: 0, localZ: 0 };
    const planar = extractClipPlanarMotion(sourceClip);
    const turnRate = extractClipTurnRate(sourceClip);
    return {
      planarSpeed: planar?.planarSpeed ?? base.planarSpeed,
      turnRate: turnRate > 1e-4 ? turnRate : base.turnRate,
      localX: planar?.localX ?? base.localX,
      localZ: planar?.localZ ?? base.localZ,
    };
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
    catObject.clipWalkActive = false;
    catObject.clipWalkScale = 0;
    catObject.locomotionActions = {};
    catObject.locomotionActionKeys = new Map();
    catObject.locomotionWeights = new Map();
    catObject.locomotionLastTargetKey = "idle";
    if (catObject.locomotion) {
      catObject.locomotion.activeClip = "idle";
      catObject.locomotion.clipScale = 0;
    }

    if (!clips || clips.length === 0) return;

    const inPlaceClips = clips.map((clip) => makeInPlaceClip(clip));
    const sourceClipByName = new Map(clips.map((clip) => [clip.name, clip]));
    const mixer = new THREE.AnimationMixer(model);
    catObject.clipMixer = mixer;
    for (const clip of inPlaceClips) {
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      catObject.clipActions.set(clip.name, action);
    }

    const walkClip =
      pickAnimationClip(inPlaceClips, [/^walk_f$/i, /^walk$/i, /walk_f/i, /walk/i, /trot_f/i, /run_f/i]) || inPlaceClips[0];
    const idleClip =
      pickAnimationClip(inPlaceClips, [/^idle$/i, /idle/i, /rest/i, /stand/i, /wait/i]) || walkClip || inPlaceClips[0];

    const locomotionClips = {
      idle: idleClip,
      walkF: walkClip,
      walkL:
        pickAnimationClip(inPlaceClips, [/^walk_l$/i, /walk_l/i, /trot_l/i, /run_l/i, /incline_side/i]) || walkClip,
      walkR:
        pickAnimationClip(inPlaceClips, [/^walk_r$/i, /walk_r/i, /trot_r/i, /run_r/i, /incline_side/i]) || walkClip,
      turn45L:
        pickAnimationClip(inPlaceClips, [/^turn-45_l$/i, /turn[-_. ]?45[-_. ]?l/i, /turn\.l/i, /crouch_turn\.l/i]) ||
        walkClip,
      turn45R:
        pickAnimationClip(inPlaceClips, [/^turn-45_r$/i, /turn[-_. ]?45[-_. ]?r/i, /turn\.r/i, /crouch_turn\.r/i]) ||
        walkClip,
      turn90L:
        pickAnimationClip(inPlaceClips, [/^turn-90_l$/i, /turn[-_. ]?90[-_. ]?l/i, /turn\.l/i, /crouch_turn\.l/i]) ||
        walkClip,
      turn90R:
        pickAnimationClip(inPlaceClips, [/^turn-90_r$/i, /turn[-_. ]?90[-_. ]?r/i, /turn\.r/i, /crouch_turn\.r/i]) ||
        walkClip,
    };

    const locomotionActions = {};
    const locomotionActionKeys = new Map();
    const locomotionWeights = new Map();
    for (const [key, clip] of Object.entries(locomotionClips)) {
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      locomotionActions[key] = action;
      locomotionActionKeys.set(action, key);
      locomotionWeights.set(action, 0);
    }
    catObject.locomotionActions = locomotionActions;
    catObject.locomotionActionKeys = locomotionActionKeys;
    catObject.locomotionWeights = locomotionWeights;

    const walkAction = locomotionActions.walkF || mixer.clipAction(walkClip);
    const idleAction = locomotionActions.idle || mixer.clipAction(idleClip);
    walkAction.play();
    if (idleAction !== walkAction) idleAction.play();
    walkAction.setEffectiveWeight(0);
    idleAction.setEffectiveWeight(1);
    idleAction.setEffectiveTimeScale(1);

    catObject.walkAction = walkAction;
    catObject.idleAction = idleAction;
    catObject.activeClipAction = idleAction;
    catObject.useClipLocomotion = true;

    if (catObject.locomotion?.profiles) {
      const motionScale =
        Number.isFinite(model?.userData?.motionScale) && model.userData.motionScale > 1e-5
          ? model.userData.motionScale
          : 1;
      for (const [key, clip] of Object.entries(locomotionClips)) {
        if (!clip) continue;
        const sourceClip = sourceClipByName.get(clip.name) || clip;
        const profile = makeLocomotionProfile(sourceClip, catObject.locomotion.profiles[key]);
        profile.planarSpeed *= motionScale;
        catObject.locomotion.profiles[key] = profile;
      }
    }

    const lookDownClip = pickAnimationClip(inPlaceClips, [/lookdown/i]);
    const lookUpClip = pickAnimationClip(inPlaceClips, [
      /^look_up$/i,
      /^lookup$/i,
      /look[-_. ]?up/i,
      /head[-_. ]?up/i,
      /up[-_. ]?look/i,
    ]);
    const rearUpPrepClip = pickAnimationClip(inPlaceClips, [
      /^edge_to$/i,
      /^edge_idle$/i,
      /edge_to/i,
      /edge/i,
      /^crouch_f$/i,
      /^crouch_idle$/i,
      /crouch_f/i,
      /crouch/i,
    ]);
    const inclineClip = pickAnimationClip(inPlaceClips, [/^incline$/i, /incline/i]);
    const inclineJumpPrepClip =
      makeFrameRangeClip(inclineClip, "Incline__jumpPrep", 40, 48, 30) ||
      rearUpPrepClip;
    const jumpPrepareSequenceClips = [lookUpClip, inclineJumpPrepClip].filter(Boolean);
    if (jumpPrepareSequenceClips.length === 0 && rearUpPrepClip) {
      jumpPrepareSequenceClips.push(rearUpPrepClip);
    }
    const eatIntroClip =
      makeFrameRangeClip(lookDownClip, "LookDown__eatIntro", 1, 28, 30) ||
      pickAnimationClip(inPlaceClips, [/eat_/i, /look/i, /licking_sit/i, /drink_/i, /sit_idle/i]);
    const eatLoopClip =
      makeFrameRangeClip(lookDownClip, "LookDown__eatLoop", 29, 32, 30) ||
      pickAnimationClip(inPlaceClips, [/licking_sit/i, /eat_/i, /drink_/i, /sit_idle/i, /look/i]);

    const clipStates = {
      jumpPrepare: {
        sequenceClips: jumpPrepareSequenceClips,
        sequenceSpeeds: jumpPrepareSequenceClips.map(() => 1.0),
      },
      jumpLaunch: {
        clip: pickAnimationClip(inPlaceClips, [/^inplace$/i, /^jump/i, /inplace/i, /jump/i, /crouch_f/i]),
        loop: false,
        speed: 1.18,
      },
      jumpHook: {
        clip: pickAnimationClip(inPlaceClips, [/^edge_to$/i, /^edge_idle$/i, /edge_to/i, /edge/i, /inplace/i]),
        loop: false,
        speed: 1.04,
      },
      jumpPull: {
        clip: pickAnimationClip(inPlaceClips, [/^edge_from$/i, /^edge_to$/i, /edge_from/i, /edge_to/i, /land_run/i]),
        loop: false,
        speed: 1.08,
      },
      jumpSettle: {
        clip: pickAnimationClip(inPlaceClips, [/^land_stop$/i, /^land_run$/i, /land_stop/i, /land/i, /^idle$/i, /base/i]),
        loop: false,
        speed: 1.0,
      },
      jumpDownPrepare: {
        clip: pickAnimationClip(inPlaceClips, [/^edge_to$/i]),
        loop: false,
        speed: 1.0,
      },
      jumpDown: {
        clip: pickAnimationClip(inPlaceClips, [/^edge_from$/i]),
        loop: false,
        speed: 1.08,
      },
      landStop: {
        clip: pickAnimationClip(inPlaceClips, [/^land_stop$/i]),
        loop: false,
        speed: 1.0,
      },
      // Backward compatibility fallback if older state logic still asks for jumpUp.
      jumpUp: {
        clip: pickAnimationClip(inPlaceClips, [/^inplace$/i, /^jump/i, /inplace/i, /jump/i, /crouch_f/i]),
        loop: false,
        speed: 1.08,
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
      if (Array.isArray(def.sequenceClips) && def.sequenceClips.length > 0) {
        const sequenceActions = def.sequenceClips
          .map((clip) => (clip ? mixer.clipAction(clip) : null))
          .filter(Boolean);
        if (!sequenceActions.length) continue;
        clipStates[stateKey] = {
          sequenceActions,
          sequenceSpeeds: Array.isArray(def.sequenceSpeeds) ? def.sequenceSpeeds : [],
        };
        continue;
      }
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
    const hasSequenceList = Array.isArray(def.sequenceActions) && def.sequenceActions.length > 0;
    const hasSequence = !!(def.introAction || def.loopAction);
    if (!hasSequenceList && !hasSequence && !def.action) return false;
    const mixer = catObject.clipMixer;

    const resolveSpecialSpeed = (stateName, fallbackSpeed) => {
      const overrides = catObject.clipSpecialSpeedOverrides;
      if (overrides && Number.isFinite(overrides[stateName])) return overrides[stateName];
      return fallbackSpeed;
    };

    const startAction = (action, loop, speed, crossFade = 0.1) => {
      const resolvedSpeed = resolveSpecialSpeed(specialState, speed ?? 1);
      action.enabled = true;
      action.paused = false;
      action.clampWhenFinished = true;
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.setEffectiveTimeScale(resolvedSpeed ?? 1);
      if (catObject.clipSpecialAction !== action) {
        action.reset().play();
        action.setEffectiveWeight(1);
        const fadeFromAction = catObject.clipSpecialAction || catObject.activeClipAction;
        if (crossFade && fadeFromAction && fadeFromAction !== action) {
          const fadeDur = typeof crossFade === "number" ? Math.max(0.01, crossFade) : 0.1;
          fadeFromAction.crossFadeTo(action, fadeDur, false);
        }
        catObject.clipSpecialAction = action;
      } else {
        action.play();
        action.setEffectiveWeight(1);
        action.setEffectiveTimeScale(resolvedSpeed ?? 1);
      }
    };

    const resolveSpecialCrossFade = (fromState, toState) => {
      if (!fromState || !toState) return 0.1;
      if (fromState === toState) return 0.08;
      if (fromState === "jumpPrepare" && toState === "jumpUp") return 0.14;
      if (fromState === "jumpDownPrepare" && toState === "jumpDown") return 0.08;
      if (fromState === "jumpDown" && toState === "landStop") return 0.1;
      if (fromState === "jumpDownPrepare" && toState === "landStop") return 0.1;
      return 0.12;
    };
    const stateCrossFade = resolveSpecialCrossFade(catObject.clipSpecialState, specialState);

    if (hasSequenceList) {
      if (catObject.clipSpecialState !== specialState) {
        const firstAction = def.sequenceActions[0];
        const firstSpeed = def.sequenceSpeeds?.[0] ?? 1.0;
        startAction(firstAction, false, firstSpeed, stateCrossFade);
        catObject.clipSpecialState = specialState;
        catObject.clipSpecialPhase = "sequence";
        catObject.clipSpecialSeqIndex = 0;
      }
    } else if (hasSequence) {
      if (catObject.clipSpecialState !== specialState) {
        const firstAction = def.introAction || def.loopAction;
        const firstIsLoop = !def.introAction;
        startAction(firstAction, firstIsLoop, firstIsLoop ? def.loopSpeed : def.introSpeed, stateCrossFade);
        catObject.clipSpecialState = specialState;
        catObject.clipSpecialPhase = firstIsLoop ? "loop" : "intro";
        catObject.clipSpecialSeqIndex = 0;
      }
    } else if (catObject.clipSpecialState !== specialState) {
      startAction(def.action, def.loop, def.speed, stateCrossFade);
      catObject.clipSpecialState = specialState;
      catObject.clipSpecialPhase = def.loop ? "loop" : "single";
      catObject.clipSpecialSeqIndex = 0;
    }

    catObject.walkAction.enabled = true;
    catObject.idleAction.enabled = true;
    catObject.walkAction.play();
    catObject.idleAction.play();
    catObject.walkAction.setEffectiveWeight(0);
    catObject.idleAction.setEffectiveWeight(0);
    if (catObject.locomotionActions) {
      for (const action of Object.values(catObject.locomotionActions)) {
        if (!action) continue;
        action.enabled = true;
        action.play();
        action.setEffectiveWeight(0);
        action.setEffectiveTimeScale(1);
        catObject.locomotionWeights.set(action, 0);
      }
    }

    if (hasSequenceList) {
      const seqCount = def.sequenceActions.length;
      let seqIdx = Number.isFinite(catObject.clipSpecialSeqIndex) ? Math.floor(catObject.clipSpecialSeqIndex) : 0;
      seqIdx = Math.max(0, Math.min(seqCount - 1, seqIdx));
      const seqAction = def.sequenceActions[seqIdx];
      const seqSpeed = def.sequenceSpeeds?.[seqIdx] ?? 1.0;
      if (catObject.clipSpecialAction !== seqAction) {
        startAction(seqAction, false, seqSpeed, false);
      }
      const seqDur = Math.max(seqAction.getClip().duration, 0.001);
      if (seqAction.time >= seqDur - 1 / 60) {
        if (seqIdx < seqCount - 1) {
          const nextIdx = seqIdx + 1;
          const nextAction = def.sequenceActions[nextIdx];
          const nextSpeed = def.sequenceSpeeds?.[nextIdx] ?? 1.0;
          startAction(nextAction, false, nextSpeed, true);
          catObject.clipSpecialSeqIndex = nextIdx;
        } else {
          // Hold on last frame of the sequence until state changes.
          seqAction.time = seqDur;
          seqAction.paused = true;
          seqAction.setEffectiveWeight(1);
        }
      }
    } else if (hasSequence) {
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
      const resolvedSpeed = resolveSpecialSpeed(specialState, def.speed ?? 1);
      catObject.clipSpecialAction.setEffectiveTimeScale(resolvedSpeed ?? 1);
    }

    catObject.activeClipAction = catObject.clipSpecialAction;
    mixer.update(dt);
    return true;
  }

  function updateCatClipLocomotion(catObject, dt, moving, speedNorm, worldSpeed = 0) {
    if (!catObject.useClipLocomotion || !catObject.clipMixer || !catObject.walkAction || !catObject.idleAction) return;
    let lingeringSpecialAction = null;
    if (catObject.clipSpecialAction) {
      const specialAction = catObject.clipSpecialAction;
      specialAction.enabled = true;
      specialAction.play();
      const specialWeight = Number.isFinite(specialAction.getEffectiveWeight())
        ? specialAction.getEffectiveWeight()
        : 1;
      const fadedWeight = THREE.MathUtils.damp(specialWeight, 0, 18, Math.max(dt, 0));
      specialAction.setEffectiveWeight(fadedWeight);
      if (fadedWeight <= 0.01) {
        specialAction.stop();
        catObject.clipSpecialAction = null;
        catObject.clipSpecialState = "";
        catObject.clipSpecialPhase = "";
        catObject.clipSpecialSeqIndex = 0;
      } else {
        lingeringSpecialAction = specialAction;
      }
    }

    const locomotionActions = catObject.locomotionActions || {};
    const locomotionWeights = catObject.locomotionWeights || new Map();
    catObject.locomotionWeights = locomotionWeights;
    const walkAction = locomotionActions.walkF || catObject.walkAction;
    const idleAction = locomotionActions.idle || catObject.idleAction;
    const clipKey =
      catObject.locomotion?.activeClip ||
      (moving ? "walkF" : "idle");
    const requestedAction = locomotionActions[clipKey] || (moving ? walkAction : idleAction);
    const target = requestedAction || idleAction;
    const keyMap = catObject.locomotionActionKeys || new Map();
    const targetKey = keyMap.get(target) || (target === idleAction ? "idle" : "walkF");
    const prevTargetKey = catObject.locomotionLastTargetKey || targetKey;
    const isWalkKey = (key) => key === "walkF" || key === "walkL" || key === "walkR";
    const isTurnKey = (key) => key === "turn90L" || key === "turn90R" || key === "turn45L" || key === "turn45R";

    if (targetKey !== prevTargetKey && isTurnKey(targetKey) && !isTurnKey(prevTargetKey)) {
      // Entering a turn from walk/idle: start from a deterministic pose and blend in.
      target.reset();
    }
    if (targetKey !== prevTargetKey && isWalkKey(targetKey) && isWalkKey(prevTargetKey)) {
      // Walk-to-walk keeps phase continuity.
      const prevAction = catObject.activeClipAction || locomotionActions[prevTargetKey];
      if (prevAction && prevAction !== target) {
        const prevDuration = Math.max(prevAction.getClip()?.duration || 0, 0.001);
        const targetDuration = Math.max(target.getClip()?.duration || 0, 0.001);
        const phase = ((prevAction.time % prevDuration) + prevDuration) % prevDuration;
        target.time = (phase / prevDuration) * targetDuration;
      }
    }
    catObject.locomotionLastTargetKey = targetKey;
    catObject.activeClipAction = target;

    const requestedScale = Number.isFinite(catObject.locomotion?.clipScale) ? catObject.locomotion.clipScale : 0;
    const gaitNorm = THREE.MathUtils.clamp(speedNorm, 0, 1.7);
    const desiredScale = requestedScale > 1e-3 ? requestedScale : THREE.MathUtils.clamp(0.2 + gaitNorm * 1.05, 0.2, 1.45);
    catObject.clipWalkScale = THREE.MathUtils.damp(
      Number.isFinite(catObject.clipWalkScale) ? catObject.clipWalkScale : 0,
      target === idleAction ? 0 : desiredScale,
      target === idleAction ? 18 : 14,
      Math.max(dt, 0)
    );
    const activeScale = Math.max(0.01, catObject.clipWalkScale);

    const allActions = new Set([idleAction, walkAction, ...Object.values(locomotionActions), lingeringSpecialAction].filter(Boolean));
    for (const action of allActions) {
      const actionKey = keyMap.get(action) || (action === idleAction ? "idle" : "walkF");
      const targetWeight = action === target ? 1 : 0;
      const trackedWeight = locomotionWeights.get(action);
      const currentWeight = Number.isFinite(trackedWeight)
        ? trackedWeight
        : action.getEffectiveWeight();
      let weightRate = targetWeight > currentWeight ? 13 : 18;
      if (isTurnKey(targetKey)) {
        // Snap turn blend a bit faster so walk/turn overlap does not look like foot skating.
        if (actionKey === targetKey) {
          weightRate = targetWeight > currentWeight ? 24 : 20;
        } else {
          weightRate = targetWeight > currentWeight ? 16 : 24;
        }
      }
      let nextWeight = THREE.MathUtils.damp(currentWeight, targetWeight, weightRate, Math.max(dt, 0));
      if (Math.abs(nextWeight - targetWeight) < 1e-3) nextWeight = targetWeight;
      locomotionWeights.set(action, nextWeight);

      action.enabled = true;
      action.play();
      action.setEffectiveWeight(nextWeight);

      if (actionKey === "idle") {
        action.setEffectiveTimeScale(1.0);
      } else {
        const isActiveTurn = isTurnKey(actionKey) && actionKey === targetKey;
        const runScale = isActiveTurn ? Math.max(0.7, Math.min(activeScale, 1.8)) : activeScale;
        if (isTurnKey(actionKey) && actionKey !== targetKey && nextWeight < 0.015) {
          action.setEffectiveTimeScale(0);
        } else {
          action.setEffectiveTimeScale(Math.max(0.01, runScale));
        }
      }
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
