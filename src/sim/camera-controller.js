// NSP 3D — camera-controller.js
// Single source of the camera-rule sense + controller (index.html, path-planner,
// benchmarks all import from here; no local copies). Dependency-free (node-testable).
// Lateral steering: 8-sector mean+max differential + freest-sector cost with
// hysteresis — freest-sector idea after FOAM (#39), unilateral-max after LORA III (#41).
// Post-contact rotation: graded mechanosensory touch reflex (caller-decayed
// brain.touch) — clean-room, no copied code.
import { CAMERA_PIPELINE, WORLD } from '../config.js';
import { computeValleySteer } from '../vision/camera-vision.js';

export const CONTROLLER_BUILD = '2026-10-29.17+k23k24-grayflip';
// K31 trial (revertible): 250ms vertical-passage hold bridges the dive->climb
// gap so lateral suppression survives gate release (ba climb-veer consult).
// false restores V1.6 instant release + .08 passage suppression.
const RULE_VERT_HOLD = false; // reverted 2026-10-30: flight worse (K31)
// F-G2 (revertible): landing approach (visible + below goal) grades the speed
// cap by proximity (far .58 -> near .25) so the sink ratio covers lip-exit
// altitude instead of overflying the floor goal. false restores flat V1.6 .58.
const GOAL_APPROACH_SLOW = true;
// F-G1 (revertible): landing approach locks the goal line — wall avoidance
// fades to .05 and goal steering doubles, so residual avoidance can't drag
// the final descent into a corner. false restores V1.6.
const GOAL_LINE_LOCK = true;
// F-G5 (revertible): blind-dive memory — a floor goal exits the FOV bottom
// ~60mm out, so the visible dive window is only ~0.2s; a latched landing
// approach keeps diving + slow for 3s after the goal vanishes (SNN parity:
// targetTrace). false restores V1.6 level overfly. Cancelled by touch.
const GOAL_DIVE_MEMORY = true;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// Sensory adapter: decoder signal -> brain features.
// Goal cues come from camera pixels only (goalLockX/goalLockY/goalVisible).
// sensitivity mirrors the index.html range slider value / 10 (1.0 at default).
export function senseVision(pos, yaw, pitch, vision, { sensitivity = 1, neuronRule = 'lif_baseline', eyeMode = 'monocular' } = {}) {
  const s = sensitivity;
  const leftThreat = clamp(vision.leftThreat * s);
  const rightThreat = clamp(vision.rightThreat * s);
  const frontThreat = clamp(vision.frontThreat * s);
  const upThreat = clamp(vision.upThreat * s);
  const downThreat = clamp(vision.downThreat * s);
  // Raw (unsensitized) channels for geometric gates: fixed thresholds (.32/.5/.65/.8)
  // are calibrated in raw occupancy space; comparing them against sens-scaled
  // values silently disables gates whenever sensitivity < 1. Drives above stay
  // scaled (gain must modulate drive strength). gridWall passes through via
  // ...vision unscaled for the same reason; grid stays scaled (baseline/drives).
  const frontRaw = vision.frontThreat, leftRaw = vision.leftThreat, rightRaw = vision.rightThreat;
  const leftOuterRaw = vision.leftOuterThreat, leftInnerRaw = vision.leftInnerThreat;
  const rightInnerRaw = vision.rightInnerThreat, rightOuterRaw = vision.rightOuterThreat;
  const grid = vision.grid.map((value) => clamp(value * s));
  const sectors = Array.isArray(vision.sectors) ? vision.sectors.map((value) => clamp(value * s)) : vision.sectors;
  const scaleOpt = (value) => (value === undefined ? undefined : clamp(value * s));
  const leftOuterThreat = scaleOpt(vision.leftOuterThreat), leftInnerThreat = scaleOpt(vision.leftInnerThreat);
  const rightInnerThreat = scaleOpt(vision.rightInnerThreat), rightOuterThreat = scaleOpt(vision.rightOuterThreat);
  const halfHorizontalFov = Math.atan(Math.tan(CAMERA_PIPELINE.fov * Math.PI / 360) * (CAMERA_PIPELINE.frameWidth / CAMERA_PIPELINE.frameHeight));
  const goalVisible = (vision.goalVisible || 0) > .05;
  const goalBearing = goalVisible ? Math.atan((vision.goalLockX || 0) * Math.tan(halfHorizontalFov)) : 0;
  // Eye-vertical-FOV parity: each bino eye renders 115° vertical, but goal
  // elevation was always mapped with the mono 100°, shrinking bino descents
  // (landing dives never fired) — map with the capturing eye's own FOV.
  const halfVFovTan = Math.tan((eyeMode === 'binocular' ? CAMERA_PIPELINE.binocularFov : CAMERA_PIPELINE.fov) * Math.PI / 360);
  // Gaze-stabilization parity: the eye renders with camPitch = pitch*pitchGain
  // (0 = level), so world elevation adds only the rendered pitch — adding full
  // pitch double-counts and flips below-goals above while climbing.
  const renderedPitch = pitch * (CAMERA_PIPELINE.pitchGain || 0);
  const goalVertical = goalVisible ? renderedPitch + Math.atan((vision.goalLockY || 0) * halfVFovTan) : 0;
  return { ...vision, neuronRule, sensitivity: s, grid, leftThreat, rightThreat, frontThreat, upThreat, downThreat, sectors, leftOuterThreat, leftInnerThreat, rightInnerThreat, rightOuterThreat, frontRaw, leftRaw, rightRaw, leftOuterRaw, leftInnerRaw, rightInnerRaw, rightOuterRaw, altitude: pos.y, goalBearing, goalVertical };
}

