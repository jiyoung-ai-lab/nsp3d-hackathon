// NSP 3D — obstacle motion (deterministic sinusoidal drift around a home position).
// API mirrors the reference asset: applyObstacleMotion(world, time, enabled).
// Absolute positioning (not incremental) so the same time always yields the same pose.
export function applyObstacleMotion(world, time, enabled) {
  for (const o of world || []) {
    if (!o.home || !o.motion) continue;
    const { axis = 'x', amplitude = 0, frequency = 0, phase = 0 } = o.motion;
    if (!enabled || !amplitude || !frequency) {
      o.x = o.home.x; o.y = o.home.y; o.z = o.home.z;
      continue;
    }
    const offset = amplitude * Math.sin(2 * Math.PI * frequency * time + phase);
    o.x = o.home.x; o.y = o.home.y; o.z = o.home.z;
    if (axis === 'y') o.y += offset;
    else if (axis === 'z') o.z += offset;
    else o.x += offset;
  }
}
