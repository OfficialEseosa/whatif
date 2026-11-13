"""Smoke-test a running API: python smoke_test.py [base_url]"""
import copy
import json
import sys
import time

import requests

import scenario

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
for _ in range(60):
    try:
        h = requests.get(f"{url}/health", timeout=5).json()
        break
    except Exception:  # noqa: BLE001
        time.sleep(1)
print("health:", h)

edit = scenario.beltline_edit()
t = time.time()
r = requests.post(f"{url}/simulate", json={"edit": edit}, timeout=300)
print("prebaked:", r.status_code, r.headers.get("X-Sim-Source"), f"{len(r.content)/1e6:.1f} MB", f"{time.time()-t:.1f}s")

live = copy.deepcopy(edit)
live["headwayMin"] = 6
t = time.time()
r = requests.post(f"{url}/simulate", json={"edit": live}, timeout=600)
d = r.json()
print("live:", r.status_code, r.headers.get("X-Sim-Source"), f"{len(r.content)/1e6:.1f} MB", f"{time.time()-t:.1f}s",
      json.dumps(d.get("metrics", d))[:300])
