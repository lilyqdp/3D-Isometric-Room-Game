import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// --------------------
// Renderer / Scene
// --------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2efe9);

// --------------------
// Orthographic Camera (isometric look)
// --------------------
const frustumSize = 35;
let aspect = window.innerWidth / window.innerHeight;

const camera = new THREE.OrthographicCamera(
  (frustumSize * aspect) / -2,
  (frustumSize * aspect) / 2,
  frustumSize / 2,
  frustumSize / -2,
  0.01,
  2000
);

// Locked isometric-ish camera position
camera.position.set(25, 25, 25);
camera.lookAt(0, 3, 0);

// --------------------
// Lighting
// --------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.9));

const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(20, 30, 15);
scene.add(sun);

// --------------------
// Controls (Pan + Zoom only, no rotate)
// This prevents "walls disappearing" when swiping.
// --------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

controls.enableRotate = false; // ✅ lock rotation so the cutaway never reveals
controls.enablePan = true;
controls.enableZoom = true;

// Mouse mapping: right drag pan, scroll zoom
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,      // left drag pans (feel free to change)
  MIDDLE: THREE.MOUSE.DOLLY,  // scroll/drag zoom
  RIGHT: THREE.MOUSE.PAN,
};

// Zoom limits for ortho
controls.minZoom = 0.7;
controls.maxZoom = 8;

// Starting focus point (center-ish)
controls.target.set(0, 3, 0);
camera.zoom = 1.1;
camera.updateProjectionMatrix();
controls.update();

// Clamp panning so you can't drag view away into nothing
const TARGET_BOUNDS = {
  minX: -6,
  maxX: 6,
  minZ: -6,
  maxZ: 6,
  minY: 0.5,
  maxY: 6,
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// --------------------
// Load room model (scaled down)
// --------------------
const loader = new GLTFLoader();

let roomRoot = null;

loader.load(
  "/models/room.glb",
  (gltf) => {
    roomRoot = gltf.scene;

    // ✅ SCALE FIX: Sketchfab scenes are often huge
    // Try 0.25 first. If still big: 0.15. If too small: 0.35.
    roomRoot.scale.set(0.05, 0.05, 0.05);

    // Keep it on the ground
    roomRoot.position.set(0, 0, 0);

    scene.add(roomRoot);
  },
  undefined,
  (err) => console.error("Error loading /models/room.glb", err)
);

// --------------------
// Trash: stylized crumpled paper
// --------------------
const trashItems = [];

function addTrash(x, y, z) {
  const geo = new THREE.IcosahedronGeometry(0.35, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.9,
    metalness: 0.0,
  });

  const trash = new THREE.Mesh(geo, mat);
  trash.position.set(x, y, z);
  trash.rotation.y = Math.random() * Math.PI;

  trash.userData.isTrash = true;

  scene.add(trash);
  trashItems.push(trash);

  return trash;
}

// Place one trash item (adjust as needed)
addTrash(1.0, 0.35, 0.5);

// Tiny idle animation
let t = 0;

// --------------------
// Clicking (Raycaster) — remove trash
// --------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

  raycaster.setFromCamera(mouse, camera);

  const hits = raycaster.intersectObjects(trashItems, true);
  if (hits.length === 0) return;

  const clicked = hits[0].object;

  // In this simple case, clicked is the trash mesh itself
  scene.remove(clicked);

  const idx = trashItems.indexOf(clicked);
  if (idx !== -1) trashItems.splice(idx, 1);

  clicked.geometry.dispose();
  clicked.material.dispose();

  console.log("Trash removed!");
}

window.addEventListener("click", onClick);

// --------------------
// Resize
// --------------------
window.addEventListener("resize", () => {
  aspect = window.innerWidth / window.innerHeight;

  camera.left = (frustumSize * aspect) / -2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = frustumSize / -2;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// --------------------
// Render loop
// --------------------
function animate() {
  controls.update();

  // Clamp pan target so it stays over the room
  controls.target.x = clamp(controls.target.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
  controls.target.y = clamp(controls.target.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);
  controls.target.z = clamp(controls.target.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);

  // Animate trash if still there
  t += 0.02;
  for (const tr of trashItems) {
    tr.position.y = 0.35 + Math.sin(t) * 0.02;
    tr.rotation.y += 0.01;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
