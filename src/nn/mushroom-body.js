// NSP 3D — mushroom-body.js
// MB-like familiarity map (fly mushroom-body analogy: Kenyon-cell sparse code +
// dopamine gate; here a visit-count grid with a FIXED novelty readout — no
// weight learning this round. Collision/goal dopamine hooks already ride the
// flight log for a future STDP round).
// One map per agent episode; reset per run. Dependency-free (node-testable).
export const MB_BUILD = '2026-10-29.mb1';

export function createVisitMap({ halfSize = .5, cell = .02 } = {}) {
  const n = Math.max(4, Math.round((halfSize * 2) / cell));
  return { halfSize, cell, n, counts: new Float32Array(n * n), visits: 0 };
}
function cellIndex(map, x, z) {
  const ix = Math.floor((x + map.halfSize) / map.cell);
  const iz = Math.floor((z + map.halfSize) / map.cell);
  if (ix < 0 || iz < 0 || ix >= map.n || iz >= map.n) return -1;
  return iz * map.n + ix;
}
export function visitCell(map, x, z) {
  const k = cellIndex(map, x, z);
  if (k < 0) return;
  map.counts[k] += 1;
  map.visits += 1;
}
function noveltyAt(map, x, z) {
  const k = cellIndex(map, x, z);
  if (k < 0) return 0; // outside the chamber reads familiar (never attractive)
  return 1 / (1 + map.counts[k]);
}
// Differential novelty ahead-left / ahead-right. Yaw convention matches
// sim-core forward (sin(yaw), -cos(yaw)) with turn>0 yawing right, so the
// left probe is yaw-spread and the right probe yaw+spread.
export function noveltyLR(map, x, z, yaw, { dist = .06, spread = .6 } = {}) {
  const probe = (a) => noveltyAt(map, x + Math.sin(a) * dist, z - Math.cos(a) * dist);
  return { l: probe(yaw - spread), r: probe(yaw + spread) };
}
