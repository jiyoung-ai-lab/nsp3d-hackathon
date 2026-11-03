#!/usr/bin/env node
// NSP 3D port of reference/verify-flight-circuit.js (ESM, zero hardcoded paths).
// Same behavioral contracts, adapted to the nsp3d module layout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collisionTurnDirection, pointSegmentDistance, goalReachedDuringStep } from '../src/sim/flight-physics.js';
import { createCameraVisionDecoder } from '../src/vision/camera-vision.js';
import { mergeFlightGraphs, instantiateAnatomicalCore, createFlightConnectome } from '../src/nn/graph-network.js';
import { applyObstacleMotion } from '../src/sim/obstacle-motion.js';
import { REFERENCE_MAZE_LAYOUTS, REFERENCE_HAZARD_POOLS } from '../src/sim/maze-layouts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadGraphFile(rel) {
  const text = read(rel);
  const m = text.match(/window\.(?:FLIGHT_GRAPH|FLIGHT_CIRCUIT_EXTENSION)\s*=\s*(\{[\s\S]*\});?\s*$/);
  const obj = m ? JSON.parse(m[1]) : JSON.parse(text);
  if (!obj.edges && Array.isArray(obj.pairs)) {
    obj.edges = obj.pairs.map((p) => ({ source: p.src ?? p.source, target: p.dst ?? p.target, weight: p.w ?? p.weight }));
  }
  return obj;
}
const FLIGHT_GRAPH = loadGraphFile('vendor/connectome/flight-graph.js');
const FLIGHT_CIRCUIT_EXTENSION = loadGraphFile('vendor/connectome/flight-circuit-extension.js');
const graph = mergeFlightGraphs(FLIGHT_GRAPH, FLIGHT_CIRCUIT_EXTENSION);

