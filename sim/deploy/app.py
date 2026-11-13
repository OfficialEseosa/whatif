"""Vercel entrypoint for the WhatIf ATL sim service (deploy wrapper, not part of sim/).

Wraps sim/main.py's FastAPI app unchanged and adds:
  - lazy baseline load (cold start) in case the platform skips startup events,
  - optional shared-secret check: when SIM_TOKEN is set, POST /simulate needs header X-Sim-Token,
  - gzip of responses (results are several MB of JSON).
"""
from __future__ import annotations

import hmac
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "sim"))

# Vercel's FastAPI preset moves public/ to the CDN, out of the function. Point the sim at a copy
# of the frontend mock (verdict text source) outside public/. No *.sim.json files are shipped,
# so every POST /simulate runs live (the web route serves saved runs itself).
from pathlib import Path  # noqa: E402

import config  # noqa: E402

config.SCENARIO_OUT_DIR = Path(HERE) / "scenario_files"
config.MOCK_SCENARIO = config.SCENARIO_OUT_DIR / "beltline-streetcar.json"

from starlette.middleware.gzip import GZipMiddleware  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402

import main as sim_main  # noqa: E402

app = sim_main.app
_lock = threading.Lock()


def _ensure_loaded() -> None:
    if sim_main.STATE["base"] is None:
        with _lock:
            if sim_main.STATE["base"] is None:
                sim_main._startup()


@app.middleware("http")
async def _guard(request, call_next):
    token = os.environ.get("SIM_TOKEN", "")
    if token and request.url.path.rstrip("/") == "/simulate":
        sent = request.headers.get("x-sim-token", "")
        if not hmac.compare_digest(sent.encode(), token.encode()):
            return JSONResponse({"detail": "missing or bad X-Sim-Token"}, status_code=401)
    if request.url.path.rstrip("/") in ("/simulate", "/health"):
        _ensure_loaded()
    return await call_next(request)


app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)


@app.get("/")
def root():
    return {"service": "whatif-sim", "endpoints": ["GET /health", "POST /simulate"]}
