"""Edit types beyond extend_line: change_frequency, brt_lane, close_road, new_rail_line,
new_bus_route. Each `apply_*` returns a Change dict consumed by scenario.run_scenario:

  td, cap          transit data and road capacities for the proposed run
  closed           bool per road edge (closures) or None
  extra_od         displaced background traffic to reroute (closures) or None
  road_only        True -> reuse the baseline transit graph + skim (faster)
  new_pats         pattern indices counted as "the line" (riders on line)
  line             contract line {path, stops} for display
  change           {track, stops, cost} for the verdict (new track, new stops, cost spec)
  notes            assumptions appended to edit.assumptions

Every assumption is a named constant (README "Assumptions and placeholders").
"""
from __future__ import annotations

import copy

import numpy as np
import pandas as pd

import costs
from transit import LINE_ROUTES, Pattern, TransitData


class EditError(ValueError):
    """The edit cannot be placed on the network (shown to the user)."""


# ---- ASSUMPTIONS -----------------------------------------------------------
DEFAULT_HEADWAY_MIN = {"streetcar": 10.0, "light_rail": 10.0, "heavy_rail": 8.0, "bus": 15.0, "brt": 10.0}
BRT_SPEED_KPH = 22.0           # average incl. dwell in a dedicated lane (not slowed by traffic)
BRT_STOP_SPACING_M = 600.0     # BRT stations roughly every 600 m along the corridor
NEW_BUS_SPEED_KPH = 14.0       # new local bus in mixed traffic, incl. dwell (not slowed further by congestion)
NEW_RAIL_SPEED_KPH = {"streetcar": 18.0, "light_rail": 26.0, "heavy_rail": 45.0}
SHARED_LANE_CAPACITY_FACTOR = 0.7  # same rule as scenario.py lane removal


def _m(a, b):
    lat0 = np.cos(np.deg2rad(33.76))
    return float(np.hypot((a[0] - b[0]) * lat0, a[1] - b[1]) * 111_320)


def _plen(p):
    return sum(_m(p[i], p[i + 1]) for i in range(len(p) - 1))


def way_mask(net, road_ids) -> np.ndarray:
    rids = set(road_ids or [])
    if not rids:
        return np.zeros(len(net.edges), bool)
    return np.array([bool(rids & set(w)) for w in net.edges.way_ids])


def lane_removal(net, cap, mask, lanes_removed):
    cap = cap.copy()
    if lanes_removed and mask.any():
        lanes = net.edges.lanes.values
        cpl = net.edges.cap_per_lane.values
        new_l = lanes - lanes_removed
        cap[mask] = np.where(new_l[mask] >= 1, new_l[mask] * cpl[mask], cpl[mask] * SHARED_LANE_CAPACITY_FACTOR)
    return cap


def line_route_names(line_id):
    if not line_id:
        return []
    return LINE_ROUTES.get(line_id, [])


def _hop_concat(patterns):
    path = []
    for p in patterns:
        for h in (p.hop_paths or []):
            if h:
                path += h if not path else h[1:]
    return [[round(x, 5), round(y, 5)] for x, y in path]


