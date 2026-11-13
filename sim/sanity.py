"""Common-sense checks on the cached baseline. `python run.py sanity`."""
from __future__ import annotations

import numpy as np

from assign import DRIVE_TERMINAL_MIN
from demand import snap
from model import load_baseline
from transit import TransitSkim

# Reference points (gazetteer coordinates)
PLACES = {
    "Five Points": (-84.3916, 33.7539),
    "Peachtree Center": (-84.3876, 33.7581),
    "Ponce City Market": (-84.3658, 33.7724),
    "Georgia Tech": (-84.3966, 33.7760),
    "Grady": (-84.3822, 33.7518),
    "Inman Park stn": (-84.3524, 33.7578),
    "Clarkston": (-84.2396, 33.8095),          # City of Clarkston centre (approx., Church St)
    "Downtown Decatur": (-84.2963, 33.7748),   # Decatur Square
    "Midtown": (-84.3850, 33.7810),
    "Airport terminal": (-84.4428, 33.6407),
}
PAIRS = [("Five Points", "Ponce City Market"), ("Peachtree Center", "Ponce City Market"),
         ("Georgia Tech", "Grady"), ("Inman Park stn", "Georgia Tech"),
         ("Clarkston", "Five Points"), ("Downtown Decatur", "Midtown"), ("Airport terminal", "Five Points")]


def transit_time(base, a, b):
    """Modeled transit minutes between the in-box zones nearest to a and b (zone-to-zone)."""
    z = base.dem.zones
    lat0 = np.cos(np.deg2rad(33.765))
    za = int(np.argmin(np.hypot((z.lng - a[0]) * lat0, z.lat - a[1])))
    zb = int(np.argmin(np.hypot((z.lng - b[0]) * lat0, z.lat - b[1])))
    return base.run.tsk.dzd[za, zb] / 60.0


def drive_time(base, a, b, congested=True):
    from scipy.sparse.csgraph import dijkstra

    net = base.net
    na, nb = snap(net, [a[0], b[0]], [a[1], b[1]])
    cost = base.run.asg.time_s if congested else net.edges.t0_s.values
    m, _ = net.csr(cost)
    d = dijkstra(m, indices=[na])[0, nb]
    return d / 60.0


def wmedian(x, w):
    o = np.argsort(x)
    c = np.cumsum(np.asarray(w, float)[o])
    return float(np.asarray(x)[o][np.searchsorted(c, c[-1] / 2)])


def main():
    base = load_baseline()
    r, dem = base.run, base.dem
    jobs = dem.od.jobs.values
    print(f"Population modeled: {jobs.sum():,.0f} commuters (internal {jobs[~dem.od.ext.values].sum():,.0f}, inbound {jobs[dem.od.ext.values].sum():,.0f}) in {len(dem.od):,} block-group pairs "
          f"(+{dem.intrazonal_jobs:,} intrazonal not assigned), LODES {dem.year}")
    print(f"Network: {base.net.n_nodes:,} nodes, {len(base.net.edges):,} directed edges")
    print(f"Drive door-to-door minutes (job-weighted) median {wmedian(r.drive_min, jobs):.1f}")
    t = r.transit_min
    f = np.isfinite(t)
    print(f"Transit minutes median {wmedian(t[f], jobs[f]):.1f}; unreachable pairs {(~f).mean():.1%}")
    print(f"Transit share {np.average(r.p_transit, weights=jobs):.3f}, ASC {base.asc:.3f}")
    print("Point-to-point peak drive times (road only, + terminal minutes):")
    for a, b in PAIRS:
        ff = drive_time(base, PLACES[a], PLACES[b], congested=False)
        pk = drive_time(base, PLACES[a], PLACES[b], congested=True)
        tt = transit_time(base, PLACES[a], PLACES[b])
        print(f"  {a:>16} -> {b:<18} free-flow {ff:5.1f}  peak {pk:5.1f}  door-to-door {pk + DRIVE_TERMINAL_MIN:5.1f} min"
              f"  | transit zone-to-zone {tt:5.1f} min")
    # Population-level in-box drive time, congested vs free-flow (same entry points).
    from scipy.sparse.csgraph import dijkstra

    asg = r.asg
    m0, _ = base.net.csr(base.net.edges.t0_s.values)
    d0 = dijkstra(m0, indices=asg.sp.origins)[asg.od_row, asg.od_dest]
    d1 = asg.sp.dist[asg.od_row, asg.od_dest]
    ext = dem.od.ext.values
    for lab, msk in (("all", np.ones(len(ext), bool)), ("internal", ~ext), ("inbound", ext)):
        w = jobs[msk]
        print(f"In-box drive time ({lab}): free-flow {np.average(d0[msk], weights=w)/60:.1f} min, "
              f"peak {np.average(d1[msk], weights=w)/60:.1f} min; ratio {np.average(d1[msk], weights=w)/np.average(d0[msk], weights=w):.2f}")
    print(f"Inbound out-of-box leg (estimated): mean {np.average(asg.out_min[ext], weights=jobs[ext]):.1f} min")
    gw = base.net.gateways
    for name in ("Northeast Expressway", "Downtown Connector"):
        hits = np.where(gw.name.values == name)[0]
        if not len(hits):
            continue
        gi = int(hits[0])
        row = int(np.searchsorted(asg.sp.origins, gw.node_idx.values[gi]))
        fp = snap(base.net, [PLACES["Five Points"][0]], [PLACES["Five Points"][1]])[0]
        ff = dijkstra(m0, indices=[gw.node_idx.values[gi]])[0, fp] / 60
        print(f"  gateway {name} -> Five Points: free-flow {ff:.1f}  peak {asg.sp.dist[row, fp]/60:.1f} min")
    vc = r.asg.vc
    e = base.net.edges
    dc = vc[e["name"].str.contains("Downtown Connector").values]
    print(f"Downtown Connector v/c: median {np.median(dc):.2f}, max {dc.max():.2f}, edges > 1.3: {(dc > 1.3).sum()}")
    print(f"Edges with v/c > 1.3 by class: {e.highway[vc > 1.3].value_counts().to_dict()}")
    top = e.assign(vc=vc).sort_values("vc", ascending=False).head(8)
    print("Highest v/c edges:")
    for _, row in top.iterrows():
        print(f"  {row['name'][:40]:40s} {row.highway:14s} v/c {row.vc:.2f}")
    comm = r.asg.commuter_volume
    print(f"Commuter share of total peak volume on motorways: "
          f"{comm[e.highway.eq('motorway').values].sum() / r.asg.volume[e.highway.eq('motorway').values].sum():.1%}")


if __name__ == "__main__":
    main()




