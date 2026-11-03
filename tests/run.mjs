// NSP 3D maintained tests (dependency-free modules only).
// Run: node --test tests/run.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sealMazeWalls, rng, REFERENCE_MAZE_LAYOUTS, REFERENCE_HAZARD_POOLS,
  toReferenceLayout, getMaze, getReferenceLayout, LOOP_RING_MAZE, listMazes,
  isReferenceMazeJson, referenceToCustomMaze, DEFAULT_CUSTOM_MAZE,
  saveCustomMaze, deleteCustomMaze,
} from '../src/sim/maze-layouts.js';
import {
  buildVoxelGrid, astar, smoothPath, pathLength,
  rayClearance, sectorRays, groundTruthClearance,
} from '../src/lab/astar.js';
import { applyObstacleMotion } from '../src/sim/obstacle-motion.js';
import { collisionTurnDirection, pointSegmentDistance, goalReachedDuringStep, touchFromContact, decayTouch, stepBumpEma, isUnwedging, UNWEDGE_BUMPS, stepOdometry, isStalled, clampEyeToChamber, EYE_CHAMBER_MARGIN, stunSpeedScale, resolveTouchSide } from '../src/sim/flight-physics.js';
import { classifyPixel, evaluateSensorPixel, createCameraVisionDecoder, createBinocularVisionDecoder } from '../src/vision/camera-vision.js';
import { senseVision, createCameraRuleController } from '../src/sim/camera-controller.js';
import { consumeSteps, SIM_STEP_H, SIM_MAX_STEPS } from '../src/sim/step-clock.js';
import { ALIFSurrogatePlugin } from '../src/vision/alif-surrogate-plugin.js';
import {
  CONFIG, mergeFlightGraphs, instantiateAnatomicalCore, createFlightConnectome, bilateralLoad,
} from '../src/nn/graph-network.js';
import { STRINGS } from '../src/ui/i18n.js';
import { SUBJECTS, DEFAULT_SUBJECT_ID, getSubject } from '../src/ui/subjects.js';

test('sealMazeWalls extends near-edge walls to the chamber border, keeps tags', () => {
  const out = sealMazeWalls([
    [-0.47, 0, 0.05, 0.2, 0, 0.2, undefined],
    [0.1, 0.2, 0.3, 0.018, 0.1, 0.2, 'open_bottom'],
  ]);
  assert.equal(out[0][0] - out[0][2] / 2, -0.5); // minX snapped to -W/2
  assert.equal(out[1][6], 'open_bottom');
});

test('REFERENCE_MAZE_LAYOUTS exposes ten stages with passages and pools', () => {
  const layouts = REFERENCE_MAZE_LAYOUTS;
  assert.equal(Object.keys(layouts).length, 10);
  for (const [name, layout] of Object.entries(layouts)) {
    assert.ok(layout.walls.length >= 7, `${name} is missing reference maze walls`);
    assert.ok(layout.walls.some((w) => w[6] === 'open_top'), `${name} has no upper passage`);
    assert.ok(layout.walls.some((w) => w[6] === 'open_bottom'), `${name} has no lower passage`);
    assert.ok(layout.hazards[0] >= 5 && layout.hazards[1] <= 10, `${name} has unexpected obstacle counts`);
    assert.ok(REFERENCE_HAZARD_POOLS[name].length >= layout.hazards[1], `${name} is missing reference hazard placement candidates`);
  }
  assert.deepEqual(Object.values(layouts).map((l) => l.thickness), [.020, .016, .012, .009, .006, .02, .016, .012, .009, .006]);
});

test('reference-format maze JSON imports through the bridge (editor/lab/sim share)', () => {
  const ref = REFERENCE_MAZE_LAYOUTS.multi_level_3d;
  assert.equal(isReferenceMazeJson(ref), true);
  assert.equal(isReferenceMazeJson({ id: 'x', walls: [{ x: 0, z: 0, w: .1, d: .1 }] }), false);
  assert.equal(isReferenceMazeJson({}), false);
  const m = referenceToCustomMaze(JSON.parse(JSON.stringify(ref)));
  assert.equal(m.id, 'custom_imported');
  assert.equal(m.walls.length, ref.walls.length);
  assert.deepEqual([m.start.x, m.start.z], [ref.start[0], -ref.start[1]]);
  assert.deepEqual([m.goal.x, m.goal.z], [ref.goal[0], -ref.goal[1]]);
});

test('listMazes always ships one editable default custom (cross-browser starter)', () => {
  const all = listMazes();
  const ids = all.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length); // no duplicate ids
  const d = getMaze(DEFAULT_CUSTOM_MAZE.id);
  assert.ok(d && d.builtin === false);
  assert.ok(d.walls.length > 0 && d.start && d.goal);
  const layout = getReferenceLayout(d.id); // sim-loadable without localStorage
  assert.equal(layout.walls.length, d.walls.length);
  assert.deepEqual(layout.start, [d.start.x, -d.start.z]);
});

test('stored custom with the default id overrides it; delete restores the default', () => {
  const store = {};
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    saveCustomMaze({ ...getMaze(DEFAULT_CUSTOM_MAZE.id), name: 'Edited' });
    const matches = listMazes().filter((m) => m.id === DEFAULT_CUSTOM_MAZE.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, 'Edited');
    deleteCustomMaze(DEFAULT_CUSTOM_MAZE.id);
    assert.equal(getMaze(DEFAULT_CUSTOM_MAZE.id).name, DEFAULT_CUSTOM_MAZE.name);
  } finally {
    if (real === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = real;
  }
});

test('maze-editor med* i18n keys exist in both locales (no raw-key fallback)', () => {
  const keys = ['medTitle', 'medRoom', 'medSub', 'medHome', 'medPresetLabel',
    'medPreset1', 'medPreset2', 'medPreset3', 'medPreset4', 'medPreset5',
    'medEasy', 'medApply', 'medTools',
    'medToolSelect', 'medToolFull', 'medToolTop', 'medToolBottom', 'medToolStart', 'medToolGoal',
    'medSelWall', 'medDelete', 'medKind', 'medKindFull', 'medKindTop', 'medKindBottom',
    'medKFull', 'medKTop', 'medKBottom', 'medX', 'medZ', 'medW', 'medL', 'medBot', 'medTop',
    'medRotate', 'medWallList', 'medWallUnit', 'medClear', 'medGuideTitle', 'medGuide',
    'medPane2d', 'medPane3d', 'medLegFull', 'medLegTop', 'medLegBottom', 'medLegStart', 'medLegGoal',
    'medToastPreset', 'medToastEasy', 'medToastApplied', 'medToastBlocked', 'medToastDeleted'];
  for (const k of keys) {
    assert.ok(STRINGS.ko[k] !== undefined, `ko.${k} missing`);
    assert.ok(STRINGS.en[k] !== undefined, `en.${k} missing`);
  }
  assert.equal(typeof STRINGS.ko.medToastPreset, 'function');
  assert.equal(typeof STRINGS.en.medToastPreset, 'function');
});

test('subject registry pins three selectable experiment subjects', () => {
  assert.deepEqual(SUBJECTS.map((s) => s.id), ['custom', 'pumpkin', 'cutefly']);
  assert.equal(DEFAULT_SUBJECT_ID, 'custom');
  assert.equal(getSubject('custom').kind, 'procedural');
  assert.equal(getSubject('honeybee2'), null); // hidden from list; code + asset kept
  assert.equal(getSubject('pumpkin').kind, 'procedural');
  assert.equal(getSubject('pumpkin').factory, 'pumpkin');
  assert.equal(getSubject('cutefly').kind, 'procedural');
  assert.equal(getSubject('cutefly').factory, 'cutefly');
  assert.equal(getSubject('cutefly').bodyTint, '#ffffff');
  assert.equal(getSubject('cutefly').depthDefault, 0.85);
  assert.equal(getSubject('nope'), null);
});

test('every subject nameKey exists in both locales (dynamic panel options)', () => {
  for (const s of SUBJECTS) {
    assert.ok(STRINGS.ko[s.nameKey] !== undefined, `ko.${s.nameKey} missing`);
    assert.ok(STRINGS.en[s.nameKey] !== undefined, `en.${s.nameKey} missing`);
  }
  assert.ok(STRINGS.ko.beePreview && STRINGS.en.beePreview);
});

test('ax-compare inherits main language (nsp_lang fallback)', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../pages/ax-compare.html', import.meta.url), 'utf8');
  assert.ok(html.includes("localStorage.getItem('nsp_lang')"), 'missing nsp_lang fallback');
});

test('toReferenceLayout tags y-ranges and negates z', () => {
  const maze = getMaze('corridor');
  const layout = toReferenceLayout(maze);
  assert.equal(layout.start[1], -maze.start.z);
  const over = layout.walls.find((w) => w[6] === 'open_top');
  assert.ok(over && over[5] < 0.2);
  const under = layout.walls.find((w) => w[6] === 'open_bottom');
  assert.ok(under && under[4] > 0);
});

test('rng is deterministic per seed', () => {
  const a = rng(7), b = rng(7);
  assert.equal(a(), b());
  assert.notEqual(rng(7)(), rng(8)());
});

test('applyObstacleMotion is deterministic and restores home when disabled', () => {
  const o = { home: { x: .1, y: .04, z: 0 }, x: .1, y: .04, z: 0, motion: { axis: 'x', amplitude: .04, frequency: .8, phase: .3 } };
  applyObstacleMotion([o], 1.25, true);
  const movedX = o.x;
  applyObstacleMotion([o], 1.25, true);
  assert.equal(o.x, movedX);
  assert.notEqual(movedX, o.home.x);
  applyObstacleMotion([o], 1.25, false);
  assert.equal(o.x, o.home.x);
  const oz = { home: { x: 0, y: .05, z: .1 }, x: 0, y: .05, z: .1, motion: { axis: 'z', amplitude: .03, frequency: 1, phase: .2 } };
  applyObstacleMotion([oz], .8, true);
  assert.notEqual(oz.z, oz.home.z);
});

test('flight-physics helpers match the reference contract', () => {
  assert.equal(collisionTurnDirection(0, 1, 0, -1), -1);
  assert.equal(collisionTurnDirection(-1, 0, 0, 1), -1);
  assert.equal(collisionTurnDirection(1, 0, 0, -1), 1);
  assert.equal(pointSegmentDistance({ x: .5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 0);
  assert.ok(pointSegmentDistance({ x: .5, y: .1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) > .025);
  assert.ok(goalReachedDuringStep({ x: .5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, .025));
  assert.ok(!goalReachedDuringStep({ x: .5, y: .1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, .025));
});

test('classifyPixel separates wall/goal/hazard/backdrop', () => {
  const wall = classifyPixel(22, 120, 255);
  assert.ok(wall.blueWall && wall.obstacle && !wall.goalBeacon);
  // Measured fogged-wall mix (bottom band) must stay a wall threat.
  const fogWall = classifyPixel(22, 97, 195);
  assert.ok(fogWall.blueWall && fogWall.obstacle);
  // Fog-void background renders dark and is excluded from everything.
  const darkFloor = classifyPixel(0, 13, 22);
  assert.ok(!darkFloor.obstacle && !darkFloor.blueWall && !darkFloor.colorObstacle);
  const lime = classifyPixel(57, 255, 20);
  assert.ok(lime.goalBeacon && !lime.obstacle);
  const red = classifyPixel(239, 93, 104);
  assert.ok(red.colorObstacle && red.obstacle);
  // Fixed fly-side hazard red (flat Basic 0xef4444, unfogged) must read as hazard.
  const fixed = classifyPixel(239, 68, 68);
  assert.ok(fixed.colorObstacle && fixed.obstacle && fixed.proximity === 1);
  for (const [r, g, b] of [[6, 9, 20], [18, 24, 34], [105, 108, 112], [245, 245, 245]]) {
    const px = classifyPixel(r, g, b);
    assert.ok(!px.obstacle && !px.goalBeacon, `plain ${r},${g},${b} misdetected`);
  }
});

test('floorSlab neutrality separates gray floor from all other classes', () => {
  // Near authored gray (0x646464, unfogged): floor obstacle with max-based proximity.
  const near = classifyPixel(100, 100, 100);
  assert.ok(near.floorSlab && near.obstacle && !near.blueWall && !near.colorObstacle);
  assert.ok(Math.abs(near.proximity - 42 / 58) < 1e-9);
  // Fogged gray @vis .93 (floor 4cm slant): still floor, graded proximity.
  const fogged = classifyPixel(94, 94, 95);
  assert.ok(fogged.floorSlab && fogged.obstacle);
  assert.ok(Math.abs(fogged.proximity - 37 / 58) < 1e-9);
  // Fogged gray @vis .55 (16cm slant): floor at the proximity floor.
  const mid = classifyPixel(58, 59, 64);
  assert.ok(mid.floorSlab && mid.obstacle && mid.proximity === 0.20);
  // Gray gap band (max<45, not dark): inert, depth veto covers it.
  assert.ok(!classifyPixel(33, 35, 43).obstacle);
  // Gray far (fog-dark): invisible.
  assert.ok(!classifyPixel(27, 29, 38).obstacle);
  // LUT-realistic gray renders read as floor; brighter-than-gray neutrals do not.
  assert.ok(classifyPixel(99, 100, 101).floorSlab);
  assert.ok(classifyPixel(102, 102, 103).floorSlab);
  assert.ok(!classifyPixel(104, 104, 105).obstacle);
  // Disjointness: every other class must never read as floor.
  for (const [r, g, b, name] of [[22, 120, 255, 'blue'], [10, 40, 85, 'blue-fog'], [8, 21, 45, 'blue-gap'], [239, 68, 68, 'red'], [78, 27, 35, 'red-fog'], [57, 255, 20, 'lime'], [75, 244, 255, 'cyan']]) {
    assert.ok(!classifyPixel(r, g, b).floorSlab, `${name} misread as floor`);
  }
});

test('floor class routes to vertical channels only (lateral zones skip floorSlab)', () => {
  // Gray blocks bottom-left (lateral third) and bottom-middle (D zone); rest fog-dark.
  // Lateral threats + sectors must read 0 (no floor pedestal); D/grid keep the floor.
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = 60; y < 90; y++) for (let x = 0; x < 40; x++) { const i = (y * width + x) * 4; frame[i] = 100; frame[i + 1] = 100; frame[i + 2] = 100; }
  for (let y = 60; y < 90; y++) for (let x = 60; x < 100; x++) { const i = (y * width + x) * 4; frame[i] = 100; frame[i + 1] = 100; frame[i + 2] = 100; }
  const signal = decoder.decode(frame, width, height);
  assert.equal(signal.leftThreat, 0, 'floor in lateral third must not pollute left threat');
  assert.equal(signal.frontThreat, 0, 'floor in frontal bottom must not pollute front threat');
  assert.ok(signal.sectors.every((v) => v === 0), 'steering sectors must not see the floor');
  assert.ok(signal.downThreat > 0.5, 'D zone keeps the graded floor');
  assert.ok(signal.grid[6] > 0.3 && signal.grid[7] > 0.3, 'bottom-row grid cells keep the floor');
  assert.ok(signal.detectedPixels > 0 && signal.wallPixels > 0, 'floor still counts as surface');
});

test('angular 8x4 core exposes cells and consistent views (mono)', () => {
  // Blue wall x0-36 (full height) lands in angular col 0 only (edge at x=37.3).
  // Partition proof: hot cells exactly {0,8,16,24}, views derive consistently.
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = 0; y < 90; y++) for (let x = 0; x < 37; x++) { const i = (y * width + x) * 4; frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255; }
  const signal = decoder.decode(frame, width, height);
  assert.equal(signal.cells.length, 32);
  for (const k of [0, 8, 16, 24]) assert.ok(signal.cells[k] > 0.9, `cell ${k} must be hot`);
  signal.cells.forEach((v, k) => { if (![0, 8, 16, 24].includes(k)) assert.equal(v, 0, `cell ${k} must be empty`); });
  assert.equal(signal.sectors.length, 8);
  assert.equal(signal.sectors[0], 1);
  assert.ok(signal.sectors.slice(1).every((v) => v === 0));
  assert.ok(signal.leftThreat > 0.5, 'L view aggregates cols 0-2');
  assert.equal(signal.frontThreat, 0);
  assert.equal(signal.rightThreat, 0);
  assert.ok(signal.grid[0] > 0.5 && signal.grid[3] > 0.5 && signal.grid[6] > 0.5, 'left grid column follows');
  assert.equal(signal.grid[4], 0);
  assert.equal(signal.escapeDirection, 1);
});

test('angular 8x4 core smoke (bino full wall)', () => {
  const decoder = createBinocularVisionDecoder();
  const width = 320, height = 180;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255; frame[i + 3] = 255; }
  const signal = decoder.decode(frame, width, height);
  assert.equal(signal.cells.length, 32);
  assert.ok(signal.cells.every((v) => v > 0.9), 'full wall must fill every cell');
  assert.ok(signal.sectors.every((v) => v === 1), 'raw sector means saturate on full wall');
  assert.ok(signal.leftThreat > 0 && signal.frontThreat > 0 && signal.rightThreat > 0);
  assert.ok(signal.detectedPixels === width * height);
});

test('decoder exposes wall-only cells excluding floor/ceiling (mono)', () => {
  // VFH valley input: cellsWall mirrors cells minus the gray floor/ceiling.
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = 0; y < 90; y++) for (let x = 0; x < 37; x++) { const i = (y * width + x) * 4; frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255; }
  for (let y = 60; y < 90; y++) for (let x = 0; x < 40; x++) { const i = (y * width + x) * 4; frame[i] = 100; frame[i + 1] = 100; frame[i + 2] = 100; }
  const signal = decoder.decode(frame, width, height);
  assert.equal(signal.cellsWall.length, 32);
  assert.equal(signal.cellsWall[0], 0, 'floor-only cell must read clear on the wall grid');
  assert.ok(signal.cells[0] > 0, 'mixed cells keep the floor');
  assert.ok(signal.cellsWall[24] > 0.9, 'pure wall cell must read hot');
});

test('decoder exposes wall-only cells excluding floor below, counting gray above (bino smoke)', () => {
  // K23: floor is impossible above a level eye — steep-up gray (ceiling/fog)
  // reads occupied; lower rows still exclude the floor. (Batch-proven: vacuous
  // row-3 zeros faked open sky and pinned climbs at the ceiling.)
  const decoder = createBinocularVisionDecoder();
  const width = 320, height = 180;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 100; frame[i + 1] = 100; frame[i + 2] = 100; frame[i + 3] = 255; }
  const signal = decoder.decode(frame, width, height);
  assert.equal(signal.cellsWall.length, 32);
  assert.ok(signal.cellsWall.slice(0, 24).every((v) => v === 0), 'uniform gray floor must read clear below the horizon');
  assert.ok(signal.cellsWall.slice(24).every((v) => v > .3), 'steep-up gray must read occupied');
  assert.ok(signal.cells.every((v) => v > 0), 'mixed cells keep the floor');
});

test('rule steers diagonally toward the open corner when confined', () => {
  // TR open (UR=0), rest blocked, front blocked: corner pulls right+climb.
  // Control (uniform corners) isolates the corner contribution differentially.
  const mk = (ur) => ({
    leftThreat: .9, rightThreat: .9, frontThreat: .9, upThreat: 0, downThreat: 0,
    grid: [.9, .8, ur, .9, .9, .9, .9, .95, .9], // lower .95 = wall base (not floor): no dive gate, pure diagonal
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.5),
  });
  const corner = createCameraRuleController().step(mk(0));
  const control = createCameraRuleController().step(mk(.9));
  assert.ok(corner.turn - control.turn > .02, 'open TR corner must add rightward pull');
  assert.ok(corner.climb > .15, 'open upper corner must add climb');
  assert.equal(control.climb, 0, 'symmetric corners must add no vertical drive');
});

test('SNN steers diagonally toward the open corner when confined (mono+bino)', () => {
  // Turn differential unobservable (readout cap saturates both sides); climb proves
  // SNN corner consumption. Explicit side (-1), frontal drive identical in both.
  for (const mode of ['monocular', 'binocular']) {
    const mkNet = () => createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const mk = (ur) => ({
      leftThreat: .9, rightThreat: .9, frontThreat: .55, upThreat: 0, downThreat: 0,
      grid: [.9, .8, ur, .9, .9, .9, .9, .95, .9], altitude: .05, // lower .95 = wall base: no dive gate
      goalVisible: 0, escapeDirection: -1, sectors: Array(8).fill(.2),
    });
    const cornerNet = mkNet(), controlNet = mkNet();
    let corner, control;
    for (let i = 0; i < 60; i++) { corner = cornerNet.step(mk(0)); control = controlNet.step(mk(.9)); }
    assert.ok(corner.climb > control.climb, `${mode}: open upper corner must add climb`);
    assert.equal(control.climb, 0, `${mode}: symmetric corners must add no vertical drive`);
  }
});

