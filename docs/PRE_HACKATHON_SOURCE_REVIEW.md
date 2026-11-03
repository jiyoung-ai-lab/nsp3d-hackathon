# PRE_HACKATHON_SOURCE_REVIEW.md
## Neural Simulation Playground (NSP) 3D - Pre-existing Work vs Hackathon New Contribution

**Date:** 2026-10-27  
**Project:** Neural Simulation Playground (NSP) 3D - FlyMind 2D → 3D Flight Transition  
**Base Repo:** github.com/jiyoung-ai-lab/flymind (8M, currently private during judging, previously public)  
**New Project Name:** Neural Simulation Playground (NSP) - This Hackathon

> This document is required by hackathon rules to distinguish pre-existing code/data from new contributions during the hackathon period.

---

### 1. Project Lineage

#### 1.1 Pre-existing Work: FlyMind (2D Prototype)
- **Repo:** `jiyoung-ai-lab/flymind` (8M source, browser ES modules)
- **Period:** Before hackathon (2025 ~ 2026-10-26)
- **Status:** Private during judging for protection, previously public with commit history
- **Stack:** JavaScript, HTML5, CSS3, Python (neuPrint query tools), Three.js
- **Structure:**
  - `index.html` - main 2D simulation, neural circuit monitoring, LIF graphs
  - `public-maze.html` - wall-maze, 5 maze types, A* path comparison
  - `src/` - app/, controllers/, neural/, learning/, planning/, simulation/, visualization/, ui/, world/, storage/
  - `tools/neuprint/` - query_flight_intermediates.py, project_paths.py, etc.
  - `data/connectome/dnp03/, mushroom-body/` - selected connectome subsets
  - `docs/` - README.md, history/, parameters/, specifications/
- **Core Features (SRC-01~15 in previous spec):**
  - Fruit fly movement and obstacle avoidance in 2D maze
  - LIF (Leaky Integrate-and-Fire) neuron model
  - Mushroom Body associative learning
  - DNp03-based avoidance model (based on connectome)
  - A* hybrid control when stuck (getting stuck → A* pathfinding)
  - Visualization of sensory inputs, motor outputs, membrane potentials
  - Experiment tab with IndexedDB storage, Validation tab

#### 1.2 Pre-hackathon Data Preparation (Allowed, Data Prep Stage)
**This is data query and transformation before hackathon.**

**Why added:** Original FlyMind was DNp03-centered for 2D avoidance. For 3D flight, flight-related descending neurons (DNa04/05/10, DNp06) need to be added based on literature review.

**Method:**
- Tool: `tools/neuprint/query_flight_intermediates.py` (Python, neuPrint API)
- Dataset: Male CNS Connectome `male-cns:v1.0` from https://neuprint.janelia.org/
- Dataset Page: https://male-cns.janelia.org/download/
- License: CC BY 4.0 - Attribution: FlyEM Project Team, Male CNS Connectome, v1.0
- Query Scope: Direct input and output connections of selected descending candidates, plus direct LPLC2-to-descending-cell connections. Broad LPLC2 optic-lobe neighborhood excluded to keep focused.

**Target Types Queried:**
```
LPLC2, DNp06, DNa04, DNa05, DNa10, DNa15, DNb01, DNp03, DNg02, DNp20, DNp22
```

**Result Files (Pre-hackathon artifacts):**
1. `malecns-flight-additions.json` (130 nodes, 160 unique pairs)
   - Schema: focused subset, not full circuit
   - Extraction rule: all recorded directed edges incident to added candidate types
   - Seed roles:
     - DNa04: lateralized flight steering candidate (2 neurons)
     - DNa05: lateralized flight steering candidate (2 neurons)
     - DNa10: bilateral wing-control candidate; lift/thrust/pitch role remains hypothesis (1 neuron)
     - DNp06: visually guided evasive-turn candidate (2 neurons)
     - LPLC2: looming and threat visual projection candidate (95 neurons in this subset)
   - Missing: DNg02, DNp20, DNp22 not in supplied local expansion (sparse or absent)