# ---------------------------------------------------------------------------- change_frequency
def apply_change_frequency(base, edit):
    names = line_route_names(edit.get("baseLineId"))
    h = edit.get("headwayMin")
    if not names:
        raise EditError(f"change_frequency: unknown line '{edit.get('baseLineId')}'")
    if not h:
        raise EditError("change_frequency: headwayMin is required")
    # The parser notes a MARTA colour ("MARTA Red line read as ..."): change that route only.
    import re

    m = re.search(r"MARTA (Red|Gold|Blue|Green) line", " ".join(edit.get("assumptions") or []))
    if m and m.group(1).upper() in names:
        names = [m.group(1).upper()]
    td0 = base.run.td
    pats, hits, old = [], [], []
    for p in td0.patterns:
        if p.route_name in names:
            q = copy.copy(p)
            q.headway_min = float(h)
            old.append((float(sum(p.ivt_s)), p.headway_min, float(h)))
            hits.append(len(pats))
            pats.append(q)
        else:
            pats.append(p)
    if not hits:
        raise EditError(f"change_frequency: line '{edit.get('baseLineId')}' has no peak service in the study box")
    td = TransitData(stops=td0.stops, patterns=pats)
    mode = pats[hits[0]].mode
    dvh = costs.vehicle_hours_delta(old)
    cost = costs.operating(dvh, "streetcar" if mode == "streetcar" else ("heavy_rail" if mode == "rail" else "bus"),
                           f"{edit.get('baseLineId')} every {h:g} min") if dvh > 0 else \
        costs.not_applicable("the edit removes service, so it saves operating cost rather than adding it")
    notes = [f"Peak headway on {', '.join(names)} set to {h:g} min (GTFS 7-9 AM headways were "
             f"{', '.join(sorted({f'{o[1]:g}' for o in old}))} min); waits = headway/2."]
    # drawn line: the longest changed pattern (one direction), simplified to 15 m
    import display

    longest = max((pats[i] for i in hits), key=lambda q: len(q.stop_ids))
    line = {"path": display.simplify(_hop_concat([longest])), "stops": []}
    return {"td": td, "cap": base.run.capacity.copy(), "closed": None, "extra_od": None, "road_only": False,
            "new_pats": set(hits), "line": line, "notes": notes,
            "change": {"track": None, "stops": [], "cost": cost}}


# ---------------------------------------------------------------------------- brt_lane
def _corridor_from_ways(net, mask):
    """Ordered polyline + edge rows along the edited road (longest chain of the edited edges)."""
    import networkx as nx

    e = net.edges
    G = nx.Graph()
    for i in np.where(mask)[0]:
        u, v = int(e.u_idx.values[i]), int(e.v_idx.values[i])
        if not G.has_edge(u, v) or G[u][v]["w"] > e.length_m.values[i]:
            G.add_edge(u, v, w=float(e.length_m.values[i]), i=int(i))
    if not len(G):
        return None, []
    comp = max(nx.connected_components(G), key=lambda c: sum(G.degree(n) for n in c))
    H = G.subgraph(comp)
    xy = net.node_xy
    ends = [n for n in H if H.degree(n) == 1] or list(H)
    # endpoints = farthest pair among chain ends (straight line)
    best = (0.0, ends[0], ends[0])
    for a in ends:
        for b in ends:
            d = _m(xy[a], xy[b])
            if d > best[0]:
                best = (d, a, b)
    nodes = nx.shortest_path(H, best[1], best[2], weight="w")
    path, rows = [list(xy[nodes[0]])], []
    for a, b in zip(nodes[:-1], nodes[1:]):
        i = H[a][b]["i"]
        g = net.edge_geoms[i]
        g = g if int(e.u_idx.values[i]) == a else g[::-1]
        path += [list(c) for c in g[1:]]
        rows.append(i)
    return path, rows


def _cut(path, positions_m):
    """Split a polyline at the given distances (m) -> list of hop polylines + stop points."""
    from shapely.geometry import LineString
    from shapely.ops import substring

    lat0 = np.cos(np.deg2rad(33.76))
    k = 111_320.0
    ls = LineString([(x * lat0 * k, y * k) for x, y in path])
    back = lambda c: [c[0] / (lat0 * k), c[1] / k]  # noqa: E731
    hops = []
    for a, b in zip(positions_m[:-1], positions_m[1:]):
        seg = substring(ls, a, b)
        hops.append([back(c) for c in seg.coords])
    stops = [back(ls.interpolate(p).coords[0]) for p in positions_m]
    return hops, stops


def _new_line_patterns(route_id, name, mode, headway, stop_ids, ivt, hops):
    return [Pattern(pattern_id=f"{route_id}_A", route_id=route_id, route_name=name, mode=mode, headway_min=headway,
                    stop_ids=list(stop_ids), ivt_s=list(ivt), hop_paths=hops),
            Pattern(pattern_id=f"{route_id}_B", route_id=route_id, route_name=name, mode=mode, headway_min=headway,
                    stop_ids=list(stop_ids)[::-1], ivt_s=list(ivt)[::-1], hop_paths=[h[::-1] for h in hops[::-1]])]


def _stops_in_box(stops):
    import config

    w, s_, e_, n_ = config.BBOX
    for s in stops:
        x, y = s["coord"]
        if not (w <= x <= e_ and s_ <= y <= n_):
            raise EditError(f"{s['name']} is outside the area the simulator covers")


