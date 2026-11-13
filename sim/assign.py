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
# 4 rounds (plan) left a ~18% relative gap once inbound commuters loaded the network;
# 12 rounds costs ~3 s and converges far better.
MSA_ITERATIONS = 12

# PLACEHOLDER background traffic (trips the model does not carry: through traffic,
# freight, school, errands, outbound commuters) as a fraction of capacity per road
# class, fixed across scenarios. Lowered once inbound commuters were modeled, so
# they are not double counted; motorways keep a large share for I-75/85 and I-20
# through traffic. TODO: replace with HPMS AADT x K-factor (0.09) x D-factor (0.55)
# minus modeled commuters, floored at 0 (see plan "Traffic" step 2-3).
BACKGROUND_VC_PLACEHOLDER = {
    "motorway": 0.55, "motorway_link": 0.30, "trunk": 0.25, "trunk_link": 0.20,
    "primary": 0.20, "primary_link": 0.15, "secondary": 0.15, "secondary_link": 0.10,
    "tertiary": 0.12, "tertiary_link": 0.10, "residential": 0.05, "unclassified": 0.05,
    "living_street": 0.02,
}
BACKGROUND_VC_DEFAULT = 0.05

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
    nodes = [int(dest)]
    o = int(sp.origins[row])
    pred = sp.pred[row]
    while nodes[-1] != o:
        p = int(pred[nodes[-1]])
        if p < 0:
            return []
        nodes.append(p)
    if len(nodes) < 2:
        return []
    nd = np.asarray(nodes[::-1], np.int64)
    return sp.edge_of(nd[:-1], nd[1:], net.n_nodes).tolist()


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
    out_min: np.ndarray | None = None   # estimated out-of-box minutes (0 for internal)
    gateway: np.ndarray | None = None   # chosen gateway index per OD unit (-1 internal)
    cut_off: np.ndarray | None = None   # OD units whose only drive route uses a closed road

    @property
    def vc(self) -> np.ndarray:
        return self.volume / self.capacity


# ---------------------------------------------------------------------------
# Inbound commuters (home outside the box): out-of-box leg is ESTIMATED, not routed.
#   out_of_box_s = straight-line(home, gateway) x OUT_OF_BOX_DETOUR / speed(gateway class)
# Gateway choice is re-optimised every MSA iteration: argmin over gateways of
# out_of_box_s + congested in-box time gateway -> work zone.
OUT_OF_BOX_DETOUR = 1.25
# ASSUMPTION: average AM-peak speed on the approach outside the box, by gateway class.
OUT_OF_BOX_SPEED_KPH = {"motorway": 50, "motorway_link": 45, "trunk": 38, "trunk_link": 35,
                        "primary": 33, "secondary": 30}


# ASSUMPTION: the approach road outside the box queues like the gateway edge itself.
# Extra delay per gateway = APPROACH_REF_MIN x BPR term on the gateway's first in-box
# edges (v/c incl. background). Spreads inbound traffic from saturated freeways to
# arterial gateways instead of letting the out-of-box leg stay free-flowing.
APPROACH_REF_MIN = 10.0


def gateway_out_edges(net) -> list[np.ndarray]:
    u = net.edges.u_idx.values
    return [np.where(u == g)[0] for g in net.gateways.node_idx.values]


def approach_delay_s(vol, cap, gw_edges) -> np.ndarray:
    vc = np.array([vol[ix].sum() / max(cap[ix].sum(), 1.0) for ix in gw_edges])
    return 60.0 * APPROACH_REF_MIN * BPR_ALPHA * vc ** BPR_BETA


def gateway_cost_s(net, hlng, hlat) -> np.ndarray:
    """(P, G) estimated out-of-box drive seconds from each home point to each gateway."""
    gw = net.gateways
    lat0 = np.cos(np.deg2rad(33.765))
    dx = (np.asarray(hlng)[:, None] - gw.lng.values[None, :]) * lat0 * 111_320
    dy = (np.asarray(hlat)[:, None] - gw.lat.values[None, :]) * 111_320
    spd = gw.cls.map(OUT_OF_BOX_SPEED_KPH).fillna(30).values / 3.6
    return (np.hypot(dx, dy) * OUT_OF_BOX_DETOUR / spd[None, :]).astype(np.float32)


# A closed edge costs this many seconds to traverse (effectively removed; a route that
# still needs it is "cut off" and reported).
CLOSED_COST_S = 1.0e6


