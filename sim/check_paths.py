"""Regression check: do drawn agent paths follow real network geometry?

    python check_paths.py [scenario ids...]     (default: baseline beltline-streetcar)

Reference geometry = OSM drive edges (also the walk proxy) + all MARTA GTFS shapes
+ the scenario's proposed line.path. Each path is sampled every SAMPLE_M; a sample
farther than OFF_NETWORK_M from any reference geometry is "off-network". Reports
per file: share of agents with an off-network run longer than STUB_M / ALERT_M,
off-network share of total length, and the worst offenders.
"""
from __future__ import annotations

import json
import sys
import zipfile

import numpy as np
import pandas as pd
from scipy import ndimage

import config

OFF_NETWORK_M = 25.0     # farther than this from any network geometry = off-network
SAMPLE_M = 5.0           # sampling step along each path
CELL_M = 5.0             # raster resolution of the reference mask
STUB_M = 150.0           # report agents with runs longer than this (display.MAX_STUB_M = 50 m)
ALERT_M = 60.0           # report agents with any off-network run longer than this
MARGIN_DEG = 0.02
LAT0 = np.cos(np.deg2rad(33.765))
K = 111_320.0


class Mask:
    def __init__(self, lines):
        w, s, e, n = config.BBOX
        self.x0 = (w - MARGIN_DEG) * LAT0 * K
        self.y0 = (s - MARGIN_DEG) * K
        nx = int(((e - w + 2 * MARGIN_DEG) * LAT0 * K) / CELL_M) + 1
        ny = int(((n - s + 2 * MARGIN_DEG) * K) / CELL_M) + 1
        grid = np.zeros((ny, nx), bool)
        for ln in lines:
            p = self._xy(np.asarray(ln, float))
            if len(p) < 2:
                continue
            seg = np.diff(p, axis=0)
            L = np.hypot(seg[:, 0], seg[:, 1])
            for (a, d, l) in zip(p[:-1], seg, L):
                k = max(1, int(l / (CELL_M / 2)))
                t = np.linspace(0, 1, k + 1)[:, None]
                q = a + t * d
                self._mark(grid, q)
        # distance (m) from each cell to the nearest network cell
        self.dist = ndimage.distance_transform_edt(~grid) * CELL_M
        self.shape = grid.shape

    def _xy(self, ll):
        return np.c_[ll[:, 0] * LAT0 * K, ll[:, 1] * K]

    def _mark(self, grid, q):
        ix = ((q[:, 0] - self.x0) / CELL_M).astype(int)
        iy = ((q[:, 1] - self.y0) / CELL_M).astype(int)
        ok = (ix >= 0) & (iy >= 0) & (ix < grid.shape[1]) & (iy < grid.shape[0])
        grid[iy[ok], ix[ok]] = True

    def lookup(self, q):
        ix = ((q[:, 0] - self.x0) / CELL_M).astype(int)
        iy = ((q[:, 1] - self.y0) / CELL_M).astype(int)
        ok = (ix >= 0) & (iy >= 0) & (ix < self.shape[1]) & (iy < self.shape[0])
        d = np.full(len(q), np.inf)
        d[ok] = self.dist[iy[ok], ix[ok]]
        return d


def reference_lines():
    from network import load_display_network

    net = load_display_network()
    lines = list(net.edge_geoms)
    z = zipfile.ZipFile(config.GTFS_FILE)
    sh = pd.read_csv(z.open("shapes.txt"), dtype={"shape_id": str})
    w, s, e, n = config.BBOX
    sh = sh[(sh.shape_pt_lon.between(w - MARGIN_DEG, e + MARGIN_DEG)) &
            (sh.shape_pt_lat.between(s - MARGIN_DEG, n + MARGIN_DEG))]
    for _, g in sh.sort_values(["shape_id", "shape_pt_sequence"]).groupby("shape_id"):
        lines.append(g[["shape_pt_lon", "shape_pt_lat"]].values)
    return lines


def path_stats(mask, path):
    p = mask._xy(np.asarray(path, float))
    if len(p) < 2:
        return 0.0, 0.0, 0.0
    pts, total = [], 0.0
    for a, b in zip(p[:-1], p[1:]):
        L = float(np.hypot(*(b - a)))
        total += L
        k = max(1, int(L / SAMPLE_M))
        t = np.linspace(0, 1, k + 1)[:-1, None]
        pts.append(a + t * (b - a))
    pts.append(p[-1:])
    q = np.vstack(pts)
    off = mask.lookup(q) > OFF_NETWORK_M
    # longest consecutive off run (approx metres)
    longest, run = 0, 0
    for o in off:
        run = run + 1 if o else 0
        longest = max(longest, run)
    step = total / max(len(q) - 1, 1)
    return total, float(off.sum() * step), float(longest * step)


def check(ids):
    base_lines = reference_lines()
    for sid in ids:
        f = config.SCENARIO_OUT_DIR / f"{sid}.sim.json"
        r = json.loads(f.read_text(encoding="utf-8"))
        lines = base_lines + ([r["line"]["path"]] if len(r["line"]["path"]) >= 2 else [])
        mask = Mask(lines)
        rows = []
        for a in r["agents"]:
            for which in ("baseline", "proposed"):
                t = a[which]
                total, off, longest = path_stats(mask, t["path"])
                rows.append((a["id"], which, t["mode"], total, off, longest))
        df = pd.DataFrame(rows, columns=["id", "trip", "mode", "len", "off", "longest"])
        ag = df.groupby("id").longest.max()
        print(f"== {sid}: {len(ag)} agents, {len(df)} trips, {f.stat().st_size/1e6:.2f} MB")
        print(f"  off-network share of drawn length: {df.off.sum() / df.len.sum():.2%}")
        for thr in (STUB_M, ALERT_M, 25.0):
            print(f"  agents with an off-network run > {thr:g} m: {(ag > thr).mean():.1%} ({int((ag > thr).sum())})")
        print("  by mode (trips with run > 60 m / trips, longest run):")
        for m, g in df.groupby("mode"):
            print(f"    {m:10s} {int((g.longest > ALERT_M).sum()):5d} / {len(g):5d}   max {g.longest.max():7.0f} m")
        worst = df.sort_values("longest", ascending=False).head(8)
        print("  worst:", "; ".join(f"{x.id}/{x.trip}/{x['mode']} {x.longest:.0f} m" for _, x in worst.iterrows()))


if __name__ == "__main__":
    check(sys.argv[1:] or ["baseline", "beltline-streetcar"])


