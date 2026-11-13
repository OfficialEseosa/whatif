"""Frequency-based transit graph from MARTA GTFS (rail, streetcar, bus).

Graph layers (all in one scipy CSR):
    Zo[z]  origin zone          --walk-->        A[s]  stop, not yet boarded
    A[s]   --wait = headway/2-->                 RS[r] route-stop (pattern p at stop s)
    RS     --in-vehicle (schedule)-->            RS next stop on the pattern
    RS     --alight-->                           B[s]  stop, already boarded
    B[s]   --wait + TRANSFER_PENALTY-->          RS    (transfer)
    B[s]   --walk (<= TRANSFER_MAX_M)-->         B[s'] (walk transfer between stops)
    B[s]   --walk-->                             Zd[z] destination zone
Separate A/B layers force >= 1 boarding and apply the transfer penalty only to
2nd+ boardings. Separate Zo/Zd stop paths from passing *through* a zone.
"""
from __future__ import annotations

import pickle
import time
import zipfile
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

import config

# ---- ASSUMPTIONS (README "Assumptions and placeholders") -------------------
WALK_SPEED_KPH = 4.8
WALK_CIRCUITY = 1.3            # network walk distance / straight-line distance
ACCESS_MAX_M = 1000.0          # max straight-line walk zone <-> stop
TRANSFER_MAX_M = 300.0         # max straight-line walk between stops on a transfer
TRANSFER_PENALTY_MIN = 5.0     # perceived extra cost per transfer (also counted in minutes)
MAX_HEADWAY_MIN = 60.0         # patterns rarer than this in the peak are dropped
PEAK_WINDOW = (7 * 3600, 9 * 3600)   # headways measured over 7-9 AM weekday
BBOX_BUFFER_DEG = 0.01         # keep stops slightly outside the box (stations at the edge)
INCLUDE_BUS = True             # rail + streetcar always; bus can be switched off
MODE_NAMES = {0: "streetcar", 1: "rail", 2: "rail", 3: "bus"}

TRANSIT_CACHE = config.CACHE_DIR / f"transit_base_{config.bbox_tag()}.pkl"
EPS = 1e-3


def _hms(s: str) -> int:
    h, m, sec = (int(x) for x in s.split(":"))
    return h * 3600 + m * 60 + sec


def _xy(lng, lat, lat0):
    """Equirectangular metres - fine at city scale."""
    k = 111_320.0
    return np.c_[np.asarray(lng) * k * np.cos(np.deg2rad(lat0)), np.asarray(lat) * k]


@dataclass
class Pattern:
    pattern_id: str
    route_id: str
    route_name: str
    mode: str
    headway_min: float
    stop_ids: list            # ordered stop ids
    ivt_s: list               # len(stop_ids)-1 in-vehicle seconds
    color: str = ""
    path: list | None = None  # optional drawn geometry [[lng,lat],...]
    hop_paths: list | None = None  # optional per-hop polylines (len(stop_ids)-1), for display


@dataclass
class TransitData:
    stops: pd.DataFrame                       # stop_id (str), name, lng, lat
    patterns: list = field(default_factory=list)