test('SNN veers on symmetric frontal blockage with no escape side (mono+bino)', () => {
  // Dead-end head-on with lastEscape=0: rule-parity default (+1) must veer right, not straight.
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step({ leftThreat: 1, rightThreat: 1, frontThreat: 1, escapeDirection: 0, sectors: Array(8).fill(1), altitude: .05 });
    assert.ok(out.turn > 0, `${mode}: confined symmetric frontal must veer, not go straight`);
  }
});

test('bino foveated columns split the frontal midline at 12.5deg', () => {
  // Wall strips at ray +/-6deg must land in the center pair (cols 3/4), never
  // spill across the midline, and never touch the lateral views (cols 0-1/6-7).
  const paint = (xs) => {
    const width = 320, height = 180;
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
    for (let y = 0; y < height; y++) for (const x of xs) { const i = (y * width + x) * 4; frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255; }
    return { frame, width, height };
  };
  const plus = paint([104, 105, 106, 223, 224, 225]); // ray +6deg both eyes
  const sigP = createBinocularVisionDecoder().decode(plus.frame, plus.width, plus.height);
  assert.ok(sigP.sectors[4] > 0 && sigP.sectors[3] === 0, 'right-of-midline strip must fill col 4 only');
  assert.ok(sigP.occupancy.front > 0 && sigP.occupancy.left === 0 && sigP.occupancy.right === 0);
  const minus = paint([94, 95, 96, 213, 214, 215]); // ray -6deg both eyes
  const sigM = createBinocularVisionDecoder().decode(minus.frame, minus.width, minus.height);
  assert.ok(sigM.sectors[3] > 0 && sigM.sectors[4] === 0, 'left-of-midline strip must fill col 3 only');
  assert.ok(sigM.occupancy.front > 0 && sigM.occupancy.left === 0 && sigM.occupancy.right === 0);
});

test('bino vertical channels use raw proximity without fovea boost', () => {
  // Uniform prox-0.5 blue everywhere: raw U/D occupancy must be exactly 0.5
  // (threat 0.7125); any fovea boost would lift it strictly above.
  const width = 320, height = 180;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 30; frame[i + 1] = 60; frame[i + 2] = 83; frame[i + 3] = 255; }
  const signal = createBinocularVisionDecoder().decode(frame, width, height);
  assert.ok(Math.abs(signal.upThreat - 0.7125) < 1e-9, `upThreat=${signal.upThreat}`);
  assert.ok(Math.abs(signal.downThreat - 0.7125) < 1e-9, `downThreat=${signal.downThreat}`);
});

test('decoder forces escape side only when frontally blocked (mono+bino)', () => {
  // Full-wall symmetric saturation (frontal high) must default right (+1); open ties hold 0.
  const blue = (w, h) => {
    const f = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < f.length; i += 4) { f[i] = 22; f[i + 1] = 120; f[i + 2] = 255; f[i + 3] = 255; }
    return f;
  };
  assert.equal(createCameraVisionDecoder().decode(blue(160, 90), 160, 90).escapeDirection, 1);
  assert.equal(createBinocularVisionDecoder().decode(blue(320, 180), 320, 180).escapeDirection, 1);
});

test('SNN holds straight on marginal symmetric ties (mono+bino)', () => {
  // Low frontal (.3, not confined): no forced side; symmetric drives hold near
  // straight within the anatomical wobble band (matches the .05 sectors pin).
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step({ leftThreat: .55, rightThreat: .55, frontThreat: .3, leftInnerThreat: .1, rightInnerThreat: .1, escapeDirection: 0, sectors: Array(8).fill(.5), altitude: .05 });
    assert.ok(Math.abs(out.turn) < .05, `${mode}: marginal tie must hold straight, got ${out.turn}`);
  }
});

test('rule bottom-gate dives on wall-above-floor-below pattern', () => {
  const mk = (upper, center, lower) => ({
    leftThreat: .5, rightThreat: .5, frontThreat: .5, upThreat: upper, downThreat: lower,
    grid: [upper, upper, upper, center, center, center, lower, lower, lower],
    gridWall: [upper, upper, upper, center, center, center, 0, 0, 0], // K19R: below reads floor-hot in mixed, wall-free underneath
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0, escapeDirection: 0, sectors: Array(8).fill(.5),
  });
  const dive = createCameraRuleController().step(mk(.8, .5, .77));
  assert.ok(dive.climb < -.1, `slot pattern must dive, got climb=${dive.climb}`);
  const wall = createCameraRuleController().step(mk(1, 1, 1));
  assert.equal(wall.climb, 0, 'full wall must not dive on the first step');
});

test('rule top-gate opens on wall-ahead approach, stays shut in empty space', () => {
  // K19R: the gate latches on VERIFIED open above (upper .1) and the hold
  // sustains the climb through the lip-hot band (upper .5) that the raw
  // evidence can no longer see — and stays shut over open floor.
  const mk = (gw, g) => ({
    leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .2, downThreat: .8,
    grid: g, gridWall: gw, goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.3),
  });
  const ctl = createCameraRuleController();
  const latch = ctl.step(
    mk([.1, .1, .1, .8, .5, .8, .2, .2, .2], [.25, .25, .25, .5, .5, .5, .85, .85, .85]));
  assert.ok(latch.climb > .5, `wall-ahead approach must climb the top gate, got ${latch.climb}`);
  const hold = ctl.step(
    mk([.5, .5, .5, .8, .8, .8, .2, .2, .2], [.25, .25, .25, .5, .5, .5, .85, .85, .85]));
  assert.ok(hold.climb > .5, `lip-hot transit must hold the climb, got ${hold.climb}`);
  const empty = createCameraRuleController().step(
    mk(Array(9).fill(.02), [.2, .2, .2, .35, .35, .35, .8, .8, .8]));
  assert.equal(empty.climb, 0, `empty space must not ignite a phantom top gate, got ${empty.climb}`);
});

test('rule VFH valley goes straight through a centered flight-band gap', () => {
  // Symmetric frontal blockage + centered wall gap in rows 1-2: the valley
  // replaces the right deadlock default with straight transit + slowdown.
  const cellsWall = Array(32).fill(0);
  for (let c = 0; c < 8; c++) cellsWall[3 * 8 + c] = 1; // wall above only
  const mk = (front) => ({
    leftThreat: .9, rightThreat: .9, frontThreat: front, upThreat: .9, downThreat: .9,
    grid: Array(9).fill(.9), gridWall: Array(9).fill(.9),
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.9), cellsWall,
  });
  const straight = createCameraRuleController().step(mk(.9));
  assert.ok(Math.abs(straight.turn) < .03, `centered valley must go straight, got turn=${straight.turn}`);
  const slow = createCameraRuleController().step(mk(.55));
  assert.ok(slow.speedMultiplier <= .61, `valley transit must slow down, got ${slow.speedMultiplier}`);
});

test('rule VFH valley steers toward an off-center gap', () => {
  // Right columns blocked in the flight band: valley center sits left of
  // heading, so transit must veer left (negative), not take the right default.
  const cellsWall = Array(32).fill(0);
  for (let c = 5; c < 8; c++) { cellsWall[1 * 8 + c] = .9; cellsWall[2 * 8 + c] = .9; }
  for (let c = 0; c < 8; c++) cellsWall[3 * 8 + c] = 1;
  const out = createCameraRuleController().step({
    leftThreat: .9, rightThreat: .9, frontThreat: .9, upThreat: .9, downThreat: .9,
    grid: Array(9).fill(.9), gridWall: Array(9).fill(.9),
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.9), cellsWall,
  });
  assert.ok(out.turn < -.02, `left valley must veer left, got turn=${out.turn}`);
});

test('rule VFH valley suppresses the top gate on level-gap approach', () => {
  // Bottom-opening approach at floor level: floor-hot lower beats wall upper,
  // which would open the top gate — but the open flight-band valley means
  // level transit, so the gate must yield and the agent flies straight-ish.
  const cellsWall = Array(32).fill(.05);
  for (let c = 0; c < 8; c++) cellsWall[3 * 8 + c] = .9; // wall above only
  const out = createCameraRuleController().step({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .6, downThreat: .8,
    grid: [.4, .4, .4, .5, .5, .5, .75, .75, .75],
    gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.6), cellsWall,
    loomingC: .25, altitude: .02,
  });
  assert.ok(out.climb < .5, `level valley must suppress gate climb, got ${out.climb}`);
  assert.ok(Math.abs(out.turn) < .05, `centered valley must go straight, got ${out.turn}`);
});

test('rule bottom gate stays shut at the floor (no legroom dive)', () => {
  // At floor level there is nowhere to dive to: the slot pattern must hold
  // level instead of commanding a futile dive into the guard.
  const out = createCameraRuleController().step({
    leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .8, downThreat: .9,
    grid: [.8, .8, .8, .5, .5, .5, .77, .77, .77],
    gridWall: [.8, .8, .8, .5, .5, .5, .77, .77, .77],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.3), loomingC: 0, altitude: .02,
  });
  assert.equal(out.climb, 0, `floor-level slot must hold level, got ${out.climb}`);
});

test('rule landing override dives to a steep-below goal despite the top gate', () => {
  // Descent to a floor goal with a wall behind it: the top gate would rather
  // climb, but a steep-below goal from altitude is a landing approach, so the
  // goal must win and the agent dives instead of hanging above the target.
  const out = createCameraRuleController().step({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .6, downThreat: .8,
    grid: [.4, .4, .4, .5, .5, .5, .75, .75, .75],
    gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
    goalVisible: .5, goalLockX: 0, goalLockY: -.4, goalBearing: 0, goalVertical: -.4,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall: Array(32).fill(.9), loomingC: .25, altitude: .1,
  });
  assert.ok(out.climb < 0, `landing approach must dive, got ${out.climb}`);
});

test('rule close-goal approach slows below the cruise cap (F-G2 sink time)', () => {
  // A big close goal (goalVis .8) leaves ~45mm to shed ~75mm of altitude after
  // a lip exit: the flat .58 cap overflies (sink ratio .5 vs needed 1.67), so
  // the approach cap must grade down with proximity (far .58 -> near .25).
  const out = createCameraRuleController().step({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(.1), gridWall: Array(9).fill(.1),
    goalVisible: .8, goalLockX: 0, goalLockY: -.5, goalBearing: 0, goalVertical: -.5,
    escapeDirection: 0, sectors: Array(8).fill(.1),
    cellsWall: Array(32).fill(.9), altitude: .1,
  });
  assert.ok(out.speedMultiplier <= .3, `close-goal approach must slow for the sink, got ${out.speedMultiplier}`);
});

test('rule committed goal locks the goal line over side walls (F-G1)', () => {
  // Landing approach (visible + below goal, off-bearing, clear front) with a
  // heavy left wall: V1.6 residual avoidance nearly cancels goal steering
  // (drift into the corner), so the goal line must dominate (suppress walls,
  // boost turn). Front must be clear: a barrier ahead keeps V1.6 avoidance.
  const out = createCameraRuleController().step({
    leftThreat: .95, rightThreat: .05, frontThreat: .2, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(.1), gridWall: Array(9).fill(.1),
    goalVisible: .8, goalLockX: -.2, goalLockY: -.4, goalBearing: 0, goalVertical: -.4,
    escapeDirection: 0,
    cellsWall: Array(32).fill(.9), altitude: .08,
  });
  assert.ok(out.turn < -.05, `committed goal must steer the goal line, got ${out.turn}`);
});

test('rule withholds goal commit when a lip stands between (barrier-between)', () => {
  // Goal visible below OVER a lip (lower wall sliver .18, front reads clear):
  // diving slow here sinks into the lip (29-hit grind), so the approach must
  // stay V1.6 (flat .58 cap, full avoidance) until past the lip.
  const out = createCameraRuleController().step({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .8,
    grid: [.1, .1, .1, .1, .1, .1, .18, .18, .18],
    gridWall: [.1, .1, .1, .1, .1, .1, .18, .18, .18],
    goalVisible: .8, goalLockX: 0, goalLockY: -.5, goalBearing: 0, goalVertical: -.5,
    escapeDirection: 0, sectors: Array(8).fill(.1),
    cellsWall: Array(32).fill(.9), altitude: .1,
  });
  assert.equal(out.speedMultiplier, .58);
});

test('rule lip memory withholds commit just past a vanished lip (latch)', () => {
  // A lip sliding under the FOV bottom goes invisible ~10mm out (lower->0)
  // while the goal stays visible: commit must stay withheld .5s past the
  // last lower sighting, then engage once truly clear.
  const ctl = createCameraRuleController();
  const mk = (lo) => ({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: [.1, .1, .1, .1, .1, .1, lo, lo, lo],
    gridWall: [.1, .1, .1, .1, .1, .1, lo, lo, lo],
    goalVisible: .8, goalLockX: 0, goalLockY: -.5, goalBearing: 0, goalVertical: -.5,
    escapeDirection: 0, sectors: Array(8).fill(.1),
    cellsWall: Array(32).fill(.9), altitude: .1, dt: 1 / 60,
  });
  ctl.step(mk(.8)); // lip seen -> latch .5s
  const held = ctl.step(mk(.1)); // instant view clear but latch holds
  assert.equal(held.speedMultiplier, .58);
  for (let i = 0; i < 40; i++) ctl.step(mk(.1)); // .67s: latch expires
  const freed = ctl.step(mk(.1));
  assert.ok(freed.speedMultiplier <= .3, `latch expired, must commit, got ${freed.speedMultiplier}`);
});

test('rule blind dive sustains the landing after the goal leaves view (F-G5)', () => {
  // A floor goal exits the FOV bottom ~60mm out (visible dive window ~0.2s):
  // a latched landing approach must keep diving + slow for 3s after the goal
  // vanishes instead of going level (SNN parity: targetTrace), then release.
  const ctl = createCameraRuleController();
  const mk = (vis) => ({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(.1), gridWall: Array(9).fill(.1),
    goalVisible: vis, goalLockX: 0, goalLockY: -.5, goalBearing: 0, goalVertical: vis > 0 ? -.5 : 0,
    escapeDirection: 0, sectors: Array(8).fill(.1),
    cellsWall: Array(32).fill(.9), altitude: .09, dt: 1 / 60,
  });
  ctl.step(mk(.8)); // landing approach: arms the 3s blind dive
  const blind = ctl.step(mk(0)); // goal vanished below the FOV
  assert.ok(blind.climb < -.5, `blind dive must continue, got ${blind.climb}`);
  assert.ok(blind.speedMultiplier <= .3, `blind dive must stay slow, got ${blind.speedMultiplier}`);
  for (let i = 0; i < 200; i++) ctl.step(mk(0)); // 3.3s: latch expires
  const free = ctl.step(mk(0));
  assert.ok(free.climb > -.2, `blind dive must end, got ${free.climb}`);
  // blind dive holds heading: heavy asymmetric walls must not drag it off-line
  const ctl2 = createCameraRuleController();
  ctl2.step(mk(.8)); // arm
  const held = ctl2.step({
    leftThreat: .9, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(.1), gridWall: Array(9).fill(.1),
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0, goalVertical: 0,
    escapeDirection: 0, cellsWall: Array(32).fill(.9), altitude: .09, dt: 1 / 60,
  });
  assert.ok(Math.abs(held.turn) < .05, `blind dive must hold heading, got ${held.turn}`);
  assert.ok(held.climb < -.5, `blind dive must continue while holding, got ${held.climb}`);
});

test('rule dive gate opens at 0.45 sensitivity (Weber-scaled bar)', () => {
  // Batch g3 ran at sensitivity .45: upperMixed caps at .45, so the fixed
  // `> .45` bar never fires and nothing ever dives (0% success, ceiling
  // ride). The mixed-grid bar must scale with visual gain.
  const out = createCameraRuleController().step({
    sensitivity: .45,
    leftThreat: .2, rightThreat: .2, frontThreat: .5, upThreat: .5, downThreat: .1,
    grid: [0, .45, 0, 0, .2, 0, 0, .1, 0],
    gridWall: [0, .9, 0, .8, .5, .8, 0, .1, 0],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0, goalVertical: 0,
    escapeDirection: 0, sectors: Array(8).fill(.5),
    cellsWall: Array(32).fill(.9), altitude: .1,
  });
  assert.ok(out.climb < -.5, `dive gate must open at sens .45, got climb ${out.climb}`);
});

test('rule dive bar unchanged at full sensitivity (V1.6 parity)', () => {
  // Same geometry at full gain with a cooler upper: no dive, exactly V1.6.
  const out = createCameraRuleController().step({
    leftThreat: .2, rightThreat: .2, frontThreat: .5, upThreat: .5, downThreat: .1,
    grid: [0, .4, 0, 0, .2, 0, 0, .1, 0],
    gridWall: [0, .9, 0, .8, .5, .8, 0, .1, 0],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0, goalVertical: 0,
    escapeDirection: 0, sectors: Array(8).fill(.5),
    cellsWall: Array(32).fill(.9), altitude: .1,
  });
  assert.ok(out.climb > -.5, `no dive below the bar at sens 1, got climb ${out.climb}`);
});

test('rule delays gate climb until near (far stays level, near climbs full)', () => {
  // K18: far readings can't tell full-height from open-top — no altitude
  // commitment until the center is near (.35). Near keeps urgency graduation.
  const mk = (centerW) => ({
    leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .25, downThreat: .8,
    grid: [.25, .25, .25, .3, .3, .3, .7, .7, .7],
    gridWall: [.1, .1, .1, .8, centerW, .8, .1, .1, .1], // K16-A: sides blocked
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.3),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .05,
  });
  const far = createCameraRuleController().step(mk(.15));
  assert.ok(far.climb < .15, `far gate must stay level, got ${far.climb}`);
  const near = createCameraRuleController().step(mk(.7));
  assert.ok(near.climb > .8, `near gate must climb full, got ${near.climb}`);
});

test('rule restores cruise altitude when high, open and goalless', () => {
  // After a climb with no gate, no goal and clear front, the agent must sink
  // back to mission altitude instead of cruising high past the target.
  // Gates in force must not blend with restoration (exclusion pin).
  const open = createCameraRuleController().step({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(0), gridWall: Array(9).fill(0),
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.1),
    cellsWall: Array(32).fill(0), loomingC: 0, altitude: .12,
  });
  assert.ok(open.climb < -.3, `high open cruise must sink toward .08, got ${open.climb}`);
  const gated = createCameraRuleController().step({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .6, downThreat: .8,
    grid: [.4, .4, .4, .5, .5, .5, .75, .75, .75],
    gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .12,
  });
  assert.ok(gated.climb > .6, `gate climb must not blend with restoration, got ${gated.climb}`);
});

test('rule pre-climb needs a near center (no far commitment)', () => {
  // K18: looming alone must not climb from far — the wall may be full-height.
  const out = createCameraRuleController().step({
    leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .2, downThreat: .8,
    grid: [.2, .2, .2, .3, .3, .3, .7, .7, .7],
    gridWall: [.1, .1, .1, .8, .15, .8, .1, .1, .1],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.3),
    cellsWall: Array(32).fill(.9), loomingC: .5, altitude: .05,
  });
  assert.ok(Math.abs(out.climb) < .1, `far loom must stay level, got ${out.climb}`);
});

test('rule near full-height corner must veer, not climb (small gradient)', () => {
  // K19R: a near corner reads lower only slightly hotter than upper (proximity
  // slope). The old differential fired the gate + killed the turn (maze2
  // ceiling pin); verified-open-above keeps the gate shut and the veer alive.
  const out = createCameraRuleController().step({
    leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: .77, downThreat: .61,
    grid: [.6, .55, .6, .7, .75, .7, .6, .6, .6],
    gridWall: [.6, .5, .6, .8, .7, .8, .6, .6, .6],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.9),
    cellsWall: Array(32).fill(.9), loomingC: .2, altitude: .05,
  });
  assert.ok(out.climb < .3, `near corner must not climb, got ${out.climb}`);
  assert.ok(Math.abs(out.turn) > 0, `near corner must veer, got turn=${out.turn}`);
});

test('rule grades gate climb by headroom near the ceiling', () => {
  // K17: documented headroom grading (was binary .16 cutoff) — near-gate
  // climb tapers at .15 instead of ramming the ceiling at full authority.
  const out = createCameraRuleController().step({
    leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .25, downThreat: .8,
    grid: [.25, .25, .25, .3, .3, .3, .7, .7, .7],
    gridWall: [.1, .1, .1, .8, .7, .8, .1, .1, .1],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.3),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .15,
  });
  assert.ok(out.climb > .6 && out.climb < .8, `headroom must grade the climb, got ${out.climb}`);
});

