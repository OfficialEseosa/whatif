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
BBOX_BUFFER_DEG = 0.0          # bus/streetcar stops strictly inside the box (rail is kept region-wide);
                               # stops outside the box have no street network for drawing walks
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
    stops: pd.DataFrame                       # stop_id (str), name, lng, lat (rail stations box-wide + region)
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
    st = st[st.trip_id.isin(set(trips.trip_id))]
    # Rail patterns are kept at full length (stations outside the box too) so inbound
    # commuters can board MARTA rail outside the box and ride the real schedule in.
    rail_trips = set(trips.trip_id[trips.route_id.isin(routes.index[routes.route_type.isin(["1", "2"])])])
    st = st[st.stop_id.isin(inbox_ids) | st.trip_id.isin(rail_trips)].copy()
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
        # A trip counts toward the peak if it is at its middle in-box stop in the window
        # (first-stop time undercounts long trips that start before 7 AM).
        t_mid = g.t.iloc[len(g) // 2]
        if not (PEAK_WINDOW[0] <= t_mid < PEAK_WINDOW[1]):
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
    out_stops = stops[stops.stop_id.isin(used)][["stop_id", "stop_name", "lng", "lat"]].rename(
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
    stop_index: dict = field(default_factory=dict)  # stop_id -> stop position

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
                        rs_pattern=rsp, rs_pos=rsj, patterns=td.patterns, stop_index=sidx)


# ---- inbound commuters (home outside the box) ------------------------------
# They reach MARTA rail outside (or inside) the box on foot or by car, then ride
# the GTFS schedule in. Access is ESTIMATED (straight line x detour); the rail ride,
# transfers and in-box egress are modeled on the graph.
STATION_CANDIDATES = 6            # nearest rail platforms considered per home
PNR_DRIVE_KPH = 35.0              # ASSUMPTION: drive-to-station speed
PNR_DETOUR = 1.3
PNR_PENALTY_MIN = 5.0             # ASSUMPTION: park + walk to platform
PNR_MAX_KM = 25.0                 # beyond this nobody drives to a station
# TODO: bus feeders to rail, buses entering the box, parking capacity by station.


SKIM_CHUNK = 128                  # dijkstra sources per batch (bounds memory on big boxes)


@dataclass
class TransitSkim:
    minutes: np.ndarray          # per OD unit (inf if unreachable)
    dzd: np.ndarray              # (R, Z) seconds from each source row to each destination zone
    seconds: float
    src_node: np.ndarray = None  # graph node per source row (Zo zones, then rail A-nodes)
    row: np.ndarray = None       # source row per OD unit
    access_min: np.ndarray = None  # estimated out-of-graph access minutes per OD unit
    pnr: np.ndarray = None       # True if access is by car (park-and-ride)
    csr: object = None
    _cache: dict = field(default_factory=dict)

    def row_paths(self, r: int):
        """(dist, pred) arrays over all nodes for source row r, computed on demand."""
        if r not in self._cache:
            if len(self._cache) > 512:
                self._cache.clear()
            d, p = dijkstra(self.csr, directed=True, indices=[int(self.src_node[r])], return_predecessors=True)
            self._cache[r] = (d[0], p[0])
        return self._cache[r]

    def __getstate__(self):  # do not pickle the on-demand cache
        s = self.__dict__.copy()
        s["_cache"] = {}
        return s


def rail_stop_index(tg: TransitGraph) -> np.ndarray:
    idx = sorted({tg.stop_index[s] for p in tg.patterns if p.mode == "rail" for s in p.stop_ids})
    return np.array(idx, dtype=np.int64)


def skim(tg: TransitGraph, od: pd.DataFrame) -> TransitSkim:
    t = time.time()
    Z = tg.n_zones
    base_A = 2 * Z
    rail = rail_stop_index(tg)
    src = np.r_[np.arange(Z), base_A + rail]
    dzd = np.empty((len(src), Z))
    for a in range(0, len(src), SKIM_CHUNK):
        d = dijkstra(tg.csr, directed=True, indices=src[a:a + SKIM_CHUNK])
        dzd[a:a + SKIM_CHUNK] = d[:, Z:2 * Z]
        del d
    ext = od.ext.values
    n = len(od)
    mins = np.full(n, np.inf)
    row = np.zeros(n, dtype=np.int64)
    access = np.zeros(n)
    pnr = np.zeros(n, bool)
    io = od.o.values[~ext]
    row[~ext] = io
    mins[~ext] = dzd[io, od.d.values[~ext]] / 60.0
    if ext.any() and len(rail):
        lat0 = float(np.mean(tg.node_xy[:Z, 1]))
        rxy = _xy(tg.node_xy[base_A + rail, 0], tg.node_xy[base_A + rail, 1], lat0)
        hxy = _xy(od.hlng.values[ext], od.hlat.values[ext], lat0)
        k = min(STATION_CANDIDATES, len(rail))
        dd, kk = cKDTree(rxy).query(hxy, k=k)
        dd, kk = dd.reshape(len(hxy), k), kk.reshape(len(hxy), k)
        walk = np.where(dd <= ACCESS_MAX_M, dd * WALK_CIRCUITY / (WALK_SPEED_KPH / 3.6), np.inf)
        drive = np.where(dd <= PNR_MAX_KM * 1000, dd * PNR_DETOUR / (PNR_DRIVE_KPH / 3.6) + 60 * PNR_PENALTY_MIN, np.inf)
        acc = np.minimum(walk, drive)
        ride = dzd[Z + kk, od.d.values[ext][:, None]]
        tot = acc + ride
        j = np.argmin(tot, axis=1)
        a = np.arange(len(j))
        mins[ext] = tot[a, j] / 60.0
        row[ext] = Z + kk[a, j]
        access[ext] = acc[a, j] / 60.0
        pnr[ext] = drive[a, j] < walk[a, j]
    return TransitSkim(minutes=mins, dzd=dzd, seconds=time.time() - t, src_node=src,
                       row=row, access_min=access, pnr=pnr, csr=tg.csr)


def trace(tg: TransitGraph, sk: TransitSkim, i: int, d: int) -> list[int]:
    """Node path for OD unit i (source row sk.row[i]) to destination zone d."""
    r = int(sk.row[i])
    o = int(sk.src_node[r])
    target = tg.n_zones + d
    dist, pred = sk.row_paths(r)
    if not np.isfinite(dist[target]):
        return []
    out = [target]
    cur = target
    while cur != o:
        cur = pred[cur]
        if cur < 0:
            return []
        out.append(int(cur))
    return out[::-1]


def patterns_used(tg: TransitGraph, nodes: list[int]) -> set[int]:
    return {int(tg.rs_pattern[n]) for n in nodes if tg.rs_pattern[n] >= 0}


def patterns_on_paths(tg: TransitGraph, sk: TransitSkim, od: pd.DataFrame, pattern_ids: set[int]) -> np.ndarray:
    """Boolean per OD unit: does its transit path ride any pattern in pattern_ids?
    Chunked over source rows; vectorised walk up each chunk's predecessor matrix."""
    mask = np.zeros(tg.csr.shape[0], bool)
    for pi in pattern_ids:
        mask |= tg.rs_pattern == pi
    hit = np.zeros(len(od), bool)
    rows_all = sk.row
    dest = tg.n_zones + od.d.values
    alive_all = np.isfinite(sk.minutes)
    for a in range(0, len(sk.src_node), SKIM_CHUNK):
        rows = np.arange(a, min(a + SKIM_CHUNK, len(sk.src_node)))
        sel = np.where(alive_all & (rows_all >= a) & (rows_all < rows[-1] + 1))[0]
        if not len(sel):
            continue
        _, pred = dijkstra(tg.csr, directed=True, indices=sk.src_node[rows], return_predecessors=True)
        rr = rows_all[sel] - a
        c = dest[sel]
        ss = sk.src_node[rows_all[sel]]
        idx = sel
        while len(idx):
            hit[idx] |= mask[c]
            done = c == ss
            c = np.where(done, -1, pred[rr, c])
            keep = c >= 0
            idx, c, rr, ss = idx[keep], c[keep], rr[keep], ss[keep]
        del pred
    return hit

# ---- real service frequencies for the frontend's train animation -----------
# network.json line ids -> GTFS route_short_name(s) serving that track (in the box).
LINE_ROUTES = {
    "marta_north": ["RED", "GOLD"], "marta_south": ["RED", "GOLD"],
    "marta_east": ["BLUE", "GREEN"], "marta_west": ["BLUE", "GREEN"],
    "marta_proctor_creek": ["GREEN"], "marta_east_west": ["BLUE"],
    "atlanta_streetcar": ["ATLSC"],
}


def export_service(path=None) -> dict:
    """Weekday trips per hour and headways per route and per network.json line id,
    counted at each route's busiest in-box stop, from the MARTA GTFS."""
    import json

    path = path or (config.SCENARIO_OUT_DIR / "transit-service.sim.json")
    z = zipfile.ZipFile(config.GTFS_FILE)
    rd = lambda n, **k: pd.read_csv(z.open(n), dtype=str, **k)  # noqa: E731
    routes = rd("routes.txt")
    routes = routes[routes.route_type.isin(["0", "1"])].set_index("route_id")
    cal = rd("calendar.txt")
    weekday = set(cal.loc[(cal.monday == "1") & (cal.tuesday == "1") & (cal.wednesday == "1"), "service_id"])
    trips = rd("trips.txt")
    trips = trips[trips.service_id.isin(weekday) & trips.route_id.isin(routes.index)]
    st = rd("stop_times.txt", usecols=["trip_id", "departure_time", "stop_id"])
    st = st[st.trip_id.isin(set(trips.trip_id))].merge(trips[["trip_id", "route_id", "direction_id"]], on="trip_id")
    st["t"] = st.departure_time.map(_hms)
    stops = rd("stops.txt").set_index("stop_id")
    w, s, e, n = config.BBOX
    lng, lat = stops.stop_lon.astype(float), stops.stop_lat.astype(float)
    inbox = set(stops.index[(lng >= w) & (lng <= e) & (lat >= s) & (lat <= n)])
    out_routes = {}
    for rid, g in st.groupby("route_id"):
        name = routes.loc[rid, "route_short_name"]
        gi = g[g.stop_id.isin(inbox)]
        dirs, refs = {}, []
        for d, gdd in gi.groupby("direction_id"):
            ref = gdd.stop_id.value_counts().index[0]  # busiest in-box stop (platform) in this direction
            refs.append(stops.loc[ref, "stop_name"])
            times = np.sort(gdd[gdd.stop_id == ref].t.values)
            pk = times[(times >= 7 * 3600) & (times < 9 * 3600)]
            dirs[d] = {"tripsAm7to9": int(len(pk)),
                       "headwayMin7to9": round(120 / len(pk), 1) if len(pk) else None,
                       "medianGapMin": round(float(np.median(np.diff(times)) / 60), 1) if len(times) > 1 else None,
                       "firstDeparture": f"{times[0] // 3600:02d}:{times[0] % 3600 // 60:02d}",
                       "lastDeparture": f"{times[-1] // 3600 % 24:02d}:{times[-1] % 3600 // 60:02d}"}
        out_routes[name] = {"routeId": rid, "referenceStops": refs, "byDirection": dirs}
    lines = {}
    for lid, names in LINE_ROUTES.items():
        per_dir = []
        for d in ("0", "1"):
            k = sum(out_routes[nm]["byDirection"].get(d, {}).get("tripsAm7to9", 0) for nm in names if nm in out_routes)
            per_dir.append(k)
        k = max(per_dir)
        lines[lid] = {"routes": names, "tripsPerDirectionAm7to9": per_dir,
                      "headwayMin": round(120 / k, 1) if k else None}
    sc = out_routes.get("ATLSC", {}).get("byDirection", {})
    lines["atlanta_streetcar"]["note"] = (
        "Weekday GTFS: first streetcar departure at the reference stop is " +
        ", ".join(f"{v['firstDeparture']} (dir {d})" for d, v in sc.items()) +
        "; median gap between departures " + ", ".join(f"{v['medianGapMin']} min" for v in sc.values()) +
        ". The 7-9 AM headway is long because service starts mid-morning.")
    doc = {"source": f"MARTA GTFS ({config.MARTA_GTFS_URL}), weekday service", "window": "07:00-09:00",
           "lines": lines, "routes": out_routes,
           "note": "headwayMin = 120 min / max trips in one direction 07:00-09:00, all routes on that track combined."}
    path.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    print(f"transit service -> {path}")
    return doc



