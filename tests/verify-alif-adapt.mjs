// Focused regression: ALIF plugin must adapt (SFA), not fire reset-free.
// Claim 1: refractory must not wipe the spike before zPrev consumes it.
// Claim 2: vertical coach must normalize by /0.85 with 0.85 clamp (engine-1 parity).
import assert from 'node:assert/strict';
import { ALIFSurrogatePlugin as P } from '../src/vision/alif-surrogate-plugin.js';

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- integrate: single neuron, constant input I=6.1 ----
const mkNode = () => ({
  id: 0, v: 0, adapt: 0, threshold: 0.6, refractory: 0, spiking: false,
  spikes: 0, input: 6.1, current: 0, outgoing: [], firingRate: 0, surrogateGrad: 0,
});
const nodes = new Map([[0, mkNode()]]);
const state = { lastSpikes: [] };

// step 1: nvRaw = 0.1*6.1 = 0.61 >= th 0.6 -> spike, immediate reset+adapt bump
P.integrateNeurons(nodes, [], state, {}, {});
let n = nodes.get(0);
assert.equal(n.spiking, true, 'step1 must spike');
assert.ok(approx(n.v, 0.61 - 0.6), `immediate reset v==0.01, got ${n.v}`);
assert.ok(approx(n.adapt, 0.08), `immediate adapt bump 0.08, got ${n.adapt}`);
assert.equal(n.refractory, 1);

// step 2 (refractory): v held at post-reset value, adapt decays
P.integrateNeurons(nodes, [], state, {}, {});
n = nodes.get(0);
assert.equal(n.spiking, false);
assert.ok(approx(n.v, 0.01), `refractory holds v==0.01, got ${n.v}`);
assert.ok(approx(n.adapt, 0.08 * 0.95), `adapt decays thru refractory, got ${n.adapt}`);

// step 3: th = 0.6+0.5*0.076 = 0.638 elevated; nvRaw = 0.9*0.01+0.61 = 0.619 < th -> quiet (SFA)
P.integrateNeurons(nodes, [], state, {}, {});
n = nodes.get(0);
assert.ok(approx(n.threshold, 0.638), `threshold elevated 0.638, got ${n.threshold}`);
assert.equal(n.spiking, false, 'step3 must be quiet (spike-frequency adaptation)');
assert.ok(n.adapt > 0, 'adapt stays positive after burst');

// ---- reinforce: vertical coach parity (/0.85, clamp 0.85) ----
const st = {
  gains: { left: 1, right: 1, climb: 1, dive: 1 },
  eligibility: { left: 1, right: 1, climb: 1, dive: 1 },
  collisionIndex: 0, rewardEma: 0, explorationRate: 0.04,
  meanSurrogateGrad: 0, rewardUpdates: 0, cumulativeReward: 0, learnRate: 0.1,
};
const cfg = { learningRate: 0.1, eligibilityThreshold: 0.05, minGain: 0.2, maxGain: 3 };
P.reinforce(st, cfg, -0.5, { turn: 0, climb: 0.85 }, { rawTurn: 0, rawClimb: 0 });
// coach.climb = min(0.85, 0.85/0.85) = 0.85; signal = 0.85*(0.38+1)*0.52*1.65
const expected = 1 + 0.1 * (0.85 * (0.38 + 1) * 0.52 * 1.65);
assert.ok(approx(st.gains.climb, expected, 1e-9), `climb gain ${st.gains.climb} != ${expected} (/0.85 parity)`);

console.log(JSON.stringify({ alifAdapt: 'PASS', sfa: true, coachParity: true }));
