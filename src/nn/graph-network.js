/*
 * Standalone LIF flight controller for Neural Simulation Playground.
 * Connectome topology and edge weights come from Male CNS v1.0.
 * ESM port of reference/graph-network.js —math must stay identical to the user source.
 *
 * ARCHITECTURAL SEPARATION:
 * - [MODULE A] MONOCULAR NEURAL PATHWAY (`createMonocularConnectome`)
 * - [MODULE B] BINOCULAR COMPOUND-EYE NEURAL PATHWAY (`createBinocularConnectome`)
 * - [PLUGIN HOOK] Optional `globalThis.ALIFSurrogatePlugin` (removable standalone file `alif-surrogate-plugin.js`)
 * Each camera mode has its own dedicated neuron membrane state, synaptic eligibility,
 * sensory-to-neuron projection mapping, and independent 4-way learned readout weights
 * (`gains.monocular` vs `gains.binocular`) so they never interfere and can be split into
 * standalone files at any time.
 */
// Mechanosensory touch reflex (B): contact-side DN-pool drive, zero when untouched.
// Graded-turn touch reflex + DNp06 graded turns (#25) — clean-room.
export const CONFIG = { leak: .88, threshold: 1, rest: 0, synapseScale: 75, learningRate: .012, eligibilityThreshold: .015, minGain: .25, maxGain: 2.5,
  trapDrive: .3, trapRoute: .08, trapTime: 1.2, trapProgress: .2, trapDelta: .05, trapExit: .2, trapCut: .15, trapBoost: .9, trapEscapeT: 2.5, trapLoom: .12,
  saccadeAmp: .10, saccadePeriod: 4, saccadeWidth: .5, saccadeTurn: .05, bilateralGate: .5,
  trapAltProgress: .01 }; // ALT-1: altitude progress (m) that resets vertical-trap timers — a climb/dive gaining height is transit, not trap.
// K29 trial (Baseten consult 2026-10-30, cause 3 — revertible): continuous turn
// readout preserves fine L-R differentials: deadzone .006->.001, V1.6-matched .5 slope.
// false restores the V1.6 quantized path in both mono and bino step().
const SNN_CONTINUOUS_TURN = true;
// K30 trial (revertible): climb-commitment inhibition of lateral pools.
// false restores pure V1.6 lateral drives in both mono and bino step().
const SNN_CLIMB_INHIBIT = false; // reverted 2026-10-30: flight worse (K30)
// K31 trial (revertible): 250ms vertical-passage hold bridges the dive->climb
// gap so lateral suppression survives gate release (ba climb-veer consult).
// false restores V1.6 instant release + .06 passage suppression.
const SNN_VERT_HOLD = false; // reverted 2026-10-30: flight worse (K31)
// Bilateral motor load (NSP 3D normalization; reference compared the RAW sum to
// 1.4, which misfires permanently at production scale: measured sums run 17-32
// over N=144 motor+DN neurons in ALL flight regimes, capping speed at .72 even
// in open space. The mean restores full speed in normal flight (means 0.12-0.22)
// and only caps pathological saturation (>0.5, 2x above the measured peak).
export const bilateralLoad = (sum, count) => sum / Math.max(1, count);
const VERTICAL_VISUAL_TYPES = new Set(['VS', 'VSm', 'VST1', 'VST2', 'OCG01a', 'OCG01b', 'OCG01c', 'OCG01d', 'OCG01e', 'OCG01f', 'OCG06', 'MeVP9', 'MeVP8', 'MeVP17', 'MeVP18', 'MeVP23', 'MeVP24', 'MeVP26', 'MeVP28', 'MeVP51', 'MeVP53', 'MeVP56', 'MeVP57', 'MeVP59', 'LT51', 'LT52', 'vCal1', 'vCal2', 'HST']);
const alifPlugin = () => globalThis.ALIFSurrogatePlugin;

export const SNN_BUILD = '2026-10-29.17+k23k24-grayflip';
import { computeValleySteer } from '../vision/camera-vision.js';

export const mergeFlightGraphs = (base, extension) => {
  if (!base || !Array.isArray(base.nodes) || !Array.isArray(base.edges)) throw new Error('Base flight graph is missing nodes or edges.');
  const nodes = new Map(base.nodes.map(n => [Number(n.id), { ...n }])), pairs = new Map();
  for (const n of extension?.nodes || []) { const id = Number(n.id); nodes.set(id, { ...(nodes.get(id) || {}), ...n }); }
  for (const e of base.edges) { const source = Number(e.source), target = Number(e.target), key = `${source}:${target}`, row = pairs.get(key) || { source, target, weight: 0 }; row.weight += Number(e.weight) || 0; pairs.set(key, row); }
  for (const e of extension?.edges || []) { const source = Number(e.source), target = Number(e.target), key = `${source}:${target}`; pairs.set(key, { source, target, weight: Number(e.weight) || 0, source_dataset: 'MaleCNS neuPrint targeted query' }); }
  return { schema_version: '1.3', dataset: base.dataset || extension?.dataset, license: base.license || extension?.license, description: 'Broad targeted MaleCNS visual-to-descending-to-VNC candidate graph. Anatomical edge weights do not establish synaptic sign or behavior.', nodes: [...nodes.values()], edges: [...pairs.values()], base_node_count: base.nodes.length, base_edge_rows: base.edges.length, extension_node_count: extension?.nodes?.length || 0, extension_edge_count: extension?.edges?.length || 0 };
};

// Shared anatomical graph instantiation helper: creates an isolated copy of the 1,854 neurons & 3,305 edges
export function instantiateAnatomicalCore(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Flight connectome graph is missing nodes or edges.');
  const nodes = new Map(), synapses = [], visualL = [], visualR = [], dnL = [], dnR = [], motorL = [], motorR = [], upperVisual = [], lowerVisual = [], verticalCandidates = [];
  const loomingVisualL = [], loomingVisualR = [], targetVisualL = [], targetVisualR = [], opticFlowVisualL = [], opticFlowVisualR = [];
  let vIdx = 0;
  for (const raw of graph.nodes) {
    const side = raw.side || (raw.name?.endsWith('_L') ? 'L' : raw.name?.endsWith('_R') ? 'R' : null);
    const threshold = 0.85 + ((Number(raw.id) * 2654435761 >>> 0) % 1000) / 2000;
    const n = { ...raw, side, threshold, baseThreshold: threshold, adapt: 0, surrogateGrad: 0, v: 0, refractory: 0, spiking: false, spikes: 0, firingRate: 0, input: 0, current: 0, outgoing: [] };
    nodes.set(Number(n.id), n);
    if (['visual_projection', 'visual_centrifugal'].includes(n.superclass)) {
      (side === 'L' ? visualL : visualR).push(n);
      const tp = String(n.type || '');
      if (tp.startsWith('LPLC') || tp === 'LC4' || tp.startsWith('LLPC')) (side === 'L' ? loomingVisualL : loomingVisualR).push(n);
      else if (tp.startsWith('LC10')) (side === 'L' ? targetVisualL : targetVisualR).push(n);
      else (side === 'L' ? opticFlowVisualL : opticFlowVisualR).push(n);
      if (VERTICAL_VISUAL_TYPES.has(n.type) || vIdx % 3 === 0) {
        (vIdx % 2 ? upperVisual : lowerVisual).push(n);
      }
      vIdx++;
    }
    if (n.superclass === 'descending_neuron' || ['DNp03', 'DNa15', 'DNb01'].includes(n.type)) (side === 'L' ? dnL : dnR).push(n);
    if (n.superclass === 'vnc_motor') (side === 'L' ? motorL : motorR).push(n);
    if (['DNa04', 'DNa05', 'DNa10', 'DNp03', 'DNp06', 'DNb01', 'DNp20', 'DNp22'].includes(n.type)) verticalCandidates.push(n);
  }
  const visualAll = [...visualL, ...visualR];
  const lateralVisualL = visualL.filter(n => !upperVisual.includes(n) && !lowerVisual.includes(n));
  const lateralVisualR = visualR.filter(n => !upperVisual.includes(n) && !lowerVisual.includes(n));
  const lateralFlowOnlyL = lateralVisualL.filter(n => !loomingVisualL.includes(n) && !targetVisualL.includes(n));
  const lateralFlowOnlyR = lateralVisualR.filter(n => !loomingVisualR.includes(n) && !targetVisualR.includes(n));
  const lateralLoomOnlyL = lateralVisualL.filter(n => loomingVisualL.includes(n));
  const lateralLoomOnlyR = lateralVisualR.filter(n => loomingVisualR.includes(n));
  const lateralTargetOnlyL = lateralVisualL.filter(n => targetVisualL.includes(n));
  const lateralTargetOnlyR = lateralVisualR.filter(n => targetVisualR.includes(n));

  for (const edge of graph.edges) {
    const source = nodes.get(Number(edge.source)), target = nodes.get(Number(edge.target));
    if (!source || !target) continue;
    const w = Number(edge.weight) || 1;
    const nt = source.neurotransmitter || source.consensus_neurotransmitter || source.predicted_neurotransmitter;
    const isInhibitory = source.type === 'DNb01' || source.name?.startsWith('DNb01') || nt === 'gaba';
    const sign = isInhibitory ? -1 : 1;
    const scale = target.superclass === 'descending_neuron' ? CONFIG.synapseScale * 6 : CONFIG.synapseScale;
    const syn = { source: source.id, target: target.id, base: w / scale * sign, weight: w / scale * sign, eligibility: 0 };
    source.outgoing.push(syn); synapses.push(syn);
  }
  return {
    nodes, synapses, visualAll, visualL, visualR, dnL, dnR, motorL, motorR,
    upperVisual, lowerVisual, verticalCandidates,
    lateralVisualL, lateralVisualR,
    lateralFlowOnlyL, lateralFlowOnlyR,
    lateralLoomOnlyL, lateralLoomOnlyR,
    lateralTargetOnlyL, lateralTargetOnlyR
  };
}

// Shared 3-factor eligibility trace & collision-evasion reinforcement rule
// Delegates to `globalThis.ALIFSurrogatePlugin.reinforce` when the optional ALIF + Surrogate-Gradient plugin is enabled
function applyReinforcement(state, reward, teacher, student) {
  if (state.neuronRule === 'alif_surrogate' && alifPlugin()?.reinforce) {
    return alifPlugin().reinforce(state, CONFIG, reward, teacher, student);
  }
  const r = Math.max(-2.5, Math.min(1.5, Number(reward) || 0));
  const coach = { left: 0, right: 0, climb: 0, dive: 0 };
  const isCollisionPenalty = r < -.35;
  if (teacher && student) {
    const tTurn = Number(teacher.turn) || 0, sTurn = Number(student.rawTurn ?? student.turn) || 0;
    const tClimb = Number(teacher.climb) || 0, sClimb = Number(student.rawClimb ?? student.climb) || 0;
    if (tTurn > .004) coach.left = Math.max(-.25, Math.min(.85, (tTurn - sTurn) / .16 + (isCollisionPenalty ? .28 : 0)));
    if (tTurn < -.004) coach.right = Math.max(-.25, Math.min(.85, (-tTurn + sTurn) / .16 + (isCollisionPenalty ? .28 : 0)));
    if (tClimb > .05) coach.climb = Math.max(-.25, Math.min(.85, (tClimb - sClimb) / 0.85));
    if (tClimb < -.05) coach.dive = Math.max(-.25, Math.min(.85, (-tClimb + sClimb) / 0.85));
  }
  // Still track basic collision/reward EMA even in standard LIF mode for UI comparison
  state.collisionIndex = Math.max(0, Math.min(1, (state.collisionIndex || 0) * .90 + (isCollisionPenalty ? .35 : 0)));
  state.rewardEma = Math.max(-1, Math.min(1, (state.rewardEma || 0) * .92 + r * .08));
  state.explorationRate = 0;
  if (Math.abs(r) < 1e-5 && !teacher) return { updated: 0, reward: r };
  let updated = 0;
  for (const key of Object.keys(state.gains)) {
    const elig = state.eligibility[key];
    const penaltyBoost = isCollisionPenalty ? 1.65 : 1.0;
    const signal = teacher ? (r < -.1 ? coach[key] * (.38 + elig) * .52 * penaltyBoost : (r > .5 ? r * elig * .25 : (1 - state.gains[key]) * 0.05)) : (r * elig);
    if (elig < CONFIG.eligibilityThreshold && Math.abs(coach[key]) < .02) continue;
    // Teacher coaching anchors gains at/above unity but must not destroy pretrained
    // gains above it: the ceiling follows CONFIG.maxGain like the free range.
    const floorGain = teacher ? 1.0 : CONFIG.minGain;
    const ceilGain = CONFIG.maxGain;
    const next = Math.max(floorGain, Math.min(ceilGain, state.gains[key] + state.learnRate * signal));
    if (Math.abs(next - state.gains[key]) > 1e-8) { state.gains[key] = next; updated++; }
    state.eligibility[key] *= .65;
  }
  state.rewardUpdates++; state.cumulativeReward += r;
  return { updated, reward: r };
}

