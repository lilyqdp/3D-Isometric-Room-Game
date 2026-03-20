import * as THREE from "three";

export function makeRoomCorner(scene, options = {}) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.2, 10),
    new THREE.MeshStandardMaterial({ color: 0xbcc3ce, roughness: 0.95 })
  );
  floor.position.set(-1, -0.1, -1);
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x7f8690, roughness: 0.98 });
  const wallCenterX = -1;
  const wallCenterY = 2.0;
  const wallCenterZ = -6;
  const wallWidth = 14;
  const wallHeight = 4.2;
  const wallThickness = 0.2;
  const wallMinX = wallCenterX - wallWidth * 0.5;
  const wallMaxX = wallCenterX + wallWidth * 0.5;
  const wallMinY = wallCenterY - wallHeight * 0.5;
  const wallMaxY = wallCenterY + wallHeight * 0.5;

  const addBackWallPiece = (minX, maxX, minY, maxY) => {
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0.02 || h <= 0.02) return;
    const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallThickness), wallMat);
    piece.position.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, wallCenterZ);
    scene.add(piece);
  };

  const opening = options?.windowOpening;
  if (opening) {
    const halfW = Math.max(0.1, Number(opening.width) * 0.5);
    const halfH = Math.max(0.1, Number(opening.height) * 0.5);
    const rawCenterX = Number(opening.centerX);
    const rawCenterY = Number(opening.centerY);
    const ox = THREE.MathUtils.clamp(
      Number.isFinite(rawCenterX) ? rawCenterX : wallCenterX,
      wallMinX + halfW,
      wallMaxX - halfW
    );
    const oy = THREE.MathUtils.clamp(
      Number.isFinite(rawCenterY) ? rawCenterY : wallCenterY,
      wallMinY + halfH,
      wallMaxY - halfH
    );
    const openMinX = ox - halfW;
    const openMaxX = ox + halfW;
    const openMinY = oy - halfH;
    const openMaxY = oy + halfH;

    // Build the back wall as 4 pieces around the window hole.
    addBackWallPiece(wallMinX, openMinX, wallMinY, wallMaxY); // left
    addBackWallPiece(openMaxX, wallMaxX, wallMinY, wallMaxY); // right
    addBackWallPiece(openMinX, openMaxX, wallMinY, openMinY); // bottom
    addBackWallPiece(openMinX, openMaxX, openMaxY, wallMaxY); // top

    // Window reveal so the wall opening has visible depth.
    const revealMat = new THREE.MeshStandardMaterial({ color: 0x6f7680, roughness: 0.86 });
    const revealT = 0.03;
    const revealLeft = new THREE.Mesh(new THREE.BoxGeometry(revealT, openMaxY - openMinY, wallThickness), revealMat);
    revealLeft.position.set(openMinX + revealT * 0.5, (openMinY + openMaxY) * 0.5, wallCenterZ);
    scene.add(revealLeft);

    const revealRight = new THREE.Mesh(new THREE.BoxGeometry(revealT, openMaxY - openMinY, wallThickness), revealMat);
    revealRight.position.set(openMaxX - revealT * 0.5, (openMinY + openMaxY) * 0.5, wallCenterZ);
    scene.add(revealRight);

    const revealTop = new THREE.Mesh(new THREE.BoxGeometry(openMaxX - openMinX, revealT, wallThickness), revealMat);
    revealTop.position.set((openMinX + openMaxX) * 0.5, openMaxY - revealT * 0.5, wallCenterZ);
    scene.add(revealTop);

    const revealBottom = new THREE.Mesh(new THREE.BoxGeometry(openMaxX - openMinX, revealT, wallThickness), revealMat);
    revealBottom.position.set((openMinX + openMaxX) * 0.5, openMinY + revealT * 0.5, wallCenterZ);
    scene.add(revealBottom);
  } else {
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(wallWidth, wallHeight, wallThickness), wallMat);
    backWall.position.set(wallCenterX, wallCenterY, wallCenterZ);
    scene.add(backWall);
  }

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.2, 10), wallMat);
  leftWall.position.set(-8, 2.0, -1);
  scene.add(leftWall);
}

