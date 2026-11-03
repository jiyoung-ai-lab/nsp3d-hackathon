// NSP 3D — app.js (reference pipeline core + NSP UI shell: views, i18n, mobile, benches)
// Data flow: eyeCamera pixels -> decoder signal -> sense/brain -> rule/network -> movement.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolvePaths, WORLD, CAMERA_PIPELINE, NSP3D_VERSION, dateSeed } from '../config.js';
import { createCameraVisionDecoder, DECODER_BUILD } from '../vision/camera-vision.js';
import { createFlightConnectome, mergeFlightGraphs, SNN_BUILD } from '../nn/graph-network.js';
import { senseVision, createCameraRuleController, CONTROLLER_BUILD } from '../sim/camera-controller.js';
import { decayTouch, isStalled } from '../sim/flight-physics.js';
import { consumeSteps, SIM_STEP_H } from '../sim/step-clock.js';
import { listMazes, getMaze } from '../sim/maze-layouts.js';
import {
  W, Y, Z, BEE_RADIUS, clamp, dist, initialYawFor, makeWorld, advanceWorld,
  buildStaticScene, buildObstacleMesh, clearWorld, setSceneWallTransparency,
  EyeRig, createFlightState, movement,
} from '../sim/sim-core.js';
import { createBee } from './hand-drawn-bee.js';
import { createPumpkin } from './hand-drawn-pumpkin.js';
import { createCuteFly } from './cute-fly.js';
import { createHoneybee2 } from './honeybee2.js';
import { createSubjectPreview } from './subject-preview.js';
import { SUBJECTS, getSubject, DEFAULT_SUBJECT_ID } from './subjects.js';
import { t, initLang, setLang } from './i18n.js';
import { recFilename, recElapsed, recCapped } from './rec-filename.js';
import { saveArtifact } from '../store/nsp-store.js';

const $ = (id) => document.getElementById(id);
const errBox = $('errOverlay');
window.addEventListener('error', (e) => {
  errBox.style.display = 'block';
  errBox.textContent = t('errFmt')(e.message || e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  errBox.style.display = 'block';
  errBox.textContent = t('errFmt')(e.reason && e.reason.message ? e.reason.message : e.reason);
});

const S = {
  mazeId: 'corridor', visionMode: 'monocular', sensor: 'fog_rgb',
  neuronModel: 'lif_baseline', controller: 'neurons', learning: false, moving: true, resetCircuit: false,
  pCrash: 1.5, lighting: 'default', seed: dateSeed(), maxTime: 120,
  cruise: 0.12, visionGain: 1.0, learnRate: 0.012,
  running: false, outcome: null, lastEp: null, pathLen: 0,
  lastBrain: null, lastDecision: null, lastClimb: 0, lastTurn: 0,
  touch: null, rule: null,
  view: 'overview', shuffleSeed: 0, noHazards: true,
  benchRows: null, trailOn: true, shadowOn: true, fps: 0, speed: 1,
};
// LEARN-OFF 2026-10-30: learning weights disabled stage-wide (revert: true + unhide index.html rows).
const LEARNING_ENABLED = false;
S.rule = createCameraRuleController();
// Central canvas font strings (integer px; single edit point for canvas text).
const UI_FONT = {
  feedMajor: 'bold 10px ui-monospace,monospace',
  feedMinor: 'bold 9px ui-monospace,monospace',
  graph: '11px sans-serif',
};
let loadedGraph = null, network = null;
let obstacles = [], start = { x: 0, y: WORLD.Y / 3, z: -.40 }, goal = { x: 0, y: .02, z: .40 };
let fly = createFlightState(start, goal);
let latestVision = {
  visionMode: 'monocular', sensorType: 'fog_rgb',
  leftThreat: 0, rightThreat: 0, frontThreat: 0, upThreat: 0, downThreat: 0,
  loomingL: 0, loomingR: 0, motionL: 0, motionR: 0, escapeDirection: 1,
  grid: Array(9).fill(0), upperRoute: 0, lowerRoute: 0, centerObstacle: 0,
  goalPixels: 0, goalVisible: 0, goalLockX: 0, goalLockY: 0,
};

// ---------- renderer / scene ----------
const glCanvas = document.createElement('canvas');
glCanvas.className = 'webgl';
$('scene').appendChild(glCanvas);
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const H = buildStaticScene();
const scene = H.scene, mainCam = H.observerCamera;
scene.background = new THREE.Color(0x060914);
H.groundShadow.visible = false; // our height-scaled blob is used instead
let bee = createBee(THREE, { wingScale: 0.83 });
bee.traverse((o) => o.layers.set(1));
const beeHeadLight = new THREE.PointLight(0x38bdf8, 0, 0.42, 1.6);
beeHeadLight.position.set(0, 0.012, -0.015);
bee.add(beeHeadLight);
scene.add(bee);
const rig = new EyeRig(renderer, H, bee, H.goalGroup);
// ---------- experiment-subject swap (custom <-> honeybee2) ----------
const gltfLoader = new GLTFLoader();
const beeCache = { custom: bee };
let beeSubjectId = DEFAULT_SUBJECT_ID, beeLoadPromise = null;
function applyPanelStateToBee() {
  applyPanelStateTo(bee?.userData);
  const def = getSubject(beeSubjectId); // per-subject color defaults win over panel (bee-tuned) values
  if (def?.bodyTint && bee?.userData?.bodyMaterial) bee.userData.bodyMaterial.color.set(def.bodyTint);
  if (def?.depthDefault != null && bee?.userData?.setColorDepth) bee.userData.setColorDepth(def.depthDefault);
}
function applyPanelStateTo(u) {
  if (!u) return;
  if (u.setWingScale) u.setWingScale(Number($('wingScale')?.value) || 0.83);
  const poseBtn = document.querySelector('.bee-pose-btn.active');
  if (u.setWingPose) u.setWingPose(poseBtn?.dataset.pose || 'idle', Number($('wingAngle')?.value || 35));
  if (u.setFlapSpeed) u.setFlapSpeed(Number($('flapSpeed')?.value ?? 1));
  if (u.setColorDepth) u.setColorDepth(Number($('colorDepth')?.value ?? 1));
  if (u.bodyMaterial && $('beeColor')) u.bodyMaterial.color.set($('beeColor').value);
  if (u.wingMaterial && $('wingOpacity')) u.wingMaterial.opacity = Number($('wingOpacity').value) / 100;
  if (u.setSubWingsVisible) u.setSubWingsVisible($('subWings')?.checked ?? true);
  if (u.setBlackEyeLock) u.setBlackEyeLock($('beeBlackEyeBtn')?.classList.contains('active') ?? false);
}
function swapBee(next) {
  if (!next || next === bee) return;
  const parent = bee.parent;
  if (beeHeadLight.parent) beeHeadLight.parent.remove(beeHeadLight);
  next.traverse((o) => o.layers.set(1)); // layer 1: observer-only, hidden from eye capture
  next.add(beeHeadLight); // after traverse: headlight keeps layer 0 like initial setup
  if (parent) {
    parent.remove(bee);
    next.position.copy(bee.position);
    next.rotation.copy(bee.rotation);
    parent.add(next);
  }
  bee = next;
  rig.setAgent(next);
}
async function setBeeSubject(id) {
  const target = getSubject(id) ? id : DEFAULT_SUBJECT_ID;
  if (beeCache[target]) {
    beeSubjectId = target;
    swapBee(beeCache[target]);
    applyPanelStateToBee();
    previewShow(target);
    syncSubjectSelects(target);
    return;
  }
  if (beeLoadPromise) { syncSubjectSelects(beeSubjectId); return; }
  const def = getSubject(target);
  if (def.kind === 'procedural') {
    const make = def.factory === 'pumpkin' ? createPumpkin : def.factory === 'cutefly' ? createCuteFly : createBee;
    const subjectRoot = make(THREE, { wingScale: Number($('wingScale')?.value) || 0.83 });
    beeCache[target] = subjectRoot;
    beeSubjectId = target;
    swapBee(subjectRoot);
    applyPanelStateToBee();
    previewShow(target);
    syncSubjectSelects(target);
    return;
  }
  if ($('beeSubjectPreview')) $('beeSubjectPreview').disabled = true;
  beeLoadPromise = createHoneybee2(THREE, gltfLoader, { asset: getSubject(target).asset, wingScale: Number($('wingScale')?.value) || 0.83 })
    .then((subjectRoot) => {
      beeCache[target] = subjectRoot;
      beeSubjectId = target;
      swapBee(subjectRoot);
      applyPanelStateToBee();
      previewShow(target);
      syncSubjectSelects(target);
    })
    .catch((err) => {
      console.error('[subject]', err);
      alert(t('subjectLoadFail'));
      syncSubjectSelects(beeSubjectId);
    })
    .finally(() => {
      beeLoadPromise = null;
      if ($('beeSubjectPreview')) $('beeSubjectPreview').disabled = false;
    });
  await beeLoadPromise;
}
// ---------- subject 3D preview (card next to the bee panel) ----------
let subjectPreview = null;
const previewCache = {};
async function getPreviewRoot(id) {
  if (previewCache[id]) return previewCache[id];
  const def = getSubject(id);
  if (!def) return null;
  const root = def.kind === 'glb'
    ? await createHoneybee2(THREE, gltfLoader, { asset: def.asset })
    : def.factory === 'pumpkin' ? createPumpkin(THREE, { wingScale: 0.83 }) : def.factory === 'cutefly' ? createCuteFly(THREE, { wingScale: 0.83 }) : createBee(THREE, { wingScale: 0.83 });
  previewCache[id] = root;
  return root;
}
async function previewShow(id) {
  if (!subjectPreview) return;
  try {
    const root = await getPreviewRoot(id);
    if (root && subjectPreview.subjectId !== id) subjectPreview.setSubject(id, root, getSubject(id)?.previewDist);
  } catch (e) { /* keep previous preview; main subject already reported the failure */ }
}
function syncBeePanel(open) {
  $('beePanel').hidden = !open;
  $('beePreview').hidden = !open;
  if (!subjectPreview && open) {
    subjectPreview = createSubjectPreview(THREE, $('beePreviewCanvas'));
    previewShow(beeSubjectId);
  }
  if (subjectPreview) subjectPreview.setVisible(open);
}
function buildSubjectOptions() {
  const sel = $('beeSubjectPreview');
  if (sel) {
    const cur = sel.value || beeSubjectId;
    sel.innerHTML = '';
    for (const s of SUBJECTS) {
      const op = document.createElement('option');
      op.value = s.id;
      op.textContent = t(s.nameKey);
      sel.appendChild(op);
    }
    sel.value = getSubject(cur) ? cur : DEFAULT_SUBJECT_ID;
  }
  syncSubjectSelects(sel?.value || beeSubjectId);
}
function syncSubjectSelects(id) {
  const sel = $('beeSubjectPreview');
  if (sel) sel.value = id;
  const def = getSubject(id) || getSubject(DEFAULT_SUBJECT_ID);
  const nm = $('beeSubjectName');
  if (nm && def) nm.textContent = t(def.nameKey);
}
const stream = []; // {vis, turn, climb}
globalThis.__nspDbg = {
  get camPos() { return camPos; },
  get camLook() { return camLook; },
  get fly() { return fly; }, S,
  get obstacles() { return obstacles; },
  get vision() { return latestVision; },
  get network() { return network; },
};

// trail (ring buffer, layer 2 observer-only)
const TRAIL_N = 600;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0x2fe36b }));
trail.frustumCulled = false;
trail.layers.set(2);
scene.add(trail);
let trailCount = 0;
// ground shadow blob (position indicator under the agent, Layer 2 main-only)
const shCv = document.createElement('canvas');
shCv.width = 64; shCv.height = 64;
{
  const sx = shCv.getContext('2d');
  const grd = sx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.4)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = grd;
  sx.fillRect(0, 0, 64, 64);
}
const shTex = new THREE.CanvasTexture(shCv);
const shadowBlob = new THREE.Mesh(
  new THREE.PlaneGeometry(0.05, 0.05),
  new THREE.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.5, depthWrite: false })
);
shadowBlob.rotation.x = -Math.PI / 2;
shadowBlob.position.y = 0.0015;
shadowBlob.layers.set(2);
scene.add(shadowBlob);
function trailPush(p) {
  if (!S.trailOn) return;
  if (trailCount < TRAIL_N) {
    trailPos[trailCount * 3] = p.x; trailPos[trailCount * 3 + 1] = p.y; trailPos[trailCount * 3 + 2] = p.z;
    trailCount++;
  } else {
    trailPos.copyWithin(0, 3);
    trailPos[(TRAIL_N - 1) * 3] = p.x; trailPos[(TRAIL_N - 1) * 3 + 1] = p.y; trailPos[(TRAIL_N - 1) * 3 + 2] = p.z;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.setDrawRange(0, trailCount);
}

// ---------- camera views (snap instantly on switch, then smooth-follow) ----------
const camPos = new THREE.Vector3(0.6, 0.6, 0.6);
const camLook = new THREE.Vector3(0, 0.08, 0);
const orbit = { th: 0.8, ph: 1.05, r: 1.35 };
const viewDist = { follow: 1, closeup: 1, top: 1, face: 1 };
function zoomBy(f) {
  if (S.view === 'overview') orbit.r = clamp(orbit.r * f, 0.5, 3);
  else viewDist[S.view] = clamp((viewDist[S.view] || 1) * f, 0.35, 2.5);
}
function zoomToAbs(v) {
  if (S.view === 'overview') orbit.r = clamp(v, 0.5, 3);
  else viewDist[S.view] = clamp(v, 0.35, 2.5);
}
function zoomBase() {
  return S.view === 'overview' ? orbit.r : viewDist[S.view] || 1;
}
function orbitUpdate() {
  mainCam.position.set(
    orbit.r * Math.sin(orbit.ph) * Math.sin(orbit.th),
    0.1 + orbit.r * Math.cos(orbit.ph),
    orbit.r * Math.sin(orbit.ph) * Math.cos(orbit.th)
  );
  mainCam.lookAt(0, 0.08, 0);
  camPos.copy(mainCam.position);
  camLook.set(0, 0.08, 0);
}
let dragging = false, px = 0, py = 0, pinchD0 = 0, pinchR0 = 0, pinching = false;
const panTop = { x: 0, z: 0 };
const orbBee = { th: 0, ph: 0 };
glCanvas.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; glCanvas.setPointerCapture(e.pointerId); });
glCanvas.addEventListener('pointermove', (e) => {
  if (!dragging || pinching) return;
  const dx = e.clientX - px, dy = e.clientY - py;
  px = e.clientX; py = e.clientY;
  if (S.view === 'overview') {
    orbit.th -= dx * 0.006;
    orbit.ph = clamp(orbit.ph - dy * 0.006, 0.15, 1.5);
  } else if (S.view === 'top') {
    const k = (viewDist.top || 1) * 0.0011;
    panTop.x = clamp(panTop.x - dx * k, -0.6, 0.6);
    panTop.z = clamp(panTop.z - dy * k, -0.6, 0.6);
  } else {
    orbBee.th -= dx * 0.005;
    orbBee.ph = clamp(orbBee.ph + dy * 0.003, -0.45, 0.45);
  }
});
glCanvas.addEventListener('pointerup', () => { dragging = false; });
glCanvas.addEventListener('pointercancel', () => { dragging = false; });
glCanvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(1 + e.deltaY * 0.001); }, { passive: false });
glCanvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    pinching = true;
    pinchD0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    pinchR0 = zoomBase();
  }
}, { passive: true });
glCanvas.addEventListener('touchmove', (e) => {
  if (pinching && e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchD0 > 0) zoomToAbs(pinchR0 * pinchD0 / Math.max(d, 1));
  }
}, { passive: true });
glCanvas.addEventListener('touchend', () => { pinching = false; });
function fitCanvas() {
  renderer.setSize(innerWidth, innerHeight, false);
  mainCam.aspect = innerWidth / innerHeight;
  mainCam.updateProjectionMatrix();
}
window.addEventListener('resize', fitCanvas);

