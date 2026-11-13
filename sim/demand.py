"""Commuter demand from Census LODES8 (GA, OD main, JT00 = all jobs).

Keeps flows whose home block AND work block both fall inside config.BBOX,
aggregates to block-group pairs with job counts, and snaps each block group to
its nearest drive-network node.

    python demand.py            # build + print summary
    python demand.py --sizes    # how many in-box commuters different boxes give
"""
from __future__ import annotations

import argparse
import glob
import pickle
import re
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

import config

# ASSUMPTION: share of daily commuters travelling in the modeled AM peak hour.
# Placeholder for ACS B08302 (time leaving home); ~25% of US commuters leave in
# the busiest hour. TODO: replace with per-tract B08302 7:00-7:59 share.
PEAK_HOUR_SHARE = 0.25

DEMAND_CACHE = config.CACHE_DIR / f"demand_{config.bbox_tag()}.pkl"


def lodes_file() -> str:
    files = sorted(glob.glob(str(config.DATA_DIR / config.LODES_GLOB)))
    if not files:
        raise FileNotFoundError("LODES OD file missing - run fetch_data.py")
    return files[-1]


def lodes_year() -> int:
    return int(re.search(r"(\d{4})\.csv", lodes_file()).group(1))


def load_xwalk() -> pd.DataFrame:
    xw = pd.read_csv(config.XWALK_FILE, usecols=["tabblk2020", "trct", "bgrp", "blklatdd", "blklondd"],
                     dtype={"tabblk2020": str, "trct": str, "bgrp": str})
    return xw


def blocks_in_bbox(xw: pd.DataFrame, bbox) -> pd.DataFrame:
    w, s, e, n = bbox
    m = (xw.blklondd >= w) & (xw.blklondd <= e) & (xw.blklatdd >= s) & (xw.blklatdd <= n)
    return xw[m]


def load_od() -> pd.DataFrame:
    return pd.read_csv(lodes_file(), usecols=["w_geocode", "h_geocode", "S000", "SE01", "SE02", "SE03"],
                       dtype={"w_geocode": str, "h_geocode": str, "S000": np.int32,
                              "SE01": np.int32, "SE02": np.int32, "SE03": np.int32})


@dataclass
class Demand:
    year: int
    zones: pd.DataFrame       # one row per block group: bg, tract, lng, lat, node_idx
    od: pd.DataFrame          # o, d (zone index), jobs, peak_trips
    total_jobs_in_box: int    # all in-box home+work jobs incl. intrazonal
    intrazonal_jobs: int      # same block group home & work (not assigned)


def build_demand(net) -> Demand:
    t = time.time()
    xw = load_xwalk()
    inb = blocks_in_bbox(xw, config.BBOX).set_index("tabblk2020")
    od = load_od()
    od = od[od.h_geocode.isin(inb.index) & od.w_geocode.isin(inb.index)].copy()
    od["h_bg"] = od.h_geocode.str[:12]
    od["w_bg"] = od.w_geocode.str[:12]
    total = int(od.S000.sum())

    # Block-group centroid = flow-weighted mean of its blocks' internal points.
    hb = od.groupby("h_geocode").S000.sum()
    wb = od.groupby("w_geocode").S000.sum()
    wts = hb.add(wb, fill_value=0)
    blk = inb.loc[wts.index].assign(wt=wts.values)
    blk["bg"] = blk.index.str[:12]
    blk["tract"] = blk.index.str[:11]
    zones = blk.groupby("bg").apply(
        lambda g: pd.Series({"tract": g.tract.iloc[0],
                             "lng": np.average(g.blklondd, weights=g.wt),
                             "lat": np.average(g.blklatdd, weights=g.wt),
                             "activity": g.wt.sum()}), include_groups=False).reset_index()
    zones["node_idx"] = snap(net, zones.lng.values, zones.lat.values)
    zid = {bg: i for i, bg in enumerate(zones.bg)}

    agg = od.groupby(["h_bg", "w_bg"])[["S000", "SE01", "SE02", "SE03"]].sum().reset_index()
    intra = int(agg.loc[agg.h_bg == agg.w_bg, "S000"].sum())
    agg = agg[agg.h_bg != agg.w_bg]
    pairs = pd.DataFrame({"o": agg.h_bg.map(zid).values, "d": agg.w_bg.map(zid).values,
                          "jobs": agg.S000.values,
                          # LODES earnings bands: SE01 <= $1,250/mo, SE02 $1,251-3,333, SE03 > $3,333
                          "se_low": agg.SE01.values, "se_mid": agg.SE02.values, "se_high": agg.SE03.values})
    # Pairs that snap to the same node have no road path; treat as intrazonal.
    same = zones.node_idx.values[pairs.o] == zones.node_idx.values[pairs.d]
    intra += int(pairs.jobs[same].sum())
    pairs = pairs[~same].reset_index(drop=True)
    pairs["peak_trips"] = pairs.jobs * PEAK_HOUR_SHARE
    print(f"demand: {len(zones)} block groups, {len(pairs)} OD pairs, {pairs.jobs.sum():,} commuters "
          f"(+{intra:,} intrazonal not assigned) from LODES {lodes_year()} ({time.time()-t:.1f}s)")
    return Demand(year=lodes_year(), zones=zones, od=pairs, total_jobs_in_box=total, intrazonal_jobs=intra)


def snap(net, lng, lat) -> np.ndarray:
    lat0 = np.deg2rad(np.mean(net.node_xy[:, 1]))
    pts = np.c_[net.node_xy[:, 0] * np.cos(lat0), net.node_xy[:, 1]]
    tree = cKDTree(pts)
    _, idx = tree.query(np.c_[np.asarray(lng) * np.cos(lat0), np.asarray(lat)])
    return idx


def load_demand(net, rebuild: bool = False) -> Demand:
    if DEMAND_CACHE.exists() and not rebuild:
        with open(DEMAND_CACHE, "rb") as f:
            return pickle.load(f)
    d = build_demand(net)
    with open(DEMAND_CACHE, "wb") as f:
        pickle.dump(d, f)
    return d


def box_sizes() -> None:
    """Report in-box commuter counts (home and work both inside) for nested boxes."""
    xw = load_xwalk()
    od = load_od()
    cx, cy = -84.385, 33.765
    boxes = {"current (config.BBOX)": config.BBOX}
    for half in (0.06, 0.08, 0.10, 0.13, 0.16, 0.20):
        boxes[f"+/-{half:.2f} deg around ({cx},{cy})"] = (cx - half, cy - half * 0.83, cx + half, cy + half * 0.83)
    for name, b in boxes.items():
        ids = set(blocks_in_bbox(xw, b).tabblk2020)
        m = od.h_geocode.isin(ids) & od.w_geocode.isin(ids)
        km_w = (b[2] - b[0]) * 92.6
        km_h = (b[3] - b[1]) * 111.0
        print(f"{name:42s} {km_w:5.1f} x {km_h:5.1f} km  in-box commuters: {int(od.S000[m].sum()):>9,}  "
              f"(work in box from anywhere: {int(od.S000[od.w_geocode.isin(ids)].sum()):,})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", action="store_true")
    a = ap.parse_args()
    if a.sizes:
        box_sizes()
    else:
        from network import load_network

        import demand as _self  # pickle under module name

        d = _self.load_demand(load_network(), rebuild=True)
        print(d.zones.head())
        print(f"total in-box jobs {d.total_jobs_in_box:,}; tracts {d.zones.tract.nunique()}")


