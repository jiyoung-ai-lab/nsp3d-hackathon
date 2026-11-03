# NSP3D Fix Version Log (CHANGELOG)

Purpose: pin "that version" by name when reverting.

## Version list

| Version | Date | Key changes | Batch evidence | Status |
|---|---|---|---|---|
| fu13-release | 11-01 | fusion depth-out: fog+flow weighted, no depth pass; BUILD …-flr2-fu13 | A/B 6-cell 4W2L; main 72x12: ALIF 91.9/LIF 86.1 | RELEASE (final flight build) |
| main-test | 11-01 | 9 mazes x model x eye x sensor, 72 cells x 12 runs = 864, desk, seed 60000031+, learning OFF | m2-bi-fog 8→83, m5-bi-fog 0→100 (ALIF rescue) | Evidence: ax_main_desk_runs.jsonl |
| sensor234-flr2 | 11-01 | z_depth floor routing color-first (+dark fallback); F3/D3 tests; BUILD …-flr2; fog parity kept | flr2 depth 0/4→1/4 (coll 52→0.75); m16 48-wave complete (split 24/24) | Kept, extended by fu13 |
| sensor234-flr | 11-01 | fusion floor routing color-based (fusedFloor ← px.floorSlab); BA fusion-only review | flr fusion 0/4→2/4 (coll 53→1) | Kept, extended by flr2 |
| sensor234-geoveto2 | 11-01 | reference patch (depth RGB/G/B packing, HR flow, weighted fusion) + geometric veto + seam guard; verify-sensor-veto.mjs | fog parity 380 identical | Base, suite 176/0/9 |
| V5-flight | 10-31 | v5 external flight patch full-apply (Tier0→Tier1→full, 4 keeps) + CITATIONS #54–#57 | 37/42 corridor/multi, 11/18 maze2/6 | Locked in, suite 176/0/9 |
| ALIF-adapt | 10-31 | engine-2 fix: immediate spike reset + refractory adapt decay + coach /0.85·0.85; `tests/verify-alif-adapt.mjs` added | ALIF re-measure 14/21 (LIF 9/9 identical) | Locked in, learning flag off |
| V1.6-fruitfly | 10-29 | bee→fruit-fly rename (UI strings, comments, docs; GATE review rewritten in EN); IDs/filenames/paper titles kept | — | 159 tests + 6 skipped |
| V1.6-ui | 10-29 | UI cleanup: labels, maze names (number+feature), type scale | — | 159 tests + 6 skipped |
| V1.6-restored | 10-29 | K25/K26 removed (back to V1.6 behavior) | Must match V1.6 batch | 159 tests + 6 skipped |
| V1.7 | 10-29 | K25a bino de-boost + K25b ceiling zero/sink | maze2 bino 0/6, boundary dither found | Mono unchanged confirmed |
| V1.6 | 10-29 | K23 above-horizon gray = occupied + K24 odometry stall-flip | maze2 bino 0/6 ceiling trap, maze6 mixed | Suite 159/159 |

## K-fix index

- K16-A/B: suppress climb when sides open / relative-opening valley
- K17: headroom-graded climb gain (WORLD.Y reference)
- K19R: evidence-based gates (verified-open + hold latch)
- K20: SNN analog urgency + boxedSNN .55
- K21: gate-forming ties hold straight
- K22: hold completion (lip + 1.0s)
- K23: gray above horizon = occupied (ceiling/fog wall)
- K24: flip veer side on odometry stall (rule satN + SNN + bino K24b)
- K25a: bino L/F/R threats unboosted (mono scale)
- K25b: zero climb + gentle sink at ceiling (K17 never zeroes)
- K26a: ceiling-mode latch (enter .16, exit .12) — flag `K26_CEILING_LATCH`
- K26b: bino thirds angular parity ([0,1,2]/[3,4]/[5,6,7]) — flag `K26_ANGULAR_THIRDS`
- K27/K28: corner-tie + flow rework — REVERTED 10-30


