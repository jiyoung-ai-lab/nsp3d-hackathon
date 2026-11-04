#!/usr/bin/env node
// NSP 3D fixed-step clock check (ESM, zero hardcoded paths).
// Guards the math the multilab/main speed selectors rely on: fixed-h
// integration, the per-frame step cap, and drop accounting when a frame
// budget (frameDt x speed) exceeds the cap.
// Run: node tests/verify-step-clock.mjs
import assert from 'node:assert/strict';
import { consumeSteps, SIM_STEP_H, SIM_MAX_STEPS } from '../src/sim/step-clock.js';

assert.equal(SIM_STEP_H, 1 / 60);
assert.equal(SIM_MAX_STEPS, 5);

// 3x at 60fps: 3 steps, nothing dropped.
{
  const r = consumeSteps(0, (1 / 60) * 3);
  assert.equal(r.steps, 3);
  assert.equal(r.dropped, 0);
  assert.ok(r.acc < SIM_STEP_H);
}
// 2x at 60fps (multilab legacy default): 2 steps, nothing dropped.
{
  const r = consumeSteps(0, (1 / 60) * 2);
  assert.equal(r.steps, 2);
  assert.equal(r.dropped, 0);
}
// 3x on a slow (~29fps) frame: cap hit, excess counted as dropped, never compounded.
{
  const r = consumeSteps(0, 0.034 * 3);
  assert.equal(r.steps, SIM_MAX_STEPS);
  assert.ok(r.dropped >= 1);
  assert.ok(r.acc < SIM_STEP_H);
}
// 1x survives a half-second stall: capped steps + drops, bounded accumulator.
{
  const r = consumeSteps(0, 0.5);
  assert.ok(r.steps <= SIM_MAX_STEPS);
  assert.ok(r.dropped > 0);
  assert.ok(r.acc < SIM_STEP_H);
}
// Unified reps behavior (main + multilab): N passes of frameDt at Nx.
{
  const reps = (speed, frameDt) => {
    let acc = 0, steps = 0, dropped = 0;
    for (let k = 0; k < speed; k++) {
      const r = consumeSteps(acc, frameDt);
      acc = r.acc; steps += r.steps; dropped += r.dropped;
    }
    return { steps, dropped };
  };
  assert.deepEqual(reps(3, 1 / 60), { steps: 3, dropped: 0 });
  assert.deepEqual(reps(3, 1 / 30), { steps: 6, dropped: 0 }); // single-pass would cap at 5+drop
  const single = consumeSteps(0, 0.034 * 3); // ~29fps frame, old single-pass style
  assert.equal(single.steps, SIM_MAX_STEPS);
  assert.equal(single.dropped, 1);
}
// Determinism: the same sim-time yields the same step count at any speed.
{
  const run = (speed, frames) => {
    let acc = 0, total = 0;
    for (let i = 0; i < frames; i++) {
      const r = consumeSteps(acc, (1 / 60) * speed);
      acc = r.acc; total += r.steps;
    }
    return total;
  };
  assert.equal(run(3, 1200), 3600); // 20 wall-s at 3x
  assert.equal(run(1, 3600), 3600); // 60 wall-s at 1x
}

console.log(JSON.stringify({ stepH: SIM_STEP_H, maxSteps: SIM_MAX_STEPS, speeds: '1x/2x/3x ok' }));
