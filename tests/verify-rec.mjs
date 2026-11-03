#!/usr/bin/env node
// NSP 3D recording-helper check (ESM, zero hardcoded paths).
// Guards the shared filename/duration-cap contract used by the main sim and
// multilab recorders: source + local datetime in every filename, 180s cap.
// Run: node nsp3d/tests/verify-rec.mjs
import assert from 'node:assert/strict';
import { recFilename, recStamp, recElapsed, recCapped, REC_MAX_S } from '../src/ui/rec-filename.js';

assert.equal(REC_MAX_S, 180);

// Local datetime stamp (not UTC): YYYYMMDD_HHMMSS.
{
  const d = new Date(2026, 9, 31, 15, 30, 22); // local ctor: months are 0-based
  assert.equal(recStamp(d), '20261031_153022');
}
// Filenames carry page + source + stamp; hostile chars are sanitized.
{
  const d = new Date(2026, 9, 31, 15, 30, 22);
  assert.equal(recFilename('main', 'overview', d), 'nsp3d_main_overview_20261031_153022.webm');
  assert.equal(
    recFilename('multilab', 'agent1_neu_mono_fog_rgb_s0', d),
    'nsp3d_multilab_agent1_neu_mono_fog_rgb_s0_20261031_153022.webm'
  );
  assert.equal(recFilename('main', 'tab', d), 'nsp3d_main_tab_20261031_153022.webm');
  assert.equal(recFilename('multilab', 'tab', d), 'nsp3d_multilab_tab_20261031_153022.webm');
  assert.equal(recFilename('a/b', 'x y:z', d), 'nsp3d_a_b_x_y_z_20261031_153022.webm');
}
// Elapsed clock m:ss.
{
  assert.equal(recElapsed(0, 0), '0:00');
  assert.equal(recElapsed(0, 45000), '0:45');
  assert.equal(recElapsed(0, 179999), '2:59');
  assert.equal(recElapsed(1000, 500), '0:00'); // clock skew never goes negative
}
// Cap trips at exactly REC_MAX_S.
{
  assert.equal(recCapped(0, 179999), false);
  assert.equal(recCapped(0, 180000), true);
  assert.equal(recCapped(0, 180001), true);
}

console.log(JSON.stringify({ recMaxS: REC_MAX_S, sample: recFilename('main', 'overview') }));
