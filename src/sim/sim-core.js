// NSP 3D — sim-core.js (ESM port of the reference scene/rig/world/movement core).
// Sources: reference/app.js (scene build, EyeRig capture, makeWorld, movement),
// reference/flight-physics.js (helpers), reference/camera-vision.js (decoder).
// Data flow stays: camera pixels -> decoder signal -> sense/brain -> rule/network -> movement.
// Contact response: graded mechanosensory touch events (no kinematic yaw kick);
// rotation is delegated to the brain (rule/SNN).
// — clean-room touch reflex, no copied code.
import * as THREE from 'three';
import { WORLD, CAMERA_PIPELINE } from '../config.js';
import { getReferenceLayout, sealMazeWalls, rng } from './maze-layouts.js';
import { applyObstacleMotion } from './obstacle-motion.js';
import { collisionTurnDirection, goalReachedDuringStep, touchFromContact, stepBumpEma, isUnwedging, UNWEDGE_REVERSE, stepOdometry, isStalled, clampEyeToChamber, stunSpeedScale, resolveTouchSide } from './flight-physics.js';
import { createCameraVisionDecoder } from '../vision/camera-vision.js';

export const W = WORLD.W, Z = WORLD.Z, Y = WORLD.Y, BEE_RADIUS = WORLD.beeRadius;
// Pitch response: max body/camera pitch per unit climb command (NSP 3D deviation,
// reference used .72 ≈ 41°). At .72 every vertical maneuver swung the eye 41°,
// so the up/down sectors no longer pointed up/down and no vertical channel could
// track descents — the floor trap was unobservable. .30 (≈17°) keeps the sectors
// registered (100° FOV) so camera→neuron→behavior stays truthful, and matches
// real fly body-pitch range. Revert to .72 with this one line if needed.
export const PITCH_RESPONSE = .58;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const initialYawFor = (s, g) => Math.atan2(g.x - s.x, -(g.z - s.z));
export { applyObstacleMotion, collisionTurnDirection, goalReachedDuringStep, createCameraVisionDecoder };

export function nearestSurface(pos, ob) {
  if (ob.hx !== undefined) {
    const q = { x: clamp(pos.x, ob.x - ob.hx, ob.x + ob.hx), y: clamp(pos.y, ob.y - ob.hy, ob.y + ob.hy), z: clamp(pos.z, ob.z - ob.hz, ob.z + ob.hz) },
      delta = { x: pos.x - q.x, y: pos.y - q.y, z: pos.z - q.z };
    return { point: q, delta, distance: Math.hypot(delta.x, delta.y, delta.z) };
  }
  const delta = { x: pos.x - ob.x, y: pos.y - ob.y, z: pos.z - ob.z },
    centerDistance = Math.hypot(delta.x, delta.y, delta.z),
    surfaceDistance = Math.max(0, centerDistance - ob.radius),
    scale = centerDistance > 1e-9 ? surfaceDistance / centerDistance : 0;
  return {
    point: { x: ob.x + delta.x * (1 - scale), y: ob.y + delta.y * (1 - scale), z: ob.z + delta.z * (1 - scale) },
    delta: { x: delta.x * scale, y: delta.y * scale, z: delta.z * scale },
    distance: surfaceDistance, centerDistance,
  };
}

// ---- world construction (reference makeWorld) ----
const HAZARD_COLORS = [0xef5d68, 0x10b981, 0xa855f7, 0xf59e0b, 0x06b6d4];
export function makeWorld(seed, scenarioId) {
  const r = rng(seed), out = [];
  const layout = getReferenceLayout(scenarioId);
  const start = { x: layout.start[0], y: Y / 3, z: -layout.start[1] }; // default spawn at 1/3 chamber height (.067), near cruise .08
  const goal = { x: layout.goal[0], y: .02, z: -layout.goal[1] };
  const sealedWalls = sealMazeWalls(layout.walls || []);
  for (const [x, z, width, length, bottom, top, wallKind] of sealedWalls) {
    out.push({ type: 'wall', wallKind, x, y: (bottom + top) / 2, z: -z, hx: width / 2, hy: (top - bottom) / 2, hz: length / 2, thickness: layout.thickness || .016 });
  }
  const [minCount, maxCount] = layout.hazards || [4, 5];
  const count = minCount + Math.floor(r() * (maxCount - minCount + 1));
  const pool = [...(layout.hazardPool || [])];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1));[pool[i], pool[j]] = [pool[j], pool[i]]; }
  for (const [i, [x, sourceZ, axis, amplitude, frequency]] of pool.slice(0, Math.min(count, pool.length)).entries()) {
    const z = -sourceZ, pillar = i % 2 === 1, radius = pillar ? .0075 : .011, y = pillar ? .10 : .038 + r() * .045;
    const hazard = pillar
      ? { type: 'pillar', x, y: .10, z, hx: radius, hy: .10, hz: radius }
      : { type: 'sphere', x, y, z, radius, color: HAZARD_COLORS[Math.floor(r() * HAZARD_COLORS.length)] };
    if (!pillar) { hazard.home = { x: hazard.x, y: hazard.y, z: hazard.z }; hazard.motion = { axis, amplitude, frequency, phase: r() * Math.PI * 2 }; }
    out.push(hazard);
  }
  return { obstacles: out, start, goal };
}

export function advanceWorld(world, time, movingEnabled) {
  applyObstacleMotion(world, time, movingEnabled);
  for (const o of world) if (o.mesh) o.mesh.position.set(o.x, o.y, o.z);
}

