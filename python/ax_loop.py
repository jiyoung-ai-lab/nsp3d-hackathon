#!/usr/bin/env python3
"""Ax background optimization loop over flight configs (Phase 3).

Study: pick the best (config x sens x cruise) on one maze for code verification and tuning.
Objectives: success_rate -> max, mean_collisions -> min (multi-objective).
Worker: node trial.cjs against pages/experiment.html (headless Chromium).

Usage (from repo root):
  .venv/Scripts/python.exe python/ax_loop.py --study multi0 --maze exp_multi --trials 12 --runs 3
  .venv/Scripts/python.exe python/ax_loop.py --study multi0 --status
  .venv/Scripts/python.exe python/ax_loop.py --study multi0 --stop   # graceful stop file

State: experiments/ax_<study>.json (AxClient snapshot) + ax_<study>.log.
Per-run detail: experiments/ax_<study>_runs.jsonl (time/distance/reason/final_pos).
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TRIAL_JS = HERE / "trial.cjs"
NODE = "node"

OBJECTIVES = ("success_rate", "mean_collisions")


def load_configs(maze, sensors):
    data = json.loads((ROOT / "experiments" / "configs.json").read_text(encoding="utf-8"))
    cfgs = [c for c in data["configs"] if c["maze"] == maze and c["sensor"] in sensors]
    if not cfgs:
        raise SystemExit(f"no configs for maze {maze} sensors {sensors}")
    return cfgs


def make_client(config_ids):
    from ax.service.ax_client import AxClient
    from ax.service.utils.instantiation import ObjectiveProperties

    ax = AxClient()
    ax.create_experiment(
        name="nsp3d-flight",
        parameters=[
            {"name": "config", "type": "choice", "values": config_ids},
            {"name": "sens", "type": "range", "bounds": [0.3, 1.0]},
            {"name": "cruise", "type": "range", "bounds": [0.08, 0.22]},
        ],
        objectives={
            "success_rate": ObjectiveProperties(minimize=False),
            "mean_collisions": ObjectiveProperties(minimize=True),
        },
    )
    return ax


def run_trial(cfg, sens, cruise, runs, seed, learning, timeout_min, maxt, cfgfile=None):
    cmd = [NODE, str(TRIAL_JS), "--config", cfg, "--runs", str(runs),
           "--seed", str(seed), "--sens", f"{sens:.3f}", "--cruise", f"{cruise:.3f}",
           "--maxt", str(maxt),
           "--render", "off", "--timeout", str(timeout_min * 60000)]
    if learning:
        cmd += ["--learning", "1"]
    if cfgfile:
        cmd += ["--cfgfile", cfgfile]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_min * 60 + 120)
    if p.returncode != 0:
        raise RuntimeError(f"trial.cjs exit={p.returncode}: {(p.stderr or '')[-300:]}")
    return json.loads(p.stdout.strip().splitlines()[-1])


def state_paths(study):
    d = ROOT / "experiments"
    return d / f"ax_{study}.json", d / f"ax_{study}.log", d / f"ax_{study}.stop"


def print_best(ax):
    try:  # multi-objective: no single best; show the Pareto front
        pareto = ax.get_pareto_optimal_parameters()
        print(f"pareto-optimal ({len(pareto)}):")
        for idx, (params, (means, _)) in sorted(pareto.items()):
            print(f"  trial {idx}: {params} -> {means}")
    except Exception as e:  # noqa: BLE001 - empty/failed studies
        print("pareto: n/a", e)


def cmd_status(study):
    snap, logp, _ = state_paths(study)
    if not snap.exists():
        print(f"no study {study}")
        return 1
    from ax.service.ax_client import AxClient
    ax = AxClient.load_from_json_file(str(snap))
    df = ax.get_trials_data_frame()
    print(f"study={study} trials={len(df)}")
    print(df.to_string(index=False, max_rows=30))
    print_best(ax)
    if logp.exists():
        print("--- log tail ---")
        print("\n".join(logp.read_text(encoding="utf-8").splitlines()[-8:]))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Ax background loop (Phase 3)")
    ap.add_argument("--study", required=True)
    ap.add_argument("--maze", default="exp_multi")
    ap.add_argument("--trials", type=int, default=12)
    # NOTE: 1 config fans out to 4 slots; runs=4 == exactly 1 wave (1 run/slot).
    ap.add_argument("--runs", type=int, default=4)
    ap.add_argument("--seed-base", type=int, default=20261031)
    ap.add_argument("--learning", type=int, default=0)
    ap.add_argument("--timeout-min", type=int, default=25)
    ap.add_argument("--maxt", type=int, default=80,
                    help="per-run time cap in seconds (patched into max_time_s)")
    ap.add_argument("--sensors", default="fog_rgb,sensor_fusion",
                    help="comma-separated sensor allowlist for candidates")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args(argv)

    snap, logp, stopf = state_paths(args.study)
    if args.status:
        return cmd_status(args.study)
    if args.stop:
        stopf.write_text("stop\n", encoding="utf-8")
        print(f"stop file written: {stopf}")
        return 0

    sensors = [s.strip() for s in args.sensors.split(",") if s.strip()]
    cfgs = load_configs(args.maze, sensors)
    config_ids = [c["config_id"] for c in cfgs]
    runs_path = ROOT / "experiments" / f"ax_{args.study}_runs.jsonl"
    from ax.service.ax_client import AxClient
    if snap.exists():
        ax = AxClient.load_from_json_file(str(snap))
        done = len(ax.get_trials_data_frame())
        print(f"resumed {args.study}: {done} trials done")
    else:
        ax = make_client(config_ids)
        done = 0
        print(f"new study {args.study}: maze={args.maze} configs={len(config_ids)} "
              f"sensors={sensors} maxt={args.maxt}")

    def log(msg):
        line = f"{time.strftime('%H:%M:%S')} {msg}"
        print(line, flush=True)
        with open(logp, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def save_rows(idx, params, seed, payload):
        rec = {"study": args.study, "trial": idx, "params": params, "seed": seed}
        rec.update(payload)
        with open(runs_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    if stopf.exists():
        stopf.unlink()
    target = args.trials
    while done < target:
        if stopf.exists():
            log("STOP file seen -> graceful exit")
            break
        params, idx = ax.get_next_trial()
        seed = args.seed_base + idx * 1000
        log(f"trial {idx}: {params} seed={seed}")
        try:
            r = run_trial(params["config"], params["sens"], params["cruise"],
                          args.runs, seed, args.learning, args.timeout_min, args.maxt)
            log(f"trial {idx} done: rate={r['success_rate']:.2f} coll={r['mean_collisions']} "
                f"time={r['mean_time']}s wall={r['wall_s']}s errors={r['errors']}")
            ax.complete_trial(idx, {"success_rate": r["success_rate"],
                                    "mean_collisions": r["mean_collisions"]})
            save_rows(idx, params, seed, {"ok": True, "rows": r.get("rows", [])})
        except Exception as e:  # noqa: BLE001 - failed trial must not kill the loop
            log(f"trial {idx} FAILED: {e}")
            ax.log_trial_failure(idx)
            save_rows(idx, params, seed, {"ok": False, "error": str(e)[-300:]})
        ax.save_to_json_file(str(snap))
        done += 1
    log(f"study {args.study} finished: {done}/{target} trials")
    try:  # multi-objective: Pareto front, not a single best
        pareto = ax.get_pareto_optimal_parameters()
        for idx, (params, (means, _)) in sorted(pareto.items()):
            log(f"pareto trial {idx}: {params} -> {means}")
    except Exception as e:  # noqa: BLE001
        log(f"pareto: n/a {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
