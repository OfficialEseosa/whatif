"""Build a contract-shaped ScenarioResult dict from baseline (+ optional proposed) runs.

Sections the sim computes: metrics, agents (display sample), roads, tracts, line,
impact.modeSplit, impact.minutesSavedByEarnings, whoPays.approval, and the values
of verdict tests time_saved / new_riders.
Sections copied through from the frontend mock (public/scenarios/beltline-streetcar.json)
when it exists, else minimal placeholders: the rest of verdict, impact, whoPays,
claims, personas, lookahead. impact.notes lists exactly what is copied.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
from dataclasses import dataclass

import numpy as np

import config
from assign import DRIVE_TERMINAL_MIN, trace_path
from contract import CONTRACT_VERSION, ScenarioResult
import display as dsp
from transit import trace

DISPLAY_SAMPLE_SIZE = 3000
SEED = 42
# ASSUMPTION (display only): work ARRIVAL times ~ Normal(8:20, 30 min), clipped to
# 7:00-9:50; departure = arrival - baseline door-to-door minutes (floored at 6:00).
# Arrival-based so long inbound trips still play inside the 6:00-10:00 window.
DEPART_MEAN_S = 8400
DEPART_SD_S = 1800
DEPART_CLIP_S = (3600, 13800)
NOISE_BUFFER_M = 150.0           # contract: noise/construction zone around new track
NETWORK_URL = "/scenarios/network.json"
ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link",
                "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
# roads[] carries only the classes drawn by the frontend (major-roads.sim.json: motorway..secondary)
ROAD_EFFECT_CLASSES = {"motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link"}
# GTFS route_short_name -> contract RailLine ids (frontend network.json naming).
# network.json splits heavy rail geographically (marta_north, marta_east_west, ...)
# while GTFS routes are colours; this is the closest in-box match. Bus -> "bus_<n>".
LINE_IDS = {"ATLSC": "atlanta_streetcar", "RED": "marta_north", "GOLD": "marta_north",
            "BLUE": "marta_east_west", "GREEN": "marta_east_west"}


# ---------------------------------------------------------------------------
@dataclass
class Sample:
    pair: np.ndarray
    home: np.ndarray      # (n,2)
    work: np.ndarray
    band: list
    depart: np.ndarray
    u: np.ndarray         # uniform draw for mode choice (shared baseline/proposed)


def draw_sample(dem, n=DISPLAY_SAMPLE_SIZE, seed=SEED) -> Sample:
    cache = dem.__dict__.setdefault("_samples", {})   # deterministic per (n, seed); depart is edited by the caller
    if (n, seed) not in cache:
        cache[(n, seed)] = _draw_sample(dem, n, seed)
    s = cache[(n, seed)]
    return Sample(pair=s.pair, home=s.home, work=s.work, band=s.band, depart=s.depart.copy(), u=s.u)


def _draw_sample(dem, n, seed) -> Sample:
    rng = np.random.default_rng(seed)
    od = dem.od
    w = od.jobs.values / od.jobs.values.sum()
    pair = rng.choice(len(od), size=n, p=w)
    blocks = dem.blocks
    by_bg = {bg: g for bg, g in blocks.groupby("bg")}
    zones = dem.zones
    home, work, band = np.zeros((n, 2)), np.zeros((n, 2)), []
    for i, pi in enumerate(pair):
        r = od.iloc[pi]
        for arr, zi, col in ((home, r.o, "home_wt"), (work, r.d, "work_wt")):
            if int(zi) < 0:  # inbound: home = job-weighted home point of the tract (outside the box)
                arr[i] = (r.hlng, r.hlat)
                continue
            g = by_bg[zones.bg.iloc[int(zi)]]
            wt = g[col].values.astype(float)
            if wt.sum() <= 0:
                wt = np.ones(len(g))
            k = rng.choice(len(g), p=wt / wt.sum())
            arr[i] = (g.lng.iloc[k], g.lat.iloc[k])
        se = np.array([r.se_low, r.se_mid, r.se_high], float)
        band.append(["low", "mid", "high"][rng.choice(3, p=se / se.sum())] if se.sum() > 0 else "mid")
    depart = np.clip(rng.normal(DEPART_MEAN_S, DEPART_SD_S, n), *DEPART_CLIP_S)
    return Sample(pair=pair, home=home, work=work, band=band, depart=depart, u=rng.random(n))


# ---------------------------------------------------------------------------
def _seg_len(a, b):
    lat0 = np.deg2rad(33.76)
    return float(np.hypot((b[0] - a[0]) * np.cos(lat0), b[1] - a[1]) * 111_320)


def _finish(mode, minutes, coords, times, lines=None):
    c = [[round(x, 5), round(y, 5)] for x, y in coords]
    t = [int(round(v)) for v in np.maximum.accumulate(np.asarray(times, float))]
    if len(c) < 2:
        c = c + c
        t = t + t
    trip = {"mode": mode, "minutes": round(float(minutes), 1), "path": c, "timestamps": t}
    if lines:
        trip["lines"] = sorted(set(lines))
    return trip


class _Path:
    """Accumulates legs; each moving leg gets distance-proportional times and its own
    light simplification (display.SIMPLIFY_TOL_M), so no vertex is ever off its leg."""

    def __init__(self):
        self.c, self.t, self.forced = [], [], set()

    def _same(self, a, b):
        return abs(a[0] - b[0]) < 1e-9 and abs(a[1] - b[1]) < 1e-9

    def move(self, coords, t0, t1, times=None, frac=None):
        if len(coords) == 0:
            return
        if frac is not None:                 # prepared leg (display.prep): deduped coords + length fractions
            times = (t0 + (t1 - t0) * frac).tolist()
        elif times is None:
            coords, frac = dsp.prep(coords)
            times = (t0 + (t1 - t0) * frac).tolist()
        if self.c and self._same(self.c[-1], coords[0]):
            coords, times = coords[1:], times[1:]
        if self.c:
            self.forced.add(len(self.c) - 1)   # leg boundary
        self.c += coords
        self.t += list(times)
        self.forced.add(len(self.c) - 1)

    def leg(self, prepared, t0, t1):
        self.move(prepared[0], t0, t1, frac=prepared[1])

    def wait(self, t):
        if self.c:
            self.forced.add(len(self.c) - 1)
            self.c.append(list(self.c[-1]))
            self.t.append(t)
            self.forced.add(len(self.c) - 1)

    def done(self):
        """Douglas-Peucker (display.SIMPLIFY_TOL_M) between forced vertices (leg boundaries,
        waits, edge-time changes are interpolated); returns (coords, times)."""
        if len(self.c) <= 2:
            return self.c, self.t
        f = sorted(self.forced | {0, len(self.c) - 1})
        keep = []
        for a, b in zip(f[:-1], f[1:]):
            idx = dsp.simplify_idx(self.c[a:b + 1])
            keep += [a + k for k in idx][(1 if keep else 0):]
        return [self.c[k] for k in keep], [self.t[k] for k in keep]


def _edge_ends(net):
    d = net.__dict__
    if "_edge_ends" not in d:
        d["_edge_ends"] = (net.edges.u_idx.values, net.edges.v_idx.values)
    return d["_edge_ends"]


def drive_trip(net, run, pair, home, work, depart, router):
    """Internal: home -> (local streets) -> modeled route -> (local streets) -> work.
    Inbound: starts at the gateway node when the (estimated, not drawn) out-of-box leg
    ends. The local connector legs are drawn inside the modeled terminal minutes."""
    asg = run.asg
    edges = trace_path(net, asg.sp, int(asg.od_row[pair]), int(asg.od_dest[pair]))
    half = DRIVE_TERMINAL_MIN * 30.0
    out_s = float(asg.out_min[pair]) * 60.0 if asg.out_min is not None else 0.0
    eu, ev = _edge_ends(net)
    start = int(eu[edges[0]]) if edges else int(asg.od_dest[pair])
    end = int(ev[edges[-1]]) if edges else int(asg.od_dest[pair])
    P = _Path()
    t = depart + half + out_s
    if out_s > 0:
        P.move([list(net.node_xy[start])], t, t)
    else:
        P.leg(router.route_p(home, net.node_xy[start]), depart, t)
    rc, rt = [], []                       # modeled route = one leg with per-edge times
    for ei in edges:
        g, fr = dsp.edge_draw(net, ei)
        et = float(asg.time_s[ei])
        tt = (t + et * fr).tolist()
        if rc:
            g, tt = g[1:], tt[1:]
        rc += g
        rt += tt
        t += et
    if rc:
        P.move(rc, None, None, times=rt)
    P.leg(router.route_p(net.node_xy[end], work), t, t + half)
    return _finish("drive", run.drive_min[pair], *P.done())


def _in_box(xy, buf=0.002):
    w, s, e, n = config.BBOX
    return w - buf <= xy[0] <= e + buf and s - buf <= xy[1] <= n + buf


def transit_trip(dem, run, pair, home, work, depart, router):
    """Walk legs routed on streets, rides on GTFS shapes / the proposed line path.
    Inbound: the estimated access leg is not drawn and the ride is drawn only from
    where it enters the box."""
    tg, sk = run.tg, run.tsk
    d = int(dem.od.d.values[pair])
    ext = bool(dem.od.ext.values[pair])
    nodes = trace(tg, sk, pair, d)
    if not nodes:
        return None
    r = int(sk.row[pair])
    t_acc = float(sk.access_min[pair]) * 60.0 if sk.access_min is not None else 0.0
    dist_r, _ = sk.row_paths(r)
    T = lambda nd: depart + t_acc + float(dist_r[nd])  # noqa: E731
    kind = tg.node_kind
    xy = lambda nd: list(tg.node_xy[nd])  # noqa: E731
    P, lines = _Path(), []
    first = nodes[0]
    if kind[first] != 0:          # inbound: starts at the boarding station
        P.move([xy(first)], T(first), T(first))
    for a, b in zip(nodes[:-1], nodes[1:]):
        ka, kb = kind[a], kind[b]
        if ka == 0 and kb == 2:                       # home -> stop (walk)
            P.leg(router.route_p(home, xy(b)), depart, T(b))
        elif kb == 4 and ka in (2, 3):                # board: wait at the stop
            P.wait(T(b))
        elif ka == 4 and kb == 4:                     # ride one hop
            p = tg.patterns[int(tg.rs_pattern[a])]
            lines.append(LINE_IDS.get(p.route_name, "proposed" if p.route_id.startswith("proposed")
                                      else f"bus_{p.route_name}"))
            hp = p.hop_paths[int(tg.rs_pos[a])] if p.hop_paths else None
            P.leg(dsp.hop_draw(hp) if hp else router.route_p(xy(a), xy(b)), T(a), T(b))
        elif ka == 4 and kb == 3:                     # alight
            pass
        elif ka == 3 and kb == 3:                     # transfer walk
            P.leg(router.route_p(xy(a), xy(b)), T(a), T(b))
        elif ka == 3 and kb == 1:                     # stop -> work (walk)
            P.leg(router.route_p(xy(a), work), T(a), T(b))
    if ext:  # drop the out-of-box part of the drawn path (cut at a vertex, still on the shape)
        w_, s_, e_, n_ = config.BBOX
        a_ = np.asarray(P.c, float).reshape(-1, 2)
        ins = np.flatnonzero((a_[:, 0] >= w_ - 0.002) & (a_[:, 0] <= e_ + 0.002) &
                             (a_[:, 1] >= s_ - 0.002) & (a_[:, 1] <= n_ + 0.002))
        k = int(ins[0]) if len(ins) else len(P.c) - 1
        P.c, P.t = P.c[k:], P.t[k:]
    mode = "park_ride" if (sk.pnr is not None and sk.pnr[pair]) else "transit"
    c, t = P.done()
    return _finish(mode, run.transit_min[pair], c, t, lines)


# ---------------------------------------------------------------------------
def metrics(dem, run, n_sample):
    jobs = dem.od.jobs.values
    p = run.p_transit
    return {"avgCommuteMin": round(float(np.average(run.expected_min(), weights=jobs)), 2),
            "transitShare": round(float(np.average(p, weights=jobs)), 4),
            # Commuters (persons) using transit per weekday; each makes ~2 trips.
            "dailyTransitRiders": round(float((jobs * p).sum()), 1),
            "populationModeled": int(jobs.sum()),
            "displaySampleSize": int(n_sample)}


def road_effects(net, base_run, prop_run):
    e = net.edges
    vb = base_run.asg.vc
    vp = prop_run.asg.vc if prop_run is not None else vb
    tb = base_run.asg.time_s
    tp = prop_run.asg.time_s if prop_run is not None else tb
    m = e.highway.isin(ROAD_EFFECT_CLASSES).values
    df = e.loc[m, ["way_id", "oneway"]].assign(vb=vb[m], vp=vp[m], dt=(tp - tb)[m])
    out = []
    for wid, g in df.groupby("way_id"):
        if not wid:
            continue
        ndir = 1 if g.oneway.all() else 2
        out.append({"roadId": wid, "vcBaseline": round(float(g.vb.max()), 3),
                    "vcProposed": round(float(g.vp.max()), 3),
                    "delayDeltaMin": round(float(g.dt.sum() / ndir / 60.0), 3)})
    return out


def tract_effects(dem, base_run, prop_run):
    z = dem.zones
    od = dem.od
    eb = base_run.expected_min()
    ep = prop_run.expected_min() if prop_run is not None else eb
    import pandas as pd

    # Residents of in-box tracts only (inbound commuters live outside these tracts).
    df = pd.DataFrame({"tract": od.home_tract.values, "w": od.jobs.values, "d": (ep - eb) * od.jobs.values})
    df = df[~od.ext.values]
    agg = df.groupby("tract")[["w", "d"]].sum()
    cen = z.assign(wx=z.lng * z.activity, wy=z.lat * z.activity).groupby("tract")[["wx", "wy", "activity"]].sum()
    out = []
    for t, r in cen.iterrows():
        md = float(agg.d[t] / agg.w[t]) if t in agg.index and agg.w[t] > 0 else 0.0
        out.append({"id": t, "centroid": [round(r.wx / r.activity, 5), round(r.wy / r.activity, 5)],
                    "minutesDelta": round(md, 3),
                    "redlined": False,      # TODO: HOLC 1938 overlay (Mapping Inequality)
                    "rentPressure": False})  # TODO: ACS B25003/B19013/B25070 + 800 m of new stop
    return out


def _near_line(pts, line_path, buf_m):
    if not line_path or len(line_path) < 2:
        return np.zeros(len(pts), bool)
    from shapely.geometry import LineString, Point

    lat0 = np.cos(np.deg2rad(33.76))
    ls = LineString([(x * lat0 * 111_320, y * 111_320) for x, y in line_path])
    return np.array([ls.distance(Point(x * lat0 * 111_320, y * 111_320)) <= buf_m for x, y in pts])


# ---------------------------------------------------------------------------
def _fallback_sections():
    keys = [("time_saved", "Time saved", "hrs/day"), ("new_riders", "New riders", "riders/day"),
            ("cost_per_rider", "Cost per rider", "usd/trip"),
            ("redlined_benefit_share", "Benefit to redlined tracts", "share"),
            ("renters_rent_pressure", "Renters under rent pressure", "households")]
    return {
        "verdict": {"label": "mixed", "headline": "Not yet scored", "summary": "Placeholder verdict (sim fallback).",
                    "tests": [{"key": k, "label": l, "sublabel": "placeholder", "value": 0, "unit": u, "grade": "fair"}
                              for k, l, u in keys], "alternatives": []},
        "impact": {"tiles": [], "modeSplit": {}, "minutesSavedByEarnings": [], "calibration": []},
        "whoPays": {"items": [], "approval": {"support": 0, "oppose": 0, "basis": 0, "note": ""}},
        "claims": [], "personas": [],
        "lookahead": {"year5": {"householdsAtRisk": {"low": 0, "high": 0}, "note": "not computed"},
                      "year10": {"householdsAtRisk": {"low": 0, "high": 0}, "note": "not computed"},
                      "lastTime": {"title": "", "period": "", "stats": [], "note": "not computed"}},
    }


def load_mock():
    if config.MOCK_SCENARIO.exists():
        try:
            return json.loads(config.MOCK_SCENARIO.read_text(encoding="utf-8")), True
        except Exception:  # noqa: BLE001
            pass
    return _fallback_sections(), False


# Display cache: the baseline trips of the display sample and the street routes they use are the
# same for every scenario, so they are drawn once (build time) and shipped with the other caches.
DISPLAY_CACHE = config.CACHE_DIR / f"display_{config.bbox_tag()}.pkl"
_DC: dict = {}


def _fingerprint(base):
    r = base.run
    return (round(float(r.asg.time_s.sum()), 3), round(float(r.p_transit.sum()), 6), len(base.dem.od))


def _display_cache(base, router):
    if _DC.get("base") is not base:
        import pickle

        _DC.clear()
        _DC.update(base=base, btrips={})
        if DISPLAY_CACHE.exists():
            try:
                with open(DISPLAY_CACHE, "rb") as f:
                    d = pickle.load(f)
                if d.get("fp") == _fingerprint(base):   # built from this exact baseline
                    _DC["btrips"] = d["btrips"]
                    router.routes.update(d["routes"])
            except Exception:  # noqa: BLE001  (a stale or unreadable cache only costs time)
                pass
    return _DC


def build_display_cache(base=None, sizes=(2000, DISPLAY_SAMPLE_SIZE)):
    """Draw the baseline trips for the live and saved sample sizes and write the display cache."""
    import pickle

    from model import load_baseline
    from network import load_display_network

    base = base or load_baseline(verbose=False)
    if DISPLAY_CACHE.exists():
        DISPLAY_CACHE.unlink()
    _DC.clear()
    for n in sizes:
        build_result("baseline", "Baseline", {"type": "extend_line", "name": "Baseline", "stops": []}, base, n_sample=n)
    router = dsp.router_for(load_display_network())
    with open(DISPLAY_CACHE, "wb") as f:
        pickle.dump({"fp": _fingerprint(base), "btrips": _DC["btrips"], "routes": router.routes}, f)
    print(f"wrote {DISPLAY_CACHE} ({DISPLAY_CACHE.stat().st_size/1e6:.1f} MB, {len(router.routes)} routes)")


def build_result(scen_id, title, edit, base, prop_run=None, line=None, n_sample=DISPLAY_SAMPLE_SIZE,
                 seed=SEED, riders_on_line: float = 0.0, change: dict | None = None) -> dict:
    net, dem, brun = base.net, base.dem, base.run
    prun = prop_run or brun
    line = line or {"path": [], "stops": []}
    s = draw_sample(dem, n_sample, seed)
    import verdict as vd

    change = change or vd.default_change(edit, line)
    noise = _near_line(s.home, change.get("track") or [], NOISE_BUFFER_M)

    import verdict as vd

    mb = metrics(dem, brun, n_sample)
    mp = metrics(dem, prun, n_sample)
    roads = road_effects(net, brun, prop_run)
    A = vd.assess(base, prop_run, edit, line, riders_on_line, mb, mp, roads, change=change)
    eq_rng = np.random.default_rng(seed + 1)  # separate stream: renter sampling
    from network import load_display_network

    router = dsp.router_for(load_display_network())
    for run in {id(brun): brun, id(prun): prun}.values():
        dsp.attach_hop_paths(run.td, router, verbose=False)
    btrips = _display_cache(base, router)["btrips"].setdefault((n_sample, seed), {})

    agents = []
    for i in range(n_sample):
        pi = int(s.pair[i])
        trips = []
        b_transit = s.u[i] < brun.p_transit[pi] and np.isfinite(brun.transit_min[pi])
        b_min = brun.transit_min[pi] if b_transit else brun.drive_min[pi]
        s.depart[i] = max(0.0, s.depart[i] - 60.0 * float(b_min))  # sampled arrival -> departure
        for run in (brun, prun):
            tr = btrips.get(i) if run is brun else None   # baseline trips never change: drawn once
            if tr is None and s.u[i] < run.p_transit[pi]:
                tr = transit_trip(dem, run, pi, s.home[i], s.work[i], s.depart[i], router)
            if tr is None:
                tr = drive_trip(net, run, pi, s.home[i], s.work[i], s.depart[i], router)
            if run is brun:
                btrips[i] = tr
            trips.append(tr)
        delta = trips[1]["minutes"] - trips[0]["minutes"]
        tract_id = str(dem.od.home_tract.values[pi])  # inbound: home tract outside the box
        renter, pressure, cost_share = vd.agent_equity(A["ctx"], tract_id, s.home[i], eq_rng)
        # ASSUMPTION: support ~ tanh(minutes saved / 5), minus 0.3 inside the noise zone,
        # minus 0.2 for renters in the rent-pressure zone.
        support = float(np.clip(np.tanh(-delta / 5.0) - (0.3 if noise[i] else 0.0) - (0.2 if pressure else 0.0), -1, 1))
        agents.append({
            "id": f"a{i:05d}", "home": [round(s.home[i][0], 5), round(s.home[i][1], 5)],
            "work": [round(s.work[i][0], 5), round(s.work[i][1], 5)],
            "tractId": tract_id,
            "earningsBand": s.band[i],
            "renter": renter,  # SAMPLED from the home tract's ACS renter share (seeded), not observed
            "hasCar": True,    # PLACEHOLDER: mode choice assumes car access (ACS B08141 TODO)
            "baseline": trips[0], "proposed": trips[1],
            "stake": {"minutesDelta": round(delta, 1), "rentPressure": pressure, "noiseZone": bool(noise[i]),
                      "costShareUsdYr": cost_share, "supportScore": round(support, 3)},
            "displacementRisk": "none",  # NOT MODELED (no defensible year-5/10 proxy yet)
        })

    mock, from_mock = load_mock()
    jobs = dem.od.jobs.values
    saved_min = brun.expected_min() - prun.expected_min()

    verdict = {"label": A["label"], "headline": A["headline"], "summary": A["summary"], "tests": A["tests"],
               "alternatives": copy.deepcopy(mock["verdict"].get("alternatives", []))}

    impact = copy.deepcopy(mock["impact"])

    def split(run):
        p = run.p_transit
        pnr = run.tsk.pnr if run.tsk.pnr is not None else np.zeros(len(p), bool)
        pr = float((jobs * p * pnr).sum() / jobs.sum())
        tr = float((jobs * p * ~pnr).sum() / jobs.sum())
        return {"drive": round(1 - pr - tr, 4), "transit": round(tr, 4), "park_ride": round(pr, 4)}

    impact["modeSplit"] = {"before": split(brun), "after": split(prun),
                           "scope": "all modeled commuters working in the study box (internal + inbound)"}
    bands = []
    for col, band, label in (("se_low", "low", "Under $1,250/mo"), ("se_mid", "mid", "$1,250-3,333/mo"),
                             ("se_high", "high", "Over $3,333/mo")):
        w = dem.od[col].values.astype(float)
        bands.append({"band": band, "label": label,
                      "minutesSaved": round(float((saved_min * w).sum() / max(w.sum(), 1)), 3)})
    impact["minutesSavedByEarnings"] = bands
    copied = "copied from the frontend mock" if from_mock else "sim placeholders (no mock file found)"
    impact["notes"] = [
        "Sim-computed: metrics, agents, roads, tracts (real polygons + ACS/HOLC equity fields), line, "
        "impact.modeSplit, impact.minutesSavedByEarnings, verdict label/headline/summary/grades and all five tests, "
        "whoPays.items and whoPays.approval.",
        f"Not computed by the sim ({copied}): verdict.alternatives, impact.tiles, impact.calibration, claims, "
        "personas, lookahead.",
        "Background road traffic is a PLACEHOLDER fraction of capacity (HPMS not wired), lowered now that "
        "inbound commuters are modeled.",
        "Inbound commuters (home outside the box): only the in-box part of their trip is routed on the network; "
        "the approach outside the box (drive to a gateway, or walk/drive to a MARTA station) is an ESTIMATE "
        "added to their minutes. Their drawn paths start where they enter the box. Outbound commuters are not modeled.",
        "Mode choice: one global constant calibrated to a PLACEHOLDER 12% transit share (ACS mode share not wired).",
    ] + A["notes"]

    sup = np.array([a["stake"]["supportScore"] for a in agents])
    who = {"items": A["items"],
           "approval": {"support": round(float((sup > 0.1).mean()), 3), "oppose": round(float((sup < -0.1).mean()), 3),
                        "basis": int(len(sup)),
                        "note": "From display-sample stake scores: minutes delta, noise zone, and rent-pressure "
                                "exposure of sampled renters (cost share not yet in the score)."}}

    res = {
        "id": scen_id, "source": "prebaked_sim", "contractVersion": CONTRACT_VERSION, "title": title, "edit": edit,
        "isMock": False, "mockSections": MOCK_SECTIONS,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "timeWindow": {"startSec": 0, "endSec": 14400},
        "line": line, "networkUrl": NETWORK_URL,
        "metrics": {"baseline": mb, "proposed": mp},
        "verdict": verdict, "impact": impact, "agents": agents,
        "roads": roads, "tracts": A["tracts"],
        "whoPays": who, "claims": copy.deepcopy(mock.get("claims", [])),
        "personas": copy.deepcopy(mock.get("personas", [])),
        "lookahead": copy.deepcopy(mock["lookahead"]),
    }
    ScenarioResult.model_validate(res)  # pydantic mirror; zod check: node validate_contract.mjs
    return res


# Sections still copied from the frontend mock (contract MOCK_SECTION_KEYS).
MOCK_SECTIONS = ["verdict.alternatives", "impact.tiles", "impact.calibration", "claims", "personas", "lookahead"]

def write_result(res: dict, name: str | None = None):
    config.ensure_dirs()
    path = config.SCENARIO_OUT_DIR / f"{name or res['id']}.sim.json"
    path.write_text(json.dumps(res, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size/1e6:.2f} MB, {len(res['agents'])} agents)")
    return path












