"""Road network: OSM drive graph -> edge table with free-flow time and capacity.

Edge ids are stable strings "<u_osm>-<v_osm>-<key>" (OSM node ids), so a given
OSM extract always produces the same ids and scenario edits can reference them.

    python network.py      # builds the cache and exports public/scenarios/major-roads.sim.json
"""
from __future__ import annotations

import json
import math
import pickle
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

import config

# ---------------------------------------------------------------------------
# Road-class constants (ASSUMPTIONS - see README "Assumptions and placeholders")
# ---------------------------------------------------------------------------
# Hourly capacity per lane (veh/h/lane). Freeway value is HCM basic-segment order
# of magnitude; arterial values fold in signal green time (~45-55% g/C).
CAPACITY_PER_LANE = {
    "motorway": 1900, "trunk": 1400, "primary": 850, "secondary": 750,
    "tertiary": 650, "residential": 450, "unclassified": 450, "living_street": 300,
    "motorway_link": 1400, "trunk_link": 1000, "primary_link": 800,
    "secondary_link": 700, "tertiary_link": 600,
}
DEFAULT_CAPACITY_PER_LANE = 450

# Lanes per direction when OSM has no `lanes` tag.
DEFAULT_LANES = {
    "motorway": 3, "trunk": 2, "primary": 2, "secondary": 1, "tertiary": 1,
    "motorway_link": 1, "trunk_link": 1, "primary_link": 1,
}

# Free-flow speed (km/h) when OSM has no `maxspeed`. Urban values.
DEFAULT_SPEED_KPH = {
    "motorway": 89, "trunk": 64, "primary": 56, "secondary": 48, "tertiary": 40,
    "residential": 35, "unclassified": 35, "living_street": 16,
    "motorway_link": 56, "trunk_link": 48, "primary_link": 40,
    "secondary_link": 40, "tertiary_link": 35,
}
DEFAULT_SPEED = 35

# Average delay (seconds) added to an edge that ends at a signalised node
# (OSM highway=traffic_signals) or at any other intersection (degree >= 3).
# Placeholder for real signal timing; keeps Downtown free-flow times realistic.
SIGNAL_DELAY_S = 15.0
INTERSECTION_DELAY_S = 4.0

# Classes exported to the frontend as "major roads".
MAJOR_CLASSES = {"motorway", "trunk", "primary", "secondary",
                 "motorway_link", "trunk_link"}

NETWORK_CACHE = config.CACHE_DIR / f"network_{config.bbox_tag()}.pkl"


def _first(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _parse_lanes(v) -> float | None:
    v = _first(v)
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    try:
        return float(str(v).split(";")[0])
    except ValueError:
        return None


def _parse_speed(v) -> float | None:
    v = _first(v)
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).lower().strip()
    try:
        num = float(s.split()[0])
    except (ValueError, IndexError):
        return None
    return num * 1.609 if "mph" in s or num < 80 else num  # US tags are mph


@dataclass
class Network:
    node_osm: np.ndarray           # index -> OSM node id
    node_xy: np.ndarray            # (N, 2) lng, lat
    edges: pd.DataFrame            # one row per directed edge
    edge_geoms: list               # list of [[lng,lat], ...] per edge row
    node_index: dict = field(default_factory=dict)
    in_scc: np.ndarray | None = None    # node is in the largest strongly connected component
    gateways: pd.DataFrame | None = None  # boundary entry nodes: node_idx, lng, lat, cls, name

    @property
    def n_nodes(self) -> int:
        return len(self.node_osm)

    def csr(self, cost: np.ndarray, exclude=None) -> tuple[csr_matrix, np.ndarray]:
        """CSR adjacency with `cost` per edge. Parallel edges collapse to the
        cheapest; returns (matrix, chosen_edge_index_per_csr_entry)."""
        e = self.edges
        order = np.lexsort((cost, e["v_idx"].values, e["u_idx"].values))
        u = e["u_idx"].values[order]
        v = e["v_idx"].values[order]
        keep = np.ones(len(order), bool)
        keep[1:] = (u[1:] != u[:-1]) | (v[1:] != v[:-1])
        idx = order[keep]
        m = csr_matrix((np.maximum(cost[idx], 1e-6), (e["u_idx"].values[idx], e["v_idx"].values[idx])),
                       shape=(self.n_nodes, self.n_nodes))
        # Map each CSR (u,v) -> edge row. csr_matrix sorts by (row, col), same as our lexsort.
        return m, idx

    def edge_lookup(self, chosen: np.ndarray) -> dict:
        e = self.edges
        return {(int(e["u_idx"].values[i]), int(e["v_idx"].values[i])): int(i) for i in chosen}


