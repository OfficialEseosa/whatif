"""CLI entry points.

    python run.py baseline [--rebuild] [--sample 3000]   -> public/scenarios/baseline.sim.json
    python run.py beltline [--sample 3000]               -> public/scenarios/beltline-streetcar.sim.json
    python run.py sanity                                  -> prints common-sense checks
"""
from __future__ import annotations

import argparse
import time

import numpy as np

import export
from model import load_baseline

# The contract has no "baseline" edit type; a no-op change_frequency with no
# stops stands in for it. (Proposed contract change: allow edit type "baseline".)
BASELINE_EDIT = {"type": "change_frequency", "name": "Baseline (no change)", "stops": [],
                 "assumptions": ["Baseline network: no edit applied."]}


def cmd_baseline(a):
    t = time.time()
    base = load_baseline(rebuild=a.rebuild)
    t_model = time.time() - t
    res = export.build_result("baseline", "Today's network (baseline)", BASELINE_EDIT, base, None,
                              n_sample=a.sample)
    export.write_result(res)
    print(f"baseline: model/cache {t_model:.1f}s, export {time.time()-t-t_model:.1f}s")


def cmd_beltline(a):
    import scenario

    scenario.run_beltline(n_sample=a.sample)


def cmd_sanity(a):
    import sanity

    sanity.main()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["baseline", "beltline", "sanity"])
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--sample", type=int, default=export.DISPLAY_SAMPLE_SIZE)
    a = ap.parse_args()
    {"baseline": cmd_baseline, "beltline": cmd_beltline, "sanity": cmd_sanity}[a.cmd](a)