2. `malecns-flight-targeted-api.json` (9,621 neuron records, 22,063 directed pairs)
   - Retrieved: 2026-10-24T08:35:21Z
   - Neuron counts by type: LPLC2 185, DNp06 2, DNa04 2, DNa05 2, DNa10 2, DNa15 2, DNb01 2, DNp03 2, DNg02 0, DNp20 2, DNp22 2
   - Connection rule: direct incoming/outgoing edges of queried descending candidates + direct LPLC2-to-descending edges, summed synapse weight
   - Excluded: broad LPLC2 neighborhood outside direct descending targets

3. `malecns-flight-pathway-review.md` (Verification)
   - Key finding: Wider API query finds 179 direct LPLC2 → DNp06 pairs, totaling 1,719 synapses. Both DNp06 cells represented. Local CSV expansion did NOT include these, so "no direct LPLC2→DNp06 edge" was limitation of targeted expansion, not evidence of absence.
   - Other links:
     - LPLC1→DNp03 134 pairs / 3,602 syn, LPLC1→DNp06 134 / 2,773
     - LC4→DNp03 126 / 2,507, LC4→DNp06 125 / 1,152
     - LPLC4→DNp03 97 / 3,740, LPLC4→DNa10 87 / 693
     - LPLC2→DNp06 179 / 1,719, LLPC3→DNa10 325 / 2,216
   - DNa04/DNa05 have direct connections with DNa15, DNb01, DNp03 + many partners
   - DNa10 connects with DNp20 (2 syn) and DNp22 (1 syn) sparse
   - DNg02: no neurons under that label

**What This Does NOT Establish (Scientific Honesty):**
- These are anatomical connection counts. They do NOT establish excitatory/inhibitory, visual field position, behavioral sign, or whether summed graph alone generates avoidance.
- Data supports plausible visual-to-descending pathway for model to test; does NOT prove complete sensory-to-flight circuit.
- Up/down behavior needs appropriate descending and motor pathway evidence and separately validated decoder.

**License Note for Pre-existing Data:**
- All connectome subsets derived from Male CNS v1.0, CC BY 4.0, FlyEM Project Team. See THIRD_PARTY_NOTICES.md.
- `synapse_sign_inferred: false` - sign not inferred from counts.

#### 1.3 Pre-existing AI-assisted assets (tool disclosure)
- **UI base (premade, pre-hackathon): built with Gemini Pro.** Covers the
  interface assets carried over from the FlyMind line as listed in §1.1
  (`index.html`, `public-maze.html`, `src/ui/`, styles/pages as of 2026-10-26).
- **Neuron map / connectome subsets (premade, pre-hackathon): built with
  GPT Codex.** Covers the connectome query tooling and transformed subsets
  (`tools/neuprint/`, `data/connectome/`, and the §1.2 flight-targeted JSONs).
- **FlyMind 3D screen UI (premade, pre-hackathon): built with GPT Codex.**
  Author's separate private 3D feasibility work (no public repo, not shipped).
  Screen UI composition (menu structure, panel layout) referenced — see §1.4.
- UI implementation, 3D screen-UI composition, and
  data query/transformation only. Hackathon-new code that wires these assets
  into 3D flight control is listed separately in §2.
- Closed list (author declaration): the only pre-existing references are the
  FlyMind repo (§1.1), FlyMind 3D screen UI (§1.4), and the AI tools above
  (Gemini Pro UI, GPT Codex connectome + 3D UI). Everything else was built
  during the hackathon (§2).

#### 1.4 FlyMind 3D screen UI (pre-existing, private)
- **What:** author's separate pre-hackathon feasibility check — whether 3D
  works on the web — with basic screen UI composition (menu structure,
  panel layout).
- **Built with:** GPT Codex assistance (Codex-referenced authoring).
- **Status:** private, no public repo. Not shipped.
- **Scope taken:** screen UI composition referenced for NSP3D's interface
  structure (NSP3D-side implementation: §2.6).

---

### 2. New Work for Hackathon: NSP 3D (Evaluation Target - 100% New Implementation)

**Period:** 2026-10-27 ~ Submission (Hackathon period)  
**Goal:** Convert FlyMind 2D prototype into 3D flight simulator per clean-room spec + MVP spec

**Although flight neuron JSONs were pre-processed, the code that WIRES them into 3D flight control is ALL NEW during hackathon:**

#### 2.1 Architectural Separation (New)
**File:** `flight-circuit-extension.js` (standalone LIF flight controller from your upload)

