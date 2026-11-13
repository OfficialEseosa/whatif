"""Display geometry for agent trips: every drawn vertex follows real network geometry.

Display only - the model's minutes are not changed. Each leg's modeled travel time
is spread over that leg's drawn vertices in proportion to distance.

  - walk legs (home -> stop, transfers, stop -> work) and the local "connector" part
    of drive trips are routed on the OSM drive graph used as an undirected walk proxy;
  - transit rides follow GTFS shapes.txt cut between stops (stops projected onto the
    shape, monotone along it); bus hops with no usable shape are routed on the road
    graph; the proposed line uses the scenario's line.path between its stops;
  - home/work points connect to the nearest network node with a straight stub only if
    it is <= MAX_STUB_M, otherwise the drawn path starts/ends at that node.
"""
from __future__ import annotations

import zipfile
from collections import Counter

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

import config

MAX_STUB_M = 50.0             # longest straight home/work/stop -> street connector drawn; beyond it the path starts/ends on the street
SHAPE_MAX_STOP_OFFSET_M = 120.0  # a stop farther than this from its pattern's shape -> road-route that hop
SIMPLIFY_TOL_M = 15.0         # Douglas-Peucker tolerance (m): a drawn vertex is never more than 15 m off its
                              # street/shape, far below a block (~100 m), so no corner can be cut across one
WALK_SEARCH_LIMIT_M = 6000.0
# Freeway edges (multi-lane carriageways 15-30 m wide) are pre-simplified at this tolerance.
SIMPLIFY_WIDE_TOL_M = 25.0
WIDE_ROAD_CLASSES = {"motorway", "trunk"}
PROJ_STEP_M = 10.0            # densification step for projecting points onto streets
LAT0 = np.cos(np.deg2rad(33.765))
K = 111_320.0


def to_xy(ll):
    ll = np.asarray(ll, float)
    return np.c_[ll[:, 0] * LAT0 * K, ll[:, 1] * K]


def to_ll(xy):
    xy = np.asarray(xy, float)
    return np.c_[xy[:, 0] / (LAT0 * K), xy[:, 1] / K]


def seg_len(a, b):
    return float(np.hypot((b[0] - a[0]) * LAT0, b[1] - a[1]) * K)


def dedupe(coords):
    if len(coords) == 0:
        return []
    p = np.asarray(coords, float).reshape(-1, 2)
    if len(p) > 1:
        d = np.abs(np.diff(p, axis=0))
        p = p[np.r_[True, (d[:, 0] > 1e-9) | (d[:, 1] > 1e-9)]]
    return p.tolist()


def simplify(coords, tol_m=SIMPLIFY_TOL_M):
    """Douglas-Peucker on metric coords; returns a subset of the input vertices."""
    return [coords[i] for i in simplify_idx(coords, tol_m)]


