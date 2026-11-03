#!/usr/bin/env python3
"""Focused tests for analyze.py folder-merge + outbox (stdlib unittest).

Run from python/:  python -m unittest test_analyze -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze


def _write(fp, obj):
    fp.write_text(json.dumps(obj), encoding="utf-8")


class MergeTest(unittest.TestCase):
    def test_merge_results_extends_runs_and_picks_best(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            _write(d / "results_a.json", {"group": "g0", "configs": {
                "cfg01": {"config": {"config_id": "cfg01"}, "runs": [
                    {"run": 0, "success": True, "elapsed_s": 10.0, "collisions": 1},
                    {"run": 1, "success": False, "reason": "timeout",
                     "elapsed_s": 60.0, "collisions": 9}],
                    "gains_end": None}}})
            _write(d / "results_b.json", {"group": "g1", "configs": {
                "cfg01": {"config": {"config_id": "cfg01"}, "runs": [
                    {"run": 2, "success": True, "elapsed_s": 12.0, "collisions": 0}],
                    "gains_end": None},
                "cfg02": {"config": {"config_id": "cfg02"}, "runs": [
                    {"run": 0, "success": True, "elapsed_s": 9.0, "collisions": 0}],
                    "gains_end": None}}})
            m = analyze.merge_results(sorted(d.glob("results_*.json")))
            self.assertEqual(len(m["configs"]["cfg01"]["runs"]), 3)
            self.assertEqual(m["groups"], ["g0", "g1"])
            self.assertEqual(m["best_config"], "cfg02")  # 100% beats 2/3

    def test_collect_inputs_dir_and_outbox_bare_name(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "flight_log_x.jsonl").write_text('{"t": 0}\n', encoding="utf-8")
            outbox = d / "outbox"
            outbox.mkdir()
            (outbox / "flight_log_y.jsonl").write_text('{"t": 1}\n', encoding="utf-8")
            self.assertEqual(
                len(analyze.collect_inputs(str(d), "flight_log_*.jsonl", outbox)), 1)
            got = analyze.collect_inputs("flight_log_y.jsonl", "flight_log_*.jsonl", outbox)
            self.assertEqual(got, [outbox / "flight_log_y.jsonl"])
            self.assertEqual(
                analyze.collect_inputs("outbox", "flight_log_*.jsonl", outbox),
                [outbox / "flight_log_y.jsonl"])
            with self.assertRaises(SystemExit):
                analyze.collect_inputs("missing.jsonl", "flight_log_*.jsonl", outbox)


if __name__ == "__main__":
    unittest.main()
