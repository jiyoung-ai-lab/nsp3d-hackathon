# Sample-Adoption Design Notes (DESIGN_NOTES.md)

> Each decision below records the judgment call made during adoption.

## 1. Adoption scope decisions

- Adopted: 5 maze geometries, hazard pools, the fruit fly, I18N + lighting, both lab pages.
- Not adopted: the sample's own `runStep`/physics/controllers (ours kept — camera→neuron→behavior principle).
- The sample's stale root duplicates were ignored after hash confirmation.

## 2. Lighting / visual parity notes

- Sample lighting numbers were kept verbatim, but the r160 pipeline renders them differently:
  the fly camera sees only the unlit Basic-material Layer-3 shell, so perception is invariant (verified).
- Observer screen: same numbers ≠ same image — r160 applies sRGB output encoding, so identical
  hex/intensity can render brighter than the sample. `outputColorSpace` changes deferred
  (whole-screen impact — decide after eyeball comparison).
- PointLight decay change (physical decay): `beeHeadLight` (neon 2.2) gloss curves
  may differ from the sample. Observer-only, no functional impact.

## 4. Shim structure (new file)

- `../src/ui/sample-shim.js`: `setupSampleGlobals()` exposes ESM modules as the globals
  the sample pages expect (`THREE`, deep-copied `REFERENCE_MAZE_LAYOUTS`,
  `createCameraVisionDecoder`, `__nspFlipSrgb`).
- `../pages/path-planner.html`, `../pages/maze-editor.html` inline logic is verbatim. Module
  scripts run in document order, so bootstrap→inline order is guaranteed.
- `maze-hazards.js` / `flight-physics.js` loaded by the planner are confirmed unused inline
  → omitted from the port.

## 8. Declared principle exceptions + sensory alignment (2026-10-28)

4 declared exceptions to the camera→neuron→behavior principle (explicit design, not bypasses):

- z_depth shader world-Y bands (`sim-core.js` Y≤0.0045 / Y≥0.1955):
  kept as hardware priors (floor/ceiling masking). After color unification every sensor
  treats the shell identically, so the net effect is sensor-uniform.
- movement altitude guards (ceiling Y-.035 / floor .020): physics safety clamps.
  They do not touch visual input; they only prevent sticking.
- unwedge reverse (odometry straightness + bump EMA → -.5): proprioceptive exception.
  World-displacement based, so strictly privileged information — consider visual stall detection later.
- Landing capture (`sim-core.js` 45mm capture zone / 11mm snap): goal-true-position servo + snap.
  Pulls without collision re-check, so it affects near-goal success — re-check after flight verification.

Sensory alignment:

- Sensitivity /10 unified: display, runStep, bench, and path-planner defaults all 1.0.
- ALIF plugin sync: climb/dive gain keys, single synaptic current, washout 0.05.
- Shell 6-face diagnostic color (0x12344d) unified: fusion ceiling contamination resolved.
