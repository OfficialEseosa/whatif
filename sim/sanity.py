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
}
PAIRS = [("Five Points", "Ponce City Market"), ("Peachtree Center", "Ponce City Market"),
         ("Georgia Tech", "Grady"), ("Inman Park stn", "Georgia Tech")]


def drive_time(base, a, b, congested=True):
    from scipy.sparse.csgraph import dijkstra

    net = base.net
    na, nb = snap(net, [a[0], b[0]], [a[1], b[1]])
    cost = base.run.asg.time_s if congested else net.edges.t0_s.values
    m, _ = net.csr(cost)
    d = dijkstra(m, indices=[na])[0, nb]
    return d / 60.0


def main():
    base = load_baseline()
    r, dem = base.run, base.dem
    jobs = dem.od.jobs.values
    print(f"Population modeled: {jobs.sum():,} commuters in {len(dem.od):,} block-group pairs "
          f"(+{dem.intrazonal_jobs:,} intrazonal not assigned), LODES {dem.year}")
    print(f"Network: {base.net.n_nodes:,} nodes, {len(base.net.edges):,} directed edges")
    print(f"Drive door-to-door minutes (job-weighted) median {np.median(np.repeat(r.drive_min, jobs)):.1f}")
    t = r.transit_min
    f = np.isfinite(t)
    print(f"Transit minutes median {np.median(np.repeat(t[f], jobs[f])):.1f}; unreachable pairs {(~f).mean():.1%}")
    print(f"Transit share {np.average(r.p_transit, weights=jobs):.3f}, ASC {base.asc:.3f}")
    print("Point-to-point peak drive times (road only, + terminal minutes):")
    for a, b in PAIRS:
        ff = drive_time(base, PLACES[a], PLACES[b], congested=False)
        pk = drive_time(base, PLACES[a], PLACES[b], congested=True)
        print(f"  {a:>16} -> {b:<18} free-flow {ff:5.1f}  peak {pk:5.1f}  door-to-door {pk + DRIVE_TERMINAL_MIN:5.1f} min")
    vc = r.asg.vc
    e = base.net.edges
    top = e.assign(vc=vc).sort_values("vc", ascending=False).head(8)
    print("Highest v/c edges:")
    for _, row in top.iterrows():
        print(f"  {row['name'][:40]:40s} {row.highway:14s} v/c {row.vc:.2f}")
    comm = r.asg.commuter_volume
    print(f"Commuter share of total peak volume on motorways: "
          f"{comm[e.highway.eq('motorway').values].sum() / r.asg.volume[e.highway.eq('motorway').values].sum():.1%}")


if __name__ == "__main__":
    main()
