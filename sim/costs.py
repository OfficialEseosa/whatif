"""Cost ESTIMATES by edit type (all clearly labelled estimates in the output).

  - streetcar / light rail lines: capital from per-mile benchmarks of recent US streetcars
  - BRT lanes: capital from per-mile benchmarks of FTA Small Starts BRT projects
  - frequency changes / new bus routes: OPERATING cost only = added vehicle-hours x cost per
    vehicle revenue hour
  - road closures, heavy rail: not applicable / no benchmark (reported as such, never faked)
Nominal (year-of-expenditure) dollars as published; no inflation adjustment.
Range = lowest..highest benchmark; midpoint = median benchmark.
"""
from __future__ import annotations

# (project, opened/rated, miles, total capital cost USD, source)
STREETCAR_BENCHMARKS = [
    ("Atlanta Streetcar (downtown loop)", 2014, 2.7, 98e6,
     "Final cost ~$98M for the 2.7-mile loop as reported by the City of Atlanta (2014-15; e.g. Railway Technology, "
     "Wikipedia 'Atlanta Streetcar'); nominal 2014 dollars"),
    ("Tempe Streetcar", 2022, 3.0, 201.85e6,
     "FTA Small Starts project profile, rating assigned Nov 2018: $201.85M YOE incl. finance charges, 3.0 mi "
     "(transit.dot.gov az-tempe-streetcar-ar20-profile.pdf)"),
    ("Kansas City Streetcar Main Street Extension", 2025, 3.5, 351.71e6,
     "FTA Full Funding Grant Agreement profile FY22: $351.71M total project cost, 3.5 mi "
     "(transit.dot.gov MO-Kansas-City-Streetcar-Main-St-Ext-Project-FFGA-Profile-FY22.pdf)"),
]
# FTA Capital Investment Grants project profiles (cost at the time of rating).
BRT_BENCHMARKS = [
    ("Albany Washington/Western BRT", 2020, 8.5, 80.65e6,
     "FTA Small Starts profile: $80.65M, 8.5 mi, 16 stations, dedicated lanes on most of the route "
     "(transit.dot.gov ny-albany-washington-western-brt-ar20-profile.pdf)"),
    ("Madison East-West BRT", 2023, 15.5, 160.0e6,
     "FTA profile FY23: $160.00M, 15.5 mi, 27 stations, 8.2 mi exclusive lanes "
     "(transit.dot.gov WI-Madison-East-West-BRT-Project-Profile-FY23.pdf)"),
    ("Denver East Colfax Avenue BRT", 2024, 8.5, 255.31e6,
     "FTA profile FY24: $255.31M, 8.5 mi, 28 stations, 5.5 mi center-running lanes "
     "(transit.dot.gov CO-Denver-East-Colfax-Avenue-BRT-Project-Profile-FY24.pdf)"),
    ("Seattle Madison Street BRT", 2019, 2.3, 120.0e6,
     "FTA Small Starts profile FY19: $120.00M, 2.3 mi, 10 stations, 1.5 mi dedicated lanes "
     "(transit.dot.gov wa-seattle-madison-street-brt-project-fy19-profile.pdf)"),
]
# Operating cost per vehicle revenue hour (USD). Streetcar: NTD agency profiles for comparable
# modern streetcars, read from search-result excerpts (Milwaukee 2022 ~$331, Cincinnati 2023
# ~$377) - UNVERIFIED against the PDFs (transit.dot.gov blocks scripted download).
# Bus and heavy rail: PLACEHOLDERS (no verified MARTA figure fetched yet).
COST_PER_VRH = {
    "streetcar": (331.0, 354.0, 377.0),
    "light_rail": (331.0, 354.0, 377.0),
    "bus": (130.0, 150.0, 180.0),        # PLACEHOLDER
    "brt": (130.0, 150.0, 180.0),        # PLACEHOLDER
    "heavy_rail": (300.0, 400.0, 500.0), # PLACEHOLDER
}
COST_PER_VRH_SOURCES = {
    "streetcar": "NTD agency profiles: Milwaukee Hop 2022 ~$331/VRH, Cincinnati Connector 2023 ~$377/VRH (unverified excerpts)",
    "bus": "PLACEHOLDER bus cost per vehicle revenue hour ($130-180) - replace with MARTA NTD 2023",
    "heavy_rail": "PLACEHOLDER heavy-rail cost per vehicle revenue hour - replace with MARTA NTD 2023",
}
# ASSUMPTION: a frequency change / new route runs all day at the edited headway for this many
# weekday service hours; layover/recovery adds this share to each round trip.
SERVICE_HOURS_PER_WEEKDAY = 16.0
LAYOVER_SHARE = 0.15
# ASSUMPTION: capital cost spread straight-line over this many years (no financing / discounting).
ANNUALIZE_YEARS = 20
# ASSUMPTION: each new transit commuter makes 2 trips per weekday, 250 weekdays per year.
TRIPS_PER_RIDER_DAY = 2
WEEKDAYS_PER_YEAR = 250
METERS_PER_MILE = 1609.344