- `window.mergeFlightGraphs(base, extension)`:
  - Merges base (FlyMind 2D) nodes/edges + extension (flight neurons) nodes/edges
  - Sums weights for duplicate pairs, tags `source_dataset: 'MaleCNS neuPrint targeted query'`
  - Schema: broad targeted MaleCNS visual-to-descending-to-VNC candidate graph
  - Returns: {nodes, edges, base_node_count, extension_node_count, etc.}

- `instantiateAnatomicalCore(graph)`:
  - Creates isolated copy of 1,854 neurons & 3,305 edges (anatomical core)
  - Partitions:
    - visual_projection/centrifugal → visualL/R, loomingVisualL/R (LPLC2/LC4/LLPC), targetVisualL/R (LC10), opticFlowVisualL/R, upperVisual/lowerVisual, lateralVisualL/R
    - descending_neuron (DNp03, DNa15, DNb01, etc.) → dnL/R
    - vnc_motor → motorL/R
    - verticalCandidates: DNa04/05/10, DNp03/06, DNb01, DNp20/22
  - Synapse: weight = w/scale*sign, scale = CONFIG.synapseScale*6 for descending, sign = -1 if DNb01 or GABA
  - Threshold: 0.85 + hash(id)%1000/2000

- `createMonocularConnectome(graph)` - MODULE A:
  - Standalone monocular controller, can be split to `graph-network-mono.js`
  - Mode: 100° VFOV, 320x180 visionTarget, gains.monocular independent (left/right/climb/dive)
  - Own membrane state, eligibility, sensory-to-neuron mapping, learned readout weights
  - Step: lateral threat, frontal threat, vertical passage detection (openTopGate/openBottomGate), goalVisible trace, wall suppression (goalWallSuppress = clamp(1-goalVisible*0.85)), stall detection

- `createBinocularConnectome(graph)` - MODULE B:
  - Standalone binocular compound-eye controller, can be split to `graph-network-bino.js`
  - Dedicated Binocular Overlap & Stereo Disparity Pathway:
    1. Outer Peripheral Threat → LPLC2/LC4/LLPC looming neurons (periLeft/periRight)
    2. Frontal Binocular Overlap (leftEyeNasal vs rightEyeNasal, stereoConvergence = sqrt(L*R), stereoDisparity = L-R) → Optic-flow centering & contralateral avoidance
    3. Continuous Binocular Target Bearing → LC10 target-fixation neurons
  - Eliminates binary left/right bias, 100% centered in straight corridor
  - Baseline B=0.0036m (b=0.0018m), cant angle θ=28° (0.4887 rad)
  - Positions: PL = Phead - b*R, ψL = ψ - θcant, PR = Phead + b*R, ψR = ψ + θcant, where R = (cosψ,0,sinψ)
  - visionTargetL/R 216x160 independent WebGLRenderTargets, DPR=1 fixed
  - Balanced L/R normalization to prevent anatomical neuron-count bias
  - Homeostatic bilateral symmetry gate: driveAsym = |L-R|_loom + |L-R|_flow + |bearing|*2, symGate = 0 if <0.02 else min(1, driveAsym/0.08)

- `createFlightConnectome(graph, options)` - FACADE / DUAL-PATHWAY ROUTER:
  - Holds completely independent monocular and binocular instances
  - Separate weight sets so switching cameras never mixes neural state or weights
  - API: activeMode, neuronRule, setMode(), setNeuronRule(), step(input), reinforce(), stats(), reset(), resetLearning(), exportWeights(), loadWeights()

#### 2.2 4-Type Camera Sensor Pipeline (New, per clean-room spec)
**File:** `camera-vision.js` (to be implemented per spec)

- Offscreen DPR fixed: renderer.setPixelRatio(1) before eyeCamera render, restore after
- Layer 0~3 separation:
  - Layer 0: Floor, Ceiling, Hazard Ring, Goal Sphere → both mainCamera & eyeCamera
  - Layer 1: Translucent internal maze walls (opacity 0.42, 0x38bdf8) → mainCamera only
  - Layer 2: Chamber glass outline, grid, trail → mainCamera only
  - Layer 3: Opaque walls for the fruit fly (0x1678ff, internal + 4 outer boundaries) → eyeCamera only
