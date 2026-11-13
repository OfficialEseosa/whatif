"""Tract-level equity inputs from public data (no API keys).

  - Tract polygons: Census cartographic boundary file, GA, 2023, 1:500k.
  - ACS 2024 5-year (table-based summary files): B25003 tenure, B19013 median household
    income, B25064 median gross rent, B25070 gross rent as % of income.
  - HOLC 1938 Atlanta grades: Mapping Inequality (University of Richmond).

    python equity.py     # build cache + print in-box summary
"""
from __future__ import annotations

import pickle
from dataclasses import dataclass

import numpy as np
import pandas as pd

import config

# ---- RULES / THRESHOLDS (README "Assumptions and placeholders") -------------
# A tract is "formerly redlined" if at least this share of its land area lies in
# HOLC grade-D polygons of the 1938 Atlanta map.
REDLINED_D_SHARE = 0.5
# Rent-pressure tract (plan's definition: high renter share + low income):
RENT_PRESSURE_RENTER_SHARE = 0.5           # renter-occupied / occupied units
RENT_PRESSURE_INCOME_RATIO = 0.8           # median HH income < 80% of Atlanta MSA median (HUD "low income" convention)
RENT_PRESSURE_RADIUS_M = 800.0             # households within this distance of a NEW stop
NOISE_BUFFER_M = 150.0                     # households within this distance of new track
COST_COUNTIES = {"13121": "Fulton", "13089": "DeKalb"}  # households that share the capital cost
MSA_GEOID = "310M700US12060"               # Atlanta-Sandy Springs-Roswell MSA
PROJ_CRS = "EPSG:26916"                    # UTM 16N metres, for areas and buffers
TRACT_SIMPLIFY_M = 25.0                    # polygon simplification for export

EQUITY_CACHE = config.CACHE_DIR / f"equity_{config.ACS_YEAR}.pkl"


def _acs(table: str, cols: list[str]) -> pd.DataFrame:
    df = pd.read_csv(config.acs_file(table), sep="|", dtype={"GEO_ID": str},
                     usecols=["GEO_ID"] + cols)
    return df.set_index("GEO_ID")


@dataclass
class Equity:
    tracts: "object"            # GeoDataFrame (EPSG:4326) all GA tracts with ACS + HOLC fields
    msa_median_income: float
    cost_households: int        # Fulton + DeKalb occupied housing units (= households)
    county_households: dict
    acs_year: int


