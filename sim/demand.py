"""Commuter demand from Census LODES8 (GA, OD main, JT00 = all jobs).

Internal flows (home AND work block inside config.BBOX) -> block-group pairs.
Inbound flows (work inside, home outside, within MAX_INBOUND_HOME_KM) -> home tract
-> work block-group pairs; they enter the network at boundary gateways (assign.py).
Outbound flows (live inside, work outside) are NOT modeled (TODO).

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
    zones: pd.DataFrame       # one row per in-box block group: bg, tract, lng, lat, node_idx
    # One row per OD unit. Internal: home BG -> work BG (o = home zone index).
    # Inbound (ext=True): home tract outside the box -> work BG (o = -1; home at hlng/hlat).
    # Columns: o, d, jobs, se_low, se_mid, se_high, peak_trips, ext, home_tract, hlng, hlat
    od: pd.DataFrame
    total_jobs_in_box: int    # internal home+work jobs incl. intrazonal
    intrazonal_jobs: int      # same block group home & work (not assigned)
    blocks: pd.DataFrame | None = None  # in-box block, bg, lng, lat, home_wt, work_wt (display sampling)
    inbound_jobs_total: int = 0      # all LODES jobs in box with home outside, before the distance cutoff
    inbound_dropped_far: int = 0     # dropped: home farther than MAX_INBOUND_HOME_KM

    @property
    def internal(self) -> np.ndarray:
        return ~self.od.ext.values


# ASSUMPTION: inbound commuters whose home is farther than this (straight line from
# the box centre) are dropped as unlikely daily commuters (LODES JT00 counts jobs,
# incl. remote workers and HQ-reported jobs). ~24k of 271k in 2024.
MAX_INBOUND_HOME_KM = 80.0
SE_COLS = ["S000", "SE01", "SE02", "SE03"]


def build_demand(net) -> Demand:
    t = time.time()
    xw = load_xwalk()
    inb = blocks_in_bbox(xw, config.BBOX).set_index("tabblk2020")
    od_all = load_od()
    w_in = od_all.w_geocode.isin(inb.index)
    h_in = od_all.h_geocode.isin(inb.index)
    od = od_all[w_in & h_in].copy()
    ob = od_all[w_in & ~h_in].copy()
    od["h_bg"] = od.h_geocode.str[:12]
    od["w_bg"] = od.w_geocode.str[:12]
    total = int(od.S000.sum())

    # Block-group centroid = flow-weighted mean of its blocks' internal points
    # (internal home + all work activity, incl. inbound workers).
    hb = od.groupby("h_geocode").S000.sum()
    wb = od.groupby("w_geocode").S000.sum().add(ob.groupby("w_geocode").S000.sum(), fill_value=0)
    wts = hb.add(wb, fill_value=0)
    blk = inb.loc[wts.index].assign(wt=wts.values,
                                    home_wt=hb.reindex(wts.index).fillna(0).values,
                                    work_wt=wb.reindex(wts.index).fillna(0).values)
    blk["bg"] = blk.index.str[:12]
    blk["tract"] = blk.index.str[:11]
    zones = blk.groupby("bg").apply(
        lambda g: pd.Series({"tract": g.tract.iloc[0],
                             "lng": np.average(g.blklondd, weights=g.wt),
                             "lat": np.average(g.blklatdd, weights=g.wt),
                             "activity": g.wt.sum()}), include_groups=False).reset_index()
    zones["node_idx"] = snap(net, zones.lng.values, zones.lat.values, connector_only=True)
    zid = {bg: i for i, bg in enumerate(zones.bg)}

    agg = od.groupby(["h_bg", "w_bg"])[SE_COLS].sum().reset_index()
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
    pairs["ext"] = False
    pairs["home_tract"] = zones.tract.values[pairs.o]
    pairs["hlng"] = zones.lng.values[pairs.o]
    pairs["hlat"] = zones.lat.values[pairs.o]

    # Inbound: home tract (outside box) -> work BG. Home point = job-weighted mean of home blocks.
    xwi = xw.set_index("tabblk2020")
    ob["hlat"] = xwi.blklatdd.reindex(ob.h_geocode).values
    ob["hlng"] = xwi.blklondd.reindex(ob.h_geocode).values
    inbound_total = int(ob.S000.sum())
    cx, cy = (config.BBOX[0] + config.BBOX[2]) / 2, (config.BBOX[1] + config.BBOX[3]) / 2
    dkm = np.hypot((ob.hlng - cx) * 111.32 * np.cos(np.deg2rad(cy)), (ob.hlat - cy) * 111.32)
    far = int(ob.S000[dkm > MAX_INBOUND_HOME_KM].sum())
    ob = ob[dkm <= MAX_INBOUND_HOME_KM].copy()
    ob["home_tract"] = ob.h_geocode.str[:11]
    ob["w_bg"] = ob.w_geocode.str[:12]
    ob["wx"] = ob.hlng * ob.S000
    ob["wy"] = ob.hlat * ob.S000
    ea = ob.groupby(["home_tract", "w_bg"])[SE_COLS + ["wx", "wy"]].sum().reset_index()
    tc = ob.groupby("home_tract")[["wx", "wy", "S000"]].sum()
    ext = pd.DataFrame({"o": -1, "d": ea.w_bg.map(zid).values, "jobs": ea.S000.values,
                        "se_low": ea.SE01.values, "se_mid": ea.SE02.values, "se_high": ea.SE03.values,
                        "ext": True, "home_tract": ea.home_tract.values,
                        "hlng": (tc.wx / tc.S000).reindex(ea.home_tract).values,
                        "hlat": (tc.wy / tc.S000).reindex(ea.home_tract).values})
    pairs = pd.concat([pairs, ext], ignore_index=True)
    if config.ASSIGN_MAJOR_ROADS_ONLY:   # large box only (core box: keeps live runs fast)
        pairs = split_destinations(net, zones, blk, pairs)
    else:
        pairs["d_node"] = zones.node_idx.values[pairs.d.values]
    pairs["peak_trips"] = pairs.jobs * PEAK_HOUR_SHARE
    n_int = int(pairs.jobs[~pairs.ext].sum())
    n_ext = int(pairs.jobs[pairs.ext].sum())
    print(f"demand: {len(zones)} block groups; internal {n_int:,} commuters in {(~pairs.ext).sum():,} BG pairs "
          f"(+{intra:,} intrazonal not assigned); inbound {n_ext:,} in {pairs.ext.sum():,} tract->BG pairs "
          f"(dropped {far:,} living > {MAX_INBOUND_HOME_KM:g} km) from LODES {lodes_year()} ({time.time()-t:.1f}s)")
    blocks = blk.rename_axis("block").reset_index()[["block", "bg", "blklondd", "blklatdd", "home_wt", "work_wt"]].rename(
        columns={"blklondd": "lng", "blklatdd": "lat"})
    return Demand(year=lodes_year(), zones=zones, od=pairs, total_jobs_in_box=total, intrazonal_jobs=intra,
                  blocks=blocks, inbound_jobs_total=inbound_total, inbound_dropped_far=far)


# Zone connectors attach to nodes on these road classes (not local residential
# streets), so a big job zone does not load thousands of cars onto one side street.
CONNECTOR_CLASSES = {"tertiary", "secondary", "primary", "trunk", "tertiary_link", "secondary_link",
                     "primary_link"}


# ASSUMPTION: big job zones (Emory, the airport, Downtown) get several road connectors
# instead of one, so their arrivals are not all forced through a single node. Each
# destination block group with more than SPLIT_DEST_MIN_JOBS work activity is split over
# up to SPLIT_DEST_MAX_CONNECTORS connector nodes (its work blocks snapped to the nearest
# tertiary+ node), in proportion to the blocks' LODES job counts.
SPLIT_DEST_MIN_JOBS = 1500
SPLIT_DEST_MAX_CONNECTORS = 6


def split_destinations(net, zones, blk, pairs):
    zones["d_nodes"] = [[int(n)] for n in zones.node_idx]
    zones["d_w"] = [[1.0] for _ in range(len(zones))]
    big = zones.index[zones.activity >= SPLIT_DEST_MIN_JOBS]
    wb = blk[blk.work_wt > 0]
    nodes = snap(net, wb.blklondd.values, wb.blklatdd.values, connector_only=True)
    wb = wb.assign(node=nodes)
    for zi in big:
        g = wb[wb.bg == zones.bg[zi]].groupby("node").work_wt.sum().sort_values(ascending=False)
        g = g.head(SPLIT_DEST_MAX_CONNECTORS)
        if len(g) > 1:
            zones.at[zi, "d_nodes"] = [int(x) for x in g.index]
            zones.at[zi, "d_w"] = list((g / g.sum()).values)
    rows = []
    multi = zones.d_nodes.map(len).values > 1
    keep = pairs[~multi[pairs.d.values]].assign(d_node=lambda p: zones.node_idx.values[p.d.values])
    sp = pairs[multi[pairs.d.values]]
    for zi, g in sp.groupby("d"):
        for nd, w in zip(zones.d_nodes[zi], zones.d_w[zi]):
            rows.append(g.assign(d_node=nd, jobs=g.jobs * w, se_low=g.se_low * w, se_mid=g.se_mid * w,
                                 se_high=g.se_high * w))
    out = pd.concat([keep] + rows, ignore_index=True)
    # internal pairs whose split destination node equals the origin node have no road path
    same = (~out.ext.values) & (zones.node_idx.values[np.maximum(out.o.values, 0)] == out.d_node.values)
    out = out[~same].reset_index(drop=True)
    print(f"  split {len(big)} big destination zones over up to {SPLIT_DEST_MAX_CONNECTORS} connectors "
          f"({len(pairs):,} -> {len(out):,} OD rows; {pairs.jobs.sum() - out.jobs.sum():,.0f} jobs dropped as same-node)")
    return out


def snap(net, lng, lat, connector_only: bool = False) -> np.ndarray:
    """Nearest node in the strongly connected core (so every zone pair is routable);
    with connector_only, nearest such node on a CONNECTOR_CLASSES road."""
    lat0 = np.deg2rad(np.mean(net.node_xy[:, 1]))
    ok = np.where(net.in_scc)[0] if getattr(net, "in_scc", None) is not None else np.arange(net.n_nodes)
    if connector_only:
        e = net.edges[net.edges.highway.isin(CONNECTOR_CLASSES)]
        ok = np.intersect1d(ok, np.union1d(e.u_idx.values, e.v_idx.values))
    pts = np.c_[net.node_xy[ok, 0] * np.cos(lat0), net.node_xy[ok, 1]]
    tree = cKDTree(pts)
    _, idx = tree.query(np.c_[np.asarray(lng) * np.cos(lat0), np.asarray(lat)])
    return ok[idx]


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









