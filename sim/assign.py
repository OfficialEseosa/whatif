"""Static peak-hour traffic assignment: BPR volume-delay + method of successive averages.

Shortest paths use scipy.sparse.csgraph.dijkstra from every origin at once, and
flows are loaded by walking the predecessor matrix for all OD pairs in parallel
(vectorised numpy), so the whole population is assigned in seconds.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
from scipy.sparse.csgraph import dijkstra

# BPR volume-delay: t = t0 * (1 + ALPHA * (v/c)^BETA). Standard FHWA values.
BPR_ALPHA = 0.15
BPR_BETA = 4.0
MSA_ITERATIONS = 4

# PLACEHOLDER background traffic (trips LODES misses: through traffic, freight,
# school, errands) as a fraction of capacity per road class, fixed across
# scenarios. TODO: replace with HPMS AADT x K-factor (0.09) x D-factor (0.55)
# minus modeled commuters, floored at 0 (see plan "Traffic" step 2-3).
BACKGROUND_VC_PLACEHOLDER = {
    "motorway": 0.85, "motorway_link": 0.60, "trunk": 0.55, "trunk_link": 0.45,
    "primary": 0.50, "primary_link": 0.40, "secondary": 0.45, "secondary_link": 0.35,
    "tertiary": 0.35, "tertiary_link": 0.30, "residential": 0.15, "unclassified": 0.15,
    "living_street": 0.05,
}
BACKGROUND_VC_DEFAULT = 0.15

# ASSUMPTION: persons per car for commute driving (ACS Atlanta carpool share ~7%).
VEHICLE_OCCUPANCY = 1.08

# ASSUMPTION: minutes added to every drive trip for walking to/from the car and
# parking (not animated). Downtown/Midtown parking garages make this non-trivial.
DRIVE_TERMINAL_MIN = 4.0


def bpr(t0: np.ndarray, vol: np.ndarray, cap: np.ndarray) -> np.ndarray:
    return t0 * (1.0 + BPR_ALPHA * (vol / cap) ** BPR_BETA)


def background_volume(net) -> np.ndarray:
    e = net.edges
    frac = e["highway"].map(BACKGROUND_VC_PLACEHOLDER).fillna(BACKGROUND_VC_DEFAULT).values
    return frac * e["capacity_vph"].values


@dataclass
class ShortestPaths:
    origins: np.ndarray        # node idx per row
    dist: np.ndarray           # (O, N) seconds
    pred: np.ndarray           # (O, N)
    edge_keys: np.ndarray      # sorted u*N+v of chosen edges
    edge_rows: np.ndarray      # edge row per key

    def edge_of(self, u: np.ndarray, v: np.ndarray, n: int) -> np.ndarray:
        k = u.astype(np.int64) * n + v
        pos = np.searchsorted(self.edge_keys, k)
        return self.edge_rows[pos]


def shortest_paths(net, cost: np.ndarray, origin_nodes: np.ndarray) -> ShortestPaths:
    m, chosen = net.csr(cost)
    e = net.edges
    keys = e["u_idx"].values[chosen].astype(np.int64) * net.n_nodes + e["v_idx"].values[chosen]
    order = np.argsort(keys)
    dist, pred = dijkstra(m, directed=True, indices=origin_nodes, return_predecessors=True)
    return ShortestPaths(origin_nodes, dist, pred, keys[order], chosen[order])


def load_flows(net, sp: ShortestPaths, row: np.ndarray, dest: np.ndarray, amount: np.ndarray) -> np.ndarray:
    """Add `amount` along the shortest path origin(row) -> dest for every pair."""
    n = net.n_nodes
    flow = np.zeros(len(net.edges))
    cur = dest.copy()
    amt = amount.copy()
    r = row.copy()
    origin_node = sp.origins[r]
    active = cur != origin_node
    cur, amt, r, origin_node = cur[active], amt[active], r[active], origin_node[active]
    while len(cur):
        p = sp.pred[r, cur]
        ok = p >= 0
        cur, amt, r, origin_node, p = cur[ok], amt[ok], r[ok], origin_node[ok], p[ok]
        np.add.at(flow, sp.edge_of(p, cur, n), amt)
        cur = p
        active = cur != origin_node
        cur, amt, r, origin_node = cur[active], amt[active], r[active], origin_node[active]
    return flow


def trace_path(net, sp: ShortestPaths, row: int, dest: int) -> list[int]:
    """Edge rows along the path origin(row) -> dest, in travel order."""
    out = []
    cur = dest
    o = sp.origins[row]
    while cur != o:
        p = sp.pred[row, cur]
        if p < 0:
            return []
        out.append(int(sp.edge_of(np.array([p]), np.array([cur]), net.n_nodes)[0]))
        cur = p
    return out[::-1]


@dataclass
class Assignment:
    volume: np.ndarray        # total veh/h per edge (background + commuters)
    commuter_volume: np.ndarray
    background: np.ndarray
    capacity: np.ndarray
    time_s: np.ndarray        # congested edge time
    sp: ShortestPaths         # final shortest paths at congested times
    od_row: np.ndarray        # per OD pair: row in sp
    od_dest: np.ndarray       # per OD pair: dest node
    drive_min: np.ndarray     # per OD pair: congested door-to-door minutes
    rel_gap: float
    seconds: float

    @property
    def vc(self) -> np.ndarray:
        return self.volume / self.capacity


def assign(net, zones, od, drive_persons: np.ndarray, capacity: np.ndarray | None = None,
           iterations: int = MSA_ITERATIONS, verbose: bool = True) -> Assignment:
    """drive_persons: peak-hour persons driving, per OD pair."""
    t = time.time()
    e = net.edges
    t0 = e["t0_s"].values
    cap = e["capacity_vph"].values if capacity is None else capacity
    bg = background_volume(net)
    o_nodes = zones.node_idx.values[od.o.values]
    d_nodes = zones.node_idx.values[od.d.values]
    uniq, row = np.unique(o_nodes, return_inverse=True)
    veh = drive_persons / VEHICLE_OCCUPANCY

    y = np.zeros(len(e))
    gap = float("nan")
    for k in range(iterations):
        cost = bpr(t0, bg + y, cap)
        sp = shortest_paths(net, cost, uniq)
        aux = load_flows(net, sp, row, d_nodes, veh)
        if k == 0:
            y = aux
        else:
            tstt = float(((bg + y) * cost).sum())
            sptt = float(((bg + aux) * cost).sum())
            gap = (tstt - sptt) / tstt if tstt > 0 else 0.0
            y = y + (aux - y) / (k + 1)
        if verbose:
            print(f"  MSA iter {k+1}/{iterations}: max v/c {((bg + y) / cap).max():.2f}"
                  + (f", rel gap {gap:.4f}" if k else ""))
    cost = bpr(t0, bg + y, cap)
    sp = shortest_paths(net, cost, uniq)
    drive_min = sp.dist[row, d_nodes] / 60.0 + DRIVE_TERMINAL_MIN
    secs = time.time() - t
    if verbose:
        print(f"assignment: {veh.sum():,.0f} peak-hour commuter vehicles, {secs:.1f}s")
    return Assignment(volume=bg + y, commuter_volume=y, background=bg, capacity=cap, time_s=cost,
                      sp=sp, od_row=row, od_dest=d_nodes, drive_min=drive_min, rel_gap=gap, seconds=secs)
