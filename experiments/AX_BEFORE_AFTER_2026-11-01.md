# Ax before/after comparison (before/after)

## 0. Purpose of AX use (concept, organized 2026-11-03)

- Order: tune via program unit tests → measure per-condition variance in batches → verify code bugs and optimize.
- Original purpose was learning, but time was short so no learning runs (all reported numbers learning-OFF). Ax used for code verification and optimization.
- before/after here means pre/post measurements on the same comparison axis (A: seed generalization, B: sensor patch planned, C: fog regression), not a learning curve.
- Before/after scope: before=night sweep 3 mazes (2/6/7), after=main test 9 mazes (2/4/5/6/7/8/9/10/11). Mazes 1·3 excluded from AX (screen-hidden, retest planned).
- before is the first attempt (notebook GTX 1650 · small scale · no source changes, user-confirmed). after is the fu13 main test (PC GTX 5070).

## A. Night optima vs holdout (seed generalization) — done 2026-11-01

| maze | optimum | night (original-seed 4 runs) | holdout (new-seed 12 runs) | verdict |
|---|---|---|---|---|
| cor0 (maze2) | t23 neuron·LIF·mono·Fog 0.58/0.082 | 100% / 0.00 / 39.2s | 100% / 0.00 / 39.2s | IDENTICAL (no seed effect, no verification power) |
| multi1 (maze6) | t0 camera·mono·Fog 0.78/0.083 | 100% / 0.00 / 24.9s | 100% / 0.42 / 19.3s | success held, mild collision noise |
| zig0 (maze7) | t29 neuron·LIF·bino·Fog 1.00/0.094 | 100% / 0.00 / 40.0s | 100% / 0.42 / 47.5s | success held, w2 time variance |

- Premise: all 3 are Fog so unrelated to the sensor patch. Holdout results hold pre- and post-patch.
- Why cor0 is bit-identical: fixed corridor maze + no hazard → seeds don't affect trajectory.
- Source: `AX_RESULTS_2026-11-01.md`, `AX_HOLDOUT_2026-11-01.md`, `ax_{cor0,multi1,zig0,holdout}_runs.jsonl`.

## B. Pre vs post sensor patch (decoder change) — planned

- Target: 32 Ax fusion trials (cor0 4, multi1 13, zig0 15) + Tier0 depth-included configs.
- Method: re-run voided trials on original seeds (apples-to-apples) → holdout seeds (generalization).
- 163 fog trials need no re-run (patch guarantees byte-identical fog path).
- Prerequisite: DECODER_BUILD bump required, 3 Ax snapshots frozen (read-only).
- Status: on hold (HOLD). Tree unchanged.

## C. Fog full regression (night vs today) — done 2026-11-01

- Today: 32 fog trials × 1 wave (registry nominal sens/cruise, new seeds). Raw `ax_fogsweep_runs.jsonl`.
- Note: night used Ax search params (vary by trial), today nominal params + different seeds + n=4.
  Per-config moves are param/seed differences. Judge by maze totals.
- Maze totals: cor0 80%→77%, multi1 97%→97%, zig0 76%→85%. No systematic regression.
- Byte-identical decoder proof + held flight totals → fog regression CLOSED.

| config | study | night s/n coll time | today s/n coll time | verdict |
|---|---|---|---|---|
| cfg01 | cor0 | 8/8 1.62 58.1s | 1/4 6.50 68.2s | WORSE (param/seed diff) |
| cfg02 | cor0 | 4/8 3.62 57.2s | 3/4 2.75 46.5s | SAME |
| cfg03 | cor0 | 1/4 0.50 70.3s | 3/4 3.25 45.5s | SAME |
| cfg13 | cor0 | 4/4 3.75 75.7s | 4/4 1.25 35.6s | SAME |
| cfg14 | cor0 | 1/4 2.75 70.5s | 3/4 4.25 57.8s | SAME |
| cfg15 | cor0 | 64/72 0.50 44.7s | 4/4 0.00 30.2s | BETTER |
| cfg16 | cor0 | 16/28 0.71 58.2s | 4/4 2.00 41.1s | BETTER |
| cfg17 | cor0 | 2/4 1.25 64.7s | 2/4 3.50 67.8s | SAME |
| cfg22 | cor0 | 1/4 7.25 72.5s | 4/4 0.50 32.1s | BETTER |
| cfg47 | cor0 | 31/36 2.89 56.7s | 4/4 1.25 37.6s | BETTER |
| cfg51 | cor0 | 1/4 1.50 70.4s | 3/4 4.00 53.2s | SAME |
| cfg55 | cor0 | 4/4 2.00 58.8s | 1/4 4.50 68.8s | WORSE (param/seed diff) |
| cfg59 | cor0 | 59/64 2.12 39.8s | 4/4 4.25 56.4s | BETTER |
| cfg18 | multi1 | 24/24 0.33 6.6s | 4/4 0.25 9.9s | SAME |
| cfg19 | multi1 | 13/16 0.69 23.0s | 3/4 2.25 28.9s | SAME |
| cfg20 | multi1 | 4/4 4.25 10.2s | 4/4 0.50 15.6s | SAME |
| cfg21 | multi1 | 47/48 2.65 15.3s | 4/4 0.75 9.9s | BETTER |
| cfg23 | multi1 | 24/24 0.67 7.1s | 4/4 1.75 27.9s | SAME |
| cfg63 | multi1 | 70/72 1.01 11.7s | 4/4 0.50 9.5s | BETTER |
| cfg75 | multi1 | 4/4 4.75 9.7s | 4/4 0.50 15.3s | SAME |
| cfg83 | multi1 | 16/16 2.12 15.6s | 4/4 1.00 23.7s | SAME |
| cfg07 | zig0 | 4/8 14.50 66.6s | 4/4 7.50 60.5s | BETTER |
| cfg08 | zig0 | 38/52 4.19 55.2s | 4/4 3.50 22.6s | BETTER |
| cfg09 | zig0 | 4/8 4.50 67.7s | 4/4 7.25 19.3s | BETTER |
| cfg31 | zig0 | 9/12 4.17 52.6s | 3/4 4.00 45.9s | SAME |
| cfg35 | zig0 | 97/120 1.82 58.4s | 2/4 2.50 64.6s | SAME (params differ) |
| cfg27 | multi1 | - | 4/4 0.00 10.9s | NEW |
| cfg39 | corridor | - | 0/4 2.25 80.0s | NEW (matches camera-rule corridor failure) |
| cfg43 | corridor | - | 3/4 1.75 44.5s | NEW |
| cfg67 | multi1 | - | 4/4 0.25 14.0s | NEW |
| cfg71 | multi1 | - | 4/4 0.00 10.9s | NEW |
| cfg79 | multi1 | - | 4/4 0.50 10.8s | NEW |
