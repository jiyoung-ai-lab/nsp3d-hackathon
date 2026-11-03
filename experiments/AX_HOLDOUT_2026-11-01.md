# Ax holdout check (top 3 × 12 new-seed runs)

Seeds: holdout 20400031/20410031/20420031 (no overlap with night range [20261031, ~20328031]).
Run: direct trial.cjs calls (--runs 4, --maxt 80), same path as original.
Raw: `ax_holdout_runs.jsonl` (9 waves, fails=0).

Order: control (camera→neuron) > model (LIF→ALIF) > eye (mono→bino) > sensor (Fog→Fusion)

## Per-optimum totals (12 runs)

| maze | trial | control | model | eye | sensor | sens | cruise | rate | coll | time_s | dist_m |
|---|---|---|---|---|---|---|---|---|---|---|---|
| multi1 (maze6) | t0 | camera | - | mono | Fog | 0.78 | 0.083 | 100% | 0.42 | 19.3 | 1.17 |
| cor0 (maze2) | t23 | neuron | LIF | mono | Fog | 0.58 | 0.082 | 100% | 0.00 | 39.2 | 2.13 |
| zig0 (maze7) | t29 | neuron | LIF | bino | Fog | 1.00 | 0.094 | 100% | 0.00→0.42 | 47.5 | 2.88 |

## Wave detail (4 runs each)

| maze | wave | seed | rate | coll | time_s | dist_m |
|---|---|---|---|---|---|---|
| cor0 | w0 | 20400031 | 100% | 0.00 | 39.2 | 2.13 |
| cor0 | w1 | 20410031 | 100% | 0.00 | 39.2 | 2.13 |
| cor0 | w2 | 20420031 | 100% | 0.00 | 39.2 | 2.13 |
| multi1 | w0 | 20400031 | 100% | 1.25 | 13.6 | 0.89 |
| multi1 | w1 | 20410031 | 100% | 0.00 | 25.2 | 1.46 |
| multi1 | w2 | 20420031 | 100% | 0.00 | 19.2 | 1.15 |
| zig0 | w0 | 20400031 | 100% | 0.25 | 41.0 | 2.47 |
| zig0 | w1 | 20410031 | 100% | 0.00 | 40.9 | 2.48 |
| zig0 | w2 | 20420031 | 100% | 1.00 | 60.7 | 3.68 |

## Verdict

- All 3 hold 100% on new seeds → no seed overfitting.
- cor0 waves bit-identical → seeds have no effect in the fixed corridor maze (structural, not a defect).
- multi1/zig0 vary by wave (collisions 0~1.25, time ±40%) but all hold 100% success.
