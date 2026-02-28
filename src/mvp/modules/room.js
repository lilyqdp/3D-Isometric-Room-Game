import * as THREE from "three";

export function makeRoomCorner(scene) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.2, 10),
    new THREE.MeshStandardMaterial({ color: 0xbcc3ce, roughness: 0.95 })
  );
  floor.position.set(-1, -0.1, -1);
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x7f8690, roughness: 0.98 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(14, 4.2, 0.2), wallMat);
  backWall.position.set(-1, 2.0, -6);
  scene.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.2, 10), wallMat);
  leftWall.position.set(-8, 2.0, -1);
  scene.add(leftWall);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x6f7680, roughness: 0.86 });
  const backTrim = new THREE.Mesh(new THREE.BoxGeometry(14, 0.14, 0.14), trimMat);
  backTrim.position.set(-1, 0.07, -5.88);
  scene.add(backTrim);

  const leftTrim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 10), trimMat);
  leftTrim.position.set(-7.88, 0.07, -1);
  scene.add(leftTrim);
}

export function makeDesk(scene, desk) {
  const topMat = new THREE.MeshStandardMaterial({ color: 0x5f5347, roughness: 0.76 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x433a33, roughness: 0.8 });

  const top = new THREE.Mesh(new THREE.BoxGeometry(desk.sizeX, 0.12, desk.sizeZ), topMat);
  top.position.set(desk.pos.x, 1.02, desk.pos.z);
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
