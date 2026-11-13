"""Prebake saved runs for the app's example prompts.

    python prebake.py edits.json [--only id] [--sample 3000]

edits.json: [{"id": "<file stem>", "edit": <ScenarioEdit exactly as /api/plan returns it>}, ...]
Writes public/scenarios/<id>.sim.json (result id == file stem), so /api/simulate's
edit-matching rule (edit equality ignoring name/assumptions) finds it.
"""
from __future__ import annotations

import argparse
import json
import time

import export
import scenario
from model import load_baseline


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("edits")
    ap.add_argument("--only", default=None)
    ap.add_argument("--sample", type=int, default=export.DISPLAY_SAMPLE_SIZE)
    a = ap.parse_args()
    items = json.loads(open(a.edits, encoding="utf-8-sig").read())
    base = load_baseline(verbose=False)
    for it in items:
        if a.only and it["id"] != a.only:
            continue
        t = time.time()
        res = scenario.run_scenario(it["edit"], it["id"], n_sample=a.sample, base=base, verbose=False)
        tm = res.pop("_timings", {})
        res["source"] = "prebaked_sim"
        export.write_result(res, it["id"])
        mb, mp = res["metrics"]["baseline"], res["metrics"]["proposed"]
        v = res["verdict"]
        print(f"{it['id']}: {v['label']} | {v['headline']} | transit {mb['transitShare']:.4f}->{mp['transitShare']:.4f}"
              f" | riders on line {tm.get('riders_on_line', 0):,.0f} | model {tm.get('model_s', 0):.1f}s total {time.time()-t:.1f}s")
        for tt in v["tests"]:
            print(f"    {tt['key']:24s} {tt['value']:>10} {tt['unit']:10s} {tt['grade']}")


if __name__ == "__main__":
    main()