def simplify_idx(coords, tol_m=SIMPLIFY_TOL_M):
    """Indices kept by Douglas-Peucker (tolerance in metres)."""
    if len(coords) <= 2:
        return list(range(len(coords)))
    p = to_xy(coords)
    keep = np.zeros(len(p), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = p[i], p[j]
        ab = b - a
        L = np.hypot(*ab)
        q = p[i + 1:j]
        if L == 0:
            d = np.hypot(*(q - a).T)
        else:
            d = np.abs(ab[0] * (q[:, 1] - a[1]) - ab[1] * (q[:, 0] - a[0])) / L
        k = int(np.argmax(d))
        if d[k] > tol_m:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return [int(i) for i in np.where(keep)[0]]


def timed(coords, t0, t1):
    """Distance-proportional timestamps between t0 and t1 for a leg."""
    if len(coords) == 1:
        return [t0]
    return (t0 + (t1 - t0) * fractions(coords)).tolist()


def fractions(coords):
    """Cumulative share of a polyline's length at each vertex (0..1)."""
    p = np.asarray(coords, float)
    d = np.r_[0.0, np.cumsum(np.hypot((p[1:, 0] - p[:-1, 0]) * LAT0, p[1:, 1] - p[:-1, 1]))]
    return d / d[-1] if d[-1] > 0 else np.linspace(0.0, 1.0, len(p))


def prep(coords):
    """(deduped coords as a list, cumulative length fractions) for one drawn leg."""
    p = np.asarray(coords, float).reshape(-1, 2)
    if len(p) > 1:
        d = np.abs(np.diff(p, axis=0))
        p = p[np.r_[True, (d[:, 0] > 1e-9) | (d[:, 1] > 1e-9)]]
    if len(p) == 1:
        return p.tolist(), np.zeros(1)
    d = np.r_[0.0, np.cumsum(np.hypot((p[1:, 0] - p[:-1, 0]) * LAT0, p[1:, 1] - p[:-1, 1]))]
    return p.tolist(), (d / d[-1] if d[-1] > 0 else np.linspace(0.0, 1.0, len(p)))


_HOPS: dict = {}


def hop_draw(hp):
    """prep() of a transit hop polyline, cached by object identity (hop lists are never edited)."""
    c = _HOPS.get(id(hp))
    if c is None or c[0] is not hp:
        if len(_HOPS) > 20000:
            _HOPS.clear()
        c = _HOPS[id(hp)] = (hp,) + prep(hp)
    return c[1], c[2]


def edge_draw(net, i):
    """(deduped coords, cumulative length fractions) of a network edge, cached on the network."""
    cache = net.__dict__.setdefault("_edge_draw", {})
    if i not in cache:
        g = dedupe(net.edge_geoms[i])
        cache[i] = (g, fractions(g) if len(g) > 1 else np.zeros(1))
    return cache[i]


class Router:
    """Undirected shortest paths (by length) on the drive graph, as a walk/connector proxy."""

    def __init__(self, net):
        self.net = net
        e = net.edges
        L = e.length_m.values
        u, v = e.u_idx.values, e.v_idx.values
        order = np.lexsort((L, np.maximum(u, v), np.minimum(u, v)))
        self.geom = {}
        for i in order[::-1]:  # shortest parallel edge wins (written last)
            self.geom[(u[i], v[i])] = (i, False)
            self.geom[(v[i], u[i])] = (i, True)
        # undirected adjacency, MIN length per node pair (a two-way street is two directed
        # edges; summing duplicates would double its length)
        r, c, w = np.r_[u, v], np.r_[v, u], np.r_[L, L]
        o = np.lexsort((w, c, r))
        r, c, w = r[o], c[o], w[o]
        first = np.r_[True, (r[1:] != r[:-1]) | (c[1:] != c[:-1])]
        self.m = csr_matrix((np.maximum(w[first], 1e-3), (r[first], c[first])), shape=(net.n_nodes, net.n_nodes))
        self.tree = cKDTree(to_xy(net.node_xy))
        self._cache = {}
        self.u, self.v = u, v
        self.routes = {}          # route() results as (coords, length fractions); see export display cache
        self.routes_dirty = False

    def nearest(self, ll):
        d, i = self.tree.query(to_xy([ll])[0])
        return int(i), float(d)

    def node_path(self, a, b):
        key = (a, b)
        if key in self._cache:
            return self._cache[key]
        if a == b:
            res = [a]
        else:
            _, pred = dijkstra(self.m, indices=[a], return_predecessors=True, limit=WALK_SEARCH_LIMIT_M)
            if pred[0, b] < 0:
                res = None
            else:
                res = [b]
                while res[-1] != a:
                    res.append(int(pred[0, res[-1]]))
                res = res[::-1]
        self._cache[key] = res
        return res

    def nodes_to_coords(self, nodes):
        out = [list(self.net.node_xy[nodes[0]])]
        for x, y in zip(nodes[:-1], nodes[1:]):
            i, rev = self.geom[(x, y)]
            g = self.net.edge_geoms[i]
            out += [list(c) for c in (g[::-1] if rev else g)][1:]
        return out

    # --- projection of free points (home, work, stops) onto the nearest street
    def _build_proj(self):
        A, B, eid, seg, last, last_e, last_s = [], [], [], [], [], [], []
        seen = set()
        for i, g in enumerate(self.net.edge_geoms):
            key = (min(self.u[i], self.v[i]), max(self.u[i], self.v[i]))
            if key in seen:      # one direction of a two-way street is enough for projection
                continue
            seen.add(key)
            p = to_xy(g)
            if len(p) < 2:
                continue
            A.append(p[:-1]); B.append(p[1:])
            eid.append(np.full(len(p) - 1, i)); seg.append(np.arange(len(p) - 1))
            last.append(p[-1]); last_e.append(i); last_s.append(len(p) - 2)
        A, B, eid, seg = np.vstack(A), np.vstack(B), np.concatenate(eid), np.concatenate(seg)
        k = np.maximum(1, (np.hypot(*(B - A).T) / PROJ_STEP_M).astype(int))   # points per segment
        rep = np.repeat(np.arange(len(A)), k)
        t = (np.arange(len(rep)) - np.repeat(np.cumsum(k) - k, k)) / k[rep]
        pts = A[rep] + t[:, None] * (B - A)[rep]
        self.p_xy = np.vstack([pts, np.asarray(last)])
        self.p_eid = np.r_[eid[rep], last_e]
        self.p_seg = np.r_[seg[rep], last_s]
        self.ptree = cKDTree(self.p_xy)

    def project(self, ll):
        """(point on street [lng,lat], edge row, segment index, stub length m)."""
        if not hasattr(self, "ptree"):
            self._build_proj()
        d, k = self.ptree.query(to_xy([ll])[0])
        return [float(x) for x in to_ll(self.p_xy[k][None])[0]], int(self.p_eid[k]), int(self.p_seg[k]), float(d)

    def _ends(self, ll):
        """Candidate (node, coords from point to node) for a free point projected on its edge."""
        P, i, s, stub = self.project(ll)
        g = self.net.edge_geoms[i]
        u, v = int(self.u[i]), int(self.v[i])
        to_u = [P] + [list(c) for c in g[s::-1]]
        to_v = [P] + [list(c) for c in g[s + 1:]]
        head = [list(ll)] if stub <= MAX_STUB_M else []
        return [(u, head + to_u), (v, head + to_v)], i

    def route(self, a_ll, b_ll, a_node=None, b_node=None):
        return self.route_p(a_ll, b_ll, a_node, b_node)[0]

    def route_p(self, a_ll, b_ll, a_node=None, b_node=None):
        """Cached _route() as (deduped coords, cumulative length fractions)."""
        key = (round(float(a_ll[0]), 6), round(float(a_ll[1]), 6), round(float(b_ll[0]), 6), round(float(b_ll[1]), 6),
               a_node, b_node)
        if key not in self.routes:
            self.routes[key] = prep(self._route(a_ll, b_ll, a_node, b_node))
            self.routes_dirty = True
        return self.routes[key]

    def _route(self, a_ll, b_ll, a_node=None, b_node=None):
        """Street route between two points (undirected, by length). Free endpoints are
        projected onto their nearest street; the straight stub to it is drawn only if
        <= MAX_STUB_M. Fixed endpoints (a_node / b_node) are network nodes."""
        A, ea = ([(a_node, [list(self.net.node_xy[a_node])])], None) if a_node is not None else self._ends(a_ll)
        B, eb = ([(b_node, [list(self.net.node_xy[b_node])])], None) if b_node is not None else self._ends(b_ll)
        if ea is not None and ea == eb:  # same street segment: walk along it directly
            Pa, _, sa, da = self.project(a_ll)
            Pb, _, sb, db = self.project(b_ll)
            g = self.net.edge_geoms[ea]
            mid = [list(c) for c in (g[sa + 1:sb + 1] if sa < sb else g[sb + 1:sa + 1][::-1])]
            return dedupe(([list(a_ll)] if da <= MAX_STUB_M else []) + [Pa] + mid + [Pb] +
                          ([list(b_ll)] if db <= MAX_STUB_M else []))
        bn = [n for n, _ in B]
        lim = max(2000.0, 3.0 * seg_len(A[0][1][0], B[0][1][0]) + 1000.0)   # adaptive search radius
        dist, pred = dijkstra(self.m, indices=bn, return_predecessors=True, limit=lim)
        best = None
        for ai, (an, acoords) in enumerate(A):
            la = _plen(acoords)
            for bi, (bnode, bcoords) in enumerate(B):
                tot = la + dist[bi, an] + _plen(bcoords)
                if np.isfinite(tot) and (best is None or tot < best[0]):
                    best = (tot, ai, bi)
        if best is None:
            if lim < 1e9:  # nothing within the search radius: retry unbounded
                dist, pred = dijkstra(self.m, indices=bn, return_predecessors=True)
                lim = 1e18
                for ai, (an, acoords) in enumerate(A):
                    for bi, (bnode, bcoords) in enumerate(B):
                        tot = _plen(acoords) + dist[bi, an] + _plen(bcoords)
                        if np.isfinite(tot) and (best is None or tot < best[0]):
                            best = (tot, ai, bi)
            if best is None:  # truly disconnected: should not happen inside one component
                self.fallbacks = getattr(self, "fallbacks", 0) + 1
                return dedupe(A[0][1] + B[0][1][::-1])
        _, ai, bi = best
        an, acoords = A[ai]
        bnode, bcoords = B[bi]
        nodes = [an]
        while nodes[-1] != bnode:
            nodes.append(int(pred[bi, nodes[-1]]))
        mid = self.nodes_to_coords(nodes) if len(nodes) > 1 else []
        return dedupe(acoords + mid + bcoords[::-1])


def _plen(c):
    if len(c) < 2:
        return 0.0
    p = np.asarray(c, float)
    return float(np.hypot((p[1:, 0] - p[:-1, 0]) * LAT0, p[1:, 1] - p[:-1, 1]).sum() * K)

# ---------------------------------------------------------------------------- GTFS shapes
_SHAPES = None


def _shape_lines():
    global _SHAPES
    if _SHAPES is not None:
        return _SHAPES
    z = zipfile.ZipFile(config.GTFS_FILE)
    trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["route_id", "direction_id", "shape_id"])
    sh = pd.read_csv(z.open("shapes.txt"), dtype={"shape_id": str}).sort_values(["shape_id", "shape_pt_sequence"])
    shapes = {sid: g[["shape_pt_lon", "shape_pt_lat"]].values for sid, g in sh.groupby("shape_id")}
    common = {}
    for (r, d), g in trips.dropna(subset=["shape_id"]).groupby(["route_id", "direction_id"]):
        common[(r, d)] = [s for s, _ in Counter(g.shape_id).most_common(3)]
    _SHAPES = (shapes, common)
    return _SHAPES