def build_equity() -> Equity:
    import geopandas as gpd

    tr = gpd.read_file(f"zip://{config.TRACTS_FILE}")[["GEOID", "NAMELSAD", "COUNTYFP", "geometry"]]
    tr = tr.to_crs(4326)
    ten = _acs("b25003", ["B25003_E001", "B25003_E003"])
    inc = _acs("b19013", ["B19013_E001"])
    rent = _acs("b25064", ["B25064_E001"])
    bur = _acs("b25070", ["B25070_E001", "B25070_E007", "B25070_E008", "B25070_E009", "B25070_E010", "B25070_E011"])
    gid = "1400000US" + tr.GEOID
    num = lambda s: pd.to_numeric(s, errors="coerce")  # noqa: E731  (ACS uses negative sentinels / '.')
    tr["households"] = num(ten.B25003_E001.reindex(gid)).fillna(0).values
    tr["renters"] = num(ten.B25003_E003.reindex(gid)).fillna(0).values
    tr["renter_share"] = np.where(tr.households > 0, tr.renters / tr.households.clip(lower=1), np.nan)
    m_inc = num(inc.B19013_E001.reindex(gid)).values
    tr["median_income"] = np.where(m_inc > 0, m_inc, np.nan)
    m_rent = num(rent.B25064_E001.reindex(gid)).values
    tr["median_rent"] = np.where(m_rent > 0, m_rent, np.nan)
    b = bur.reindex(gid).apply(num)
    computed = (b.B25070_E001 - b.B25070_E011).values
    tr["rent_burden_share"] = np.where(computed > 0, (b.B25070_E007 + b.B25070_E008 + b.B25070_E009 +
                                                       b.B25070_E010).values / np.maximum(computed, 1), np.nan)
    msa = float(num(inc.B19013_E001.get(MSA_GEOID)))
    tr["pressure_tract"] = ((tr.renter_share >= RENT_PRESSURE_RENTER_SHARE) &
                            (tr.median_income < RENT_PRESSURE_INCOME_RATIO * msa)).fillna(False)

    # HOLC grade-D share of each tract's area
    holc = gpd.read_file(config.HOLC_FILE)
    d = holc[holc.grade == "D"].to_crs(PROJ_CRS)
    trp = tr.to_crs(PROJ_CRS)
    d_union = d.geometry.union_all()
    area = trp.geometry.area.values
    inter = trp.geometry.intersection(d_union).area.values
    tr["holc_d_share"] = np.where(area > 0, inter / area, 0.0)
    graded = holc.to_crs(PROJ_CRS).geometry.union_all()
    tr["holc_graded_share"] = np.where(area > 0, trp.geometry.intersection(graded).area.values / area, 0.0)
    tr["redlined"] = tr.holc_d_share >= REDLINED_D_SHARE

    ch = {}
    for fips, name in COST_COUNTIES.items():
        ch[name] = int(num(ten.B25003_E001.get("0500000US" + fips)))
    return Equity(tracts=tr, msa_median_income=msa, cost_households=sum(ch.values()),
                  county_households=ch, acs_year=config.ACS_YEAR)


def load_equity(rebuild=False) -> Equity:
    if EQUITY_CACHE.exists() and not rebuild:
        with open(EQUITY_CACHE, "rb") as f:
            return pickle.load(f)
    eq = build_equity()
    config.ensure_dirs()
    with open(EQUITY_CACHE, "wb") as f:
        pickle.dump(eq, f)
    return eq


def buffer_share(tracts, geom_wgs84, radius_m: float) -> np.ndarray:
    """Share of each tract's area within radius_m of a WGS84 geometry (uniform-density proxy)."""
    import geopandas as gpd

    if geom_wgs84 is None or geom_wgs84.is_empty:
        return np.zeros(len(tracts))
    g = gpd.GeoSeries([geom_wgs84], crs=4326).to_crs(PROJ_CRS).buffer(radius_m).iloc[0]
    trp = tracts.to_crs(PROJ_CRS)
    area = trp.geometry.area.values
    return np.where(area > 0, trp.geometry.intersection(g).area.values / area, 0.0)


def tract_ring(geom, tol_m=TRACT_SIMPLIFY_M) -> list:
    """Exterior ring of the largest part, simplified, as [[lng,lat],...]."""
    import geopandas as gpd

    g = gpd.GeoSeries([geom], crs=4326).to_crs(PROJ_CRS).simplify(tol_m).to_crs(4326).iloc[0]
    if g.geom_type == "MultiPolygon":
        g = max(g.geoms, key=lambda p: p.area)
    return [[round(x, 5), round(y, 5)] for x, y in g.exterior.coords]


if __name__ == "__main__":
    import equity as _self

    eq = _self.load_equity(rebuild=True)
    t = eq.tracts
    w, s, e, n = config.BBOX
    inb = t.cx[w:e, s:n]
    print(f"ACS {eq.acs_year}: {len(t)} GA tracts; MSA median HH income ${eq.msa_median_income:,.0f}; "
          f"Fulton+DeKalb households {eq.cost_households:,} {eq.county_households}")
    print(f"in-box tracts {len(inb)}: redlined {int(inb.redlined.sum())}, pressure {int(inb.pressure_tract.sum())}, "
          f"renter share (hh-weighted) {inb.renters.sum() / inb.households.sum():.2f}")
    print(f"GA tracts redlined: {int(t.redlined.sum())}; with any HOLC grade: {int((t.holc_graded_share > 0).sum())}")