test('rule finds a relative valley past fog-dim side walls', () => {
  // K16-B: center blocked + sides much clearer (.35 vs .9) is a valley even
  // above the absolute .3 bar — gates vetoed, transit slowdown engaged.
  const cellsWall = Array(32).fill(.9);
  for (const r of [1, 2]) for (const c of [0, 1, 2, 5, 6, 7]) cellsWall[r * 8 + c] = .35;
  const out = createCameraRuleController().step({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .6, downThreat: .8,
    grid: [.4, .4, .4, .5, .5, .5, .75, .75, .75],
    gridWall: [.2, .2, .2, .8, .5, .8, .1, .1, .1],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall, loomingC: 0, altitude: .08,
  });
  assert.ok(Math.abs(out.climb) < .2, `relative valley must veto the gate, got ${out.climb}`);
  assert.ok(out.speedMultiplier <= .61, `relative valley must slow transit, got ${out.speedMultiplier}`);
});

test('rule vetoes the top gate when the sides are open (veer around)', () => {
  // K16-A: center-blocked + open sides must not climb — lateral veer owns it.
  const mk = (side) => ({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .2, downThreat: .8,
    grid: [.2, .2, .2, .5, .5, .5, .75, .75, .75],
    gridWall: [.2, .2, .2, side, .5, side, .1, .1, .1],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .08,
  });
  const open = createCameraRuleController().step(mk(.1));
  assert.ok(open.climb < .1, `open sides must not climb, got ${open.climb}`);
  const shut = createCameraRuleController().step(mk(.8));
  assert.ok(shut.climb > .6, `blocked sides must still climb, got ${shut.climb}`);
});

test('rule holds the gap line through centered valley with asymmetric sides', () => {
  // K15: clear-center transit must damp side veer, or the agent leaves the gap
  // for the pocket and limit-cycles (saturated pocket <-> clear gap).
  const cellsWall = Array(32).fill(.9);
  for (const r of [1, 2]) for (const c of [3, 4]) cellsWall[r * 8 + c] = 0;
  const out = createCameraRuleController().step({
    leftThreat: .8, rightThreat: .2, frontThreat: .12, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(0), gridWall: Array(9).fill(0),
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: [.8, .8, .8, .8, .2, .2, .2, .2],
    cellsWall, loomingC: 0, altitude: .08,
  });
  assert.ok(Math.abs(out.turn) < .05, `centered gap must hold straight, got turn=${out.turn}`);
});

test('rule takes off from the floor to cruise altitude when open', () => {
  // Cruise policy: open + goalless + gateless below .08 climbs toward .08
  // instead of floor-crawling from the .02 start.
  const out = createCameraRuleController().step({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(0), gridWall: Array(9).fill(0),
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0, goalVertical: 0,
    escapeDirection: 0, sectors: Array(8).fill(.1),
    cellsWall: Array(32).fill(0), loomingC: 0, altitude: .02,
  });
  assert.ok(out.climb > .4, `floor start must take off, got ${out.climb}`);
});





test('rule weak-conflict bar admits lowerMixed .55 (below-obstacle target)', () => {
  // Target past a below-obstacle reads lowerMixed ~.52: the goal must still
  // win instead of re-climbing over the target.
  const out = createCameraRuleController().step({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .2, downThreat: .55,
    grid: [.2, .2, .2, .5, .5, .5, .55, .55, .55],
    gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
    goalVisible: .5, goalLockX: 0, goalLockY: -.2, goalBearing: 0, goalVertical: -.15,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
  });
  assert.ok(out.climb < -.1, `goal must win at lowerMixed .55, got ${out.climb}`);
});

test('rule weak-conflict goal override climbs past the bottom gate', () => {
  // Symmetric case: above-goal + open bottom gate + weak upper side (<.5)
  // wins immediately instead of diving under.
  const out = createCameraRuleController().step({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .46, downThreat: .1,
    grid: [.46, .46, .46, .2, .2, .2, .1, .1, .1],
    gridWall: [.46, .46, .46, .05, .05, .05, .1, .1, .1],
    goalVisible: .5, goalLockX: 0, goalLockY: .25, goalBearing: 0, goalVertical: .2,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
  });
  assert.ok(out.climb > .15, `weak-conflict above-goal must win at once, got ${out.climb}`);
});

test('rule weak-conflict goal override dives past the top gate (shallow goal)', () => {
  // SNN parity: below-goal + open top gate + weak lower side (<.5) wins
  // immediately — no 1.2s trip wait, no steep-only landing dive.
  const out = createCameraRuleController().step({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .2, downThreat: .3,
    grid: [.2, .2, .2, .5, .5, .5, .3, .3, .3],
    gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
    goalVisible: .5, goalLockX: 0, goalLockY: -.2, goalBearing: 0, goalVertical: -.15,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
  });
  assert.ok(out.climb < -.1, `weak-conflict goal must win at once, got ${out.climb}`);
});

test('rule stuck-climb trip never fires during a gaining climb', () => {
  // Transit guard: altitude progress resets the timer, so a real climb
  // through the gate keeps authority (same step count that trips when frozen).
  const ctl = createCameraRuleController();
  let out;
  for (let i = 0; i < 100; i++) {
    out = ctl.step({
      leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .2, downThreat: .8,
      grid: [.2, .2, .2, .5, .5, .5, .75, .75, .75],
      gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
      goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
      escapeDirection: 0, sectors: Array(8).fill(.6),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1 + i * .0005,
    });
  }
  assert.ok(out.climb > .3, `gaining climb must keep authority, got ${out.climb}`);
});

test('rule stuck-climb trip vetoes a frozen top gate into a goal dive', () => {
  // SNN parity: top gate open 1.2s with a frozen world is a misread — veto
  // the gate so a shallow-below goal takes over (landing dives only catch
  // steep goals; this catches the shallow cruise-over).
  const mk = () => ({
    leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .2, downThreat: .8,
    grid: [.2, .2, .2, .5, .5, .5, .75, .75, .75],
    gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
    goalVisible: .5, goalLockX: 0, goalLockY: -.13, goalBearing: 0, goalVertical: -.1,
    escapeDirection: 0, sectors: Array(8).fill(.6),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
  });
  const ctl = createCameraRuleController();
  const first = ctl.step(mk());
  assert.ok(first.climb > .3, `gate must climb pre-trip, got ${first.climb}`);
  let out;
  for (let i = 0; i < 90; i++) out = ctl.step(mk());
  assert.ok(out.climb < 0, `tripped gate must fall through to goal dive, got ${out.climb}`);
});

test('rule softens dives at the floor guard (no floor-drag chatter)', () => {
  // Dives at the floor press the agent into the ground and chatter on the
  // touch reflex; the capture-zone servo handles touchdown, so the brain
  // must only sink softly. Strong goal-below dive must clamp to -.15.
  const out = createCameraRuleController().step({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(0), gridWall: Array(9).fill(0),
    goalVisible: .8, goalLockX: 0, goalLockY: -.5, goalBearing: 0, goalVertical: -.5,
    escapeDirection: 0, sectors: Array(8).fill(.1), loomingC: 0, altitude: .02,
  });
  assert.ok(out.climb < 0 && out.climb >= -.2, `floor dive must soften, got ${out.climb}`);
});

test('rule bottom gate opens for fog-attenuated above-walls (upper .5)', () => {
  // Threat-scale parity: the gate bar was .65 occupancy (94% on screen), so
  // fog-attenuated above-walls never opened it. Real walls at .5 must dive.
  const out = createCameraRuleController().step({
    leftThreat: .5, rightThreat: .5, frontThreat: .5, upThreat: .7, downThreat: .4,
    grid: [.5, .5, .5, .5, .5, .5, .4, .4, .4],
    gridWall: [.5, .5, .5, .5, .5, .5, 0, 0, 0], // K19R: fog-dim floor below, wall-free underneath
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.5), loomingC: 0, altitude: .1,
  });
  assert.ok(out.climb < -.1, `fog-level above-wall must dive, got ${out.climb}`);
});

test('rule slows for a near goal even when centered', () => {
  // Approach-speed guard: a big centered goal means close — cap speed so the
  // agent can curve in instead of overshooting (hollow-flow cruise guard).
  const out = createCameraRuleController().step({
    leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
    grid: Array(9).fill(0), gridWall: Array(9).fill(0),
    goalVisible: .6, goalLockX: 0, goalLockY: 0, goalBearing: 0, goalVertical: 0,
    escapeDirection: 0, sectors: Array(8).fill(.1),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .02,
  });
  assert.ok(out.speedMultiplier <= .58, `near goal must cap speed, got ${out.speedMultiplier}`);
});

test('SNN bottom-gate dives on wall-above-floor-below pattern (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const mk = (upper, center, lower) => ({
      leftThreat: .5, rightThreat: .5, frontThreat: .5, upThreat: upper, downThreat: lower,
      grid: [upper, upper, upper, center, center, center, lower, lower, lower],
      gridWall: [upper, upper, upper, center, center, center, 0, 0, 0], // K19R: below reads floor-hot in mixed, wall-free underneath
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.5), altitude: .05,
    });
    const diveNet = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let dive;
    for (let i = 0; i < 30; i++) dive = diveNet.step(mk(.8, .5, .77));
    assert.ok(dive.climb < 0, `${mode}: slot pattern must dive, got ${dive.climb}`);
    const wallNet = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let wall;
    for (let i = 0; i < 30; i++) wall = wallNet.step(mk(1, 1, 1));
    assert.ok(wall.climb >= 0, `${mode}: full wall must not dive, got ${wall.climb}`);
  }
});

test('SNN top-gate climbs over the floor-goal dive when the floor blocks below (mono+bino)', () => {
  // Regression: geometric gates vote on gridWall, but the goalOverridesGate
  // guards and climb magnitude must stay floor-aware. Wall grid fires the top
  // gate (lower wall > upper wall); mixed grid carries the floor pedestal
  // (lower mixed hot); goal sits below. Gate avoidance must win -> climb.
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .2, downThreat: .75,
      grid: [.2, .2, .2, .3, .3, .3, .75, .75, .75],
      gridWall: [.05, .05, .05, .8, .5, .8, .3, .3, .3], // K16-A sides blocked, K18 near center
      goalVisible: .5, goalLockX: 0, goalLockY: -.2, goalBearing: 0, goalVertical: -.2,
      escapeDirection: 0, sectors: Array(8).fill(.3), altitude: .02,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(out.climb > 0, `${mode}: gate must beat the floor-goal dive, got climb=${out.climb}`);
    assert.ok(out.upperDrive > 1.5, `${mode}: floor push must drive the climb, got upperDrive=${out.upperDrive}`);
  }
});

test('SNN top-gate opens on wall-ahead approach, stays shut in empty space (mono+bino)', () => {
  // Same K19R latch-then-hold pin through pools (rule parity): verified open
  // above latches the gate, the hold sustains through the lip-hot band.
  for (const mode of ['monocular', 'binocular']) {
    const mk = (gw, g) => ({
      leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .2, downThreat: .8,
      grid: g, gridWall: gw, goalVisible: 0, escapeDirection: 0,
      sectors: Array(8).fill(.3), altitude: .02,
    });
    const latchIn = mk([.1, .1, .1, .8, .5, .8, .2, .2, .2], [.25, .25, .25, .5, .5, .5, .85, .85, .85]);
    const lipIn = mk([.5, .5, .5, .8, .8, .8, .2, .2, .2], [.25, .25, .25, .5, .5, .5, .85, .85, .85]);
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 15; i++) out = net.step(latchIn);
    assert.ok(out.climb > 0, `${mode}: wall-ahead approach must climb, got ${out.climb}`);
    for (let i = 0; i < 15; i++) out = net.step(lipIn);
    assert.ok(out.climb > 0, `${mode}: lip-hot transit must hold the climb, got ${out.climb}`);
    const emptyNet = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const empty = mk(Array(9).fill(.02), [.2, .2, .2, .35, .35, .35, .8, .8, .8]);
    for (let i = 0; i < 30; i++) out = emptyNet.step(empty);
    assert.equal(out.climb, 0, `${mode}: empty space must not climb, got ${out.climb}`);
  }
});

test('SNN VFH valley goes straight through a centered flight-band gap (mono+bino)', () => {
  // Same valley contract through spiking pools: escape drive suppressed,
  // straight transit + slowdown. Saccade vetoed during transit (determinism).
  for (const mode of ['monocular', 'binocular']) {
    const cellsWall = Array(32).fill(0);
    for (let c = 0; c < 8; c++) cellsWall[3 * 8 + c] = 1;
    const input = {
      leftThreat: .9, rightThreat: .9, frontThreat: .9, upThreat: .9, downThreat: .9,
      grid: [.9, .9, .9, .9, .9, .9, 1, 1, 1], gridWall: Array(9).fill(.9),
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.9),
      cellsWall, altitude: .05,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(Math.abs(out.turn) < .03, `${mode}: centered valley must go straight, got turn=${out.turn}`);
    assert.equal(out.speedMultiplier, .6, `${mode}: valley transit must slow to .6, got ${out.speedMultiplier}`);
  }
});

test('SNN VFH valley suppresses gate climb on level-gap approach (mono+bino)', () => {
  // Same level-gap contract through pools: no gate climb, no pre-climb
  // saturation, straight transit.
  for (const mode of ['monocular', 'binocular']) {
    const cellsWall = Array(32).fill(.05);
    for (let c = 0; c < 8; c++) cellsWall[3 * 8 + c] = .9;
    const input = {
      leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .6, downThreat: .8,
      grid: [.4, .4, .4, .5, .5, .5, .75, .75, .75],
      gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.6),
      cellsWall, loomingC: .25, altitude: .02,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(out.climb < .5, `${mode}: level valley must suppress climb, got ${out.climb}`);
    assert.ok(Math.abs(out.turn) < .05, `${mode}: centered valley must go straight, got ${out.turn}`);
  }
});

test('SNN ceiling pin releases into a dive, not a frozen climb (mono+bino)', () => {
  // At the ceiling facing a wall: no headroom, so the top gate must shut and
  // the bottom gate (correctly) dives off the ceiling instead of freezing.
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .9, rightThreat: .9, frontThreat: .9, upThreat: .95, downThreat: .2,
      grid: [.8, .8, .8, .8, .8, .8, .2, .2, .2],
      gridWall: [0, 0, 0, .8, .8, .8, .05, .05, .05],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.9),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .165,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(out.climb < -.3, `${mode}: ceiling must release into a dive, got ${out.climb}`);
  }
});

test('SNN bottom gate stays shut at the floor (mono+bino)', () => {
  // Same legroom contract through pools: slot pattern at floor level holds
  // level instead of diving into the guard (and tripping the dive trap).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .8, downThreat: .9,
      grid: [.8, .8, .8, .5, .5, .5, .77, .77, .77],
      gridWall: [.8, .8, .8, .5, .5, .5, .77, .77, .77],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.3),
      loomingC: 0, altitude: .02,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.equal(out.climb, 0, `${mode}: floor-level slot must hold level, got ${out.climb}`);
  }
});

test('SNN landing override dives to a steep-below goal despite the top gate (mono+bino)', () => {
  // Same landing contract through pools: the existing floor guard would block
  // the dive (floor-hot lower), but steep-below + altitude means landing, so
  // the goal wins over the open top gate.
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .6, downThreat: .8,
      grid: [.4, .4, .4, .5, .5, .5, .75, .75, .75],
      gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
      goalVisible: .5, goalLockX: 0, goalLockY: -.4, goalBearing: 0, goalVertical: -.4,
      escapeDirection: 0, sectors: Array(8).fill(.6),
      cellsWall: Array(32).fill(.9), loomingC: .25, altitude: .1,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(out.climb < 0, `${mode}: landing approach must dive, got ${out.climb}`);
  }
});

test('SNN delays gate climb until near (far stays level, mono+bino)', () => {
  // Same K18 near-only commitment through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .25, downThreat: .8,
      grid: [.25, .25, .25, .3, .3, .3, .7, .7, .7],
      gridWall: [.1, .1, .1, .8, .15, .8, .1, .1, .1], // K16-A: sides blocked
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.3),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .05,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(Math.abs(out.climb) < .15, `${mode}: far gate must stay level, got ${out.climb}`);
  }
});

test('SNN restores cruise altitude when high, open and goalless (mono+bino)', () => {
  // Same restoration contract through pools: sink back to mission altitude
  // instead of cruising high past the target.
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
      grid: Array(9).fill(0), gridWall: Array(9).fill(0),
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.1),
      cellsWall: Array(32).fill(0), loomingC: 0, altitude: .12,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(out.climb < -.3, `${mode}: high open cruise must sink toward .08, got ${out.climb}`);
  }
});

test('SNN pre-climb needs a near center (no far commitment, mono+bino)', () => {
  // Same K18 pre-climb gate through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .2, downThreat: .8,
      grid: [.2, .2, .2, .3, .3, .3, .7, .7, .7],
      gridWall: [.1, .1, .1, .8, .15, .8, .1, .1, .1],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.3),
      cellsWall: Array(32).fill(.9), loomingC: .5, altitude: .05,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(Math.abs(out.climb) < .2, `${mode}: far loom must stay level, got ${out.climb}`);
  }
});

test('SNN near full-height corner must veer, not climb (mono+bino)', () => {
  // Same K19R corner contract through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: .77, downThreat: .61,
      grid: [.6, .55, .6, .7, .75, .7, .6, .6, .6],
      gridWall: [.6, .5, .6, .8, .7, .8, .6, .6, .6],
      goalVisible: 0, escapeDirection: 1, sectors: Array(8).fill(.9),
      cellsWall: Array(32).fill(.9), loomingC: .2, altitude: .05,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(out.climb < .3, `${mode}: near corner must not climb, got ${out.climb}`);
    assert.ok(out.turn > 0, `${mode}: near corner must veer, got turn=${out.turn}`);
  }
});

test('SNN grades asymmetric-corner climb instead of saturating (mono+bino)', () => {
  // K20-A: corner-vertical drive must ride its analog magnitude (rule gives
  // ~.25 here); the old readout binarized any cClimb to full 1.0.
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .7, rightThreat: .7, frontThreat: 1, upThreat: .6, downThreat: .8,
      grid: [.47, .47, .47, .72, .72, .72, 1, 1, 1],
      gridWall: [.47, .47, .47, .72, .72, .72, 1, 1, 1],
      goalVisible: 0, escapeDirection: 1, sectors: Array(8).fill(.7),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .05,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(out.climb > .1 && out.climb < .6, `${mode}: corner climb must grade, got ${out.climb}`);
  }
});

test('SNN veers out of symmetric .7 saturation (mono+bino)', () => {
  // K20-B: LIF pools saturate from ~.55, so the boxed gate must catch the
  // .65-.8 band the old .8 bar missed (turn collapsed to 0 there).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .7, rightThreat: .7, frontThreat: .9, upThreat: .5, downThreat: .5,
      grid: Array(9).fill(.5), gridWall: Array(9).fill(.5),
      leftOuterThreat: .7, leftInnerThreat: .7, rightInnerThreat: .7, rightOuterThreat: .7,
      goalVisible: 0, escapeDirection: 1, sectors: Array(8).fill(.7),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .05,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(out.turn > .04, `${mode}: boxed .7 must veer, got turn=${out.turn}`);
    assert.ok(Math.abs(out.climb) < .2, `${mode}: flat field must stay level, got ${out.climb}`);
  }
});

test('rule valley vetoes the lip-ratio gate clause (SNN parity)', () => {
  // K20-2: the lip-ratio clause fired without the valley guard; a centered
  // level gap must transit, never climb (SNN already guards both clauses).
  const cellsWall = Array(32).fill(.9);
  for (const r of [1, 2]) for (const c of [3, 4]) cellsWall[r * 8 + c] = 0;
  const out = createCameraRuleController().step({
    leftThreat: .8, rightThreat: .8, frontThreat: .6, upThreat: .4, downThreat: .6,
    grid: [.3, .3, .3, .8, .8, .8, .5, .5, .5],
    gridWall: [.3, .3, .3, .8, .8, .8, .5, .5, .5],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.7), cellsWall,
    loomingC: 0, altitude: .08,
  });
  assert.ok(out.climb < .3, `valley transit must not climb the lip clause, got ${out.climb}`);
  assert.equal(out.speedMultiplier, .6, `valley transit must slow, got ${out.speedMultiplier}`);
});

test('SNN valley vetoes the lip-ratio gate clause (mono+bino)', () => {
  // Same valley-lip veto through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const cellsWall = Array(32).fill(.9);
    for (const r of [1, 2]) for (const c of [3, 4]) cellsWall[r * 8 + c] = 0;
    const input = {
      leftThreat: .8, rightThreat: .8, frontThreat: .6, upThreat: .4, downThreat: .6,
      grid: [.3, .3, .3, .8, .8, .8, .5, .5, .5],
      gridWall: [.3, .3, .3, .8, .8, .8, .5, .5, .5],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.7),
      cellsWall, loomingC: 0, altitude: .08,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    assert.ok(out.climb < .3, `${mode}: valley transit must not climb, got ${out.climb}`);
    assert.equal(out.speedMultiplier, .6, `${mode}: valley transit must slow, got ${out.speedMultiplier}`);
  }
});

