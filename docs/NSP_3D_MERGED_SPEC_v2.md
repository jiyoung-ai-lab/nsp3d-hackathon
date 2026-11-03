# Neural Simulation Playground 3D — Merged Functional Spec v2.0
## Clean-room technical spec + Hackathon MVP v0.1

> Source 1: clean-room functional & technical spec (Meta AI build guide) — 7 modules, 4 sensors, Layers 0–3, physics formulas, 7-bug checklist
> Source 2: Hackathon MVP v0.1 functional spec — FR-01–08, P0/P1/P2, experiment_result.json, scientific honesty

---

## 0. Merged document purpose

- **Technical spec (#1)**: formulas/shaders/physics/neuron-circuit detail for instructing Meta AI to clean-room reimplement in a no-20M-upload environment
- **MVP spec (#2)**: product spec separating existing features from new contributions and verifying the P0 core flow for hackathon submission
- **Merge rule**: map #1's implementation detail onto #2's FR requirements. #2's `scientific honesty / licensing / old-vs-new split` are top principles.

---

## 1. Product overview (MVP FRs + technical extension)

**NSP 3D** = browser-based experiment environment. 3D-maze flyer visual input → neural circuit → behavior control → reward learning → AI analysis

Core data flow (MVP FR-02–07 + technical spec ch. 1–5):
```
3D chamber (100x100x20cm, Layers 0–3 split)
→ flyer first-person dual offscreen render targets (monocular 320x180 / binocular 216x160 x2, DPR=1 fixed)
→ 4 camera sensors (fog_rgb, z_depth, optical_flow, sensor_fusion)
→ pixel decoder (S_wall, S_hazard, S_goal formulas)
→ controller select (baseline rules / mono-bino split connectome SNN)
→ flight physics (vmax 0.22m/s, wmax 4.2rad/s, sealMazeWalls corner sealing)
→ reward (R_t = c_prog*Δd - c_prox*max(T) - p_crash*I + r_goal*I)
→ R-STDP + ALIF Surrogate plugin (detachable)
→ experiment_result.json export → Meta AI analysis (Baseten meta-models/muse-spark-open-1026)
```

**Key limits (MVP doc emphasis)**
- Not a full biological retina replica. Pixel-based threat/occupancy/goal extraction approximations.
- Learning tunes 4-way readout gains, not whole-connectome weights (reward-modulated readout learning).

---

## 2. File module mapping (tech spec 1.2 ↔ MVP appendix A)

| File | Tech spec role | MVP FR map | Notes |
|---|---|---|---|
| index.html | Main simulator UI, integrated toolbar, HUD | FR-01, FR-05, screens A/C/D | No build, type=module |
| app.js | Three.js chamber, physics/collision, dual render targets, benchmark runner | FR-01, FR-03, FR-05, FR-02 | Layer 0–3 split core |
| camera-vision.js | 4 sensors, independent mono/bino decoders, connectome LIF/ALIF | FR-02, FR-03 | Fog/Z-Depth/OpticalFlow/Fusion formulas incl. |
| alif-surrogate-plugin.js | Detachable ALIF, Fast-Sigmoid surrogate, C_idx, epsilon | FR-04 (extension) | LIF fallback on removal (loose coupling) |
| maze-layouts.js | 5 base mazes, sealMazeWalls, localStorage custom | FR-08, FR-01 | edgeSnap 0.045m, axialPad 0.012m |
| graph-network.js | Per-neuron-group synaptic activity visualization | FR-03, screen B | Photoreceptors–Descending |
| hand-drawn-bee.js | Procedural fruit-fly character | SRC-02 | wingScale 50–200%, dizzyStars |
| flight-physics.js / maze-hazards.js etc. | Physics checks, obstacle seeds | FR-01, FR-04 | Files newly named by MVP |
| maze-editor.html | 2D/3D maze editor | FR-08 | localStorage nsp_custom_mazes_v1 |
| path-planner.html | 4-sensor quantitative benchmark + 3D voxel A* | FR-05, SRC-13 | P1–P2 (deprioritized in MVP) |
| pretrained-gains.json | Pretrained mono/bino gains | FR-04, FR-05 | Demo load |

---

## 3. 4 camera sensors = MVP FR-02 vision decoder detail

MVP FR-02 requires `3x3 occupancy, left/front/right/up/down threats, goal beacon`. The tech spec implements it 4 ways:

1. fog_rgb: `S_wall = clamp((B-max(R,G*0.88)-0.08)/0.42)*clamp((B-0.14)/0.55)` + Fog(0x0b1020, 0.015, 0.34) — bit-identical since 10-29 (380-field parity)
2. z_depth: custom depth shader (R=linear depth, G=surface orientation, B=valid flag), uNear 0.015, uFar 0.34, geometric veto (linD<.32), gamma 2.4 decode, floor routing color-first + dark fallback (flr2)
3. optical_flow: I = 0.2126R+0.7152G+0.0722B+0.35*max(0,B-R), Hassenstein-Reichardt correlator + first-frame calm + EMA 0.72/0.28
4. sensor_fusion: T = depth*.55 + fog*.35 + flow*.10, depth>=.85 near override; floor routing color-based (flr)

MVP acceptance mapping:
- `Preview and decoder frames identical` → guaranteed by DPR=1 + independent render targets
- `Empty-background obstacle misclassification check` → z_depth floor/ceiling filtering + fog_rgb B-max(R,G) threshold
- `Goal beacon must not misclassify as obstacle` → S_goal/S_wall split + LC10 target-lock suppression gate

---

## 4. Controllers and learning (FR-03, FR-04 ↔ tech spec ch. 4,5)

**FR-03 controller select**
- Baseline controller: camera features → rule-based 4-way steering (bypasses the network)
- Neural circuit controller: mono (monocular 100°) vs bino (binocular 115°, B=3.6mm, cant 28°) fully split, gains.monocular vs gains.binocular
- 3 required gates (tech spec 4.3): LC10 Suppression (S_suppress = 1-0.85*G_visible), Asymmetric Deadlock Breaker (center>0.32 & |L-R|<0.08), Pitch correction

**FR-04 reward learning**
- Tech-spec R_t formula applied to MVP FR-04 as-is
- Tunables: w_k ∈ [0.35,2.60], k=left,right,upper,lower
- Base learner: 3-Factor R-STDP + DAgger teacher
- Extension plugin: ALIF v(t+Δt)=αv v + (1-αv)I - z*ϑ0, a(t+Δt)=αa a+β*z, ϑ=ϑ0+γa*a + Surrogate ψ=1/(1+β_sg*|v-ϑ|)^2, C_idx-based epsilon(t)=clamp(e_min+0.35*C_idx+0.25*max(0,-R̄),0.04,0.65)

MVP exact wording: `reward-modulated readout-gain learning`, not whole-connectome learning.

---

## 5. Experiment benchmarks and JSON (FR-05, FR-06 ↔ tech spec path-planner)

**MVP minimum metrics**: success rate, collision-free ratio, mean collisions, progress, time, cumulative reward, weight delta

**Tech-spec path-planner.html 4-sensor comparison** is P1/P2 in MVP but satisfies FR-05's `same-seed/condition comparison` requirement.

**FR-06 experiment_result.json proposed schema** (MVP doc example adopted + tech-spec gains extension):

```json
{
  "schema_version": "1.0",
  "experiment_id": "exp-001",
  "created_at": "ISO-8601",
  "scenario": "multi_level_3d",
  "seed": 20261026,
  "controller": "connectome_snn",
  "vision_mode": "monocular | binocular",
  "sensor_method": "fog_rgb | z_depth | optical_flow | sensor_fusion",
  "neuron_model": "LIF | ALIF+Surrogate",
  "learning_enabled": true,
  "parameters": {...},
  "outcome": {...},
  "metrics": {...},
  "gains": {
    "monocular": {"left":1.0,"right":1.0,"upper":1.0,"lower":1.0},
    "binocular": {"left":1.0,"right":1.0,"upper":1.0,"lower":1.0}
  }
}
```

- Measured values only, null when unmeasured. No mixing episode-level and aggregate numbers (MVP rule).

---

## 6. Meta AI analysis (FR-07)

- Input: experiment_result.json + benchmark summary
- 6-step output (MVP FR-07 as-is): goal/condition summary, measured results, comparison deltas, data-backed observations, undecidable limits, next-experiment proposals
- Models: Muse Spark for code; analysis via Baseten meta-models/muse-spark-open-1026
- Security: API keys in server env vars, never in browser code; simulation runs standalone without API

---

## 7. Merged MVP priorities and build order

**P0 (submittable core) — tech spec ch. 1–4 + FR-01–07**
1. Browser 3D run + Layer 0–3 split + sealMazeWalls
2. Flyer first-person camera DPR=1 + independent render targets
3. fog_rgb base sensor + S_wall/S_hazard/S_goal decoder
4. Baseline vs neural-circuit controller select (mono first)
5. Collision/goal checks (r_fly 0.018m, R_capture 0.045m)
6. Reward learning on/off + gain display
7. experiment_result.json export
8. Meta AI analysis link (measured values separated from interpretation)

**P1 (after stabilization) — tech spec bino, ALIF, benchmarks**
- Mono/bino comparison (visionTargetL/R, baseline 3.6mm, cant 28°)
- LIF vs ALIF+surrogate
- z_depth, optical_flow, sensor_fusion added
- Seed-fixed repeat benchmarks (5-kind same-seed runner)
- Custom maze JSON
- Pretrained weights

**P2 (time permitting)**
- path-planner.html A* and 4-sensor extended comparison
- Natural-language experiment proposals + approval workflow
- Multi-experiment trend analysis

The MVP doc's `build order 1–7` matches the tech spec's 4-stage prompts.

---

## 8. Hackathon rule compliance (MVP emphasis + tech spec ch. 7)

1. **Old-vs-new split**: list pre-existing 3D source features (SRC-01–15) separately from hackathon-new contributions in the submission. New contributions explicit in the demo video.
2. **License check**: Male CNS v1.0 connectome CC BY 4.0, CITATIONS.md, Three.js, image/model rights. Spec alone does not complete rights clearance.
3. **Scientific honesty**: software behavior verification ≠ biological validity verification. Measurable firing rates ≠ verified biological behavior for all neurons.
4. **Security**: no API keys in public repos. Exclude .env, .venv, data/connectome (.codeignore).
5. **7-bug checklist**: DPR, bino overlap, outer-wall perception, Z-Depth black screen, flow jitter, pre-goal avoidance, frontal deadlock.

---

## 9. Merged 4-stage Meta AI prompts (final)

**Prompt stage 1 — env/maze/camera vision (P0 core + FR-02)**
> Following tech spec ch. 1–4 + MVP FR-02 acceptance + 7-bug items 1–5, write full ES Module code for maze-layouts.js (with sealMazeWalls) and camera-vision.js (fully split mono/bino, fog_rgb base + z_depth + optical_flow + sensor_fusion, DPR=1, independent render targets).

**Prompt stage 2 — ALIF plugin + 3D character (P1)**
> Following tech spec 5.2, 6.2 + MVP FR-04 exact wording, write alif-surrogate-plugin.js (ALIF, Fast-Sigmoid ψ, C_idx, epsilon) and hand-drawn-bee.js (wingScale, rolling, dizzyStars).

**Prompt stage 3 — main simulator (P0 + FR-01,03,04,05,06)**
> Following tech spec ch. 2,3,6.1,7 + MVP FR-01,03,04,05,06, write index.html, app.js, graph-network.js, pretrained-gains.json with Layer 0–3 split, dual offscreen render targets, collision stun/active avoidance, 3 lighting presets, 5-kind same-seed benchmark, integrated toolbar, experiment_result.json export.

**Prompt stage 4 — sub-studios (P1/P2 + FR-08)**
> Following tech spec 6.3 + MVP FR-08, write localStorage-linked maze designer maze-editor.html and 4-sensor quantitative comparison path-planner.html.


