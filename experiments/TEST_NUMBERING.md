# Test numbering map (user-facing labels)

Internal IDs stay as-is; use the numbers below when showing to users.
Basis: main-page 1-based numbers = `src/sim/maze-layouts.js` registration order.

## Mazes (main numbers)

| No. | Name | internal id | exp shell | note |
|------|------|---------|-----------|------|
| 1 | open | open_arena | exp_empty | **excluded** (empty space) |
| 2 | corridor | corridor | exp_corridor | Ax target |
| 3 | S-shape | s_maze | exp_maze2 | **excluded** |
| 4 | pillars | pillars | - | |
| 5 | complex | complex | - | |
| 6 | multilevel | multi_level_3d | exp_multi | |
| 7 | zigzag | zigzag_labyrinth | exp_maze6 | shell name maze6 ≠ maze 6, careful |
| 8 | grid | grid_matrix | - | |
| 9 | spiral | spiral_ascent | - | |
| 10 | extreme | extreme_championship | - | |
| 11 | loop | loop_ring | - | |

Note: shell-name numbers (exp_maze2, exp_maze6) are unrelated to main numbers.

## Eyes

| No. | Name | internal visionMode |
|------|------|-----------------|
| 1 | monocular | monocular |
| 2 | binocular | binocular |

## Sensors (UI ①②③④ order)

| No. | Name | internal sensor |
|------|------|-------------|
| 1 | Fog-RGB | fog_rgb |
| 2 | Z-Depth | z_depth (excluded from analysis) |
| 3 | Optical flow | optical_flow (excluded from analysis, flow anomaly) |
| 4 | Fusion | sensor_fusion |

## Controllers

| No. | Name | internal controller / neuronModel |
|------|------|-------------------------------|
| 1 | camera | camera |
| 2-1 | neuron LIF | neurons / lif_baseline |
| 2-2 | neuron ALIF | neurons / alif_surrogate |

## Time limits

- Ax/batch: 80s (maxt=80)
- Main page: 120s (separate, do not touch)

## Notation example

- "maze2 + eye2 + sensor1 + 2-2" = corridor, binocular, fog_rgb, ALIF