test('rule top hold expires after 1.0s without fresh evidence', () => {
  // K22: back-to-back walls must re-latch on fresh evidence, not stick on the
  // bridge — it covers the ~0.5s lip band only (maze6 climb-then-no-dive).
  const ctl = createCameraRuleController();
  ctl.step({
    leftThreat: .3, rightThreat: .3, frontThreat: .5, upThreat: .2, downThreat: .8,
    grid: [.25, .25, .25, .5, .5, .5, .85, .85, .85],
    gridWall: [.1, .1, .1, .8, .5, .8, .7, .7, .7],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.3),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .06,
  });
  const marginal = {
    leftThreat: .8, rightThreat: .8, frontThreat: .8, upThreat: .55, downThreat: .65,
    grid: [.5, .5, .5, .8, .8, .8, .6, .6, .6],
    gridWall: [.5, .5, .5, .8, .8, .8, .6, .6, .6],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.8),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
  };
  let out;
  for (let i = 0; i < 90; i++) out = ctl.step(marginal); // 1.5s: stale hold must die
  assert.ok(out.climb < .2, `hold must expire, got climb=${out.climb}`);
  assert.ok(Math.abs(out.turn) > 0, `veer must return, got turn=${out.turn}`);
});

test('rule top hold releases when the wall face drops below (over the lip)', () => {
  // K22: cresting the lip opens the lower cells — transit is done even with
  // the next wall ahead; the gate re-evaluates (dives under panels).
  const ctl = createCameraRuleController();
  ctl.step({
    leftThreat: .3, rightThreat: .3, frontThreat: .5, upThreat: .2, downThreat: .8,
    grid: [.25, .25, .25, .5, .5, .5, .85, .85, .85],
    gridWall: [.1, .1, .1, .8, .5, .8, .7, .7, .7],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.3),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .06,
  });
  const overLip = {
    leftThreat: .8, rightThreat: .8, frontThreat: .8, upThreat: .55, downThreat: .3,
    grid: [.5, .5, .5, .8, .8, .8, .3, .3, .3],
    gridWall: [.5, .5, .5, .8, .8, .8, .1, .1, .1],
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.8),
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
  };
  let out;
  for (let i = 0; i < 5; i++) out = ctl.step(overLip);
  assert.ok(out.climb < -.3, `over-lip release must dive under the panel, got ${out.climb}`);
});

test('SNN top hold expires after 1.0s without fresh evidence (mono+bino)', () => {
  // Same K22 bridge expiry through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const latchIn = {
      leftThreat: .3, rightThreat: .3, frontThreat: .5, upThreat: .2, downThreat: .8,
      grid: [.25, .25, .25, .5, .5, .5, .85, .85, .85],
      gridWall: [.1, .1, .1, .8, .5, .8, .7, .7, .7],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.3),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .06,
    };
    const marginal = {
      leftThreat: .8, rightThreat: .8, frontThreat: .8, upThreat: .55, downThreat: .65,
      grid: [.5, .5, .5, .8, .8, .8, .6, .6, .6],
      gridWall: [.5, .5, .5, .8, .8, .8, .6, .6, .6],
      leftOuterThreat: .8, leftInnerThreat: .8, rightInnerThreat: .8, rightOuterThreat: .8,
      goalVisible: 0, escapeDirection: 1, sectors: Array(8).fill(.8),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
    };
    for (let i = 0; i < 5; i++) net.step(latchIn);
    let out;
    for (let i = 0; i < 90; i++) out = net.step(marginal);
    assert.ok(out.climb < .2, `${mode}: hold must expire, got climb=${out.climb}`);
    assert.ok(out.turn > 0, `${mode}: veer must return, got turn=${out.turn}`);
  }
});

test('SNN top hold releases when the wall face drops below (mono+bino)', () => {
  // Same K22 over-lip release through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const latchIn = {
      leftThreat: .3, rightThreat: .3, frontThreat: .5, upThreat: .2, downThreat: .8,
      grid: [.25, .25, .25, .5, .5, .5, .85, .85, .85],
      gridWall: [.1, .1, .1, .8, .5, .8, .7, .7, .7],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.3),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .06,
    };
    const overLip = {
      leftThreat: .8, rightThreat: .8, frontThreat: .8, upThreat: .55, downThreat: .3,
      grid: [.5, .5, .5, .8, .8, .8, .3, .3, .3],
      gridWall: [.5, .5, .5, .8, .8, .8, .1, .1, .1],
      leftOuterThreat: .8, leftInnerThreat: .8, rightInnerThreat: .8, rightOuterThreat: .8,
      goalVisible: 0, escapeDirection: 1, sectors: Array(8).fill(.8),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
    };
    for (let i = 0; i < 5; i++) net.step(latchIn);
    let out;
    for (let i = 0; i < 15; i++) out = net.step(overLip);
    assert.ok(out.climb < -.3, `${mode}: over-lip release must dive, got ${out.climb}`);
  }
});

test('rule stall flag alternates the escape side (odometry)', () => {
  // K24: wall-follow orbits with real asymmetry never satisfied the symmetry
  // clause — odometry stalls flip sides instead of circling forever.
  const ctl = createCameraRuleController();
  const mk = () => ({
    leftThreat: .7, rightThreat: .6, frontThreat: .7, upThreat: .5, downThreat: .5,
    grid: Array(9).fill(.5), gridWall: Array(9).fill(.5),
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 1, sectors: [.7, .7, .7, .7, .6, .6, .6, .6],
    cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .08, stalled: true,
  });
  let early = 0, late = 0;
  for (let i = 0; i < 130; i++) { const o = ctl.step(mk()); if (i === 10) early = o.turn; if (i === 129) late = o.turn; }
  assert.ok(early > 0, `stalled veer must follow escape first, got ${early}`);
  assert.ok(late < 0, `stalled veer must flip sides, got ${late}`);
});

test('SNN stall flag alternates the escape side (mono+bino)', () => {
  // Same K24 stall-flip through pools (rule parity). Pinned on pre-pool drives:
  // the tiny test net saturates both pools (any sustained drive does) plus its
  // asymmetric LC10 helper, so turn margins are meaningless here — the drive
  // direction reversal is what breaks orbits (turn outcome validated in batch
  // on the production net).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .7, rightThreat: .6, frontThreat: .7, upThreat: .5, downThreat: .5,
      grid: Array(9).fill(.5), gridWall: Array(9).fill(.5),
      leftOuterThreat: .7, leftInnerThreat: .7, rightInnerThreat: .7, rightOuterThreat: .6,
      goalVisible: 0, escapeDirection: 1, sectors: [.7, .7, .7, .7, .6, .6, .6, .6],
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .08, stalled: true,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let early = 0, late = 0;
    for (let i = 0; i < 130; i++) { const o = net.step(input); if (i === 10) early = o.leftDrive - o.rightDrive; if (i === 129) late = o.leftDrive - o.rightDrive; }
    assert.ok(early > .3, `${mode}: stalled drive must follow escape first, got ${early}`);
    assert.ok(late < -.3, `${mode}: stalled drive must flip sides, got ${late}`);
  }
});

test('SNN grades gate climb by headroom near the ceiling (mono+bino)', () => {
  // Same K17 headroom grading through pools: high gate climb must be weaker
  // than the identical low gate (relative: pool magnitudes are nonlinear).
  for (const mode of ['monocular', 'binocular']) {
    const mk = (alt) => ({
      leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: .25, downThreat: .8,
      grid: [.25, .25, .25, .3, .3, .3, .7, .7, .7],
      gridWall: [.1, .1, .1, .8, .7, .8, .1, .1, .1],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.3),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: alt,
    });
    const run = (alt) => {
      const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
      let out;
      for (let i = 0; i < 30; i++) out = net.step(mk(alt));
      return out.climb;
    };
    const high = run(.15), low = run(.08);
    assert.ok(high > 0 && high < low, `${mode}: headroom must grade the climb, high=${high} low=${low}`);
  }
});

test('SNN finds a relative valley past fog-dim side walls (mono+bino)', () => {
  // Same K16-B relative valley through pools (shared decoder).
  for (const mode of ['monocular', 'binocular']) {
    const cellsWall = Array(32).fill(.9);
    for (const r of [1, 2]) for (const c of [0, 1, 2, 5, 6, 7]) cellsWall[r * 8 + c] = .35;
    const input = {
      leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .6, downThreat: .8,
      grid: [.4, .4, .4, .5, .5, .5, .75, .75, .75],
      gridWall: [.2, .2, .2, .8, .5, .8, .1, .1, .1],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.6),
      cellsWall, loomingC: 0, altitude: .08,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(Math.abs(out.climb) < .3, `${mode}: relative valley must veto the gate, got ${out.climb}`);
    assert.ok(out.speedMultiplier <= .61, `${mode}: relative valley must slow transit, got ${out.speedMultiplier}`);
  }
});

test('SNN vetoes the top gate when the sides are open (mono+bino)', () => {
  // Same K16-A side veto through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const mk = (side) => ({
      leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .2, downThreat: .8,
      grid: [.2, .2, .2, .5, .5, .5, .75, .75, .75],
      gridWall: [.2, .2, .2, side, .5, side, .1, .1, .1],
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.6),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .08,
    });
    const run = (side) => {
      const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
      let out;
      for (let i = 0; i < 30; i++) out = net.step(mk(side));
      return out.climb;
    };
    const open = run(.1), shut = run(.8);
    assert.ok(Math.abs(open) < .2, `${mode}: open sides must not climb, got ${open}`);
    assert.ok(shut > 0, `${mode}: blocked sides must still climb, got ${shut}`);
  }
});

test('SNN damps side veer during centered valley transit (mono+bino)', () => {
  // Same K15 gap-line contract through pools: transit veer must be much
  // smaller than the same asymmetry without a valley (relative: pool
  // magnitudes are nonlinear, so no absolute bar).
  for (const mode of ['monocular', 'binocular']) {
    const gapCells = Array(32).fill(.9);
    for (const r of [1, 2]) for (const c of [3, 4]) gapCells[r * 8 + c] = 0;
    const mk = (cellsWall) => ({
      leftThreat: .8, rightThreat: .2, frontThreat: .12, upThreat: .1, downThreat: .1,
      leftOuterThreat: .8, rightOuterThreat: .2, leftInnerThreat: .12, rightInnerThreat: .12,
      grid: Array(9).fill(0), gridWall: Array(9).fill(0),
      goalVisible: 0, escapeDirection: 0, sectors: [.8, .8, .8, .8, .2, .2, .2, .2],
      cellsWall, loomingC: 0, loomingL: 0, loomingR: 0, motionL: 0, motionR: 0, altitude: .08,
    });
    const run = (cellsWall) => {
      const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
      let out;
      for (let i = 0; i < 30; i++) out = net.step(mk(cellsWall));
      return out.turn;
    };
    const transit = run(gapCells), control = run(Array(32).fill(.9));
    assert.ok(Math.abs(control) > .03, `${mode}: control must veer, got ${control}`);
    assert.ok(Math.abs(transit) < Math.abs(control) * .75, `${mode}: transit must damp veer, ${transit} vs ${control}`); // pools compress ratios (control saturates); pre-fix ratio ~= 1 still fails
  }
});

test('SNN takes off from the floor to cruise altitude when open (mono+bino)', () => {
  // Same cruise policy through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
      grid: Array(9).fill(0), gridWall: Array(9).fill(0),
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.1),
      cellsWall: Array(32).fill(0), loomingC: 0, altitude: .02,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(out.climb > .4, `${mode}: floor start must take off, got ${out.climb}`);
  }
});

test('SNN weak-conflict bar admits lowerMixed .55 (mono+bino)', () => {
  // Same widened bar through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .6, rightThreat: .6, frontThreat: .6, upThreat: .2, downThreat: .55,
      grid: [.2, .2, .2, .5, .5, .5, .55, .55, .55],
      gridWall: [.2, .2, .2, .5, .5, .5, .1, .1, .1],
      goalVisible: .5, goalLockX: 0, goalLockY: -.2, goalVertical: -.15,
      escapeDirection: 0, sectors: Array(8).fill(.6),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .1,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(out.climb < 0, `${mode}: goal must win at lowerMixed .55, got ${out.climb}`);
  }
});

test('SNN softens dives at the floor guard (mono+bino)', () => {
  // Same floor-softening contract through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
      grid: Array(9).fill(0), gridWall: Array(9).fill(0),
      goalVisible: .8, goalLockX: 0, goalLockY: -.5, goalVertical: -.5,
      escapeDirection: 0, sectors: Array(8).fill(.1), loomingC: 0, altitude: .02,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(out.climb < 0 && out.climb >= -.25, `${mode}: floor dive must soften, got ${out.climb}`);
  }
});

test('SNN bottom gate opens for fog-attenuated above-walls (mono+bino)', () => {
  // Same threat-scale parity through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .5, rightThreat: .5, frontThreat: .5, upThreat: .7, downThreat: .4,
      grid: [.5, .5, .5, .5, .5, .5, .4, .4, .4],
      gridWall: [.5, .5, .5, .5, .5, .5, 0, 0, 0], // K19R: fog-dim floor below, wall-free underneath
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.5),
      loomingC: 0, altitude: .1,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(out.climb < 0, `${mode}: fog-level above-wall must dive, got ${out.climb}`);
  }
});

test('SNN slows for a near goal even when centered (mono+bino)', () => {
  // Same approach-speed guard through pools (rule parity).
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .1, rightThreat: .1, frontThreat: .1, upThreat: .1, downThreat: .1,
      grid: Array(9).fill(0), gridWall: Array(9).fill(0),
      goalVisible: .6, goalLockX: 0, goalLockY: 0, escapeDirection: 0,
      sectors: Array(8).fill(.1), cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .02,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 30; i++) out = net.step(input);
    assert.ok(out.speedMultiplier <= .58, `${mode}: near goal must cap speed, got ${out.speedMultiplier}`);
  }
});

test('evaluateSensorPixel covers fog/z-depth/flow/fusion', () => {
  const px = classifyPixel(22, 120, 255);
  const fog = evaluateSensorPixel(px, 0, 0, 0, 4, 4, new Uint8Array(64), null, 'fog_rgb', null, null);
  assert.ok(fog.obstacle && fog.isWall);
  const depthRgba = new Uint8Array(64);
  depthRgba[0] = 200;
  const z = evaluateSensorPixel(px, 0, 0, 0, 4, 4, new Uint8Array(64), depthRgba, 'z_depth', null, null);
  assert.ok(z.obstacle && z.proximity > 0);
  const prev = new Float32Array(16), ema = new Float32Array(16);
  const rgba = new Uint8Array(64);
  rgba[0] = 22; rgba[1] = 120; rgba[2] = 255; rgba[3] = 255;
  const flow = evaluateSensorPixel(px, 0, 0, 0, 4, 4, rgba, null, 'optical_flow', prev, ema);
  assert.ok(flow.obstacle);
  const fusion = evaluateSensorPixel(px, 0, 0, 0, 4, 4, rgba, depthRgba, 'sensor_fusion', new Float32Array(16), new Float32Array(16));
  assert.ok(fusion.obstacle && fusion.proximity >= z.proximity);
});

test('static cross-sensor equality: same frame, same threat on all 4 sensors', () => {
  // Req-4 pin: uniform static frames (prefilled luma => no temporal transient,
  // uniform => no spatial edge boost) must read ~identical threats.
  // RGB triples are pre-LUT linear fog mixes (authored*vis + fog*(1-vis));
  // linD byte === vis*255 (uNear/uFar match fog range). LUT slop => eps .06.
  const cases = [
    // [r,g,b, linDByte, expectObstacle]
    [10, 40, 85, 71, true],    // blue wall @25cm (vis .277)
    [78, 27, 35, 79, true],    // fixed red hazard @24cm (vis .308)
    [7, 16, 35, 16, false],    // blue wall @32cm: RGB-dark + far-depth veto => all clear
    [94, 94, 95, 238, true],   // gray floor @4cm slant (vis .93): graded floor obstacle
    [57, 255, 20, 230, false], // goal beacon: non-obstacle on every sensor
  ];
  for (const [r, g, b, db, wantObs] of cases) {
    const rgba = new Uint8Array(64), depthRgba = new Uint8Array(64);
    for (let p = 0; p < 16; p++) { rgba[p * 4] = r; rgba[p * 4 + 1] = g; rgba[p * 4 + 2] = b; rgba[p * 4 + 3] = 255; depthRgba[p * 4] = db; }
    const luma = (r * .299 + g * .587 + b * .114) / 255;
    const px = classifyPixel(r, g, b);
    const fog = evaluateSensorPixel(px, 0, 0, 0, 4, 4, rgba, depthRgba, 'fog_rgb', null, null);
    const z = evaluateSensorPixel(px, 0, 0, 0, 4, 4, rgba, depthRgba, 'z_depth', null, null);
    const flow = evaluateSensorPixel(px, 0, 0, 0, 4, 4, rgba, depthRgba, 'optical_flow', new Float32Array(16).fill(luma), new Float32Array(16));
    const fusion = evaluateSensorPixel(px, 0, 0, 0, 4, 4, rgba, depthRgba, 'sensor_fusion', new Float32Array(16).fill(luma), new Float32Array(16));
    assert.equal(fog.obstacle, wantObs, `fog_rgb obs ${r},${g},${b}`);
    assert.equal(z.obstacle, wantObs, `z_depth obs ${r},${g},${b}`);
    assert.equal(flow.obstacle, wantObs, `flow obs ${r},${g},${b}`);
    assert.equal(fusion.obstacle, wantObs, `fusion obs ${r},${g},${b}`);
    if (wantObs) {
      assert.ok(Math.abs(z.proximity - fog.proximity) < .06, `z/fog prox ${r},${g},${b}`);
      assert.ok(Math.abs(flow.proximity - fog.proximity) < .01, `flow/fog prox ${r},${g},${b}`);
      assert.ok(Math.abs(fusion.proximity - fog.proximity) < .06, `fusion/fog prox ${r},${g},${b}`);
    } else {
      assert.equal(fog.proximity, 0); assert.equal(z.proximity, 0);
      assert.equal(flow.proximity, 0); assert.equal(fusion.proximity, 0);
    }
  }
  // Near-override (safety): RGB-dark but depth-near must still read obstacle on z.
  // fu13: fusion no longer carries the depth override (fog+flow only) — silent here.
  const rgba = new Uint8Array(64), depthRgba = new Uint8Array(64);
  for (let p = 0; p < 16; p++) { rgba[p * 4] = 5; rgba[p * 4 + 1] = 5; rgba[p * 4 + 2] = 5; rgba[p * 4 + 3] = 255; depthRgba[p * 4] = 242; }
  const darkPx = classifyPixel(5, 5, 5);
  const zl = (5 * .299 + 5 * .587 + 5 * .114) / 255;
  const zNear = evaluateSensorPixel(darkPx, 0, 0, 0, 4, 4, rgba, depthRgba, 'z_depth', null, null);
  const fNear = evaluateSensorPixel(darkPx, 0, 0, 0, 4, 4, rgba, depthRgba, 'sensor_fusion', new Float32Array(16).fill(zl), new Float32Array(16));
  assert.ok(zNear.obstacle && zNear.proximity === 1, 'depth must see near-dark obstacle (override)');
  assert.ok(!fNear.obstacle && fNear.proximity === 0, 'fu13: fusion blind to depth-only-near (no depth terms)');
});

test('monocular decoder reports left wall, escape side and center-column routes', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = 0; y < 90; y++) for (let x = 0; x < 40; x++) {
    const i = (y * width + x) * 4;
    frame[i] = 20; frame[i + 1] = 50; frame[i + 2] = 120;
  }
  const signal = decoder.decode(frame, width, height);
  assert.ok(signal.leftThreat > .5 && signal.leftThreat > signal.rightThreat);
  assert.equal(signal.escapeDirection, 1);
  assert.equal(signal.grid.length, 9);
  assert.equal(signal.upperRoute, signal.grid[1]);
  assert.equal(signal.lowerRoute, signal.grid[7]);
  assert.ok(signal.pixelMask.some((v) => v === 1));
  assert.ok(signal.detectedPixels > 0);
});