function topFitHeight() {
  // Straight-down map height framing the whole 1m x 1m chamber (+10% margin).
  const halfE = 0.55;
  const t = Math.tan(THREE.MathUtils.degToRad(mainCam.fov / 2));
  return Math.max(halfE / t, halfE / (t * (mainCam.aspect || 1)));
}
function viewPose(v) {
  const p = fly.pos;
  const Fx = Math.sin(fly.yaw), Fz = -Math.cos(fly.yaw);
  const k = viewDist[v] || 1;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(p.x, p.y, p.z);
  if (v === 'follow') {
    const a = orbBee.th, ca = Math.cos(a), sa = Math.sin(a);
    const ox = -Fx * 0.45 * k, oz = -Fz * 0.45 * k;
    pos.set(p.x + ox * ca - oz * sa, p.y + (0.25 + orbBee.ph) * k, p.z + ox * sa + oz * ca);
  } else if (v === 'closeup') {
    const a = orbBee.th, ca = Math.cos(a), sa = Math.sin(a);
    const ox = -Fx * 0.16 * k + 0.05 * k, oz = -Fz * 0.16 * k;
    pos.set(p.x + ox * ca - oz * sa, p.y + (0.07 + orbBee.ph) * k, p.z + ox * sa + oz * ca);
    look.set(p.x + Fx * 0.05, p.y, p.z + Fz * 0.05);
  } else if (v === 'face') {
    const a = orbBee.th, ca = Math.cos(a), sa = Math.sin(a);
    const ox = Fx * 0.10 * k, oz = Fz * 0.10 * k;
    pos.set(p.x + ox * ca - oz * sa, p.y + (0.035 + orbBee.ph) * k, p.z + ox * sa + oz * ca);
    look.set(p.x, p.y + 0.008, p.z);
  } else if (v === 'top') {
    const h = topFitHeight() * k;
    pos.set(panTop.x, h, panTop.z + 0.001);
    look.set(panTop.x, 0, panTop.z);
  }
  return { pos, look };
}
function updateViewCamera(dt) {
  if (S.view === 'overview') { orbitUpdate(); return; }
  if (S.view === 'top') { // static map: direct set, no lerp (lerp + straight-down lookAt = roll spin)
    const { pos, look } = viewPose('top');
    camPos.copy(pos); camLook.copy(look);
    mainCam.position.copy(camPos); mainCam.lookAt(camLook);
    return;
  }
  const { pos, look } = viewPose(S.view);
  camPos.lerp(pos, Math.min(1, dt * 5));
  camLook.lerp(look, Math.min(1, dt * 6));
  mainCam.position.copy(camPos);
  mainCam.lookAt(camLook);
}
function setView(v) {
  S.view = v;
  panTop.x = 0; panTop.z = 0; orbBee.th = 0; orbBee.ph = 0;
  if (v === 'top') viewDist.top = 1; // default frames the whole chamber
  for (const [id, vv] of [['cameraFollow', 'follow'], ['cameraOverview', 'overview'], ['cameraCloseup', 'closeup'], ['cameraTop', 'top'], ['cameraFace', 'face']]) {
    const el = $(id);
    if (el) el.classList.toggle('selected', vv === v);
  }
  if (v !== 'overview') {
    const { pos, look } = viewPose(v);
    camPos.copy(pos);
    camLook.copy(look);
    mainCam.position.copy(pos);
    mainCam.lookAt(look);
  } else {
    orbitUpdate();
  }
  const modes = t('camModes');
  $('cameraModeLabel').textContent = modes[v] || modes.overview;
  setSceneWallTransparency(obstacles, $('wallTransparency') ? $('wallTransparency').value : 66, v);
}

// ---------- world ----------
function setWorld(seed) {
  clearWorld(scene, obstacles);
  const w = makeWorld(seed, S.mazeId);
  obstacles = S.noHazards ? w.obstacles.filter((o) => o.type === 'wall') : w.obstacles;
  start = w.start; goal = w.goal;
  for (const o of obstacles) {
    o.mesh = buildObstacleMesh(o);
    scene.add(o.mesh);
  }
  H.goalGroup.position.set(goal.x, .02, goal.z);
  updateObstacleCount();
  $('wallTransparencyOut').textContent = setSceneWallTransparency(obstacles, $('wallTransparency') ? $('wallTransparency').value : 66, S.view);
}

function updateObstacleCount() {
  $('obstacleCount').textContent = t('obsFmt')(obstacles.filter((o) => o.type === 'wall').length, obstacles.filter((o) => o.type !== 'wall').length);
}

