# Muse Spark Usage Record (MUSE_SPARK_USAGE.md) — NSP_3D

## 1. Purpose and scope

- Purpose of this record: document what Meta AI built, assisted, or reviewed in this project, and where the evidence lives (files/specs/tests).
- Method: read-only investigation. Opened `docs/*.md`, the clean-room reference `reference/functional_specification_for_meta.md`, core sources (`src/vision`, `src/nn`, `src/sim`, `src/ui`), `index.html`, `pages/*.html`, and all tests; no implementation edits.
- Related: `CITATIONS.md` (#1–#51 + §9 #54–#58), `NSP_3D_MERGED_SPEC_v2.md`, `PRE_HACKATHON_SOURCE_REVIEW.md`.
- Claim basis notation: each statement below carries the evidence file in code ticks. Items not verified are explicitly marked unknown in §4.

## 2. AI-built / AI-assisted deliverables

### 2.1 Cameras and sensors (`src/vision/`, `src/config.js`)

- Per-pixel 4-mode sensor evaluation `evaluateSensorPixel` (`fog_rgb`, `z_depth`, `optical_flow`, `sensor_fusion`) + 8-col equiangular partition + 32-cell single partition (zones/sectors/3×3 as weighted views over 32 cells), facing-both-sides uniform-grid overlay, row convention `arow 0 = image bottom` pinned by tests — `src/vision/camera-vision.js`
- 8-sector split, freest-sector steering, unilateral-max gradient (FOAM/LORA III concepts, clean-room) — `src/vision/camera-vision.js`, `src/sim/camera-controller.js`
- Binocular `rayAngle` mapping (±28° cant crossover fix), peripheral squash, frontal overlap (`binocularFrontalRad` ±25°, #47), disparity (`binocularDisparity`), symmetric corridor subtraction (`symmetricWallBaseline`), expansion tracker (`createExpansionTracker`), frontal L/R convergence (`frontalConverge` = geometric mean, #23), nasal/contrast signals — `src/vision/camera-vision.js`
- 115° VFOV vertical correction (`VFOV_TAN_RATIO`), LUT-corrected preview masks (`pixelMask`), peripheral motion parallax (`motionL`/`motionR`), adaptive frontal sensitivity (`frontalSensitivity`), saccade/goal capture guards — `src/vision/camera-vision.js`
- Threshold policy: external-wall diagnostic color `0x12344d` discrimination box, `fogNear`/`fogFar` 0.015/0.34, `updateIntervalMs` 100, gaze `pitchGain` — `src/config.js`, `src/vision/camera-vision.js`

### 2.2 Neural controllers (`src/nn/graph-network.js`)

- Role split: Muse Spark (`muse-spark-1.3-contributor`, CLI) for code; log analysis via Baseten `meta-models/muse-spark-open-1026` (see `META_AI_USAGE.md`).
- Meta AI deliverables below span modules/sensors/the fruit fly/UI/P0 fixes/tests — every borrowed point carries a CITATIONS # tag.
- [MODULE A] `createMonocularConnectome` / [MODULE B] `createBinocularConnectome` fully independent
  (membrane potentials, eligibility traces, sensory projections, 4-way learned readouts `gains.monocular`/`gains.binocular` separated),
  facade `createFlightConnectome` — `src/nn/graph-network.js`
- 3-Factor R-STDP + online teacher (DAgger) `applyReinforcement`, vertical-trap habituation `applyVerticalTrap`
  (stall-detection sticky escape latch), search casting `saccadePulse`, bilateral normalization `bilateralLoad` (mean, threshold 0.5),
  contact-side DN-pool touch reflex (#25; former #18 removed 2026-10-31) — `src/nn/graph-network.js`
- Detachable ALIF + Fast-Sigmoid surrogate gradients + collision-index/ε search plugin (LIF fallback on removal, loose coupling) —
  `src/vision/alif-surrogate-plugin.js` (`ALIFSurrogatePlugin` v1.1)
- Anatomy data: `vendor/connectome/flight-graph.js` (96-node subset) + `flight-circuit-extension.js`
  (1,846 nodes / 3,104 edges), Male CNS v1.0 CC BY 4.0, `synapse_sign_inferred: false` — CITATIONS #1·#2·#22

### 2.3 Simulation / physics (`src/sim/`, `src/lab/astar.js`)

- World gen `makeWorld` (seed-fixed RNG `rng`, `sealMazeWalls` sealing, hazard pools) + static scene
  `buildStaticScene` (layer-split meshes, goal beacon, lights) — `src/sim/sim-core.js`
- `movement`: stun/evade timers, ceiling/floor safety guards, collisions reported only as graded touch events with
  turning delegated to the brain (kinematic yaw kick removed), bump EMA + odometry stall-gated reverse escape —
  `src/sim/sim-core.js`
- Contact physics helpers: `collisionTurnDirection`, `touchFromContact`/`decayTouch` (τ≈120ms),
  `stepBumpEma`/`isUnwedging`, 10s-window straightness `stepOdometry`/`isStalled` — `src/sim/flight-physics.js`
- Design deviations justified in comments: `PITCH_RESPONSE` 0.72 (41°)→0.30 (17°) relaxed (sector parity kept),
  `bilateralLoad` mean normalization (raw sums 17~32 always-saturated fixed) — `src/sim/sim-core.js`, `src/nn/graph-network.js`
- 10 mazes (`MAZES`: 5 base + 5 sample stages verbatim-converted), `sealMazeWalls` (outer snap, corner seal),
  reference↔custom bridge (`referenceToCustomMaze`) — `src/sim/maze-layouts.js`
- Fixed-step integrator (`consumeSteps`, `SIM_STEP_H`), obstacle motion (`obstacle-motion.js`), voxel A* baseline (`lab/astar.js`)

### 2.4 UI / pages (`index.html`, `src/ui/`, `pages/`)

- `index.html` (lang=ko): importmap `three@0.160.0` pinned (CITATIONS #3), mono/bino + 4-sensor tabs,
  always-on fly POV preview (`visionFeed`), control/experiment anchors — `index.html`
- Main app: EyeRig wiring, `runStep` (sense→rule/network→movement), 4 views (follow/overview/closeup/top)
  + zoom/drag/pinch, 3 lightings (default/studio/neon), benchmark runner, trail/shadow/HUD —
  `src/ui/app.js` (600+ lines, pipeline comments stated)
- KO/EN shared dictionary (strings verbatim, keys mapped to convention) — `src/ui/i18n.js` (CITATIONS #35)
- Procedural fruit fly (striped body, heartWings, compound eyes, impact FX, `wingScale` injected, OBJLoader removed) —
  `src/ui/hand-drawn-bee.js` (CITATIONS #6·#13·#34)
- 4-sensor parallel runs + A* baseline benchmark lab (shared modules reused, staggered POV capture) —
  `pages/path-planner.html` (CITATIONS #36)
- Maze design studio (reference-format IO) —
  `pages/maze-editor.html` (CITATIONS #37)

### 2.5 Tests / docs (`tests/`, `docs/`)

- Maintained suite: maze sealing, A*, physics, decoder, rules, fixed step, ALIF, circuits — `tests/run.mjs`
  (`node --test`, 31/31 recorded in reports, 71 blocks now (statically confirmed) — run unverified)
- Camera-pipeline integration check: 49 source invariants (DPR, layers, no-oracle, single-source, …) + synthetic-frame
  decoding + range-attenuation grades + goal lock + open-space level flight — `tests/verify-camera-pipeline.mjs`
- Flight-circuit behavior contract: camera→visual-neuron→DNp06→VNC motor chain, left/right/frontal avoidance, vertical climb/dive with
  gain updates, 10-maze/fly-model/module existence checks — `tests/verify-flight-circuit.mjs`
- Headless browser checks (Playwright, 25 checks: view switch, drag, flight sampling, forced ceiling/wall approach, altitude
  clamp, gain range, finite firing rates, no errors) — `tests/verify.browser.mjs`
- 3 doc kinds: citation registry (#1–#51 + §9 #54–#58) `CITATIONS.md`, merged spec `NSP_3D_MERGED_SPEC_v2.md`,
  old/new split `PRE_HACKATHON_SOURCE_REVIEW.md`,
  clean-room reference `reference/functional_specification_for_meta.md` (CITATIONS #7)

## 3. AI-assisted workflow (review-first, audit-driven loops)

- **Review-first (split before build)**: before hackathon work, `PRE_HACKATHON_SOURCE_REVIEW.md` declared the split between
  FlyMind 2D existing assets / pre-arranged data (neuPrint lookups) and hackathon-new builds (100% new 3D wiring code),
  and implementation started only after registering every external/own citation's location and changes under the
  `CITATIONS.md` policy (pinned versions, license notices, `synapse_sign_inferred: false` propagation, own pre-existing marking).
- **Spec-driven staged generation**: the merged 4-stage Meta AI prompts in `NSP_3D_MERGED_SPEC_v2.md` §9
  (stage 1 env/maze/camera → stage 2 ALIF+fruit fly → stage 3 main simulator → stage 4 sub-studios)
  govern generation order, each stage mapped to MVP FRs (P0/P1/P2) and the 7-bug checklist.
  The source reference is `reference/functional_specification_for_meta.md` (formulas/shaders/physics for clean-room reimplementation).
- **Audit-driven loops (measure→fix→verify)**: measured facts (floor-trap mechanism fixed,
  constant threat saturation, pitch-coupling distortion, …) → code changes (stall-detection escape latch, pitch relaxation, bilateral normalization,
  casting pulses) → verification (`probeG` 2.5s landing, `pillars` 11.6s end-to-end, all regression gates green).
  Current fix state: `CHANGELOG.md` (K-fix index); behavior contracts: `tests/` verifiers.
- **Regression gates as done-conditions**: `tests/run.mjs` (31/31), `tests/verify.browser.mjs` (25/25),
  and 2 verifiers PASS are recorded green in the reports, and the verify scripts pin source invariants
  (single source, no oracle leaks, layer/DPR rules) as asserts — not just behavior checks — blocking AI-code drift.
- **Clean-room citation hygiene**: ~20 literature/OSS citations (CITATIONS #14–#21, #39–#51) are mostly `consulted` (concepts only,
  no code copied), and applied ones (#15 symmetric neutral, touch reflex, #25 contralateral inhibition, #39/#41 sector steering,
  #42 looming, #47 ±25° overlap) are traceable via `#number` tags in the corresponding code comments.

## 4. Scope notice (evidenced vs unknown)

- **Evidenced (directly opened in this read-only investigation)**: all §2 sources above (headers, comments, key functions),
  4 full `docs/*.md` texts, `reference/functional_specification_for_meta.md` (head through sensor formulas),
  all 4 `tests/` texts, `index.html` + 2 `pages/` (heads + core logic). The model role split and 4-stage prompt scheme are
  confirmed in spec sentences, and the deliverables' structure (module splits, comments, tests) matches that scheme.
- **Unknown (honest limits)**:
  1. No git history checked — `.git` logs were unreachable (shell failures, no log files),
     so per-commit AI/human attribution is not claimed.
  2. No prompt originals/session logs — the repo holds no actual conversation records, so the 4-stage prompts
     are evidenced only up to the §9 quoted summaries.
  3. No runs executed — this investigation only read statically and ran no tests, so pass counts
     (31/31, 25/25, …) quote the session records as of 2026-10-28 (current suite: 176 pass / 9 skip).
  4. No per-line authorship — "built with AI assistance" at file/function level rests on the spec's role split
     matching the deliverable structure; individual lines' authors are not asserted.

## 5. Evidence file list (relative paths)

- `docs/CITATIONS.md`, `docs/NSP_3D_MERGED_SPEC_v2.md`,
  `docs/PRE_HACKATHON_SOURCE_REVIEW.md`
- `reference/functional_specification_for_meta.md` (author's local set, outside the repo)
- `src/vision/camera-vision.js`, `src/vision/alif-surrogate-plugin.js`
- `src/nn/graph-network.js`, `src/config.js`
- `src/sim/sim-core.js`, `src/sim/camera-controller.js`,
  `src/sim/flight-physics.js`, `src/sim/maze-layouts.js`
- `src/ui/app.js`, `src/ui/i18n.js`, `src/ui/hand-drawn-bee.js`
- `index.html`, `pages/path-planner.html`, `pages/maze-editor.html`
- `tests/run.mjs`, `tests/verify-camera-pipeline.mjs`,
  `tests/verify-flight-circuit.mjs`, `tests/verify.browser.mjs`

## 6. Verification/improvement history (2026-10-28, Muse Spark assisted)

- Full inspection: 5 areas + SNN deep-dive + synthesis (P0 ×3, 14-chain avoidance failures, 12 partial applications, 2 misjudgments corrected).
- Staged fixes 0–6 + R2 (gate hysteresis, goal priority, NaN guard): all test-first FAIL→PASS,
  `run.mjs` 70→80, 2 verifiers PASS.
- Measurement-based calls recorded: mono normalization untouched (measured balance), frontal relaxation attempted then rolled back (saturation invariant),
  saccade/bias misjudgments corrected. Deferred items (frontal structure, escape/stall, …) pending post-verification review.

## 7. Saturation-100% debugging session (2026-10-28, Muse Spark assisted)

- Symptoms: all-direction threat ~100 + floor crawling + low flight + bino open-top failure + mono lip-stuck/no-dive.
- Muse Spark work: 16-kind matrix, zone probes, backup 3-way cross-check, static-pose A/B to pin the phantom root
  (P0 `0x12344d`+`fog:false` with the LUT red cliff → `blueWall` uniform 0.40 phantom).
- Staged fixes after approval: box reassignment → user's 4 items (floor/ceiling `0x060914` split etc., §8) →
  (b) freeze-only rearm + ALT-1 altitude-progress reset (§9). `run.mjs` 81/81 + 2 verifiers PASS held.
- Geometry verdicts (analytic projection proofs): eye-body pitch 100% coupling tilt-slip, vertical-gate catch-22,
  threat-curve (ii) saturation, (i) dead (floor guard 20mm > 12mm threshold).
- Outer-wall survey: liner `0x1678ff`+fog reality, perception range `fogFar` 34cm, same-material-as-inner-walls issue fixed.
  Magenta liner option approved then cancelled on user STOP → simplified 6 directives (fixed palette, cross-sensor static equivalence, …).

- Run verification done via direct in-session `node` runs (user-side re-runs covered flaky shell-runner gaps).
- (2a) 8×4 equiangular grid: Muse Spark rewrote the decoder mono/bino cores + preview/grid measured alignment + partition proof tests.
  The pre-existing routing tests caught an inverted row convention → fixed. `run.mjs` 86/86 + 2 verifiers PASS confirmed.
- (2b) Diagonal escape: Muse Spark designed rule/SNN (mono+bino) corner vectors + symmetric-cancellation proof tests.
  Scale-turn (×.16) and readout saturation handled inside the test frames' linear zone. `run.mjs` 88/88 + 2 verifiers PASS confirmed.
- 16-kind matrix A/B: puppeteer+SwiftShader served the live code for direct measurement, before/after table written (saturation 1.00→0.3s, frontal gradient restored).
- Unit-test follow-ups: dead-end avoidance failure traced to refractory-ceiling collapse, contralateral inhibition (×.45) + default escape side designed + proof tests. `run.mjs` 89/89 + 2 verifiers PASS confirmed.
- Center-subdivision + vertical-raw: fused-center subdivision (12.5°×4 + 34°×2) design + ray-exact strip proof, vertical raw .7125 pin. `run.mjs` 91/91 + 2 verifiers PASS confirmed.

## 8. v5 flight patch + ALIF + Ax batch loop (2026-10-30/31, Muse Spark assisted)

- External reference review: v5 fixed-fly patch diffed against ours (flight JS only, UI excluded);
  selective apply (Tier0 rayAngle<0 + cScale .74, Tier1 5-site @.22) measured first, then full apply
  on user decision. Rollback rule apply→review→confirm; final diff documented keeps-only.
  Details in internal patch report (not shipped); suite 176/0/9 at lock.
- ALIF engine-2 defect: external Dead-Adaptation report cross-checked (Muse Spark + BA consult),
  fixed per recommendation (immediate reset + /0.85 normalize), learning flag kept OFF.
  New `tests/verify-alif-adapt.mjs` PASS (failed pre-fix); suite 176/0/9 held.
- Batch/Ax system: full matrix runner headless (browser-required pages only), local Ax loop
  (`python/ax_loop.py`, `ax-platform` 1.3.1, multi-objective success↑/collisions↓) + trial bridge
  (`python/trial.cjs`); experiment page `?learning=`/`?sens=`/`?cruise=`/`?maxt=` controls.
  First study `multi0` (12 trials) finished 0 failures. Ax is local compute, 0 API tokens.
- 48-combo matrix campaign: rule/LIF/ALIF × mono/bino × 4 sensors × corridor/multi
  generated (cfg39–cfg86, groups g11–g22), 10 runs/seed-fixed; smoke + seed-stability checks green,
  chunk runs in background at time of writing.
- Citation/inventorship hygiene: CITATIONS DOI corrections (#25/#27/#55/#56), Bender #18 deleted
  per user (tombstone, no renumber); presentation KR disputes D1–D5 + intl F1–F4 audited
  (Muse Spark + BA consults) and fixed in the master doc.
- Honeybee rebrand: fruit-fly character references replaced (POV names, README title, emoji);
  compound-eye optics + connectome terms kept.

## 9. Model and channel summary (judging reference)

| Model | Channel | Purpose | Usage (confirmed) |
|---|---|---|---|
| muse-spark-1.3-contributor | Muse Code CLI | code generation, debugging, docs (this record §2) | 2,758 sessions (all projects) · Spark daily 10-30~11-02 ≈2,006M in / 12.2M out · 22.9k requests · 128 tool calls · 93.9% cache |
| meta-models/muse-spark-open-1026 | Baseten API | consults, cross-reviews, log narratives, probes | 58 calls · 262,708 tokens (in 79,351 / out 183,357) |
| Meta AI | chat | competition/video quick questions | no logs (user-attested) |

- Workflow: Meta AI → VSCode terminal → Muse CLI → Baseten API · coding ·
  Ax batch (local CPU, 0 API tokens) · agents · Docker · AI chat → NSP-3D
  sim · video · docs · evidence.
- Usage detail: `META_AI_USAGE.md` (per-call log), `MUSE_CLI_USAGE.md`
  (sessions, daily totals, limits §3).