test('monocular corridor baseline subtracts symmetric walls, preserves asymmetric (bino parity)', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const bg = (frame) => { for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; } };
  const wall = (frame, x0, x1) => { for (let y = 0; y < 90; y++) for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; frame[i] = 20; frame[i + 1] = 50; frame[i + 2] = 120; } };
  // symmetric corridor: both sides must read cooler than their raw occupancy
  const sym = new Uint8ClampedArray(width * height * 4);
  bg(sym); wall(sym, 0, 40); wall(sym, 120, 160);
  const s = decoder.decode(sym, width, height);
  const rawL = Math.max(0, s.occupancy.left - .025) * 1.5, rawR = Math.max(0, s.occupancy.right - .025) * 1.5;
  assert.ok(s.leftThreat < rawL && s.rightThreat < rawR, `symmetric walls must subtract: L=${s.leftThreat}/${rawL} R=${s.rightThreat}/${rawR}`);
  assert.ok(Math.abs(s.leftThreat - s.rightThreat) < .05, 'symmetric corridor stays balanced');
  // asymmetric wall: subtraction baseline is zero, threat identical to raw
  const asym = new Uint8ClampedArray(width * height * 4);
  bg(asym); wall(asym, 0, 40);
  const a = decoder.decode(asym, width, height);
  assert.ok(Math.abs(a.leftThreat - Math.max(0, a.occupancy.left - .025) * 1.5) < 1e-9, 'asymmetric threat must not shift');
  assert.ok(a.leftThreat > .5 && a.leftThreat > a.rightThreat);
});

test('binocular decoder handles a combined side-by-side frame', () => {
  const decoder = createCameraVisionDecoder();
  const width = 320, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = 10; y < 80; y++) for (let x = 200; x < 260; x++) {
    const i = (y * width + x) * 4;
    frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255;
  }
  const signal = decoder.decode(frame, width, height, 'binocular');
  assert.equal(signal.visionMode, 'binocular');
  assert.ok(Number.isFinite(signal.rightThreat) && Number.isFinite(signal.binocularDisparity));
  assert.ok(signal.escapeDirection === 1 || signal.escapeDirection === -1);
  assert.equal(signal.grid.length, 9);
});

test('goal beacon pixels lock target without obstacle threat', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = 42; y < 45; y++) for (let x = 78; x < 81; x++) {
    const i = (y * width + x) * 4;
    frame[i] = 57; frame[i + 1] = 255; frame[i + 2] = 20;
  }
  const signal = decoder.decode(frame, width, height);
  assert.ok(signal.goalPixels >= 9 && signal.goalVisible > .025);
  assert.ok(signal.pixelMask.some((v) => v === 3));
});

const tinyBase = {
  dataset: 'test', license: 'test',
  // Visual order matters: vIdx assigns upper/lower to VS types and every 3rd
  // visual, so [8,1,2,9] keeps LPLC2_L/R lateral on BOTH sides (symmetric).
  nodes: [
    { id: 8, name: 'VS_L', type: 'VS', side: 'L', superclass: 'visual_projection', neurotransmitter: 'acetylcholine' },
    { id: 1, name: 'LPLC2_L', type: 'LPLC2', side: 'L', superclass: 'visual_projection', neurotransmitter: 'acetylcholine' },
    { id: 2, name: 'LPLC2_R', type: 'LPLC2', side: 'R', superclass: 'visual_projection', neurotransmitter: 'acetylcholine' },
    { id: 9, name: 'VS_R', type: 'VS', side: 'R', superclass: 'visual_projection', neurotransmitter: 'acetylcholine' },
    { id: 3, name: 'DNp06_L', type: 'DNp06', side: 'L', superclass: 'descending_neuron', neurotransmitter: 'acetylcholine' },
    { id: 4, name: 'DNp06_R', type: 'DNp06', side: 'R', superclass: 'descending_neuron', neurotransmitter: 'acetylcholine' },
    { id: 5, name: 'VNC_L', type: 'MN', side: 'L', superclass: 'vnc_motor', neurotransmitter: 'glutamate' },
    { id: 6, name: 'VNC_R', type: 'MN', side: 'R', superclass: 'vnc_motor', neurotransmitter: 'glutamate' },
  ],
  edges: [
    { source: 1, target: 3, weight: 100 },
    { source: 2, target: 4, weight: 100 },
    { source: 3, target: 5, weight: 50 },
    { source: 4, target: 6, weight: 50 },
    { source: 8, target: 3, weight: 60 },
    { source: 9, target: 4, weight: 60 },
  ],
};
const tinyExt = {
  dataset: 'test-ext', license: 'test',
  nodes: [{ id: 7, name: 'LC10_L', type: 'LC10', side: 'L', superclass: 'visual_projection', neurotransmitter: 'acetylcholine' }],
  edges: [{ source: 7, target: 3, weight: 30 }],
};

test('mergeFlightGraphs lets extension win overlaps and tags source', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  assert.equal(g.base_node_count, 8);
  assert.equal(g.extension_node_count, 1);
  const dup = mergeFlightGraphs(tinyBase, { nodes: [], edges: [{ source: 1, target: 3, weight: 10 }] });
  const row = dup.edges.find((e) => e.source === 1 && e.target === 3);
  assert.equal(row.weight, 10);
  assert.equal(row.source_dataset, 'MaleCNS neuPrint targeted query');
});

test('instantiateAnatomicalCore partitions visual/dn/motor/vertical', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const c = instantiateAnatomicalCore(g);
  assert.equal(c.nodes.size, 9);
  assert.ok(c.visualL.length >= 1 && c.visualR.length >= 1);
  assert.ok(c.dnL.length >= 1 && c.dnR.length >= 1);
  assert.ok(c.motorL.length >= 1 && c.motorR.length >= 1);
  assert.ok(c.verticalCandidates.some((n) => n.type === 'DNp06'));
  assert.ok(c.upperVisual.length >= 1 && c.lowerVisual.length >= 1);
  assert.ok(c.synapses.length >= 4);
});

test('monocular network turns away from lateral threat within ±0.16', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const left = createFlightConnectome(g, { mode: 'monocular' });
  let lt = 0;
  for (let i = 0; i < 60; i++) lt = left.step({ leftThreat: 1, loomingL: .5 }).turn;
  const right = createFlightConnectome(g, { mode: 'monocular' });
  let rt = 0;
  for (let i = 0; i < 60; i++) rt = right.step({ rightThreat: 1, loomingR: .5 }).turn;
  assert.ok(lt > 0, `leftTurn=${lt}`);
  assert.ok(rt < 0, `rightTurn=${rt}`);
  assert.ok(Math.abs(lt) <= .16 + 1e-9 && Math.abs(rt) <= .16 + 1e-9);
});

test('ALT-1: frozen climb trips the vertical trap but climbing with altitude progress does not', () => {
  const mkInput = (alt) => ({
    grid: [0, .1, 0, 0, .5, 0, 0, .5, 0], gridWall: [0, .1, 0, .8, .5, .8, 0, .5, 0], // K16-A: sides blocked
    upThreat: .2, downThreat: .1,
    loomingC: 0, goalVisible: 0, goalLockX: 0, goalLockY: 0, goalVertical: 0,
    goalBearing: 0, dt: 1 / 60, altitude: alt,
  });
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const frozen = createFlightConnectome(g, { mode: 'monocular' });
  let early = 0, lateFrozen = 0;
  for (let i = 0; i < 110; i++) {
    const c = frozen.step(mkInput(.05)).climb;
    if (i === 10) early = c;
    if (i === 109) lateFrozen = c;
  }
  const rising = createFlightConnectome(g, { mode: 'monocular' });
  let lateRising = 0;
  for (let i = 0; i < 110; i++) lateRising = rising.step(mkInput(.05 + i * .0009)).climb; // capped below headroom (.16): the old ramp flew through the ceiling (.595 in a .20 chamber)
  assert.ok(early > 0, `frozen climb must start positive, got ${early}`);
  assert.ok(lateFrozen <= 0.05, `frozen climb must trip into hard stop (W1a, no dive exile), got ${lateFrozen}`);
  assert.ok(lateRising > 0, `rising climb must not trip, got ${lateRising}`);
  assert.ok(lateRising > lateFrozen + .1, `rising ${lateRising} vs frozen ${lateFrozen}`);
});

test('SNN dive gate opens at 0.45 sensitivity (mono, Weber-scaled bar)', () => {
  // Same batch-g3 lock as the rule: a fixed `upperMixed > .45` bar on a
  // .45-capped grid can never fire. Compare sustained dives with/without the
  // sensitivity field: only the scaled bar dives.
  const mk = (sens) => ({
    grid: [0, .45, 0, 0, .2, 0, 0, .1, 0],
    gridWall: [0, .9, 0, .8, .5, .8, 0, .1, 0],
    frontThreat: .5, upThreat: .5, downThreat: .1, loomingC: 0,
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalVertical: 0, goalBearing: 0,
    dt: 1 / 60, altitude: .1, escapeDirection: 0,
    cellsWall: Array(32).fill(.9),
    ...(sens === undefined ? {} : { sensitivity: sens }),
  });
  const run = (sens) => {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
    let acc = 0, n = 0;
    // Pre-trap window: a frozen stimulus trips the no-progress dive trap at
    // 1.2s (step 72) by design — real dives reset it via altitude change.
    // This test pins the gate, so it averages warmed-up pre-trap steps.
    for (let i = 0; i < 60; i++) { const c = net.step(mk(sens)).climb; if (i >= 30) { acc += c; n++; } }
    return acc / n;
  };
  const noSens = run(undefined), withSens = run(.45);
  assert.ok(withSens < noSens - .03, `sens .45 must dive harder (with=${withSens} vs without=${noSens})`);
  assert.ok(withSens < -.03, `sens .45 must actually dive, got ${withSens}`);
});

test('SNN dive gate opens at 0.45 sensitivity (bino, Weber-scaled bar)', () => {
  const mk = (sens) => ({
    grid: [0, .45, 0, 0, .2, 0, 0, .1, 0],
    gridWall: [0, .9, 0, .8, .5, .8, 0, .1, 0],
    frontThreat: .5, upThreat: .5, downThreat: .1, loomingC: 0,
    leftOuterThreat: .2, leftInnerThreat: .2, rightInnerThreat: .2, rightOuterThreat: .2,
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalVertical: 0, goalBearing: 0,
    dt: 1 / 60, altitude: .1, escapeDirection: 0,
    cellsWall: Array(32).fill(.9),
    ...(sens === undefined ? {} : { sensitivity: sens }),
  });
  const run = (sens) => {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'binocular' });
    let acc = 0, n = 0;
    // Pre-trap window (same frozen-stimulus trap contract as mono): pin the
    // gate on warmed-up pre-trap steps.
    for (let i = 0; i < 60; i++) { const c = net.step(mk(sens)).climb; if (i >= 30) { acc += c; n++; } }
    return acc / n;
  };
  const noSens = run(undefined), withSens = run(.45);
  assert.ok(withSens < noSens - .03, `sens .45 must dive harder (with=${withSens} vs without=${noSens})`);
  assert.ok(withSens < -.03, `sens .45 must actually dive, got ${withSens}`);
});

test('teacher coaching preserves pretrained gains above unity (LIF)', () => {
  const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
  net.loadWeights({ left: 1.25, right: 1.25, climb: 1.0, dive: 1.35 });
  net.reinforce(0, { turn: .1, climb: -.5 }, { rawTurn: 0, rawClimb: 0 });
  const g = net.stats().gains;
  assert.ok(g.left > 1.2 && g.left <= 1.25, `teacher must not snap pretrained left gain, got ${g.left}`);
  assert.ok(g.dive > 1.3 && g.dive <= 1.35, `teacher must not snap pretrained dive gain, got ${g.dive}`);
});

test('teacher coaching preserves pretrained gains above unity (ALIF)', () => {
  const P = ALIFSurrogatePlugin;
  const st = {
    gains: { left: 1.25, right: 1.15, climb: 1.0, dive: 1.35 },
    eligibility: { left: 0, right: 0, climb: 0, dive: 0 },
    learnRate: .012, meanSurrogateGrad: 0, rewardUpdates: 0, cumulativeReward: 0,
    collisionIndex: 0, rewardEma: 0, explorationRate: 0,
  };
  const cfg = { eligibilityThreshold: .05, minGain: .25, maxGain: 2.5 };
  P.reinforce(st, cfg, 0, { turn: .1, climb: -.5 }, { rawTurn: 0, rawClimb: 0 });
  assert.ok(st.gains.left > 1.2 && st.gains.left <= 1.25, `teacher must not snap pretrained left gain, got ${st.gains.left}`);
  assert.ok(st.gains.dive > 1.3 && st.gains.dive <= 1.35, `teacher must not snap pretrained dive gain, got ${st.gains.dive}`);
});

test('SNN keeps lateral authority during goal-visible gate transit (mono+bino)', () => {
  // Open bottom gate (clear below, blocked above) + centered visible goal:
  // suppression must follow the goal term alone (floor .12), not the product (.0072).
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[1] = 1;
    let turn = 0;
    for (let i = 0; i < 60; i++) {
      turn = net.step({ grid, leftThreat: 1, rightThreat: 0, goalVisible: .5, goalLockX: 0, goalLockY: 0 }).turn;
    }
    assert.ok(turn > .05, `${mode}: gate+goal transit must preserve avoidance steering, got turn=${turn}`);
  }
});

test('ALIF sets refractory on spike, skipping the next step like LIF', () => {
  const P = ALIFSurrogatePlugin;
  const nodes = new Map([[1, { id: 1, v: 0, adapt: 0, threshold: .6, refractory: 0, spiking: false, spikes: 0, firingRate: 0, input: 10, current: 0, outgoing: [] }]]);
  const state = { lastSpikes: [] };
  P.integrateNeurons(nodes, [], state, {}, {});
  const n = nodes.get(1);
  assert.equal(n.refractory, 1, 'spike must arm a one-step refractory period');
  n.input = 10;
  P.integrateNeurons(nodes, [], state, {}, {});
  assert.equal(n.spikes, 1, `refractory step must not spike again, got ${n.spikes} spikes`);
});

test('monocular frontal drive survives goal suppression (regression pin)', () => {
  const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
  let turn = 0;
  for (let i = 0; i < 60; i++) {
    turn = net.step({ frontThreat: 1, loomingL: 0, loomingR: 0, goalVisible: 1, goalLockX: 0, goalLockY: 0, escapeDirection: 1 }).turn;
  }
  assert.ok(turn > .03, `mono frontal avoidance must survive goal suppression, got turn=${turn}`);
});

test('binocular frontal drive gets suppression once, not squared', () => {
  // Pure frontal threat (silent periphery/nasal) + fully visible centered goal:
  // suppress=.15 must attenuate once; squared (.0225) silences the turn.
  const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'binocular' });
  let turn = 0;
  for (let i = 0; i < 60; i++) {
    turn = net.step({
      frontThreat: 1, leftOuterThreat: 0, rightOuterThreat: 0, leftInnerThreat: 0, rightInnerThreat: 0,
      loomingL: 0, loomingR: 0, goalVisible: 1, goalLockX: 0, goalLockY: 0, escapeDirection: 1,
    }).turn;
  }
  assert.ok(turn > .05, `bino frontal avoidance must survive goal suppression, got turn=${turn}`);
});

test('gate hysteresis holds transit through the lip band, releases when clear (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const G9 = (c, u, l) => { const g = Array(9).fill(0); g[4] = c; g[1] = u; g[7] = l; g[3] = g[5] = .8; return g; }; // K16-A: sides blocked
    // Lip probe (.9,.5,.42) sits in the HOLD-ONLY band: raw is shut (evidence
    // needs upper < .35, clause 2 needs upper < center*.52 = .468), so transit
    // here proves the hold — not raw opening. The raw gate opens the lip band
    // directly when the floor reads hotter below (see approach tests).
    let out;
    for (let i = 0; i < 10; i++) out = net.step({ grid: G9(.7, 0, .9), frontThreat: .7, upThreat: 0, downThreat: 1, loomingC: 0 });
    assert.ok(out.climb > .3, `${mode}: open-top gate must climb, got ${out.climb}`);
    for (let i = 0; i < 10; i++) out = net.step({ grid: G9(.9, .5, .42), frontThreat: .9, upThreat: .6, downThreat: 1, loomingC: 0 });
    assert.ok(out.climb > .3, `${mode}: gate must hold through the lip band, got climb=${out.climb}`);
    for (let i = 0; i < 10; i++) out = net.step({ grid: G9(1, .9, 1), frontThreat: 1, upThreat: 1, downThreat: 1, loomingC: 0 });
    assert.ok(Math.abs(out.climb) < .05, `${mode}: solid wall must close the gate, got climb=${out.climb}`);
    for (let i = 0; i < 10; i++) out = net.step({ grid: G9(.7, 0, .9), frontThreat: .7, upThreat: 0, downThreat: 1, loomingC: 0 });
    for (let i = 0; i < 10; i++) out = net.step({ grid: G9(0, 0, 0), frontThreat: 0, upThreat: 0, downThreat: 0, loomingC: 0 });
    assert.ok(Math.abs(out.climb) < .05, `${mode}: clear space must release the hold, got climb=${out.climb}`);
    for (let i = 0; i < 10; i++) out = net.step({ grid: G9(.7, 0, .9), frontThreat: .7, upThreat: 0, downThreat: 1, loomingC: 0 });
    net.reset();
    out = net.step({ grid: G9(.9, .5, .42), frontThreat: .9, upThreat: .6, downThreat: 1, loomingC: 0 });
    assert.ok(Math.abs(out.climb) < .05, `${mode}: reset must clear the hold, got climb=${out.climb}`);
  }
});

test('visible below-goal wins over weak gate conflict (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[4] = .1;
    let out;
    for (let i = 0; i < 60; i++) {
      out = net.step({ grid, frontThreat: .1, upThreat: 0, downThreat: 0, loomingC: 0, goalVisible: .3, goalLockX: 0, goalLockY: -.5, goalVertical: -.3 });
    }
    assert.ok(out.climb < -.2, `${mode}: below-goal must win over weak open-top, got climb=${out.climb}`);
  }
});

test('strong gate conflict keeps avoidance priority (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[4] = .8; grid[7] = .9; grid[3] = grid[5] = .8; // K16-A: sides blocked
    let out;
    for (let i = 0; i < 60; i++) {
      out = net.step({ grid, frontThreat: .8, upThreat: 0, downThreat: 1, loomingC: 0, goalVisible: .3, goalLockX: 0, goalLockY: -.5, goalVertical: -.3 });
    }
    assert.ok(out.climb > .3, `${mode}: strong lower wall must keep climbing over a below-goal, got climb=${out.climb}`);
  }
});

test('visible above-goal wins over weak bottom-gate conflict (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[4] = .3; grid[1] = .1;
    let out;
    for (let i = 0; i < 60; i++) {
      out = net.step({ grid, frontThreat: .3, upThreat: .2, downThreat: 0, loomingC: 0, goalVisible: .3, goalLockX: 0, goalLockY: .5, goalVertical: .3 });
    }
    assert.ok(out.climb > .2, `${mode}: above-goal must win over weak open-bottom, got climb=${out.climb}`);
  }
});

test('vertical grid cues drive climb/dive from matching visual populations', () => {
  for (const direction of ['climb', 'dive']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
    const grid = Array(9).fill(0);
    grid[4] = 1;
    if (direction === 'climb') for (let i = 6; i < 9; i++) grid[i] = 1;
    else for (let i = 0; i < 3; i++) grid[i] = 1;
    const gridWall = grid.slice(); gridWall[3] = gridWall[5] = .8; // K16-A: sides blocked
    let output;
    for (let i = 0; i < 60; i++) output = net.step({ grid, gridWall, altitude: .08 }); // mid-air: the dive cue needs legroom (floor level correctly holds level now)
    assert.ok(net.stats().verticalCandidates > 0);
    assert.ok(direction === 'climb' ? output.climb > 0 : output.climb < 0, `${direction}=${output.climb}`);
    assert.ok(direction === 'climb' ? output.upperActivity > output.lowerActivity : output.lowerActivity > output.upperActivity);
    const before = net.stats().gains[direction];
    for (let i = 0; i < 3; i++) net.reinforce(1);
    assert.ok(net.stats().gains[direction] > before);
  }
});

test('vertical trap habituates: floor-trap dive climbs out within 2s (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    // Measured floor-trap signature: bottom gate open, floor threat below, no goal.
    const grid = Array(9).fill(0);
    grid[4] = .65; grid[1] = .83; grid[7] = .16;
    let output;
    for (let i = 0; i < 120; i++) output = net.step({ grid, downThreat: .39, upThreat: .83, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 });
    assert.ok(output.climb > 0, `${mode} still diving: climb=${output.climb}`);
  }
});

test('legit descent keeps diving: rising floor threat is progress, not a trap', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[4] = .15; grid[1] = .8; grid[7] = .12; // slot panel above (was relative-contrast artifact)
    let output;
    for (let i = 0; i < 120; i++) output = net.step({ grid, downThreat: .2 + i * .0025, upThreat: .83, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 });
    assert.ok(output.climb < 0, `${mode} stopped descending: climb=${output.climb}`);
  }
});