// Shared vertical-trap habituation (NSP 3D addition, not in reference math):
// a gate dive/climb that persists past trapTime while the visual world is
// FROZEN is a surface misread, not a passage —habituate the drive and latch
// the opponent escape so the agent leaves the floor/ceiling. Stillness is the
// signal: any real motion changes some channel (floor-threat drift in either
// direction as sectors swing past the floor, center rising on approach or
// dropping at transit), so the timer can only trip when the agent is physically
// pinned. Threat LEVELS are never used (the floor is always in view, the
// ceiling channel saturates). Camera-gated only (grid + threat trends + dt);
// uses no altitude logic.
function applyVerticalTrap(state, sig) {
  let { climbSignal, diveSignal } = sig;
  const diving = diveSignal > CONFIG.trapDrive && diveSignal >= climbSignal;
  const climbing = climbSignal > CONFIG.trapDrive && climbSignal > diveSignal;
  // Only gate-driven vertical persists here: goal tracking (landing on the
  // floor beacon, climbing to an elevated one) is exempt by sig.gated.
  if (state.diveEscT >= 0) {
    state.diveEscT += sig.dt;
    // The latch holds through gate closure (the escape pitch itself swings the
    // sectors) and yields only to an active landing or the timeout.
    const landing = sig.goalVis > .05 && sig.goalVert < -.2;
    if (landing || state.diveEscT > CONFIG.trapEscapeT) { state.diveEscT = -1; state.diveTrapT = 0; }
    else { diveSignal *= CONFIG.trapCut; climbSignal = Math.max(climbSignal, CONFIG.trapBoost); }
  }
  if (state.diveEscT < 0) {
    if (diving && sig.gated) { // (b) freeze-only arming: route preconditions removed — invisible floor/ceiling can never satisfy them. Legit passage resets via progress/loom below.
      if (state.diveTrapT <= 0) { state.diveTrapRef = sig.center; state.diveTrapRefDn = sig.downT; state.diveTrapRefAlt = sig.alt; }
      state.diveTrapT += sig.dt;
      if (Math.abs(sig.downT - state.diveTrapRefDn) > CONFIG.trapDelta) state.diveTrapT = 0;
      else if (Math.abs(sig.center - state.diveTrapRef) > CONFIG.trapProgress) state.diveTrapT = 0;
      else if (sig.loomC > CONFIG.trapLoom) state.diveTrapT = 0; // frontal expansion: still approaching, not trapped
      else if (Number.isFinite(sig.alt) && Number.isFinite(state.diveTrapRefAlt) && Math.abs(sig.alt - state.diveTrapRefAlt) > CONFIG.trapAltProgress) state.diveTrapT = 0; // ALT-1
      if (state.diveTrapT > CONFIG.trapTime) {
        state.diveEscT = 0;
        diveSignal *= CONFIG.trapCut; climbSignal = Math.max(climbSignal, CONFIG.trapBoost);
      }
    } else state.diveTrapT = Math.max(0, state.diveTrapT - sig.dt * 2);
  }
  // Sticky escape: once the timer trips, the opponent maneuver latches for up
  // to trapEscapeT so membrane activity has time to cross over even when the
  // threat stream jitters. Released early only if the drive itself vanishes.
  if (state.climbEscT >= 0) {
    state.climbEscT += sig.dt;
    const risingToGoal = sig.goalVis > .05 && sig.goalVert > .2;
    if (risingToGoal || state.climbEscT > CONFIG.trapEscapeT) { state.climbEscT = -1; state.climbTrapT = 0; }
    // W1(a): hard-stop the stuck climb but never force-dive — a chin-caught climb must
    // stop pushing up, not exile to the floor. Hard zero (not trapCut): the spike readout
    // saturates, so a soft cut is invisible at the output (measured 1.0). Lateral
    // avoidance handles retreat; ceiling-pin is throttled upstream (mixed
    // upperOpen grades the climb down as the gray ceiling nears).
    else { climbSignal = 0; }
  }
  if (state.climbEscT < 0) {
    if (climbing && sig.gated) { // (b) freeze-only arming: symmetric with dive — invisible ceiling can never satisfy the route precondition.
      if (state.climbTrapT <= 0) { state.climbTrapRef = sig.center; state.climbTrapRefDn = sig.downT; state.climbTrapRefUp = sig.upT; state.climbTrapRefAlt = sig.alt; }
      state.climbTrapT += sig.dt;
      if (Math.abs(sig.downT - state.climbTrapRefDn) > CONFIG.trapDelta) state.climbTrapT = 0;
      else if (sig.upT < state.climbTrapRefUp - CONFIG.trapExit) state.climbTrapT = 0;
      else if (Math.abs(sig.center - state.climbTrapRef) > CONFIG.trapProgress) state.climbTrapT = 0;
      else if (sig.loomC > CONFIG.trapLoom) state.climbTrapT = 0; // frontal expansion: still approaching, not trapped
      else if (Number.isFinite(sig.alt) && Number.isFinite(state.climbTrapRefAlt) && Math.abs(sig.alt - state.climbTrapRefAlt) > CONFIG.trapAltProgress) state.climbTrapT = 0; // ALT-1
      if (state.climbTrapT > CONFIG.trapTime) {
        state.climbEscT = 0;
        climbSignal = 0;
      }
    } else state.climbTrapT = Math.max(0, state.climbTrapT - sig.dt * 2);
  }
  return { climbSignal, diveSignal };
}

// Shared casting-saccade search (NSP 3D addition; the reference state carries an
// unused saccadePhase, this puts it to its evident purpose): when the goal is
// lost and avoidance is idle, emit brief deterministic turn pulses that
// alternate left/right each period, so the agent casts across the maze instead of
// wall-following in loops. The gate is avoidance-idle (|rawTurn| small) because
// threat levels run hot in-maze and cannot gate anything; it also aborts pulses
// the moment avoidance wakes (turn-based by design, independent of the curve),
// which bounds corridor weave to millimeters. Goal lock and gate transit also
// veto. The schedule is an endogenous motor pattern like insect casting.
// Learning is unaffected: reinforce() compares rawTurn, which excludes the pulse.
function saccadePulse(state, sig) {
  const searching = sig.goalVis < .05 && !sig.verticalPassage && !sig.valleyTransit && Math.abs(sig.rawTurn) < CONFIG.saccadeTurn;
  if (!searching) return 0;
  const cyc = state.saccadePhase % CONFIG.saccadePeriod;
  if (cyc >= CONFIG.saccadeWidth) return 0;
  return (Math.floor(state.saccadePhase / CONFIG.saccadePeriod) % 2 === 0 ? 1 : -1) * CONFIG.saccadeAmp;
}