function resetFlight(resetCircuit = true, resetGains = resetCircuit) {
  fly = createFlightState(start, goal);
  S.outcome = null; S.pathLen = 0;
  S.lastBrain = null; S.lastDecision = null; S.lastClimb = 0; S.lastTurn = 0;
  S.rule.reset(); S.touch = null;
  trailCount = 0;
  trailGeo.setDrawRange(0, 0);
  stream.length = 0;
  bee.position.set(start.x, start.y, start.z);
  bee.rotation.set(0, -fly.yaw, 0, 'YXZ');
  H.sensorShell.position.copy(bee.position);
  shadowBlob.position.set(start.x, 0.0015, start.z);
  advanceWorld(obstacles, 0, S.moving);
  if (resetCircuit && network) network.reset();
  if (resetGains && network) network.resetLearning();
  rig.reset();
  updateBeeVision(true);
  updateHUD();
}

function setLighting(preset = 'default') {
  S.lighting = preset;
  const hemi = H.hemiLight, sun = H.sunLight, rim = H.rimLight;
  if (!hemi || !sun) return;
  if (preset === 'studio') {
    scene.background.setHex(0x0b1628);
    hemi.color.setHex(0xf0f9ff); hemi.groundColor.setHex(0x334155); hemi.intensity = 2.15;
    sun.color.setHex(0xfff4d6); sun.intensity = 2.65;
    if (rim) { rim.color.setHex(0x7dd3fc); rim.intensity = 1.35; }
    if (beeHeadLight) beeHeadLight.intensity = 0.25;
    if (H.floorMesh) H.floorMesh.material.color.setHex(0x16263b);
  } else if (preset === 'neon') {
    scene.background.setHex(0x03060e);
    hemi.color.setHex(0x38bdf8); hemi.groundColor.setHex(0x1e1b4b); hemi.intensity = 1.05;
    sun.color.setHex(0xc084fc); sun.intensity = 1.45;
    if (rim) { rim.color.setHex(0x22d3ee); rim.intensity = 1.75; }
    if (beeHeadLight) beeHeadLight.intensity = 2.2;
    if (H.floorMesh) H.floorMesh.material.color.setHex(0x09111e);
  } else {
    scene.background.setHex(0x060914);
    hemi.color.setHex(0xc6efff); hemi.groundColor.setHex(0x1a2835); hemi.intensity = 1.5;
    sun.color.setHex(0xffe1aa); sun.intensity = 1.65;
    if (rim) { rim.color.setHex(0x38bdf8); rim.intensity = 0.45; }
    if (beeHeadLight) beeHeadLight.intensity = 0;
    if (H.floorMesh) H.floorMesh.material.color.setHex(0x101c2a);
  }
}

async function ensurePlugin() {
  if (globalThis.ALIFSurrogatePlugin) return globalThis.ALIFSurrogatePlugin;
  try {
    const m = await import('../vision/alif-surrogate-plugin.js');
    globalThis.ALIFSurrogatePlugin = m.ALIFSurrogatePlugin;
    return m.ALIFSurrogatePlugin;
  } catch (e) { return null; }
}

// ---------- sense + rule (single source: sim/camera-controller.js; goal cues from camera only) ----------

// ---------- eye preview ----------
const feed = $('visionFeed');
const feedCtx = feed.getContext('2d');
function drawPreview(signal, visionImage, width, height) {
  if ($('visionCard')?.classList.contains('minimized')) return;
  if (feed.width !== width || feed.height !== height) { feed.width = width; feed.height = height; }
  const data = visionImage.data;
  for (let i = 0; i < signal.pixelMask.length; i++) {
    const kind = signal.pixelMask[i];
    if (!kind) continue;
    const depthAlpha = signal.depthMask ? signal.depthMask[i] : 1;
    let r = 45, g = 205, b = 235, a = 0.14 + depthAlpha * 0.56;
    if (kind === 3) { r = 57; g = 255; b = 20; a = 0.86; }
    else if (kind !== 1) { r = 255; g = 174; b = 55; a = 0.18 + depthAlpha * 0.62; }
    const p = i * 4;
    const invA = 1 - a;
    data[p] = (data[p] * invA + r * a) | 0;
    data[p + 1] = (data[p + 1] * invA + g * a) | 0;
    data[p + 2] = (data[p + 2] * invA + b * a) | 0;
  }
  feedCtx.putImageData(visionImage, 0, 0);
  feedCtx.save();
  if (S.visionMode === 'binocular') {
    const halfW = width >> 1;
    feedCtx.fillStyle = 'rgba(56,189,248,.10)';
    feedCtx.fillRect(halfW * .58, 0, halfW * .42, height);
    feedCtx.fillRect(halfW, 0, (width - halfW) * .42, height);
    feedCtx.strokeStyle = 'rgba(56,189,248,.85)'; feedCtx.lineWidth = 2; feedCtx.strokeRect(1, 1, halfW - 2, height - 2);
    feedCtx.strokeStyle = 'rgba(245,185,66,.85)'; feedCtx.lineWidth = 2; feedCtx.strokeRect(halfW + 1, 1, width - halfW - 2, height - 2);
    feedCtx.fillStyle = '#02060d'; feedCtx.fillRect(halfW - 2, 0, 4, height);
    feedCtx.strokeStyle = '#f59e0b'; feedCtx.lineWidth = 1.6;
    feedCtx.beginPath(); feedCtx.moveTo(halfW, 0); feedCtx.lineTo(halfW, height); feedCtx.stroke();
    // 8-sector ray-angle bin edges projected per eye (mirrors the decoder bins; frontal pair = ±25° #47 bound).
    const cantRad = CAMERA_PIPELINE.binocularCantRad, tanHalfEye = Math.tan(CAMERA_PIPELINE.binocularFov * Math.PI / 360) * CAMERA_PIPELINE.binocularAspect;
    const frontalEdge = CAMERA_PIPELINE.binocularFrontalRad;
    feedCtx.strokeStyle = 'rgba(255,255,255,.5)'; feedCtx.lineWidth = .6;
    feedCtx.beginPath();
    const rayMax = cantRad + Math.atan(tanHalfEye), periStep = (rayMax - frontalEdge) / 2;
    for (const edge of [-(frontalEdge + periStep), -frontalEdge, -frontalEdge / 2, 0, frontalEdge / 2, frontalEdge, frontalEdge + periStep]) {
      const ndcL = Math.tan(edge + cantRad) / tanHalfEye;
      if (Math.abs(ndcL) <= 1) { const x = ((ndcL + 1) / 2) * (halfW - 1); feedCtx.moveTo(x, 0); feedCtx.lineTo(x, height); }
      const ndcR = Math.tan(edge - cantRad) / tanHalfEye;
      if (Math.abs(ndcR) <= 1) { const x = halfW + ((ndcR + 1) / 2) * (width - halfW - 1); feedCtx.moveTo(x, 0); feedCtx.lineTo(x, height); }
    }
    // Row quarters mirror the decoder angular core (even elevation over the 115-deg eye vfov).
    // Full eye width: rows span all columns, not just the frontal band.
    const elHalf = CAMERA_PIPELINE.binocularFov * Math.PI / 360;
    const qOff = Math.tan(elHalf / 2) / Math.tan(elHalf);
    const rowNys = [.5 - qOff / 2, .5, .5 + qOff / 2];
    for (const ny of rowNys) {
      feedCtx.moveTo(0, height * ny); feedCtx.lineTo(halfW, height * ny);
      feedCtx.moveTo(halfW, height * ny); feedCtx.lineTo(width, height * ny);
    }
    feedCtx.stroke();
    feedCtx.fillStyle = 'rgba(7,13,27,.86)'; feedCtx.fillRect(4, 4, 94, 16); feedCtx.fillRect(halfW + 4, 4, 96, 16);
    feedCtx.fillStyle = 'rgba(12,26,46,.88)'; feedCtx.fillRect(halfW - 48, height - 18, 96, 15);
    feedCtx.fillStyle = '#38bdf8'; feedCtx.font = UI_FONT.feedMajor;
    feedCtx.fillText(t('feedLEye'), 7, 15);
    feedCtx.fillStyle = '#fcd676';
    feedCtx.fillText(t('feedREye'), halfW + 7, 15);
    feedCtx.fillStyle = '#7dd3fc'; feedCtx.font = UI_FONT.feedMinor;
    feedCtx.fillText(t('overlapFmt')(Math.round((signal.binocularOverlap || 0) * 100)), halfW - 42, height - 7);
    $('visionGrid').hidden = true;
  } else {
    feedCtx.strokeStyle = 'rgba(255,255,255,.55)'; feedCtx.lineWidth = .6;
    feedCtx.beginPath();
    // Angular-even 8x4 (mirrors decoder: vfov 100deg, aspect-scaled tanH).
    const mTanV = Math.tan(50 * Math.PI / 180), mTanH = mTanV * width / height, mAzHalf = Math.atan(mTanH);
    const mColX = []; for (let j = 1; j < 8; j++) mColX.push((Math.tan(-mAzHalf + j * 2 * mAzHalf / 8) / mTanH + 1) / 2 * width);
    for (const x of mColX) { feedCtx.moveTo(x, 0); feedCtx.lineTo(x, height); }
    // Up/down zone rows mirror the decoder angular row quarters over the cols-3/4 band.
    const mT25 = Math.tan(25 * Math.PI / 180) / mTanV;
    for (const ny of [.5 - mT25 / 2, .5, .5 + mT25 / 2]) { feedCtx.moveTo(mColX[2], height * ny); feedCtx.lineTo(mColX[4], height * ny); }
    const mEdges = [0, ...mColX, width], mRowE = [0, .5 - mT25 / 2, .5, .5 + mT25 / 2, 1];
    $('visionGrid').style.gridTemplateColumns = mEdges.slice(1).map((e, k) => ((e - mEdges[k]) / width * 100).toFixed(2) + '%').join(' ');
    $('visionGrid').style.gridTemplateRows = mRowE.slice(1).map((e, k) => ((e - mRowE[k]) * 100).toFixed(2) + '%').join(' ');
    feedCtx.stroke();
    $('visionGrid').hidden = false;
  }
  feedCtx.restore();
  feed.setAttribute('aria-label', t('ariaFeed'));
  $('visionStatus').textContent = t('visionFmt')(signal.wallPixels || 0, signal.colorPixels || 0, signal.goalPixels || 0);
}

let visionSimLast = -Infinity;
function updateBeeVision(force = false) {
  // Sim-time gate (F1): 100ms of SIM time, not wall-clock — sampling cadence is
  // identical every run regardless of fps.
  if (!force && fly.elapsed - visionSimLast < CAMERA_PIPELINE.updateIntervalMs / 1000) return;
  visionSimLast = fly.elapsed;
  const { signal, visionImage, width, height } = rig.captureBeeVision(
    { pos: fly.pos, yaw: fly.yaw, pitch: fly.pitch }, S.visionMode, S.sensor
  );
  latestVision = signal;
  drawPreview(signal, visionImage, width, height);
}