def _cut_shape(shape_ll, stops_ll):
    """Hop polylines between consecutive stops along a shape, monotone projection.
    Returns list (len(stops)-1) of polylines or None per hop when a stop is off-shape."""
    from shapely.geometry import LineString, Point
    from shapely.ops import substring

    line = LineString(to_xy(shape_ll))
    pos, offs = [], []
    lo = 0.0
    for s in to_xy(stops_ll):
        sub = substring(line, lo, line.length)
        pt = Point(s)
        if sub.length == 0:
            pos.append(lo)
            offs.append(pt.distance(sub))
            continue
        p = lo + sub.project(pt)
        pos.append(p)
        offs.append(pt.distance(line.interpolate(p)))
        lo = p
    hops = []
    for j in range(len(pos) - 1):
        if offs[j] > SHAPE_MAX_STOP_OFFSET_M or offs[j + 1] > SHAPE_MAX_STOP_OFFSET_M or pos[j + 1] <= pos[j]:
            hops.append(None)
            continue
        seg = substring(line, pos[j], pos[j + 1])
        coords = to_ll(np.asarray(seg.coords)) if seg.geom_type == "LineString" else None
        hops.append([[float(x), float(y)] for x, y in coords] if coords is not None else None)
    return hops, max(offs) if offs else 0.0