def build_network() -> Network:
    import osmnx as ox

    if not config.GRAPH_FILE.exists():
        raise FileNotFoundError(f"{config.GRAPH_FILE} missing - run fetch_data.py first")
    G = ox.load_graphml(config.GRAPH_FILE)
    # Keep the largest WEAKLY connected component: dangling inbound roads cut by the
    # bbox (in-degree 0) are kept as gateway sources. Zones snap only to SCC nodes,
    # so every zone-to-zone OD stays routable.
    import networkx as nx

    G = ox.truncate.largest_component(G, strongly=False)
    scc = max(nx.strongly_connected_components(G), key=len)

    node_osm = np.array(list(G.nodes), dtype=np.int64)
    node_index = {int(n): i for i, n in enumerate(node_osm)}
    node_xy = np.array([[G.nodes[n]["x"], G.nodes[n]["y"]] for n in node_osm])
    signal = {n for n, d in G.nodes(data=True) if str(d.get("highway", "")) == "traffic_signals"}
    degree = dict(G.degree())

    rows, geoms = [], []
    for u, v, k, d in G.edges(keys=True, data=True):
        hw = str(_first(d.get("highway", "unclassified")))
        oneway = str(d.get("oneway", False)).lower() in ("true", "yes", "1")
        lanes_tag = _parse_lanes(d.get("lanes"))
        if lanes_tag is not None:
            lanes = lanes_tag if oneway else max(1.0, math.ceil(lanes_tag / 2))
        else:
            lanes = float(DEFAULT_LANES.get(hw, 1))
        lanes = max(1.0, lanes)
        speed = _parse_speed(d.get("maxspeed")) or DEFAULT_SPEED_KPH.get(hw, DEFAULT_SPEED)
        length = float(d.get("length", 0.0))
        node_delay = SIGNAL_DELAY_S if v in signal else (INTERSECTION_DELAY_S if degree.get(v, 0) >= 6 else 0.0)
        if hw.startswith("motorway"):
            node_delay = 0.0
        t0 = length / (speed / 3.6) + node_delay
        cap_lane = CAPACITY_PER_LANE.get(hw, DEFAULT_CAPACITY_PER_LANE)
        name = _first(d.get("name")) or ""
        osmid = d.get("osmid")
        ways = osmid if isinstance(osmid, list) else [osmid]
        ways = [int(str(x).strip("[] ")) for w_ in ways for x in str(w_).split(",") if str(x).strip("[] ")]
        rows.append(dict(
            edge_id=f"{u}-{v}-{k}", u=int(u), v=int(v), key=int(k),
            u_idx=node_index[int(u)], v_idx=node_index[int(v)],
            highway=hw, name=str(name), lanes=lanes, oneway=oneway,
            length_m=length, speed_kph=speed, t0_s=t0, cap_per_lane=cap_lane,
            capacity_vph=lanes * cap_lane,
            way_id=f"w{ways[0]}" if ways else "", way_ids=[f"w{x}" for x in ways],
            ref=str(_first(d.get("ref")) or ""),
        ))
        if "geometry" in d:
            geoms.append([[round(x, 6), round(y, 6)] for x, y in d["geometry"].coords])
        else:
            geoms.append([[round(G.nodes[u]["x"], 6), round(G.nodes[u]["y"], 6)],
                          [round(G.nodes[v]["x"], 6), round(G.nodes[v]["y"], 6)]])
    edges = pd.DataFrame(rows)
    in_scc = np.array([int(n) in scc for n in node_osm])
    net = Network(node_osm=node_osm, node_xy=node_xy, edges=edges, edge_geoms=geoms,
                  node_index=node_index, in_scc=in_scc)
    net.gateways = find_gateways(net, G)
    return net


# Gateways: where major roads cross the study-box boundary. A candidate is a node
# within GATEWAY_BOUNDARY_M of the bbox edge where a road of class GATEWAY_CLASSES
# stops (only one major-road neighbour - the road was cut by the bbox), and from
# which the network can be entered (it can reach the strongly connected core).
# Candidates within GATEWAY_MERGE_M are merged, keeping the highest class.
GATEWAY_CLASSES = ["motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link"]
GATEWAY_BOUNDARY_M = 250.0
GATEWAY_MERGE_M = 400.0
GATEWAY_SOURCE_BOUNDARY_M = 600.0