def load_gtfs() -> TransitData:
    t = time.time()
    z = zipfile.ZipFile(config.GTFS_FILE)
    rd = lambda n, **k: pd.read_csv(z.open(n), dtype=str, **k)  # noqa: E731
    stops = rd("stops.txt")
    stops["lat"] = stops.stop_lat.astype(float)
    stops["lng"] = stops.stop_lon.astype(float)
    w, s, e, n = config.BBOX
    b = BBOX_BUFFER_DEG
    inbox = stops[(stops.lng >= w - b) & (stops.lng <= e + b) & (stops.lat >= s - b) & (stops.lat <= n + b)]
    inbox_ids = set(inbox.stop_id)

    cal = rd("calendar.txt")
    weekday = set(cal.loc[(cal.monday == "1") & (cal.tuesday == "1") & (cal.wednesday == "1"), "service_id"])
    routes = rd("routes.txt").set_index("route_id")
    trips = rd("trips.txt")
    trips = trips[trips.service_id.isin(weekday)]
    if not INCLUDE_BUS:
        keep_r = routes.index[routes.route_type != "3"]
        trips = trips[trips.route_id.isin(keep_r)]
    st = rd("stop_times.txt", usecols=["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"])
    st = st[st.trip_id.isin(set(trips.trip_id)) & st.stop_id.isin(inbox_ids)].copy()
    st["seq"] = st.stop_sequence.astype(int)
    st["t"] = st.departure_time.map(_hms)
    st = st.sort_values(["trip_id", "seq"])
    trip_info = trips.set_index("trip_id")[["route_id", "direction_id"]]

    patterns = []
    groups = st.groupby("trip_id")
    by_rd: dict = {}
    for trip_id, g in groups:
        if len(g) < 2:
            continue
        t_first = g.t.iloc[0]
        if not (PEAK_WINDOW[0] <= t_first < PEAK_WINDOW[1]):
            continue
        r, d = trip_info.loc[trip_id]
        by_rd.setdefault((r, d), []).append((tuple(g.stop_id), tuple(np.diff(g.t.values)), tuple(np.diff(g.seq.values))))
    hours = (PEAK_WINDOW[1] - PEAK_WINDOW[0]) / 3600
    for (r, d), lst in by_rd.items():
        headway = 60.0 * hours / len(lst)
        if headway > MAX_HEADWAY_MIN:
            continue
        seqs = Counter(x[0] for x in lst)
        top, _ = seqs.most_common(1)[0]
        ivts = np.array([x[1] for x in lst if x[0] == top], dtype=float)
        seqgaps = [x[2] for x in lst if x[0] == top][0]
        ivt = np.median(ivts, axis=0)
        # GTFS times are minute-rounded; floor each hop at 30 s.
        ivt = np.maximum(ivt, 30.0)
        # Split where the trip left the box and came back (non-consecutive stop_sequence).
        cut = [0] + [i + 1 for i, gap in enumerate(seqgaps) if gap != 1] + [len(top)]
        rt = routes.loc[r]
        for ci in range(len(cut) - 1):
            a, bb = cut[ci], cut[ci + 1]
            if bb - a < 2:
                continue
            patterns.append(Pattern(
                pattern_id=f"{r}_{d}_{ci}", route_id=r,
                route_name=str(rt.route_short_name if isinstance(rt.route_short_name, str) else r),
                mode=MODE_NAMES.get(int(rt.route_type), "bus"), headway_min=round(headway, 1),
                stop_ids=list(top[a:bb]), ivt_s=list(ivt[a:bb - 1]),
                color=str(rt.get("route_color", "")),
            ))
    used = {s for p in patterns for s in p.stop_ids}
    out_stops = inbox[inbox.stop_id.isin(used)][["stop_id", "stop_name", "lng", "lat"]].rename(
        columns={"stop_name": "name"}).reset_index(drop=True)
    by_mode = Counter(p.mode for p in patterns)
    print(f"transit: {len(out_stops)} stops, {len(patterns)} peak patterns {dict(by_mode)} ({time.time()-t:.1f}s)")
    return TransitData(stops=out_stops, patterns=patterns)


def load_transit_base(rebuild: bool = False) -> TransitData:
    if TRANSIT_CACHE.exists() and not rebuild:
        with open(TRANSIT_CACHE, "rb") as f:
            return pickle.load(f)
    td = load_gtfs()
    with open(TRANSIT_CACHE, "wb") as f:
        pickle.dump(td, f)
    return td


@dataclass
class TransitGraph:
    csr: csr_matrix
    n_zones: int
    n_stops: int
    node_xy: np.ndarray          # coords per node
    node_kind: np.ndarray        # 0 Zo, 1 Zd, 2 A, 3 B, 4 RS
    rs_pattern: np.ndarray       # pattern index per RS node (-1 otherwise, full length)
    rs_pos: np.ndarray           # position of the RS node within its pattern (-1 otherwise)
    patterns: list

    def zo(self, z):
        return z

    def zd(self, z):
        return self.n_zones + z


