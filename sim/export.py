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
from transit import trace

DISPLAY_SAMPLE_SIZE = 3000
SEED = 42
# ASSUMPTION (display only): work ARRIVAL times ~ Normal(8:20, 30 min), clipped to
# 7:00-9:50; departure = arrival - baseline door-to-door minutes (floored at 6:00).
# Arrival-based so long inbound trips still play inside the 6:00-10:00 window.
DEPART_MEAN_S = 8400
DEPART_SD_S = 1800
DEPART_CLIP_S = (3600, 13800)
PATH_SIMPLIFY_DEG = 0.00008      # ~8 m Douglas-Peucker on drive paths
NOISE_BUFFER_M = 150.0           # contract: noise/construction zone around new track
NETWORK_URL = "/scenarios/network.json"
ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link",
                "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
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


def _simplify(coords, times, tol=PATH_SIMPLIFY_DEG):
    from shapely.geometry import LineString

    if len(coords) <= 3:
        return coords, times
    simp = list(LineString(coords).simplify(tol, preserve_topology=False).coords)
    out_c, out_t, j = [], [], 0
    for c in simp:
        while j < len(coords) and (abs(coords[j][0] - c[0]) > 1e-12 or abs(coords[j][1] - c[1]) > 1e-12):
            j += 1
        if j >= len(coords):
            return coords, times  # fallback, should not happen
        out_c.append(coords[j]); out_t.append(times[j])
    return out_c, out_t


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


def drive_trip(net, run, pair, home, work, depart):
    """Internal: path starts at home. Inbound: path starts at the gateway, at the time
    the (estimated, not drawn) out-of-box leg ends."""
    asg = run.asg
    edges = trace_path(net, asg.sp, int(asg.od_row[pair]), int(asg.od_dest[pair]))
    half = DRIVE_TERMINAL_MIN * 30.0
    out_s = float(asg.out_min[pair]) * 60.0 if asg.out_min is not None else 0.0
    if out_s > 0:
        gnode = net.gateways.node_idx.values[int(asg.gateway[pair])]
        coords, times = [list(net.node_xy[gnode])], [depart + half + out_s]
    else:
        coords, times = [list(home)], [depart]
    t = depart + half + out_s
    for ei in edges:
        g = net.edge_geoms[ei]
        seg = [_seg_len(g[k], g[k + 1]) for k in range(len(g) - 1)]
        tot = sum(seg) or 1.0
        et = float(asg.time_s[ei])
        if not coords or coords[-1] != g[0]:
            coords.append(g[0]); times.append(t)
        acc = 0.0
        for k in range(1, len(g)):
            acc += seg[k - 1]
            coords.append(g[k]); times.append(t + et * acc / tot)
        t += et
    coords.append(list(work)); times.append(t + half)
    coords, times = _simplify(coords, times)
    return _finish("drive", run.drive_min[pair], coords, times)


def _in_box(xy, buf=0.002):
    w, s, e, n = config.BBOX
    return w - buf <= xy[0] <= e + buf and s - buf <= xy[1] <= n + buf


def transit_trip(dem, run, pair, home, work, depart):
    """Internal: path starts at home. Inbound: the estimated access leg is not drawn and
    the rail ride is drawn only from where it enters the box (gateway station)."""
    tg, sk = run.tg, run.tsk
    d = int(dem.od.d.values[pair])
    ext = bool(dem.od.ext.values[pair])
    nodes = trace(tg, sk, pair, d)
    if not nodes:
        return None
    r = int(sk.row[pair])
    t_acc = float(sk.access_min[pair]) * 60.0 if sk.access_min is not None else 0.0
    o = r  # row into dist
    coords, times, lines = [], [], []
    for idx, nd in enumerate(nodes):
        xy = list(tg.node_xy[nd])
        if idx == 0 and not ext:
            xy = list(home)
        elif idx == len(nodes) - 1:
            xy = list(work)
        tt = depart + t_acc + float(sk.dist[o, nd])
        prev = nodes[idx - 1] if idx else None
        pi = int(tg.rs_pattern[nd])
        if pi >= 0:
            p = tg.patterns[pi]
            lines.append(LINE_IDS.get(p.route_name, "proposed" if p.route_id.startswith("proposed")
                                      else f"bus_{p.route_name}"))
            # in-vehicle hop with a drawn path: interpolate interior vertices
            hp = None
            if prev is not None and tg.rs_pattern[prev] == pi and p.hop_paths:
                hp = p.hop_paths[int(tg.rs_pos[prev])]
            if hp:
                t0 = depart + t_acc + float(sk.dist[o, prev])
                seg = [_seg_len(hp[k], hp[k + 1]) for k in range(len(hp) - 1)]
                tot = sum(seg) or 1.0
                acc = 0.0
                for k in range(1, len(hp) - 1):
                    acc += seg[k - 1]
                    coords.append(hp[k]); times.append(t0 + (tt - t0) * acc / tot)
        coords.append(xy); times.append(tt)
    if ext:  # drop the out-of-box part of the drawn path
        k = next((i for i, c in enumerate(coords) if _in_box(c)), len(coords) - 1)
        coords, times = coords[k:], times[k:]
    mode = "park_ride" if (sk.pnr is not None and sk.pnr[pair]) else "transit"
    return _finish(mode, run.transit_min[pair], coords, times, lines)


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
    m = e.highway.isin(ROAD_CLASSES).values
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


