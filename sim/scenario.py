"""Apply a ScenarioEdit to the cached baseline and rerun only what changed.

Implemented edit types: extend_line (also used as a generic "new line" when the
base line is not found). Others raise NotImplementedError (TODO).

Corridor geometry comes from OpenStreetMap, never typed by hand:
  - road corridors ("edgewood_ave", "*_st", ...) -> shortest path on the OSM drive
    graph, strongly preferring edges whose name matches the corridor
  - "beltline_eastside" -> OSM Eastside Trail ways (fetched by fetch_data.py)
Stops come from src/data/gazetteer.json (the contract's only allowed stops).
"""
from __future__ import annotations

import copy
import json
import re
import time

import networkx as nx
import numpy as np

import config
import export
from model import ModelRun, load_baseline, run_model
from transit import Pattern, TransitData

GAZETTEER_FILE = config.REPO_DIR / "src" / "data" / "gazetteer.json"
GTFS_LINE = {"atlanta_streetcar": "ATLSC"}  # contract RailLine id -> GTFS route_short_name

# ASSUMPTIONS: average operating speeds incl. dwell, km/h.
SPEED_MIXED_TRAFFIC_KPH = {"streetcar": 12, "light_rail": 18, "bus": 14, "brt": 18, "heavy_rail": 35}
SPEED_OWN_ROW_KPH = {"streetcar": 20, "light_rail": 26, "bus": 20, "brt": 24, "heavy_rail": 45}
DEFAULT_HEADWAY_MIN = 10.0
# When a lane is removed from a road that has only one lane per direction, the
# streetcar shares the remaining lane: capacity x this factor (ASSUMPTION).
SHARED_LANE_CAPACITY_FACTOR = 0.7
JUNCTION_MAX_M = 300.0
STREET_SUFFIX = {"ave": "Avenue", "st": "Street", "blvd": "Boulevard", "pkwy": "Parkway", "rd": "Road",
                 "dr": "Drive", "way": "Way"}
TRAIL_CORRIDORS = {"beltline_eastside": "beltline_eastside_trail"}

BELTLINE_STREETCAR_ID = "beltline-streetcar"


def _m(a, b):
    lat0 = np.cos(np.deg2rad(33.76))
    return float(np.hypot((a[0] - b[0]) * lat0, a[1] - b[1]) * 111_320)


def _plen(path):
    return sum(_m(path[i], path[i + 1]) for i in range(len(path) - 1))


def load_gazetteer() -> dict:
    return {p["id"]: p for p in json.loads(GAZETTEER_FILE.read_text(encoding="utf-8"))}


# ---------------------------------------------------------------- corridors
_trail_graph_cache: dict = {}


def trail_graph(name: str) -> nx.Graph:
    if name in _trail_graph_cache:
        return _trail_graph_cache[name]
    data = json.loads(config.CORRIDOR_FILE.read_text())
    segs = data["features"].get(name, [])
    G = nx.Graph()
    key = lambda c: (round(c[0], 6), round(c[1], 6))  # noqa: E731
    for seg in segs:
        for a, b in zip(seg[:-1], seg[1:]):
            G.add_edge(key(a), key(b), w=_m(a, b))
    # Bridge small gaps between disconnected OSM ways (<= 40 m).
    comps = list(nx.connected_components(G))
    if len(comps) > 1:
        ends = [n for n in G.nodes if G.degree(n) == 1]
        for i, a in enumerate(ends):
            for b in ends[i + 1:]:
                if not nx.has_path(G, a, b) and _m(a, b) <= 40:
                    G.add_edge(a, b, w=_m(a, b))
    _trail_graph_cache[name] = G
    return G


def path_on_trail(name, a, b):
    G = trail_graph(name)
    if not len(G):
        return None
    nodes = list(G.nodes)
    na = min(nodes, key=lambda n: _m(n, a))
    nb = min(nodes, key=lambda n: _m(n, b))
    if _m(na, a) > 250 or _m(nb, b) > 250 or not nx.has_path(G, na, nb):
        return None
    p = nx.shortest_path(G, na, nb, weight="w")
    return [list(a)] + [list(x) for x in p] + [list(b)]