// ---------- step / loop ----------
function runStep(dt) {
  advanceWorld(obstacles, fly.elapsed, S.moving);
  const brain = senseVision(fly.pos, fly.yaw, fly.pitch, latestVision, { sensitivity: +$('range').value / 10, neuronRule: S.neuronModel, eyeMode: S.visionMode });
  brain.dt = dt;
  brain.touch = S.touch;
  brain.stalled = isStalled(fly.odo); // K24: 1-step-lagged odometry stall for the veer-flip backstop
  const learningActive = S.controller === 'neurons' && S.learning && !!network;
  if (S.controller === 'neurons' && S.learning) brain.teacher = S.rule.step(brain);
  const decision = (S.controller === 'camera' || !network) ? S.rule.step(brain) : network.step(brain);
  decision.network = network;
  const oldX = fly.pos.x, oldY = fly.pos.y, oldZ = fly.pos.z;
  const m = movement(fly, decision, dt, obstacles, {
    speed: S.cruise, learning: learningActive, brain, goal,
    collisionPenalty: S.pCrash, timeLimit: S.maxTime,
  });
  S.touch = m.touch ? { side: m.touch.side, mag: m.touch.mag } : decayTouch(S.touch, dt);
  S.pathLen += Math.hypot(fly.pos.x - oldX, fly.pos.y - oldY, fly.pos.z - oldZ);
  S.lastBrain = brain; S.lastDecision = decision;
  S.lastTurn = m.activeTurn ?? decision.turn ?? 0;
  S.lastClimb = m.climb || 0;
  if (m.collisionEvent) {
    if (bee?.userData?.triggerBlackEyeImpact) bee.userData.triggerBlackEyeImpact(1.15);
    if (bee?.userData?.evade) bee.userData.evade((fly.escapeYawDir || 1) > 0 ? 'right' : 'left');
    setStatus('collision', S.pCrash.toFixed(2));
  }
  bee.position.set(fly.pos.x, fly.pos.y, fly.pos.z);
  bee.rotation.set(fly.pitch, -fly.yaw, 0, 'YXZ');
  stream.push({
    vision: Math.max(brain.leftThreat, brain.frontThreat, brain.rightThreat, brain.upThreat, brain.downThreat),
    turn: clamp(S.lastTurn / .16, -1, 1),
    vertical: clamp(S.lastClimb, -1, 1),
  });
  if (stream.length > 120) stream.shift();
  trailPush(fly.pos);
  if (fly.done) finishEpisode(fly.success ? 'goal' : 'timeout');
}

let lastTs = 0, hudAcc = 0, fpsN = 0, fpsT0 = 0, simAcc = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const frameDt = (ts - lastTs) / 1000 || 0.016;
  lastTs = ts;
  fpsN++;
  if (ts - fpsT0 > 500) { S.fps = Math.round(fpsN * 1000 / (ts - fpsT0)); fpsN = 0; fpsT0 = ts; }
  // Fixed-step sim (F1): wall-clock only feeds the accumulator; the brain and
  // physics always integrate at SIM_STEP_H. Vision is sampled INSIDE the step
  // loop (same as experiment/multilab/batch pages) so fps/view/speed cannot
  // alter behavior: same seed => same vision steps => same trajectory.
  if (S.running && !S.outcome) {
    // Speed multiplier: repeat the fixed-step accumulator pass (1x/2x/3x).
    const reps = Math.max(1, Math.round(S.speed));
    for (let k = 0; k < reps && S.running && !S.outcome; k++) {
      const tick = consumeSteps(simAcc, frameDt);
      simAcc = tick.acc;
      for (let i = 0; i < tick.steps && S.running && !S.outcome; i++) { runStep(SIM_STEP_H); updateBeeVision(); }
    }
    if (!S.running || S.outcome) simAcc = 0;
  } else { simAcc = 0; updateBeeVision(); }
  // agent pose + fx (sample studio driver: raw turn/climb, normalized inside)
  if (bee?.userData?.updateStudio) bee.userData.updateStudio(frameDt, ts, S.running && !S.outcome, S.lastTurn, S.lastClimb);
  if (subjectPreview) subjectPreview.render(frameDt, ts);
  shadowBlob.visible = S.shadowOn;
  if (S.shadowOn) {
    shadowBlob.position.x = fly.pos.x;
    shadowBlob.position.z = fly.pos.z;
    const hFrac = fly.pos.y / Y;
    const sc = 0.7 + hFrac * 1.3;
    shadowBlob.scale.set(sc, sc, sc);
    shadowBlob.material.opacity = 0.6 * (1 - hFrac) + 0.08;
  }
  if (H.sensorShell && H.sensorShell.visible) {
    H.sensorShell.position.copy(bee.position);
    H.sensorShell.scale.setScalar(.12 * (+$('range').value / 10));
  }
  if (H.altitudeGuide) {
    const pos = H.altitudeGuide.geometry.attributes.position; pos.setXYZ(0, fly.pos.x, 0.002, fly.pos.z); pos.setXYZ(1, fly.pos.x, fly.pos.y, fly.pos.z); pos.needsUpdate = true;
    H.altitudeGuide.computeLineDistances();
    H.altitudeGuide.visible = fly.pos.y > .026;
  }
  hudAcc += frameDt;
  if (hudAcc > 0.12) { hudAcc = 0; updateHUD(); }
  updateViewCamera(frameDt);
  renderer.render(scene, mainCam);
}

function currentProgress() {
  return clamp(1 - dist(fly.pos, goal) / Math.max(dist(start, goal), 1e-6), 0, 1);
}

function finishEpisode(reason) {
  S.outcome = reason === 'goal' ? 'success' : 'timeout';
  S.running = false;
  setStatus(reason === 'goal' ? 'goal' : 'timeout');
  $('runBtn').textContent = t('run');
  const d = Math.hypot(goal.x - fly.pos.x, goal.y - fly.pos.y, goal.z - fly.pos.z);
  const st = (S.controller === 'neurons' && network) ? network.stats(S.visionMode) : null;
  S.lastEp = {
    schema_version: '1.0',
    experiment_id: 'exp-' + Date.now().toString(36),
    created_at: new Date().toISOString(),
    scenario: S.mazeId,
    seed: S.seed,
    controller: S.controller === 'neurons' ? 'connectome_snn' : 'baseline_rule',
    vision_mode: S.visionMode,
    sensor_method: S.sensor,
    neuron_model: S.neuronModel === 'alif_surrogate' ? 'ALIF+Surrogate' : 'LIF',
    learning_enabled: S.learning,
    anatomical: !!loadedGraph,
    graph_nodes: loadedGraph ? loadedGraph.nodes.length : null,
    graph_edges: loadedGraph ? loadedGraph.edges.length : null,
    parameters: {
      chamber_m: { W, Y, Z }, bee_radius_m: BEE_RADIUS,
      cruise_ms: S.cruise, p_crash: -S.pCrash, max_time_s: S.maxTime,
      vision_sensitivity: +$('range').value / 10, learn_rate: S.learnRate,
      vfov_deg: S.visionMode === 'monocular' ? 100 : 115,
      baseline_m: S.visionMode === 'binocular' ? 0.0036 : null,
      cant_deg: S.visionMode === 'binocular' ? 28 : null,
    },
    outcome: {
      success: S.outcome === 'success',
      termination_reason: reason,
      collisions: fly.collisions,
      progress_percent: +(currentProgress() * 100).toFixed(1),
      elapsed_seconds: +fly.elapsed.toFixed(2),
      total_reward: +fly.reward.toFixed(3),
    },
    metrics: {
      path_length_m: +S.pathLen.toFixed(3),
      astar_length_m: null,
      efficiency: null,
      final_distance_m: +d.toFixed(4),
    },
    gains: network ? network.exportWeights() : null,
  };
  $('expOut').textContent = JSON.stringify(S.lastEp, null, 1).slice(0, 1800);
}

// ---------- HUD ----------
const sigCtx = $('signalGraph').getContext('2d');
function drawStream() {
  const Wpx = 380, Hpx = 64;
  sigCtx.fillStyle = '#030916';
  sigCtx.fillRect(0, 0, Wpx, Hpx);
  if (stream.length < 2) return;
  const series = [
    { k: 'vision', c: '#fb7185', a: 0, b: 1 },
    { k: 'turn', c: '#f5b942', a: -1, b: 1 },
    { k: 'vertical', c: '#38bdf8', a: -1, b: 1 },
  ];
  for (const s of series) {
    sigCtx.strokeStyle = s.c;
    sigCtx.lineWidth = 1.5;
    sigCtx.beginPath();
    stream.forEach((p, i) => {
      const x = (i / 119) * Wpx;
      const y = Hpx - 4 - ((p[s.k] - s.a) / (s.b - s.a)) * (Hpx - 8);
      if (i === 0) sigCtx.moveTo(x, y);
      else sigCtx.lineTo(x, y);
    });
    sigCtx.stroke();
  }
}