- sealMazeWalls: edgeSnap=0.045m, axialPad=0.012m, min thickness 0.028m
- 4 sensor methods:
  1. fog_rgb: Fog(0x0b1020, 0.015, 0.34), S_wall = clamp((B-max(R,G*0.88)-0.08)/0.42)*clamp((B-0.14)/0.55), S_hazard, S_goal
  2. z_depth: Custom Depth Shader, vWorldY<=0.0045 floor excluded, >=0.1955 ceiling excluded, uNear=0.01, uFar=0.38, lin=clamp((vViewZ-uNear)/(uFar-uNear)), proximity=1-lin, metric=pow(proximity,1.35)
  3. optical_flow: I=0.2126R+0.7152G+0.0722B+0.35*max(0,B-R), D_temp=clamp(|I(t)-I(t-1)|*3.8), G_spatial multi-scale (s1=1, s2=3), S_flow=0.38*D_temp+0.44*G_spatial+0.32*S_wall, EMA T̄_t=0.72*T̄_{t-1}+0.28*T_t
  4. sensor_fusion: T_fusion=clamp(0.50*T_z+0.30*T_fog+0.25*T_flow)

#### 2.3 Physics & Collision (New)
- Chamber: X∈[-0.50,+0.50], Z∈[-0.50,+0.50], Y∈[0.0,0.20]
- Agent radius r_fly=0.018m, outer wall ±0.482m
- vmax=0.22m/s, ωmax=4.2 rad/s
- Collision stun: collisionStunTimer=0.38s, elastic repulsion 0.012m along n_wall
- Active avoidance: postCollisionTurnTimer=0.48s, forced steering torque opposite wall normal
- Penalty: p_crash∈[-3.0,-0.5]pt, default -1.5pt
- Goal terminal capture glide: R_capture=0.045m, R_touchdown=0.011m

#### 2.4 Essential Control Gates (New, prevents wall sticking & target avoidance bug)
1. LC10 Target-Lock Wall Suppression: S_suppress=clamp(1.0-0.85*G_visible,0.12,1.0), T_effective=T_raw*S_suppress
2. Asymmetric Deadlock Breaker: if |T_left-T_right|<0.08 and T_center>0.32, inject ±0.45 bias via preferredTurnSign
3. Camera Pitch Sign Correction: θ_goal,vertical = pitch + arctan(G_y*tan(VFOV/2))

#### 2.5 Reinforcement & ALIF Plugin (New)
- Base: Online Teacher (DAgger) + 3-Factor R-STDP
  - w_k∈[0.35,2.60], k=left/right/upper/lower (climb/dive)
  - R_t = c_prog*Δd_goal - c_prox*max(T_left,T_right,T_center) - p_crash*I_collision + r_goal*I_goal
  - e_k(t+Δt)=λ_e*e_k(t)+x_k_pre*ψ(v_post,ϑ)*y_post
- Plugin: `alif-surrogate-plugin.js` - detachable
  - ALIF: v_i(t+Δt)=α_v*v_i(t)+(1-α_v)*I_i(t)-z_i(t)*ϑ0, a_i(t+Δt)=α_a*a_i(t)+β_adapt*z_i(t), ϑ_i(t)=ϑ0+γ_a*a_i(t)
  - Surrogate: ψ(v,ϑ)=1/(1+β_sg*|v-ϑ|)^2, β_sg=8.0
  - Collision Index & ε-Greedy: C_idx∈[0,1] EMA, ε(t)=clamp(ε_min+0.35*C_idx+0.25*max(0,-R̄_t),0.04,0.65)
  - Loose coupling: window.ALIFSurrogatePlugin optional, removal falls back to LIF baseline without error

#### 2.6 UI/UX & Sub-Studios (New)
- Main simulator (index.html): Integrated toolbar below title (maze, camera mode mono/bino, sensor 1~4, neuron model LIF/ALIF, collision penalty, lighting presets bright_lab/high_contrast/dim_dusk, 5-type benchmark runner, pretrained demo, weight save/load)
- 3D Fly Studio (hand-drawn-bee.js): wingScale 50%~200% (default 115%), rolling, dizzyStars, shockRing
- Maze Editor (maze-editor.html): 2D drag + 3D preview, localStorage nsp_custom_mazes_v1
- Camera Benchmark Arena (path-planner.html): Same seed quantitative comparison of 4 sensors, metrics: success %, time, collisions, path efficiency vs 3D voxel A* reference