def path_on_road(net, corridor, a, b):
    """Returns (path, edge_rows) along OSM drive edges preferring the corridor street."""
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra

    from demand import snap

    parts = corridor.split("_")
    street = " ".join(p.capitalize() for p in parts[:-1]) + " " + STREET_SUFFIX.get(parts[-1], parts[-1].capitalize())
    e = net.edges
    match = e["name"].str.contains(re.escape(street), case=False, regex=True).values
    w = e.length_m.values * np.where(match, 0.05, 1.0)
    # undirected: a streetcar can use either side of a two-way street
    u, v = e.u_idx.values, e.v_idx.values
    m = csr_matrix((np.r_[w, w], (np.r_[u, v], np.r_[v, u])), shape=(net.n_nodes, net.n_nodes))
    na, nb = snap(net, [a[0], b[0]], [a[1], b[1]])
    _, pred = dijkstra(m, indices=[na], return_predecessors=True)
    if pred[0, nb] < 0 and na != nb:
        return None, []
    nodes = [nb]
    while nodes[-1] != na:
        nodes.append(pred[0, nodes[-1]])
    nodes = nodes[::-1]
    pair_to_edge = {}
    for i in np.where(match | True)[0]:
        pair_to_edge.setdefault((u[i], v[i]), i)
    path, rows = [list(a)], []
    for x, y in zip(nodes[:-1], nodes[1:]):
        if (x, y) in pair_to_edge:
            i = pair_to_edge[(x, y)]
            g = net.edge_geoms[i]
        else:
            i = pair_to_edge[(y, x)]
            g = net.edge_geoms[i][::-1]
        rows.append(i)
        path += [list(c) for c in g]
    path.append(list(b))
    return path, rows


def build_corridor(net, edit, gz):
    """Ordered hop polylines between consecutive stops + metadata per hop."""
    corridors = edit.get("corridor") or []
    hops, kinds, notes = [], [], []
    stops = edit["stops"]
    for s0, s1 in zip(stops[:-1], stops[1:]):
        a, b = tuple(s0["coord"]), tuple(s1["coord"])
        c0 = set(gz.get(s0["gazetteerId"], {}).get("corridors", []))
        c1 = set(gz.get(s1["gazetteerId"], {}).get("corridors", []))
        shared = [c for c in corridors if c in c0 and c in c1] or [c for c in corridors if c in c0 | c1]
        path, kind = None, "straight"
        for c in shared:
            if c in TRAIL_CORRIDORS:
                path = path_on_trail(TRAIL_CORRIDORS[c], a, b)
                kind = "own_row"
            else:
                path, _ = path_on_road(net, c, a, b)
                kind = "mixed"
            if path:
                break
        if not path:
            path, kind = [list(a), list(b)], "straight"
            notes.append(f"No OSM corridor geometry for {s0['name']} -> {s1['name']}; straight line used.")
        hops.append([[round(x, 6), round(y, 6)] for x, y in path])
        kinds.append(kind)
    return hops, kinds, notes


