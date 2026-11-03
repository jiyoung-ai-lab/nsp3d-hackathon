#!/usr/bin/env python3
"""Analyze flight_log.jsonl (local stats + optional Muse Spark narrative).

Local stats only (no API, no tokens):
  python python/analyze.py flight_log_cfg01.jsonl --out analysis.json
  python python/analyze.py ./my_batch_folder --results ./my_batch_folder --out analysis.json

With model narrative (uses hackathon credits — key is meta-models/muse-spark-open-1026 ONLY):
  1) copy .env.sample to .env and fill BASETEN_META_HACKATHON_API_KEY (never commit .env)
  2) drop group files into python/llm_outbox/ (auto-created, stays local, never committed)
  3) python python/analyze.py llm_outbox --results llm_outbox --llm --token-limit 5000000

Inputs accept a FILE, a DIRECTORY (flight_log_*.jsonl / results_*.json merged),
or a bare name resolved under the outbox. Bare --out names are written to the outbox.

Key lookup order: environment variable first, then repo-root .env file.
Token gate: sums total_tokens in credit_log.jsonl; aborts BEFORE the API call
when the limit is already reached. Every model call appends one credit record.
"""
import argparse
import datetime
import json
import math
import os
import sys
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_MODEL = "meta-models/muse-spark-open-1026"
DEFAULT_BASE_URL = "https://inference.baseten.co/v1"
DEFAULT_CREDIT_LOG = HERE / "credit_log.jsonl"
DEFAULT_ENV_FILE = ROOT / ".env"
DEFAULT_OUTBOX = HERE / "llm_outbox"
PROMPT_FAILURE_CAP = 30


def load_dotenv(path):
    """Minimal .env loader (stdlib only): KEY=VALUE lines, # comments, no override."""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v
    except FileNotFoundError:
        pass


def load_dotenv_chain(start):
    """Nearest-wins chain: start dir, then up to 3 parents. Returns files used."""
    start = Path(start).resolve()
    used = []
    for d in reversed([start, *list(start.parents[:3])]):
        p = d / ".env"
        if p.is_file():
            load_dotenv(p)
            used.append(p)
    return used