function escapeHtml(x) {
  return String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function drawGraph(active = []) {
  if ($('dashboard')?.classList.contains('collapsed')) return;
  const c = $('brain'), ctx = c.getContext('2d'), w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#08101d';
  ctx.fillRect(0, 0, w, h);
  if (!loadedGraph) {
    ctx.fillStyle = '#7890a8';
    ctx.font = UI_FONT.graph;
    ctx.textAlign = 'center';
    ctx.fillText(t('graphFallback'), w / 2, h / 2);
    return;
  }
  const visual = loadedGraph.nodes.filter((n) => ['visual_projection', 'visual_centrifugal'].includes(n.superclass));
  const dn = loadedGraph.nodes.filter((n) => ['DNp03', 'DNp06', 'DNa04', 'DNa05', 'DNa10'].includes(n.type));
  const motor = loadedGraph.nodes.filter((n) => n.superclass === 'vnc_motor');
  const pick = (a, n) => a.filter((_, i) => i % Math.max(1, Math.ceil(a.length / n)) === 0).slice(0, n);
  const cols = [pick(visual, 10), dn, pick(motor, 10)], xs = [45, 190, 335], byId = new Map();
  cols.forEach((arr, g) => arr.forEach((n, i) => byId.set(Number(n.id), { x: xs[g], y: (i + 1) * h / (arr.length + 1), node: n })));
  const hot = new Map(active.map((n) => [Number(n.id), n.firingRate]));
  ctx.lineWidth = .7;
  for (const e of loadedGraph.edges) {
    const a = byId.get(Number(e.source)), b = byId.get(Number(e.target));
    if (!a || !b) continue;
    const power = Math.max(hot.get(Number(a.node.id)) || 0, hot.get(Number(b.node.id)) || 0);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(70,190,212,${(.08 + Math.min(.6, power)).toFixed(3)})`;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const [g, arr] of cols.entries()) for (const n of arr) {
    const p = byId.get(Number(n.id)), v = hot.get(Number(n.id)) || 0;
    ctx.beginPath();
    ctx.fillStyle = g === 0 ? '#42cbe0' : g === 1 ? '#a38cf4' : '#efbd58';
    ctx.globalAlpha = .25 + Math.min(.7, v * 2);
    ctx.arc(p.x, p.y, 3 + v * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.font = UI_FONT.graph;
  ctx.fillStyle = '#7890a8';
  ctx.textAlign = 'center';
  ctx.fillText(t('canvasVisual')(visual.length), 55, h - 5);
  ctx.fillText(t('canvasDn'), 190, h - 5);
  ctx.fillText(t('canvasMotor')(motor.length), 325, h - 5);
}

function updateHUD() {
  $('fps').textContent = `${S.fps}fps`;
  const s = S.lastBrain;
  if (s) {
    $('visionLeft').textContent = `${Math.round(s.leftThreat * 100)}%`;
    $('visionFront').textContent = `${Math.round(s.frontThreat * 100)}%`;
    $('visionRight').textContent = `${Math.round(s.rightThreat * 100)}%`;
    $('visionUp').textContent = `${Math.round(s.upThreat * 100)}%`;
    $('visionDown').textContent = `${Math.round(s.downThreat * 100)}%`;
    $('visionUpperRoute').textContent = `${Math.round((s.grid ? s.grid[1] : 0) * 100)}%`;
    $('visionLowerRoute').textContent = `${Math.round((s.grid ? s.grid[7] : 0) * 100)}%`;
    $('visionVertical').textContent = t('frontFmt')(Math.round((s.centerObstacle || 0) * 100));
    $('visionVertical').style.color = '#63d8ed';
  }
  const turn = S.lastTurn, climb = S.lastClimb;
  $('turnValue').textContent = turn.toFixed(3);
  $('verticalValue').textContent = climb > 0.12 ? t('vertClimb') : climb < -0.12 ? t('vertDive') : t('vertCruise');
  const turnL = clamp(-turn / .16), turnR = clamp(turn / .16), up = clamp(climb), down = clamp(-climb);
  for (const [key, v] of [['Left', turnL], ['Right', turnR], ['Up', up], ['Down', down]]) {
    $('o' + key).style.width = `${v * 100}%`;
    $('v' + key).textContent = `${Math.round(v * 100)}%`;
  }
  const vPrefix = S.controller === 'camera' ? t('prefixCamera') : t('prefixNeurons');
  $('verticalModeLabel').textContent = climb > 0.12 ? `${vPrefix} ${t('vertClimb')}` : climb < -0.12 ? `${vPrefix} ${t('vertDive')}` : t('vertHold');
  $('collisions').textContent = fly.collisions;
  $('progress').textContent = `${Math.round(currentProgress() * 100)}%`;
  $('elapsed').textContent = `${fly.elapsed.toFixed(1)}s`;
  $('reward').textContent = fly.reward.toFixed(2);
  $('altitude').textContent = t('altFmt')((fly.pos.y * 100).toFixed(1));
  $('altBar').style.width = `${(fly.pos.y / Y) * 100}%`;
  const stunned = fly.stunTimer > 0 || fly.escapeTimer > 0;
  $('flightState').textContent = stunned ? t('stateStun') : climb > 0.12 ? t('stateClimb') : climb < -0.12 ? t('stateDive') : fly.done ? (fly.success ? t('stateGoal') : t('stateDone')) : S.running ? t('stateRun') : t('stateIdle');
  if (network) {
    const st = network.stats(S.visionMode);
    $('gainLeftOut').textContent = (st.gains.left || 1).toFixed(4);
    $('gainRightOut').textContent = (st.gains.right || 1).toFixed(4);
    $('gainClimbOut').textContent = (st.gains.climb || 1).toFixed(4);
    $('gainDiveOut').textContent = (st.gains.dive || 1).toFixed(4);
    $('gainUpdatesOut').textContent = t('gainUpdatesFmt')(st.rewardUpdates);
    $('collisionIdxOut').textContent = t('collIdxFmt')((st.collisionIndex || 0).toFixed(2));
    const epc = Math.round((st.explorationRate || 0) * 100);
    $('explorePctOut').textContent = t('exploreFmt')(epc);
    $('exploitPctOut').textContent = t('exploitFmt')(100 - epc);
    $('exploreBar').style.width = `${epc}%`;
    $('neuronCount').textContent = t('spikesFmt')(st.spikes);
    $('neuronCount').style.color = st.spikes > 0 ? '#64e4bb' : '#8799ad';
  }
  const tel = (S.lastDecision && S.lastDecision.telemetry) || [];
  const box = $('activeNodes');
  if (S.controller === 'neurons' && network) {
    box.innerHTML = tel.length
      ? tel.slice(0, 9).map((n) => `<div><b>${escapeHtml(n.name || n.type)}</b><span>${n.superclass === 'vnc_motor' ? t('roleMotor') : n.superclass === 'descending_neuron' ? t('roleDn') : t('roleVisual')} · ${n.side || '—'}</span><i>${n.firingRate.toFixed(2)}</i></div>`).join('')
      : `<span>${t('activeLow')}</span>`;
    drawGraph(tel);
  } else {
    box.innerHTML = `<span>${t('activeCameraOff')}</span>`;
    drawGraph([]);
  }
  updateFirePanel();
  drawStream();
}
function updateFirePanel() {
  const d = (S.controller === 'neurons' && network && S.lastDecision) ? S.lastDecision : null;
  $('fireState').textContent = d ? t('liveBadge') : '';
  const bars = ['fireVisL', 'fireVisR', 'fireVisU', 'fireVisD', 'fireDnL', 'fireDnR', 'fireMoL', 'fireMoR'];
  const vals = ['fireVisLv', 'fireVisRv', 'fireVisUv', 'fireVisDv', 'fireDnLv', 'fireDnRv', 'fireMoLv', 'fireMoRv'];
  if (!d) {
    for (const id of bars) $(id).style.width = '0%';
    for (const id of vals) $(id).textContent = '—';
    $('fireDnList').innerHTML = `<span>${t('fireIdle')}</span>`;
    $('fireMotorList').innerHTML = `<span>${t('fireIdle')}</span>`;
    return;
  }
  const setBar = (u, v, val, max) => { $(u).style.width = `${Math.min(1, (val || 0) / max) * 100}%`; $(v).textContent = (val || 0).toFixed(2); };
  const setShare = (uL, vL, uR, vR, l, r) => {
    const tot = (l || 0) + (r || 0);
    $(uL).style.width = tot > 0 ? `${((l || 0) / tot) * 100}%` : '0%';
    $(uR).style.width = tot > 0 ? `${((r || 0) / tot) * 100}%` : '0%';
    $(vL).textContent = (l || 0).toFixed(1); $(vR).textContent = (r || 0).toFixed(1);
  };
  setBar('fireVisL', 'fireVisLv', d.leftDrive, 2); setBar('fireVisR', 'fireVisRv', d.rightDrive, 2);
  setBar('fireVisU', 'fireVisUv', d.upperDrive, 2); setBar('fireVisD', 'fireVisDv', d.lowerDrive, 2);
  setShare('fireDnL', 'fireDnLv', 'fireDnR', 'fireDnRv', d.leftDn, d.rightDn);
  setShare('fireMoL', 'fireMoLv', 'fireMoR', 'fireMoRv', d.leftMotor, d.rightMotor);
  const tel = d.telemetry || [];
  const list = (sc) => tel.filter((n) => n.superclass === sc).slice(0, 3)
    .map((n) => `<div><span>${escapeHtml(n.type || n.name)} · ${n.side || '—'}</span><i>${n.firingRate.toFixed(2)}</i></div>`).join('');
  $('fireDnList').innerHTML = list('descending_neuron') || `<span>${t('fireNone')}</span>`;
  $('fireMotorList').innerHTML = list('vnc_motor') || `<span>${t('fireNone')}</span>`;
}

// ---------- benchmarks (headless-style episodes on the live scene) ----------
// Deterministic PRNG for dt-jitter rows (wall-clock fps jitter emulation).
// mulberry32 (public domain, Tommy Ettinger).
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function runEpisode({ seed, visionMode, sensor, neuronModel, controller, learning, dtStep, dtJitter }) {
  setWorld(seed);
  rig.reset();
  // Per-episode rig reset: captureBeeVision uses the rig-internal decoder, so
  // flow/escape history would otherwise leak across episodes and conditions.
  const net = controller === 'neurons' ? createFlightConnectome(loadedGraph, { mode: visionMode, neuronRule: neuronModel }) : null;
  if (net && learning) net.setLearningRate(S.learnRate);
  const state = createFlightState(start, goal);
  const rule = createCameraRuleController();
  let episodeVision = latestVision, visionAt = -Infinity, touch = null;
  const capTime = Math.min(S.maxTime, 60);
  // Step-rate conditions: fixed dtStep (default .05 = legacy behavior) or a
  // seeded uniform dt stream emulating wall-clock fps jitter (.01-.05s).
  // Vision cadence stays .16s sim-time so only the integration rate varies.
  const stepDt = dtStep > 0 ? dtStep : .05;
  const jitRng = dtJitter ? mulberry32(Math.imul(seed, 2654435761) ^ Math.imul(dtJitter, 40503)) : null;
  while (!state.done && state.elapsed < capTime) {
    const dt = jitRng ? .01 + jitRng() * .04 : stepDt;
    advanceWorld(obstacles, state.elapsed, S.moving);
    if (state.elapsed >= visionAt) {
      episodeVision = rig.captureBeeVision({ pos: state.pos, yaw: state.yaw, pitch: state.pitch }, visionMode, sensor).signal;
      visionAt = state.elapsed + .16;
    }
    const b = senseVision(state.pos, state.yaw, state.pitch, episodeVision, { sensitivity: +$('range').value / 10, neuronRule: neuronModel, eyeMode: visionMode });
    b.dt = dt;
    b.touch = touch;
    const learn = learning && controller === 'neurons';
    if (learn) b.teacher = rule.step(b);
    const d = controller === 'camera' ? rule.step(b) : net.step(b);
    d.network = net;
    const m = movement(state, d, dt, obstacles, {
      speed: S.cruise, learning: learn, brain: b, goal,
      collisionPenalty: S.pCrash, timeLimit: S.maxTime,
    });
    touch = m.touch ? { side: m.touch.side, mag: m.touch.mag } : decayTouch(touch, dt);
  }
  return {
    success: !!state.success, collisions: state.collisions,
    progress: Math.round(clamp(1 - dist(state.pos, goal) / Math.max(dist(start, goal), 1e-6)) * 100),
    time: +state.elapsed.toFixed(2), reward: +state.reward.toFixed(3), net,
  };
}

const BENCH_STATUS = { benchmark: 'benchLearn', circuitBenchmark: 'benchCircuit', eyeBenchmark: 'benchEye', sensorBenchmark: 'benchSensor', ruleBenchmark: 'benchRule', rateBenchmark: 'benchRate' };
async function runBenchSet(btnId, rows) {
  if (!loadedGraph) return;
  const btn = $(btnId);
  btn.disabled = true;
  const keepMaze = S.mazeId, keepSeed = S.seed;
  const seed = +$('seed').value || 1;
  const eps = Math.min(Math.max(+$('episodes').value || 1, 1), 20);
  const benchStatus = BENCH_STATUS[btnId] || 'benchLearn';
  const out = [];
  const benchInfo = { maze: S.mazeId, seeds: eps > 1 ? `${seed}..${seed + eps - 1}` : `${seed}`, eps, vision: S.visionMode, sensor: S.sensor, controller: S.controller };
  let learnNet = null;
  if (rows.some((r) => (r.neuronModel || S.neuronModel) === 'alif_surrogate')) await ensurePlugin();
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setStatus(benchStatus, `(0/${rows.length})`);
      await new Promise((r) => setTimeout(r, 20));
      const rs = [];
      for (let k = 0; k < eps; k++) {
        const r = runEpisode({
          seed: seed + k,
          dtStep: row.dtStep, dtJitter: row.dtJitter,
          visionMode: row.visionMode || S.visionMode,
          sensor: row.sensor || S.sensor,
          neuronModel: row.neuronModel || S.neuronModel,
          controller: row.controller || (S.controller === 'neurons' ? 'neurons' : 'camera'),
          learning: row.learning != null ? row.learning : S.learning,
        });
        if (row.learning) learnNet = r.net;
        rs.push(r);
        await new Promise((r2) => setTimeout(r2, 0));
      }
      const succ = rs.filter((r) => r.outcome === 'success' || r.success).length;
      setStatus(benchStatus, `(${i + 1}/${rows.length})`);
      out.push({
        condKey: row.condKey,
        succ: `${Math.round((100 * succ) / rs.length)}%`,
        prog: `${(rs.reduce((a, r) => a + r.progress, 0) / rs.length).toFixed(0)}%`,
        t: (rs.reduce((a, r) => a + r.time, 0) / rs.length).toFixed(1),
        col: (rs.reduce((a, r) => a + r.collisions, 0) / rs.length).toFixed(1),
        rew: (rs.reduce((a, r) => a + r.reward, 0) / rs.length).toFixed(1),
      });
    }
  } finally {
    S.mazeId = keepMaze; S.seed = keepSeed;
    setWorld(keepSeed);
    resetFlight(false);
    if (LEARNING_ENABLED && btnId === 'benchmark' && learnNet && network) {
      network.loadWeights({ [S.visionMode]: learnNet.exportWeights() });
    }
    btn.disabled = false;
  }
  S.benchRows = out;
  S.benchInfo = benchInfo;
  console.log('[bench]', JSON.stringify(benchInfo));
  renderBenchTable();
  setStatus('benchDone');
  $('download').disabled = false;
}
function renderBenchTable() {
  if (!S.benchRows) return;
  const bi = S.benchInfo;
  const infoHtml = bi ? `<div class="bench-info">maze=${bi.maze} · seeds=${bi.seeds} · eps=${bi.eps} · eye=${bi.vision} · sensor=${bi.sensor} · ctrl=${bi.controller}</div>` : '';
  $('results').innerHTML = infoHtml + `<table><thead><tr><th>${t('resLabel')}</th><th>${t('resSucc')}</th><th>${t('resProg')}</th><th>${t('resTime')}</th><th>${t('resCol')}</th><th>${t('resR')}</th></tr></thead><tbody>${
    S.benchRows.map((r) => `<tr><td>${t(r.condKey) || r.condKey}</td><td>${r.succ}</td><td>${r.prog}</td><td>${r.t}</td><td>${r.col}</td><td>${r.rew}</td></tr>`).join('')
  }</tbody></table>`;
}

function smokeCheck() {
  if (!network || !loadedGraph) return { skipped: true };
  const mk = () => createFlightConnectome(loadedGraph, { mode: S.visionMode });
  const L = mk();
  let lt = 0;
  for (let i = 0; i < 60; i++) lt = L.step({ leftThreat: 1, loomingL: .5 }).turn;
  const R = mk();
  let rt = 0;
  for (let i = 0; i < 60; i++) rt = R.step({ rightThreat: 1, loomingR: .5 }).turn;
  const cap = .16;
  return {
    leftTurn: +lt.toFixed(3), rightTurn: +rt.toFixed(3), cap,
    pass: lt > 0 && rt < 0 && Math.abs(lt) <= cap + 1e-9 && Math.abs(rt) <= cap + 1e-9,
  };
}

function renderSmoke() {
  const r = S.lastSmoke;
  if (!r) { if (!S.lastEp) $('expOut').textContent = t('expDefault'); return; }
  $('expOut').textContent = r.skipped
    ? `${t('smokeSkipped')}: ${t('graphFallback')}`
    : `${t('smokeTitle')}:\n${t('smokeLeft')} -> ${r.leftTurn} (${t('smokeExpectFmt')('+' + r.cap)})\n${t('smokeRight')} -> ${r.rightTurn} (${t('smokeExpectFmt')('-' + r.cap)})\n${t('smokeResult')}: ${r.pass ? 'PASS' : 'CHECK'}`;
}

// ---------- UI wiring ----------
function refreshScenarios() {
  const sel = $('scenario');
  sel.innerHTML = '';
  const ko = document.documentElement.lang === 'ko';
  listMazes().forEach((m, i) => {
    const op = document.createElement('option');
    op.value = m.id;
    const nm = ko && m.nameKo ? m.nameKo : m.name;
    op.textContent = m.builtin === false ? nm : `${t('stage')} ${i + 1} · ${nm}`;
    sel.appendChild(op);
  });
  sel.value = S.mazeId;
}
function syncEyeUI() {
  $('eyeModeMono').classList.toggle('selected', S.visionMode === 'monocular');
  $('eyeModeBino').classList.toggle('selected', S.visionMode === 'binocular');
  $('visionTypeSelect').value = S.visionMode;
}
function syncSensorUI() {
  document.querySelectorAll('.cam-sensor-btn').forEach((b) => b.classList.toggle('selected', b.dataset.sensor === S.sensor));
  $('cameraSensorSelect').value = S.sensor;
}
function syncNoHazardsBtn() {
  $('btnNoHazards').textContent = S.noHazards ? t('yesHazards') : t('noHazards');
}
function updateControlMode() {
  const cameraModeSelected = S.controller === 'camera';
  $('learning').disabled = cameraModeSelected;
  $('neuralPanelTitle').textContent = cameraModeSelected ? t('neuralTitleCamera') : t('neuralTitle');
}
function syncA11y() {
  $('zoomIn').title = t('tipZoomIn');
  $('zoomOut').title = t('tipZoomOut');
  $('zoomReset').title = t('tipZoomReset');
  $('panelClose').title = t('tipCollapse');
  $('visionMinimize').title = t('tipMinimize');
  $('beePanelClose').title = t('tipClose');
  $('lightingPresetSelect').title = t('lightTitle');
  $('lightingPresetSelect').setAttribute('aria-label', t('ariaLighting'));
  $('scene').setAttribute('aria-label', t('ariaScene'));
  $('signalGraph').setAttribute('aria-label', t('ariaSignal'));
  $('simSpeed').setAttribute('aria-label', t('ariaSimSpeed'));
}
let statusKey = 'ready', statusArg = '';
function setStatus(key, arg = '') {
  statusKey = key; statusArg = arg;
  const fn = t('statuses')[key];
  $('status').textContent = typeof fn === 'function' ? fn(arg) : (fn || key);
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function initUI() {
  refreshScenarios();
  $('scenario').addEventListener('change', (e) => {
    S.mazeId = e.target.value;
    S.running = false;
    $('runBtn').textContent = t('run');
    setWorld(S.seed);
    resetFlight(true, false);
    setStatus('mazeReset');
  });
  $('scenario').addEventListener('focus', refreshScenarios);
  const refreshPreview = () => { updateBeeVision(true); updateHUD(); };
  $('eyeModeMono').addEventListener('click', () => { S.visionMode = 'monocular'; syncEyeUI(); refreshPreview(); setStatus('visionMono'); });
  $('eyeModeBino').addEventListener('click', () => { S.visionMode = 'binocular'; syncEyeUI(); refreshPreview(); setStatus('visionBino'); });
  $('visionTypeSelect').addEventListener('change', (e) => { S.visionMode = e.target.value; syncEyeUI(); refreshPreview(); setStatus(S.visionMode === 'binocular' ? 'visionBino' : 'visionMono'); });
  document.querySelectorAll('.cam-sensor-btn').forEach((b) => b.addEventListener('click', () => { S.sensor = b.dataset.sensor; syncSensorUI(); refreshPreview(); setStatus('sensorChanged', b.textContent); }));
  $('cameraSensorSelect').addEventListener('change', (e) => { S.sensor = e.target.value; syncSensorUI(); refreshPreview(); setStatus('sensorChanged', e.target.options[e.target.selectedIndex].text); });
  $('controlMode').addEventListener('change', (e) => {
    S.controller = e.target.value;
    S.running = false;
    $('runBtn').textContent = t('run');
    updateControlMode();
    resetFlight(false);
    setStatus(S.controller === 'camera' ? 'modeCamera' : 'modeNeurons');
  });
  { // build freshness check (console only; header stamp removed per owner request)
    console.log('[nsp3d builds]', { decoder: DECODER_BUILD, controller: CONTROLLER_BUILD, snn: SNN_BUILD });
    document.title = `[${NSP3D_VERSION}] ` + document.title;
  }
  $('neuronRuleSelect').addEventListener('change', async (e) => {
    if (e.target.value === 'alif_surrogate') {
      const p = await ensurePlugin();
      if (!p) { alert(t('alertAlif')); e.target.value = 'lif_baseline'; return; }
    }
    S.neuronModel = e.target.value;
    if (network) network.setNeuronRule(S.neuronModel);
    setStatus(S.neuronModel === 'alif_surrogate' ? 'ruleAlif' : 'ruleLif');
  });
  $('learning').addEventListener('change', (e) => { S.learning = LEARNING_ENABLED && e.target.checked; });
  $('resetCircuit').addEventListener('change', (e) => { S.resetCircuit = e.target.checked; });
  const mv = $('movingObstacles');
  if (mv) {
    S.moving = mv.checked;
    mv.addEventListener('change', (e) => { S.moving = e.target.checked; });
  }
  $('speed').addEventListener('input', (e) => { S.cruise = +e.target.value / 100; $('speedOut').textContent = e.target.value; });
  $('range').addEventListener('input', (e) => { S.visionGain = +e.target.value / 10; $('rangeOut').textContent = S.visionGain.toFixed(1); });
  $('rate').addEventListener('input', (e) => { S.learnRate = +e.target.value; $('rateOut').textContent = S.learnRate.toFixed(3); if (network) network.setLearningRate(S.learnRate); });
  $('timeLimit').addEventListener('input', (e) => { S.maxTime = +e.target.value; $('timeLimitOut').textContent = e.target.value; });
  $('collisionPenalty').addEventListener('input', (e) => { S.pCrash = +e.target.value; $('penaltyOut').textContent = S.pCrash.toFixed(1); });
  $('learning').checked = S.learning;
  $('resetCircuit').checked = S.resetCircuit;
  updateControlMode();
  $('runBtn').addEventListener('click', () => {
    if (S.outcome) resetFlight(S.resetCircuit);
    S.running = !S.running;
    setStatus(S.running ? 'running' : 'paused');
    $('runBtn').textContent = S.running ? t('pause') : t('run');
  });
  S.mediaRec = null; S.recChunks = []; S.recTimer = 0; S.recT0 = 0; S.recCapped = false;
  const recTick = () => {
    if (!S.mediaRec || S.mediaRec.state === 'inactive') return;
    $('recBtn').title = `${t('recording')} ${recElapsed(S.recT0)}`;
    if (recCapped(S.recT0)) { S.recCapped = true; S.mediaRec.stop(); }
  };
  $('recBtn').addEventListener('click', () => {
    if (S.mediaRec && S.mediaRec.state !== 'inactive') { S.mediaRec.stop(); return; }
    if (S.tabRec && S.tabRec.state !== 'inactive') S.tabRec.stop();
    if (!window.MediaRecorder || typeof glCanvas.captureStream !== 'function') { setStatus('recUnsupported'); return; }
    try {
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(glCanvas.captureStream(60), { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 16000000 });
      S.recChunks = []; S.recCapped = false; S.recT0 = Date.now();
      const fname = recFilename('main', S.view, new Date(S.recT0));
      rec.ondataavailable = (e) => { if (e.data && e.data.size) S.recChunks.push(e.data); };
      rec.onstop = async () => {
        clearInterval(S.recTimer); S.recTimer = 0;
        const blob = new Blob(S.recChunks, { type: rec.mimeType || 'video/webm' });
        let stored = true;
        try {
          await saveArtifact({ kind: 'webm', page: 'main', source: S.view, filename: fname, blob });
        } catch (err) { stored = false; }
        // Dual-write until the report page lands: the store is managed truth,
        // the download keeps files reachable without a library UI yet.
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        $('recBtn').classList.remove('on');
        $('recBtn').title = t('record');
        setStatus(!stored ? 'recStoreFail' : S.recCapped ? 'recCapped' : 'recSaved');
        S.mediaRec = null;
      };
      rec.start(250);
      S.mediaRec = rec;
      $('recBtn').classList.add('on');
      $('recBtn').title = `${t('recording')} 0:00`;
      S.recTimer = setInterval(recTick, 500);
      setStatus('recStart');
    } catch (err) { setStatus('recUnsupported'); }
  });
  // Tab capture: whole-tab video incl. DOM panels (submission cut). Picker per
  // start by browser design; browser "stop sharing" ends gracefully via onended.
  S.tabRec = null; S.tabChunks = []; S.tabTimer = 0; S.tabT0 = 0; S.tabCapped = false;
  const tabRecTick = () => {
    if (!S.tabRec || S.tabRec.state === 'inactive') return;
    $('tabRecBtn').title = `${t('tabRecording')} ${recElapsed(S.tabT0)}`;
    if (recCapped(S.tabT0)) { S.tabCapped = true; S.tabRec.stop(); }
  };
  $('tabRecBtn').addEventListener('click', async () => {
    if (S.tabRec && S.tabRec.state !== 'inactive') { S.tabRec.stop(); return; }
    if (S.mediaRec && S.mediaRec.state !== 'inactive') S.mediaRec.stop();
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') { setStatus('recUnsupported'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false });
    } catch (err) {
      if (!err || err.name !== 'NotAllowedError') setStatus('recUnsupported');
      return; // picker cancelled: silent
    }
    try {
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8000000 });
      S.tabChunks = []; S.tabCapped = false; S.tabT0 = Date.now();
      const fname = recFilename('main', 'tab', new Date(S.tabT0));
      rec.ondataavailable = (e) => { if (e.data && e.data.size) S.tabChunks.push(e.data); };
      rec.onstop = async () => {
        clearInterval(S.tabTimer); S.tabTimer = 0;
        for (const tr of stream.getTracks()) tr.stop();
        const blob = new Blob(S.tabChunks, { type: rec.mimeType || 'video/webm' });
        let stored = true;
        try {
          await saveArtifact({ kind: 'webm', page: 'main', source: 'tab', filename: fname, blob });
        } catch (err) { stored = false; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        $('tabRecBtn').classList.remove('on');
        $('tabRecBtn').textContent = '● ' + t('tabRecord');
        $('tabRecBtn').title = t('tabRecord');
        setStatus(!stored ? 'recStoreFail' : S.tabCapped ? 'recCapped' : 'recSaved');
        S.tabRec = null;
      };
      stream.getVideoTracks()[0].onended = () => { if (S.tabRec && S.tabRec.state !== 'inactive') S.tabRec.stop(); };
      rec.start(250);
      S.tabRec = rec;
      $('tabRecBtn').classList.add('on');
      $('tabRecBtn').textContent = '⏹ ' + t('tabRecording');
      $('tabRecBtn').title = `${t('tabRecording')} 0:00`;
      S.tabTimer = setInterval(tabRecTick, 500);
      setStatus('recStart');
    } catch (err) {
      for (const tr of stream.getTracks()) tr.stop();
      setStatus('recUnsupported');
    }
  });
  $('stepBtn').addEventListener('click', () => {
    if (S.outcome) resetFlight(S.resetCircuit);
    S.running = false;
    $('runBtn').textContent = t('run');
    updateBeeVision(true);
    runStep(SIM_STEP_H);
    updateHUD();
  });
  $('agentReset').addEventListener('click', () => { S.running = false; $('runBtn').textContent = t('run'); resetFlight(true, false); setStatus('agentReset'); });
  $('simSpeed').addEventListener('change', (e) => { S.speed = +e.target.value || 1; simAcc = 0; });
  $('seed').addEventListener('change', (e) => { S.seed = +e.target.value || 1; setWorld(S.seed); resetFlight(true, false); });
  $('toggleTrail').addEventListener('change', (e) => { S.trailOn = e.target.checked; trail.visible = S.trailOn; });
  $('toggleSensingRadius').addEventListener('change', (e) => { H.sensorShell.visible = e.target.checked; });
  $('toggleGroundShadow').addEventListener('change', (e) => { S.shadowOn = e.target.checked; });
  $('btnShuffle').addEventListener('click', () => {
    S.shuffleSeed++;
    S.running = false;
    $('runBtn').textContent = t('run');
    setWorld(S.seed + S.shuffleSeed * 7919);
    resetFlight(true, false);
    setStatus('newWorld', S.seed);
  });
  $('btnNoHazards').addEventListener('click', () => {
    S.noHazards = !S.noHazards;
    S.running = false;
    $('runBtn').textContent = t('run');
    $('btnNoHazards').classList.toggle('amber', S.noHazards);
    syncNoHazardsBtn();
    setWorld(S.seed + S.shuffleSeed * 7919);
    resetFlight(true, false);
  });
  $('visionMinimize').addEventListener('click', () => {
    const min = $('visionCard').classList.toggle('minimized');
    $('visionMinimize').textContent = min ? '▸' : '▾';
  });
  // camera views
  $('cameraFollow').addEventListener('click', () => setView('follow'));
  $('cameraOverview').addEventListener('click', () => setView('overview'));
  $('cameraCloseup').addEventListener('click', () => setView('closeup'));
  const topBtn = $('cameraTop');
  if (topBtn) topBtn.addEventListener('click', () => setView('top'));
  const faceBtn = $('cameraFace');
  if (faceBtn) faceBtn.addEventListener('click', () => setView('face'));
  $('zoomIn').addEventListener('click', () => zoomBy(1 / 1.2));
  $('zoomOut').addEventListener('click', () => zoomBy(1.2));
  $('zoomReset').addEventListener('click', () => {
    orbit.th = 0.8; orbit.ph = 1.05; orbit.r = 1.35;
    viewDist.follow = 1; viewDist.closeup = 1; viewDist.top = 1; viewDist.face = 1;
    setView(S.view);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key === '1') setView('follow');
    else if (e.key === '2') setView('overview');
    else if (e.key === '3') setView('closeup');
    else if (e.key === 't' || e.key === 'T') setView('top');
    else if (e.key === 'f' || e.key === 'F') setView('face');
    else if (e.key === ' ') { e.preventDefault(); $('runBtn').click(); }
  });
  $('lightingPresetSelect').addEventListener('change', (e) => setLighting(e.target.value));
  $('togglePanel').addEventListener('click', () => {
    const hidden = $('dashboard').classList.toggle('collapsed');
    document.body.classList.toggle('panel-hidden', hidden);
    $('togglePanel').textContent = hidden ? t('showPanel') : t('hidePanel');
  });
  $('panelClose').addEventListener('click', () => $('togglePanel').click());
  // character panel
  $('beePanelToggle').addEventListener('click', () => { syncBeePanel($('beePanel').hidden); });
  $('beePanelClose').addEventListener('click', () => { syncBeePanel(false); });
  buildSubjectOptions();
  if ($('beeSubjectPreview')) $('beeSubjectPreview').addEventListener('change', (e) => setBeeSubject(e.target.value));
  // Mirror panel state + action buttons to the 3D preview (runs after each
  // control's own handler via bubbling, so it reads the updated control state).
  $('beePanel').addEventListener('input', () => applyPanelStateTo(subjectPreview?.root?.userData));
  $('beePanel').addEventListener('click', (e) => {
    const pu = subjectPreview?.root?.userData;
    if (!pu) return;
    const id = e.target.closest('button')?.id;
    if (id === 'evadeLeftBtn') pu.evade('left');
    else if (id === 'evadeRightBtn') pu.evade('right');
    else if (id === 'evadeUpBtn') pu.evade('up');
    else if (id === 'evadeDownBtn') pu.evade('down');
    else if (id === 'beeCrashBtn') pu.triggerObstacleCrash();
    else applyPanelStateTo(pu); // wing presets / pose / blackeye carry state (id-less buttons included)
  });
  if ($('wingScale')) {
    const setScale = (val) => {
      const s = clamp(Number(val) || .83, .5, 2);
      $('wingScale').value = s.toFixed(2);
      $('wingScaleOut').textContent = `${Math.round(s * 100)}%`;
      if (bee?.userData?.setWingScale) bee.userData.setWingScale(s);
      document.querySelectorAll('.bee-wing-preset').forEach((x) => x.classList.toggle('active', Math.abs(Number(x.dataset.scale) - s) < .015));
    };
    $('wingScale').addEventListener('input', (e) => setScale(e.target.value));
    document.querySelectorAll('.bee-wing-preset').forEach((b) => b.addEventListener('click', () => setScale(b.dataset.scale)));
  }
  for (const [id, dir] of [['evadeLeftBtn', 'left'], ['evadeRightBtn', 'right'], ['evadeUpBtn', 'up'], ['evadeDownBtn', 'down']]) {
    if ($(id)) $(id).addEventListener('click', () => { if (bee?.userData?.evade) bee.userData.evade(dir); });
  }
  if ($('beeCrashBtn')) $('beeCrashBtn').addEventListener('click', () => { if (bee?.userData?.triggerObstacleCrash) bee.userData.triggerObstacleCrash(); });
  $('beeBlackEyeBtn').addEventListener('click', () => {
    if (!bee?.userData?.setBlackEyeLock) return;
    const next = !bee.userData.studioState?.blackEyeLocked;
    bee.userData.setBlackEyeLock(next);
    $('beeBlackEyeBtn').textContent = next ? t('blackEyeOn') : t('blackEye');
    $('beeBlackEyeBtn').classList.toggle('active', next);
  });
  document.querySelectorAll('.bee-pose-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.bee-pose-btn').forEach((x) => x.classList.toggle('active', x === b));
    if (bee?.userData?.setWingPose) bee.userData.setWingPose(b.dataset.pose, Number($('wingAngle')?.value || 35));
  }));
  $('wingAngle').addEventListener('input', (e) => {
    $('wingAngleOut').textContent = `${e.target.value}°`;
    if (bee?.userData?.setWingPose) bee.userData.setWingPose('custom', Number(e.target.value));
  });
  $('flapSpeed').addEventListener('input', (e) => {
    $('flapSpeedOut').textContent = `${(+e.target.value).toFixed(1)}×`;
    if (bee?.userData?.setFlapSpeed) bee.userData.setFlapSpeed(Number(e.target.value));
  });
  $('colorDepth').addEventListener('input', (e) => {
    $('colorDepthOut').textContent = `${Math.round(+e.target.value * 100)}%`;
    if (bee?.userData?.setColorDepth) bee.userData.setColorDepth(Number(e.target.value));
  });
  $('beeColor').addEventListener('input', (e) => { bee.userData.bodyMaterial.color.set(e.target.value); });
  $('wingOpacity').addEventListener('input', (e) => {
    bee.userData.wingMaterial.opacity = Number(e.target.value) / 100;
    $('wingOpacityOut').textContent = `${e.target.value}%`;
  });
  $('subWings').addEventListener('change', (e) => { if (bee?.userData?.setSubWingsVisible) bee.userData.setSubWingsVisible(e.target.checked); });
  $('wallTransparency').addEventListener('input', (e) => {
    $('wallTransparencyOut').textContent = setSceneWallTransparency(obstacles, e.target.value, S.view);
  });
  // weights
  $('loadPretrainedBtn').addEventListener('click', async () => {
    if (!network) return;
    try {
      const r = await fetch(resolvePaths().gains);
      network.loadWeights((await r.json()).gains);
      setStatus('pretrainedLoaded', 'pretrained-gains.json');
    } catch (e) { alert(t('alertPretrained')); setStatus('weightsError'); }
  });
  $('saveWeightsBtn').addEventListener('click', () => {
    if (!network) return;
    const payload = { ...network.exportWeights(), scenario: S.mazeId, seed: S.seed };
    download(`pretrained-gains-${payload.scenario}-seed-${payload.seed}.json`, JSON.stringify(payload, null, 2));
    setStatus('weightsSaved');
  });
  $('loadWeightsFileBtn').addEventListener('click', () => $('weightsFileInput').click());
  $('weightsFileInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f || !network) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        const shaped = data.gains?.monocular || data.gains?.binocular ? data.gains : data;
        network.loadWeights(shaped); setStatus('pretrainedLoaded', f.name);
      }
      catch (err) { alert(t('alertWeights')); setStatus('weightsError'); }
      $('weightsFileInput').value = '';
    };
    rd.readAsText(f);
  });
  $('learnReset').addEventListener('click', () => { if (network) { network.resetLearning(); setStatus('learnReset'); } });
  // experiment
  $('smokeBtn').addEventListener('click', () => {
    S.lastSmoke = smokeCheck();
    renderSmoke();
  });
  $('expBtn').addEventListener('click', () => {
    if (!S.lastEp) { alert(t('alertNoEp')); return; }
    download('experiment_result.json', JSON.stringify(S.lastEp, null, 2));
  });
  // i18n
  $('langSelect').addEventListener('change', (e) => {
    setLang(e.target.value);
    $('runBtn').textContent = S.running ? t('pause') : t('run');
    $('recBtn').classList.toggle('on', !!(S.mediaRec && S.mediaRec.state !== 'inactive'));
    $('recBtn').title = (S.mediaRec && S.mediaRec.state !== 'inactive') ? `${t('recording')} ${recElapsed(S.recT0)}` : t('record');
    $('tabRecBtn').classList.toggle('on', !!(S.tabRec && S.tabRec.state !== 'inactive'));
    $('tabRecBtn').textContent = ((S.tabRec && S.tabRec.state !== 'inactive') ? '⏹ ' : '● ') + ((S.tabRec && S.tabRec.state !== 'inactive') ? t('tabRecording') : t('tabRecord'));
    $('tabRecBtn').title = (S.tabRec && S.tabRec.state !== 'inactive') ? `${t('tabRecording')} ${recElapsed(S.tabT0)}` : t('tabRecord');
    syncNoHazardsBtn();
    $('togglePanel').textContent = $('dashboard').classList.contains('collapsed') ? t('showPanel') : t('hidePanel');
    $('beeBlackEyeBtn').textContent = bee.userData.studioState?.blackEyeLocked ? t('blackEyeOn') : t('blackEye');
    $('visionCaption').innerHTML = t('visionCaption');
    buildSubjectOptions();
    refreshScenarios();
    setGraphInfo();
    updateControlMode();
    setStatus(statusKey, statusArg);
    if (S.benchRows) renderBenchTable();
    renderSmoke();
    syncA11y();
    updateObstacleCount();
    setView(S.view);
    updateHUD();
    if (!S.running && fly.elapsed === 0) $('activeNodes').innerHTML = `<span>${S.controller === 'camera' ? t('activeCameraOff') : t('activeIdle')}</span>`;
  });
}

// ---------- boot ----------
function setGraphInfo() {
  if (loadedGraph) {
    const ns = loadedGraph.nodes || [], es = loadedGraph.edges || [];
    const motor = ns.filter((n) => n.superclass === 'vnc_motor').length;
    const visual = ns.filter((n) => ['visual_projection', 'visual_centrifugal'].includes(n.superclass)).length;
    const descending = ns.filter((n) => n.superclass === 'descending_neuron').length;
    $('graphInfo').textContent = t('graphInfoFmt')(loadedGraph.node_count || ns.length, visual, descending, motor, es.length);
  } else {
    $('graphInfo').textContent = t('graphFallback');
  }
}

async function loadGraphFile(url) {
  const text = await (await fetch(url)).text();
  const m = text.match(/window\.(?:FLIGHT_GRAPH|FLIGHT_CIRCUIT_EXTENSION)\s*=\s*(\{[\s\S]*\});?\s*$/);
  const obj = m ? JSON.parse(m[1]) : JSON.parse(text);
  if (!obj.edges && Array.isArray(obj.pairs)) {
    obj.edges = obj.pairs.map((p) => ({ source: p.src ?? p.source, target: p.dst ?? p.target, weight: p.w ?? p.weight }));
  }
  return obj;
}

async function boot() {
  initLang($('langSelect'));
  syncA11y();
  $('seed').value = S.seed;
  setWorld(S.seed);
  resetFlight(false);
  initUI();
  syncEyeUI();
  syncSensorUI();
  syncNoHazardsBtn();
  fitCanvas();
  setView('overview');
  $('expOut').textContent = t('expDefault');
  $('visionCaption').innerHTML = t('visionCaption');
  updateHUD();
  setStatus('ready');
  if (!S.running && fly.elapsed === 0) $('activeNodes').innerHTML = `<span>${S.controller === 'camera' ? t('activeCameraOff') : t('activeIdle')}</span>`;
  requestAnimationFrame(loop);
  // connectome graphs (base + flight extension); camera-rule fallback if unavailable.
  try {
    $('graphInfo').textContent = t('graphLoading');
    const P = resolvePaths();
    const base = await loadGraphFile(P.connectomeBase);
    const ext = await loadGraphFile(P.connectomeExt);
    loadedGraph = mergeFlightGraphs(base, ext);
    network = createFlightConnectome(loadedGraph);
    network.setLearningRate(S.learnRate);
  } catch (e) {
    loadedGraph = null;
    network = null;
    S.controller = 'camera';
    $('controlMode').value = 'camera';
    updateControlMode();
  }
  setGraphInfo();
  updateHUD();
}
boot();