def build_result(scen_id, title, edit, base, prop_run=None, line=None, n_sample=DISPLAY_SAMPLE_SIZE,
                 seed=SEED) -> dict:
    net, dem, brun = base.net, base.dem, base.run
    prun = prop_run or brun
    line = line or {"path": [], "stops": []}
    s = draw_sample(dem, n_sample, seed)
    noise = _near_line(s.home, line["path"], NOISE_BUFFER_M)

    agents = []
    for i in range(n_sample):
        pi = int(s.pair[i])
        trips = []
        b_transit = s.u[i] < brun.p_transit[pi] and np.isfinite(brun.transit_min[pi])
        b_min = brun.transit_min[pi] if b_transit else brun.drive_min[pi]
        s.depart[i] = max(0.0, s.depart[i] - 60.0 * float(b_min))  # sampled arrival -> departure
        for run in (brun, prun):
            tr = None
            if s.u[i] < run.p_transit[pi]:
                tr = transit_trip(dem, run, pi, s.home[i], s.work[i], s.depart[i])
            if tr is None:
                tr = drive_trip(net, run, pi, s.home[i], s.work[i], s.depart[i])
            trips.append(tr)
        delta = trips[1]["minutes"] - trips[0]["minutes"]
        # ASSUMPTION: support ~ tanh(minutes saved / 5), minus 0.3 inside the noise zone.
        support = float(np.clip(np.tanh(-delta / 5.0) - (0.3 if noise[i] else 0.0), -1, 1))
        agents.append({
            "id": f"a{i:05d}", "home": [round(s.home[i][0], 5), round(s.home[i][1], 5)],
            "work": [round(s.work[i][0], 5), round(s.work[i][1], 5)],
            "tractId": str(dem.od.home_tract.values[pi]),  # inbound: home tract outside the box
            "earningsBand": s.band[i],
            "renter": False,   # PLACEHOLDER until ACS B25003 is wired
            "hasCar": True,    # PLACEHOLDER: mode choice assumes car access (ACS B08141 TODO)
            "baseline": trips[0], "proposed": trips[1],
            "stake": {"minutesDelta": round(delta, 1), "rentPressure": False, "noiseZone": bool(noise[i]),
                      "costShareUsdYr": 0.0, "supportScore": round(support, 3)},
            "displacementRisk": "none",
        })

    mb = metrics(dem, brun, n_sample)
    mp = metrics(dem, prun, n_sample)
    mock, from_mock = load_mock()
    jobs = dem.od.jobs.values
    saved_min = brun.expected_min() - prun.expected_min()

    verdict = copy.deepcopy(mock["verdict"])
    for t in verdict["tests"]:
        if t["key"] == "time_saved":
            t["value"] = round(float((saved_min * jobs).sum() / 60.0), 1)
            t["unit"] = "hrs/day"
        elif t["key"] == "new_riders":
            t["value"] = round(mp["dailyTransitRiders"] - mb["dailyTransitRiders"], 1)
            t["unit"] = "riders/day"

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
        "Sim-computed: metrics, agents, roads, tracts, line, impact.modeSplit, impact.minutesSavedByEarnings, "
        "whoPays.approval, verdict tests time_saved and new_riders (values only).",
        f"Not computed by the sim ({copied}): verdict headline/summary/grades/alternatives, other verdict tests, "
        "impact.tiles, impact.calibration, whoPays.items, claims, personas, lookahead.",
        "Background road traffic is a PLACEHOLDER fraction of capacity (HPMS not wired), lowered now that "
        "inbound commuters are modeled.",
        "Inbound commuters (home outside the box): only the in-box part of their trip is routed on the network; "
        "the approach outside the box (drive to a gateway, or walk/drive to a MARTA station) is an ESTIMATE "
        "added to their minutes. Their drawn paths start where they enter the box. Outbound commuters are not modeled.",
        "Mode choice: one global constant calibrated to a PLACEHOLDER 12% transit share (ACS not wired).",
    ]

    who = copy.deepcopy(mock["whoPays"])
    sup = np.array([a["stake"]["supportScore"] for a in agents])
    who["approval"] = {"support": round(float((sup > 0.1).mean()), 3), "oppose": round(float((sup < -0.1).mean()), 3),
                       "basis": int(len(sup)),
                       "note": "From display-sample stake scores (minutes delta + noise zone only; rent/cost not yet modeled)."}

    res = {
        "id": scen_id, "contractVersion": CONTRACT_VERSION, "title": title, "edit": edit, "isMock": False,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "timeWindow": {"startSec": 0, "endSec": 14400},
        "line": line, "networkUrl": NETWORK_URL,
        "metrics": {"baseline": mb, "proposed": mp},
        "verdict": verdict, "impact": impact, "agents": agents,
        "roads": road_effects(net, brun, prop_run), "tracts": tract_effects(dem, brun, prop_run),
        "whoPays": who, "claims": copy.deepcopy(mock.get("claims", [])),
        "personas": copy.deepcopy(mock.get("personas", [])),
        "lookahead": copy.deepcopy(mock["lookahead"]),
    }
    ScenarioResult.model_validate(res)  # pydantic mirror; zod check: node validate_contract.mjs
    return res


def write_result(res: dict, name: str | None = None):
    config.ensure_dirs()
    path = config.SCENARIO_OUT_DIR / f"{name or res['id']}.sim.json"
    path.write_text(json.dumps(res, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size/1e6:.2f} MB, {len(res['agents'])} agents)")
    return path