// ============================================================================
// [MODULE A] MONOCULAR NEURAL PATHWAY & WEIGHTS
// Standalone monocular connectome controller —can be split to `graph-network-mono.js`
// ============================================================================
export const createMonocularConnectome = graph => {
  const core = instantiateAnatomicalCore(graph);
  const { nodes, synapses, visualAll, visualL, visualR, dnL, dnR, motorL, motorR, upperVisual, lowerVisual, verticalCandidates, lateralVisualL, lateralVisualR } = core;
  const state = {
    mode: 'monocular', neuronRule: 'lif_baseline',
    lastSpikes: [], leftMotor: 0, rightMotor: 0, leftDn: 0, rightDn: 0,
    learnRate: CONFIG.learningRate, rewardUpdates: 0, cumulativeReward: 0,
    collisionIndex: 0, rewardEma: 0, explorationRate: 0, saccadePhase: 0, vpHold: 0, meanSurrogateGrad: 0,
    targetTrace: { vis: 0, x: 0, y: 0, bearing: 0, elev: 0 }, stallSteps: 0,
    diveTrapT: 0, diveTrapRef: 0, diveTrapRefDn: 0, climbTrapT: 0, climbTrapRef: 0, climbTrapRefDn: 0, climbTrapRefUp: 0,
    diveEscT: -1, climbEscT: -1, openTopHold: false, openTopHoldT: 0, satN: 0, openBottomHold: false, lowerBase: null,
    gains: { left: 1, right: 1, climb: 1, dive: 1 },
    eligibility: { left: 0, right: 0, climb: 0, dive: 0 }
  };

  function step(input = {}) {
    for (const n of nodes.values()) { n.input = 0; n.current = 0; }
    if (input.neuronRule) state.neuronRule = input.neuronRule;
    const frontalThreat = Math.max(0, Number(input.frontThreat) || 0), escapeDirection = Number(input.escapeDirection) || 0;
    const grid = Array.isArray(input.grid) && input.grid.length === 9 ? input.grid.map(v => Math.max(0, Math.min(1, Number(v) || 0))) : null;
    // Geometric gates run on RAW wall occupancy (gridWall): fixed thresholds are
    // calibrated in raw space, and floor gray must not vote in wall gates.
    // Falls back to grid for legacy direct-step inputs (already raw).
    const gridW = Array.isArray(input.gridWall) && input.gridWall.length === 9 ? input.gridWall.map(v => Math.max(0, Math.min(1, Number(v) || 0))) : grid;
    const center = gridW ? gridW[4] : 0, upperRoute = gridW ? gridW[1] : 0, lowerRoute = gridW ? gridW[7] : 0;
    const sideBlocked = gridW ? (Math.min(Math.max(gridW[3], gridW[6]), Math.max(gridW[5], gridW[8])) > .3 || Math.min(gridW[3], gridW[5]) > .17) : true; // K16-A: climb only when lateral is blocked (rule parity)
    const lowerMixed = grid ? grid[7] : 0; // floor baseline stays on the mixed grid
    // Graded altitude signals stay floor-aware: gates vote on wall geometry
    // (gridW), but push magnitude, opener-side checks, goal-side blocking and
    // occlusion memory read the mixed grid exactly as before the wall split.
    const upperMixed = grid ? grid[1] : 0, centerMixed = grid ? grid[4] : 0;
    const sens = Number(input.sensitivity) > 0 ? Number(input.sensitivity) : 1; // Weber gate scaling (rule parity; missing = 1, V1.6)
    const frontalRaw = Math.max(0, Number(input.frontRaw ?? input.frontThreat) || 0);
    const leftRawT = Math.max(0, Number(input.leftRaw ?? input.leftThreat) || 0);
    const rightRawT = Math.max(0, Number(input.rightRaw ?? input.rightThreat) || 0);
    // Gate hysteresis: an open gate holds through the lip band (upper .32-.45,
    // lower .28-.40) so transit survives the approach; it releases on a solid
    // wall or in clear space (nothing left to transit).
    // Top-gate differential: wall ahead + floor-below vs wall-above. It bypasses
    // the .32 headroom bar: the wall-top lip reads hot in the upper cells on
    // approach, but up is still freer than down. Headroom grades through climb
    // magnitude (mixed upperOpen), not a boolean cliff, so the ceiling slows
    // the climb instead of slamming the gate at 7cm.
    const valley = computeValleySteer(input.cellsWall, (Number(input.goalVisible) || 0) > .025 ? Math.max(-1, Math.min(1, Number(input.goalLockX) || 0)) : 0);
    const altIn = Number(input.altitude);
    const headroomOk = !Number.isFinite(altIn) || altIn < .16;
    const legroomOk = !Number.isFinite(altIn) || altIn > .03;
    const topEvRaw = !valley.found && headroomOk && sideBlocked && center > .35 && (upperRoute < .35 || (lowerRoute > .85 && upperRoute < .45 && lowerRoute > center + .25)); // K19R: VERIFIED open above (rule parity)
    const topOpenRaw = !valley.found && sideBlocked && (topEvRaw || (center > .35 && upperRoute < center * .52 && upperRoute <= lowerRoute + .03 && !(altIn > .115 && upperRoute >= .45)));
    // Bottom-gate (dive): panel/wall ABOVE (upper hot) + lower view at the FLOOR
    // BASELINE (nothing but floor below). Fixed lower thresholds die on the floor
    // pedestal (floor-bright always reads hot); the running baseline adapts to
    // altitude (instant down, slow up) so wall bases still veto the dive.
    if (state.lowerBase === null || state.lowerBase === undefined) state.lowerBase = Math.min(lowerMixed, .75); // floor prior: a wall-facing spawn must not poison the baseline hot
    else if (lowerMixed < state.lowerBase) state.lowerBase = lowerMixed;
    else state.lowerBase = Math.min(.8, state.lowerBase + (lowerMixed - state.lowerBase) * .02); // cap .8: wall bases must not drag the baseline up
    const botOpenRaw = !valley.found && legroomOk && upperMixed > .45 * sens && lowerMixed < state.lowerBase + .12 && lowerRoute < .35 && !(center >= .92 && upperRoute < .88 && (lowerRoute > .05 || !(altIn > .115))); // K19R: VERIFIED open below (rule parity)
    // K22: the hold bridges the lip-hot band (~0.5s), not gap flight. Sustain
    // needs the wall face below (mid-transit) and expires 1.0s after raw was
    // last seen — back-to-back walls re-latch on fresh evidence instead.
    const holdDt = Math.max(1e-3, Math.min(.25, Number(input.dt) || 1 / 60));
    if (topOpenRaw && sideBlocked && headroomOk) { state.openTopHold = true; state.openTopHoldT = 0; }
    else if (state.openTopHold) {
      state.openTopHoldT += holdDt;
      if (!((center > .18 || lowerRoute > .55) && lowerRoute > .15 && upperRoute < .65 && state.openTopHoldT < 1.0)) state.openTopHold = false;
    }
    const openTopGate = grid && headroomOk && sideBlocked && (topOpenRaw || state.openTopHold);


    const openBottomGate = grid && (state.openBottomHold
      ? (legroomOk && lowerMixed < state.lowerBase + .20 && Math.max(centerMixed, upperMixed) > .08)
      : (botOpenRaw && lowerRoute < state.lowerBase + .12));
    state.openTopHold = !!openTopGate; state.openBottomHold = !!openBottomGate;
    const verticalPassage = openTopGate || openBottomGate;
    if (state.vpHold === undefined) state.vpHold = 0;
    if (verticalPassage) state.vpHold = 15; else if (state.vpHold > 0) state.vpHold--;
    const vpHoldActive = SNN_VERT_HOLD && state.vpHold > 0;

    const rawGoalVis = Number(input.goalVisible) || 0;
    if (rawGoalVis > .03) {
      state.targetTrace = { vis: rawGoalVis, x: Number(input.goalLockX) || 0, y: Number(input.goalLockY) || 0, bearing: Number(input.goalBearing) || 0, elev: Number(input.goalVertical) || 0 };
    } else if (state.targetTrace.vis > .06 && centerMixed < .45) {
      state.targetTrace = { ...state.targetTrace, vis: state.targetTrace.vis * .76 };
    } else {
      state.targetTrace = { vis: 0, x: 0, y: 0, bearing: 0, elev: 0 };
    }
    const goalVis = rawGoalVis > .03 ? rawGoalVis : state.targetTrace.vis;
    const goalLockX = rawGoalVis > .03 ? (Number(input.goalLockX) || 0) : state.targetTrace.x;
    const goalLockY = rawGoalVis > .03 ? (Number(input.goalLockY) || 0) : state.targetTrace.y;
    const goalVertical = rawGoalVis > .03 ? input.goalVertical : state.targetTrace.elev;

    const baseLateralSuppress = (SNN_VERT_HOLD && (verticalPassage || vpHoldActive)) ? .02 : (verticalPassage ? .06 : 1);
    const goalWallSuppress = goalVis > .05 ? Math.max(.12, 1 - goalVis * .85) : 1;
    // Rule parity (camera-controller wallSuppress): a visible goal selects the goal
    // term alone —the passage term must not multiply on top, or gate+goal transit
    // goes laterally blind (.06 x .12 = .0072).
    const suppressLateral = goalVis > .05 ? goalWallSuppress : baseLateralSuppress;

    // Vertical-trap inputs (camera-derived; dt defaults to 60fps when the caller omits it).
    const dt = Math.max(1e-3, Math.min(.25, Number(input.dt) || 1 / 60));
    const upT = Math.max(0, Number(input.upThreat) || 0), downT = Math.max(0, Number(input.downThreat) || 0);
    const altNow = Number(input.altitude);
    const rawStall = !verticalPassage && frontalRaw > .72 && leftRawT > .72 && rightRawT > .72 && goalVis < .05;
    state.stallSteps = rawStall ? state.stallSteps + 1 : 0;
    const bilateralStall = Boolean(input.teacher) && state.stallSteps >= 4;
    const stallL = bilateralStall && escapeDirection < 0 ? .28 : 1;
    const stallR = bilateralStall && escapeDirection > 0 ? .28 : 1;
    const rawLeftThreat = (input.leftThreat || 0) * stallL;
    const rawRightThreat = (input.rightThreat || 0) * stallR;
    // 8-sector wiring: when the decoder supplies sectors, steer from the sector
    // means with bino-parity mutual suppression, so symmetric thirds saturation
    // no longer blinds lateral discrimination. Falls back to thirds exactly.
    const secIn = Array.isArray(input.sectors) && input.sectors.length === 8 ? input.sectors : null;
    const secL = secIn ? (secIn[0] + secIn[1] + secIn[2] + secIn[3]) * .25 * stallL : rawLeftThreat;
    const secR = secIn ? (secIn[4] + secIn[5] + secIn[6] + secIn[7]) * .25 * stallR : rawRightThreat;
    const secMutual = secIn ? Math.min(secL, secR) * .42 : 0;
    const dirLeftThreat = Math.max(0, secL - secMutual), dirRightThreat = Math.max(0, secR - secMutual);
    // Freest-corner diagonal escape (2b, rule parity): normalized open-corner
    // vector, gated on confined (suppressed frontal blockage) like the rule.
    // Open-right pulls like left blockage (both turn right); symmetric cancels.
    const cUL = gridW ? 1 - gridW[0] : 0, cUR = gridW ? 1 - gridW[2] : 0, cLL = gridW ? 1 - gridW[6] : 0, cLR = gridW ? 1 - gridW[8] : 0;
    const cOSum = cUL + cUR + cLL + cLR;
    const confinedSNN = frontalRaw * suppressLateral > .5;
    const cTurn = confinedSNN && cOSum > .01 ? (cUR + cLR - cUL - cLL) / cOSum * .5 : 0;
    const rawCClimb = confinedSNN && cOSum > .01 ? (cUL + cUR - cLL - cLR) / cOSum * .5 : 0;
    const cClimb = rawCClimb > 0 && Number.isFinite(altIn) && altIn > .135 ? 0 : rawCClimb;
    // Default escape side (rule parity): the rule veers with (escapeDirection||1)
    // when confined, but a symmetric approach holds decoder lastEscape=0, which
    // zeroed BOTH frontal drives and flew dead-ends head-on. Default +1 confined.
    // Boxed (dead-end, suppression gate): all raw frontal channels saturated.
    // The forced side fires whenever confined (deadlock breaker); suppression
    // additionally fires only when boxed (collapse needs both sides capped).
    const boxedSNN = Math.min(frontalRaw, leftRawT, rightRawT) > .55; // K20-B: LIF pools hit the refractory ceiling from ~.55 — .8 left a .65-.8 dead zone with no veer
    // (valley reuses the pre-gate computation above; transit gates escape.)
    const valleyTransit = valley.found && !verticalPassage && frontalThreat > .08;
    const valleyYaw = valleyTransit ? valley.centerErr * .5 : 0;
    const latDamp = valleyTransit ? Math.max(.15, Math.min(1, frontalThreat * 2.5)) : 1; // K15: hold the gap line (rule parity)
    // K24: stall-flip (rule satN mirror) — odometry-fed via input.stalled.
    const stuckSatSNN = (((input.stalled !== false && frontalRaw > .5 && Math.abs(dirLeftThreat - dirRightThreat) < .08) || (frontalRaw > .75 && center > .75 && Math.abs(dirLeftThreat - dirRightThreat) < .05) || input.stalled) && goalVis <= .05 && !verticalPassage);
    if (stuckSatSNN) state.satN += state.satN > 121 ? .25 : 1; else state.satN = 0;
    const flipSide = state.satN > 120 ? (Math.floor(state.satN / 120) % 2 === 0 ? 1 : -1) : 0;
    const effEscape = flipSide !== 0 ? flipSide : (escapeDirection !== 0 ? escapeDirection : (confinedSNN ? 1 : 0));
    const effEscapeEff = valleyTransit ? 0 : effEscape;
    const frontalLeft = !verticalPassage && frontalThreat > .08 && effEscapeEff > 0 ? frontalThreat * suppressLateral : 0;
    const frontalRight = !verticalPassage && frontalThreat > .08 && effEscapeEff < 0 ? frontalThreat * suppressLateral : 0;
    let leftDrive = Math.min(2, Math.max(0, (dirLeftThreat * 1.6 * latDamp + (input.loomingL || 0) * 1.1 + (input.motionL || 0) * .5) * suppressLateral + frontalLeft * 1.6 + Math.max(0, cTurn) * suppressLateral + Math.max(0, valleyYaw) * suppressLateral));
    let rightDrive = Math.min(2, Math.max(0, (dirRightThreat * 1.6 * latDamp + (input.loomingR || 0) * 1.1 + (input.motionR || 0) * .5) * suppressLateral + frontalRight * 1.6 + Math.max(0, -cTurn) * suppressLateral + Math.max(0, -valleyYaw) * suppressLateral));
    // Contralateral suppression (boxed-confined): bilateral saturation maxes BOTH pool
    // rates at the refractory ceiling, collapsing the differential readout to
    // straight even with an escape side. Inhibit the escape-opposite side to
    // restore the veer (bino contraInhibit mirror). Transit/goal self-exempt:
    // their suppression keeps confinedSNN false.
    if (confinedSNN && boxedSNN) {
      if (effEscapeEff > 0) rightDrive *= .45; else if (effEscapeEff < 0) leftDrive *= .45;
    }

    for (const n of lateralVisualL) n.input += leftDrive * .72;
    for (const n of lateralVisualR) n.input += rightDrive * .72;
    for (const n of visualL) n.input += leftDrive * .18;
    for (const n of visualR) n.input += rightDrive * .18;
    // Mechanosensory touch reflex (B): contact normal lateralizes exactly where vision
    // saturates symmetric. DN-pool excitation, goal-unsuppressed; zero when untouched.
    const touchMag = Math.max(0, Math.min(1, Number(input.touch?.mag) || 0));
    if (touchMag > 0) {
      const touchPool = Number(input.touch?.side) >= 0 ? dnL : dnR;
      for (const n of touchPool) n.input += touchMag * 2.2;
    }

    const upperOpen = Math.max(0, 1 - upperMixed), lowerOpen = Math.max(0, 1 - lowerMixed);
    let climbSignal = 0, diveSignal = 0;
    // Frontal looming-rate pre-climb (A): approach expansion adds climb drive in
    // no-gate and open-top flight, but only toward the opener side (upper route
    // clearer than lower by the gate delta); bottom openings and flat walls keep
    // level flight so gate logic (not pre-climb) decides. Goal tracking and
    // landing dives stay exempt.
    const centerLoom = Math.max(0, Number(input.loomingC) || 0);
    const goalElev = (goalVertical !== undefined && Math.abs(Number(goalVertical)) > 1e-4) ? Number(goalVertical) : goalLockY * .75;
    // Goal-wins-on-weak-conflict: a clearly below/above goal overrides the gate
    // branch when the avoidance reason on the goal side is weak; strong blocking
    // keeps avoidance priority (never dive into a wall for a beacon).
    const goalOverridesGate = goalVis > .05 && ((goalElev < -.03 && openTopGate && !openBottomGate && (lowerMixed < .6 || (goalElev < -.25 && altIn > .05))) || (goalElev > .03 && openBottomGate && !openTopGate && upperMixed < .6)); // .6 bar (rule parity)
    if ((goalVis > .05 && !openTopGate && !openBottomGate) || goalOverridesGate) {
      if (goalElev < -.03) diveSignal = Math.min(2, .55 + Math.abs(goalElev) * 2.4);
      else if (goalElev > .03) climbSignal = Math.min(2, .45 + goalElev * 2.4);
    } else if (openTopGate) {
      climbSignal = Math.max(centerMixed, lowerMixed) * upperOpen * 2.6 + .45;
    } else if (openBottomGate) {
      diveSignal = Math.max(centerMixed, upperMixed) * lowerOpen * 2.6 + .45;
    }
    if (centerLoom > 0 && center > .35 && !valley.found && !openBottomGate && (goalVis <= .05 || openTopGate) && upperRoute < .35) climbSignal = Math.min(2, climbSignal + centerLoom * 1.4); // K19R: pre-climb needs verified open above (rule parity)
    // Freest-corner vertical (2b): open-up pulls climb, open-down pulls dive; sensory-side of the trap.
    if (cClimb > 0) climbSignal = Math.min(2, climbSignal + cClimb * (goalVis > .05 ? goalWallSuppress : 1));
    else if (cClimb < 0) diveSignal = Math.min(2, diveSignal - cClimb * (goalVis > .05 ? goalWallSuppress : 1));
    ({ climbSignal, diveSignal } = applyVerticalTrap(state, { climbSignal, diveSignal, center: centerMixed, upperRoute, lowerRoute, upT, downT, dt, loomC: centerLoom, gated: verticalPassage, goalVis, goalVert: Number(goalVertical) || 0, alt: altNow }));
    const upperDrive = Math.min(2, climbSignal);
    const lowerDrive = Math.min(2, diveSignal);
    for (const n of upperVisual) n.input += upperDrive * .95;
    for (const n of lowerVisual) n.input += lowerDrive * .95;

    const bearing = rawGoalVis > .03 ? (Number(input.goalBearing) || 0) : (Number(input.goalBearing) || state.targetTrace.bearing || 0);
    const effectiveBearing = goalVis > .05 ? goalLockX * 1.10 + bearing * .45 : bearing;
    const maxSideThreat = verticalPassage ? 0 : Math.max(input.leftThreat || 0, input.rightThreat || 0, frontalThreat) * goalWallSuppress;
    const goalAttenuation = goalVis > .08 ? 1.25 : Math.max(.35, 1 - maxSideThreat * .60);
    const cue = Math.min(1.35, Math.abs(effectiveBearing) / .55) * goalAttenuation;
    if (effectiveBearing > 0) {
      for (const n of lateralVisualL) n.input += cue * .95;
      for (const n of visualL) n.input += cue * .22;
    } else if (effectiveBearing < 0) {
      for (const n of lateralVisualR) n.input += cue * .95;
      for (const n of visualR) n.input += cue * .22;
    }

    // K30 trial (revertible): climb-commitment inhibition of lateral pools —
    // a committed climb hyperpolarizes lateral visual pools so the turn readout
    // cannot veer off a vertical maneuver (dive->climb gap fix, neural form).
    if (SNN_CLIMB_INHIBIT) {
      const climbCommit = Math.max(0, Math.min(1, (upperDrive - lowerDrive) / 1.2));
      if (climbCommit > .05) {
        for (const n of lateralVisualL) n.input -= climbCommit * 1.2;
        for (const n of lateralVisualR) n.input -= climbCommit * 1.2;
      }
    }
    // Synaptic current is added exactly once: the ALIF plugin sums it inside
    // integrateNeurons, so the baseline loop below runs for LIF only.
    let currentSpikes = [];
    if (state.neuronRule === 'alif_surrogate' && alifPlugin()?.integrateNeurons) {
      currentSpikes = alifPlugin().integrateNeurons(nodes, synapses, state, CONFIG, input);
    } else {
      for (const id of state.lastSpikes) { const source = nodes.get(id); if (source) for (const syn of source.outgoing) { const target = nodes.get(syn.target); if (target) target.current += syn.weight; } }
      for (const n of nodes.values()) {
        if (n.refractory > 0) { n.refractory--; n.spiking = false; }
        else {
          n.v = n.v * CONFIG.leak + n.input + n.current;
          if (n.v >= n.threshold) {
            n.spiking = true; n.v = Math.max(CONFIG.rest, n.v - n.threshold); n.refractory = 1; n.spikes++; currentSpikes.push(Number(n.id));
          } else {
            n.spiking = false; n.v = Math.max(CONFIG.rest, n.v);
          }
        }
        n.firingRate = n.firingRate * .82 + (n.spiking ? .32 : 0);
      }
      state.lastSpikes = currentSpikes;
      for (const syn of synapses) { const source = nodes.get(syn.source), target = nodes.get(syn.target); syn.eligibility *= .965; if (source?.spiking) syn.eligibility = Math.min(2, syn.eligibility + .12 + (target?.firingRate || 0) * .35); }
    }
    state.leftMotor = motorL.reduce((a, n) => a + n.firingRate, 0); state.rightMotor = motorR.reduce((a, n) => a + n.firingRate, 0);
    state.leftDn = dnL.reduce((a, n) => a + n.firingRate, 0); state.rightDn = dnR.reduce((a, n) => a + n.firingRate, 0);
    const leftVisualActivity = lateralVisualL.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralVisualL.length);
    const rightVisualActivity = lateralVisualR.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralVisualR.length);
    const dnDiff = (state.leftDn - state.rightDn) / Math.max(1, dnL.length + dnR.length);
    const motorDiff = (state.leftMotor - state.rightMotor) / Math.max(1, motorL.length + motorR.length);
    const turnIntent = (leftVisualActivity - rightVisualActivity) * .75 + dnDiff * .45 + motorDiff * .25;
    const turnSign = turnIntent > .006 ? 1 : turnIntent < -.006 ? -1 : 0;
    const turnActivity = Math.min(1, Math.abs(turnIntent) * 3.2 + Math.abs(motorDiff) * .35);
    const rawTurnQuant = turnSign * Math.min(.16, turnActivity * state.gains[turnSign > 0 ? 'left' : 'right'] * .16); // V1.6 path (K29 revert)
    const rawTurnCont = Math.abs(turnIntent) < .001 ? 0 : Math.max(-.16, Math.min(.16, turnIntent * .5 * state.gains[turnIntent > 0 ? 'left' : 'right'])); // K29: deadzone .001 (was .006), V1.6-matched .5 slope (Baseten x1.5 was 3x hot)
    const rawTurn = SNN_CONTINUOUS_TURN ? rawTurnCont : rawTurnQuant;
    const tTurn = input.teacher ? Number(input.teacher.turn) || 0 : 0;
    let turn = bilateralStall ? rawTurn + (tTurn - rawTurn) * .55 : rawTurn;
    state.saccadePhase += dt;
    if (!bilateralStall) turn = Math.max(-.16, Math.min(.16, turn + saccadePulse(state, { goalVis, rawTurn, verticalPassage: verticalPassage || vpHoldActive, valleyTransit })));

    const upperActivity = upperVisual.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, upperVisual.length);
    const lowerActivity = lowerVisual.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lowerVisual.length);
    const verticalCue = upperDrive > lowerDrive + .05 ? 1 : lowerDrive > upperDrive + .05 ? -1 : 0;
    const verticalSign = verticalCue === 1 && upperActivity > lowerActivity + .008 ? 1 : verticalCue === -1 && lowerActivity > upperActivity + .008 ? -1 : 0;
    const candidateActivity = verticalCandidates.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, verticalCandidates.length);
    const verticalMotorActivity = (state.leftMotor + state.rightMotor) / Math.max(1, motorL.length + motorR.length);
    const verticalActivity = Math.min(1, Math.abs(upperActivity - lowerActivity) * 2.8 + candidateActivity * .35 + verticalMotorActivity * .08);
    const rawClimb = verticalSign * Math.min(1, verticalActivity * state.gains[verticalSign > 0 ? 'climb' : 'dive']);
    const climbUrgency = openTopGate && verticalSign > 0 ? .35 + .65 * Math.min(1, center / .6) : 1;
    const restoreDive = (!openTopGate && !openBottomGate && goalVis < .05 && ((frontalThreat < .3 && centerLoom <= 0) || altIn > .115) && Number.isFinite(altIn)) ? Math.max(-.6, Math.min(.6, (.08 - altIn) * 10)) : 0; // cruise-altitude hold toward .08 (rule parity; was sink-to-.02)
    const vertDrive = Math.max(upperDrive, lowerDrive);
    const analogUrgency = ((openTopGate && verticalSign > 0) || (openBottomGate && verticalSign < 0)) ? 1 : Math.max(0, Math.min(1, vertDrive / 1.5)); // K20-A: spikes binarize magnitude — non-gate drives (corner/pre-climb/trap/goal) ride their analog level like gate urgency
    let climb = rawClimb * climbUrgency * analogUrgency + restoreDive;
    if (Number.isFinite(altIn) && altIn <= .03 && climb < -.15) climb = -.15; // floor dive softening (rule parity)
    if (climb > 0 && Number.isFinite(altIn)) climb *= Math.max(0, Math.min(1, (.20 - altIn) / .06)); // K17: headroom grades climb magnitude (rule parity)

    if (state.neuronRule === 'alif_surrogate' && alifPlugin()?.updateReadoutEligibility) {
      turn = alifPlugin().updateReadoutEligibility(state, core, turnSign, turnActivity, verticalSign, verticalActivity, turn, input);
    } else {
      state.eligibility.left = Math.min(1, state.eligibility.left * .94 + (turnSign > 0 ? turnActivity : 0) * .08);
      state.eligibility.right = Math.min(1, state.eligibility.right * .94 + (turnSign < 0 ? turnActivity : 0) * .08);
      state.eligibility.climb = Math.min(1, state.eligibility.climb * .94 + (verticalSign > 0 ? verticalActivity : 0) * .08);
      state.eligibility.dive = Math.min(1, state.eligibility.dive * .94 + (verticalSign < 0 ? verticalActivity : 0) * .08);
    }
    const threat = Math.max(leftDrive, rightDrive, upperDrive, lowerDrive, (input.frontThreat || 0) * goalWallSuppress), bilateral = state.leftMotor + state.rightMotor + state.leftDn + state.rightDn;
    const slowForGoal = (goalVis > .15 && (Math.abs(goalLockX) > .18 || Math.abs(Number(goalVertical) || 0) > .15)) || goalVis > .5; // near goal always slows (rule parity: approach-speed overshoot guard)
    const bilateralN = motorL.length + motorR.length + dnL.length + dnR.length;
    const speedMultiplier = slowForGoal ? .58 : valleyTransit ? .6 : (threat > .5 || bilateralLoad(bilateral, bilateralN) > CONFIG.bilateralGate ? .72 : 1.0);
    return { visionMode: 'monocular', neuronRule: state.neuronRule, turn, rawTurn, climb, rawClimb, speedMultiplier, threat, spikes: currentSpikes, spikeCount: currentSpikes.length, leftMotor: state.leftMotor, rightMotor: state.rightMotor, leftDn: state.leftDn, rightDn: state.rightDn, leftDrive, rightDrive, upperDrive, lowerDrive, upperActivity, lowerActivity, verticalActivity, collisionIndex: state.collisionIndex, explorationRate: state.explorationRate, rewardEma: state.rewardEma, telemetry: getActiveNodes() }; // V1.6: K25b/K26a retired
  }

  function getActiveNodes() {
    const active = [...nodes.values()].filter(n => n.firingRate > .01).sort((a, b) => b.firingRate - a.firingRate), selected = new Map();
    for (const group of ['visual_projection', 'visual_centrifugal', 'descending_neuron', 'vnc_motor']) for (const n of active.filter(x => x.superclass === group).slice(0, 3)) selected.set(Number(n.id), n);
    for (const n of active) { if (selected.size >= 12) break; selected.set(Number(n.id), n); }
    return [...selected.values()].sort((a, b) => b.firingRate - a.firingRate).slice(0, 12).map(n => ({ id: n.id, name: n.name, type: n.type, superclass: n.superclass, side: n.side, firingRate: n.firingRate, spiking: n.spiking }));
  }
  function reinforce(reward, teacher = null, student = null) { return applyReinforcement(state, reward, teacher, student); }
  function stats() { return { mode: 'monocular', neuronRule: state.neuronRule, nodes: nodes.size, edgeRows: synapses.length, visual: visualAll.length, descending: dnL.length + dnR.length, motor: motorL.length + motorR.length, verticalCandidates: verticalCandidates.length, spikes: state.lastSpikes.length, rewardUpdates: state.rewardUpdates, cumulativeReward: state.cumulativeReward, collisionIndex: state.collisionIndex || 0, explorationRate: state.explorationRate || 0, rewardEma: state.rewardEma || 0, meanSurrogateGrad: state.meanSurrogateGrad || 0, gains: { ...state.gains }, active: getActiveNodes() }; }
  function reset() { state.lastSpikes = []; state.targetTrace = { vis: 0, x: 0, y: 0, bearing: 0, elev: 0 }; state.stallSteps = 0; state.diveTrapT = 0; state.diveTrapRef = 0; state.diveTrapRefDn = 0; state.climbTrapT = 0; state.climbTrapRef = 0; state.climbTrapRefDn = 0; state.climbTrapRefUp = 0; state.diveEscT = -1; state.climbEscT = -1; state.openTopHold = false; state.openTopHoldT = 0; state.satN = 0; state.openBottomHold = false; state.lowerBase = null; state.collisionIndex = 0; state.saccadePhase = 0; state.vpHold = 0; for (const syn of synapses) syn.eligibility = 0; for (const key of Object.keys(state.eligibility)) state.eligibility[key] = 0; for (const n of nodes.values()) { n.v = 0; n.adapt = 0; n.threshold = n.baseThreshold; n.refractory = 0; n.spiking = false; n.firingRate = 0; n.input = 0; n.current = 0; } }
  function resetLearning() { for (const key of Object.keys(state.gains)) { state.gains[key] = 1; state.eligibility[key] = 0; } state.rewardUpdates = 0; state.cumulativeReward = 0; state.collisionIndex = 0; state.rewardEma = 0; state.explorationRate = 0; }
  function setLearningRate(v) { state.learnRate = Math.max(0, Math.min(.05, Number(v) || 0)); }
  function setNeuronRule(rule) { state.neuronRule = rule === 'alif_surrogate' ? 'alif_surrogate' : 'lif_baseline'; }
  function exportWeights() { return { schema_version: '1.1', mode: 'monocular', neuronRule: state.neuronRule, gains: { ...state.gains }, rewardUpdates: state.rewardUpdates, cumulativeReward: state.cumulativeReward, collisionIndex: state.collisionIndex, explorationRate: state.explorationRate, learnRate: state.learnRate }; }
  function loadWeights(data = {}) {
    const src = data?.monocular || data;
    const g = src.gains || src.learned_gains || src.default_pretrained_gains || src;
    for (const k of ['left', 'right', 'climb', 'dive']) if (Number.isFinite(Number(g[k]))) state.gains[k] = Math.max(CONFIG.minGain, Math.min(CONFIG.maxGain, Number(g[k])));
    if (Number.isFinite(Number(src.rewardUpdates))) state.rewardUpdates = Number(src.rewardUpdates);
    if (Number.isFinite(Number(src.cumulativeReward))) state.cumulativeReward = Number(src.cumulativeReward);
    return { ...state.gains };
  }
  return { mode: 'monocular', step, reinforce, stats, reset, resetLearning, setLearningRate, setNeuronRule, exportWeights, loadWeights, graph };
};

