# Third-Party Notices — NSP 3D

## Connectome data (CC BY 4.0)
- Male CNS Connectome `male-cns:v1.0`, neuPrint (https://neuprint.janelia.org/),
  download https://male-cns.janelia.org/download/
- Attribution: FlyEM Project Team, Male CNS Connectome, v1.0
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Used files (vendored, loaded at runtime from `../vendor/connectome/`):
  `flight-graph.js` (derived subset, 96 nodes),
  `flight-circuit-extension.js` (1,846 nodes / 3,104 filtered edges)
- `synapse_sign_inferred: false` — anatomical counts do not establish
  excitatory/inhibitory sign, visual field position, or behavior.
- Raw per-file totals sum to 1,942 nodes (96 + 1,846); 88 ids overlap
  between the two subsets, so the merged runtime graph holds 1,854 unique nodes.

## Pre-existing own assets (disclosed, not evaluation target)
- `reference/index.html` + `reference/style.css` (author's local set, not
  shipped) — UI layout/style referenced by `../index.html` + `../assets/style.css`
- `graph-network.js` logic — LIF flight controller ported into
  `../src/nn/graph-network.js` (Module A/B, reinforcement, readout)
- `reference/asset/3d_4.html` fly studio + `bee_character_3d_wing100.obj` —
  superseded; `../src/ui/hand-drawn-bee.js` is now an ESM port of
  `reference/samplesource/assets/hand-drawn-bee.js` (same studio geometry,
  no OBJ loader)
- `reference/asset/flymind_3d_1m_1m_0_20m_20cm_11.html` — sample UI (not reused)

## Sample studio sources (user-provided, take precedence; registry #33–#38)
- `reference/samplesource/assets/maze-layouts.js` + `maze-hazards.js` —
  5 maze geometries + hazard pools ported (array→object) into
  `../src/sim/maze-layouts.js` alongside the 5 pre-existing mazes
- `reference/samplesource/assets/hand-drawn-bee.js` — fly character ported into
  `../src/ui/hand-drawn-bee.js` (THREE injected, behavior identical)
- `reference/samplesource/app.js` I18N + lighting presets + status/format
  functions — strings/values adopted in `../src/ui/i18n.js`, `../src/ui/app.js`,
  `../index.html` (key names mapped to our convention)
- `reference/samplesource/path-planner.html` — revived verbatim as
  `../pages/path-planner.html` via `../src/ui/sample-shim.js` (+1 sRGB flip line
  for three r160 linear readback, +1 vision-lab cross-link)
- `reference/samplesource/maze-editor.html` — replaces `../pages/maze-editor.html`
  verbatim via `../src/ui/sample-shim.js` (prior own editor removed)
- `reference/samplesource/style.css` + wall/glass/frame colors — verified
  against `../assets/style.css` (already matching) and adopted in
  `../src/sim/sim-core.js` (observer layer only; vision Layer-3 untouched)

## Libraries
- Three.js r160 — MIT License (https://threejs.org), loaded via CDN with pinned version