def _streets_on(net, rows, limit=4):
    """Street names along a route in order of travel (the `limit` longest ones)."""
    e = net.edges
    km: dict = {}
    for i in rows:
        nm = e.name.values[i]
        if nm:
            km[nm] = km.get(nm, 0.0) + float(e.length_m.values[i])
    keep = set(sorted(km, key=km.get, reverse=True)[:limit])
    return [n for n in km if n in keep]


def _street_at(net, rows, q):
    """Name of the route's street nearest to point q ('' when unnamed)."""
    i = min(rows, key=lambda r: min(_m(c, q) for c in net.edge_geoms[r]))
    return net.edges.name.values[i] or ""


def _brt_between_stops(net, stops):
    """No road named: the bus lane follows the street route between the named places.
    -> (path, edge rows, edge mask in both directions, hops, station points, names, gazetteer ids)."""
    from scenario import path_on_streets

    _stops_in_box(stops)
    e = net.edges
    eu, ev = e.u_idx.values, e.v_idx.values
    both: dict = {}
    for i in range(len(e)):
        both.setdefault((min(eu[i], ev[i]), max(eu[i], ev[i])), []).append(i)
    mask = np.zeros(len(e), bool)
    path, rows_all, hops, pts, names, gids = [], [], [], [], [], []
    for k, (a, b) in enumerate(zip(stops[:-1], stops[1:])):
        p, rows = path_on_streets(net, tuple(a["coord"]), tuple(b["coord"]))
        if not p or len(p) < 2:
            raise EditError(f"brt_lane: no street route between {a['name']} and {b['name']}")
        for i in rows:
            mask[both[(min(eu[i], ev[i]), max(eu[i], ev[i]))]] = True
        rows_all += rows
        L = _plen(p)
        sub, cut = _cut(p, list(np.linspace(0, L, max(1, int(round(L / BRT_STOP_SPACING_M))) + 1)))
        hops += sub
        path += p if not path else p[1:]
        for j, q in enumerate(cut if k == len(stops) - 2 else cut[:-1]):
            named = a if j == 0 else b if j == len(cut) - 1 else None
            pts.append(list(named["coord"]) if named else q)
            names.append(named["name"] if named else _street_at(net, rows, q))
            gids.append(named["gazetteerId"] if named else None)
    return path, rows_all, mask, hops, pts, names, gids


