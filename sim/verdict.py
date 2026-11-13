"""Verdict, grades, who-pays and tract/agent equity fields computed from sim results
and public data. Every threshold is a named constant (README table). Text is
templated from the numbers - no narrative is invented.
"""
from __future__ import annotations

import json

import numpy as np

import config
import costs
import equity as eqm

# ---- GRADE THRESHOLDS (judgment calls unless a source is named) --------------
# time_saved, commuter-hours per weekday (net, all modeled commuters). A net loss is poor.
TIME_SAVED_GOOD_HRS = 500.0
TIME_SAVED_FAIR_HRS = 0.0           # >= 0 and < GOOD is fair; < 0 is poor
# new_riders, commuters per weekday who switch to transit (work trips only).
NEW_RIDERS_GOOD = 3000.0
NEW_RIDERS_FAIR = 1000.0
# cost_per_rider, USD of capital per new-rider trip over 20 years. Breakpoints borrowed from
# FTA CIG cost-effectiveness (FAST Act interim policy guidance, June 2016: High < $4,
# Medium-High $4-5.99, Medium $6-9.99, Medium-Low $10-14.99, Low >= $15). FTA's measure
# is annual capital+O&M per trip on the project, so this is a looser comparison.
COST_PER_TRIP_GOOD = 6.0
COST_PER_TRIP_FAIR = 15.0
# redlined_benefit_share vs the share of modeled commuters who live in redlined tracts:
# good if >= that share, fair if >= REDLINED_FAIR_RATIO x that share, else poor.
REDLINED_FAIR_RATIO = 0.5
# renters_rent_pressure, renter households in pressure tracts within 800 m of new stops.
RENTERS_GOOD_MAX = 250.0
RENTERS_FAIR_MAX = 1000.0
# who-pays: a road counts as "slowed" if per-traversal delay grows at least this much,
# and as "spillover" (not an edited road) if peak v/c grows at least this much.
# The contract has no "n/a" grade; tests that do not apply to an edit type (cost per rider of a
# road closure) get this grade, value 0 and a sublabel starting "Not applicable".
NA_GRADE = "fair"
SLOWED_ROAD_MIN = 0.05
SPILLOVER_VC_DELTA = 0.05

GAZETTEER_FILE = config.REPO_DIR / "src" / "data" / "gazetteer.json"
EXISTING_KINDS = {"streetcar_stop", "marta_station"}


def _grade_hi(v, good, fair):
    return "good" if v >= good else ("fair" if v >= fair else "poor")


def _grade_lo(v, good, fair):
    return "good" if v < good else ("fair" if v < fair else "poor")


def new_stops(edit) -> list:
    try:
        kinds = {p["id"]: p["kind"] for p in json.loads(GAZETTEER_FILE.read_text(encoding="utf-8"))}
    except Exception:  # noqa: BLE001
        kinds = {}
    return [s for s in edit.get("stops", []) if kinds.get(s["gazetteerId"]) not in EXISTING_KINDS]


def _line_len_m(path):
    lat0 = np.cos(np.deg2rad(33.76))
    p = np.asarray(path, float)
    if len(p) < 2:
        return 0.0
    return float(np.hypot(np.diff(p[:, 0]) * lat0, np.diff(p[:, 1])).sum() * 111_320)


def default_change(edit, line):
    """Change spec for edits that did not pass one (extend_line): new track = the line path,
    new stops = gazetteer stops that are not existing stations, streetcar capital benchmarks."""
    L = _line_len_m(line.get("path") or [])
    return {"track": line.get("path") or None,
            "stops": [tuple(s["coord"]) for s in new_stops(edit)],
            "cost": costs.capital(L, "streetcar") if L > 0 else costs.not_applicable("no new track")}