def _bench(kind):
    return BRT_BENCHMARKS if kind == "brt" else STREETCAR_BENCHMARKS


def per_mile(kind="streetcar"):
    return sorted(c / mi for _, _, mi, c, _ in _bench(kind))


def capital(line_m: float, kind: str = "streetcar") -> dict:
    b = _bench(kind)
    pm = per_mile(kind)
    miles = line_m / METERS_PER_MILE
    lo, hi = pm[0] * miles, pm[-1] * miles
    mid = (pm[(len(pm) - 1) // 2] + pm[len(pm) // 2]) / 2 * miles
    what = "BRT" if kind == "brt" else "streetcar"
    return {"kind": "capital", "low": lo, "mid": mid, "high": hi, "miles": miles, "per_mile": pm,
            "label": (f"Estimated capital ${lo/1e6:,.0f}-{hi/1e6:,.0f}M (mid ${mid/1e6:,.0f}M) for {miles:.1f} mi "
                      f"from per-mile costs of {len(b)} US {what} projects, spread over {ANNUALIZE_YEARS} yrs"),
            "note": "Operating cost not included.",
            "sources": [f"{n} ({y}): ${c/1e6:,.1f}M / {mi} mi = ${c/mi/1e6:,.1f}M/mi. {s}" for n, y, mi, c, s in b]}


def estimate(line_m: float) -> dict:  # backwards compatible name
    return capital(line_m, "streetcar")


def operating(delta_vehicle_hours_per_weekday: float, mode: str, what: str) -> dict:
    lo, mid, hi = COST_PER_VRH.get(mode, COST_PER_VRH["bus"])
    vh = delta_vehicle_hours_per_weekday * WEEKDAYS_PER_YEAR
    src = COST_PER_VRH_SOURCES.get(mode if mode in COST_PER_VRH_SOURCES else "bus")
    return {"kind": "operating", "low": vh * lo, "mid": vh * mid, "high": vh * hi, "vehicle_hours_day": delta_vehicle_hours_per_weekday,
            "label": (f"Estimated added operating cost ${vh*lo/1e6:,.1f}-{vh*hi/1e6:,.1f}M per year for {what} "
                      f"({delta_vehicle_hours_per_weekday:,.0f} extra vehicle-hours per weekday x ${lo:.0f}-{hi:.0f}/hour)"),
            "note": (f"Assumes the change runs {SERVICE_HOURS_PER_WEEKDAY:g} h per weekday, {WEEKDAYS_PER_YEAR} weekdays; "
                     f"no capital cost (vehicle purchases not included)."),
            "sources": [src]}


def not_applicable(why: str) -> dict:
    return {"kind": "none", "low": 0.0, "mid": 0.0, "high": 0.0, "why": why, "label": "", "note": "", "sources": []}


def vehicle_hours_delta(patterns_old_new) -> float:
    """Extra vehicle-hours per weekday: vehicles in service = round-trip time / headway."""
    dv = 0.0
    for runtime_s, h_old, h_new in patterns_old_new:
        cyc_min = runtime_s / 60.0 * (1 + LAYOVER_SHARE)
        dv += cyc_min / h_new - (cyc_min / h_old if h_old else 0.0)
    return dv * SERVICE_HOURS_PER_WEEKDAY


def annual(cost: float) -> float:
    return cost / ANNUALIZE_YEARS


def cost_per_new_trip(cost: float, new_riders_per_day: float) -> float:
    trips = new_riders_per_day * TRIPS_PER_RIDER_DAY * WEEKDAYS_PER_YEAR * ANNUALIZE_YEARS
    return cost / trips if trips > 0 else float("inf")


def op_cost_per_new_trip(annual_cost: float, new_riders_per_day: float) -> float:
    trips = new_riders_per_day * TRIPS_PER_RIDER_DAY * WEEKDAYS_PER_YEAR
    return annual_cost / trips if trips > 0 else float("inf")
