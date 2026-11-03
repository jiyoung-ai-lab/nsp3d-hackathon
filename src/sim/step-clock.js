// NSP 3D — fixed-step accumulator (pure, deterministic).
// The live loop renders at wall-clock rAF rate but integrates the sim at a fixed
// step h, so identical episodes produce identical trajectories regardless of fps
// or observer view. Spiral-of-death guard: at most maxSteps per frame; excess
// time is dropped (counted) instead of compounding.
export const SIM_STEP_H = 1 / 60;
export const SIM_MAX_STEPS = 5;
export function consumeSteps(acc, frameDt, h = SIM_STEP_H, maxSteps = SIM_MAX_STEPS) {
  let a = Math.max(0, acc + Math.max(0, frameDt));
  let steps = 0;
  while (a >= h && steps < maxSteps) { a -= h; steps++; }
  let dropped = 0;
  if (a >= h) { dropped = Math.floor(a / h); a -= dropped * h; }
  return { steps, acc: a, dropped };
}