def apply_brt_lane(base, edit):
    net = base.net
    stops_in = edit.get("stops") or []
    mask = way_mask(net, edit.get("roadIds"))
    if mask.any():
        path, rows = _corridor_from_ways(net, mask)
        if not path or _plen(path) < 2 * BRT_STOP_SPACING_M:
            raise EditError("brt_lane: the listed roads do not form a corridor long enough for BRT stations")
        L = _plen(path)
        n = max(2, int(round(L / BRT_STOP_SPACING_M)) + 1)
        hops, stop_xy = _cut(path, list(np.linspace(0, L, n)))
        road = net.edges.name.values[rows]
        road_name = pd.Series([r for r in road if r]).mode().iloc[0] if any(road) else "the corridor"
        where = f"along {road_name}"
        names = [f"{road_name} BRT {k+1}" for k in range(n)]
        gids = [None] * n
    elif len(stops_in) >= 2:
        path, rows, mask, hops, stop_xy, names, gids = _brt_between_stops(net, stops_in)
        L = _plen(path)
        n = len(stop_xy)
        names = [nm if g else f"{nm or 'BRT'} BRT {k+1}" for k, (nm, g) in enumerate(zip(names, gids))]
        via = _streets_on(net, rows)
        where = (f"from {stops_in[0]['name']} to {stops_in[-1]['name']}" + (f" via {', '.join(via)}" if via else "")
                 + " (no road named: shortest street route, freeways excluded, arterials preferred)")
    else:
        raise EditError("brt_lane: a bus lane needs a road on the simulated network, or two places inside the "
                        "simulated area to run between")
    headway = float(edit.get("headwayMin") or DEFAULT_HEADWAY_MIN["brt"])
    ivt = [max(30.0, _plen(h) / (BRT_SPEED_KPH / 3.6)) for h in hops]
    ids = [f"gz_{g}" if g else f"brt_{k}" for k, g in enumerate(gids)]
    td0 = base.run.td
    stops = pd.concat([td0.stops, pd.DataFrame({"stop_id": ids, "name": names,
                                                "lng": [s[0] for s in stop_xy], "lat": [s[1] for s in stop_xy]})],
                      ignore_index=True).drop_duplicates("stop_id")
    new = _new_line_patterns("proposed_brt", edit.get("name") or "BRT", "brt", headway, ids, ivt, hops)
    td = TransitData(stops=stops, patterns=list(td0.patterns) + new)
    lanes = int(edit.get("lanesRemoved") if edit.get("lanesRemoved") is not None else 1)
    cap = lane_removal(net, base.run.capacity, mask, lanes)
    notes = [f"BRT {where}: {L/1000:.1f} km, {n} stations every ~{BRT_STOP_SPACING_M:g} m, every {headway:g} min, "
             f"{BRT_SPEED_KPH:g} km/h average in its own lane (not slowed by traffic).",
             f"{lanes} car lane(s) per direction removed on {int(mask.sum())} road edges; single-lane edges keep "
             f"{SHARED_LANE_CAPACITY_FACTOR:.0%} capacity."]
    line = {"path": [[round(x, 5), round(y, 5)] for x, y in path],
            "stops": [{"gazetteerId": g or f"sim_brt_{k+1}", "name": names[k],
                       "coord": [round(s[0], 5), round(s[1], 5)]} for k, (s, g) in enumerate(zip(stop_xy, gids))]}
    return {"td": td, "cap": cap, "closed": None, "extra_od": None, "road_only": False,
            "new_pats": {len(td0.patterns), len(td0.patterns) + 1}, "line": line, "notes": notes,
            "change": {"track": None, "stops": [tuple(s) for s in stop_xy], "cost": costs.capital(L, "brt")}}


# ---------------------------------------------------------------------------- close_road
def apply_close_road(base, edit):
    from scipy.sparse.csgraph import dijkstra

    import networkx as nx
    from assign import background_volume

    net = base.net
    closed = way_mask(net, edit.get("roadIds"))
    if not closed.any():
        raise EditError("close_road: none of the roadIds are on the simulated road network")
    e = net.edges
    bg = background_volume(net)
    # Displaced background (through) traffic: each closed directed stretch sends its mean
    # background volume from its upstream end to its downstream end over the open network.
    D = nx.DiGraph()
    for i in np.where(closed)[0]:
        D.add_edge(int(e.u_idx.values[i]), int(e.v_idx.values[i]), v=float(bg[i]))
    t0 = e.t0_s.values.copy()
    t0[closed] = np.inf
    keep = np.isfinite(t0)
    from scipy.sparse import csr_matrix

    m = csr_matrix((t0[keep], (e.u_idx.values[keep], e.v_idx.values[keep])), shape=(net.n_nodes, net.n_nodes))
    xo, xd, xv, lost = [], [], [], 0.0
    for comp in nx.weakly_connected_components(D):
        S = D.subgraph(comp)
        srcs = [n for n in S if S.in_degree(n) == 0] or list(S)
        snks = [n for n in S if S.out_degree(n) == 0] or list(S)
        vol = float(np.mean([d["v"] for *_, d in S.edges(data=True)]))
        best = max(((a, b) for a in srcs for b in snks if a != b),
                   key=lambda ab: _m(net.node_xy[ab[0]], net.node_xy[ab[1]]), default=None)
        if best is None:
            continue
        d = dijkstra(m, indices=[best[0]])[0, best[1]]
        if np.isfinite(d):
            xo.append(best[0]); xd.append(best[1]); xv.append(vol)
        else:
            lost += vol
    notes = [f"Closed {int(closed.sum())} road edges ({len(set(edit.get('roadIds') or []))} OSM ways). Commuters reroute; "
             f"background through traffic on the closed roads ({sum(xv):,.0f} veh/h over {len(xo)} stretches) is "
             f"rerouted between each stretch's ends" + (f"; {lost:,.0f} veh/h with no detour inside the box is dropped "
                                                        f"(assumed to divert outside the box)." if lost else ".")]
    return {"td": base.run.td, "cap": base.run.capacity.copy(), "closed": closed,
            "extra_od": (np.asarray(xo, int), np.asarray(xd, int), np.asarray(xv, float)), "road_only": True,
            "new_pats": set(), "line": {"path": [], "stops": []}, "notes": notes,
            "change": {"track": None, "stops": [], "cost": costs.not_applicable("a road closure has no capital cost and no new riders to price")}}