test('legit climb keeps climbing: falling floor threat is progress, not a trap', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[4] = .65; grid[1] = .16; grid[7] = .83;
    const gridWall = [0, .16, 0, .8, .65, .8, 0, .83, 0]; // K16-A: sides blocked
    let output;
    for (let i = 0; i < 120; i++) output = net.step({ grid, gridWall, downThreat: .5 - i * .0025, upThreat: .83, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 });
    assert.ok(output.climb > 0, `${mode} stopped climbing: climb=${output.climb}`);
  }
});

test('goal landing is exempt: saturated floor threat never habituates a goal dive', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(.8); // no gate open anywhere
    let output;
    for (let i = 0; i < 120; i++) output = net.step({ grid, downThreat: .8, upThreat: .83, goalVisible: .5, goalVertical: -.5, dt: 1 / 60 });
    assert.ok(output.climb < 0, `${mode} aborted landing: climb=${output.climb}`);
  }
});

test('escape persists: latched climb holds through gate closure without a goal', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const trap = Array(9).fill(0);
    trap[4] = .65; trap[1] = .83; trap[7] = .16;
    for (let i = 0; i < 100; i++) net.step({ grid: trap, downThreat: .39, upThreat: .83, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 });
    assert.ok(net.step({ grid: trap, downThreat: .39, upThreat: .83, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 }).climb > 0, `${mode} never entered escape`);
    // Gate closes (pitch transient), no goal in view: the latched maneuver must hold.
    const shut = Array(9).fill(.8);
    let output;
    for (let i = 0; i < 30; i++) output = net.step({ grid: shut, downThreat: .39, upThreat: .83, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 });
    assert.ok(output.climb > 0, `${mode} escape cancelled by gate closure: climb=${output.climb}`);
  }
});

test('steep dive keeps diving: falling floor threat is still progress (pitch-swung sectors)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    // Measured ceiling-descent signature: open space, gentle asymmetry dive.
    const grid = Array(9).fill(0);
    grid[4] = .25; grid[1] = .8; grid[7] = .15; // slot panel above
    let output;
    for (let i = 0; i < 120; i++) output = net.step({ grid, downThreat: .4 - i * .0012, upThreat: .65, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 });
    assert.ok(output.climb < 0, `${mode} interrupted a steep descent: climb=${output.climb}`);
  }
});

test('gap approach keeps diving: rising center threat is transit progress', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[1] = .8; grid[7] = .15;
    let output;
    for (let i = 0; i < 120; i++) { grid[4] = .3 + i * .003; output = net.step({ grid, downThreat: .35, upThreat: .83, goalVisible: 0,
      dt: 0.05, dt: 1 / 60 }); }
    assert.ok(output.climb < 0, `${mode} refused a gap approach: climb=${output.climb}`);
  }
});

test('lost search casts deterministic alternating saccades within ±0.16 (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let early = 0, late = 0, second = 0;
    for (let i = 0; i < 260; i++) {
      // escapeDirection -1 locks blind alternation: first pulse must still be +.
      const t = net.step({ goalVisible: 0,
      dt: 0.05, frontThreat: 0, escapeDirection: -1, dt: 1 / 60 }).turn;
      assert.ok(Math.abs(t) <= .16 + 1e-9, `${mode} turn contract broke: ${t}`);
      if (i === 10) early = t;
      if (i === 60) late = t;
      if (i === 250) second = t;
    }
    assert.ok(early > .05, `${mode} no first-period pulse: ${early}`);
    assert.ok(Math.abs(late) < .02, `${mode} pulse leaks outside window: ${late}`);
    assert.ok(second < -.05, `${mode} second period does not alternate: ${second}`);
  }
});

test('lost search gated off during avoidance or goal lock (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    // Strong lateral avoidance must not be disturbed: at step 250 the (negative)
    // pulse would drag +0.16 down to +0.06 if the gate leaked.
    const blocked = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let t250 = 0;
    for (let i = 0; i < 260; i++) {
      const t = blocked.step({ goalVisible: 0,
      dt: 0.05, leftThreat: 1, dt: 1 / 60 }).turn;
      if (i === 250) t250 = t;
    }
    assert.ok(t250 > .12, `${mode} search disturbs avoidance: ${t250}`);
    const locked = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    for (let i = 0; i < 30; i++) {
      const t = locked.step({ goalVisible: .5, goalLockX: 0, goalBearing: 0, frontThreat: 0, escapeDirection: 1, dt: 1 / 60 }).turn;
      assert.ok(Math.abs(t) < .02, `${mode} searches while locked: ${t}`);
    }
  }
});

test('bilateral load normalizes motor+DN activity by neuron count', () => {
  // Production values: sums 17-32 over N=144 -> means 0.12-0.22 (full speed).
  assert.ok(bilateralLoad(24, 144) < CONFIG.bilateralGate);
  assert.ok(Math.abs(bilateralLoad(24, 144) - 24 / 144) < 1e-12);
  // Pathological saturation (near-max mean firing) still caps speed.
  assert.ok(bilateralLoad(120, 144) > CONFIG.bilateralGate);
  assert.equal(bilateralLoad(5, 0), 5);
});

test('gain range follows reference CONFIG [0.25, 2.50]', () => {
  assert.equal(CONFIG.minGain, 0.25);
  assert.equal(CONFIG.maxGain, 2.5);
  const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
  const gains = net.loadWeights({ left: 99, dive: -5 });
  assert.equal(gains.left, 2.5);
  assert.equal(gains.dive, 0.25);
});

test('loop_ring maze converts with both gate tags, reference stages stay pinned', () => {
  assert.equal(Object.keys(REFERENCE_MAZE_LAYOUTS).length, 10);
  assert.ok(listMazes().some((m) => m.id === 'loop_ring'));
  const layout = toReferenceLayout(LOOP_RING_MAZE);
  assert.ok(layout.walls.length >= 7);
  assert.ok(layout.walls.some((w) => w[6] === 'open_top'));
  assert.ok(layout.walls.some((w) => w[6] === 'open_bottom'));
});

const loopBoxes = toReferenceLayout(LOOP_RING_MAZE).walls.map(([x, z, w, l, bottom, top]) => ({
  x, y: (bottom + top) / 2, z: -z, hx: w / 2, hy: (top - bottom) / 2, hz: l / 2,
}));

test('voxel A* completes the loop ring at cruise height', () => {
  const grid = buildVoxelGrid(loopBoxes, { cell: 0.02, margin: 0.012 });
  const pts = [[LOOP_RING_MAZE.start.x, LOOP_RING_MAZE.start.z], ...LOOP_RING_MAZE.loopWaypoints]
    .map(([x, z]) => ({ x, y: 0.10, z }));
  const full = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = astar(grid, pts[i], pts[i + 1]);
    assert.ok(seg && seg.length > 2, `segment ${i} unreachable`);
    const sm = smoothPath(grid, seg);
    full.push(...(i ? sm.slice(1) : sm));
  }
  const len = pathLength(full);
  assert.ok(len > 1.5 && len < 2.8, `loop length ${len}`);
  for (let i = 0; i < full.length; i += 5) assert.ok(!grid.pointBlocked(full[i]), 'smoothed path cuts a wall');
});

test('ray clearance and sector rays follow the yaw convention', () => {
  const rays = sectorRays(0, 0);
  assert.ok(Math.abs(rays.front.x) < 1e-9 && Math.abs(rays.front.z + 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(rays.left.x, rays.left.y, rays.left.z) - 1) < 1e-9);
  assert.ok(Math.abs(rays.left.x + rays.right.x) < 1e-9);
  const pitched = sectorRays(0, 0.5);
  assert.ok(Math.abs(pitched.up.y - Math.sin(1.1)) < 1e-9, 'up ray must compose view pitch');
  assert.ok(rayClearance(loopBoxes, { x: 0.43, y: 0.1, z: 0 }, { x: 1, y: 0, z: 0 }) < 0.09);
  const grazeBox = [{ x: 0, y: 0.04, z: 0, hx: 0.009, hy: 0.04, hz: 0.09 }];
  assert.equal(rayClearance(grazeBox, { x: -0.05, y: 0.11, z: 0 }, { x: 0.825, y: 0.565, z: 0 }, 0.6, true), 0.6);
  assert.ok(Math.abs(rayClearance(grazeBox, { x: -0.05, y: 0.11, z: 0 }, { x: 0.825, y: 0.565, z: 0 }, 0.6) - 0.159) < 0.01);
  const gt = groundTruthClearance(loopBoxes, { x: -0.27, y: 0.1, z: 0.27 }, 0, 0);
  for (const v of Object.values(gt)) assert.ok(v > 0.04, 'centerline clearance too small');
  const gtWalls = groundTruthClearance(loopBoxes, { x: -0.27, y: 0.1, z: 0.27 }, 0, 0, 0.6, true);
  assert.ok(gtWalls.up > gt.up && gtWalls.down > gt.down, 'ignoreY must skip floor/ceiling planes');
});

test('lateral-only camera input creates no direct vertical drive', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = 20; y < 80; y++) for (let x = 0; x < 48; x++) {
    const i = (y * width + x) * 4;
    frame[i] = 20; frame[i + 1] = 80; frame[i + 2] = 180;
  }
  const signal = decoder.decode(frame, width, height);
  const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
  let output;
  for (let i = 0; i < 24; i++) output = net.step({ ...signal, altitude: 0.08, goalBearing: 0.2, goalVertical: 0 }); // cruise null: K12 hold must not masquerade as lateral-vertical coupling
  assert.equal(output.upperDrive, 0);
  assert.equal(output.lowerDrive, 0);
  assert.ok(Math.abs(output.climb) < 0.1);
});

test('binocular network avoids frontal obstacle with active steering (no deadlock)', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const net = createFlightConnectome(g, { mode: 'binocular' });
  let turn = 0, spd = 0;
  for (let i = 0; i < 40; i++) {
    const out = net.step({
      visionMode: 'binocular',
      frontThreat: 0.65,
      leftInnerThreat: 0.60,
      rightInnerThreat: 0.20,
      leftThreat: 0.50,
      rightThreat: 0.15,
      escapeDirection: 1,
      grid: [0.3, 0.4, 0.1, 0.4, 0.65, 0.1, 0.3, 0.4, 0.1], // gates shut under the K7 .45 bar (was: strict-.65 boundary); lateral evasion unchanged
      goalVisible: 0,
      dt: 0.05
    });
    turn = out.turn;
    spd = out.speedMultiplier;
  }
  assert.ok(turn > 0.01, 'Binocular frontal evasion should produce positive right turn, got ' + turn);
  assert.ok(spd >= 0.70, 'Speed multiplier should not be over-suppressed, got ' + spd);
});

test('monocular decoder exposes 8 lateral sectors with left/right gradient', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 6; pixels[i + 1] = 9; pixels[i + 2] = 20; pixels[i + 3] = 255; }
  for (let y = 20; y < 80; y++) for (let x = 0; x < 48; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = 20; pixels[i + 1] = 80; pixels[i + 2] = 180; pixels[i + 3] = 255;
  }
  const signal = decoder.decode(pixels, width, height);
  assert.equal(signal.sectors.length, 8);
  assert.ok(signal.sectors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  const leftGroup = signal.sectors[0] + signal.sectors[1] + signal.sectors[2] + signal.sectors[3];
  const rightGroup = signal.sectors[4] + signal.sectors[5] + signal.sectors[6] + signal.sectors[7];
  assert.ok(leftGroup > rightGroup, `left sectors must exceed right: ${leftGroup} vs ${rightGroup}`);
});

test('binocular decoder exposes 8 ray-angle sectors with lateral gradient', () => {
  const decoder = createCameraVisionDecoder();
  const width = 320, height = 90;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 6; pixels[i + 1] = 9; pixels[i + 2] = 20; pixels[i + 3] = 255; }
  for (let y = 20; y < 80; y++) for (let x = 0; x < 70; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = 20; pixels[i + 1] = 80; pixels[i + 2] = 180; pixels[i + 3] = 255;
  }
  const signal = decoder.decode(pixels, width, height, 'binocular');
  assert.equal(signal.sectors.length, 8);
  assert.ok(signal.sectors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  assert.ok(signal.sectors[0] + signal.sectors[1] > signal.sectors[6] + signal.sectors[7],
    'far-left sectors must exceed far-right on a left-half wall');
});

test('rule steers toward the freest sector when thirds saturate symmetric', () => {
  const rule = createCameraRuleController();
  // Wide frontal wall with a gap on the right: thirds read L~=R~=front~=1, sectors must not.
  const brain = {
    leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(.8), goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: [1, 1, 1, 1, 0, 0, 0, 0],
  };
  const out = rule.step(brain);
  assert.ok(out.turn > 0, `must veer right toward the gap, got turn=${out.turn}`);
  assert.ok(Math.abs(out.turn) <= .16 + 1e-9);
});

test('rule stays decisive and bounded on fully symmetric saturation', () => {
  const rule = createCameraRuleController();
  const brain = {
    leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 0, downThreat: 0,
    grid: [.8, .8, .8, .8, .8, .8, .8, .8, .8], goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: [.8, .8, .8, .8, .8, .8, .8, .8],
  };
  const first = rule.step(brain);
  const second = rule.step(brain);
  assert.ok(Number.isFinite(first.turn) && Math.abs(first.turn) <= .16 + 1e-9);
  assert.equal(first.turn, second.turn, 'symmetric input must decide deterministically (hysteresis)');
});

test('rule touch reflex turns with the contact side, graded by magnitude', () => {
  const rule = createCameraRuleController();
  const base = {
    leftThreat: 0, rightThreat: 0, frontThreat: 0, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(0),
  };
  const strong = rule.step({ ...base, touch: { side: 1, mag: 1 } });
  assert.ok(strong.turn > .1, `full touch must command a strong turn, got ${strong.turn}`);
  rule.reset();
  const weak = rule.step({ ...base, touch: { side: 1, mag: .3 } });
  assert.ok(weak.turn > 0 && weak.turn < strong.turn, `touch must grade with magnitude: ${weak.turn} vs ${strong.turn}`);
  rule.reset();
  const other = rule.step({ ...base, touch: { side: -1, mag: 1 } });
  assert.ok(other.turn < -.1, `opposite side must reverse the turn, got ${other.turn}`);
});

test('touch helpers lateralize from the contact normal and decay', () => {
  // Wall on the left (normal +x), facing -z: must veer right (+1).
  const t = touchFromContact(1, 0, 0, 1, 1);
  assert.equal(t.side, 1);
  assert.equal(t.mag, 1);
  const slow = touchFromContact(1, 0, 0, 1, .1);
  assert.equal(slow.mag, .3, 'impact magnitude must floor at .3 while grinding');
  assert.equal(decayTouch(null, .05), null);
  const decayed = decayTouch({ side: 1, mag: 1 }, .12);
  assert.ok(Math.abs(decayed.mag - Math.exp(-1)) < .01, `tau .12s decay, got ${decayed.mag}`);
  assert.equal(decayTouch({ side: 1, mag: 1 }, 1), null, 'faded touch must clear to null');
});
test('corner grind: stun holds position, touch side latches during sustained contact', () => {
  assert.equal(stunSpeedScale(true), 0, 'stun must hold (no .24x forward grind)');
  assert.equal(stunSpeedScale(false), 1, 'no stun means full speed');
  // Corner alternates normals (+1/-1) while contact never breaks: latch holds first side.
  assert.equal(resolveTouchSide(1, -1, false), 1, 'sustained contact must not flip the latched side');
  assert.equal(resolveTouchSide(-1, 1, false), -1, 'sustained contact must not flip the latched side');
  assert.equal(resolveTouchSide(1, -1, true), -1, 'a new edge must re-latch to the fresh side');
  assert.equal(resolveTouchSide(0, 1, false), 1, 'no latch yet falls back to fresh side');
});

test('SNN touch drive excites the same-side descending pool (mono)', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const net = createFlightConnectome(g, { mode: 'monocular' });
  let out;
  for (let i = 0; i < 60; i++) out = net.step({ touch: { side: 1, mag: 1 } });
  assert.ok(out.leftDn > out.rightDn, `touch side +1 must drive dnL: ${out.leftDn} vs ${out.rightDn}`);
  assert.ok(out.turn > 0, `touch must produce an evasive turn, got ${out.turn}`);
  const calm = createFlightConnectome(g, { mode: 'monocular' });
  let baseline;
  for (let i = 0; i < 60; i++) baseline = calm.step({});
  assert.equal(baseline.leftDn, 0, 'untouched network must keep zero DN drive');
  assert.equal(baseline.rawTurn, 0, 'untouched network must keep zero raw turn (saccade-free)');
});

test('K29 continuous turn readout grades with asymmetry (mono touch, bino loom)', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const roll = (mode, input) => {
    const net = createFlightConnectome(g, { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step(input);
    return out;
  };
  const mWeak = roll('monocular', { touch: { side: 1, mag: .3 } });
  const mStrong = roll('monocular', { touch: { side: 1, mag: 1 } });
  assert.ok(mWeak.rawTurn > 0 && mStrong.rawTurn > 0, `mono touch must turn right, got ${mWeak.rawTurn}/${mStrong.rawTurn}`);
  assert.ok(mWeak.rawTurn < mStrong.rawTurn, `mono turn must grade with drive: ${mWeak.rawTurn} vs ${mStrong.rawTurn}`);
  assert.ok(mStrong.rawTurn <= .16, `mono turn must stay bounded: ${mStrong.rawTurn}`);
  const bWeak = roll('binocular', { loomingL: .3, loomingR: 0 });
  const bStrong = roll('binocular', { loomingL: 1, loomingR: 0 });
  assert.ok(bWeak.rawTurn > 0 && bStrong.rawTurn > 0, `bino loom must turn right, got ${bWeak.rawTurn}/${bStrong.rawTurn}`);
  assert.ok(bWeak.rawTurn < bStrong.rawTurn, `bino turn must grade with drive: ${bWeak.rawTurn} vs ${bStrong.rawTurn}`);
  assert.ok(bStrong.rawTurn <= .16, `bino turn must stay bounded: ${bStrong.rawTurn}`);
});

test.skip('K30 climb commitment inhibits lateral veer (mono+bino) — skipped: flag off (revert 2026-10-30)', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const gw = [0, .1, 0, .1, .8, .1, 0, .5, 0]; // wall ahead, open above, open sides (gap: no gate)
  const gx = [0, .1, 0, .1, .7, .1, 0, .6, 0];
  const roll = (mode, loomC) => {
    const net = createFlightConnectome(g, { mode });
    let out;
    const input = { gridWall: gw, grid: gx, loomingC: loomC, loomingL: .5, loomingR: 0 };
    for (let i = 0; i < 60; i++) out = net.step(input);
    return out;
  };
  for (const mode of ['monocular', 'binocular']) {
    const climb = roll(mode, .5), level = roll(mode, 0);
    assert.ok(level.rawTurn > 0, `[${mode}] level baseline must veer, got ${level.rawTurn}`);
    assert.ok(Math.abs(climb.rawTurn) < Math.abs(level.rawTurn), `[${mode}] committed climb must inhibit veer: ${climb.rawTurn} vs ${level.rawTurn}`);
  }
});

test.skip('K31 vertical hold bridges gate release (rule) — skipped: flag off (revert 2026-10-30)', () => {
  const ctl = createCameraRuleController();
  const gate = { gridWall: [0, .1, 0, .5, .8, .5, 0, .5, 0], grid: [0, .1, 0, .3, .7, .3, 0, .5, 0], leftThreat: .8, rightThreat: 0, frontThreat: .2 };
  const free = { gridWall: [0, .1, 0, .1, .8, .1, 0, .5, 0], grid: [0, .1, 0, .1, .7, .1, 0, .5, 0], leftThreat: .8, rightThreat: 0, frontThreat: .2 };
  for (let i = 0; i < 5; i++) ctl.step(gate);
  let held;
  for (let i = 0; i < 5; i++) held = ctl.step(free);
  assert.ok(Math.abs(held.turn) < .02, `hold must suppress veer after release, got ${held.turn}`);
  let late;
  for (let i = 0; i < 20; i++) late = ctl.step(free);
  assert.ok(Math.abs(late.turn) > .05, `veer must return after hold expiry, got ${late.turn}`);
});