// ============================================================================
// [MODULE B] BINOCULAR COMPOUND-EYE NEURAL PATHWAY & WEIGHTS
// Standalone binocular connectome controller —can be split to `graph-network-bino.js`
// - Dedicated Binocular Overlap & Stereo Disparity Pathway:
//   1) Outer Compound-Eye Peripheral Threat —LPLC2 / LC4 / LLPC looming neurons
//   2) Frontal Binocular Overlap (`leftEyeNasal` vs `rightEyeNasal` stereo disparity
//      & `stereoConvergence = sqrt(L*R)`) —Optic-flow centering & contralateral avoidance
//   3) Continuous Binocular Target Bearing —LC10 target-fixation neurons
// - Eliminates binary left/right bias so straight corridor flight centers (with a
//   small bounded casting weave from saccadePulse when avoidance is idle).
// ============================================================================
export const createBinocularConnectome = graph => {
  const core = instantiateAnatomicalCore(graph);
  const {
    nodes, synapses, visualAll, visualL, visualR, dnL, dnR, motorL, motorR,
    upperVisual, lowerVisual, verticalCandidates,
    lateralVisualL, lateralVisualR,
    lateralFlowOnlyL, lateralFlowOnlyR,
    lateralLoomOnlyL, lateralLoomOnlyR,
    lateralTargetOnlyL, lateralTargetOnlyR
  } = core;
  const state = {
    mode: 'binocular', neuronRule: 'lif_baseline',
    lastSpikes: [], leftMotor: 0, rightMotor: 0, leftDn: 0, rightDn: 0,
    learnRate: CONFIG.learningRate, rewardUpdates: 0, cumulativeReward: 0,
    collisionIndex: 0, rewardEma: 0, explorationRate: 0, saccadePhase: 0, vpHold: 0, meanSurrogateGrad: 0,
    targetTrace: { vis: 0, x: 0, y: 0, bearing: 0, elev: 0 }, stallSteps: 0,
    diveTrapT: 0, diveTrapRef: 0, diveTrapRefDn: 0, climbTrapT: 0, climbTrapRef: 0, climbTrapRefDn: 0, climbTrapRefUp: 0,
    diveEscT: -1, climbEscT: -1, openTopHold: false, openTopHoldT: 0, satN: 0, openBottomHold: false, lowerBase: null,
    gains: { left: 1, right: 1, climb: 1, dive: 1 },
    eligibility: { left: 0, right: 0, climb: 0, dive: 0 }
  };

  function step(input = {}) {
    for (const n of nodes.values()) { n.input = 0; n.current = 0; }
    if (input.neuronRule) state.neuronRule = input.neuronRule;
    const frontalThreat = Math.max(0, Number(input.frontThreat) || 0), escapeDirection = Number(input.escapeDirection) || 0;
    const grid = Array.isArray(input.grid) && input.grid.length === 9 ? input.grid.map(v => Math.max(0, Math.min(1, Number(v) || 0))) : null;
    // Geometric gates run on RAW wall occupancy (gridWall): fixed thresholds are
    // calibrated in raw space, and floor gray must not vote in wall gates.
    // Falls back to grid for legacy direct-step inputs (already raw).
    const gridW = Array.isArray(input.gridWall) && input.gridWall.length === 9 ? input.gridWall.map(v => Math.max(0, Math.min(1, Number(v) || 0))) : grid;
    const center = gridW ? gridW[4] : 0, upperRoute = gridW ? gridW[1] : 0, lowerRoute = gridW ? gridW[7] : 0;
    const sideBlocked = gridW ? (Math.min(Math.max(gridW[3], gridW[6]), Math.max(gridW[5], gridW[8])) > .3 || Math.min(gridW[3], gridW[5]) > .17) : true; // K16-A: climb only when lateral is blocked (rule parity)
    const lowerMixed = grid ? grid[7] : 0; // floor baseline stays on the mixed grid
    // Graded altitude signals stay floor-aware: gates vote on wall geometry
    // (gridW), but push magnitude, opener-side checks, goal-side blocking and
    // occlusion memory read the mixed grid exactly as before the wall split.
    const upperMixed = grid ? grid[1] : 0, centerMixed = grid ? grid[4] : 0;
    const sens = Number(input.sensitivity) > 0 ? Number(input.sensitivity) : 1; // Weber gate scaling (rule parity; missing = 1, V1.6)
    const frontalRaw = Math.max(0, Number(input.frontRaw ?? input.frontThreat) || 0);
    const leftRawT = Math.max(0, Number(input.leftRaw ?? input.leftThreat) || 0);
    const rightRawT = Math.max(0, Number(input.rightRaw ?? input.rightThreat) || 0);
    // Gate hysteresis: an open gate holds through the lip band (upper .32-.45,
    // lower .28-.40) so transit survives the approach; it releases on a solid
    // wall or in clear space (nothing left to transit).
    // Top-gate differential: wall ahead + floor-below vs wall-above. It bypasses
    // the .32 headroom bar: the wall-top lip reads hot in the upper cells on
    // approach, but up is still freer than down. Headroom grades through climb
    // magnitude (mixed upperOpen), not a boolean cliff, so the ceiling slows
    // the climb instead of slamming the gate at 7cm.
    const valley = computeValleySteer(input.cellsWall, (Number(input.goalVisible) || 0) > .025 ? Math.max(-1, Math.min(1, Number(input.goalLockX) || 0)) : 0);
    const altIn = Number(input.altitude);
    const headroomOk = !Number.isFinite(altIn) || altIn < .16;
    const legroomOk = !Number.isFinite(altIn) || altIn > .03;
    const topEvRaw = !valley.found && headroomOk && sideBlocked && center > .35 && (upperRoute < .35 || (lowerRoute > .85 && upperRoute < .45 && lowerRoute > center + .25)); // K19R: VERIFIED open above (rule parity)
    const topOpenRaw = !valley.found && sideBlocked && (topEvRaw || (center > .35 && upperRoute < center * .52 && upperRoute <= lowerRoute + .03 && !(altIn > .115 && upperRoute >= .45)));
    // Bottom-gate (dive): panel/wall ABOVE (upper hot) + lower view at the FLOOR
    // BASELINE (nothing but floor below). Fixed lower thresholds die on the floor
    // pedestal (floor-bright always reads hot); the running baseline adapts to
    // altitude (instant down, slow up) so wall bases still veto the dive.
    if (state.lowerBase === null || state.lowerBase === undefined) state.lowerBase = Math.min(lowerMixed, .75); // floor prior: a wall-facing spawn must not poison the baseline hot
    else if (lowerMixed < state.lowerBase) state.lowerBase = lowerMixed;
    else state.lowerBase = Math.min(.8, state.lowerBase + (lowerMixed - state.lowerBase) * .02); // cap .8: wall bases must not drag the baseline up
    const botOpenRaw = !valley.found && legroomOk && upperMixed > .45 * sens && lowerMixed < state.lowerBase + .12 && lowerRoute < .35 && !(center >= .92 && upperRoute < .88 && (lowerRoute > .05 || !(altIn > .115))); // K19R: VERIFIED open below (rule parity)
    // K22: the hold bridges the lip-hot band (~0.5s), not gap flight. Sustain
    // needs the wall face below (mid-transit) and expires 1.0s after raw was
    // last seen — back-to-back walls re-latch on fresh evidence instead.
    const holdDt = Math.max(1e-3, Math.min(.25, Number(input.dt) || 1 / 60));
    if (topOpenRaw && sideBlocked && headroomOk) { state.openTopHold = true; state.openTopHoldT = 0; }
    else if (state.openTopHold) {
      state.openTopHoldT += holdDt;
      if (!((center > .18 || lowerRoute > .55) && lowerRoute > .15 && upperRoute < .65 && state.openTopHoldT < 1.0)) state.openTopHold = false;
    }
    const openTopGate = grid && headroomOk && sideBlocked && (topOpenRaw || state.openTopHold);


    const openBottomGate = grid && (state.openBottomHold
      ? (legroomOk && lowerMixed < state.lowerBase + .20 && Math.max(centerMixed, upperMixed) > .08)
      : (botOpenRaw && lowerRoute < state.lowerBase + .12));
    state.openTopHold = !!openTopGate; state.openBottomHold = !!openBottomGate;
    const verticalPassage = openTopGate || openBottomGate;
    if (state.vpHold === undefined) state.vpHold = 0;
    if (verticalPassage) state.vpHold = 15; else if (state.vpHold > 0) state.vpHold--;
    const vpHoldActive = SNN_VERT_HOLD && state.vpHold > 0;

    const rawGoalVis = Number(input.goalVisible) || 0;
    if (rawGoalVis > .03) {
      state.targetTrace = { vis: rawGoalVis, x: Number(input.goalLockX) || 0, y: Number(input.goalLockY) || 0, bearing: Number(input.goalBearing) || 0, elev: Number(input.goalVertical) || 0 };
    } else if (state.targetTrace.vis > .06 && centerMixed < .45) {
      state.targetTrace = { ...state.targetTrace, vis: state.targetTrace.vis * .76 };
    } else {
      state.targetTrace = { vis: 0, x: 0, y: 0, bearing: 0, elev: 0 };
    }
    const goalVis = rawGoalVis > .03 ? rawGoalVis : state.targetTrace.vis;
    const goalLockX = rawGoalVis > .03 ? (Number(input.goalLockX) || 0) : state.targetTrace.x;
    const goalLockY = rawGoalVis > .03 ? (Number(input.goalLockY) || 0) : state.targetTrace.y;
    const goalVertical = rawGoalVis > .03 ? input.goalVertical : state.targetTrace.elev;

    const baseLateralSuppress = (SNN_VERT_HOLD && (verticalPassage || vpHoldActive)) ? .02 : (verticalPassage ? .06 : 1);
    const goalWallSuppress = goalVis > .05 ? Math.max(.12, 1 - goalVis * .85) : 1;
    // Rule parity (camera-controller wallSuppress): a visible goal selects the goal
    // term alone —the passage term must not multiply on top, or gate+goal transit
    // goes laterally blind (.06 x .12 = .0072).
    const suppressLateral = goalVis > .05 ? goalWallSuppress : baseLateralSuppress;

    // Vertical-trap inputs (camera-derived; dt defaults to 60fps when the caller omits it).
    const dt = Math.max(1e-3, Math.min(.25, Number(input.dt) || 1 / 60));
    const upT = Math.max(0, Number(input.upThreat) || 0), downT = Math.max(0, Number(input.downThreat) || 0);
    const altNow = Number(input.altitude);
    const rawStall = !verticalPassage && frontalRaw > .68 && leftRawT > .68 && rightRawT > .68 && goalVis < .05;
    state.stallSteps = rawStall ? state.stallSteps + 1 : 0;
    const bilateralStall = Boolean(input.teacher) && state.stallSteps >= 3;
    const leftOuter = Number(input.leftOuterThreat ?? input.leftThreat) || 0;
    const rightOuter = Number(input.rightOuterThreat ?? input.rightThreat) || 0;
    const leftNasal = Number(input.leftInnerThreat ?? input.frontThreat) || 0;
    const rightNasal = Number(input.rightInnerThreat ?? input.frontThreat) || 0;
    const leftNasalR = Number(input.leftInnerRaw ?? input.leftInnerThreat ?? input.frontThreat) || 0;
    const rightNasalR = Number(input.rightInnerRaw ?? input.rightInnerThreat ?? input.frontThreat) || 0;
    const stereoDisparity = Number(input.binocularDisparity) || ((leftNasal - rightNasal) * .85);
    const stereoConv = Number(input.stereoConvergence) || Math.sqrt(leftNasal * rightNasal);
    const stereoConvRaw = Number(input.stereoConvergence) || Math.sqrt(leftNasalR * rightNasalR);

    // 1) Cross-hemispheric opponent inhibition on peripheral ommatidia
    const mutualBase = Math.min(leftOuter, rightOuter) * .42;
    const periLeft = Math.max(0, leftOuter - mutualBase) * (bilateralStall && escapeDirection < 0 ? .25 : 1);
    const periRight = Math.max(0, rightOuter - mutualBase) * (bilateralStall && escapeDirection > 0 ? .25 : 1);

    // 2) Dedicated Binocular Overlap & Stereo Centering Pathway (NO binary +1/-1 bias unless dead-ahead stereo convergence is high):
    // - Continuous nasal disparity (`leftNasal` vs `rightNasal`) steers smoothly away from whichever nasal half-field is closer
    // - When BOTH nasal fields see a dead-ahead wall (`stereoConv > 0.25`) with near-zero disparity, use continuous asymmetry tie-breaker
    const nasalDiffL = Math.max(0, leftNasal - rightNasal * .65);
    const nasalDiffR = Math.max(0, rightNasal - leftNasal * .65);
    const deadAheadBreak = !verticalPassage && stereoConv > .22 && Math.abs(stereoDisparity) < .12 ? stereoConv * .85 : 0;



    // Contralateral inhibition & frontal driving when facing frontal obstacle (Kemppainen et al. 2022; Kim et al. 2023)
    const binoFrontalThreat = Math.max(frontalThreat, stereoConv, (leftNasal + rightNasal) * .5);
    const binoFrontalRaw = Math.max(frontalRaw, stereoConvRaw, (leftNasalR + rightNasalR) * .5);
    const contraInhibit = binoFrontalThreat > .06 ? Math.max(.18, 1 - .82 * binoFrontalThreat) : 1.0;
    // Single suppression: the loom/flow drives below already multiply by
    // suppressLateral, so the frontal terms must not pre-multiply it (squared).
    // Boxed (dead-end, mono mirror): forced side ONLY when boxed; marginal
    // ties hold straight (0) so the vertical gate decides, not dust.
    const boxedSNN = Math.min(binoFrontalRaw, leftRawT, rightRawT) > .55; // K20-B: mono mirror
    // NOTE: confinedSNN is declared later (corner block); the confined expression
    // is inlined here to avoid TDZ — identical formula.
    // (valley reuses the pre-gate computation above; transit gates escape.)
    const valleyTransit = valley.found && !verticalPassage && binoFrontalThreat > .06;
    const valleyYaw = valleyTransit ? valley.centerErr * .5 : 0;
    const latDamp = valleyTransit ? Math.max(.15, Math.min(1, binoFrontalThreat * 2.5)) : 1; // K15: hold the gap line (rule parity)
    // K24: stall-flip (rule satN mirror) — odometry-fed via input.stalled.
    const stuckSatSNN = (((input.stalled !== false && binoFrontalRaw > .5 && Math.abs(periLeft - periRight) < .08) || (binoFrontalRaw > .75 && center > .75 && Math.abs(periLeft - periRight) < .05) || input.stalled) && goalVis <= .05 && !verticalPassage);
    if (stuckSatSNN) state.satN += state.satN > 121 ? .25 : 1; else state.satN = 0;
    const flipSide = state.satN > 120 ? (Math.floor(state.satN / 120) % 2 === 0 ? 1 : -1) : 0;
    const effEscape = flipSide !== 0 ? flipSide : (escapeDirection !== 0 ? escapeDirection : (binoFrontalRaw * suppressLateral > .5 ? 1 : 0));



    const effEscapeEff = valleyTransit ? 0 : effEscape;
    // K24b: breakthrough follows the ACTIVE escape side (flip-aware, valley-suppressed).
    const breakLeft = deadAheadBreak > 0 && effEscapeEff > 0 ? deadAheadBreak : 0;
    const breakRight = deadAheadBreak > 0 && effEscapeEff < 0 ? deadAheadBreak : 0;
    const frontalLeft = !verticalPassage && binoFrontalThreat > .06 && effEscapeEff > 0 ? binoFrontalThreat * 1.75 : 0;
    const frontalRight = !verticalPassage && binoFrontalThreat > .06 && effEscapeEff < 0 ? binoFrontalThreat * 1.75 : 0;

    let leftLoomDrive = Math.min(2, Math.max(0, (periLeft * 1.55 * latDamp + (input.loomingL || 0) * 1.15 + breakLeft * 1.35 + frontalLeft) * suppressLateral));
    let rightLoomDrive = Math.min(2, Math.max(0, (periRight * 1.55 * latDamp + (input.loomingR || 0) * 1.15 + breakRight * 1.35 + frontalRight) * suppressLateral));
    let leftFlowDrive = Math.min(2, Math.max(0, (nasalDiffL * 1.75 + periLeft * .75 * latDamp + (input.motionL || 0) * .45 + breakLeft * 1.1 + frontalLeft) * suppressLateral * (escapeDirection < 0 ? contraInhibit : 1)));
    let rightFlowDrive = Math.min(2, Math.max(0, (nasalDiffR * 1.75 + periRight * .75 * latDamp + (input.motionR || 0) * .45 + breakRight * 1.1 + frontalRight) * suppressLateral * (escapeDirection > 0 ? contraInhibit : 1)));
    // Freest-corner diagonal escape (2b, rule parity): normalized open-corner
    // vector, gated on bino confined (binoFrontal is this path's frontal).
    const cUL = gridW ? 1 - gridW[0] : 0, cUR = gridW ? 1 - gridW[2] : 0, cLL = gridW ? 1 - gridW[6] : 0, cLR = gridW ? 1 - gridW[8] : 0;
    const cOSum = cUL + cUR + cLL + cLR;
    const confinedSNN = binoFrontalRaw * suppressLateral > .5;
    const cTurn = confinedSNN && cOSum > .01 ? (cUR + cLR - cUL - cLL) / cOSum * .5 : 0;
    const rawCClimb = confinedSNN && cOSum > .01 ? (cUL + cUR - cLL - cLR) / cOSum * .5 : 0;
    const cClimb = rawCClimb > 0 && Number.isFinite(altIn) && altIn > .135 ? 0 : rawCClimb;
    // Contralateral suppression (confined, mono mirror): bilateral saturation
    // maxes both pool rates at the refractory ceiling and collapses the
    // differential readout to straight. Inhibit the escape-opposite drives.
    if (confinedSNN && boxedSNN) {
      if (effEscapeEff > 0) { rightLoomDrive *= .45; rightFlowDrive *= .45; }
      else if (effEscapeEff < 0) { leftLoomDrive *= .45; leftFlowDrive *= .45; }
    }

    // Partitioned Binocular Excitation:
    // - Peripheral looming -> LPLC2 / LC4 / LLPC
    for (const n of lateralLoomOnlyL) n.input += leftLoomDrive * .84;
    for (const n of lateralLoomOnlyR) n.input += rightLoomDrive * .84;
    // - Binocular nasal overlap & stereo disparity -> Optic-flow projection neurons
    for (const n of lateralFlowOnlyL) n.input += leftFlowDrive * .82;
    for (const n of lateralFlowOnlyR) n.input += rightFlowDrive * .82;
    for (const n of visualL) n.input += (leftLoomDrive + leftFlowDrive) * .09;
    for (const n of visualR) n.input += (rightLoomDrive + rightFlowDrive) * .09;
    // Freest-corner turn (2b): open-right pulls the left pools (both turn right).
    if (cTurn > 0) { for (const n of lateralLoomOnlyL) n.input += cTurn * suppressLateral * .84; for (const n of lateralFlowOnlyL) n.input += cTurn * suppressLateral * .82; for (const n of visualL) n.input += cTurn * suppressLateral * .09; }
    else if (cTurn < 0) { for (const n of lateralLoomOnlyR) n.input += -cTurn * suppressLateral * .84; for (const n of lateralFlowOnlyR) n.input += -cTurn * suppressLateral * .82; for (const n of visualR) n.input += -cTurn * suppressLateral * .09; }
    // VFH valley steer (rule parity): gap-right pulls the left pools, mirrored.
    if (valleyYaw > 0) { for (const n of lateralLoomOnlyL) n.input += valleyYaw * suppressLateral * .84; for (const n of lateralFlowOnlyL) n.input += valleyYaw * suppressLateral * .82; for (const n of visualL) n.input += valleyYaw * suppressLateral * .09; }
    else if (valleyYaw < 0) { for (const n of lateralLoomOnlyR) n.input += -valleyYaw * suppressLateral * .84; for (const n of lateralFlowOnlyR) n.input += -valleyYaw * suppressLateral * .82; for (const n of visualR) n.input += -valleyYaw * suppressLateral * .09; }
    // Mechanosensory touch reflex (B): contact normal lateralizes exactly where vision
    // saturates symmetric. DN-pool excitation, goal-unsuppressed; zero when untouched.
    const touchMag = Math.max(0, Math.min(1, Number(input.touch?.mag) || 0));
    if (touchMag > 0) {
      const touchPool = Number(input.touch?.side) >= 0 ? dnL : dnR;
      for (const n of touchPool) n.input += touchMag * 2.2;
    }

    const upperOpen = Math.max(0, 1 - upperMixed), lowerOpen = Math.max(0, 1 - lowerMixed);
    let climbSignal = 0, diveSignal = 0;
    // Frontal looming-rate pre-climb (A): approach expansion adds climb drive in
    // no-gate and open-top flight, but only toward the opener side (upper route
    // clearer than lower by the gate delta); bottom openings and flat walls keep
    // level flight so gate logic (not pre-climb) decides. Goal tracking and
    // landing dives stay exempt.
    const centerLoom = Math.max(0, Number(input.loomingC) || 0);
    const goalElev = (goalVertical !== undefined && Math.abs(Number(goalVertical)) > 1e-4) ? Number(goalVertical) : goalLockY * .75;
    // Goal-wins-on-weak-conflict: a clearly below/above goal overrides the gate
    // branch when the avoidance reason on the goal side is weak; strong blocking
    // keeps avoidance priority (never dive into a wall for a beacon).
    const goalOverridesGate = goalVis > .05 && ((goalElev < -.03 && openTopGate && !openBottomGate && (lowerMixed < .6 || (goalElev < -.25 && altIn > .05))) || (goalElev > .03 && openBottomGate && !openTopGate && upperMixed < .6)); // .6 bar (rule parity)
    if ((goalVis > .05 && !openTopGate && !openBottomGate) || goalOverridesGate) {
      if (goalElev < -.03) diveSignal = Math.min(2, .55 + Math.abs(goalElev) * 2.4);
      else if (goalElev > .03) climbSignal = Math.min(2, .45 + goalElev * 2.4);
    } else if (openTopGate) {
      climbSignal = Math.max(centerMixed, lowerMixed) * upperOpen * 2.6 + .45;
    } else if (openBottomGate) {
      diveSignal = Math.max(centerMixed, upperMixed) * lowerOpen * 2.6 + .45;
    }
    if (centerLoom > 0 && center > .35 && !valley.found && !openBottomGate && (goalVis <= .05 || openTopGate) && upperRoute < .35) climbSignal = Math.min(2, climbSignal + centerLoom * 1.4); // K19R: pre-climb needs verified open above (rule parity)
    // Freest-corner vertical (2b): open-up pulls climb, open-down pulls dive; sensory-side of the trap.
    if (cClimb > 0) climbSignal = Math.min(2, climbSignal + cClimb * (goalVis > .05 ? goalWallSuppress : 1));
    else if (cClimb < 0) diveSignal = Math.min(2, diveSignal - cClimb * (goalVis > .05 ? goalWallSuppress : 1));
    ({ climbSignal, diveSignal } = applyVerticalTrap(state, { climbSignal, diveSignal, center: centerMixed, upperRoute, lowerRoute, upT, downT, dt, loomC: centerLoom, gated: verticalPassage, goalVis, goalVert: Number(goalVertical) || 0, alt: altNow }));
    const upperDrive = Math.min(2, climbSignal);
    const lowerDrive = Math.min(2, diveSignal);
    for (const n of upperVisual) n.input += upperDrive * .95;
    for (const n of lowerVisual) n.input += lowerDrive * .95;

    // 3) LC10 Target-Fixation Pathway driven by continuous binocular ray bearing
    const bearing = rawGoalVis > .03 ? (Number(input.goalBearing) || 0) : (Number(input.goalBearing) || state.targetTrace.bearing || 0);
    const effectiveBearing = goalVis > .05 ? goalLockX * 1.08 + bearing * .45 : bearing;
    const maxSideThreat = verticalPassage ? 0 : Math.max(periLeft, periRight, frontalThreat) * goalWallSuppress;
    const goalAttenuation = goalVis > .08 ? 1.25 : Math.max(.35, 1 - maxSideThreat * .60);
    const cue = Math.min(1.35, Math.abs(effectiveBearing) / .55) * goalAttenuation;
    if (effectiveBearing > 0) {
      for (const n of lateralTargetOnlyL) n.input += cue * 1.15;
      for (const n of lateralFlowOnlyL) n.input += cue * .85;
      for (const n of visualL) n.input += cue * .20;
    } else if (effectiveBearing < 0) {
      for (const n of lateralTargetOnlyR) n.input += cue * 1.15;
      for (const n of lateralFlowOnlyR) n.input += cue * .85;
      for (const n of visualR) n.input += cue * .20;
    }

    // K30 trial (revertible): climb-commitment inhibition of lateral pools —
    // a committed climb hyperpolarizes lateral loom/flow pools so the turn readout
    // cannot veer off a vertical maneuver (dive->climb gap fix, neural form).
    // Target-fixation pools stay intact (goal tracking survives a climb).
    if (SNN_CLIMB_INHIBIT) {
      const climbCommit = Math.max(0, Math.min(1, (upperDrive - lowerDrive) / 1.2));
      if (climbCommit > .05) {
        for (const n of lateralLoomOnlyL) n.input -= climbCommit * 1.2;
        for (const n of lateralLoomOnlyR) n.input -= climbCommit * 1.2;
        for (const n of lateralFlowOnlyL) n.input -= climbCommit * 1.2;
        for (const n of lateralFlowOnlyR) n.input -= climbCommit * 1.2;
      }
    }
    // Synaptic current is added exactly once: the ALIF plugin sums it inside
    // integrateNeurons, so the baseline loop below runs for LIF only.
    let currentSpikes = [];
    if (state.neuronRule === 'alif_surrogate' && alifPlugin()?.integrateNeurons) {
      currentSpikes = alifPlugin().integrateNeurons(nodes, synapses, state, CONFIG, input);
    } else {
      for (const id of state.lastSpikes) { const source = nodes.get(id); if (source) for (const syn of source.outgoing) { const target = nodes.get(syn.target); if (target) target.current += syn.weight; } }
      for (const n of nodes.values()) {
        if (n.refractory > 0) { n.refractory--; n.spiking = false; }
        else {
          n.v = n.v * CONFIG.leak + n.input + n.current;
          if (n.v >= n.threshold) {
            n.spiking = true; n.v = Math.max(CONFIG.rest, n.v - n.threshold); n.refractory = 1; n.spikes++; currentSpikes.push(Number(n.id));
          } else {
            n.spiking = false; n.v = Math.max(CONFIG.rest, n.v);
          }
        }
        n.firingRate = n.firingRate * .82 + (n.spiking ? .32 : 0);
      }
      state.lastSpikes = currentSpikes;
      for (const syn of synapses) { const source = nodes.get(syn.source), target = nodes.get(syn.target); syn.eligibility *= .965; if (source?.spiking) syn.eligibility = Math.min(2, syn.eligibility + .12 + (target?.firingRate || 0) * .35); }
    }
    state.leftMotor = motorL.reduce((a, n) => a + n.firingRate, 0); state.rightMotor = motorR.reduce((a, n) => a + n.firingRate, 0);
    state.leftDn = dnL.reduce((a, n) => a + n.firingRate, 0); state.rightDn = dnR.reduce((a, n) => a + n.firingRate, 0);

    // Binocular differential readout with balanced L/R normalization (prevents anatomical neuron-count bias):
    const loomDiff = (lateralLoomOnlyL.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralLoomOnlyL.length)) - (lateralLoomOnlyR.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralLoomOnlyR.length));
    const flowDiff = (lateralFlowOnlyL.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralFlowOnlyL.length)) - (lateralFlowOnlyR.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralFlowOnlyR.length));
    const targetDiff = (lateralTargetOnlyL.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralTargetOnlyL.length)) - (lateralTargetOnlyR.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lateralTargetOnlyR.length));
    const dnDiff = (state.leftDn / Math.max(1, dnL.length)) - (state.rightDn / Math.max(1, dnR.length));
    const motorDiff = (state.leftMotor / Math.max(1, motorL.length)) - (state.rightMotor / Math.max(1, motorR.length));
    // Homeostatic bilateral symmetry gate: when L and R visual drives and goal bearing are symmetric, suppress anatomical threshold bias
    const driveAsym = Math.abs(leftLoomDrive - rightLoomDrive) + Math.abs(leftFlowDrive - rightFlowDrive) + Math.abs(effectiveBearing) * 2;
    const symGate = binoFrontalThreat > .06 ? 1.0 : (driveAsym < .02 ? 0 : Math.min(1, driveAsym / .08));
    const turnIntent = (loomDiff * .50 + flowDiff * .52 + targetDiff * .45 + dnDiff * .35 + motorDiff * .20) * symGate;
    const turnSign = turnIntent > .006 ? 1 : turnIntent < -.006 ? -1 : 0;
    const turnActivity = Math.min(1, Math.abs(turnIntent) * 3.4 + Math.abs(motorDiff) * .30);
    const rawTurnQuant = turnSign * Math.min(.16, turnActivity * state.gains[turnSign > 0 ? 'left' : 'right'] * .16); // V1.6 path (K29 revert)
    const rawTurnCont = Math.abs(turnIntent) < .001 ? 0 : Math.max(-.16, Math.min(.16, turnIntent * .5 * state.gains[turnIntent > 0 ? 'left' : 'right'])); // K29: deadzone .001 (was .006), V1.6-matched .5 slope (Baseten x1.5 was 3x hot)
    const rawTurn = SNN_CONTINUOUS_TURN ? rawTurnCont : rawTurnQuant;
    const tTurn = input.teacher ? Number(input.teacher.turn) || 0 : 0;
    let turn = bilateralStall ? rawTurn + (tTurn - rawTurn) * .55 : rawTurn;
    state.saccadePhase += dt;
    if (!bilateralStall) turn = Math.max(-.16, Math.min(.16, turn + saccadePulse(state, { goalVis, rawTurn, verticalPassage: verticalPassage || vpHoldActive, valleyTransit })));

    const upperActivity = upperVisual.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, upperVisual.length);
    const lowerActivity = lowerVisual.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, lowerVisual.length);
    const verticalCue = upperDrive > lowerDrive + .05 ? 1 : lowerDrive > upperDrive + .05 ? -1 : 0;
    const verticalSign = verticalCue === 1 && upperActivity > lowerActivity + .008 ? 1 : verticalCue === -1 && lowerActivity > upperActivity + .008 ? -1 : 0;
    const candidateActivity = verticalCandidates.reduce((a, n) => a + n.firingRate, 0) / Math.max(1, verticalCandidates.length);
    const verticalMotorActivity = (state.leftMotor + state.rightMotor) / Math.max(1, motorL.length + motorR.length);
    const verticalActivity = Math.min(1, Math.abs(upperActivity - lowerActivity) * 2.8 + candidateActivity * .35 + verticalMotorActivity * .08);
    const rawClimb = verticalSign * Math.min(1, verticalActivity * state.gains[verticalSign > 0 ? 'climb' : 'dive']);
    const climbUrgency = openTopGate && verticalSign > 0 ? .35 + .65 * Math.min(1, center / .6) : 1;
    const restoreDive = (!openTopGate && !openBottomGate && goalVis < .05 && ((frontalThreat < .3 && centerLoom <= 0) || altIn > .115) && Number.isFinite(altIn)) ? Math.max(-.6, Math.min(.6, (.08 - altIn) * 10)) : 0; // cruise-altitude hold toward .08 (rule parity; was sink-to-.02)
    const vertDrive = Math.max(upperDrive, lowerDrive);
    const analogUrgency = ((openTopGate && verticalSign > 0) || (openBottomGate && verticalSign < 0)) ? 1 : Math.max(0, Math.min(1, vertDrive / 1.5)); // K20-A: spikes binarize magnitude — non-gate drives (corner/pre-climb/trap/goal) ride their analog level like gate urgency
    let climb = rawClimb * climbUrgency * analogUrgency + restoreDive;
    if (Number.isFinite(altIn) && altIn <= .03 && climb < -.15) climb = -.15; // floor dive softening (rule parity)
    if (climb > 0 && Number.isFinite(altIn)) climb *= Math.max(0, Math.min(1, (.20 - altIn) / .06)); // K17: headroom grades climb magnitude (rule parity)

    const leftDrive = Math.max(leftLoomDrive, leftFlowDrive), rightDrive = Math.max(rightLoomDrive, rightFlowDrive);
    if (state.neuronRule === 'alif_surrogate' && alifPlugin()?.updateReadoutEligibility) {
      turn = alifPlugin().updateReadoutEligibility(state, core, turnSign, turnActivity, verticalSign, verticalActivity, turn, input);
    } else {
      state.eligibility.left = Math.min(1, state.eligibility.left * .94 + (turnSign > 0 ? turnActivity : 0) * .08);
      state.eligibility.right = Math.min(1, state.eligibility.right * .94 + (turnSign < 0 ? turnActivity : 0) * .08);
      state.eligibility.climb = Math.min(1, state.eligibility.climb * .94 + (verticalSign > 0 ? verticalActivity : 0) * .08);
      state.eligibility.dive = Math.min(1, state.eligibility.dive * .94 + (verticalSign < 0 ? verticalActivity : 0) * .08);
    }
    const threat = Math.max(leftDrive, rightDrive, upperDrive, lowerDrive, (input.frontThreat || 0) * goalWallSuppress), bilateral = state.leftMotor + state.rightMotor + state.leftDn + state.rightDn;
    const slowForGoal = (goalVis > .15 && (Math.abs(goalLockX) > .18 || Math.abs(Number(goalVertical) || 0) > .15)) || goalVis > .5; // near goal always slows (rule parity: approach-speed overshoot guard)
    const bilateralN = motorL.length + motorR.length + dnL.length + dnR.length;
    const speedMultiplier = slowForGoal ? .58 : valleyTransit ? .6 : (threat > .5 || bilateralLoad(bilateral, bilateralN) > CONFIG.bilateralGate ? .72 : 1.0);
    return { visionMode: 'binocular', neuronRule: state.neuronRule, turn, rawTurn, climb, rawClimb, speedMultiplier, threat, spikes: currentSpikes, spikeCount: currentSpikes.length, leftMotor: state.leftMotor, rightMotor: state.rightMotor, leftDn: state.leftDn, rightDn: state.rightDn, leftDrive, rightDrive, upperDrive, lowerDrive, upperActivity, lowerActivity, verticalActivity, collisionIndex: state.collisionIndex, explorationRate: state.explorationRate, rewardEma: state.rewardEma, telemetry: getActiveNodes() }; // V1.6: K25b/K26a retired
  }

  function getActiveNodes() {
    const active = [...nodes.values()].filter(n => n.firingRate > .01).sort((a, b) => b.firingRate - a.firingRate), selected = new Map();
    for (const group of ['visual_projection', 'visual_centrifugal', 'descending_neuron', 'vnc_motor']) for (const n of active.filter(x => x.superclass === group).slice(0, 3)) selected.set(Number(n.id), n);
    for (const n of active) { if (selected.size >= 12) break; selected.set(Number(n.id), n); }
    return [...selected.values()].sort((a, b) => b.firingRate - a.firingRate).slice(0, 12).map(n => ({ id: n.id, name: n.name, type: n.type, superclass: n.superclass, side: n.side, firingRate: n.firingRate, spiking: n.spiking }));
  }
  function reinforce(reward, teacher = null, student = null) { return applyReinforcement(state, reward, teacher, student); }
  function stats() { return { mode: 'binocular', neuronRule: state.neuronRule, nodes: nodes.size, edgeRows: synapses.length, visual: visualAll.length, descending: dnL.length + dnR.length, motor: motorL.length + motorR.length, verticalCandidates: verticalCandidates.length, spikes: state.lastSpikes.length, rewardUpdates: state.rewardUpdates, cumulativeReward: state.cumulativeReward, collisionIndex: state.collisionIndex || 0, explorationRate: state.explorationRate || 0, rewardEma: state.rewardEma || 0, meanSurrogateGrad: state.meanSurrogateGrad || 0, gains: { ...state.gains }, active: getActiveNodes() }; }
  function reset() { state.lastSpikes = []; state.targetTrace = { vis: 0, x: 0, y: 0, bearing: 0, elev: 0 }; state.stallSteps = 0; state.diveTrapT = 0; state.diveTrapRef = 0; state.diveTrapRefDn = 0; state.climbTrapT = 0; state.climbTrapRef = 0; state.climbTrapRefDn = 0; state.climbTrapRefUp = 0; state.diveEscT = -1; state.climbEscT = -1; state.openTopHold = false; state.openTopHoldT = 0; state.satN = 0; state.openBottomHold = false; state.lowerBase = null; state.collisionIndex = 0; state.saccadePhase = 0; state.vpHold = 0; for (const syn of synapses) syn.eligibility = 0; for (const key of Object.keys(state.eligibility)) state.eligibility[key] = 0; for (const n of nodes.values()) { n.v = 0; n.adapt = 0; n.threshold = n.baseThreshold; n.refractory = 0; n.spiking = false; n.firingRate = 0; n.input = 0; n.current = 0; } }
  function resetLearning() { for (const key of Object.keys(state.gains)) { state.gains[key] = 1; state.eligibility[key] = 0; } state.rewardUpdates = 0; state.cumulativeReward = 0; state.collisionIndex = 0; state.rewardEma = 0; state.explorationRate = 0; }
  function setLearningRate(v) { state.learnRate = Math.max(0, Math.min(.05, Number(v) || 0)); }
  function setNeuronRule(rule) { state.neuronRule = rule === 'alif_surrogate' ? 'alif_surrogate' : 'lif_baseline'; }
  function exportWeights() { return { schema_version: '1.1', mode: 'binocular', neuronRule: state.neuronRule, gains: { ...state.gains }, rewardUpdates: state.rewardUpdates, cumulativeReward: state.cumulativeReward, collisionIndex: state.collisionIndex, explorationRate: state.explorationRate, learnRate: state.learnRate }; }
  function loadWeights(data = {}) {
    const src = data?.binocular || data?.learned_gains_binocular || data;
    const g = src.gains || src.learned_gains || src.default_pretrained_gains || src;
    for (const k of ['left', 'right', 'climb', 'dive']) if (Number.isFinite(Number(g[k]))) state.gains[k] = Math.max(CONFIG.minGain, Math.min(CONFIG.maxGain, Number(g[k])));
    if (Number.isFinite(Number(src.rewardUpdates))) state.rewardUpdates = Number(src.rewardUpdates);
    if (Number.isFinite(Number(src.cumulativeReward))) state.cumulativeReward = Number(src.cumulativeReward);
    return { ...state.gains };
  }
  return { mode: 'binocular', step, reinforce, stats, reset, resetLearning, setLearningRate, setNeuronRule, exportWeights, loadWeights, graph };
};

