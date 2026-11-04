#!/usr/bin/env node
// NSP 3D managed-store check (ESM, zero hardcoded paths).
// The OPFS/IndexedDB calls need a browser, so node covers what it can: the
// module must import without touching browser globals, and the pure path/id
// helpers must stay stable (the report page and both recorders rely on them).
// Run: node tests/verify-store.mjs
import assert from 'node:assert/strict';
import { opfsPathFor, artifactId } from '../src/store/nsp-store.js';

assert.equal(opfsPathFor('webm', 'nsp3d_main_overview_20261031_153022.webm'),
  'recordings/nsp3d_main_overview_20261031_153022.webm');
assert.equal(opfsPathFor('json', 'results_x.json'), 'artifacts/results_x.json');
assert.equal(opfsPathFor('csv', 'results_x.csv'), 'artifacts/results_x.csv');
assert.equal(opfsPathFor('jsonl', 'flight_log_x.jsonl'), 'artifacts/flight_log_x.jsonl');
assert.equal(artifactId('webm', 'a.webm'), 'webm:a.webm');
assert.equal(artifactId('json', 'b.json'), 'json:b.json');

console.log(JSON.stringify({ store: 'import-ok', pureHelpers: 'ok' }));