assert.equal(collisionTurnDirection(0, 1, 0, -1), -1, 'head-on obstacle must use the sensory escape side');
assert.equal(collisionTurnDirection(-1, 0, 0, 1), -1, 'side collision must turn away from the wall');
assert.equal(collisionTurnDirection(1, 0, 0, -1), 1, 'opposite side collision must turn away from the wall');
assert.equal(pointSegmentDistance({ x: .5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 0, 'goal crossing was not detected between frames');
assert(pointSegmentDistance({ x: .5, y: .1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) > .025, 'goal detection ignored vertical separation');
assert(goalReachedDuringStep({ x: .5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, .025), 'goal crossing between frames was not counted as arrival');
assert(!goalReachedDuringStep({ x: .5, y: .1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, .025), 'goal arrival ignored vertical separation');
const visionDecoder = createCameraVisionDecoder(), cameraFrame = new Uint8ClampedArray(160 * 90 * 4);
for (let i = 0; i < cameraFrame.length; i += 4) { cameraFrame[i] = 6; cameraFrame[i + 1] = 9; cameraFrame[i + 2] = 20; cameraFrame[i + 3] = 255; }
for (let y = 0; y < 90; y++) for (let x = 0; x < 40; x++) { const i = (y * 160 + x) * 4; cameraFrame[i] = 20; cameraFrame[i + 1] = 50; cameraFrame[i + 2] = 120; }
const cameraSignals = visionDecoder.decode(cameraFrame, 160, 90);
assert(cameraSignals.leftThreat > .5 && cameraSignals.escapeDirection === 1, 'camera pixels did not identify the left-side wall and clearer right side');
const cameraNet = createFlightConnectome(graph), cameraNodeById = new Map(graph.nodes.map((node) => [Number(node.id), node]));
let cameraTurn, sawCameraVisual = false;
for (let tick = 0; tick < 60; tick++) { const output = cameraNet.step(cameraSignals); cameraTurn = output.turn; for (const id of output.spikes) if (['visual_projection', 'visual_centrifugal'].includes(cameraNodeById.get(id)?.superclass)) sawCameraVisual = true; }
assert(cameraTurn > 0, 'camera-derived left threat did not reach the neural turn output');
assert(sawCameraVisual, 'camera pixels did not activate any visual neuron');
assert(cameraNet.stats().active.some((node) => ['visual_projection', 'visual_centrifugal'].includes(node.superclass)), 'the live activity panel would hide all active visual neurons');
const clearFrame = new Uint8ClampedArray(160 * 90 * 4);
for (let i = 0; i < clearFrame.length; i += 4) { clearFrame[i] = 6; clearFrame[i + 1] = 9; clearFrame[i + 2] = 20; clearFrame[i + 3] = 255; }
const neutralVision = createCameraVisionDecoder().decode(clearFrame, 160, 90);
assert(!Object.hasOwn(neutralVision, 'climbCue') && !Object.hasOwn(neutralVision, 'diveCue'), 'camera parser still emits direct vertical movement commands');
const cueBypassNetwork = createFlightConnectome(graph);
let cueBypassOutput;
for (let tick = 0; tick < 20; tick++) cueBypassOutput = cueBypassNetwork.step({ climbCue: 1, diveCue: 0, frontThreat: 1 });
assert.equal(cueBypassOutput.climb, 0, 'legacy direct camera movement cue still commands a neural-group climb');
const backdropFrames = [[6, 9, 20], [18, 24, 34], [105, 108, 112], [245, 245, 245]];
for (const [r, g, b] of backdropFrames) { const frame = new Uint8ClampedArray(160 * 90 * 4); for (let i = 0; i < frame.length; i += 4) { frame[i] = r; frame[i + 1] = g; frame[i + 2] = b; frame[i + 3] = 255; } const decoded = createCameraVisionDecoder().decode(frame, 160, 90); assert.equal(decoded.wallPixels + decoded.colorPixels, 0, `plain ${r},${g},${b} backdrop was incorrectly detected as an obstacle`); }
const lowerObstacleFrame = new Uint8ClampedArray(clearFrame);
// Angular center (2a): cols 3-4 = x69-90, mid rows = y27-62; patch covers it fully.
for (let y = 27; y < 63; y++) for (let x = 64; x < 96; x++) { const i = (y * 160 + x) * 4; lowerObstacleFrame[i] = 20; lowerObstacleFrame[i + 1] = 50; lowerObstacleFrame[i + 2] = 120; lowerObstacleFrame[i + 3] = 255; }
const lowerObstacleVision = createCameraVisionDecoder().decode(lowerObstacleFrame, 160, 90);
assert(lowerObstacleVision.grid[4] > .9 && lowerObstacleVision.lowerRoute === 0, 'camera did not preserve raw center/lower image measurements');
const upperObstacleFrame = new Uint8ClampedArray(clearFrame);
for (let y = 27; y < 63; y++) for (let x = 64; x < 96; x++) { const i = (y * 160 + x) * 4; upperObstacleFrame[i] = 20; upperObstacleFrame[i + 1] = 50; upperObstacleFrame[i + 2] = 120; upperObstacleFrame[i + 3] = 255; }
for (let y = 60; y < 90; y++) for (let x = 0; x < 160; x++) { const i = (y * 160 + x) * 4; upperObstacleFrame[i] = 20; upperObstacleFrame[i + 1] = 50; upperObstacleFrame[i + 2] = 120; upperObstacleFrame[i + 3] = 255; }
const upperObstacleVision = createCameraVisionDecoder().decode(upperObstacleFrame, 160, 90);
assert(upperObstacleVision.grid[4] > .9 && upperObstacleVision.lowerRoute > .9 && upperObstacleVision.upperRoute === 0, 'camera did not preserve raw upper/lower route measurements');
const equalRoutesFrame = new Uint8ClampedArray(clearFrame);
for (let y = 27; y < 63; y++) for (let x = 64; x < 96; x++) { const i = (y * 160 + x) * 4; equalRoutesFrame[i] = 20; equalRoutesFrame[i + 1] = 50; equalRoutesFrame[i + 2] = 120; equalRoutesFrame[i + 3] = 255; }
for (let y = 0; y < 30; y++) for (let x = 0; x < 160; x++) { const i = (y * 160 + x) * 4; equalRoutesFrame[i] = 20; equalRoutesFrame[i + 1] = 50; equalRoutesFrame[i + 2] = 120; equalRoutesFrame[i + 3] = 255; }
for (let y = 60; y < 90; y++) for (let x = 0; x < 160; x++) { const i = (y * 160 + x) * 4; equalRoutesFrame[i] = 20; equalRoutesFrame[i + 1] = 50; equalRoutesFrame[i + 2] = 120; equalRoutesFrame[i + 3] = 255; }
const blockedRoutesVision = createCameraVisionDecoder().decode(equalRoutesFrame, 160, 90);
assert(blockedRoutesVision.upperRoute > .9 && blockedRoutesVision.lowerRoute > .9, 'camera failed to report both routes blocked');

assert(graph.nodes.length > FLIGHT_GRAPH.nodes.length, 'extension nodes were not merged');
assert(graph.edges.length > FLIGHT_GRAPH.edges.length, 'extension edges were not merged');
const byId = new Map(graph.nodes.map((node) => [node.id, node]));
assert(graph.edges.some((edge) => byId.get(edge.source)?.type === 'LPLC2' && byId.get(edge.target)?.type === 'DNp06'));
assert(graph.edges.some((edge) => byId.get(edge.source)?.type === 'DNp06' && byId.get(edge.target)?.superclass === 'vnc_motor'));

function exercise(side) {
  const network = createFlightConnectome(graph);
  let sawVisual = false, sawDNp06 = false, motorActivity = 0, tail = [];
  for (let tick = 0; tick < 60; tick++) {
    const output = network.step({
      leftThreat: side === 'left' ? 1 : 0,
      rightThreat: side === 'right' ? 1 : 0,
      loomingL: side === 'left' ? 0.5 : 0,
      loomingR: side === 'right' ? 0.5 : 0,
    });
    motorActivity = Math.max(motorActivity, output.leftMotor + output.rightMotor);
    tail.push(output.turn);
    for (const id of output.spikes) {
      const node = byId.get(id);
      if (node?.superclass === 'visual_projection' || node?.superclass === 'visual_centrifugal') sawVisual = true;
      if (node?.type === 'DNp06') sawDNp06 = true;
    }
  }
  return { sawVisual, sawDNp06, motorActivity, tailTurn: tail.slice(-10).reduce((a, b) => a + b, 0) / 10 };
}

const left = exercise('left'), right = exercise('right');
for (const result of [left, right]) {
  assert(result.sawVisual, 'visual neurons did not spike');
  assert(result.sawDNp06, 'DNp06 did not spike');
  assert(result.motorActivity > 0, 'VNC motor activity did not occur');
}
assert(left.tailTurn > 0, 'left-side obstacle should produce a right escape turn');
assert(right.tailTurn < 0, 'right-side obstacle should produce a left escape turn');
// Mono readout count parity: the total-norm DN/motor differential is unbiased only
// while L/R pool counts stay balanced, so pin the balance and the symmetric outcome.
const balanceCore = instantiateAnatomicalCore(graph);
assert.equal(balanceCore.dnL.length, balanceCore.dnR.length, 'production DN pools must stay L/R balanced for the mono readout');
assert.equal(balanceCore.motorL.length, balanceCore.motorR.length, 'production motor pools must stay L/R balanced for the mono readout');
const symNet = createFlightConnectome(graph);
const symTail = [];
for (let tick = 0; tick < 60; tick++) symTail.push(symNet.step({ leftThreat: 1, rightThreat: 1, loomingL: .5, loomingR: .5 }).turn);
const symTurn = symTail.slice(-10).reduce((a, b) => a + b, 0) / 10;
assert(Math.abs(symTurn) < .01, `symmetric threats must not steer the production mono readout, got ${symTurn}`);

function exerciseFrontalEscape(direction) {
  const network = createFlightConnectome(graph);
  let output;
  for (let tick = 0; tick < 60; tick++) output = network.step({ frontThreat: 1, escapeDirection: direction });
  assert(direction > 0 ? output.turn > 0 : output.turn < 0, 'centered frontal threat did not produce a turn toward the clearer side');
  return output.turn;
}
const frontalRight = exerciseFrontalEscape(1), frontalLeft = exerciseFrontalEscape(-1);
const goalNetwork = createFlightConnectome(graph);
let goalTurn;
for (let tick = 0; tick < 30; tick++) goalTurn = goalNetwork.step({ goalBearing: .7 }).turn;
assert(goalTurn > 0, 'navigation cue did not steer toward a goal on the right');

function exerciseVertical(direction) {
  const network = createFlightConnectome(graph);
  let output;
  const grid = Array(9).fill(0);
  grid[4] = 1;
  if (direction === 'climb') for (let i = 6; i < 9; i++) grid[i] = 1;
  else for (let i = 0; i < 3; i++) grid[i] = 1;
  const gridWall = grid.slice(); gridWall[3] = gridWall[5] = .8; // K16-A: sides blocked
  for (let tick = 0; tick < 60; tick++) {
    output = network.step({ grid, gridWall, altitude: .08 }); // mid-air: the dive cue needs legroom (floor level correctly holds level now)
  }
  assert(network.stats().verticalCandidates > 0, 'candidate flight-control DNs were not found');
  assert(direction === 'climb' ? output.climb > 0 : output.climb < 0, `${direction} visual cue produced the wrong vertical output`);
  assert(direction === 'climb' ? output.upperActivity > output.lowerActivity : output.lowerActivity > output.upperActivity, `${direction} action sign did not come from the corresponding active visual-neuron population`);
  const before = network.stats().gains[direction];
  for (let i = 0; i < 3; i++) network.reinforce(1);
  const after = network.stats().gains[direction];
  assert(after > before, `${direction} reward did not update the action readout gain`);
  return { output: output.climb, gainBefore: before, gainAfter: after };
}

const climb = exerciseVertical('climb'), dive = exerciseVertical('dive');
const movingObstacle = { home: { x: .1, y: .04, z: 0 }, x: .1, y: .04, z: 0, motion: { axis: 'x', amplitude: .04, frequency: .8, phase: .3 } };
applyObstacleMotion([movingObstacle], 1.25, true);
const movedX = movingObstacle.x;
applyObstacleMotion([movingObstacle], 1.25, true);
assert.equal(movingObstacle.x, movedX, 'moving obstacle path is not deterministic for the same time');
assert.notEqual(movedX, movingObstacle.home.x, 'moving obstacle did not move');
applyObstacleMotion([movingObstacle], 1.25, false);
assert.equal(movingObstacle.x, movingObstacle.home.x, 'disabled motion did not restore its home position');
const movingObstacleZ = { home: { x: 0, y: .05, z: .1 }, x: 0, y: .05, z: .1, motion: { axis: 'z', amplitude: .03, frequency: 1, phase: .2 } };
applyObstacleMotion([movingObstacleZ], .8, true);
assert.notEqual(movingObstacleZ.z, movingObstacleZ.home.z, 'z-axis obstacle motion was not applied');

const layouts = REFERENCE_MAZE_LAYOUTS;
assert.equal(Object.keys(layouts).length, 10, 'the ten reference maze stages were not loaded');
for (const [name, layout] of Object.entries(layouts)) {
  assert(layout.walls.length >= 7, `${name} is missing reference maze walls`);
  assert(layout.walls.some((wall) => wall[6] === 'open_top'), `${name} has no upper passage`);
  assert(layout.walls.some((wall) => wall[6] === 'open_bottom'), `${name} has no lower passage`);
  assert(layout.hazards[0] >= 5 && layout.hazards[1] <= 10, `${name} has unexpected obstacle counts`);
  assert(REFERENCE_HAZARD_POOLS[name].length >= layout.hazards[1], `${name} is missing reference hazard placement candidates`);
}
assert.deepEqual(Object.values(layouts).map((layout) => layout.thickness), [.020, .016, .012, .009, .006, .02, .016, .012, .009, .006]);
const flyMesh = read('src/ui/hand-drawn-bee.js');
for (const feature of ['createHandDrawnBee', 'heartWing', 'SphereGeometry', 'ConeGeometry', 'wingPivots']) assert(flyMesh.includes(feature), `hand-drawn fly is missing ${feature}`);
const html = read('index.html');
assert(html.includes('src/ui/app.js') && html.includes('visionFeed') && html.includes('vision-float'), 'runtime entry or the always-visible fly camera preview are not included in the page');
for (const mod of ['src/vision/camera-vision.js', 'src/nn/graph-network.js', 'src/sim/sim-core.js', 'src/sim/maze-layouts.js', 'src/sim/obstacle-motion.js', 'src/sim/flight-physics.js', 'src/ui/hand-drawn-bee.js']) {
  assert(fs.existsSync(path.join(root, mod)), `runtime module ${mod} is missing`);
}
const appSource = read('src/ui/app.js');
const pluginImport = appSource.match(/await import\(['"]([^'"]*alif-surrogate-plugin\.js)['"]\)/);
assert(pluginImport, 'ALIF plugin dynamic import was not found in src/ui/app.js');
assert(fs.existsSync(path.resolve(root, 'src/ui', pluginImport[1])), `ALIF plugin import ${pluginImport[1]} does not resolve to an existing file (ALIF option silently falls back to LIF)`);
assert(html.includes('signalGraph') && html.includes('카메라 규칙') && html.includes('실험군 · 뉴런 제어'), 'camera-rule and neuron-control experiment groups are not exposed in the UI');
assert(!html.includes('OBJLoader'), 'old external fly model loader is still included');
assert(!read('src/ui/app.js').includes('OBJLoader') && !read('src/ui/hand-drawn-bee.js').includes('OBJLoader'), 'old external fly model loader is still imported');
console.log(JSON.stringify({ nodes: graph.nodes.length, edges: graph.edges.length, left, right, frontalEscape: { right: frontalRight, left: frontalLeft }, climb, dive, movingObstacleX: movedX, mazeStages: Object.keys(layouts).length, hazardPoolSizes: Object.fromEntries(Object.entries(REFERENCE_HAZARD_POOLS).map(([name, pool]) => [name, pool.length])), flyModel: 'hand-built Three.js geometry' }, null, 2));