def find_gateways(net: "Network", G) -> pd.DataFrame:
    w, s, e, n = config.BBOX
    lat0 = np.cos(np.deg2rad((s + n) / 2))
    x, y = net.node_xy[:, 0], net.node_xy[:, 1]
    dist_edge = np.minimum.reduce([(x - w) * lat0, (e - x) * lat0, (y - s), (n - y)]) * 111_320
    rank = {c: i for i, c in enumerate(GATEWAY_CLASSES)}
    best = {}
    for _, r in net.edges.iterrows():
        cl = rank.get(r.highway)
        if cl is None:
            continue
        for nd in (r.u_idx, r.v_idx):
            if nd not in best or cl < best[nd][0]:
                best[nd] = (cl, r.highway, r["name"])
    import networkx as nx

    major = set(GATEWAY_CLASSES) | {"tertiary", "primary_link", "secondary_link"}
    core = int(net.node_osm[np.where(net.in_scc)[0][0]])
    can_enter = nx.ancestors(G, core) | {core}
    cands = []
    for nd, (cl, hw, name) in best.items():
        osm = int(net.node_osm[nd])
        if osm not in can_enter:
            continue
        # One-way entry carriageways cut by the bbox have in-degree 0 (freeways):
        # always gateways, with a wider boundary tolerance (freeway nodes are sparse).
        if G.in_degree(osm) == 0 and dist_edge[nd] <= GATEWAY_SOURCE_BOUNDARY_M:
            cands.append((cl, dist_edge[nd], nd, hw, name))
            continue
        if dist_edge[nd] > GATEWAY_BOUNDARY_M:
            continue
        # Same road (name or ref) continuing on only one side => the road was cut here.
        def same(d):
            return (str(_first(d.get("highway"))) in major and
                    ((name and str(_first(d.get("name")) or "") == name) or
                     (not name and str(_first(d.get("ref")) or "") != "")))
        mnb = {v for _, v, d in G.out_edges(osm, data=True) if same(d)} | \
              {u for u, _, d in G.in_edges(osm, data=True) if same(d)}
        if len(mnb) == 1:
            cands.append((cl, dist_edge[nd], nd, hw, name))
    cands.sort()
    keep = []
    for cl, de, nd, hw, name in cands:
        p = net.node_xy[nd]
        # merge only repeated crossings of the SAME road (e.g. both carriageways)
        if all(nm != name or np.hypot((p[0] - net.node_xy[k][0]) * lat0, p[1] - net.node_xy[k][1]) * 111_320
               > GATEWAY_MERGE_M for k, _, nm in keep):
            keep.append((nd, hw, name))
    return pd.DataFrame([{"node_idx": nd, "lng": net.node_xy[nd][0], "lat": net.node_xy[nd][1],
                          "cls": hw, "name": str(name)} for nd, hw, name in keep])


def load_network(rebuild: bool = False) -> Network:
    if NETWORK_CACHE.exists() and not rebuild:
        with open(NETWORK_CACHE, "rb") as f:
            return pickle.load(f)
    config.ensure_dirs()
    t = time.time()
    net = build_network()
    with open(NETWORK_CACHE, "wb") as f:
        pickle.dump(net, f)
    print(f"network: {net.n_nodes} nodes, {len(net.edges)} edges (built in {time.time()-t:.1f}s)")
    return net


def simplify_line(coords: list, tol_deg: float = 0.00005) -> list:
    """Douglas-Peucker via shapely; tol ~5 m."""
    from shapely.geometry import LineString

    if len(coords) <= 2:
        return coords
    ls = LineString(coords).simplify(tol_deg, preserve_topology=False)
    return [[round(x, 5), round(y, 5)] for x, y in ls.coords]


def export_major_roads(net: Network, path=None) -> dict:
    path = path or (config.SCENARIO_OUT_DIR / "major-roads.sim.json")
    feats = []
    e = net.edges
    for i in np.where(e["highway"].isin(MAJOR_CLASSES).values)[0]:
        r = e.iloc[i]
        feats.append({
            "type": "Feature",
            "properties": {"id": r.way_id, "edgeId": r.edge_id, "name": r["name"], "class": r.highway,
                           "lanes": r.lanes, "capacityVph": round(float(r.capacity_vph))},
            "geometry": {"type": "LineString", "coordinates": simplify_line(net.edge_geoms[i])},
        })
    fc = {"type": "FeatureCollection", "bbox": list(config.BBOX),
          "source": "OpenStreetMap contributors (ODbL) via OSMnx; capacity = lanes x class value (assumption)",
          "features": feats}
    config.ensure_dirs()
    path.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"major roads: {len(feats)} edges -> {path} ({path.stat().st_size/1e6:.2f} MB)")
    return fc


if __name__ == "__main__":
    import network as _self  # pickle the class under its module name, not __main__

    net = _self.load_network(rebuild=True)
    e = net.edges
    print(e.groupby("highway").agg(n=("edge_id", "size"), km=("length_m", lambda s: s.sum() / 1000))
          .sort_values("km", ascending=False).round(1).to_string())
    export_major_roads(net)