def build_graph(td: TransitData, zones: pd.DataFrame) -> TransitGraph:
    Z = len(zones)
    stops = td.stops.reset_index(drop=True)
    S = len(stops)
    sidx = {sid: i for i, sid in enumerate(stops.stop_id)}
    lat0 = float(zones.lat.mean())
    sxy = _xy(stops.lng, stops.lat, lat0)
    zxy = _xy(zones.lng, zones.lat, lat0)
    walk_mps = WALK_SPEED_KPH / 3.6

    # route-stop nodes
    rs_stop, rs_pat, rs_j = [], [], []
    for pi, p in enumerate(td.patterns):
        for j, sid in enumerate(p.stop_ids):
            rs_stop.append(sidx[sid])
            rs_pat.append(pi)
            rs_j.append(j)
    R = len(rs_stop)
    base_A, base_B, base_RS = 2 * Z, 2 * Z + S, 2 * Z + 2 * S
    Nn = base_RS + R
    rows, cols, w = [], [], []

    def add(u, v, c):
        rows.append(u), cols.append(v), w.append(max(c, EPS))

    # access / egress
    tree = cKDTree(sxy)
    for z, nbrs in enumerate(tree.query_ball_point(zxy, ACCESS_MAX_M)):
        for s in nbrs:
            secs = np.linalg.norm(zxy[z] - sxy[s]) * WALK_CIRCUITY / walk_mps
            add(z, base_A + s, secs)
            add(base_B + s, Z + z, secs)
    # walk transfers B->B
    for a, b in tree.query_pairs(TRANSFER_MAX_M):
        secs = np.linalg.norm(sxy[a] - sxy[b]) * WALK_CIRCUITY / walk_mps
        add(base_B + a, base_B + b, secs)
        add(base_B + b, base_B + a, secs)
    # boarding, riding, alighting
    k = 0
    for p in td.patterns:
        wait = 60.0 * p.headway_min / 2
        n = len(p.stop_ids)
        for j in range(n):
            s = sidx[p.stop_ids[j]]
            rs = base_RS + k + j
            if j < n - 1:  # can board anywhere but the last stop
                add(base_A + s, rs, wait)
                add(base_B + s, rs, wait + 60.0 * TRANSFER_PENALTY_MIN)
                add(rs, rs + 1, p.ivt_s[j])
            if j > 0:
                add(rs, base_B + s, EPS)
        k += n
    m = csr_matrix((w, (rows, cols)), shape=(Nn, Nn))
    # (u,v) pairs are unique by construction, so no duplicate summing occurs.
    node_xy = np.vstack([zones[["lng", "lat"]].values, zones[["lng", "lat"]].values,
                         stops[["lng", "lat"]].values, stops[["lng", "lat"]].values,
                         stops[["lng", "lat"]].values[rs_stop] if R else np.zeros((0, 2))])
    kind = np.r_[np.zeros(Z), np.ones(Z), np.full(S, 2), np.full(S, 3), np.full(R, 4)].astype(np.int8)
    rsp = np.full(Nn, -1, dtype=np.int32)
    rsp[base_RS:] = rs_pat
    rsj = np.full(Nn, -1, dtype=np.int32)
    rsj[base_RS:] = rs_j
    return TransitGraph(csr=m, n_zones=Z, n_stops=S, node_xy=node_xy, node_kind=kind,
                        rs_pattern=rsp, rs_pos=rsj, patterns=td.patterns)


@dataclass
class TransitSkim:
    minutes: np.ndarray          # per OD pair (inf if unreachable)
    dist: np.ndarray             # (Z, Nn) seconds from each origin zone
    pred: np.ndarray
    seconds: float


def skim(tg: TransitGraph, od: pd.DataFrame) -> TransitSkim:
    t = time.time()
    dist, pred = dijkstra(tg.csr, directed=True, indices=np.arange(tg.n_zones), return_predecessors=True)
    mins = dist[od.o.values, tg.n_zones + od.d.values] / 60.0
    return TransitSkim(minutes=mins, dist=dist, pred=pred, seconds=time.time() - t)


def trace(tg: TransitGraph, sk: TransitSkim, o: int, d: int) -> list[int]:
    target = tg.n_zones + d
    if not np.isfinite(sk.dist[o, target]):
        return []
    out = [target]
    cur = target
    while cur != o:
        cur = sk.pred[o, cur]
        if cur < 0:
            return []
        out.append(int(cur))
    return out[::-1]


def patterns_used(tg: TransitGraph, nodes: list[int]) -> set[int]:
    return {int(tg.rs_pattern[n]) for n in nodes if tg.rs_pattern[n] >= 0}


def patterns_on_paths(tg: TransitGraph, sk: TransitSkim, od: pd.DataFrame, pattern_ids: set[int]) -> np.ndarray:
    """Boolean per OD pair: does the transit path ride any pattern in pattern_ids?
    Vectorised walk up the predecessor matrix."""
    o = od.o.values.copy()
    cur = tg.n_zones + od.d.values
    hit = np.zeros(len(od), bool)
    alive = np.isfinite(sk.dist[o, cur])
    mask = np.zeros(tg.csr.shape[0], bool)
    for pi in pattern_ids:
        mask |= tg.rs_pattern == pi
    idx = np.where(alive)[0]
    c = cur[idx]
    oo = o[idx]
    while len(idx):
        hit[idx] |= mask[c]
        c = sk.pred[oo, c]
        keep = c >= 0
        idx, c, oo = idx[keep], c[keep], oo[keep]
    return hit