// ---- static scene (reference init scene block) ----
export function buildStaticScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x060914, 1.8, 4.5);
  const observerCamera = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 10);
  observerCamera.layers.set(0); observerCamera.layers.enable(1); observerCamera.layers.enable(2);

  const halfW = CAMERA_PIPELINE.frameWidth >> 1, rightW = CAMERA_PIPELINE.frameWidth - halfW, h = CAMERA_PIPELINE.frameHeight;
  const eyeCamera = new THREE.PerspectiveCamera(CAMERA_PIPELINE.fov, CAMERA_PIPELINE.frameWidth / CAMERA_PIPELINE.frameHeight, CAMERA_PIPELINE.near, CAMERA_PIPELINE.far);
  eyeCamera.layers.set(0); eyeCamera.layers.enable(3);
  const eyeCameraL = new THREE.PerspectiveCamera(CAMERA_PIPELINE.binocularFov, CAMERA_PIPELINE.binocularAspect, CAMERA_PIPELINE.near, CAMERA_PIPELINE.far);
  eyeCameraL.layers.set(0); eyeCameraL.layers.enable(3);
  const eyeCameraR = new THREE.PerspectiveCamera(CAMERA_PIPELINE.binocularFov, CAMERA_PIPELINE.binocularAspect, CAMERA_PIPELINE.near, CAMERA_PIPELINE.far);
  eyeCameraR.layers.set(0); eyeCameraR.layers.enable(3);
  const beeVisionFog = new THREE.Fog(0x060914, CAMERA_PIPELINE.fogNear, CAMERA_PIPELINE.fogFar);
  const rtOpts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true };
  const visionTarget = new THREE.WebGLRenderTarget(CAMERA_PIPELINE.frameWidth, CAMERA_PIPELINE.frameHeight, rtOpts);
  const visionTargetL = new THREE.WebGLRenderTarget(halfW, h, rtOpts);
  const visionTargetR = new THREE.WebGLRenderTarget(rightW, h, rtOpts);
  const depthTarget = new THREE.WebGLRenderTarget(CAMERA_PIPELINE.frameWidth, CAMERA_PIPELINE.frameHeight, rtOpts);
  const depthTargetL = new THREE.WebGLRenderTarget(halfW, h, rtOpts);
  const depthTargetR = new THREE.WebGLRenderTarget(rightW, h, rtOpts);

  // Hardware Linear Z-Depth Shader: sees every fly-visible surface including the
  // graded gray floor/ceiling (no world-Y kill: RGB sees them too, so depth must).
  // uNear/uFar match the fly fog range (fogNear/fogFar) so depth linD === RGB fog visibility (req 4).
  const linearDepthMaterial = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0.015 }, uFar: { value: 0.34 } },
    vertexShader: `
      varying float vViewZ;
      varying float vHorizSurface;
      void main(){
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        float nLen = length(normal);
        float ny = nLen > 0.5 ? abs( normalize(mat3(modelMatrix) * normal).y ) : 0.0;
        float isChamberSlab = (worldPos.y <= 0.0045 || worldPos.y >= 0.1955) ? 1.0 : 0.0;
        vHorizSurface = max(ny, isChamberSlab);
        vec4 mvPosition = viewMatrix * worldPos;
        vViewZ = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uNear;
      uniform float uFar;
      varying float vViewZ;
      varying float vHorizSurface;
      void main(){
        float d = clamp(1.0 - (vViewZ - uNear) / (uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(d, vHorizSurface, d > 0.0 ? 1.0 : 0.0, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  const hemiLight = new THREE.HemisphereLight(0xc6efff, 0x1a2835, 1.5); scene.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xffe1aa, 2.1); sunLight.position.set(.7, 1.3, .8); sunLight.castShadow = true; scene.add(sunLight);
  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45); rimLight.position.set(-.8, .9, -.7); scene.add(rimLight);

  // Observer-only floor: the agent sees its own layer-3 floor surface above this mesh.
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(W, .008, Z), new THREE.MeshStandardMaterial({ color: 0x101c2a, roughness: .78, metalness: .1 }));
  floorMesh.position.y = -.004; floorMesh.receiveShadow = true; scene.add(floorMesh);
  const grid = new THREE.GridHelper(1, 20, 0x26748a, 0x1d3547); grid.position.y = .001; grid.layers.set(2); scene.add(grid);

  // Outer chamber glass and frame sit on layer 2 (display-only) so the ceiling and outer glass behind the goal do not blind the fly camera
  const shell = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x64748b, transparent: true, opacity: .12, roughness: .35, metalness: .02, depthWrite: false, side: THREE.DoubleSide });
  const glassEdgeMat = new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: .58 });
  for (const [x, y, z, sx, sy, sz] of [[0, Y / 2, -Z / 2, W, Y, .0015], [0, Y / 2, Z / 2, W, Y, .0015], [-W / 2, Y / 2, 0, .0015, Y, Z], [W / 2, Y / 2, 0, .0015, Y, Z]]) {
    const geo = new THREE.BoxGeometry(sx, sy, sz), pane = new THREE.Mesh(geo, glassMat);
    pane.position.set(x, y, z); pane.layers.set(2); shell.add(pane);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), glassEdgeMat);
    edge.position.copy(pane.position); edge.layers.set(2); shell.add(edge);
  }
  scene.add(shell);

  // Fly-only chamber shell: opaque in the agent's sensory camera, while the observer keeps the transparent display shell above.
  // Fixed palette (outer wall = 4 sides + ceiling + floor): liner 0x1678ff (same as
  // interior walls); ceiling/floor neutral gray 0x646464. All fog-graded (fog:true):
  // near surfaces read hot, far fade to fog-dark. Gray neutrality (max-min<30) keeps
  // floor/ceiling separable from blue walls, red hazards, lime goal and cyan edges.
  const beeOpaqueShell = new THREE.Group(); beeOpaqueShell.name = 'bee-vision-opaque-chamber-shell';
  const beeBoundaryWallMat = new THREE.MeshBasicMaterial({ color: 0x1678ff, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide });
  const beeCeilingMat = new THREE.MeshBasicMaterial({ color: 0x646464, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide });
  const beeFloorMat = new THREE.MeshBasicMaterial({ color: 0x646464, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide });
  const beeBoundaryEdgeMat = new THREE.LineBasicMaterial({ color: 0x53f5ff, transparent: false, opacity: 1 });
  for (const [x, y, z, sx, sy, sz, mat, withEdges] of [
    [0, Y / 2, -Z / 2 + .0012, W - .002, Y - .002, .001, beeBoundaryWallMat, true],
    [0, Y / 2, Z / 2 - .0012, W - .002, Y - .002, .001, beeBoundaryWallMat, true],
    [-W / 2 + .0012, Y / 2, 0, .001, Y - .002, Z - .002, beeBoundaryWallMat, true],
    [W / 2 - .0012, Y / 2, 0, .001, Y - .002, Z - .002, beeBoundaryWallMat, true],
    [0, Y - .0012, 0, W - .002, .001, Z - .002, beeCeilingMat, false],
    [0, .0012, 0, W - .002, .001, Z - .002, beeFloorMat, false],
  ]) {
    const geo = new THREE.BoxGeometry(sx, sy, sz), surface = new THREE.Mesh(geo, mat);
    surface.position.set(x, y, z); surface.layers.set(3); surface.userData.isBeeOpaqueShell = true; beeOpaqueShell.add(surface);
    if (withEdges) {
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), beeBoundaryEdgeMat);
      edge.position.set(x, y, z); edge.layers.set(3); beeOpaqueShell.add(edge);
    }
  }
  scene.add(beeOpaqueShell);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: .24, side: THREE.DoubleSide });
  for (const [x, y, z, sx, sy, sz] of [[0, Y / 2, -Z / 2, W, Y, .004], [0, Y / 2, Z / 2, W, Y, .004], [-W / 2, Y / 2, 0, .004, Y, Z], [W / 2, Y / 2, 0, .004, Y, Z]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMat);
    m.position.set(x, y, z); m.layers.set(2); scene.add(m);
  }
  // Observer ceiling stays in the scene (chamber geometry intact) but fully
  // transparent, so the top/overview observer view is never blocked. Fly vision
  // keeps its own opaque layer-3 ceiling; the flight ceiling clamp is unchanged.
  const observerCeilingMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const observerCeiling = new THREE.Mesh(new THREE.BoxGeometry(W, .003, Z), observerCeilingMat);
  observerCeiling.position.set(0, Y, 0); observerCeiling.layers.set(2);
  observerCeiling.userData.isObserverCeiling = true; scene.add(observerCeiling);

  // Goal beacon uses neon-lime (0x39ff14) so camera-vision.js detects it as a non-obstacle target beacon
  const goalGroup = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.022, .0022, 10, 32), new THREE.MeshBasicMaterial({ color: 0x39ff14, fog: false }));
  goalGroup.add(ring);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.005, 12, 10), new THREE.MeshBasicMaterial({ color: 0x39ff14, fog: false }));
  goalGroup.add(dot);
  scene.add(goalGroup);

  const sensorShell = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshBasicMaterial({ color: 0x36c7e5, wireframe: true, transparent: true, opacity: .22 }));
  sensorShell.visible = false; sensorShell.layers.set(2); scene.add(sensorShell);
  const groundShadow = new THREE.Mesh(new THREE.CircleGeometry(.012, 20), new THREE.MeshBasicMaterial({ color: 0x02060c, transparent: true, opacity: .55, depthWrite: false }));
  groundShadow.rotation.x = -Math.PI / 2; groundShadow.position.y = .001; groundShadow.layers.set(2); scene.add(groundShadow);
  const altitudeGuide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0x45c6dc, dashSize: .004, gapSize: .003, transparent: true, opacity: .6 }));
  altitudeGuide.computeLineDistances(); altitudeGuide.layers.set(2); scene.add(altitudeGuide);

  return {
    scene, observerCamera, eyeCamera, eyeCameraL, eyeCameraR, beeVisionFog,
    visionTarget, visionTargetL, visionTargetR, depthTarget, depthTargetL, depthTargetR,
    linearDepthMaterial, goalGroup, sensorShell, groundShadow, altitudeGuide, floorMesh,
    hemiLight, sunLight, rimLight,
  };
}

// ---- obstacle meshes (reference setWorld mesh block) ----
function stripeTexture() {
  if (typeof document === 'undefined') return null;
  const stripe = document.createElement('canvas'); stripe.width = 128; stripe.height = 128;
  const c = stripe.getContext('2d');
  c.fillStyle = '#f59e0b'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#101827';
  for (let k = -128; k < 256; k += 32) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 16, 0); c.lineTo(k + 144, 128); c.lineTo(k + 128, 128); c.closePath(); c.fill(); }
  const tex = new THREE.CanvasTexture(stripe); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 5);
  return tex;
}

export function buildObstacleMesh(o) {
  let mesh;
  if (o.type === 'wall') {
    mesh = new THREE.Group(); mesh.userData.isInteriorWall = true;
    const gate = o.wallKind === 'open_top', under = o.wallKind === 'open_bottom';
    const color = gate ? 0x075985 : under ? 0x4338ca : 0x1e3a8a;
    const edgeColor = gate ? 0xf59e0b : under ? 0x38bdf8 : 0x60a5fa;
    const geo = new THREE.BoxGeometry(o.hx * 2, o.hy * 2, o.hz * 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: .18, metalness: .08, emissive: gate ? 0x061d2a : 0x0a112c, transparent: true, opacity: gate ? .44 : under ? .46 : .39, depthWrite: false, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(geo, mat);
    panel.userData.isInteriorWall = true; panel.layers.set(1); panel.castShadow = true; panel.receiveShadow = true;
    mesh.add(panel);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: .88 }));
    edges.userData.isInteriorWall = true; edges.layers.set(1); mesh.add(edges);
    const beePanel = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1678ff, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide }));
    beePanel.layers.set(3); beePanel.userData.isBeeVisionMaze = true; mesh.add(beePanel);
    const beeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x53f5ff, transparent: false, opacity: 1 }));
    beeEdges.layers.set(3); mesh.add(beeEdges);
    if (under) {
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(o.hx * 2, .08), Math.max(o.hz * 2, .08)), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: .20, side: THREE.DoubleSide, depthWrite: false }));
      portal.rotation.x = -Math.PI / 2; portal.position.y = -o.hy; portal.layers.set(2); mesh.add(portal);
    }
  } else if (o.type === 'pillar') {
    mesh = new THREE.Group();
    const tex = stripeTexture();
    const mat = tex
      ? new THREE.MeshStandardMaterial({ map: tex, roughness: .35, metalness: .1 })
      : new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: .35, metalness: .1 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(o.hx, o.hx, .20, 14), mat);
    pole.castShadow = true; pole.layers.set(1); mesh.add(pole);
    const beePole = new THREE.Mesh(pole.geometry, new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide }));
    beePole.layers.set(3); mesh.add(beePole);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(o.hx * 1.18, 12, 10), new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: .7 }));
    beacon.position.y = .102; beacon.layers.set(1); mesh.add(beacon);
    const beeBeacon = new THREE.Mesh(beacon.geometry, new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide }));
    beeBeacon.position.y = .102; beeBeacon.layers.set(3); mesh.add(beeBeacon);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(o.hx * 1.4, o.hx * 1.5, .003, 14), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
    base.position.y = -.0985; mesh.add(base);
  } else {
    mesh = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: o.color || 0x9b83ee, roughness: .28, metalness: 0, transparent: false, opacity: 1, depthWrite: true });
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(o.radius, 18, 14), mat);
    balloon.scale.set(.92, 1.12, .92); balloon.castShadow = true; balloon.layers.set(1); mesh.add(balloon);
    const beeBalloon = new THREE.Mesh(balloon.geometry, new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide }));
    beeBalloon.scale.copy(balloon.scale); beeBalloon.layers.set(3); mesh.add(beeBalloon);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(.0025, .004, 8), new THREE.MeshStandardMaterial({ color: o.color || 0x9b83ee }));
    knot.position.y = -o.radius * 1.12; knot.layers.set(1); mesh.add(knot);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -o.radius * 1.12, 0), new THREE.Vector3(0, -o.y, 0)]), new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: .48 }));
    line.layers.set(2); mesh.add(line);
  }
  mesh.position.set(o.x, o.y, o.z);
  mesh.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
  return mesh;
}

export function clearWorld(scene, obstacles) {
  for (const o of obstacles) {
    if (!o.mesh) continue;
    scene.remove(o.mesh);
    o.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) { if (material.map) material.map.dispose(); material.dispose(); }
      }
    });
    o.mesh = null;
  }
}

export function setSceneWallTransparency(obstacles, percent, cameraMode) {
  const transparency = clamp(Number(percent) / 100, .10, .85);
  const observerOpaque = cameraMode === 'overview';
  for (const ob of obstacles) {
    if (ob.type !== 'wall' || !ob.mesh) continue;
    const material = ob.mesh.children[0].material;
    const nextTransparent = !observerOpaque;
    if (material.transparent !== nextTransparent) { material.transparent = nextTransparent; material.needsUpdate = true; }
    material.opacity = observerOpaque ? 1 : 1 - transparency;
    material.depthWrite = observerOpaque;
  }
  return `${Math.round(transparency * 100)}%`;
}

// ---- agent vision capture (reference captureBeeVision, without DOM preview) ----
// three r152+ returns LINEAR readback values while the reference (r128) returns
// authored sRGB values. Encode back to sRGB so the pixel classifier (tuned on the
// reference palette) sees identical inputs; otherwise the dark navy ceiling/floor
// shell falls below the darkBackdrop threshold and turns invisible.
const SRGB_LUT = (() => {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    lut[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
  }
  return lut;
})();
// Flip a linear readback buffer rows-up while encoding to sRGB (three r152+
// returns LINEAR readback; the classifier is tuned on r128-style sRGB values).
// Shared by EyeRig and the path-planner lab page.
export function flipAndEncodeSrgb(src, dst, width, height) {
  for (let y = 0; y < height; y++) {
    const s = (height - 1 - y) * width * 4, d = y * width * 4;
    for (let x = 0; x < width * 4; x += 4) {
      dst[d + x] = SRGB_LUT[src[s + x]];
      dst[d + x + 1] = SRGB_LUT[src[s + x + 1]];
      dst[d + x + 2] = SRGB_LUT[src[s + x + 2]];
      dst[d + x + 3] = 255;
    }
  }
}
export class EyeRig {
  constructor(renderer, handles, agent, goalGroup) {
    this.renderer = renderer;
    this.H = handles;
    this.agent = agent;
    this.goalGroup = goalGroup;
    const width = CAMERA_PIPELINE.frameWidth, height = CAMERA_PIPELINE.frameHeight;
    const halfW = width >> 1, rightW = width - halfW;
    this.width = width; this.height = height;
    this.visionPixels = new Uint8Array(width * height * 4);
    this.visionPixelsL = new Uint8Array(halfW * height * 4);
    this.visionPixelsR = new Uint8Array(rightW * height * 4);
    this.depthPixels = new Uint8Array(width * height * 4);
    this.depthPixelsL = new Uint8Array(halfW * height * 4);
    this.depthPixelsR = new Uint8Array(rightW * height * 4);
    this.visionImage = new ImageData(width, height);
    this.decoder = createCameraVisionDecoder();
  }
  setAgent(agent) { this.agent = agent; } // subject swap: capture hides the current agent
  reset() { this.decoder.reset(); }
  captureFrames(pose, activeVisionMode, withDepth) {
    const { renderer, H } = this;
    const { scene, eyeCamera, eyeCameraL, eyeCameraR, beeVisionFog } = H;
    const width = this.width, height = this.height;
    const needsDepthPass = !!withDepth;
    // Agent POV follows the flight pitch so the ceiling can enter frame while climbing.
    const camPitch = clamp(pose.pitch * CAMERA_PIPELINE.pitchGain, -1.15, 1.15);
    const direction = { x: Math.sin(pose.yaw) * Math.cos(camPitch), y: Math.sin(camPitch), z: -Math.cos(pose.yaw) * Math.cos(camPitch) };
    const p = pose.pos;
    eyeCamera.position.set(p.x + direction.x * CAMERA_PIPELINE.eyeOffset, p.y + direction.y * CAMERA_PIPELINE.eyeOffset, p.z + direction.z * CAMERA_PIPELINE.eyeOffset);
    { const c = clampEyeToChamber(eyeCamera.position, WORLD); eyeCamera.position.set(c.x, c.y, c.z); }
    eyeCamera.lookAt(p.x + direction.x * CAMERA_PIPELINE.lookAhead, p.y + direction.y * CAMERA_PIPELINE.lookAhead, p.z + direction.z * CAMERA_PIPELINE.lookAhead);
    const wasVisible = this.agent.visible, oldTarget = renderer.getRenderTarget(), oldFog = scene.fog, oldPixelRatio = renderer.getPixelRatio(), oldOverride = scene.overrideMaterial;
    try {
      this.agent.visible = false; scene.fog = beeVisionFog || null;
      renderer.setPixelRatio(1);
      if (activeVisionMode === 'binocular' && eyeCameraL && eyeCameraR && H.visionTargetL && H.visionTargetR) {
        const halfW = width >> 1, rightW = width - halfW, cant = CAMERA_PIPELINE.binocularCantRad, base = CAMERA_PIPELINE.eyeBaseline;
        const rightVecX = Math.cos(pose.yaw), rightVecZ = Math.sin(pose.yaw);
        const yawL = pose.yaw - cant, yawR = pose.yaw + cant;
        const dirLX = Math.sin(yawL) * Math.cos(camPitch), dirLZ = -Math.cos(yawL) * Math.cos(camPitch);
        const dirRX = Math.sin(yawR) * Math.cos(camPitch), dirRZ = -Math.cos(yawR) * Math.cos(camPitch);
        eyeCameraL.position.set(p.x + direction.x * CAMERA_PIPELINE.eyeOffset - rightVecX * base, p.y + direction.y * CAMERA_PIPELINE.eyeOffset, p.z + direction.z * CAMERA_PIPELINE.eyeOffset - rightVecZ * base);
        { const c = clampEyeToChamber(eyeCameraL.position, WORLD); eyeCameraL.position.set(c.x, c.y, c.z); }
        eyeCameraL.lookAt(eyeCameraL.position.x + dirLX * CAMERA_PIPELINE.lookAhead, eyeCameraL.position.y + direction.y * CAMERA_PIPELINE.lookAhead, eyeCameraL.position.z + dirLZ * CAMERA_PIPELINE.lookAhead);
        eyeCameraR.position.set(p.x + direction.x * CAMERA_PIPELINE.eyeOffset + rightVecX * base, p.y + direction.y * CAMERA_PIPELINE.eyeOffset, p.z + direction.z * CAMERA_PIPELINE.eyeOffset + rightVecZ * base);
        { const c = clampEyeToChamber(eyeCameraR.position, WORLD); eyeCameraR.position.set(c.x, c.y, c.z); }
        eyeCameraR.lookAt(eyeCameraR.position.x + dirRX * CAMERA_PIPELINE.lookAhead, eyeCameraR.position.y + direction.y * CAMERA_PIPELINE.lookAhead, eyeCameraR.position.z + dirRZ * CAMERA_PIPELINE.lookAhead);
        renderer.setRenderTarget(H.visionTargetL); renderer.setViewport(0, 0, halfW, height); renderer.clear(); renderer.render(scene, eyeCameraL);
        renderer.readRenderTargetPixels(H.visionTargetL, 0, 0, halfW, height, this.visionPixelsL);
        renderer.setRenderTarget(H.visionTargetR); renderer.setViewport(0, 0, rightW, height); renderer.clear(); renderer.render(scene, eyeCameraR);
        renderer.readRenderTargetPixels(H.visionTargetR, 0, 0, rightW, height, this.visionPixelsR);
        for (let y = 0; y < height; y++) {
          const dstRow = y * width * 4, srcRowL = y * halfW * 4, srcRowR = y * rightW * 4;
          this.visionPixels.set(this.visionPixelsL.subarray(srcRowL, srcRowL + halfW * 4), dstRow);
          this.visionPixels.set(this.visionPixelsR.subarray(srcRowR, srcRowR + rightW * 4), dstRow + halfW * 4);
        }
        if (needsDepthPass && H.depthTargetL && H.depthTargetR && H.linearDepthMaterial) {
          const goalWasVis = this.goalGroup ? this.goalGroup.visible : true;
          if (this.goalGroup) this.goalGroup.visible = false;
          scene.fog = null; scene.overrideMaterial = H.linearDepthMaterial;
          renderer.setRenderTarget(H.depthTargetL); renderer.setViewport(0, 0, halfW, height); renderer.clear(); renderer.render(scene, eyeCameraL);
          renderer.readRenderTargetPixels(H.depthTargetL, 0, 0, halfW, height, this.depthPixelsL);
          renderer.setRenderTarget(H.depthTargetR); renderer.setViewport(0, 0, rightW, height); renderer.clear(); renderer.render(scene, eyeCameraR);
          renderer.readRenderTargetPixels(H.depthTargetR, 0, 0, rightW, height, this.depthPixelsR);
          scene.overrideMaterial = oldOverride; scene.fog = beeVisionFog || null;
          if (this.goalGroup) this.goalGroup.visible = goalWasVis;
          for (let y = 0; y < height; y++) {
            const dstRow = (height - 1 - y) * width * 4, srcRowL = y * halfW * 4, srcRowR = y * rightW * 4;
            this.depthPixels.set(this.depthPixelsL.subarray(srcRowL, srcRowL + halfW * 4), dstRow);
            this.depthPixels.set(this.depthPixelsR.subarray(srcRowR, srcRowR + rightW * 4), dstRow + halfW * 4);
          }
        }
      } else {
        renderer.setRenderTarget(H.visionTarget); renderer.setViewport(0, 0, width, height); renderer.clear(); renderer.render(scene, eyeCamera);
        renderer.readRenderTargetPixels(H.visionTarget, 0, 0, width, height, this.visionPixels);
        if (needsDepthPass && H.depthTarget && H.linearDepthMaterial) {
          const goalWasVis = this.goalGroup ? this.goalGroup.visible : true;
          if (this.goalGroup) this.goalGroup.visible = false;
          scene.fog = null; scene.overrideMaterial = H.linearDepthMaterial;
          renderer.setRenderTarget(H.depthTarget); renderer.setViewport(0, 0, width, height); renderer.clear(); renderer.render(scene, eyeCamera);
          const rawDepth = new Uint8Array(width * height * 4);
          renderer.readRenderTargetPixels(H.depthTarget, 0, 0, width, height, rawDepth);
          scene.overrideMaterial = oldOverride; scene.fog = beeVisionFog || null;
          if (this.goalGroup) this.goalGroup.visible = goalWasVis;
          for (let y = 0; y < height; y++) {
            const src = (height - 1 - y) * width * 4, dst = y * width * 4;
            this.depthPixels.set(rawDepth.subarray(src, src + width * 4), dst);
          }
        }
      }
    } finally {
      // Always restore renderer/scene state, even if a WebGL readback throws.
      scene.overrideMaterial = oldOverride; renderer.setScissorTest(false); renderer.setRenderTarget(oldTarget); renderer.setPixelRatio(oldPixelRatio);
      { // restore to THIS renderer's canvas, not the window: slot renderers (520x220)
        // are smaller than innerWidth/innerHeight, which used to leave them
        // showing only a corner (or nothing) after the first eye capture.
        const vsz = new THREE.Vector2();
        renderer.getSize(vsz);
        renderer.setViewport(0, 0, Math.max(1, Math.floor(vsz.x)), Math.max(1, Math.floor(vsz.y)));
      }
      scene.fog = oldFog; this.agent.visible = wasVisible;
    }
    flipAndEncodeSrgb(this.visionPixels, this.visionImage.data, width, height);
    return { image: this.visionImage, depth: needsDepthPass ? this.depthPixels : null, width, height };
  }
  captureBeeVision(pose, activeVisionMode, activeSensor) {
    const needsDepthPass = activeSensor === 'z_depth'; // fu13: fusion is fog+flow only, no depth pass
    const { width, height } = this.captureFrames(pose, activeVisionMode, needsDepthPass);
    let signal;
    if (activeVisionMode === 'binocular' && activeSensor === 'fog_rgb') signal = this.decoder.decode(this.visionImage.data, width, height, 'binocular');
    else if (activeVisionMode === 'monocular' && activeSensor === 'fog_rgb') signal = this.decoder.decode(this.visionImage.data, width, height);
    else signal = this.decoder.decode(this.visionImage.data, width, height, activeVisionMode, { sensorType: activeSensor, depthPixels: needsDepthPass ? this.depthPixels : null });
    return { signal, visionImage: this.visionImage, width, height };
  }
}

// ---- flight state + movement (reference movement) ----
export function createFlightState(start, goal) {
  return {
    pos: { ...start }, yaw: initialYawFor(start, goal), pitch: 0,
    collisions: 0, elapsed: 0, reward: 0, stunTimer: 0, escapeTimer: 0, bumpEma: 0, odo: null,
    escapeYawDir: 1, escapeNormX: 0, escapeNormZ: 0, landing: false,
    previousGoal: dist(start, goal), done: false, success: false,
    contacts: new Set(), wallTouch: false,
  };
}

export function movement(state, decision, dt, world, { speed, learning, brain, goal, collisionPenalty, timeLimit }) {
  const pos = state.pos;
  const isStunned = (state.stunTimer || 0) > 0;
  const isEscaping = (state.escapeTimer || 0) > 0;
  if (isStunned) state.stunTimer = Math.max(0, state.stunTimer - dt);
  if (isEscaping) state.escapeTimer = Math.max(0, state.escapeTimer - dt);
  // B-reflex: rotation always comes from the brain (decision.turn); escape only
  // quickens the yaw rate (saccade-like). No fixed directional override.
  const activeTurn = Number.isFinite(decision.turn) ? decision.turn : 0;
  state.yaw += activeTurn * (isEscaping ? 7.2 : 5) * dt;
  let climb = clamp(decision.climb || 0, -1, 1);
  // Physical ceiling safety: never let a persistent positive command pin the agent against the ceiling.
  // This guard is independent of the controller and does not fabricate a visual/neural cue.
  if (pos.y > Y - .035 && (climb > 0 || state.pitch > 0)) { climb = Math.min(0, climb); state.pitch = Math.min(state.pitch, -.16); }
  if (pos.y < .020 && (climb < 0 || state.pitch < 0)) { climb = Math.max(0, climb); state.pitch = Math.max(state.pitch, .08); }
  state.pitch += (climb * PITCH_RESPONSE - state.pitch) * Math.min(1, dt * 6.5);
  const velocity = { x: Math.sin(state.yaw) * Math.cos(state.pitch), y: Math.sin(state.pitch), z: -Math.cos(state.yaw) * Math.cos(state.pitch) };
  const old = { ...pos };
  // During initial collision stun (0.38s), hold position (b) while the brain
  // rotates via touch; recoil pushes out. V1.6 drove forward at .24x.
  const stunScale = stunSpeedScale(isStunned);
  // Sustained-contact withdrawal: back out of wedges at half cruise while the
  // bump rate stays high AND self-motion stalls (threading scrapes keep moving
  // and must push through). Rotation/climb stay with the brain; struggle
  // overrides startle (escalation of the touch-reflex path).
  const unwedge = isUnwedging(state.bumpEma) && isStalled(state.odo);
  const stepSpeed = unwedge ? speed * UNWEDGE_REVERSE : speed * decision.speedMultiplier * stunScale;
  const recoilScale = isStunned ? .1 : 0; // widened recoil: immediate pushback through the full stun window (unwedge reverse waits on the 10s stall gate)
  pos.x += velocity.x * stepSpeed * dt + (state.escapeNormX || 0) * recoilScale * dt;
  pos.y += velocity.y * stepSpeed * dt;
  pos.z += velocity.z * stepSpeed * dt + (state.escapeNormZ || 0) * recoilScale * dt;
  const proposed = { ...pos }, margin = BEE_RADIUS + .001;
  pos.x = clamp(pos.x, -W / 2 + margin, W / 2 - margin);
  pos.y = clamp(pos.y, margin, Y - margin);
  pos.z = clamp(pos.z, -Z / 2 + margin, Z / 2 - margin);
  let collision = false, collisionEvent = false, freshTouch = null;
  const contacts = new Set();
  for (const ob of world) {
    const hit = nearestSurface(pos, ob);
    if (hit.distance >= BEE_RADIUS) continue;
    collision = true; contacts.add(ob);
    const isNewEdge = !state.contacts?.has(ob);
    if (isNewEdge) { collisionEvent = true; state.collisions++; }
    let nx, ny, nz;
    if (ob.hx === undefined) {
      const dx = pos.x - ob.x, dy = pos.y - ob.y, dz = pos.z - ob.z, len = Math.hypot(dx, dy, dz) || 1;
      nx = dx / len; ny = dy / len; nz = dz / len;
      pos.x = ob.x + nx * (ob.radius + BEE_RADIUS + .0012);
      pos.y = ob.y + ny * (ob.radius + BEE_RADIUS + .001);
      pos.z = ob.z + nz * (ob.radius + BEE_RADIUS + .0012);
    } else {
      const q = hit.point, dx = hit.delta.x, dy = hit.delta.y, dz = hit.delta.z, len = Math.hypot(dx, dy, dz);
      if (len < 1e-8) {
        const faces = [
          { d: Math.abs(pos.x - (ob.x - ob.hx)), x: -1, y: 0, z: 0, q: { x: ob.x - ob.hx, y: clamp(pos.y, ob.y - ob.hy, ob.y + ob.hy), z: clamp(pos.z, ob.z - ob.hz, ob.z + ob.hz) } },
          { d: Math.abs(pos.x - (ob.x + ob.hx)), x: 1, y: 0, z: 0, q: { x: ob.x + ob.hx, y: clamp(pos.y, ob.y - ob.hy, ob.y + ob.hy), z: clamp(pos.z, ob.z + ob.hz, ob.z + ob.hz) } },
          { d: Math.abs(pos.z - (ob.z - ob.hz)), x: 0, y: 0, z: -1, q: { x: clamp(pos.x, ob.x - ob.hx, ob.x + ob.hx), y: clamp(pos.y, ob.y - ob.hy, ob.y + ob.hy), z: ob.z - ob.hz } },
          { d: Math.abs(pos.z - (ob.z + ob.hz)), x: 0, y: 0, z: 1, q: { x: clamp(pos.x, ob.x - ob.hx, ob.x + ob.hx), y: clamp(pos.y, ob.y - ob.hy, ob.y + ob.hy), z: ob.z + ob.hz } },
          { d: Math.abs(pos.y - (ob.y - ob.hy)), x: 0, y: -1, z: 0, q: { x: clamp(pos.x, ob.x - ob.hx, ob.x + ob.hx), y: ob.y - ob.hy, z: clamp(pos.z, ob.z - ob.hz, ob.z + ob.hz) } },
          { d: Math.abs(pos.y - (ob.y + ob.hy)), x: 0, y: 1, z: 0, q: { x: clamp(pos.x, ob.x - ob.hx, ob.x + ob.hx), y: ob.y + ob.hy, z: clamp(pos.z, ob.z - ob.hz, ob.z + ob.hz) } },
        ].sort((a, b) => a.d - b.d);
        nx = faces[0].x; ny = faces[0].y; nz = faces[0].z;
        pos.x = faces[0].q.x + nx * (BEE_RADIUS + .0012);
        pos.y = faces[0].q.y + ny * (BEE_RADIUS + .0015);
        pos.z = faces[0].q.z + nz * (BEE_RADIUS + .0012);
      } else {
        nx = dx / len; ny = dy / len; nz = dz / len;
        pos.x = q.x + nx * (BEE_RADIUS + .0012);
        pos.y = q.y + ny * (BEE_RADIUS + .0015);
        pos.z = q.z + nz * (BEE_RADIUS + .0012);
      }
    }
    // Collision resolution must not directly command climb/dive from hidden world labels.
    // Vertical maneuvers come from the camera-derived controller; contact only redirects away from the obstacle.
    // B-reflex: no kinematic yaw kick; emit a graded touch event for the SNN/rule reflex.
    freshTouch = touchFromContact(nx, nz, state.yaw, brain.escapeDirection, stepSpeed / Math.max(1e-6, speed));
    if (isNewEdge) state.escapeYawDir = freshTouch.side;
    freshTouch.side = resolveTouchSide(state.escapeYawDir, freshTouch.side, isNewEdge);
    state.escapeNormX = nx; state.escapeNormZ = nz;
    break;
  }
  state.contacts = contacts;
  const hitX = proposed.x !== pos.x && Math.abs(proposed.x) >= W / 2 - margin;
  const hitY = proposed.y !== pos.y && (proposed.y <= margin || proposed.y >= Y - margin);
  const hitZ = proposed.z !== pos.z && Math.abs(proposed.z) >= Z / 2 - margin;
  const edge = hitX || hitY || hitZ;
  collision = collision || edge;
  const isNewWallEdge = edge && !state.wallTouch;
  if (edge) {
    if (hitX || hitZ) {
      const nx = hitX ? -Math.sign(proposed.x) : 0, nz = hitZ ? -Math.sign(proposed.z) : 0;
      freshTouch = touchFromContact(nx, nz, state.yaw, brain.escapeDirection, stepSpeed / Math.max(1e-6, speed));
      if (isNewWallEdge) state.escapeYawDir = freshTouch.side;
      freshTouch.side = resolveTouchSide(state.escapeYawDir, freshTouch.side, isNewWallEdge);
      state.escapeNormX = nx; state.escapeNormZ = nz;
    }
    if (hitY) state.pitch = proposed.y > Y - margin ? -.24 : .24;
  }
  if (isNewWallEdge) { collisionEvent = true; state.collisions++; }
  state.wallTouch = edge;
  if (collisionEvent) { state.stunTimer = .38; state.escapeTimer = .48; }
  state.bumpEma = stepBumpEma(state.bumpEma, collisionEvent, dt);
  state.odo = stepOdometry(state.odo, pos, dt);

  // Smooth terminal approach instead of instant 4.5cm teleportation:
  // Within 4.5cm capture zone, smoothly glide into the goal beacon center and complete arrival within 1.1cm.
  // Declared exception (DESIGN_NOTES §8): servos to the true goal position with no re-collision check.
  const captureZoneRadius = .045, touchdownRadius = .011;
  const crossedZone = goalReachedDuringStep(goal, old, pos, captureZoneRadius);
  let d = dist(pos, goal), arrived = false;
  if (crossedZone || d <= captureZoneRadius) {
    state.landing = true;
    const pull = Math.min(1, dt * 14);
    pos.x += (goal.x - pos.x) * pull;
    pos.y += (goal.y - pos.y) * pull;
    pos.z += (goal.z - pos.z) * pull;
    d = dist(pos, goal);
    if (d <= touchdownRadius || goalReachedDuringStep(goal, old, pos, touchdownRadius)) {
      pos.x = goal.x; pos.y = goal.y; pos.z = goal.z; d = 0; arrived = true;
    }
  }
  const progress = (state.previousGoal ?? dist(old, goal)) - d;
  state.previousGoal = d;
  const stepCollisionPenalty = collisionEvent ? collisionPenalty : (collision ? .25 * dt : 0);
  const reward = clamp(progress / Math.max(.01, speed) * .15, -.08, .08) - stepCollisionPenalty + (arrived ? 1.25 : 0);
  state.reward += reward; state.elapsed += dt;
  if (arrived) { state.done = true; state.success = true; }
  if (state.elapsed >= timeLimit) state.done = true;
  // When collision occurs under Reward Learning, pass the evasive turn target to the Teacher so 3-factor learning reinforces the evasive gain
  if (learning) {
    const touchMag = freshTouch ? freshTouch.mag : .8;
    const teacherForLearn = collisionEvent && brain.teacher ? { ...brain.teacher, turn: (state.escapeYawDir || 1) * (.05 + .11 * touchMag) } : brain.teacher;
    decision.network.reinforce(reward, teacherForLearn, decision);
  }
  return { reward, progress, collision, collisionEvent, climb, activeTurn, touch: freshTouch };
}