def attach_hop_paths(td, router, verbose=True):
    """Fill Pattern.hop_paths for GTFS patterns from shapes.txt (cached on td)."""
    if getattr(td, "_hops_ready", False):
        return
    shapes = common = None  # GTFS shapes are read only if some pattern still lacks hops (build time)
    sxy = td.stops.set_index("stop_id")[["lng", "lat"]]
    counts = Counter()
    hop_lookup = {}
    for p in td.patterns:
        if p.route_id.startswith("proposed") or (p.hop_paths and all(h for h in p.hop_paths)):
            for j, h in enumerate(p.hop_paths or []):
                if h:
                    hop_lookup.setdefault((p.stop_ids[j], p.stop_ids[j + 1]), h)
            continue
        if shapes is None:
            shapes, common = _shape_lines()
        r, d = p.pattern_id.split("_")[0], p.pattern_id.split("_")[1]
        stops_ll = sxy.loc[p.stop_ids].values
        best = None
        for sid in common.get((r, d), []):
            hops, off = _cut_shape(shapes[sid], stops_ll)
            if best is None or sum(h is None for h in hops) < sum(h is None for h in best):
                best = hops
            if all(h is not None for h in hops):
                break
        hops = best or [None] * (len(p.stop_ids) - 1)
        for j, h in enumerate(hops):
            if h is None:  # road-route the hop (buses) or keep straight for rail (never observed)
                a, b = sxy.loc[p.stop_ids[j]].values, sxy.loc[p.stop_ids[j + 1]].values
                hops[j] = router.route(a, b) if p.mode == "bus" else [list(a), list(b)]
                counts["road_routed" if p.mode == "bus" else "straight_rail"] += 1
            else:
                counts["shape"] += 1
            hop_lookup.setdefault((p.stop_ids[j], p.stop_ids[j + 1]), hops[j])
        p.hop_paths = hops
    # extension patterns reuse base-line hops for their existing part
    for p in td.patterns:
        if p.route_id.startswith("proposed") and p.hop_paths:
            for j, h in enumerate(p.hop_paths):
                if h is None:
                    h2 = hop_lookup.get((p.stop_ids[j], p.stop_ids[j + 1]))
                    if h2 is None:
                        a = sxy.loc[p.stop_ids[j]].values
                        b = sxy.loc[p.stop_ids[j + 1]].values
                        h2 = router.route(a, b)
                    p.hop_paths[j] = h2
                    counts["ext_from_base" if (p.stop_ids[j], p.stop_ids[j + 1]) in hop_lookup else "ext_road_routed"] += 1
    td._hops_ready = True
    td._hop_counts = dict(counts)
    if verbose:
        print(f"display hops: {dict(counts)}")



_ROUTERS: dict = {}


def router_for(net) -> Router:
    if id(net) not in _ROUTERS:
        _ROUTERS[id(net)] = Router(net)
    return _ROUTERS[id(net)]












