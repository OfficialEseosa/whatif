"""FastAPI service.

    uvicorn main:app --port 8000          (run from sim/, venv active)

GET  /health    -> status, baseline timings, prebaked scenario ids
POST /simulate  -> body {"edit": ScenarioEdit, "claims"?: [...]} returns ScenarioResult.
                   Serves a prebaked public/scenarios/*.sim.json when its edit matches
                   (ignoring `assumptions`), otherwise runs live on the cached baseline.
"""
from __future__ import annotations

import hashlib
import json
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

import config
import export
from contract import SimulateRequest
from model import load_baseline

app = FastAPI(title="WhatIf ATL sim", version="0.1")
app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])

STATE: dict = {"base": None, "prebaked": {}, "load_s": None}
LIVE_SAMPLE = 2000  # smaller display sample for live runs (faster response)


def _norm(v):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return round(float(v), 6)  # 10 and 10.0 must hash the same
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items() if x is not None}
    return [_norm(x) for x in v]


def edit_key(edit: dict) -> str:
    e = {k: v for k, v in edit.items() if k not in ("assumptions", "name") and v is not None}
    if e.get("roadIds"):  # same rule as src/lib/scenarios.ts editKey
        e["roadIds"] = sorted(e["roadIds"])
    return hashlib.sha1(json.dumps(_norm(e), sort_keys=True).encode()).hexdigest()


def index_prebaked() -> dict:
    out = {}
    for p in sorted(config.SCENARIO_OUT_DIR.glob("*.sim.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(d, dict) and "edit" in d:
                out[edit_key(d["edit"])] = p
        except Exception:  # noqa: BLE001
            continue
    return out


@app.on_event("startup")
def _startup():
    t = time.time()
    STATE["base"] = load_baseline(verbose=False)
    STATE["prebaked"] = index_prebaked()
    STATE["load_s"] = round(time.time() - t, 2)


@app.get("/health")
def health():
    return {"ok": STATE["base"] is not None, "baselineLoadSeconds": STATE["load_s"],
            "bbox": list(config.BBOX), "prebaked": sorted(p.name for p in STATE["prebaked"].values()),
            "populationModeled": int(STATE["base"].dem.od.jobs.sum()) if STATE["base"] else None}


@app.post("/simulate")
def simulate(req: SimulateRequest):
    edit = req.edit.model_dump(exclude_none=True)
    key = edit_key(edit)
    if key in STATE["prebaked"]:
        return Response(STATE["prebaked"][key].read_bytes(), media_type="application/json",
                        headers={"X-Sim-Source": "prebaked"})
    import scenario

    import edits

    try:
        res = scenario.run_scenario(edit, f"live-{key[:8]}", n_sample=LIVE_SAMPLE, base=STATE["base"], verbose=False)
    except edits.EditError as ex:   # plain message the site can show ("X is outside the area ...")
        raise HTTPException(status_code=422, detail=str(ex)) from ex
    except NotImplementedError as ex:
        raise HTTPException(status_code=501, detail=str(ex)) from ex
    timings = res.pop("_timings", {})
    res["source"] = "live_sim"
    return Response(json.dumps(res, separators=(",", ":")), media_type="application/json",
                    headers={"X-Sim-Source": "live", "X-Sim-Seconds": f"{timings.get('total_s', 0):.1f}"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)


