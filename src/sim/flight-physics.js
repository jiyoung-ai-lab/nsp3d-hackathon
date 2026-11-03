// NSP 3D — flight-physics.js (ESM port of reference/flight-physics.js)
export const collisionTurnDirection = (nx, nz, yaw, escapeDirection) => {
  const lateral = nx * Math.cos(yaw) + nz * Math.sin(yaw);
  if (Math.abs(lateral) > .08) return Math.sign(lateral);
  return Number(escapeDirection) < 0 ? -1 : 1;
};
export const pointSegmentDistance = (point, start, end) => {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z, lengthSq = dx * dx + dy * dy + dz * dz;
  const t = lengthSq > 1e-12 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / lengthSq)) : 0;
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t), point.z - (start.z + dz * t));
};
export const goalReachedDuringStep = (goal, start, end, radius) => Math.hypot(end.x - goal.x, end.y - goal.y, end.z - goal.z) <= radius || pointSegmentDistance(goal, start, end) <= radius;
// Mechanosensory touch event (B-reflex): contact-normal side + impact-graded magnitude.
// Side follows collisionTurnDirection semantics (+1 = veer right/away-from-left),
// matching the SNN/rule turn sign. Clean-room touch reflex.
export const touchFromContact = (nx, nz, yaw, escapeDirection, speedRatio) => ({
  side: collisionTurnDirection(nx, nz, yaw, escapeDirection),
  mag: Math.max(.3, Math.min(1, Number(speedRatio) || 0)),
});
// Corner-grind fix (b): stun holds position instead of grinding forward at .24x.
// During the .38s stun the brain rotates via the touch reflex while the body
// hovers; recoil still pushes out. false restores the V1.6 forward grind.
export const STUN_HOLD = true;
export const stunSpeedScale = (stunned) => (stunned ? (STUN_HOLD ? 0 : .24) : 1);
// Corner-grind fix (c): sustained contact alternates between two corner faces,
// flipping touch side every step and cancelling the brain's turn. Latch the
// first side until contact breaks (next edge re-latches). false restores
// per-step side tracking.
export const LATCH_TOUCH_SIDE = true;
export const resolveTouchSide = (latched, fresh, isNewEdge) => {
  if (!LATCH_TOUCH_SIDE || isNewEdge) return fresh;
  return (latched === 1 || latched === -1) ? latched : fresh;
};
// Caller-side reflex decay (~120ms tau, saccade-scale); null when faded.
export const decayTouch = (touch, dt, tau = .12) => {
  if (!touch || !(touch.mag > .02)) return null;
  const mag = touch.mag * Math.exp(-Math.max(0, Number(dt) || 0) / tau);
  return mag > .02 ? { side: touch.side >= 0 ? 1 : -1, mag } : null;
};
// Sustained-contact withdrawal (unwedge): bump-rate EMA with 3s half-life.
// Brief brushes stay below threshold; grinding (>~4 recent bumps) reverses.
export const UNWEDGE_HALF_LIFE = 3, UNWEDGE_BUMPS = 4, UNWEDGE_REVERSE = -.5;
export const stepBumpEma = (prev, bumped, dt) =>
  (prev || 0) * Math.pow(.5, Math.max(0, Number(dt) || 0) / UNWEDGE_HALF_LIFE) + (bumped ? 1 : 0);
export const isUnwedging = (ema) => (ema || 0) > UNWEDGE_BUMPS;
// Stall gate: 10s-window straightness = net displacement / path length
// (path-integration-flavored self-motion estimate). Stuck flies still jitter
// centimeters per window, so displacement alone can't gate anything; milling
// has long path with ~zero net, threading stays near 1. The long window lets
// slow squeezes (steady if slow progress) through while catching true mills.
// Withdrawal needs both.
export const ODO_WINDOW = 10, ODO_STRAIGHT = .25;
export const stepOdometry = (odo, pos, dt) => {
  if (!odo) return { sx: pos.x, sy: pos.y, sz: pos.z, px: pos.x, py: pos.y, pz: pos.z, t: 0, path: 0, straight: 1 };
  const step = Math.hypot(pos.x - odo.px, pos.y - odo.py, pos.z - odo.pz);
  const t = odo.t + Math.max(0, Number(dt) || 0);
  const path = odo.path + step;
  if (t < ODO_WINDOW) return { ...odo, px: pos.x, py: pos.y, pz: pos.z, t, path };
  const net = Math.hypot(pos.x - odo.sx, pos.y - odo.sy, pos.z - odo.sz);
  return { sx: pos.x, sy: pos.y, sz: pos.z, px: pos.x, py: pos.y, pz: pos.z, t: 0, path: 0,
    straight: path > 1e-9 ? net / path : 0 };
};
export const isStalled = (odo) => (odo && odo.straight !== undefined ? odo.straight : 1) < ODO_STRAIGHT;
// Eye-camera chamber clamp (a): the 7mm head-ahead eyeOffset pushes the eye
// past the 1mm liner when the body presses a side wall head-on (body stops
// 6.5mm out, liner inner face 1.7mm in) → black frame + zero threat on all
// sensors. 3mm margin keeps the eye inside the liner faces with room past the
// 1mm near plane, so contact frames read the wall (threat 1) instead of void.
export const EYE_CHAMBER_MARGIN = 0.003;
export const clampEyeToChamber = (p, dims, margin = EYE_CHAMBER_MARGIN) => ({
  x: Math.max(-dims.W / 2 + margin, Math.min(dims.W / 2 - margin, p.x)),
  y: Math.max(margin, Math.min(dims.Y - margin, p.y)),
  z: Math.max(-dims.Z / 2 + margin, Math.min(dims.Z / 2 - margin, p.z)),
});