def assess(base, prun, edit, line, riders_on_line, metrics_b, metrics_p, roads, change=None):
    """Returns dict with verdict, whoPays items, tracts, ctx (for agent fields), notes."""
    from shapely.geometry import LineString, MultiPoint

    dem, brun = base.dem, base.run
    prun = prun or brun
    is_base = prun is brun
    change = change or default_change(edit, line)
    eq = eqm.load_equity()
    tr = eq.tracts.set_index("GEOID")
    od = dem.od
    jobs = od.jobs.values
    saved = brun.expected_min() - prun.expected_min()               # minutes per commuter
    hours = float((saved * jobs).sum() / 60.0)
    new_r = metrics_p["dailyTransitRiders"] - metrics_b["dailyTransitRiders"]

    # cost: capital (per-mile benchmarks), operating (vehicle-hours x cost/hour) or not applicable
    C = change["cost"]
    est = C if C["kind"] == "capital" else None
    if C["kind"] == "capital":
        cpt = costs.cost_per_new_trip(C["mid"], new_r)
        hh_yr = {k: costs.annual(C[k]) / eq.cost_households for k in ("low", "mid", "high")}
    elif C["kind"] == "operating":
        cpt = costs.op_cost_per_new_trip(C["mid"], new_r)
        hh_yr = {k: C[k] / eq.cost_households for k in ("low", "mid", "high")}
    else:
        cpt = None
        hh_yr = {"low": 0.0, "mid": 0.0, "high": 0.0}

    # redlined share of gains
    red = tr.redlined.reindex(od.home_tract.values).fillna(False).values
    gain = np.clip(saved, 0, None) * jobs
    red_share = float(gain[red].sum() / gain.sum()) if gain.sum() > 0 else 0.0
    pop_red = float(jobs[red].sum() / jobs.sum())

    # rent pressure / noise around NEW stops and track
    ns = change["stops"]
    stops_geom = MultiPoint(ns) if ns else None
    track = LineString(change["track"]) if change.get("track") and len(change["track"]) >= 2 else None
    w, s, e, n = config.BBOX
    inbox = eqm.in_bbox(eq.tracts, config.BBOX)
    inbox["near_share"] = eqm.buffer_share(inbox, stops_geom, eqm.RENT_PRESSURE_RADIUS_M)
    inbox["noise_share"] = eqm.buffer_share(inbox, track, eqm.NOISE_BUFFER_M)
    pz = inbox.pressure_tract.values & (inbox.near_share.values > 0)
    renters_pz = float((inbox.renters * inbox.near_share)[pz].sum())
    noise_hh = float((inbox.households * inbox.noise_share).sum())

    tests = []
    if is_base:
        for k, lab, unit in (("time_saved", "Time saved", "hrs/day"), ("new_riders", "New transit riders", "riders/day"),
                             ("cost_per_rider", "Cost per new-rider trip", "usd/trip"),
                             ("redlined_benefit_share", "Benefit to formerly redlined tracts", "share"),
                             ("renters_rent_pressure", "Renters under rent pressure", "households")):
            tests.append({"key": k, "label": lab, "sublabel": "Baseline - no plan applied", "value": 0,
                          "unit": unit, "grade": "fair"})
        label = "mixed"
        headline = "Baseline: today's network, no plan applied"
        summary = (f"{metrics_b['populationModeled']:,} commuters who work in the study box are modeled (work trips "
                   f"only). Average door-to-door commute {metrics_b['avgCommuteMin']:.1f} min; transit and "
                   f"park-and-ride share {metrics_b['transitShare']:.1%}. Grades are not applicable to the baseline.")
    else:
        g_time = "poor" if hours < TIME_SAVED_FAIR_HRS else _grade_hi(hours, TIME_SAVED_GOOD_HRS, TIME_SAVED_FAIR_HRS)
        g_new = _grade_hi(new_r, NEW_RIDERS_GOOD, NEW_RIDERS_FAIR)
        if cpt is None:                       # not applicable (e.g. a road closure)
            g_cost, cpt_val = NA_GRADE, 0.0
            cpt_sub = f"Not applicable: {C['why']}"
        elif not np.isfinite(cpt):            # cost but no new riders
            g_cost, cpt_val = "poor", 0.0
            cpt_sub = f"{C['label']}; no new transit riders, so cost per new-rider trip is unbounded"
        else:
            g_cost, cpt_val = _grade_lo(cpt, COST_PER_TRIP_GOOD, COST_PER_TRIP_FAIR), round(cpt, 2)
            cpt_sub = (f"{C['label']} / new-rider trips; FTA-style breakpoints (good < ${COST_PER_TRIP_GOOD:g}, "
                       f"poor >= ${COST_PER_TRIP_FAIR:g})")
        g_red = ("poor" if gain.sum() <= 0 else
                 _grade_hi(red_share, pop_red, REDLINED_FAIR_RATIO * pop_red))
        g_rent = _grade_lo(renters_pz, RENTERS_GOOD_MAX + 1e-9, RENTERS_FAIR_MAX + 1e-9)
        tests = [
            {"key": "time_saved", "label": "Time saved",
             "sublabel": f"Net commuter-hours per weekday, all {metrics_b['populationModeled']:,} modeled commuters "
                         f"(good >= {TIME_SAVED_GOOD_HRS:g}, poor < 0)",
             "value": round(hours, 1), "unit": "hrs/day", "grade": g_time},
            {"key": "new_riders", "label": "New transit riders",
             "sublabel": f"Commuters/day switching to transit; work trips only (good >= {NEW_RIDERS_GOOD:,.0f}, "
                         f"fair >= {NEW_RIDERS_FAIR:,.0f})",
             "value": round(new_r, 1), "unit": "riders/day", "grade": g_new},
            {"key": "cost_per_rider", "label": "Cost per new-rider trip", "sublabel": cpt_sub,
             "value": cpt_val, "unit": "usd/trip", "grade": g_cost},
            {"key": "redlined_benefit_share", "label": "Benefit to formerly redlined tracts",
             "sublabel": (f"Share of time gains to residents of HOLC-D tracts (>= {eqm.REDLINED_D_SHARE:.0%} of area "
                          f"graded D in 1938); they are {pop_red:.1%} of modeled commuters"),
             "value": round(red_share, 4), "unit": "share", "grade": g_red},
            {"key": "renters_rent_pressure", "label": "Renters under rent pressure",
             "sublabel": (f"Renter households within {eqm.RENT_PRESSURE_RADIUS_M:g} m of new stops in tracts with "
                          f">= {eqm.RENT_PRESSURE_RENTER_SHARE:.0%} renters and median income < "
                          f"{eqm.RENT_PRESSURE_INCOME_RATIO:.0%} of the MSA median (ACS {eq.acs_year}); "
                          f"area-share estimate (good <= {RENTERS_GOOD_MAX:g}, poor > {RENTERS_FAIR_MAX:g})"),
             "value": round(renters_pz), "unit": "households", "grade": g_rent},
        ]
        grades = {t["key"]: t["grade"] for t in tests}
        n_good = sum(g == "good" for g in grades.values())
        n_poor = sum(g == "poor" for g in grades.values())
        # RULE: poor if time is a net loss or both ridership and cost-effectiveness are poor;
        # good if >= 3 tests good and none poor; otherwise mixed.
        if grades["time_saved"] == "poor" or (grades["new_riders"] == "poor" and grades["cost_per_rider"] == "poor"
                                              and cpt is not None):
            label = "poor"
        elif n_good >= 3 and n_poor == 0:
            label = "good"
        else:
            label = "mixed"
        if hours < 0:
            hl = f"Net loss of {abs(hours):,.0f} commuter-hours per weekday"
        elif hours < 1:
            hl = "Negligible change in commute time"
        else:
            hl = f"{hours:,.0f} commuter-hours saved per weekday"
        headline = f"{hl}; {max(new_r, 0):,.0f} new transit riders"
        if cpt is None:
            cost_txt = f"No cost estimate ({C['why']}). "
        else:
            cost_txt = (f"{C['label']}"
                        + (f", i.e. ${cpt:,.0f} per new-rider trip at the midpoint" if np.isfinite(cpt) else
                           ", with no new riders to spread it over")
                        + f", or ${hh_yr['low']:.2f}-{hh_yr['high']:.2f} per Fulton+DeKalb household per year. ")
        cut = int(prun.asg.cut_off.sum()) if getattr(prun.asg, "cut_off", None) is not None else 0
        if cut:
            cost_txt += f"{jobs[prun.asg.cut_off].sum():,.0f} commuters have no drive route left. "
        summary = (
            f"The model measured work commutes only ({metrics_b['populationModeled']:,} people who work in the study "
            f"box; no school, errand or off-peak trips). Total commute time {'falls' if hours > 0 else 'rises'} by "
            f"{abs(hours):,.1f} hours per weekday "
            f"(average {metrics_b['avgCommuteMin']:.2f} -> {metrics_p['avgCommuteMin']:.2f} min). "
            f"{max(new_r, 0):,.0f} commuters switch to transit and {riders_on_line:,.0f} ride the new line. "
            + cost_txt +
            f"{red_share:.0%} of time gains go to formerly redlined tracts (home to {pop_red:.0%} of modeled commuters). "
            f"About {renters_pz:,.0f} renter households live within {eqm.RENT_PRESSURE_RADIUS_M:g} m of new stops in "
            f"rent-pressure tracts. Verdict rule: poor if time is a net loss or both ridership and cost are poor.")

    # ---- who pays
    names = base.net.edges.groupby("way_id")["name"].first()
    vol_b = base.net.edges.assign(v=brun.asg.volume).groupby("way_id").v.max()
    vol_p = base.net.edges.assign(v=prun.asg.volume).groupby("way_id").v.max()
    edited = set(edit.get("roadIds") or [])
    slowed = [r for r in roads if r["delayDeltaMin"] >= SLOWED_ROAD_MIN]
    slowed.sort(key=lambda r: -r["delayDeltaMin"])
    spill = [r for r in roads if r["roadId"] not in edited and r["vcProposed"] - r["vcBaseline"] >= SPILLOVER_VC_DELTA]
    spill.sort(key=lambda r: -(r["vcProposed"] - r["vcBaseline"]))
    ed = [r for r in roads if r["roadId"] in edited]

    def nm(rs, k=4):
        out = []
        for r in rs[:k]:
            n_ = names.get(r["roadId"], "") or r["roadId"]
            if n_ not in out:
                out.append(n_)
        return ", ".join(out) if out else "none"

    items = []
    if not is_base:
        sv = float(sum(vol_p.get(r["roadId"], 0.0) for r in slowed))
        items.append({"key": "slowed_roads", "label": "Drivers on slowed roads", "value": round(sv),
                      "unit": "veh/peak hr",
                      "detail": (f"{len(slowed)} road segments get >= {SLOWED_ROAD_MIN * 60:.0f} s slower per trip "
                                 f"(max +{slowed[0]['delayDeltaMin'] * 60:.0f} s on {nm(slowed, 1)}): {nm(slowed)}. "
                                 if slowed else
                                 f"No road segment gets >= {SLOWED_ROAD_MIN * 60:.0f} s slower per trip. ") +
                                (f"Edited roads (lane removed): peak v/c {min(r['vcBaseline'] for r in ed):.2f}-"
                                 f"{max(r['vcBaseline'] for r in ed):.2f} -> {min(r['vcProposed'] for r in ed):.2f}-"
                                 f"{max(r['vcProposed'] for r in ed):.2f}." if ed else ""),
                      "zone": "spillover", "roadIds": [r["roadId"] for r in (slowed or ed)][:20]})
        items.append({"key": "spillover_roads", "label": "Spillover roads", "value": len(spill), "unit": "roads",
                      "detail": (f"Roads not in the edit whose peak v/c rises by >= {SPILLOVER_VC_DELTA:.2f}: "
                                 f"{nm(spill)}." if spill else
                                 f"No unedited road's peak v/c rises by >= {SPILLOVER_VC_DELTA:.2f}."),
                      "zone": "spillover", "roadIds": [r["roadId"] for r in spill][:20]})
        items.append({"key": "noise_construction", "label": "Households near new track", "value": round(noise_hh),
                      "unit": "households",
                      "detail": (f"Households within {eqm.NOISE_BUFFER_M:g} m of the new track (ACS {eq.acs_year} "
                                 f"tract households x share of tract area in the buffer; estimate)."),
                      "zone": "noise_construction"})
        pzt = inbox[pz]
        items.append({"key": "rent_pressure", "label": "Renters in the rent-pressure zone", "value": round(renters_pz),
                      "unit": "households",
                      "detail": (f"{len(pzt)} rent-pressure tracts touch the {eqm.RENT_PRESSURE_RADIUS_M:g} m zone around "
                                 f"new stops; median gross rent there ${pzt.median_rent.median():,.0f}/mo, "
                                 f"{pzt.rent_burden_share.median():.0%} of renters pay >= 30% of income (ACS {eq.acs_year} "
                                 f"medians across tracts). Exposure, not a displacement forecast."
                                 if len(pzt) else "No rent-pressure tract within the zone around new stops."),
                      "zone": "rent_pressure"})
        if C["kind"] in ("capital", "operating"):
            items.append({"key": "regional_cost", "label": "Cost per household", "value": round(hh_yr["mid"], 2),
                          "unit": "usd/yr",
                          "detail": (f"ESTIMATE: {C['label']}, spread over {eq.cost_households:,} Fulton+DeKalb "
                                     f"households (ACS {eq.acs_year}) = ${hh_yr['low']:.2f}-{hh_yr['high']:.2f}/yr. "
                                     f"{C['note']} Sources: " + " | ".join(C["sources"])),
                          "zone": "regional_cost"})

    # ---- tracts (in-box, real polygons)
    eb = brun.expected_min()
    ep = prun.expected_min()
    import pandas as pd

    df = pd.DataFrame({"t": od.home_tract.values, "w": jobs, "d": (ep - eb) * jobs})
    agg = df.groupby("t")[["w", "d"]].sum()
    tracts = []
    for _, r in inbox.iterrows():
        g = r.GEOID
        c = r.geometry.representative_point()
        md = float(agg.d[g] / agg.w[g]) if g in agg.index and agg.w[g] > 0 else 0.0
        t = {"id": g, "name": r.NAMELSAD, "centroid": [round(c.x, 5), round(c.y, 5)],
             "polygon": eqm.tract_ring(r.geometry), "minutesDelta": round(md, 3),
             "redlined": bool(r.redlined),
             "rentPressure": bool(r.pressure_tract and r.near_share > 0)}
        if np.isfinite(r.renter_share):
            t["renterShare"] = round(float(r.renter_share), 3)
        t["households"] = int(r.households)
        tracts.append(t)

    ctx = {"renter_share": tr.renter_share, "pressure": tr.pressure_tract, "county": tr.COUNTYFP,
           "stops": [tuple(s) for s in ns], "hh_cost_mid": hh_yr["mid"]}
    notes = [f"Equity inputs: ACS {eq.acs_year} 5-year (B25003, B19013, B25064, B25070), Census 2023 tract boundaries, "
             f"HOLC 1938 Atlanta (Mapping Inequality, Univ. of Richmond). Agent 'renter' is SAMPLED from the home "
             f"tract's renter share (seeded), not observed. displacementRisk is not modeled ('none')."]
    if C["kind"] in ("capital", "operating"):
        notes.append(f"Cost is an ESTIMATE ({C['label']}): " + " | ".join(C["sources"]))
    return {"tests": tests, "label": label, "headline": headline, "summary": summary, "items": items,
            "tracts": tracts, "ctx": ctx, "notes": notes, "cost": est, "hh_yr": hh_yr}


def agent_equity(ctx, tract_id, home, rng):
    """renter (sampled), stake.rentPressure, costShareUsdYr for one agent."""
    rs = ctx["renter_share"].get(tract_id, np.nan)
    renter = bool(rng.random() < rs) if np.isfinite(rs) else False
    near = False
    if ctx["stops"]:
        lat0 = np.cos(np.deg2rad(33.76))
        d = min(np.hypot((home[0] - x) * lat0, home[1] - y) * 111_320 for x, y in ctx["stops"])
        near = d <= eqm.RENT_PRESSURE_RADIUS_M
    pressure = bool(renter and near and bool(ctx["pressure"].get(tract_id, False)))
    in_cost = ctx["county"].get(tract_id) in ("121", "089")
    return renter, pressure, round(float(ctx["hh_cost_mid"]) if in_cost else 0.0, 2)




