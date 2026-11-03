# Ax analysis (195 trials + holdout 36 runs, 2026-11-01)

Source: `AX_RESULTS_2026-11-01.md`, `AX_HOLDOUT_2026-11-01.md`, `ax_{cor0,multi1,zig0,holdout}_runs.jsonl`.

## 1. Maze difficulty

multi1(easy, groups 92~100%) > cor0(medium, winning group 89%) > zig0(hard, winning group 81%).
Matches maze character: multi1=vertical gates, cor0=lateral corridor, zig0=zigzag maze.

## 2. Winners + holdout

- cor0: t23 neuron·LIF·mono·Fog 0.58/0.082 → 100%/0.00/39.2s. holdout identical (bit-identical).
- multi1: t0 camera·mono·Fog 0.78/0.083 → 100%/0.00/24.9s. holdout 100%/0.42/19.3s.
- zig0: t29 neuron·LIF·bino·Fog 1.00/0.094 → 100%/0.00/40.0s. holdout 100%/0.42/47.5s.
- All 3 held 100% over 12 new-seed runs → no seed overfitting in multi1/zig0 (cor0 excluded: seeds have no effect).

## 3. Sensors (top finding)

- Fog sweeps all 3 mazes. All 3 optima are Fog.
- Fusion flips with difficulty: multi1 98%(helpful/harmless) → zig0 52~58%(collapsed vs Fog 81%).
  Consistent with the hypothesis that max-pooling noise hurts more in harder mazes.
  Independently consistent with the sensor234 patch basis (Fusion blindly follows flow).
- Depth/Flow excluded from Ax (sensors=fog,fusion) — known gap.

## 4. Control/model/eye

- Camera rules competitive only in multi1 (98%, fastest 4.65s). cor0 tried camera only 4 times.
  zig0 zero camera is not Ax dropout but missing candidates (RULE configs exist only for corridor/multi, structural).
- Neurons the only choice in hard mazes.
- LIF vs ALIF: LIF wins on collisions (zig0: 1.82 vs 5.44, cor0 mono-LIF 89% vs bino-ALIF 77%).
  ALIF sparsity edge does not carry into success rate.
- Mono vs bino: maze-dependent (cor0 mono wins, zig0 bino wins).
- Ax converged normally: cor0 LIF-mono-Fog 30 + ALIF-bino-Fog 25 concentrated, zig0 LIF-bino-Fog 30 concentrated.

## 5. Key results

- (a) Neurons > camera in hard mazes (cor0 camera tried only 4 times, zig0 neuron monopoly).
- (b) 100%/0-collision optima + 12 new-seed-run generalization.
- (c) Difficulty-graded Fusion decay → basis for sensor improvement.
- (d) Operating points with fixed sens/cruise values.

## 6. Caveats + follow-ups

- Ax objective is success+collisions only. Time ignored → multi1 fast points (t15/t38/t39, 100%/0.00/5.1s) are the
  de-facto optima. Recommend 1 holdout wave on the fast point to switch operating point (PC batch).
- cor0 seeds have no effect (fixed maze) → generalization claims must rest on multi1/zig0.
- For zig0 camera comparison: add RULE configs for exp_maze6 and test separately.
- 32 Fusion trials scheduled for re-run after patch (invalidation planned).
- Untried combos (cor0 4, multi1 9) are optional follow-ups.

## 7. Reporting scope (BA validity 11-02 applied, no hype)

- Numbers here are descriptive statistics with no significance testing. "Prove/guarantee/significant" wording banned.
- 12/12 holdout success has a 95% lower bound ≈74% (Clopper-Pearson). 100% is a point estimate, not a guarantee.
- Seed generalization ≠ structure generalization. "In any maze" wording banned. cor0 holdout has zero verification power.
- ALIF +5.8pp (main matrix) is pulled by 2 rescue cells (maze2 bino-fog 8→83%, maze5 bino-fog 0→100%).
  No "ALIF is better" verdicts; "9-maze fog/fusion average" scope labels required. (Recompute-verified: ALIF 397/432=91.9%, LIF 372/432=86.1%)
- m16 sensor-worker confounding: cross-worker sensor comparisons (fog vs depth/fusion etc.) are void.
  Only same-worker comparisons (fog vs flow, depth vs fusion) are valid.