test.skip('K31 vertical hold bridges gate release (SNN mono+bino) — skipped: flag off (revert 2026-10-30)', () => {
  const g = mergeFlightGraphs(tinyBase, tinyExt);
  const gwGate = [0, .1, 0, .5, .8, .5, 0, .5, 0], gwFree = [0, .1, 0, .1, .8, .1, 0, .5, 0];
  const gx = [0, .1, 0, .1, .7, .1, 0, .5, 0];
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(g, { mode });
    for (let i = 0; i < 5; i++) net.step({ gridWall: gwGate, grid: gx, loomingL: .5, loomingR: 0 });
    let held;
    for (let i = 0; i < 5; i++) held = net.step({ gridWall: gwFree, grid: gx, loomingL: .5, loomingR: 0 });
    assert.ok(Math.abs(held.rawTurn) < .02, `[${mode}] hold must suppress veer, got ${held.rawTurn}`);
    let late;
    for (let i = 0; i < 25; i++) late = net.step({ gridWall: gwFree, grid: gx, loomingL: .5, loomingR: 0 });
    assert.ok(Math.abs(late.rawTurn) > .03, `[${mode}] veer must return after hold, got ${late.rawTurn}`);
  }
});

test('rule falls back to thirds differential when sectors are absent', () => {
  const rule = createCameraRuleController();
  const out = rule.step({
    leftThreat: 1, rightThreat: 0, frontThreat: 0, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1,
  });
  assert.ok(out.turn > 0, `left thirds threat must veer right, got ${out.turn}`);
});

test('senseVision keeps camera-only goal cues with sensitivity scaling', () => {
  const brain = senseVision({ x: 0, y: .02, z: 0 }, 0, 0, {
    leftThreat: .5, rightThreat: .25, frontThreat: 0, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(.1), goalVisible: 1, goalLockX: .5, goalLockY: 0,
  }, { sensitivity: 1 });
  assert.equal(brain.leftThreat, .5);
  assert.equal(brain.rightThreat, .25);
  assert.ok(brain.goalBearing > 0, 'goal bearing must derive from goalLockX pixels');
});

test('senseVision scales sectors and inner/outer threats with sensitivity', () => {
  const pos = { x: 0, y: .02, z: 0 };
  const vision = {
    leftThreat: .5, rightThreat: .5, frontThreat: .5, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(.5), sectors: Array(8).fill(.5),
    leftOuterThreat: .5, leftInnerThreat: .5, rightInnerThreat: .5, rightOuterThreat: .5,
    goalVisible: 0, goalLockX: 0, goalLockY: 0,
  };
  const full = senseVision(pos, 0, 0, vision, { sensitivity: 1 });
  const half = senseVision(pos, 0, 0, vision, { sensitivity: .5 });
  assert.deepEqual(full.sectors, Array(8).fill(.5));
  assert.deepEqual(half.sectors, Array(8).fill(.25));
  assert.equal(half.leftOuterThreat, .25);
  assert.equal(half.leftInnerThreat, .25);
  assert.equal(half.rightInnerThreat, .25);
  assert.equal(half.rightOuterThreat, .25);
  const bare = senseVision(pos, 0, 0, { ...vision, sectors: undefined, leftOuterThreat: undefined }, { sensitivity: .5 });
  assert.equal(bare.sectors, undefined, 'absent sectors must stay absent');
  assert.equal(bare.leftOuterThreat, undefined, 'absent outer threat must stay absent');
});

test('senseVision maps goal elevation with the capturing eye vertical FOV', () => {
  // Each bino eye renders 115° vertical; mapping with the mono 100° shrinks
  // bino descents so landing dives never fire. Bino must read steeper.
  const pos = { x: 0, y: .1, z: 0 };
  const vision = {
    leftThreat: 0, rightThreat: 0, frontThreat: 0, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: .5, goalLockX: 0, goalLockY: -.5,
  };
  const mono = senseVision(pos, 0, 0, vision, { eyeMode: 'monocular' });
  const bino = senseVision(pos, 0, 0, vision, { eyeMode: 'binocular' });
  const legacy = senseVision(pos, 0, 0, vision);
  assert.ok(Math.abs(bino.goalVertical) > Math.abs(mono.goalVertical) * 1.1, `bino must read steeper, mono=${mono.goalVertical} bino=${bino.goalVertical}`);
  assert.equal(legacy.goalVertical, mono.goalVertical, 'default eyeMode stays monocular');
});

test('senseVision compensates goal elevation by rendered pitch only', () => {
  // pitchGain 0 fixes the eye level: adding full body pitch flips below-goals
  // above while climbing (positive feedback into 2x over-climbs).
  const pos = { x: 0, y: .1, z: 0 };
  const vision = {
    leftThreat: 0, rightThreat: 0, frontThreat: 0, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: .5, goalLockX: 0, goalLockY: -.3,
  };
  const out = senseVision(pos, 0, .4, vision, { eyeMode: 'monocular' });
  assert.ok(out.goalVertical < -.15, `below-goal must read below despite climb pitch, got ${out.goalVertical}`);
});

test('monocular SNN steers from sectors when thirds saturate symmetric', () => {
  const mk = (sectors) => {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
    let output;
    for (let i = 0; i < 60; i++) output = net.step({
      leftThreat: 1, rightThreat: 1, frontThreat: 0,
      grid: Array(9).fill(0), goalVisible: 0, escapeDirection: 1, sectors,
    });
    return output;
  };
  const asym = mk([1, 1, 1, 1, 0, 0, 0, 0]);
  assert.ok(asym.turn > 0, `sector-asymmetric wall must veer away, got ${asym.turn}`);
  assert.ok(asym.leftDrive > asym.rightDrive, 'left sector drive must exceed right');
  const sym = mk(Array(8).fill(.9));
  assert.ok(Math.abs(sym.turn) < .05, `symmetric sectors must hold near straight, got ${sym.turn}`);
});

test('monocular SNN keeps thirds fallback without sectors', () => {
  const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
  let output;
  for (let i = 0; i < 60; i++) output = net.step({
    leftThreat: 1, rightThreat: 0, frontThreat: 0,
    grid: Array(9).fill(0), goalVisible: 0, escapeDirection: 1,
  });
  assert.ok(output.turn > 0, `thirds-only input must still veer away, got ${output.turn}`);
});

test('monocular decoder reports frontal expansion rate (loomingC) on approach, zero when still', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const paint = (x0, x1, y0, y1) => {
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      frame[i] = 20; frame[i + 1] = 50; frame[i + 2] = 120;
    }
    return frame;
  };
  const s1 = decoder.decode(paint(64, 96, 35, 55), width, height);
  assert.equal(s1.loomingC, 0, 'first frame initializes with no history');
  const s2 = decoder.decode(paint(54, 106, 25, 65), width, height);
  assert.ok(s2.loomingC > .01, `expansion must register, got ${s2.loomingC}`);
  let still = s2;
  for (let i = 0; i < 7; i++) still = decoder.decode(paint(54, 106, 25, 65), width, height);
  assert.ok(still.loomingC < s2.loomingC * .15, `rate must decay when still: ${still.loomingC} vs ${s2.loomingC}`);
});

test('binocular decoder reports frontal expansion rate (loomingC) on approach', () => {
  const decoder = createCameraVisionDecoder();
  const width = 320, height = 90;
  const paint = (x0, x1, y0, y1) => {
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255;
    }
    return frame;
  };
  const s1 = decoder.decode(paint(140, 180, 30, 60), width, height, 'binocular');
  assert.equal(s1.loomingC, 0);
  const s2 = decoder.decode(paint(120, 200, 20, 70), width, height, 'binocular');
  assert.ok(s2.loomingC > 0, `bino frontal expansion must register, got ${s2.loomingC}`);
});

test('mono decoder holds straight on gate-forming approach, defaults right at full walls', () => {
  // K21: symmetric tie + wall ahead + verified opening + blocked sides must
  // hold escape 0 (fly straight into gate range); full walls keep +1.
  const width = 160, height = 90;
  const paint = (y0) => {
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
    for (let y = y0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255;
    }
    return frame;
  };
  const gate = createCameraVisionDecoder().decode(paint(45), width, height, 'monocular', { sensorType: 'fog_rgb' });
  assert.equal(gate.escapeDirection, 0, `gate-forming tie must hold straight, got ${gate.escapeDirection}`);
  const wall = createCameraVisionDecoder().decode(paint(0), width, height, 'monocular', { sensorType: 'fog_rgb' });
  assert.equal(wall.escapeDirection, 1, `full-wall tie must default right, got ${wall.escapeDirection}`);
});

test('bino decoder holds straight on gate-forming approach, defaults right at full walls', () => {
  // Same K21 forming-tie contract on the foveated decoder (mono mirror).
  const width = 320, height = 90;
  const paint = (y0) => {
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
    for (let y = y0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      frame[i] = 22; frame[i + 1] = 120; frame[i + 2] = 255;
    }
    return frame;
  };
  const gate = createCameraVisionDecoder().decode(paint(45), width, height, 'binocular', { sensorType: 'fog_rgb' });
  assert.equal(gate.escapeDirection, 0, `gate-forming tie must hold straight, got ${gate.escapeDirection}`);
  const wall = createCameraVisionDecoder().decode(paint(0), width, height, 'binocular', { sensorType: 'fog_rgb' });
  assert.equal(wall.escapeDirection, 1, `full-wall tie must default right, got ${wall.escapeDirection}`);
});

test('mono decoder counts steep-up gray as wall, keeps floor excluded', () => {
  // K23: floor is impossible above a level eye — gray up there is occupied.
  // Vacuous row-3 zeros faked open sky and pinned climbs at the ceiling.
  const frame = new Uint8ClampedArray(160 * 90 * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 95; frame[i + 1] = 95; frame[i + 2] = 95; frame[i + 3] = 255; }
  const s = createCameraVisionDecoder().decode(frame, 160, 90, 'monocular', { sensorType: 'fog_rgb' });
  assert.ok(s.gridWall[1] > .3, `row-3 gray must read occupied, got ${s.gridWall[1]}`);
  assert.equal(s.gridWall[7], 0, `row-0 gray (floor) must stay excluded, got ${s.gridWall[7]}`);
});

test('bino decoder counts steep-up gray as wall, keeps floor excluded', () => {
  // Same K23 row split on the foveated decoder (mono mirror).
  const frame = new Uint8ClampedArray(320 * 90 * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 95; frame[i + 1] = 95; frame[i + 2] = 95; frame[i + 3] = 255; }
  const s = createCameraVisionDecoder().decode(frame, 320, 90, 'binocular', { sensorType: 'fog_rgb' });
  assert.ok(s.gridWall[1] > .3, `row-3 gray must read occupied, got ${s.gridWall[1]}`);
  assert.equal(s.gridWall[7], 0, `row-0 gray (floor) must stay excluded, got ${s.gridWall[7]}`);
});

test('SNN holds the approach line when the decoder reports a forming gate (mono+bino)', () => {
  // K21 composition: decoder escape 0 on a forming gate must not slam to max
  // turn (was .16 via the tie-break); saccade weave stays bounded.
  for (const mode of ['monocular', 'binocular']) {
    const input = {
      leftThreat: .25, rightThreat: .25, frontThreat: .45, upThreat: .2, downThreat: .6,
      grid: [.15, .15, .15, .25, .25, .25, .5, .5, .5],
      gridWall: [.15, .15, .15, .3, .2, .3, .4, .4, .4],
      leftOuterThreat: .25, leftInnerThreat: .5, rightInnerThreat: .5, rightOuterThreat: .25,
      leftEyeNasal: .5, rightEyeNasal: .5, binocularDisparity: 0,
      goalVisible: 0, escapeDirection: 0, sectors: Array(8).fill(.3),
      cellsWall: Array(32).fill(.9), loomingC: 0, altitude: .067,
    };
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let maxTurn = 0, out;
    for (let i = 0; i < 60; i++) { out = net.step(input); maxTurn = Math.max(maxTurn, Math.abs(out.turn)); }
    assert.ok(maxTurn < .15, `${mode}: forming-gate approach must not slam, got ${maxTurn}`);
    assert.ok(Math.abs(out.turn) < .06, `${mode}: unsaturated residue must stay small, got ${out.turn}`);
    assert.ok(Math.abs(out.climb) < .15, `${mode}: far approach must stay level, got ${out.climb}`);
  }
});

test('rule pre-climbs on frontal looming, keeps landing dives exempt', () => {
  // K19R: looming at a FULL wall must not climb (maze2 corner pin) — pre-climb
  // needs verified open above. Open-above looming still pre-climbs.
  const wall = {
    leftThreat: .8, rightThreat: .8, frontThreat: .9, upThreat: .8, downThreat: .8,
    grid: Array(9).fill(.8), goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.8), loomingC: .5,
  };
  const wallOut = createCameraRuleController().step(wall);
  assert.ok(wallOut.climb < .1, `full-wall looming must not climb, got ${wallOut.climb}`);
  const open = {
    leftThreat: .3, rightThreat: .3, frontThreat: .5, upThreat: .1, downThreat: .8,
    grid: [.1, .1, .1, .8, .8, .8, .8, .8, .8],
    gridWall: [.1, .1, .1, .1, .8, .1, .8, .8, .8], // sides open: no gate, pre-climb alone
    goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 0, sectors: Array(8).fill(.4), loomingC: .5,
  };
  const openOut = createCameraRuleController().step(open);
  assert.ok(openOut.climb > .3, `open-above looming must pre-climb, got ${openOut.climb}`);
  const trap = {
    leftThreat: 0, rightThreat: 0, frontThreat: .65, upThreat: .83, downThreat: .39,
    grid: [.83, .83, .83, .83, .65, .83, .83, .16, .83], goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.5),
  };
  const diveStill = createCameraRuleController().step(trap);
  assert.ok(diveStill.climb < 0, `bottom-gate brain must dive, got ${diveStill.climb}`);
  const diveLoom = createCameraRuleController().step({ ...trap, loomingC: .5 });
  assert.equal(diveLoom.climb, diveStill.climb, 'looming must leave a landing dive untouched');
});

test('SNN pre-climbs on frontal looming with no gate and no goal (mono+bino)', () => {
  // Same K19R pre-climb contract through pools (rule parity): full-wall
  // looming stays level, open-above looming climbs.
  for (const mode of ['monocular', 'binocular']) {
    const g = mergeFlightGraphs(tinyBase, tinyExt);
    const wallNet = createFlightConnectome(g, { mode });
    let wall;
    for (let i = 0; i < 60; i++) wall = wallNet.step({ grid: Array(9).fill(.8), frontThreat: .8, loomingC: .5 });
    assert.ok(wall.climb < .2, `${mode}: full-wall looming must not climb, got ${wall.climb}`);
    const openNet = createFlightConnectome(g, { mode });
    let open;
    for (let i = 0; i < 60; i++) open = openNet.step({
      grid: [.1, .1, .1, .8, .8, .8, .8, .8, .8],
      gridWall: [.1, .1, .1, .1, .8, .1, .8, .8, .8], // sides open: no gate, pre-climb alone
      frontThreat: .5, loomingC: .5,
    });
    assert.ok(open.climb > .3, `${mode}: open-above looming must pre-climb, got ${open.climb}`);
  }
});

test('SNN trap holds a looming approach climb, aborts a frozen one (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const g = mergeFlightGraphs(tinyBase, tinyExt);
    const loomNet = createFlightConnectome(g, { mode });
    const stillNet = createFlightConnectome(g, { mode });
    const grid = Array(9).fill(0);
    grid[4] = .5; grid[1] = .1; grid[7] = .3; // open-top gate
    let lo, st;
    for (let i = 0; i < 60; i++) {
      const base = { grid, downThreat: .3, upThreat: .1, goalVisible: 0, dt: .05 };
      lo = loomNet.step({ ...base, loomingC: .5 });
      st = stillNet.step(base);
    }
    assert.ok(st.climb < .3, `${mode}: frozen climb must trip the trap, got ${st.climb}`);
    assert.ok(lo.climb > st.climb, `${mode}: approaching climb must outlast: ${lo.climb} vs ${st.climb}`);
  }
});

test('step clock consumes fixed steps, caps per frame and counts drops', () => {
  let s = consumeSteps(0, SIM_STEP_H);
  assert.equal(s.steps, 1);
  assert.ok(Math.abs(s.acc) < 1e-12);
  assert.equal(s.dropped, 0);
  s = consumeSteps(0, SIM_STEP_H * 2);
  assert.equal(s.steps, 2);
  s = consumeSteps(0, 10); // tab-switch surge: cap steps, count the rest
  assert.equal(s.steps, SIM_MAX_STEPS);
  assert.ok(s.dropped > 500);
  assert.ok(s.acc < SIM_STEP_H * 1.001); // floor-division remainder (float slack)
  s = consumeSteps(0, -1); // clock glitch: ignore, never step backwards
  assert.equal(s.steps, 0);
  assert.equal(s.dropped, 0);
});

test('step clock carries fractional remainder across frames', () => {
  let s = consumeSteps(0, SIM_STEP_H * 1.5);
  assert.equal(s.steps, 1);
  assert.ok(Math.abs(s.acc - SIM_STEP_H * .5) < 1e-12);
  s = consumeSteps(s.acc, SIM_STEP_H * .6);
  assert.equal(s.steps, 1);
  assert.ok(Math.abs(s.acc - SIM_STEP_H * .1) < 1e-9);
});

test('circuit reset splits dynamics from learned gains', () => {
  const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode: 'monocular' });
  const grid = Array(9).fill(0);
  grid[4] = 1; for (let i = 6; i < 9; i++) grid[i] = 1;
  const gridWall = grid.slice(); gridWall[3] = gridWall[5] = .8; // K16-A: sides blocked
  for (let i = 0; i < 60; i++) net.step({ grid, gridWall, altitude: .02 });
  for (let i = 0; i < 3; i++) net.reinforce(1);
  const learned = net.stats().gains;
  assert.ok(learned.climb > 1, `reinforcement must move the climb gain, got ${learned.climb}`);
  net.reset();
  assert.deepEqual(net.stats().gains, learned, 'dynamics reset must preserve learned gains');
  assert.equal(net.stats().spikes, 0, 'dynamics reset must clear spikes');
  net.resetLearning();
  assert.ok(Object.values(net.stats().gains).every((g) => g === 1), 'learning reset must restore unit gains');
  assert.equal(net.stats().rewardUpdates, 0);
});

test('rule casts alternating idle pulses mirroring the SNN saccade', () => {
  const rule = createCameraRuleController();
  const idle = {
    leftThreat: 0, rightThreat: 0, frontThreat: 0, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(0),
  };
  const first = rule.step(idle);
  assert.ok(Math.abs(first.turn - .1) < 1e-12, `first pulse must be +.10, got ${first.turn}`);
  let mid;
  for (let i = 0; i < 29; i++) mid = rule.step(idle); // castN=30: window edge
  assert.equal(mid.turn, 0, 'pulse window must end after 30 steps');
  let alt;
  for (let i = 0; i < 211; i++) alt = rule.step(idle); // castN=241: second period
  assert.ok(Math.abs(alt.turn + .1) < 1e-12, `second period must reverse, got ${alt.turn}`);
});

test('rule casting vetoes on goal lock, gate transit and awake avoidance', () => {
  const base = {
    leftThreat: 0, rightThreat: 0, frontThreat: 0, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(0),
  };
  const goal = createCameraRuleController().step({ ...base, goalVisible: .5 });
  assert.equal(goal.turn, 0, 'goal lock must veto casting');
  const gate = Array(9).fill(0); gate[1] = .1; gate[4] = .5; gate[7] = .3;
  const transit = createCameraRuleController().step({ ...base, grid: gate, gridWall: [0, .1, 0, .8, .5, .8, 0, .3, 0] }); // K16-A: sides blocked
  assert.equal(transit.turn, 0, 'gate transit must veto casting');
  const awake = createCameraRuleController().step({ ...base, frontThreat: 1, sectors: Array(8).fill(.8) });
  assert.ok(awake.turn > .09 && awake.turn < .12, `awake avoidance must not cast, got ${awake.turn}`);
  const touched = createCameraRuleController().step({ ...base, touch: { side: 1, mag: 1 } });
  assert.ok(Math.abs(touched.turn - .16) < 1e-12, `contact must veto casting, got ${touched.turn}`);
});

test('rule alternates escape side after sustained saturated blockage', () => {
  const rule = createCameraRuleController();
  const stuck = {
    leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 0, downThreat: 0,
    grid: [.8, .8, .8, .8, .8, .8, 1, 1, 1], goalVisible: 0, goalLockX: 0, goalBearing: 0, // wall base below
    escapeDirection: 1, sectors: Array(8).fill(.8),
  };
  const early = rule.step(stuck);
  assert.ok(early.turn > .09, `must veer with the decoder side first, got ${early.turn}`);
  let late;
  for (let i = 0; i < 120; i++) late = rule.step(stuck); // satN=121: flipped
  assert.ok(late.turn < -.05, `must reverse after 120 stuck steps, got ${late.turn}`);
  rule.reset();
  const fresh = rule.step(stuck);
  assert.equal(fresh.turn, early.turn, 'reset must restore the initial veer side');
});