export function makeDesk(scene, desk) {
  const topMat = new THREE.MeshStandardMaterial({ color: 0x5f5347, roughness: 0.76 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x433a33, roughness: 0.8 });

  const top = new THREE.Mesh(new THREE.BoxGeometry(desk.sizeX, 0.12, desk.sizeZ), topMat);
  top.position.set(desk.pos.x, 1.02, desk.pos.z);
  top.userData.catSurface = {
    id: "desk",
    y: desk.topY + 0.02,
    minX: desk.pos.x - desk.sizeX * 0.5,
    maxX: desk.pos.x + desk.sizeX * 0.5,
    minZ: desk.pos.z - desk.sizeZ * 0.5,
    maxZ: desk.pos.z + desk.sizeZ * 0.5,
  };
  scene.add(top);

  const legGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  const legOffsets = [
    [-1.45, -0.8],
    [1.45, -0.8],
    [-1.45, 0.8],
    [1.45, 0.8],
  ];
  for (const [dx, dz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(desk.pos.x + dx, 0.5, desk.pos.z + dz);
    scene.add(leg);
  }
}

export function makeChair(scene, chair) {
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x544a41, roughness: 0.82 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x39332d, roughness: 0.84 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x4c433b, roughness: 0.8 });

  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(chair.sizeX, chair.seatThickness, chair.sizeZ),
    seatMat
  );
  seat.position.set(chair.pos.x, chair.seatY - chair.seatThickness * 0.5, chair.pos.z);
  seat.userData.catSurface = {
    id: "chair",
    y: chair.seatY + 0.02,
    minX: chair.pos.x - chair.sizeX * 0.5,
    maxX: chair.pos.x + chair.sizeX * 0.5,
    minZ: chair.pos.z - chair.sizeZ * 0.5,
    maxZ: chair.pos.z + chair.sizeZ * 0.5,
  };
  scene.add(seat);

  const legHeight = Math.max(0.12, chair.seatY - chair.seatThickness);
  const legGeo = new THREE.BoxGeometry(chair.legHalfX * 2, legHeight, chair.legHalfZ * 2);
  const legOffsets = [
    [-chair.legInsetX, -chair.legInsetZ],
    [chair.legInsetX, -chair.legInsetZ],
    [-chair.legInsetX, chair.legInsetZ],
    [chair.legInsetX, chair.legInsetZ],
  ];
  for (const [dx, dz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(chair.pos.x + dx, legHeight * 0.5, chair.pos.z + dz);
    scene.add(leg);
  }

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(chair.sizeX, chair.backHeight, chair.backThickness),
    backMat
  );
  back.position.set(
    chair.pos.x,
    chair.seatY + chair.backHeight * 0.5 - chair.seatThickness * 0.5,
    chair.pos.z - chair.sizeZ * 0.5 + chair.backThickness * 0.5
  );
  scene.add(back);
}

export function makeShelf(scene, shelf) {
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a4f59, roughness: 0.84 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x656c78, roughness: 0.78 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x57606d, roughness: 0.86 });

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(shelf.width, shelf.boardThickness, shelf.depth),
    boardMat
  );
  board.position.set(shelf.pos.x, shelf.surfaceY - shelf.boardThickness * 0.5, shelf.pos.z);
  board.userData.catSurface = {
    id: "shelf",
    y: shelf.surfaceY + 0.02,
    minX: shelf.pos.x - shelf.width * 0.5,
    maxX: shelf.pos.x + shelf.width * 0.5,
    minZ: shelf.pos.z - shelf.depth * 0.5,
    maxZ: shelf.pos.z + shelf.depth * 0.5,
  };
  scene.add(board);

  const postHeight = Math.max(0.3, shelf.surfaceY - shelf.boardThickness);
  const postGeo = new THREE.BoxGeometry(shelf.postHalf * 2, postHeight, shelf.postHalf * 2);
  const postInsetX = shelf.width * 0.5 - shelf.postHalf;
  const postInsetZ = shelf.depth * 0.5 - shelf.postHalf;
  const postOffsets = [
    [-postInsetX, -postInsetZ],
    [postInsetX, -postInsetZ],
    [-postInsetX, postInsetZ],
    [postInsetX, postInsetZ],
  ];
  for (const [dx, dz] of postOffsets) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(shelf.pos.x + dx, postHeight * 0.5, shelf.pos.z + dz);
    scene.add(post);
  }

  const backPanel = new THREE.Mesh(
    new THREE.BoxGeometry(shelf.width, shelf.surfaceY - 0.2 + 0.08, 0.04),
    backMat
  );
  backPanel.position.set(
    shelf.pos.x,
    (shelf.surfaceY + 0.2) * 0.5 - shelf.boardThickness * 0.5,
    shelf.pos.z - shelf.depth * 0.5 + 0.02
  );
  scene.add(backPanel);
}

