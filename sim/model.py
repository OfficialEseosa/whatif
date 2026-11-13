"""Glue: run the full model (assignment <-> mode choice) for baseline or a scenario.

Baseline is computed once and cached to disk; a scenario reuses the network,
demand and calibrated ASC and only redoes transit skims + assignment.
"""
from __future__ import annotations

import pickle
import time
from dataclasses import dataclass, field

import numpy as np

import config
from assign import MSA_ITERATIONS, Assignment, assign
from demand import Demand, load_demand
from mode_choice import calibrate_asc, p_transit
from network import Network, load_network
from transit import TransitData, TransitGraph, TransitSkim, build_graph, load_transit_base, skim

# Outer loops of (assignment -> mode choice). Two is enough at this scale.
OUTER_LOOPS = 2
# Scenario runs warm-start from the baseline: this many (assignment -> mode choice) loops of
# WARM_MSA_ITERATIONS small MSA steps each.
WARM_OUTER_LOOPS = 2
WARM_MSA_ITERATIONS = 4
BASELINE_CACHE = config.CACHE_DIR / f"baseline_{config.bbox_tag()}.pkl"


@dataclass
class ModelRun:
    td: TransitData
    tg: TransitGraph
    tsk: TransitSkim
    asg: Assignment
    p_transit: np.ndarray        # per OD pair
    capacity: np.ndarray
    seconds: float
    meta: dict = field(default_factory=dict)

    @property
    def drive_min(self):
        return self.asg.drive_min

    @property
    def transit_min(self):
        return self.tsk.minutes

    def expected_min(self) -> np.ndarray:
        t_t = np.where(np.isfinite(self.transit_min), self.transit_min, 0.0)
        return (1 - self.p_transit) * self.drive_min + self.p_transit * t_t


@dataclass
class Baseline:
    net: Network
    dem: Demand
    asc: float
    run: ModelRun                 # reference baseline (warm-start procedure, no edit)
    seed: ModelRun | None = None  # calibrated run every scenario warm-starts from


def run_model(net, dem, td, capacity, asc: float | None, verbose=True, closed=None, extra_od=None,
              tsk=None, tg=None, warm=None) -> tuple[ModelRun, float]:
    """If asc is None, calibrate it (baseline). Returns (run, asc)."""
    t = time.time()
    if tsk is None:  # road-only edits pass the baseline transit graph + skim
        tg = build_graph(td, dem.zones)
        tsk = skim(tg, dem.od)
    if verbose:
        reach = np.isfinite(tsk.minutes)
        print(f"transit skim: {tg.csr.shape[0]} nodes, {tg.csr.nnz} links, "
              f"{reach.mean():.0%} of OD pairs reachable ({tsk.seconds:.1f}s)")
    peak = dem.od.peak_trips.values
    jobs = dem.od.jobs.values
    calibrate = asc is None
    if warm is not None:
        # Scenario: start from the baseline's mode split and flows and continue its MSA with a
        # few small steps, so an edit that changes nothing reproduces the baseline (no noise).
        p = warm.p_transit.copy()
        y_prev = warm.asg.commuter_volume
        for k in range(WARM_OUTER_LOOPS):
            asg = assign(net, dem, peak * (1 - p), capacity=capacity, verbose=verbose, closed=closed,
                         extra_od=extra_od, y0=y_prev, k0=MSA_ITERATIONS, iterations=WARM_MSA_ITERATIONS)
            y_prev = asg.commuter_volume
            p_new = p_transit(asg.drive_min, tsk.minutes, asc)
            p = p_new if k == WARM_OUTER_LOOPS - 1 else p + (p_new - p) / 2
        run = ModelRun(td=td, tg=tg, tsk=tsk, asg=asg, p_transit=p, capacity=capacity, seconds=time.time() - t)
        return run, asc
    p = np.zeros(len(peak))  # first pass: everyone drives
    for k in range(OUTER_LOOPS + 1):
        asg = assign(net, dem, peak * (1 - p), capacity=capacity, verbose=verbose, closed=closed,
                     extra_od=extra_od)
        if calibrate:
            asc = calibrate_asc(asg.drive_min, tsk.minutes, jobs)
        p_new = p_transit(asg.drive_min, tsk.minutes, asc)
        # damp the mode split between outer loops (MSA on p) - big boxes oscillate otherwise
        p = p_new if k in (0, OUTER_LOOPS) else p + (p_new - p) / (k + 1)
        if verbose:
            print(f"  outer {k+1}: transit share {np.average(p, weights=jobs):.3f} (ASC {asc:.3f})")
    # Note: p is evaluated at the final drive times; the last assignment used the
    # previous p, so drive volumes lag one step (documented; OUTER_LOOPS=2).
    run = ModelRun(td=td, tg=tg, tsk=tsk, asg=asg, p_transit=p, capacity=capacity,
                   seconds=time.time() - t)
    return run, asc


def build_baseline(verbose=True) -> Baseline:
    t = time.time()
    net = load_network()
    dem = load_demand(net)
    td = load_transit_base()
    cap = net.edges["capacity_vph"].values.copy()
    run, asc = run_model(net, dem, td, cap, asc=None, verbose=verbose)
    # Display geometry for every GTFS pattern is cut from shapes.txt once, here (build time),
    # so request-time code needs neither the GTFS zip nor OSMnx.
    import display
    from network import load_display_network

    display.attach_hop_paths(td, display.router_for(load_display_network()), verbose=verbose)
    run.meta["total_seconds"] = time.time() - t
    if verbose:
        print(f"baseline done in {time.time()-t:.1f}s (model {run.seconds:.1f}s), ASC={asc:.3f}")
    # Reference baseline = the same warm-start procedure a scenario uses, with no edit, so any
    # scenario-vs-baseline difference comes from the edit only (no assignment noise).
    ref, _ = run_model(net, dem, td, cap, asc=asc, verbose=False, tsk=run.tsk, tg=run.tg, warm=run)
    ref.meta = dict(run.meta)
    return Baseline(net=net, dem=dem, asc=asc, run=ref, seed=run)


def load_baseline(rebuild=False, verbose=True) -> Baseline:
    if BASELINE_CACHE.exists() and not rebuild:
        with open(BASELINE_CACHE, "rb") as f:
            return pickle.load(f)
    b = build_baseline(verbose=verbose)
    config.ensure_dirs()
    with open(BASELINE_CACHE, "wb") as f:
        pickle.dump(b, f)
    return b