test('rule keeps asymmetric wall-following and goal runs unflipped', () => {
  const rule = createCameraRuleController();
  const wall = {
    leftThreat: 1, rightThreat: 0, frontThreat: .2, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: [1, 1, 1, 1, 0, 0, 0, 0],
  };
  for (let i = 0; i < 200; i++) {
    const out = rule.step(wall);
    assert.ok(out.turn > 0, `wall-following must keep its side, got ${out.turn} at step ${i}`);
  }
  const chase = createCameraRuleController();
  const satGoal = {
    leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(.8), goalVisible: .5, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.8),
  };
  const first = chase.step(satGoal);
  for (let i = 0; i < 200; i++) {
    assert.equal(chase.step(satGoal).turn, first.turn, 'goal-visible runs must never flip veer side');
  }
});

test('rule suppresses sector avoidance during goal fixation', () => {
  const mk = (goalVisible) => ({
    leftThreat: 1, rightThreat: 0, frontThreat: 1, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: [1, 1, 1, 1, 0, 0, 0, 0],
  });
  const fixed = createCameraRuleController().step(mk(1));
  assert.ok(Math.abs(fixed.turn) < .05, `goal fixation must quiet sector avoidance, got ${fixed.turn}`);
  const free = createCameraRuleController().step(mk(0));
  assert.ok(free.turn > .09, `no-goal sectors must still avoid, got ${free.turn}`);
});

test('rule suppresses lateral avoidance during gate transit', () => {
  const grid = Array(9).fill(.8); grid[1] = .1; grid[7] = .5;
  const out = createCameraRuleController().step({
    leftThreat: 1, rightThreat: 0, frontThreat: 1, upThreat: 0, downThreat: 0,
    grid, goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: [1, 1, 1, 1, 0, 0, 0, 0],
  });
  assert.ok(Math.abs(out.turn) < .03, `gate transit must fly straight laterally, got ${out.turn}`);
  assert.equal(out.climb, .85, 'open-top gate must still command climb');
});

test('rule goes straight on symmetric input in the open and explores via cast', () => {
  const rule = createCameraRuleController();
  const sym = {
    leftThreat: .3, rightThreat: .3, frontThreat: .3, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(.3), goalVisible: 0, goalLockX: 0, goalBearing: 0, // open-consistent grid
    escapeDirection: 1, sectors: Array(8).fill(.8),
  };
  const first = rule.step(sym);
  assert.ok(Math.abs(first.turn - .1) < 1e-9, `symmetric input must cast (not veer), got ${first.turn}`);
  let idle;
  for (let i = 0; i < 30; i++) idle = rule.step(sym); // castN=31: pulse window over
  assert.equal(idle.turn, 0, 'symmetric input must hold straight outside the pulse window');
});

test('rule adds no centering bias on uniformly free sectors', () => {
  const out = createCameraRuleController().step({
    leftThreat: .3, rightThreat: 0, frontThreat: .5, upThreat: 0, downThreat: 0,
    grid: Array(9).fill(0), goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(0),
  });
  assert.ok(Math.abs(out.turn - .052) < 1e-9, `uniform sectors must not bias the turn, got ${out.turn}`);
});

test('ALIF plugin uses climb/dive gain keys with finite vertical updates', () => {
  const P = ALIFSurrogatePlugin;
  const mkState = () => ({
    gains: { left: 1, right: 1, climb: 1, dive: 1 },
    eligibility: { left: .5, right: 0, climb: .5, dive: 0 },
    learnRate: .012, meanSurrogateGrad: 0, rewardUpdates: 0, cumulativeReward: 0,
    collisionIndex: 0, rewardEma: 0, explorationRate: 0,
  });
  const cfg = { eligibilityThreshold: .05, minGain: .5, maxGain: 2 };
  const st = mkState();
  const out = P.reinforce(st, cfg, -1, { turn: .1, climb: .5 }, { rawTurn: 0, rawClimb: 0 });
  assert.ok(out.updated > 0, 'collision coaching must update gains');
  for (const k of ['left', 'right', 'climb', 'dive']) {
    assert.ok(Number.isFinite(st.gains[k]), `${k} gain must stay finite, got ${st.gains[k]}`);
    assert.ok(Number.isFinite(st.eligibility[k]), `${k} eligibility must stay finite`);
  }
  assert.ok(st.gains.climb > 1, `climb gain must learn upward, got ${st.gains.climb}`);
  const st2 = mkState();
  P.updateReadoutEligibility(st2, {}, 0, 0, 1, .8, 0, { leftThreat: 0, rightThreat: 0, frontThreat: 0 });
  assert.ok(!('upper' in st2.eligibility) && !('lower' in st2.eligibility), 'must not create legacy upper/lower keys');
  assert.ok(Number.isFinite(st2.eligibility.climb) && st2.eligibility.climb > 0, 'climb eligibility must accumulate');
});

test('ALIF plugin washout matches the LIF 0.05 restore rate', () => {
  const P = ALIFSurrogatePlugin;
  const st = {
    gains: { left: 1.03, right: 1, climb: 1.03, dive: 1 },
    eligibility: { left: .5, right: .5, climb: .5, dive: .5 },
    learnRate: .012, meanSurrogateGrad: 0, rewardUpdates: 0, cumulativeReward: 0,
    collisionIndex: 0, rewardEma: 0, explorationRate: 0,
  };
  const cfg = { eligibilityThreshold: .05, minGain: .5, maxGain: 2 };
  P.reinforce(st, cfg, 0, { turn: 0, climb: 0 }, { rawTurn: 0, rawClimb: 0 });
  const expect = 1.03 + .012 * ((1 - 1.03) * 0.05);
  assert.ok(Math.abs(st.gains.climb - expect) < 1e-12, `washout must use 0.05, got ${st.gains.climb}`);
});

test('monocular escapeDirection holds with Schmitt hysteresis near zero', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const paint = (bL, bR) => {
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
    const fill = (x0, x1, b) => {
      if (b <= 0) return;
      for (let y = 0; y < height; y++) for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        frame[i] = 20; frame[i + 1] = 50; frame[i + 2] = b; frame[i + 3] = 255;
      }
    };
    fill(0, 53, bL); fill(107, 159, bR);
    return frame;
  };
  const run = (f) => decoder.decode(f, width, height, 'monocular').escapeDirection;
  assert.equal(run(paint(100, 0)), 1, 'clear-left wall must escape right first');
  assert.equal(run(paint(100, 101)), 1, 'asymmetry inside the band must not flip the escape side');
  assert.equal(run(paint(100, 110)), -1, 'asymmetry past the band must flip the escape side');
  assert.equal(run(paint(100, 0)), 1, 'strong opposite asymmetry must flip back');
});

test('binocular escapeDirection holds with Schmitt hysteresis near zero', () => {
  const decoder = createCameraVisionDecoder();
  const width = 160, height = 90;
  const paint = (cols, pixels) => {
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
    const dot = (x, y) => { const i = (y * width + x) * 4; frame[i] = 20; frame[i + 1] = 80; frame[i + 2] = 180; frame[i + 3] = 255; };
    for (let y = 0; y < height; y++) for (let x = 0; x <= 39; x++) { dot(x, y); dot(159 - x, y); }
    for (const [x0, x1] of cols) for (let y = 0; y < height; y++) for (let x = x0; x <= x1; x++) dot(x, y);
    for (const [x, y] of pixels) dot(x, y);
    return frame;
  };
  const run = (f) => decoder.decode(f, width, height, 'binocular').escapeDirection;
  assert.equal(run(paint([], [])), 0, 'exact symmetry must hold straight when not boxed');
  assert.equal(run(paint([], [[70, 45]])), 0, 'one-pixel asymmetry must not flip the escape side');
  assert.equal(run(paint([[65, 79]], [])), -1, 'strong right asymmetry must flip the escape side');
  assert.equal(run(paint([], [])), -1, 'exact symmetry must hold the flipped side');
  assert.equal(run(paint([[80, 94]], [])), 1, 'strong left asymmetry must flip back');
});

test('rule neutralizes near-symmetric ties in the open but veers when confined', () => {
  const mk = (frontThreat) => {
    const grid = Array(9).fill(.5); grid[1] = .4; grid[7] = .4; // gates shut under the K7 .45 bar; tie-break lateral unchanged
    return {
    leftThreat: 0, rightThreat: 0, frontThreat, upThreat: 0, downThreat: 0,
    grid, goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: [.5, .5, .5, .505, .5, .5, .5, .5],
    touch: { side: 1, mag: .5 },
    };
  };
  const open = createCameraRuleController().step(mk(.3));
  assert.ok(Math.abs(open.turn - .0805) < 1e-3, `open near-tie must not bias the turn, got ${open.turn}`);
  const tight = createCameraRuleController().step(mk(.9));
  assert.equal(tight.turn, .16, `confined near-tie must keep exploratory veer, got ${tight.turn}`);
});

test('bump EMA gates withdrawal on sustained grinding, not brushes', () => {
  let ema = 0;
  for (let i = 0; i < 5; i++) ema = stepBumpEma(ema, true, .05); // grind burst
  assert.ok(isUnwedging(ema), `5 quick bumps must unwedge, ema=${ema}`);
  assert.ok(!isUnwedging(stepBumpEma(0, true, .05)), 'a single brush must not unwedge');
  assert.equal(isUnwedging(UNWEDGE_BUMPS), false);
  assert.equal(isUnwedging(UNWEDGE_BUMPS + .01), true);
  let calm = ema;
  for (let i = 0; i < 600; i++) calm = stepBumpEma(calm, false, .05); // 30s quiet
  assert.ok(!isUnwedging(calm) && calm < .01, `quiet must decay the drive, ema=${calm}`);
});

test('odometry straightness separates milling from threading', () => {
  assert.equal(isStalled(undefined), false, 'missing odometry must not read stalled');
  let o = stepOdometry(undefined, { x: 0, y: 0, z: 0 }, .05);
  assert.equal(isStalled(o), false, 'fresh odometry must not read stalled');
  let p = 0;
  for (let i = 0; i < 201; i++) { p = (i % 2 === 0) ? .01 : -.01; o = stepOdometry(o, { x: p, y: 0, z: 0 }, .05); }
  assert.ok(isStalled(o), `milling must read stalled, straight=${o.straight}`);
  assert.ok(isUnwedging(5) && isStalled(o), 'grinding in place must withdraw');
  let q; let x = 0;
  for (let i = 0; i < 201; i++) { x += .12 * .05; q = stepOdometry(q, { x, y: 0, z: 0 }, .05); }
  assert.ok(!isStalled(q), `cruise must not stall, straight=${q.straight}`);
  assert.ok(!(isUnwedging(5) && isStalled(q)), 'threading scrapes must push through');
});

test('rule pre-climb stays level toward bottom openings and flat walls', () => {
  const mk = (upper, lower) => {
    const grid = Array(9).fill(.8); grid[1] = upper; grid[7] = lower;
    return {
      leftThreat: 0, rightThreat: 0, frontThreat: .9, upThreat: 0, downThreat: 0,
      grid, goalVisible: 0, goalLockX: 0, goalLockY: 0, goalBearing: 0,
      escapeDirection: 1, sectors: Array(8).fill(.5),
    };
  };
  const bottom = mk(.8, .7); // lower opener, no gate
  assert.equal(createCameraRuleController().step({ ...bottom, loomingC: .5 }).climb,
    createCameraRuleController().step(bottom).climb, 'bottom hint must not pre-climb');
  const flat = mk(.8, .8);
  assert.equal(createCameraRuleController().step({ ...flat, loomingC: .5 }).climb,
    createCameraRuleController().step(flat).climb, 'flat wall must not pre-climb');
});

test('SNN pre-climb stays level toward bottom openings (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const g = mergeFlightGraphs(tinyBase, tinyExt);
    const loomNet = createFlightConnectome(g, { mode });
    const stillNet = createFlightConnectome(g, { mode });
    const grid = Array(9).fill(.8); grid[7] = .7; // lower opener hint, no gate
    let lo, st;
    for (let i = 0; i < 60; i++) {
      lo = loomNet.step({ grid, loomingC: .5 });
      st = stillNet.step({ grid });
    }
    assert.equal(lo.climb, st.climb, `${mode}: bottom hint must not pre-climb`);
  }
});

test('SNN floor-trap dive keeps diving under frontal looming (mono+bino)', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    const grid = Array(9).fill(0);
    grid[4] = .65; grid[1] = .83; grid[7] = .16;
    let output;
    for (let i = 0; i < 120; i++) output = net.step({ grid, downThreat: .39, upThreat: .83, goalVisible: 0,
      loomingC: .5, dt: 1 / 60 });
    assert.ok(output.climb < 0, `${mode}: looming dive must not trip: climb=${output.climb}`);
  }
});

test.skip('bino L/F/R threats drop the fovea boost (mono parity, K25a) — RETIRED V1.6', () => {
  // Same pose read F=0.79 bino vs 0.40 mono in batch (ceiling trap root):
  // frontal occupancy must equal the RAW wall sums, never the x1.42 fovea
  // boost (boost stays only in innerL/innerR disparity signals).
  const width = 320, height = 90;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 20; frame[i + 1] = 50; frame[i + 2] = 90; frame[i + 3] = 255; }
  const s = createCameraVisionDecoder().decode(frame, width, height, 'binocular', { sensorType: 'fog_rgb' });
  let maxCell = 0;
  for (let r = 0; r < 4; r++) for (let c = 2; c <= 5; c++) maxCell = Math.max(maxCell, s.cellsWall[r * 8 + c]);
  assert.ok(maxCell > .3, `dim-blue frame must occupy frontal cells, got ${maxCell}`);
  assert.ok(s.occupancy.front <= maxCell + 1e-9, `frontal occupancy must not exceed the raw cell max (boosted=${s.occupancy.front} raw-max=${maxCell})`);
  const hot = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < hot.length; i += 4) { hot[i] = 22; hot[i + 1] = 120; hot[i + 2] = 255; hot[i + 3] = 255; }
  const sh = createCameraVisionDecoder().decode(hot, width, height, 'binocular', { sensorType: 'fog_rgb' });
  assert.equal(sh.frontThreat, 1, 'full bright wall must still saturate the frontal threat');
});

test.skip('rule zeroes climb and sinks gently at the ceiling (K25b) — RETIRED V1.6', () => {
  // Batch cfg22: cornerClimb pressed +0.16 into the guard forever (K17 grades
  // against WORLD.Y .20, never zeroes at the .1645 guard). Ceiling input must
  // sink; the same input at cruise altitude must still climb.
  const gridWall = [.5, .5, .5, .5, .5, .5, .5, 1, .5];
  gridWall[0] = 0; gridWall[2] = 0; gridWall[6] = 1; gridWall[8] = 1; // upper open, lower blocked
  const mk = (altitude) => ({
    leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 1, downThreat: 1,
    grid: Array(9).fill(.5), gridWall: gridWall.slice(), altitude,
    goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.5),
  });
  const ceil = createCameraRuleController().step(mk(.165));
  assert.ok(Math.abs(ceil.climb + .15) < 1e-12, `ceiling must sink gently, got ${ceil.climb}`);
  const cruise = createCameraRuleController().step(mk(.08));
  assert.ok(Math.abs(cruise.climb - .35) < 1e-9, `cruise corner escape must still climb, got ${cruise.climb}`);
});

test.skip('SNN sinks at the ceiling on corner escape (mono+bino, K25b) — RETIRED V1.6', () => {
  for (const mode of ['monocular', 'binocular']) {
    const gridWall = [.5, .5, .5, .5, .5, .5, .5, 1, .5];
    gridWall[0] = 0; gridWall[2] = 0; gridWall[6] = 1; gridWall[8] = 1;
    const mk = (altitude) => ({
      leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 1, downThreat: 1,
      grid: Array(9).fill(.5), gridWall: gridWall.slice(), altitude,
      goalVisible: 0, escapeDirection: 1, sectors: Array(8).fill(.5),
    });
    const ctrl = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let co;
    for (let i = 0; i < 120; i++) co = ctrl.step(mk(.08));
    assert.ok(co.climb > .05, `${mode}: control must climb at cruise, got ${co.climb}`);
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 120; i++) out = net.step(mk(.165));
    assert.ok(out.climb < 0, `${mode}: ceiling corner escape must sink, got ${out.climb}`);
  }
});

test.skip('SNN zeroes an above-goal climb at the ceiling (mono+bino, K25b) — RETIRED V1.6', () => {
  for (const mode of ['monocular', 'binocular']) {
    const net = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let out;
    for (let i = 0; i < 60; i++) out = net.step({
      grid: Array(9).fill(0), gridWall: Array(9).fill(0), altitude: .165,
      goalVisible: .5, goalVertical: .5, escapeDirection: 0,
    });
    assert.equal(out.climb, 0, `${mode}: above-goal climb must zero at the ceiling, got ${out.climb}`);
  }
});

test.skip('rule ceiling latch holds the sink through the band, exits low (K26a) — RETIRED V1.6', () => {
  // K25b dithered at the .16 boundary (climb/sink alternating, no descent).
  // Latched: .16 exposure pins the sink until .12; fresh .15 still climbs.
  const gridWall = [.5, .5, .5, .5, .5, .5, .5, 1, .5];
  gridWall[0] = 0; gridWall[2] = 0; gridWall[6] = 1; gridWall[8] = 1;
  const mk = (altitude) => ({
    leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 1, downThreat: 1,
    grid: Array(9).fill(.5), gridWall: gridWall.slice(), altitude,
    goalVisible: 0, goalLockX: 0, goalBearing: 0,
    escapeDirection: 1, sectors: Array(8).fill(.5),
  });
  const c = createCameraRuleController();
  assert.ok(Math.abs(c.step(mk(.165)).climb + .15) < 1e-12, 'ceiling entry must sink');
  assert.ok(Math.abs(c.step(mk(.15)).climb + .15) < 1e-12, 'latched band must keep sinking, not dither');
  assert.ok(Math.abs(c.step(mk(.10)).climb - .35) < 1e-9, `exit below .12 must climb again, got ${c.step(mk(.10)).climb}`);
  const fresh = createCameraRuleController().step(mk(.15));
  assert.ok(fresh.climb > .2, `fresh .15 (no latch) must climb, got ${fresh.climb}`);
});

test.skip('SNN ceiling latch sinks after exposure, climbs fresh (mono+bino, K26a) — RETIRED V1.6', () => {
  for (const mode of ['monocular', 'binocular']) {
    const gridWall = [.5, .5, .5, .5, .5, .5, .5, 1, .5];
    gridWall[0] = 0; gridWall[2] = 0; gridWall[6] = 1; gridWall[8] = 1;
    const mk = (altitude) => ({
      leftThreat: 1, rightThreat: 1, frontThreat: 1, upThreat: 1, downThreat: 1,
      grid: Array(9).fill(.5), gridWall: gridWall.slice(), altitude,
      goalVisible: 0, escapeDirection: 1, sectors: Array(8).fill(.5),
    });
    const exp = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let eo;
    for (let i = 0; i < 60; i++) eo = exp.step(mk(.165));
    for (let i = 0; i < 60; i++) eo = exp.step(mk(.15));
    const fre = createFlightConnectome(mergeFlightGraphs(tinyBase, tinyExt), { mode });
    let fo;
    for (let i = 0; i < 120; i++) fo = fre.step(mk(.15));
    assert.ok(eo.climb < fo.climb - .08, `${mode}: latched band must sink below fresh climb (${eo.climb} vs ${fo.climb})`);
  }
});

test('clampEyeToChamber keeps the head-ahead eye inside the liner at wall contact', () => {
  const dims = { W: 1, Z: 1, Y: 0.20 };
  assert.equal(EYE_CHAMBER_MARGIN, 0.003);
  // head-on outer-wall contact: body center clamps 6.5mm out, eye sits 7mm ahead
  // → raw eye at W/2+.0005 (outside the chamber); clamp pulls it to W/2-.003,
  // inside the liner inner face (1.7mm) with room past the 1mm near plane.
  const contact = clampEyeToChamber({ x: 0.5 - 0.0065 + 0.007, y: 0.02, z: 0 }, dims);
  assert.ok(Math.abs(contact.x - (0.5 - 0.003)) < 1e-12, `eye must clamp inside: x=${contact.x}`);
  assert.ok(contact.x < 0.5 - 0.0017, 'eye must stay inside the liner inner face');
  // free flight is untouched
  const free = clampEyeToChamber({ x: 0.1, y: 0.05, z: -0.2 }, dims);
  assert.deepEqual(free, { x: 0.1, y: 0.05, z: -0.2 });
  // floor/ceiling guard: 3mm margin both ends
  assert.ok(Math.abs(clampEyeToChamber({ x: 0, y: 0.199, z: 0 }, dims).y - 0.197) < 1e-12);
  assert.ok(Math.abs(clampEyeToChamber({ x: 0, y: 0.001, z: 0 }, dims).y - 0.003) < 1e-12);
});