# ---------------------------------------------------------------------------- new lines
# ASSUMPTIONS (new bus routes): bus in-vehicle time = baseline congested car time along the
# route x BUS_TIME_FACTOR + BUS_DWELL_S per stop; stops every ~BUS_STOP_SPACING_M between the
# gazetteer stops the edit names.
BUS_TIME_FACTOR = 1.3
BUS_DWELL_S = 20.0
BUS_STOP_SPACING_M = 500.0


def _new_bus(base, edit, stops, tech):
    from scenario import path_on_road

    net = base.net
    t_edge = base.run.asg.time_s
    hops, ivt, ids, names, xy = [], [], [], [], []
    for k, (a, b) in enumerate(zip(stops[:-1], stops[1:])):
        p, rows = path_on_road(net, None, tuple(a["coord"]), tuple(b["coord"]))
        if not p or len(p) < 2:
            raise EditError(f"no road route between {a['name']} and {b['name']}")
        L = _plen(p)
        t_road = float(t_edge[rows].sum()) if rows else L / 8.0
        n_int = max(1, int(round(L / BUS_STOP_SPACING_M)))
        pos = list(np.linspace(0, L, n_int + 1))
        sub, pts = _cut(p, pos)
        for j, h in enumerate(sub):
            hops.append(h)
            ivt.append(max(30.0, t_road * BUS_TIME_FACTOR * (_plen(h) / max(L, 1.0)) + BUS_DWELL_S))
        for j, q in enumerate(pts[:-1] if k < len(stops) - 2 else pts):
            if j == 0:
                ids.append(f"gz_{a['gazetteerId']}"); names.append(a["name"]); xy.append(a["coord"])
            elif j == len(pts) - 1:
                ids.append(f"gz_{b['gazetteerId']}"); names.append(b["name"]); xy.append(b["coord"])
            else:
                ids.append(f"bus_{k}_{j}"); names.append(f"{edit.get('name') or 'Bus'} stop {len(ids) + 1}"); xy.append(q)
    headway = float(edit.get("headwayMin") or DEFAULT_HEADWAY_MIN["bus"])
    td0 = base.run.td
    st = pd.concat([td0.stops, pd.DataFrame({"stop_id": ids, "name": names, "lng": [c[0] for c in xy],
                                             "lat": [c[1] for c in xy]})], ignore_index=True).drop_duplicates("stop_id")
    new = _new_line_patterns(f"proposed_{edit['type']}", edit.get("name") or "New bus", "bus", headway, ids, ivt, hops)
    td = TransitData(stops=st, patterns=list(td0.patterns) + new)
    path = []
    for h in hops:
        path += h if not path else h[1:]
    L = _plen(path)
    notes = [f"New bus route: {len(ids)} stops ({len(stops)} named, others every ~{BUS_STOP_SPACING_M:g} m), "
             f"{L/1000:.1f} km, every {headway:g} min; runs in mixed traffic at baseline car time x "
             f"{BUS_TIME_FACTOR:g} + {BUS_DWELL_S:g} s per stop ({sum(ivt)/60:.0f} min end to end)."]
    cost = costs.operating(costs.vehicle_hours_delta([(sum(ivt) * 2, 0, headway)]), "bus", "the new bus route")
    line = {"path": [[round(x, 5), round(y, 5)] for x, y in path], "stops": stops}
    return {"td": td, "cap": base.run.capacity.copy(), "closed": None, "extra_od": None, "road_only": False,
            "new_pats": {len(td0.patterns), len(td0.patterns) + 1}, "line": line, "notes": notes,
            "change": {"track": None, "stops": [tuple(c) for c in xy], "cost": cost}}