// ============================================================================
// [FACADE] DUAL-PATHWAY FLIGHT CONNECTOME ROUTER
// Holds completely independent Monocular and Binocular connectome instances
// and separate weight sets so switching cameras never mixes neural state or weights.
// ============================================================================
export const createFlightConnectome = (graph, options = {}) => {
  if (options?.mode === 'monocular') {
    const net = createMonocularConnectome(graph);
    if (options.neuronRule) net.setNeuronRule(options.neuronRule);
    return net;
  }
  if (options?.mode === 'binocular') {
    const net = createBinocularConnectome(graph);
    if (options.neuronRule) net.setNeuronRule(options.neuronRule);
    return net;
  }
  const monoNet = createMonocularConnectome(graph);
  const binoNet = createBinocularConnectome(graph);
  let activeMode = 'monocular';
  let activeNeuronRule = options?.neuronRule || 'lif_baseline';
  monoNet.setNeuronRule(activeNeuronRule);
  binoNet.setNeuronRule(activeNeuronRule);
  const current = () => activeMode === 'binocular' ? binoNet : monoNet;
  const facade = {
    get activeMode() { return activeMode; },
    get neuronRule() { return activeNeuronRule; },
    setMode(mode) { activeMode = mode === 'binocular' ? 'binocular' : 'monocular'; return current(); },
    setNeuronRule(rule) {
      activeNeuronRule = rule === 'alif_surrogate' ? 'alif_surrogate' : 'lif_baseline';
      monoNet.setNeuronRule(activeNeuronRule);
      binoNet.setNeuronRule(activeNeuronRule);
    },
    get monocular() { return monoNet; },
    get binocular() { return binoNet; },
    step(input = {}) {
      activeMode = input.visionMode === 'binocular' ? 'binocular' : 'monocular';
      if (input.neuronRule && input.neuronRule !== activeNeuronRule) facade.setNeuronRule(input.neuronRule);
      return current().step(input);
    },
    reinforce(reward, teacher = null, student = null) {
      return current().reinforce(reward, teacher, student);
    },
    stats(mode = activeMode) {
      return (mode === 'binocular' ? binoNet : monoNet).stats();
    },
    reset() { monoNet.reset(); binoNet.reset(); },
    resetLearning(mode = null) {
      if (!mode || mode === 'monocular') monoNet.resetLearning();
      if (!mode || mode === 'binocular') binoNet.resetLearning();
    },
    setLearningRate(v) { monoNet.setLearningRate(v); binoNet.setLearningRate(v); },
    exportWeights() {
      const active = current().exportWeights();
      return {
        schema_version: '1.1',
        activeMode,
        neuronRule: activeNeuronRule,
        gains: { ...active.gains },
        rewardUpdates: active.rewardUpdates,
        cumulativeReward: active.cumulativeReward,
        collisionIndex: active.collisionIndex,
        explorationRate: active.explorationRate,
        learnRate: active.learnRate,
        monocular: monoNet.exportWeights(),
        binocular: binoNet.exportWeights()
      };
    },
    loadWeights(data = {}) {
      if (data?.monocular || data?.binocular || data?.learned_gains_binocular) {
        if (data.monocular) monoNet.loadWeights(data.monocular);
        else monoNet.loadWeights(data);
        if (data.binocular || data.learned_gains_binocular) binoNet.loadWeights(data.binocular || data.learned_gains_binocular);
        else binoNet.loadWeights(data);
      } else {
        monoNet.loadWeights(data);
        binoNet.loadWeights(data);
      }
      return current().stats().gains;
    },
    graph
  };
  return facade;
};
