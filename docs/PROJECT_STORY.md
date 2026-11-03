# Why We Started, What We Did, Where We Are (2026-11-03)

A common source for the submission statement, video description, and README. All numerical claims follow the claim guide: descriptive statistics only, no significance testing, and clearly defined scopes.

## Why We Started

How does a small insect fly while avoiding obstacles?

We started with three core questions:

* Q1. Can a lightweight virtual laboratory run on the web?
* Q2. Can neurons improve flight efficiency?
* Q3. Can it go further and learn?

Why the name "Playground"? Because it is a place for lightweight, in-browser experiments that require no installation.

## What We Did

* Built a browser-only 3D flight simulator using Three.js, with a 1m × 1m × 0.20m chamber and 10 maze layouts.
* Implemented a 1,854-neuron SNN based on the Male CNS v1.0 connectome, with LIF as the default model and an optional ALIF surrogate plugin.
* Integrated four vision configurations (Fog, Depth, Optical Flow, and Sensor Fusion), supporting both monocular and binocular cameras. A camera-based rule controller is included as a baseline.
* Conducted 195 Ax Bayesian search trials, followed by holdout testing and a main test matrix (9 mazes × LIF/ALIF × monocular/binocular × Fog/Fusion), plus 48 waves of m16 testing — approximately 1,500 flights in total.
* Set up dual workers across a laptop and PC, including same-condition equivalence checks.
* Achieved 176 passing unit tests, verified 380-field Fog parity, and CLOSED the full Fog regression.

## Where We Are

* **Q1 — Virtual laboratory: Yes.** Its existence is the evidence. Approximately 1,500 flights have been run in the browser.

* **Q2 — Neural flight efficiency: Conditional.** In difficult corridor and zigzag mazes, the neural controller outperformed the camera-based rule controller. In the corridor Ax search, the camera controller was tested only four times. The Fog optimum achieved 100% success with zero collisions, and the result held in the holdout test.

  However, in easy mazes, the camera rule controller performed better, achieving 98% success and the fastest completion time of 4.65 seconds. The ALIF improvement of +5.8 percentage points also depends on two rescue cells, so it is not robust.

  Our claim is therefore limited to **"neural controller advantages on hard tasks."**

* **Q3 — Learning: Unproven.** The R-STDP pathway is wired, but all reported results were obtained with learning turned OFF.

## Next (After Submission)

* **Complete Q2:** Perform significance testing, rerun m16 with balanced conditions to resolve sensor-worker confounding, and conduct random-maze holdout testing.
* **Start Q3:** Run learning-ON batches and demonstrate gain changes alongside performance curves.
* **Sim-to-real (physical drone):** This is a separate project. No claims are made based on the current data.
