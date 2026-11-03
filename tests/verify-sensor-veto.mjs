#!/usr/bin/env node
// NSP 3D sensor234 + geometric-veto invariants (ESM, zero hardcoded paths).
// Pins: decoder build stamp, RGB-free far veto, G-channel floor routing,
// legacy synthetic-buffer fallback, fog byte-identity, flow first-frame calm,
// fusion weighted-blend path. Run: node tests/verify-sensor-veto.mjs
import assert from 'node:assert/strict';
import {
  DECODER_BUILD, classifyPixel, evaluateSensorPixel, createMonocularVisionDecoder,
} from '../src/vision/camera-vision.js';

assert.equal(DECODER_BUILD, '2026-11-01+sensor234-geoveto2-flr2-fu13');

const wallAt = (linD, G = 0) => {
  const R = Math.round(linD * 255);
  const rgba = new Uint8Array([20, 20, 20, 255]); // fog-killed: no RGB obstacle
  const depth = new Uint8Array([R, G, 255, 255]); // B=valid shader geometry
  return evaluateSensorPixel(classifyPixel(20, 20, 20), 0, 0, 0, 1, 1,
    rgba, depth, 'z_depth', null, null);
};

// Far wall (25cm) stays silent through the geometric veto; near wall stays hot.
const far = wallAt(0.28), near = wallAt(0.8), mid = wallAt(0.5), edge = wallAt(0.33);
assert.equal(far.proximity, 0);
assert.equal(far.obstacle, false);
assert.ok(near.proximity >= 0.9 && near.obstacle);
assert.ok(mid.proximity > 0.1 && mid.proximity < 0.5 && mid.proximity < near.proximity); // near-range gradient (decode)
assert.ok(Math.abs(edge.proximity - 0.16) < 0.01); // just above veto edge reads floor

// G-channel floor routes to the floor curve and is exempt from the veto.
const floor = wallAt(0.28, 255);
assert.equal(floor.isFloorSlab, true);
assert.ok(Math.abs(floor.proximity - 0.20) < 1e-9);

// Legacy fallback (synthetic G=0/B=0 buffer) keeps RGB-dependent behavior.
{
  const R = Math.round(0.28 * 255);
  const ev = evaluateSensorPixel(classifyPixel(30, 40, 200), 0, 0, 0, 1, 1,
    new Uint8Array([30, 40, 200, 255]), new Uint8Array([R, 0, 0, 255]),
    'z_depth', null, null);
  assert.ok(ev.proximity > 0.5 && ev.obstacle); // veto passes: RGB sees the wall
}

// Fog path is byte-identical to the classifier (independence guarantee).
{
  const px = classifyPixel(30, 40, 200);
  const ev = evaluateSensorPixel(px, 0, 0, 0, 1, 1,
    new Uint8Array([30, 40, 200, 255]), null, 'fog_rgb', null, null);
  assert.equal(ev.proximity, px.proximity);
  assert.equal(ev.visualDepth, px.visualDepth);
  assert.equal(ev.obstacle, px.obstacle);
}

// Flow first frame on a uniform field: no spike, no obstacle.
{
  const n = 4, rgba = new Uint8Array(n * 4).fill(20);
  const prev = new Float32Array(n).fill(NaN), ema = new Float32Array(n);
  const ev = evaluateSensorPixel(classifyPixel(20, 20, 20), 0, 0, 0, 2, 2,
    rgba, null, 'optical_flow', prev, ema);
  assert.equal(ev.obstacle, false);
  assert.equal(ev.proximity, 0);
}

// Fusion weighted-blend path (below the near-field override).
{
  const R = Math.round(0.5 * 255);
  const n = 1, rgba = new Uint8Array([70, 70, 70, 255]); // gray floor pixel
  const depth = new Uint8Array([R, 255, 255, 255]);
  const ev = evaluateSensorPixel(classifyPixel(70, 70, 70), 0, 0, 0, 1, 1,
    rgba, depth, 'sensor_fusion', new Float32Array(n).fill(NaN), new Float32Array(n));
  assert.ok(ev.obstacle);
  assert.ok(Math.abs(ev.proximity - 0.2031) < 0.005); // fu13: .7778*fog + .2222*flow (=0.2069 here)
}
// F3: fusion floor routing follows COLOR, not depth G (BA fusion-only review).
// Blue wall + G=255 (depth says floor): wall must stay a wall.
{
  const ev = evaluateSensorPixel(classifyPixel(22, 52, 200), 0, 0, 0, 1, 1,
    new Uint8Array([22, 52, 200, 255]), new Uint8Array([128, 255, 255, 255]),
    'sensor_fusion', new Float32Array(1).fill(NaN), new Float32Array(1));
  assert.ok(ev.obstacle);
  assert.equal(ev.isFloorSlab, false); // color overrules G=255
}
// D3: z_depth floor routing is color-first (same prescription as fusion F3);
// dark pixels with no color signature keep the depth verdict.
{
  const ev = evaluateSensorPixel(classifyPixel(22, 52, 200), 0, 0, 0, 1, 1,
    new Uint8Array([22, 52, 200, 255]), new Uint8Array([128, 255, 255, 255]),
    'z_depth', new Float32Array(1).fill(NaN), new Float32Array(1));
  assert.ok(ev.obstacle);
  assert.equal(ev.isFloorSlab, false); // blue wall stays a wall even with G=255
  const dark = evaluateSensorPixel(classifyPixel(20, 20, 20), 0, 0, 0, 1, 1,
    new Uint8Array([20, 20, 20, 255]), new Uint8Array([128, 255, 255, 255]),
    'z_depth', new Float32Array(1).fill(NaN), new Float32Array(1));
  assert.equal(dark.isFloorSlab, true); // dark + G=255 keeps depth verdict
}

// Decoder level: all-wall 25cm frame stays empty, 8cm frame saturates.
function decodeFrame(linD) {
  const dec = createMonocularVisionDecoder();
  const w = 64, h = 40, n = w * h, R = Math.round(linD * 255);
  const rgba = new Uint8Array(n * 4), depth = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { rgba.set([20, 20, 20, 255], i * 4); depth.set([R, 0, 255, 255], i * 4); }
  let s;
  for (let k = 0; k < 3; k++) s = dec.decode(rgba, w, h, { sensorType: 'z_depth', depthPixels: depth });
  return s;
}
{
  const f = decodeFrame(0.28), c = decodeFrame(0.8);
  assert.ok(f.occupancy.front < 0.05 && f.occupancy.left < 0.05);
  assert.ok(c.occupancy.front > 0.9);
}

// Bino seam: other-eye motion must not leak across the L/R boundary.
{
  const rgbaB = new Uint8Array([20, 20, 20, 255, 20, 20, 20, 255, 200, 200, 200, 255, 200, 200, 200, 255]);
  const px = classifyPixel(20, 20, 20);
  const mkBufs = () => [new Float32Array(4).fill(20 / 255), new Float32Array(4)];
  const [p1, e1] = mkBufs(), [p2, e2] = mkBufs();
  const g = evaluateSensorPixel(px, 1, 1, 0, 4, 1, rgbaB, null, 'optical_flow', p1, e1, 2);
  assert.equal(g.obstacle, false);
  assert.equal(g.proximity, 0);
  const u = evaluateSensorPixel(px, 1, 1, 0, 4, 1, rgbaB, null, 'optical_flow', p2, e2);
  assert.equal(u.obstacle, true); // unguarded seam leaks (documents why the guard exists)
  assert.ok(u.proximity > 0);
}

console.log(JSON.stringify({ sensorVeto: 'PASS', build: DECODER_BUILD }));