# ---------------------------------------------------------------- edit
def apply_extend_line(base, edit):
    net, dem = base.net, base.dem
    gz = load_gazetteer()
    td0: TransitData = base.run.td
    td = TransitData(stops=td0.stops.copy(), patterns=list(td0.patterns))
    tech = edit.get("tech") or "streetcar"
    headway = float(edit.get("headwayMin") or DEFAULT_HEADWAY_MIN)
    hops, kinds, notes = build_corridor(net, edit, gz)

    # stop ids: new gazetteer stops get "gz_<id>"
    new_rows = []
    stop_ids = []
    for s in edit["stops"]:
        sid = f"gz_{s['gazetteerId']}"
        stop_ids.append(sid)
        new_rows.append({"stop_id": sid, "name": s["name"], "lng": s["coord"][0], "lat": s["coord"][1]})
    import pandas as pd

    ivt = []
    for hp, kind in zip(hops, kinds):
        kph = (SPEED_OWN_ROW_KPH if kind == "own_row" else SPEED_MIXED_TRAFFIC_KPH).get(tech, 15)
        ivt.append(max(30.0, _plen(hp) / (kph / 3.6)))

    base_short = GTFS_LINE.get(edit.get("baseLineId") or "", None)
    base_pats = [i for i, p in enumerate(td.patterns) if base_short and p.route_name == base_short]
    route_id = f"proposed_{edit.get('baseLineId') or 'line'}"
    s_xy = td.stops.set_index("stop_id")[["lng", "lat"]]
    junction = None
    for pi in base_pats:
        p = td.patterns[pi]
        d = [_m(s_xy.loc[x].values, edit["stops"][0]["coord"]) for x in p.stop_ids]
        j = int(np.argmin(d))
        if d[j] <= JUNCTION_MAX_M and j < len(p.stop_ids) - 0 and (junction is None or d[j] < junction[2]):
            junction = (pi, j, d[j])

    remove = set()
    new_pats = []
    if junction:
        pi, j, _ = junction
        p = td.patterns[pi]
        stop_ids[0] = p.stop_ids[j]  # through-run from the existing stop
        new_rows = new_rows[1:]
        ext_ids, ext_ivt, ext_hops = stop_ids[1:], ivt, hops
        A_ids = p.stop_ids[:j + 1] + ext_ids
        A_ivt = list(p.ivt_s[:j]) + ext_ivt
        A_hops = [None] * j + ext_hops
        B_ids = ext_ids[::-1] + p.stop_ids[j:]
        B_ivt = ext_ivt[::-1] + list(p.ivt_s[j:])
        B_hops = [h[::-1] for h in ext_hops[::-1]] + [None] * (len(p.stop_ids) - 1 - j)
        remove.add(pi)
        # Loop lines: continue B onto the base pattern that starts where p ends.
        for qi in base_pats:
            q = td.patterns[qi]
            if qi != pi and q.stop_ids[0] == p.stop_ids[-1]:
                B_ids += q.stop_ids[1:]
                B_ivt += list(q.ivt_s)
                B_hops += [None] * (len(q.stop_ids) - 1)
                remove.add(qi)
                break
        for nm, ids, iv, hh in (("A", A_ids, A_ivt, A_hops), ("B", B_ids, B_ivt, B_hops)):
            new_pats.append(Pattern(pattern_id=f"{route_id}_{nm}", route_id=route_id,
                                    route_name=f"{edit['name']}", mode=tech, headway_min=headway,
                                    stop_ids=ids, ivt_s=iv, hop_paths=hh))
        notes.append(f"Extended line through-runs from existing stop {p.stop_ids[j]}; whole extended line runs "
                     f"every {headway:g} min (base GTFS peak headway was {p.headway_min:g} min).")
    else:
        for nm, ids, iv, hh in (("A", stop_ids, ivt, hops),
                                ("B", stop_ids[::-1], ivt[::-1], [h[::-1] for h in hops[::-1]])):
            new_pats.append(Pattern(pattern_id=f"{route_id}_{nm}", route_id=route_id, route_name=edit["name"],
                                    mode=tech, headway_min=headway, stop_ids=ids, ivt_s=iv, hop_paths=hh))
        notes.append("Base line not found in GTFS; modeled as a new stand-alone line.")
    td.patterns = [p for i, p in enumerate(td.patterns) if i not in remove] + new_pats
    if new_rows:
        td.stops = pd.concat([td.stops, pd.DataFrame(new_rows)], ignore_index=True).drop_duplicates("stop_id")

    # Road capacity change
    cap = base.run.capacity.copy()
    rids = set(edit.get("roadIds") or [])
    removed = int(edit.get("lanesRemoved") or 0)
    hit = np.array([bool(rids & set(w)) for w in net.edges.way_ids]) if rids else np.zeros(len(cap), bool)
    if removed and hit.any():
        lanes = net.edges.lanes.values
        cpl = net.edges.cap_per_lane.values
        new_l = lanes - removed
        cap[hit] = np.where(new_l[hit] >= 1, new_l[hit] * cpl[hit], cpl[hit] * SHARED_LANE_CAPACITY_FACTOR)
        notes.append(f"Removed {removed} lane/direction on {hit.sum()} road edges ({len(rids)} OSM ways); "
                     f"single-lane edges keep {SHARED_LANE_CAPACITY_FACTOR:.0%} capacity as a shared lane.")

    line_path = []
    for hp in hops:
        line_path += hp if not line_path else hp[1:]
    line = {"path": [[round(x, 5), round(y, 5)] for x, y in line_path], "stops": edit["stops"]}
    return td, cap, line, notes, {pi for pi, p in enumerate(td.patterns) if p.route_id == route_id}


