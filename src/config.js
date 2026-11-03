// NSP 3D — central runtime paths & keys. No other module hardcodes data paths.
// Page-relative defaults (fetch() resolves against the document); override via
// URL query (?graphBase=…&graphExt=…&gains=…) for experiments.
export const PATHS = {
  connectomeBase: './vendor/connectome/flight-graph.js',
  connectomeExt: './vendor/connectome/flight-circuit-extension.js',
  gains: './data/pretrained-gains.json',
};
export const STORE_KEYS = {
  customMazes: 'nsp_custom_mazes_v1',
  lang: 'nsp_lang',
};
// World geometry (reference/app.js: W=1, Z=1, Y=.20, BEE_RADIUS=.0055).
export const WORLD = Object.freeze({ W: 1, Z: 1, Y: 0.20, beeRadius: 0.0055 });
// Short human-readable build tag for tab titles. Bump on every generation
// (matches BUILD .12+k17-headroom-recoil); module stamps stay detailed.
export const NSP3D_VERSION = 'NSP3D_V1.6';
// Agent vision pipeline (reference/app.js CAMERA_PIPELINE).
export const CAMERA_PIPELINE = Object.freeze({
  frameWidth: 320, frameHeight: 180, fov: 100, near: 0.001, far: 2.0,
  binocularFov: 115, binocularAspect: 1.35, binocularCantRad: 0.488692,
  binocularFrontalRad: 25 * Math.PI / 180, // frontal binocular half-field (conservative ±25° bound from #47 measurements)
  eyeBaseline: 0.0036, fogNear: 0.015, fogFar: 0.34,
  updateIntervalMs: 100, eyeOffset: 0.007, lookAhead: 0.35, pitchGain: 0, // gaze stabilization: eye stays level so walls don't slide into D/U zones when pitching
});
// Default RNG seed from the local calendar date (YYYYMMDD). These are static
// pages with no server clock, so the browser date is the effective server date.
export function dateSeed(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
export function resolvePaths() {
  try {
    const q = new URLSearchParams(location.search);
    return {
      connectomeBase: q.get('graphBase') || PATHS.connectomeBase,
      connectomeExt: q.get('graphExt') || PATHS.connectomeExt,
      gains: q.get('gains') || PATHS.gains,
    };
  } catch (e) { return { ...PATHS }; }
}
