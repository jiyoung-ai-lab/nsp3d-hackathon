#!/usr/bin/env python3
"""NSP3D local experiment harness.

Phase 1-2: config registry + experiment-page URL builder + static server helper.
Phase 3 (shipped): playwright driver (trial.cjs) + Ax loop (ax_loop.py).

Usage:
  python python/runner.py --list
  python python/runner.py --serve              # http://localhost:8000/pages/experiment.html
  python python/runner.py --test-run 1         # connection check for cfg01 (prints URL + checklist)
  python python/runner.py --configs cfg01,cfg02 --num-runs 10 --max-time 60
"""
import argparse
import functools
import http.server
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONFIGS_PATH = ROOT / "experiments" / "configs.json"
PAGE_PATH = "/pages/experiment.html"
DEFAULT_PORT = 8000


def load_configs():
    with open(CONFIGS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data["_meta"], data["configs"]


def find_config(configs, key):
    for c in configs:
        if c["config_id"] == key:
            return c
    raise SystemExit(f"unknown config_id: {key}")


def build_url(port, config_ids, num_runs, max_time, render="on", autostart=0, seed=None):
    q = {"configs": ",".join(config_ids), "runs": num_runs, "render": render, "autostart": autostart}
    if seed is not None:
        q["seed"] = seed
    return f"http://localhost:{port}{PAGE_PATH}?{urllib.parse.urlencode(q)}"


def serve(port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"serving {ROOT} at http://localhost:{port}/  (Ctrl+C to stop)")
    print(f"experiment page: http://localhost:{port}{PAGE_PATH}")
    srv.serve_forever()


def page_reachable(port):
    try:
        with urllib.request.urlopen(f"http://localhost:{port}{PAGE_PATH}", timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


def main(argv=None):
    ap = argparse.ArgumentParser(description="NSP3D local experiment harness (Phase 1-2)")
    ap.add_argument("--list", action="store_true", help="list config IDs and exit")
    ap.add_argument("--serve", action="store_true", help="serve the repo over HTTP and exit never")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--config", default=None, help="single config_id (shorthand for --configs X)")
    ap.add_argument("--configs", default=None, help="comma-separated config_ids, max 4 (page slots)")
    ap.add_argument("--test-run", type=int, metavar="N",
                    help="connection test: print the single-run URL for N=1 and a checklist")
    ap.add_argument("--num-runs", type=int, default=10)
    ap.add_argument("--max-time", type=float, default=60, help="noted only; page uses each config's max_time_s")
    ap.add_argument("--render", choices=["on", "off"], default="on")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--open", action="store_true", help="open the URL in the default browser")
    args = ap.parse_args(argv)

    meta, configs = load_configs()
    if args.list:
        for c in configs:
            print(f"{c['config_id']}: {c['label']} | {c['maze']} {c['visionMode']}/{c['sensor']} "
                  f"{c['neuronModel']} v={c['cruise_ms']} sens={c['vision_sensitivity']}")
        return 0

    if args.serve:
        serve(args.port)
        return 0

    ids = []
    if args.configs:
        ids = [s.strip() for s in args.configs.split(",") if s.strip()]
    elif args.config:
        ids = [args.config]
    else:
        ids = ["cfg01"]
    if len(ids) > 4:
        raise SystemExit("max 4 configs per batch (page slots)")
    cfgs = [find_config(configs, i) for i in ids]

    if args.test_run is not None:
        if args.test_run != 1:
            raise SystemExit("--test-run only supports 1 in Phase 1-2 (single connection check)")
        url = build_url(args.port, [cfgs[0]["config_id"]], 1, args.max_time, render="on", autostart=0)
        print(f"[test-run] config: {cfgs[0]['config_id']} ({cfgs[0]['label']})")
        if page_reachable(args.port):
            print(f"[test-run] page reachable: {url}")
        else:
            print(f"[test-run] page NOT reachable on port {args.port}. Start a server first:")
            print(f"  python python/runner.py --serve --port {args.port}")
            print(f"  then open: {url}")
        print("[test-run] checklist: 1) page loads without error overlay  2) press Start, "
              "1 run completes  3) Export buttons download flight_log.jsonl / results.json / results.csv")
        print("[test-run] NOTE: no model API is called by the harness, so token usage is 0. "
              "The usage gate applies only to analyze.py --llm calls.")
        if args.open:
            import webbrowser
            webbrowser.open(url)
        return 0

    # Batch request (automated path: ax_loop.py + trial.cjs).
    url = build_url(args.port, [c["config_id"] for c in cfgs], args.num_runs,
                    args.max_time, render=args.render, autostart=0, seed=args.seed)
    print(f"[batch] {'+'.join(c['config_id'] for c in cfgs)} x{args.num_runs} (Phase 1-2: manual run)")
    print(f"[batch] open: {url}")
    print("[batch] press Start. For automation, use ax_loop.py.")
    if args.open:
        import webbrowser
        webbrowser.open(url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