#### 2.7 Experiment & AI Analysis (New per MVP FR-06/07)
- FR-06: experiment_result.json schema v1.0 with experiment_id, seed, controller, vision_mode, sensor_method, neuron_model, learning_enabled, parameters, outcome (success, termination_reason, collisions, progress_percent, elapsed_seconds, total_reward), metrics, gains.monocular/binocular
- Values measured only, missing=null, episode vs aggregate not mixed
- FR-07: Meta AI analysis (Muse Spark for code, Image/Video for assets)
  - Input: experiment JSON + benchmark summary
  - Output: purpose/conditions, measured results, differences, data-backed observations, limitations, next experiments
  - Security: API key in server env var, not in browser/public repo, simulation works without API

---

### 3. Bug Checklist (7 Major Bugs from Past - Must Avoid)

| # | Symptom | Root Cause | Required Fix |
|---|---------|------------|--------------|
| 1 | Binocular view overlapping or shifted right | Single RenderTarget + setScissor, DPR mismatch in readPixels | renderer.setPixelRatio(1) + independent visionTargetL/R |
| 2 | Binocular sees left worse than monocular, spins | Right vector & cant sign inverted in right-hand coords | Front F=(sinψ,0,-cosψ), Right R=(cosψ,0,sinψ), Left: -bR, ψ-28°, Right: +bR, ψ+28° |
| 3 | Outer wall not recognized, keeps hitting | Only translucent outer wall, corner gaps | Layer 3 opaque wall 0x1678ff 4 sides + sealMazeWalls padding |
| 4 | z_depth black screen or only rising | Far clipping too large, floor at Y=0 detected as obstacle | Depth shader uNear=0.01,uFar=0.38, exclude vWorldY<=0.0045 floor, >=0.1955 ceiling |
| 5 | optical_flow shaking, blind when still | Pure temporal diff ΔI/Δt only | Add spatial contrast gradient + saturation + EMA |
| 6 | Avoids sideways right before goal | Blue outer wall behind goal overwhelms LC10 | goalVisible>0.05 → wall avoidance * clamp(1-goalVisible*0.85,0.12,1.0) |
| 7 | Straight wall collision, left-right cancel | leftThreat-rightThreat≈0 | center>0.32 and |L-R|<0.08 → force asymmetric bias ±0.45 via preferredTurnSign |

---

### 4. Attribution, Licenses, and Third-Party Notices

- **Connectome Data:** Male CNS Connectome male-cns:v1.0, neuPrint https://neuprint.janelia.org/, Download https://male-cns.janelia.org/download/, License CC BY 4.0, Attribution: FlyEM Project Team, Male CNS Connectome, v1.0. See THIRD_PARTY_NOTICES.md
- **Pre-existing AI tooling disclosure:** UI base by Gemini Pro, connectome query tooling/subsets by GPT Codex (both pre-hackathon, see §1.3). UI implementation + data query/transformation only.
- **FlyMind Base:** github.com/jiyoung-ai-lab/flymind, MIT License (per LICENSE file), includes selected and transformed subsets of neuron and connectivity data
- **Three.js:** MIT
- **snnTorch/PyTorch:** BSD/MIT
- **Experiment Output:** Not biological claim. Model smoke check: 60 LIF steps/side, left threat → right turn +0.16, right threat → left turn -0.16 (configured cap). Software check with synthetic inputs, not animal experiment.

---

### 5. Declaration for Hackathon Submission

- [x] Pre-existing code/data and new contributions are listed separately above
- [x] Reused code/data/assets rights and licenses checked (CC BY 4.0 attribution, MIT, etc.)
- [x] No secret keys or sensitive files in public repo (.env, NEUPRINT_TOKEN, .venv excluded)
- [x] New contributions clearly visible in demo video (dual render targets, 4 sensor switching, Layer separation, ALIF plugin toggle, experiment_result.json export)
- [x] Scientific honesty: Simulation behavior verification ≠ biological validation. Reward-modulated readout-gain learning. Values measured only.

**Prepared for:** Meta Global AI Developer Hackathon 2026 Submission - Neural Simulation Playground (NSP) 3D
**Author:** Ji Young Park (jiyoung-ai-lab)