def load_rows(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def collect_inputs(given, pattern, outbox):
    """File, directory (glob-merged), or bare name under the outbox. Returns file list."""
    p = Path(given)
    if not p.is_absolute() and p.parent == Path(".") and not p.exists():
        if p.name == outbox.name:
            p = outbox
        elif (outbox / p.name).exists():
            p = outbox / p.name
    if p.is_dir():
        files = sorted(p.glob(pattern))
        if not files:
            raise SystemExit(f"no {pattern} in directory: {given}")
        return files
    if p.is_file():
        return [p]
    raise SystemExit(f"input not found: {given}")


def merge_results(files):
    """Merge per-group batch exports (same config across groups: runs extend)."""
    merged = {"schema": "nsp3d-merged", "configs": {}, "best_config": None,
              "groups": [], "files": [str(f) for f in files]}
    for fp in files:
        with open(fp, encoding="utf-8") as f:
            r = json.load(f)
        merged["groups"].append(r.get("group"))
        for cid, c in (r.get("configs") or {}).items():
            d = merged["configs"].setdefault(
                cid, {"config": c.get("config"), "runs": [], "gains_end": None})
            d["runs"].extend(c.get("runs", []))

    def key(cid):
        rr = merged["configs"][cid]["runs"]
        ok = [x for x in rr if x.get("success")]
        rate = len(ok) / len(rr) if rr else 0
        mt = mean([x.get("elapsed_s", 0) for x in rr]) if rr else 0
        mc = mean([x.get("collisions", 0) for x in rr]) if rr else 0
        return (-rate, mt, mc)

    rated = [cid for cid in merged["configs"] if merged["configs"][cid]["runs"]]
    merged["best_config"] = min(rated, key=key) if rated else None
    return merged


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def pearson(xs, ys):
    n = len(xs)
    if n < 3 or len(ys) != n:
        return None
    mx, my = mean(xs), mean(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return cov / math.sqrt(vx * vy)


def local_stats(rows, results=None):
    ts = [r.get("t", 0) for r in rows]
    stats = {
        "rows": len(rows),
        "t_range": [min(ts), max(ts)] if ts else [0, 0],
        "config_ids": sorted({r.get("config_id") for r in rows}),
        "runs": sorted({r.get("run") for r in rows}),
        "mean_threat": {k: round(mean([r.get(k, 0) for r in rows]), 4) for k in ("L", "F", "R", "U", "D")},
        "mean_abs_turn": round(mean([abs(r.get("turn", 0)) for r in rows]), 4),
        "mean_climb": round(mean([r.get("climb", 0) for r in rows]), 4),
        "mean_reward": round(mean([r.get("reward", 0) for r in rows]), 4),
    }
    # Multi-slot logs interleave: group by (config, run, slot) before counting.
    key_of = lambda r: (r.get("config_id"), r.get("run"), r.get("slot"))
    groups = {}
    for r in rows:
        groups.setdefault(key_of(r), []).append(r)

    def grp_coll_ev(g):
        return sum(1 for a, b in zip(g, g[1:]) if b.get("collision", 0) > a.get("collision", 0))

    stats["collisions_final"] = max([g[-1].get("collision", 0) for g in groups.values()] or [0])
    stats["collision_events"] = sum(map(grp_coll_ev, groups.values()))
    per_config = {}
    for (cid, _run, _slot), g in groups.items():
        d = per_config.setdefault(cid, {"rows": 0, "collision_events": 0, "coll_final": 0,
                                        "F": [], "turn": [], "U": [], "D": [], "climb": []})
        d["rows"] += len(g)
        d["collision_events"] += grp_coll_ev(g)
        d["coll_final"] = max(d["coll_final"], g[-1].get("collision", 0))
        for r in g:
            d["F"].append(r.get("F", 0)); d["turn"].append(abs(r.get("turn", 0)))
            d["U"].append(r.get("U", 0)); d["D"].append(r.get("D", 0)); d["climb"].append(r.get("climb", 0))
    for d in per_config.values():
        F, T, U, Dn, C = d.pop("F"), d.pop("turn"), d.pop("U"), d.pop("D"), d.pop("climb")
        d["mean_F"] = round(mean(F), 4)
        d["mean_abs_turn"] = round(mean(T), 4)
        d["mean_climb"] = round(mean(C), 4)
        d["corr_F_turn"] = pearson(F, T)
        d["corr_U_climb"] = pearson(U, C)
        d["corr_D_climb"] = pearson(Dn, C)
    stats["per_config"] = per_config
    stats["corr_front_vs_abs_turn"] = pearson([r.get("F", 0) for r in rows], [abs(r.get("turn", 0)) for r in rows])
    stats["corr_up_vs_climb"] = pearson([r.get("U", 0) for r in rows], [r.get("climb", 0) for r in rows])
    stats["corr_down_vs_climb"] = pearson([r.get("D", 0) for r in rows], [r.get("climb", 0) for r in rows])
    # Failure classification (rule-based, from real fields only).
    fails = []
    if results:
        runs = results.get("runs") or []
        if not runs and isinstance(results.get("configs"), dict):  # batch schema 1.1
            for cid, c in results["configs"].items():
                for r in c.get("runs", []):
                    runs.append({**r, "config_id": cid})
        for r in runs:
            if r.get("success"):
                continue
            cid = r.get("config_id")
            frm = per_config.get(cid, {}).get("mean_F", stats["mean_threat"]["F"])
            if r.get("reason") == "stopped":
                fails.append({"config": cid, "run": r.get("run"), "class": "stopped_by_user"})
            elif (r.get("collisions") or 0) >= 5:
                fails.append({"config": cid, "run": r.get("run"), "class": "collision_loop"})
            elif (frm or 0) >= 0.7:
                fails.append({"config": cid, "run": r.get("run"), "class": "frontal_block_timeout"})
            else:
                fails.append({"config": cid, "run": r.get("run"), "class": "timeout_other"})
    stats["failures"] = fails
    if results and isinstance(results.get("configs"), dict):
        summ = {"best_config": results.get("best_config"), "per_config": {}}
        for cid, c in results["configs"].items():
            rr = c.get("runs", [])
            ok = [x for x in rr if x.get("success")]
            summ["per_config"][cid] = {
                "n": len(rr), "success_rate": round(len(ok) / len(rr), 3) if rr else 0,
                "mean_elapsed": round(mean([x.get("elapsed_s", 0) for x in rr]), 2) if rr else 0,
                "mean_collisions": round(mean([x.get("collisions", 0) for x in rr]), 2) if rr else 0,
                "reasons": dict(sorted(Counter(x.get("reason", "?") for x in rr).items())),
            }
        stats["results_summary"] = summ
    else:
        stats["results_summary"] = results.get("summary") if results else None
    return stats


def credit_total(path):
    total = 0
    if not Path(path).exists():
        return 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                total += int(json.loads(line).get("total_tokens", 0))
            except (ValueError, TypeError):
                pass
    return total


SYSTEM_BRIEF = """You analyze batch stats from NSP3D, a fruit-fly-neuron flight simulator: camera vision \
(5 threat directions L/F/R/U/D, 0=clear 1=blocked) feeds either spiking neurons (SNN) or a \
camera-rule baseline, which outputs turn (yaw, +/-) and climb (+up/-down) to fly a maze \
chamber (1x1m, 20cm tall) to a goal. Each run: success bool, elapsed_s, collisions count.
Healthy signs: corr(front_threat, |turn|) clearly positive (threat evokes steering); \
per-config success_rate high with mean_collisions < 3; mean_F moderate (constant ~1.0 \
means a blinded/saturated camera, constant ~0.0 means a dead sensor). Known failure \
modes: collision_loop (repeated wall hits), frontal_block_timeout (stuck facing a wall), \
ceiling_trap (climbs and cannot descend), timeout_other.
Failure classes in the data are rule-based pre-labels from real fields only; question \
them if the correlations disagree."""

TASK_BRIEF = """Write exactly 4 sections, under 20 lines total:
1) one-line verdict (PASS / MARGINAL / FAIL with the single strongest reason)
2) sensorimotor read (what the 3 correlations + mean threats say about vision->action)
3) failure causes (ranked, with config evidence; challenge the pre-label if wrong)
4) one tuning suggestion (single concrete parameter/threshold change, with expected effect)"""


def call_spark(prompt, model, base_url, api_key, max_tokens=2000):
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a flight-experiment analyst. Answer in Korean, concise, numbers-first."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
        hdrs = {k.lower(): v for k, v in r.headers.items()}
        interesting = {k: v for k, v in hdrs.items()
                       if any(s in k for s in ("remain", "quota", "credit", "limit", "usage", "balance"))}
        return data, interesting


def main(argv=None):
    ap = argparse.ArgumentParser(description="flight_log analyzer (local + optional Spark)")
    ap.add_argument("log", help="flight_log file, directory, or outbox name")
    ap.add_argument("--results", default=None, help="results file, directory, or outbox name (outcome join)")
    ap.add_argument("--out", default=None, help="write analysis JSON here (default: stdout only)")
    ap.add_argument("--llm", action="store_true", help="call Muse Spark for a narrative analysis")
    ap.add_argument("--dry-run", action="store_true",
                    help="print token estimate + prompt shape, make no API call")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--token-limit", type=int, default=0, help="0 = no gate (or TOKEN_LIMIT from env/.env)")
    ap.add_argument("--credit-log", default=str(DEFAULT_CREDIT_LOG))
    ap.add_argument("--outbox", default=str(DEFAULT_OUTBOX), help="Baseten-bound folder (auto-created)")
    ap.add_argument("--env-file", default=None, help="explicit .env (default: auto-search repo-root .env, then parent folders)")
    ap.add_argument("--max-tokens", type=int, default=2000, help="output cap incl. reasoning (model thinks a lot)")
    args = ap.parse_args(argv)

    if args.env_file:
        load_dotenv(args.env_file)
        print(f"[env] using {args.env_file}", file=sys.stderr)
    else:
        used = load_dotenv_chain(ROOT)
        print(f"[env] .env: {', '.join(map(str, used)) or 'none found (env vars only)'}", file=sys.stderr)
    if not args.token_limit:
        try:
            args.token_limit = int(os.environ.get("TOKEN_LIMIT", "0"))
        except ValueError:
            args.token_limit = 0

    outbox = Path(args.outbox)
    outbox.mkdir(parents=True, exist_ok=True)
    log_files = collect_inputs(args.log, "flight_log_*.jsonl", outbox)
    rows = [r for fp in log_files for r in load_rows(fp)]
    if not rows:
        raise SystemExit("empty log")
    results = None
    results_files = []
    if args.results:
        results_files = collect_inputs(args.results, "results_*.json", outbox)
        if len(results_files) == 1:
            with open(results_files[0], encoding="utf-8") as f:
                probe = json.load(f)
            results = merge_results(results_files) if isinstance(probe.get("configs"), dict) else probe
        else:
            results = merge_results(results_files)
    print(f"[inputs] logs={len(log_files)} results={len(results_files)} outbox={outbox}", file=sys.stderr)
    stats = local_stats(rows, results)
    report = {"schema": "nsp3d-analysis/1.0", "log": str(args.log),
              "log_files": [str(f) for f in log_files],
              "results_files": [str(f) for f in results_files],
              "stats": stats, "narrative": None,
              "usage": {"model_calls": 0, "total_tokens": 0}}

    prompt_stats = dict(stats)
    fails = prompt_stats.get("failures", [])
    if len(fails) > PROMPT_FAILURE_CAP:
        prompt_stats["failures"] = fails[:PROMPT_FAILURE_CAP]
        prompt_stats["failures_omitted"] = len(fails) - PROMPT_FAILURE_CAP
    prompt = (SYSTEM_BRIEF + "\n\nBatch stats (JSON):\n" + json.dumps(prompt_stats, ensure_ascii=False)
              + "\n\n" + TASK_BRIEF)

    if args.dry_run:
        spent = credit_total(args.credit_log)
        print(f"[dry-run] prompt_chars={len(prompt)} "
              f"est_prompt_tokens~{len(prompt) // 4} (heuristic chars/4, +/-30%)")
        print(f"[dry-run] failures_shown={len(prompt_stats.get('failures', []))} "
              f"omitted={prompt_stats.get('failures_omitted', 0)} "
              f"max_tokens={args.max_tokens}")
        print(f"[dry-run] credit_spent={spent} limit={args.token_limit or 'none'} "
              f"-> est_total~{len(prompt) // 4}-{len(prompt) // 4 + args.max_tokens}")
        print("[dry-run] no API call made")
    elif args.llm:
        api_key = os.environ.get("BASETEN_META_HACKATHON_API_KEY") or os.environ.get("BASETEN_API_KEY")
        if not api_key:
            raise SystemExit("BASETEN_META_HACKATHON_API_KEY not found (env var or .env file) — never paste keys into files")
        if args.model != DEFAULT_MODEL:
            print(f"WARNING: hackathon key only works with {DEFAULT_MODEL}; requested {args.model}",
                  file=sys.stderr)
        spent = credit_total(args.credit_log)
        if args.token_limit and spent >= args.token_limit:
            raise SystemExit(f"token gate: already spent {spent} >= limit {args.token_limit}; aborting before API call")
        resp, rate_hdrs = call_spark(prompt, args.model, args.base_url, api_key, args.max_tokens)
        text = resp["choices"][0].get("message", {}).get("content") or ""
        if not text:
            print(f"[diag] empty content, finish={resp['choices'][0].get('finish_reason')}", file=sys.stderr)
        usage = resp.get("usage", {})
        report["narrative"] = text
        report["usage"] = {"model_calls": 1,
                           "prompt_tokens": usage.get("prompt_tokens", 0),
                           "completion_tokens": usage.get("completion_tokens", 0),
                           "total_tokens": usage.get("total_tokens", 0)}
        with open(args.credit_log, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "model": args.model, "task": "analyze.py narrative",
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "rate_limit": rate_hdrs,
            }, ensure_ascii=False) + "\n")

    text = json.dumps(report, ensure_ascii=False, indent=1)
    if args.out:
        out_p = Path(args.out)
        if not out_p.is_absolute() and out_p.parent == Path("."):
            out_p = outbox / out_p.name
        out_p.write_text(text, encoding="utf-8")
        print(f"wrote {out_p}")
    else:
        print(text)
    s = stats
    print(f"[summary] rows={s['rows']} F={s['mean_threat']['F']} coll_ev={s['collision_events']} "
          f"fails={len(s['failures'])} llm_calls={report['usage']['model_calls']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