export function makePlatform(scene, platform) {
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x6a7280, roughness: 0.78 });
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(platform.width, platform.thickness, platform.depth),
    boardMat
  );
  board.position.set(
    platform.pos.x,
    platform.surfaceY - platform.thickness * 0.5,
    platform.pos.z
  );
  board.userData.catSurface = {
    id: platform.id || "platform",
    y: platform.surfaceY + 0.02,
    minX: platform.pos.x - platform.width * 0.5,
    maxX: platform.pos.x + platform.width * 0.5,
    minZ: platform.pos.z - platform.depth * 0.5,
    maxZ: platform.pos.z + platform.depth * 0.5,
  };
  scene.add(board);
}

export function makeHoverShelf(scene, hoverShelf) {
  makePlatform(scene, hoverShelf);
}

export function makeWindowSill(scene, windowSill) {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x636d7b, roughness: 0.64, metalness: 0.05 });
  const sillMat = new THREE.MeshStandardMaterial({ color: 0x767f8c, roughness: 0.62, metalness: 0.03 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xf1f2f4,
    roughness: 0.05,
    metalness: 0.04,
    transparent: true,
    opacity: 0.2,
  });

  const root = new THREE.Group();
  root.position.set(windowSill.pos.x, 0, windowSill.pos.z);

  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(windowSill.width, windowSill.thickness, windowSill.depth),
    sillMat
  );
  sill.position.set(0, windowSill.surfaceY - windowSill.thickness * 0.5, 0);
  sill.userData.catSurface = {
    id: windowSill.id || "windowSill",
    y: windowSill.surfaceY + 0.02,
    minX: windowSill.pos.x - windowSill.width * 0.5,
    maxX: windowSill.pos.x + windowSill.width * 0.5,
    minZ: windowSill.pos.z - windowSill.depth * 0.5,
    maxZ: windowSill.pos.z + windowSill.depth * 0.5,
  };
  root.add(sill);

  const openingW = windowSill.windowWidth;
  const openingH = windowSill.windowHeight;
  const frameT = 0.055;
  const frameDepth = 0.1;
  const frameY = windowSill.openingCenterY;
  const frameZ = (windowSill.wallZ - windowSill.pos.z) + frameDepth * 0.5;

  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(openingW + frameT * 2, frameT, frameDepth), frameMat);
  frameTop.position.set(0, frameY + openingH * 0.5 + frameT * 0.5, frameZ);
  root.add(frameTop);

  const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(openingW + frameT * 2, frameT, frameDepth), frameMat);
  frameBottom.position.set(0, frameY - openingH * 0.5 - frameT * 0.5, frameZ);
  root.add(frameBottom);

  const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(frameT, openingH, frameDepth), frameMat);
  frameLeft.position.set(-openingW * 0.5 - frameT * 0.5, frameY, frameZ);
  root.add(frameLeft);

  const frameRight = new THREE.Mesh(new THREE.BoxGeometry(frameT, openingH, frameDepth), frameMat);
  frameRight.position.set(openingW * 0.5 + frameT * 0.5, frameY, frameZ);
  root.add(frameRight);

  // Sliding sash pane: opening the window moves the pane upward.
  const paneWidth = openingW * 0.92;
  const paneHeight = openingH * 0.9;
  const paneDepth = frameT * 0.45;
  const paneBaseY = frameY;
  const paneZ = frameZ + 0.012;
  const paneOpenLift = openingH * 0.78;

  const pane = new THREE.Mesh(
    new THREE.BoxGeometry(paneWidth, paneHeight, paneDepth),
    glassMat
  );
  pane.position.set(0, paneBaseY, paneZ);
  root.add(pane);

  // Bottom sash rail (the visible line is at the bottom of the glass, not center).
  const bottomRailHeight = frameT * 0.95;
  const bottomRailZ = frameZ + 0.016;
  const bottomRailBaseY = paneBaseY - paneHeight * 0.5 + bottomRailHeight * 0.5;
  const bottomRail = new THREE.Mesh(
    new THREE.BoxGeometry(paneWidth, bottomRailHeight, frameT * 0.62),
    frameMat
  );
  bottomRail.position.set(0, bottomRailBaseY, bottomRailZ);
  root.add(bottomRail);

  const sillLip = new THREE.Mesh(
    new THREE.BoxGeometry(windowSill.width + 0.08, 0.04, 0.08),
    frameMat
  );
  // Keep the sill crease toward the wall/window side rather than room-facing edge.
  sillLip.position.set(0, windowSill.surfaceY + 0.015, -windowSill.depth * 0.5 - 0.02);
  root.add(sillLip);

  root.userData.windowSill = {
    pane,
    bottomRail,
    paneBaseY,
    bottomRailBaseY,
    paneOpenLift,
  };
  root.userData.openAmount = 0;
  scene.add(root);

  function setOpenAmount(value) {
    const t = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
    root.userData.openAmount = t;
    const data = root.userData.windowSill;
    const dy = data.paneOpenLift * t;
    data.pane.position.y = data.paneBaseY + dy;
    data.bottomRail.position.y = data.bottomRailBaseY + dy;
  }

  setOpenAmount(0);
  return {
    root,
    sill,
    setOpenAmount,
  };
}