def assign(net, dem, drive_persons: np.ndarray, capacity: np.ndarray | None = None,
           iterations: int = MSA_ITERATIONS, verbose: bool = True, closed: np.ndarray | None = None,
           extra_od: tuple | None = None, y0: np.ndarray | None = None, k0: int = 0) -> Assignment:
    """drive_persons: peak-hour persons driving, per OD unit (internal + inbound).
    closed: bool per edge (road closures). extra_od: (origin nodes, dest nodes, vehicles/h)
    routed like commuters but not reported as commuters (displaced background traffic)."""
    t = time.time()
    zones, od = dem.zones, dem.od
    e = net.edges
    t0 = e["t0_s"].values
    cap = e["capacity_vph"].values if capacity is None else capacity
    bg = background_volume(net)
    if closed is not None and closed.any():
        bg = bg.copy()
        bg[closed] = 0.0
    if extra_od is not None:
        xo, xd, xv = (np.asarray(extra_od[0], dtype=np.int64), np.asarray(extra_od[1], dtype=np.int64),
                      np.asarray(extra_od[2], dtype=float))
    else:
        xo, xd, xv = np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros(0)

    def costf(vol):
        c = bpr(t0, vol, cap)
        if closed is not None:
            c[closed] = CLOSED_COST_S
        return c
    ext = od.ext.values
    d_nodes = od.d_node.values if "d_node" in od else zones.node_idx.values[od.d.values]
    gw_nodes = net.gateways.node_idx.values
    int_o = zones.node_idx.values[od.o.values[~ext]]
    uniq = np.unique(np.r_[int_o, gw_nodes, xo])
    row = np.zeros(len(od), dtype=np.int64)
    row[~ext] = np.searchsorted(uniq, int_o)
    xrow = np.searchsorted(uniq, xo)
    gw_rows = np.searchsorted(uniq, gw_nodes)
    gw_cost = gateway_cost_s(net, od.hlng.values[ext], od.hlat.values[ext])  # (Pext, G)
    d_ext = d_nodes[ext]
    veh = drive_persons / VEHICLE_OCCUPANCY

    gw_edges = gateway_out_edges(net)

    def choose(sp, vol):
        tot = gw_cost + approach_delay_s(vol, cap, gw_edges).astype(np.float32)[None, :]
        tot += sp.dist[gw_rows][:, d_ext].T.astype(np.float32)   # (Pext, G)
        g = np.argmin(tot, axis=1)
        return g, tot[np.arange(len(g)), g]

    y = np.zeros(len(e))
    gap = float("nan")
    if y0 is not None:      # warm start: continue the baseline's MSA from its final flows
        y = y0.copy()
    for k in range(iterations):
        cost = costf(bg + y)
        sp = shortest_paths(net, cost, uniq)
        g, _ = choose(sp, bg + y)
        row[ext] = gw_rows[g]
        aux = load_flows(net, sp, np.r_[row, xrow], np.r_[d_nodes, xd], np.r_[veh, xv])
        if k == 0 and y0 is None:
            y = aux
        else:
            tstt = float(((bg + y) * cost).sum())
            sptt = float(((bg + aux) * cost).sum())
            gap = (tstt - sptt) / tstt if tstt > 0 else 0.0
            y = y + (aux - y) / (k0 + k + 1)
        if verbose:
            print(f"  MSA iter {k+1}/{iterations}: max v/c {((bg + y) / cap).max():.2f}"
                  + (f", rel gap {gap:.4f}" if k else ""))
    cost = costf(bg + y)
    sp = shortest_paths(net, cost, uniq)
    g, tot = choose(sp, bg + y)
    row[ext] = gw_rows[g]
    drive_s = sp.dist[row, d_nodes]
    drive_s[ext] = tot
    out_min = np.zeros(len(od))
    out_min[ext] = (gw_cost[np.arange(len(g)), g] + approach_delay_s(bg + y, cap, gw_edges)[g]) / 60.0
    gateway = np.full(len(od), -1)
    gateway[ext] = g
    cut_off = drive_s >= CLOSED_COST_S
    drive_min = drive_s / 60.0 + DRIVE_TERMINAL_MIN
    secs = time.time() - t
    if verbose:
        print(f"assignment: {veh.sum():,.0f} peak-hour commuter vehicles "
              f"({veh[ext].sum():,.0f} inbound via {len(gw_nodes)} gateways), {secs:.1f}s")
    return Assignment(volume=bg + y, commuter_volume=y, background=bg, capacity=cap, time_s=cost,
                      sp=sp, od_row=row, od_dest=d_nodes, drive_min=drive_min, rel_gap=gap, seconds=secs,
                      out_min=out_min, gateway=gateway, cut_off=cut_off)