def run_scenario(edit: dict, scen_id: str, title: str | None = None, n_sample=export.DISPLAY_SAMPLE_SIZE,
                 base=None, verbose=True):
    t = time.time()
    base = base or load_baseline(verbose=verbose)
    t_base = time.time() - t
    if edit["type"] not in ("extend_line", "new_rail_line"):
        raise NotImplementedError(f"edit type {edit['type']} not implemented yet (TODO)")
    td, cap, line, notes, new_pats = apply_extend_line(base, edit)
    t1 = time.time()
    run, _ = run_model(base.net, base.dem, td, cap, asc=base.asc, verbose=verbose)
    t_model = time.time() - t1

    from transit import patterns_on_paths

    rides_new = patterns_on_paths(run.tg, run.tsk, base.dem.od, new_pats)
    riders_new = float((base.dem.od.jobs.values * run.p_transit * rides_new).sum())
    edit_out = copy.deepcopy(edit)
    edit_out["assumptions"] = list(edit.get("assumptions") or []) + notes
    res = export.build_result(scen_id, title or edit["name"], edit_out, base, run, line, n_sample=n_sample)
    res["impact"]["notes"].append(
        f"Commuters whose transit path rides the new/extended line: {riders_new:,.0f}/day "
        f"(of {res['metrics']['proposed']['dailyTransitRiders']:,.0f} transit commuters; in-box LODES flows only).")
    if verbose:
        mb, mp = res["metrics"]["baseline"], res["metrics"]["proposed"]
        print(f"scenario {scen_id}: transit share {mb['transitShare']:.3f} -> {mp['transitShare']:.3f}, "
              f"avg {mb['avgCommuteMin']:.2f} -> {mp['avgCommuteMin']:.2f} min, riders on line {riders_new:,.0f}")
        print(f"  timings: baseline load {t_base:.1f}s, scenario model {t_model:.1f}s, total {time.time()-t:.1f}s")
        for n in notes:
            print("  note:", n)
    res["_timings"] = {"baseline_load_s": t_base, "model_s": t_model, "total_s": time.time() - t,
                       "riders_on_line": riders_new}
    return res


def beltline_edit() -> dict:
    """The demo edit: identical to the frontend mock's edit when available."""
    if config.MOCK_SCENARIO.exists():
        m = json.loads(config.MOCK_SCENARIO.read_text(encoding="utf-8"))
        return copy.deepcopy(m["edit"])
    gz = load_gazetteer()
    ids = ["streetcar_king_historic_district", "beltline_edgewood", "beltline_irwin",
           "beltline_freedom_pkwy", "beltline_north_ave", "ponce_city_market"]
    return {"type": "extend_line", "name": "Streetcar East to Ponce City Market",
            "stops": [{"gazetteerId": i, "name": gz[i]["name"], "coord": gz[i]["coord"]} for i in ids],
            "corridor": ["edgewood_ave", "beltline_eastside"], "baseLineId": "atlanta_streetcar",
            "tech": "streetcar", "headwayMin": 10, "lanesRemoved": 1, "roadIds": []}


def run_beltline(n_sample=export.DISPLAY_SAMPLE_SIZE):
    edit = beltline_edit()
    res = run_scenario(edit, BELTLINE_STREETCAR_ID, n_sample=n_sample)
    res.pop("_timings", None)
    return export.write_result(res, BELTLINE_STREETCAR_ID)