// Stateful rule controller: hysteresis lives in the freest-sector memory (lastF).
// One instance per agent/episode; call reset() on episode reset.
export function createCameraRuleController() {
  const st = { lastF: 3.5, castN: 0, satN: 0, lowerBase: null, openTopHold: false, openTopHoldT: 0, climbTrapT: 0, climbEscT: -1, climbTrapRef: null, climbTrapRefUp: null, climbTrapRefDn: null, climbTrapRefAlt: null, vpHold: 0, lipLatchT: 0, goalDiveT: 0 };
  function step(s) {
    st.castN++;
    const gw = Array.isArray(s.gridWall) && s.gridWall.length === 9 ? s.gridWall : s.grid;
    const center = gw[4], upper = gw[1], lower = gw[7], goalVis = s.goalVisible || 0;
    const upperMixed = s.grid[1], lowerMixed = s.grid[7]; // graded altitude signals stay on the mixed grid (floor-aware)
    const sens = Number(s.sensitivity) > 0 ? Number(s.sensitivity) : 1; // Weber gate scaling: mixed-grid bars scale with visual gain (missing = 1, V1.6)
    // Bottom-gate (SNN parity): wall above + lower at the floor BASELINE.
    if (st.lowerBase === null || st.lowerBase === undefined) st.lowerBase = Math.min(lowerMixed, .75);
    else if (lowerMixed < st.lowerBase) st.lowerBase = lowerMixed;
    else st.lowerBase = Math.min(.8, st.lowerBase + (lowerMixed - st.lowerBase) * .02); // cap .8: floor never reads hotter; wall bases can't drag the baseline up
    // Differential path bypasses the .32 headroom bar (lip-safe, SNN parity): the
    // wall-top lip reads hot on approach, but up is freer than down. Ceiling
    // stays out of the boolean; headroom grades via climb magnitude instead.
    // Lip band capped at .65 (botOpen parity): a solid-hot upper is a wall.
    // VFH valley + altitude room, computed pre-gate (SNN parity): level gaps
    // suppress vertical gates; gates need physical room (fail-open w/o alt).
    const valley = computeValleySteer(s.cellsWall, goalVis > .025 ? clamp(s.goalLockX || 0, -1, 1) : 0);
    const altIn = Number(s.altitude);
    const headroomOk = !Number.isFinite(altIn) || altIn < .16;
    const legroomOk = !Number.isFinite(altIn) || altIn > .03;
    const sideBlocked = Math.min(Math.max(gw[3], gw[6]), Math.max(gw[5], gw[8])) > .3 || Math.min(gw[3], gw[5]) > .17; // K16-A: climb only when lateral is blocked; open sides veer around
    const topEv = !valley.found && headroomOk && center > .35 && (upper < .35 || (lower > .85 && upper < .45 && lower > center + .25)); // K19R: climb needs VERIFIED open above (wall-ahead + open-above evidence) — corner gradients can't fake an open sky
    const topRaw = topEv || (!valley.found && (center > .35 && upper < center * .52 && upper <= lower + .03) && upper < .32); // K20-2: lip clause needs the valley guard too (SNN parity)
    // K22: the hold bridges the lip-hot band (~0.5s), not gap flight. Sustain
    // needs the wall face below (mid-transit) and expires 1.0s after raw was
    // last seen — back-to-back walls re-latch on fresh evidence instead.
    const holdDt = Number(s.dt) > 0 ? Number(s.dt) : 1 / 60;
    if (topRaw && sideBlocked && headroomOk) { st.openTopHold = true; st.openTopHoldT = 0; }
    else if (st.openTopHold) {
      st.openTopHoldT += holdDt;
      if (!((center > .18 || lower > .55) && lower > .15 && upper < .65 && st.openTopHoldT < 1.0)) st.openTopHold = false;
    }
    const openTopGate = headroomOk && sideBlocked && (topRaw || st.openTopHold);
    const openBottomGate = !valley.found && legroomOk && upperMixed > .45 * sens && lowerMixed < st.lowerBase + .12 && lower < .35 && !(center >= .92 && upper < .88 && (lower > .05 || !(altIn > .115))); // K19R: dive needs VERIFIED open below (wall-free; floor reads in mixed, never here). Bar scales with gain: a fixed .45 on a .45-capped grid can never fire (batch-g3 ceiling lock)
    const verticalPassage = openTopGate || openBottomGate;
    if (st.vpHold === undefined) st.vpHold = 0;
    if (verticalPassage) st.vpHold = 15; else if (st.vpHold > 0) st.vpHold--;
    const vpHoldActive = RULE_VERT_HOLD && st.vpHold > 0;
    const goalElevEarly = (s.goalVertical !== undefined && Math.abs(s.goalVertical) > 1e-4) ? s.goalVertical : (s.goalLockY || 0) * .75;
    const goalBelow = goalVis > .15 && goalElevEarly < -.3; // landing approach only: far visible goals stay V1.6
    const frontClear = (s.frontRaw ?? s.frontThreat) < .35; // K18 near-bar: no barrier between agent and goal
    if (lower > .3) st.lipLatchT = .5; else st.lipLatchT = Math.max(0, st.lipLatchT - holdDt); // lip memory: a lip sliding under the FOV bottom goes invisible 10mm out — stay uncommitted .5s past the last sighting
    const diveClear = lower < .12 && st.lipLatchT <= 0; // the DIVE corridor must be lip-free too: a below-eye lip reads front-clear but kills the descent. Bar sits under the mono lip sliver (.18 at 11mm): a too-strict bar only falls back to V1.6, a loose one grinds.
    if (goalBelow && frontClear) st.goalDiveT = 3; else st.goalDiveT = Math.max(0, st.goalDiveT - holdDt); // F-G5 latch: a landing approach arms the blind dive (re-armed every visible frame)
    const blindDive = GOAL_DIVE_MEMORY && st.goalDiveT > 0 && goalVis < .05 && !s.touch && center < .35; // goal slipped under the FOV bottom: keep diving + slow instead of going level (yields to frontal walls + touch)
    const goalCommitted = GOAL_LINE_LOCK && goalBelow && frontClear && diveClear;
    const wallSuppress = goalVis > .05 ? (goalCommitted ? .05 : clamp(1 - goalVis * .85, .12, 1)) : (RULE_VERT_HOLD ? ((verticalPassage || vpHoldActive) ? .02 : 1) : (verticalPassage ? .08 : 1));
    const leftT = s.leftThreat * wallSuppress, rightT = s.rightThreat * wallSuppress, frontT = s.frontThreat * wallSuppress;
    const frontTRaw = (s.frontRaw ?? s.frontThreat) * wallSuppress;
    // Lateral sectors s0 far-left .. s7 far-right. Mean differential keeps the
    // legacy response; max differential + freest-sector cost restore authority
    // when thirds saturate symmetric on wide walls.
    const sec = Array.isArray(s.sectors) && s.sectors.length === 8 ? s.sectors : null;
    // Regime split (aggregate evidence): facing a blockage (same frontT scale as
    // stuckSat), keep exploratory veer; in the open, neutralize symmetric noise.
    const confined = frontTRaw > .5;
    // Freest-corner diagonal escape (2b): when confined (front blocked), the
    // normalized open-corner vector pulls turn+climb toward the open diagonal.
    // Symmetric/uniform corners yield zero; center-open flight is untouched.
    const gUL = 1 - gw[0], gUR = 1 - gw[2], gLL = 1 - gw[6], gLR = 1 - gw[8];
    const gOSum = gUL + gUR + gLL + gLR;
    const cornerTurn = confined && gOSum > .01 ? ((gUR + gLR - gUL - gLL) / gOSum) * .35 * wallSuppress : 0;
    const rawCornerClimb = confined && gOSum > .01 ? ((gUL + gUR - gLL - gLR) / gOSum) * .35 * wallSuppress : 0;
    const cornerClimb = rawCornerClimb > 0 && Number.isFinite(altIn) && altIn > .085 ? 0 : rawCornerClimb;
    let latErr, freeBias = 0;
    if (sec) {
      const sideL = (sec[0] + sec[1] + sec[2] + sec[3]) * .25, sideR = (sec[4] + sec[5] + sec[6] + sec[7]) * .25;
      const maxL = Math.max(sec[0], sec[1], sec[2], sec[3]), maxR = Math.max(sec[4], sec[5], sec[6], sec[7]);
      // Suppression parity with thirds: goal fixation and gate transit attenuate
      // the sector differential and freest bias exactly like leftT/rightT/frontT,
      // so the sector path cannot fight goalTurn or refuse a gate. Selection
      // stays ordinal on raw costs (a uniform scale would not change argmin).
      latErr = (.5 * (sideL - sideR) + .5 * (maxL - maxR)) * wallSuppress;
      // Center-out order + mirror neutralization: exact ties break toward the
      // center (centering response, #15/#40), and a fully mirror-symmetric argmin set
      // yields zero bias — symmetric input goes straight and explores via cast
      // pulses, mirroring the SNN saccade gate. Hysteresis still breaks symmetry
      // toward recent travel (lastF) once the set turns asymmetric.
      const costs = sec.map((v, i) => v + .25 * Math.abs(i - 3.5) / 3.5 + (Math.abs(i - st.lastF) > 2.5 ? .04 : 0));
      const minCost = Math.min(...costs);
      // Tie tolerance matches the symmetric epsilon (.02): real rendering noise
      // (~1e-3) must not break mirror neutralization the way 1e-9 did.
      const argmin = costs.map((c, i) => (c < minCost + 0.02 ? i : -1)).filter((i) => i >= 0);
      const mirrored = argmin.every((i) => argmin.includes(7 - i));
      const neutral = mirrored && !confined;
      let best = -1;
      if (!neutral) for (const i of [3, 4, 2, 5, 1, 6, 0, 7]) { if (argmin.includes(i)) { best = i; break; } }
      st.lastF = neutral ? 3.5 : best;
      freeBias = (neutral ? 0 : (best - 3.5) / 3.5) * wallSuppress;
    } else {
      latErr = leftT - rightT;
    }
    const frontGate = clamp((frontT - .15) * 2, 0, 1);
    // Anti-stall veer alternation: continuous saturated-symmetric blockage
    // (concave pocket / dead-end) flips the escape side every 120 steps so the
    // agent zigzags out instead of circling forever. Brief encounters (<120 steps),
    // goals, gate transits and asymmetric wall-following are untouched.
    // K24: odometry stalls (input.stalled) also alternate — wall-follow orbits
    // with real asymmetry never satisfied the symmetry clause above.
    const stuckSat = (s.stalled !== false && frontTRaw > .5 && Math.abs(latErr) < .08) || (frontTRaw > .75 && center > .75 && Math.abs(latErr) < .05) || !!s.stalled;
    if (stuckSat && goalVis < .05 && !verticalPassage) st.satN += st.satN > 121 ? .25 : 1; else st.satN = 0;
    // Near-symmetric input holds no escape side in the open (straight + cast
    // exploration, like the SNN saccade gate); confined keeps the decoder side
    // so pockets still veer. Sustained saturation alternates via satN above.
    const symmetric = Math.abs(latErr) < .02 && Math.abs(leftT - rightT) < .02;
    // Frontal tie-break (decoder parity): symmetric tie with a frontal wall
    // defaults right (+1, deadlock breaker); open ties hold straight (0).
    const escSide = st.satN > 120 ? (Math.floor(st.satN / 120) % 2 === 0 ? 1 : -1) : ((symmetric && !confined) ? 0 : (s.escapeDirection || ((s.frontRaw ?? s.frontThreat) > .5 ? 1 : 0)));
    // VFH valley transit: a passable flight-band gap replaces the deadlock
    // default with proportional valley-center steering (centered = straight).
    const valleyTransit = valley.found && !verticalPassage && frontT > .08;
    const latGuide = valleyTransit ? valley.centerErr : escSide;
    const latDamp = valleyTransit ? clamp(frontT * 2.5, .15, 1) : 1; // K15: hold the gap line — clear-center transit damps side veer (blocked center keeps full veer)
    const cornerLock = confined && !verticalPassage && !valleyTransit && center > .65;
    const effLatErr = cornerLock && latErr * latGuide < 0 ? latErr * .25 : latErr;
    const effFreeBias = cornerLock && freeBias * latGuide < 0 ? freeBias * .25 : freeBias;
    const avoidTurn = effLatErr * .90 * latDamp + (!verticalPassage && frontT > .08 ? latGuide * (valleyTransit ? Math.max(frontT, .3) : frontT) * (cornerLock ? .85 : .65) : 0) + effFreeBias * .55 * frontGate + cornerTurn;
    const effectiveBearing = goalVis > .025 ? (s.goalLockX || 0) * 1.15 + (s.goalBearing || 0) * .45 : (s.goalBearing || 0);
    const goalTurn = goalVis > .025 ? clamp(effectiveBearing * (goalCommitted ? 2.5 : 1.25), -1, 1) : 0;
    const tch = s.touch;
    const touchTurn = tch && tch.mag > .02 ? (tch.side >= 0 ? 1 : -1) * Math.min(1, tch.mag) : 0;
    const side = clamp(avoidTurn + goalTurn + touchTurn, -1, 1);
    // Deterministic casting (mirror of SNN saccadePulse): goalless + gateless +
    // avoidance-idle -> brief alternating pulses on a step-count clock (240 steps
    // = 4s period, 30 steps = .5s width at nominal 60Hz). Aborts the moment
    // avoidance wakes, since the gate re-evaluates pre-pulse side every step.
    // .3125 = saccadeTurn .05 and .625 = saccadeAmp .10 in side units (x.16).
    let out = side;
    if (goalVis < .05 && !verticalPassage && !valleyTransit && Math.abs(side) < .3125) {
      if (!vpHoldActive && st.castN % 240 < 30) out = clamp(side + (Math.floor(st.castN / 240) % 2 === 0 ? 1 : -1) * .625, -1, 1);
    }
    let climb = 0;
    // Landing approach (SNN parity): a steep-below goal from altitude dives
    // through an open top gate (descent to a floor goal past a behind-wall).
    const goalElevPre = goalElevEarly;
    // (steep-below landing dive subsumed by goalOverridesGate below)
    // SNN-parity stuck-climb trip: a top gate open past 1.2s with a FROZEN
    // visual world is a surface misread, not a passage — veto the gate for
    // vertical ownership (lateral suppression untouched) and latch the veto
    // for 2.5s so goal/restore/bottom paths take over. Any real motion
    // (center/up/down/altitude/loom progress) resets the timer: transit
    // never trips. Constants mirror SNN CONFIG (graph-network.js).
    const dtV = Number(s.dt) > 0 ? Number(s.dt) : 1 / 60;
    const loomT = Math.max(0, Number(s.loomingC) || 0);
    if (st.climbEscT >= 0) {
      st.climbEscT += dtV;
      if ((goalVis > .05 && goalElevPre > .2) || st.climbEscT > 2.5) { st.climbEscT = -1; st.climbTrapT = 0; }
    } else if (openTopGate) {
      if (st.climbTrapT <= 0) { st.climbTrapRef = center; st.climbTrapRefUp = s.upThreat; st.climbTrapRefDn = s.downThreat; st.climbTrapRefAlt = altIn; }
      st.climbTrapT += dtV;
      if (Math.abs(s.downThreat - st.climbTrapRefDn) > .05) st.climbTrapT = 0;
      else if (s.upThreat < st.climbTrapRefUp - .2) st.climbTrapT = 0;
      else if (Math.abs(center - st.climbTrapRef) > .2) st.climbTrapT = 0;
      else if (loomT > .12) st.climbTrapT = 0;
      else if (Number.isFinite(altIn) && Number.isFinite(st.climbTrapRefAlt) && Math.abs(altIn - st.climbTrapRefAlt) > .01) st.climbTrapT = 0;
      if (st.climbTrapT > 1.2) st.climbEscT = 0;
    } else st.climbTrapT = Math.max(0, st.climbTrapT - dtV * 2);
    const effTopGate = openTopGate && st.climbEscT < 0;
    // Weak-conflict goal override (SNN parity): a clearly below/above goal
    // beats the gate branch when the avoidance reason on the goal side is
    // weak; strong blocking keeps avoidance priority (never dive into a wall
    // for a beacon). Subsumes the steep-below landing dive.
    const goalOverridesGate = goalVis > .05 && ((goalElevPre < -.03 && effTopGate && !openBottomGate && (lowerMixed < .6 || (goalElevPre < -.25 && altIn > .05))) || (goalElevPre > .03 && openBottomGate && !effTopGate && upperMixed < .6)); // .6 bar (SNN parity): below-obstacle targets read ~.52
    if ((goalVis > .05 && !effTopGate && !openBottomGate) || goalOverridesGate) {
      const elev = goalElevPre;
      climb = clamp(elev / .65, -.90, .90);
    } else if (effTopGate) climb = .85 * (.35 + .65 * Math.min(1, center / .6)); // graduated by wall urgency (SNN parity; K11 TTC reverted by K18: far commitment removed)
    else if (openBottomGate) climb = -.85;
    // Frontal looming-rate pre-climb (A): mirror of the SNN drive, gated toward
    // the opener side only (upper clearer than lower by the gate delta); goal
    // tracking, landing dives, bottom openings and flat walls stay exempt so
    // gate logic (not pre-climb) decides those.
    const loomC = Math.max(0, Number(s.loomingC) || 0);
    if (loomC > 0 && center > .35 && !valley.found && !openBottomGate && (goalVis <= .05 || openTopGate) && upper < .35) climb = clamp(climb + loomC * 1.4, -.9, .9); // K19R: pre-climb needs verified open above, like the gate
    if (cornerClimb !== 0) climb = clamp(climb + cornerClimb, -.9, .9);
    if (st.climbEscT >= 0 && climb > 0) climb = 0; // latched trip zeroes residual climb (SNN parity: trap zeroes climbSignal, dives flow)
    if (climb > 0 && Number.isFinite(altIn)) climb *= clamp((WORLD.Y - altIn) / .06, 0, 1); // K17: headroom grades climb magnitude (was binary .16 cutoff into the ceiling)
    // Cruise-altitude restoration (SNN parity): high + open + goalless +
    // gateless sinks gently back to mission altitude (.02).
    if (!effTopGate && !openBottomGate && goalVis < .05 && ((frontT < .3 && loomC <= 0) || altIn > .115) && Number.isFinite(altIn)) {
      climb = clamp(climb + clamp((.08 - altIn) * 10, -.6, .6), -.9, .9);
    }
    if (blindDive) climb = Math.min(climb, -1); // F-G5: sustain the latched landing dive at full authority (SNN parity: -.9 can't make the glide after lip-graze stuns; floor softening below still applies)
    if (false) { // V1.6: K25b ceiling override + K26a latch retired (kept block shape; never taken)
      climb = clamp(climb - .15, -.9, .9);
    }
    // Floor dive softening (SNN parity): at the floor guard, dives press the
    // agent into the ground and chatter on the touch reflex — the capture-zone
    // servo handles touchdown, so hold a soft sink instead.
    if (Number.isFinite(altIn) && altIn <= .03 && climb < -.15) climb = -.15;
    const slowForGoal = (goalVis > .15 && (Math.abs(s.goalLockX || 0) > .18 || Math.abs(s.goalVertical || 0) > .15)) || goalVis > .5; // near goal always slows (SNN parity: approach-speed overshoot guard)
    const approachCap = (GOAL_APPROACH_SLOW && goalBelow && frontClear && diveClear) ? Math.max(.25, .58 - Math.max(0, goalVis - .15) * .5) : .58;
    // Proportional slowdown: matches reference .72 at frontT=.5, grades to .5 at contact.
    // Turn radius shrinks linearly with speed (11cm -> 5cm), which corridors require.
    const cruiseBase = 1 - .5 * clamp(frontT, 0, 1);
    const base = valleyTransit ? Math.min(cruiseBase, .6) : cruiseBase; // gap-transit slowdown (aperture approach)
    return { turn: out * .16 * (blindDive ? .25 : 1), climb, speedMultiplier: (slowForGoal || blindDive) ? Math.min(base, blindDive ? .25 : approachCap) : base, threat: Math.max(frontT, leftT, rightT), telemetry: [] }; // blind dive holds heading: symmetric-corridor esc veer would random-walk it off the goal line (frontal walls cancel blind first, so this is safe)
  }
  function reset() { st.lastF = 3.5; st.castN = 0; st.satN = 0; st.lowerBase = null; st.openTopHold = false; st.openTopHoldT = 0; st.climbTrapT = 0; st.climbEscT = -1; st.climbTrapRef = null; st.climbTrapRefUp = null; st.climbTrapRefDn = null; st.climbTrapRefAlt = null; st.vpHold = 0; st.lipLatchT = 0; st.goalDiveT = 0; }
  return { step, reset };
}
