"""Capital-cost ESTIMATE for a new/extended line from per-mile benchmarks of recent
US streetcar projects. Nominal (year-of-expenditure) dollars as published; no
inflation adjustment, no operating cost (TODO). Range = low..high benchmark.
"""
from __future__ import annotations

# (project, opened, miles, total capital cost USD, source)
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
# ASSUMPTION: capital cost spread straight-line over this many years (no financing / discounting).
ANNUALIZE_YEARS = 20
# ASSUMPTION: each new transit commuter makes 2 trips per weekday, 250 weekdays per year.
TRIPS_PER_RIDER_DAY = 2
WEEKDAYS_PER_YEAR = 250
METERS_PER_MILE = 1609.344


def per_mile():
    return sorted(c / mi for _, _, mi, c, _ in STREETCAR_BENCHMARKS)


def estimate(line_m: float) -> dict:
    pm = per_mile()
    miles = line_m / METERS_PER_MILE
    lo, mid, hi = pm[0] * miles, pm[len(pm) // 2] * miles, pm[-1] * miles
    return {"miles": miles, "per_mile": pm, "low": lo, "mid": mid, "high": hi,
            "sources": [f"{n} ({y}): ${c/1e6:,.1f}M / {mi} mi = ${c/mi/1e6:,.1f}M/mi. {s}"
                        for n, y, mi, c, s in STREETCAR_BENCHMARKS]}


def annual(cost: float) -> float:
    return cost / ANNUALIZE_YEARS


def cost_per_new_trip(cost: float, new_riders_per_day: float) -> float:
    trips = new_riders_per_day * TRIPS_PER_RIDER_DAY * WEEKDAYS_PER_YEAR * ANNUALIZE_YEARS
    return cost / trips if trips > 0 else float("inf")