function loadTrashCanModel({ trashGroup, fallbackMeshes, gltfLoader, modelCandidates, trashCan }) {
  const tryLoad = (idx) => {
    if (idx >= modelCandidates.length) {
      console.warn("Failed to load trash can model from all paths:", modelCandidates);
      return;
    }

    const url = modelCandidates[idx];
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

        const box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) return;
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const targetWidth = trashCan.outerRadius * 2 * trashCan.modelWidthScale;
        const targetHeight = trashCan.rimY + 0.06;
        const sx = targetWidth / Math.max(size.x, 1e-3);
        const sy = targetHeight / Math.max(size.y, 1e-3);
        const sz = targetWidth / Math.max(size.z, 1e-3);
        const s = Math.min(sx, sy, sz);

        model.scale.setScalar(s);
        box.setFromObject(model);
        box.getCenter(center);
        const minY = box.min.y;
        model.position.set(-center.x, -minY, -center.z);
        model.renderOrder = 1;

        for (const m of fallbackMeshes) m.visible = false;
        trashGroup.add(model);
      },
      undefined,
      (error) => {
        console.warn("Failed to load trash can model path:", url, error);
        tryLoad(idx + 1);
      }
    );
  };

  tryLoad(0);
}

export function makeBins({
  scene,
  hamper,
  trashCan,
  binVisuals,
  gltfLoader,
  trashCanModelCandidates,
}) {
  // Hamper: open basket + visible laundry so it's clearly the laundry bin.
  const hamperWallMat = new THREE.MeshStandardMaterial({ color: 0x5b9bd2, roughness: 0.84 });
  const hamperTrimMat = new THREE.MeshStandardMaterial({ color: 0xd5ecff, roughness: 0.56 });
  const hamperClothMat = new THREE.MeshStandardMaterial({ color: 0xe8eff8, roughness: 0.95 });

  const hamperGroup = new THREE.Group();
  hamperGroup.position.set(hamper.pos.x, 0, hamper.pos.z);

  const wallThick = 0.06;
  const wallH = 0.88;
  const xSpan = hamper.outerHalfX * 2;
  const zSpan = hamper.outerHalfZ * 2;
  const walls = [
    new THREE.Mesh(new THREE.BoxGeometry(xSpan, wallH, wallThick), hamperWallMat),
    new THREE.Mesh(new THREE.BoxGeometry(xSpan, wallH, wallThick), hamperWallMat),
    new THREE.Mesh(new THREE.BoxGeometry(wallThick, wallH, zSpan), hamperWallMat),
    new THREE.Mesh(new THREE.BoxGeometry(wallThick, wallH, zSpan), hamperWallMat),
  ];
  walls[0].position.set(0, wallH * 0.5, hamper.outerHalfZ);
  walls[1].position.set(0, wallH * 0.5, -hamper.outerHalfZ);
  walls[2].position.set(hamper.outerHalfX, wallH * 0.5, 0);
  walls[3].position.set(-hamper.outerHalfX, wallH * 0.5, 0);
  for (const w of walls) hamperGroup.add(w);

  const rimBars = [
    new THREE.Mesh(new THREE.BoxGeometry(xSpan + 0.08, 0.05, 0.05), hamperTrimMat),
    new THREE.Mesh(new THREE.BoxGeometry(xSpan + 0.08, 0.05, 0.05), hamperTrimMat),
    new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zSpan + 0.08), hamperTrimMat),
    new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zSpan + 0.08), hamperTrimMat),
  ];
  rimBars[0].position.set(0, hamper.rimY, hamper.outerHalfZ + 0.02);
  rimBars[1].position.set(0, hamper.rimY, -hamper.outerHalfZ - 0.02);
  rimBars[2].position.set(hamper.outerHalfX + 0.02, hamper.rimY, 0);
  rimBars[3].position.set(-hamper.outerHalfX - 0.02, hamper.rimY, 0);
  for (const bar of rimBars) hamperGroup.add(bar);

  for (let i = -1; i <= 1; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.03), hamperTrimMat);
    vent.position.set(i * 0.2, 0.28, hamper.outerHalfZ + 0.04);
    hamperGroup.add(vent);
  }

  const hamperInside = new THREE.Mesh(
    new THREE.BoxGeometry(xSpan - 0.08, 0.48, zSpan - 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8ea6b9, roughness: 0.98, side: THREE.BackSide })
  );
  hamperInside.position.set(0, 0.29, 0);
  hamperGroup.add(hamperInside);

  const laundryA = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.13, 0.4), hamperClothMat);
  laundryA.position.set(-0.04, 0.56, 0.02);
  laundryA.rotation.z = -0.14;
  hamperGroup.add(laundryA);
  const laundryB = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.3), hamperClothMat);
  laundryB.position.set(0.09, 0.62, -0.04);
  laundryB.rotation.z = 0.11;
  laundryB.rotation.x = 0.08;
  hamperGroup.add(laundryB);

  const hamperRing = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.43, 30),
    new THREE.MeshBasicMaterial({ color: 0x77c9ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide })
  );
  hamperRing.rotation.x = -Math.PI / 2;
  hamperRing.position.set(0, hamper.rimY + 0.03, 0);
  hamperGroup.add(hamperRing);

  scene.add(hamperGroup);
  binVisuals.hamper.shells = walls.concat(rimBars);
  binVisuals.hamper.ring = hamperRing;

  // Trash can with visible opening.
  const trashShellMat = new THREE.MeshStandardMaterial({
    color: 0x5b646f,
    roughness: 0.7,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const trashRimMat = new THREE.MeshStandardMaterial({ color: 0xb5bec7, roughness: 0.62 });
  const trashInsideMat = new THREE.MeshStandardMaterial({ color: 0x2f333b, roughness: 1.0 });

  const trashGroup = new THREE.Group();
  trashGroup.position.set(trashCan.pos.x, 0, trashCan.pos.z);
  const trashBodyHeight = trashCan.rimY + 0.08;
  const trashInsideHeight = Math.max(0.36, trashCan.rimY - 0.12);

  const trashBody = new THREE.Mesh(
    new THREE.CylinderGeometry(
      trashCan.outerRadius,
      trashCan.outerRadius - 0.08,
      trashBodyHeight,
      30,
      1,
      true
    ),
    trashShellMat
  );
  trashBody.position.y = trashBodyHeight * 0.5;
  trashGroup.add(trashBody);

  const trashBottom = new THREE.Mesh(
    new THREE.CircleGeometry(trashCan.outerRadius - 0.1, 28),
    new THREE.MeshStandardMaterial({ color: 0x3b434d, roughness: 0.9 })
  );
  trashBottom.rotation.x = -Math.PI / 2;
  trashBottom.position.y = 0.01;
  trashGroup.add(trashBottom);

  const trashRim = new THREE.Mesh(
    new THREE.TorusGeometry(trashCan.outerRadius + 0.03, 0.02, 12, 32),
    trashRimMat
  );
  trashRim.rotation.x = Math.PI / 2;
  trashRim.position.y = trashCan.rimY + 0.012;
  trashGroup.add(trashRim);

  const trashInside = new THREE.Mesh(
    new THREE.CylinderGeometry(
      trashCan.openingRadius - 0.03,
      trashCan.openingRadius - 0.08,
      trashInsideHeight,
      24,
      1,
      true
    ),
    trashInsideMat
  );
  trashInside.position.y = trashInsideHeight * 0.5 + 0.03;
  trashGroup.add(trashInside);

  const trashRing = new THREE.Mesh(
    new THREE.RingGeometry(trashCan.openingRadius - 0.07, trashCan.openingRadius + 0.09, 30),
    new THREE.MeshBasicMaterial({ color: 0xffd3a9, transparent: true, opacity: 0.0, side: THREE.DoubleSide })
  );
  trashRing.rotation.x = -Math.PI / 2;
  trashRing.position.set(0, trashCan.rimY + 0.035, 0);
  trashGroup.add(trashRing);

  const trashFallbackMeshes = [trashBody, trashBottom, trashRim, trashInside];
  loadTrashCanModel({
    trashGroup,
    fallbackMeshes: trashFallbackMeshes,
    gltfLoader,
    modelCandidates: trashCanModelCandidates,
    trashCan,
  });

  scene.add(trashGroup);
  binVisuals.trash.shells = [trashBody, trashRim];
  binVisuals.trash.ring = trashRing;
}