def apply_new_line(base, edit, build_corridor, path_on_road):
    net = base.net
    stops = edit.get("stops") or []
    if len(stops) < 2:
        got = ", ".join(s["name"] for s in stops) or "none"
        import re

        miss = re.findall(r"Could not place '([^']+)'", " ".join(edit.get("assumptions") or []))
        if miss:
            raise EditError(f"{' and '.join(miss)} is outside the area the simulator covers, or is not a place it "
                            f"knows; a new line needs two stops in central Atlanta.")
        raise EditError(f"A new line needs at least two stops inside the simulated area; got {len(stops)} ({got}). "
                        f"Places outside the core box (Downtown, Midtown, Old Fourth Ward, Eastside) are not "
                        f"simulated yet.")
    _stops_in_box(stops)
    is_bus = edit["type"] == "new_bus_route" or (edit.get("tech") in ("bus", "brt"))
    tech = edit.get("tech") or ("bus" if is_bus else "light_rail")
    notes = []
    if is_bus:
        return _new_bus(base, edit, stops, tech)
    if edit.get("corridor"):
        from scenario import load_gazetteer

        hops, kinds, cn = build_corridor(net, edit, load_gazetteer())
        notes += cn
    elif tech == "heavy_rail":
        hops = [[list(a["coord"]), list(b["coord"])] for a, b in zip(stops[:-1], stops[1:])]
        notes.append("No corridor given: heavy rail is grade-separated, so it is drawn and timed as straight "
                     "lines between stations (assumption).")
    else:
        from scenario import path_on_streets

        hops, rows = [], []
        for a, b in zip(stops[:-1], stops[1:]):
            p, r = path_on_streets(net, tuple(a["coord"]), tuple(b["coord"]))
            if not p or len(p) < 2:
                raise EditError(f"no street route between {a['name']} and {b['name']}")
            hops.append(p); rows += r
        via = _streets_on(net, rows)
        notes.append("No corridor given: the line follows the shortest street route between stops"
                     + (f" (via {', '.join(via)})" if via else "") + "; freeways excluded, arterials preferred "
                     "(assumption).")
    speeds = [NEW_RAIL_SPEED_KPH.get(tech, 26.0)] * len(hops)
    ivt = [max(30.0, _plen(h) / (s / 3.6)) for h, s in zip(hops, speeds)]
    headway = float(edit.get("headwayMin") or DEFAULT_HEADWAY_MIN.get(tech, 10.0))
    ids = [f"gz_{s['gazetteerId']}" for s in stops]
    td0 = base.run.td
    st = pd.concat([td0.stops, pd.DataFrame({"stop_id": ids, "name": [s["name"] for s in stops],
                                             "lng": [s["coord"][0] for s in stops], "lat": [s["coord"][1] for s in stops]})],
                   ignore_index=True).drop_duplicates("stop_id")
    mode = "bus" if is_bus else tech
    new = _new_line_patterns(f"proposed_{edit['type']}", edit.get("name") or "New line", mode, headway, ids, ivt, hops)
    td = TransitData(stops=st, patterns=list(td0.patterns) + new)
    path = []
    for h in hops:
        path += h if not path else h[1:]
    L = _plen(path)
    notes.append(f"New {tech.replace('_', ' ')} line: {len(stops)} stops, {L/1000:.1f} km, every {headway:g} min, "
                 f"{speeds[0]:g} km/h average.")
    if is_bus:
        cost = costs.operating(costs.vehicle_hours_delta([(sum(ivt) * 2, 0, headway)]), "bus", "the new bus route")
        track = None
    elif tech in ("streetcar", "light_rail"):
        cost = costs.capital(L, "streetcar")
        track = path
        if tech == "light_rail":
            notes.append("Light rail priced with streetcar per-mile benchmarks (likely an underestimate).")
    else:
        cost = costs.not_applicable("no heavy-rail cost benchmark is loaded")
        track = path
    line = {"path": [[round(x, 5), round(y, 5)] for x, y in path], "stops": stops}
    return {"td": td, "cap": base.run.capacity.copy(), "closed": None, "extra_od": None, "road_only": False,
            "new_pats": {len(td0.patterns), len(td0.patterns) + 1}, "line": line, "notes": notes,
            "change": {"track": track, "stops": [tuple(s["coord"]) for s in stops], "cost": cost}}
