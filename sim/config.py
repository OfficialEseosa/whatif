"""Single source of truth for paths and study-area configuration.

Change BBOX here (and only here) to grow/shrink the study area. The frontend
mock uses the same box: lng -84.42..-84.33, lat 33.73..33.80.
"""
from __future__ import annotations

import os
from pathlib import Path

# (west, south, east, north) in WGS84 degrees. Override with env var
# WHATIF_BBOX="west,south,east,north" to experiment without editing code.
BBOX: tuple[float, float, float, float] = (-84.42, 33.73, -84.33, 33.80)
if os.environ.get("WHATIF_BBOX"):
    BBOX = tuple(float(x) for x in os.environ["WHATIF_BBOX"].split(","))  # type: ignore[assignment]

SIM_DIR = Path(__file__).resolve().parent
REPO_DIR = SIM_DIR.parent
DATA_DIR = SIM_DIR / "data"
CACHE_DIR = DATA_DIR / "cache"
SCENARIO_OUT_DIR = REPO_DIR / "public" / "scenarios"
MOCK_SCENARIO = SCENARIO_OUT_DIR / "beltline-streetcar.json"


def bbox_tag() -> str:
    """Short string identifying the bbox, used to key cache files."""
    return "_".join(f"{v:.3f}" for v in BBOX).replace("-", "m")


# Files written by fetch_data.py
GRAPH_FILE = DATA_DIR / f"drive_{bbox_tag()}.graphml"
GTFS_FILE = DATA_DIR / "marta_gtfs.zip"
XWALK_FILE = DATA_DIR / "ga_xwalk.csv.gz"
LODES_GLOB = "ga_od_main_JT00_*.csv.gz"
CORRIDOR_FILE = DATA_DIR / f"corridors_{bbox_tag()}.json"

# Official publisher URLs (verified 2026-11-13)
LODES_OD_INDEX = "https://lehd.ces.census.gov/data/lodes/LODES8/ga/od/"
LODES_XWALK_URL = "https://lehd.ces.census.gov/data/lodes/LODES8/ga/ga_xwalk.csv.gz"
MARTA_GTFS_URL = "https://www.itsmarta.com/google_transit_feed/google_transit.zip"

# Equity / cost inputs (verified 2026-11-13)
TRACTS_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_13_tract_500k.zip"
TRACTS_FILE = DATA_DIR / "cb_2023_13_tract_500k.zip"
HOLC_URL = "https://dsl.richmond.edu/panorama/redlining/static/citiesData/GAAtlanta1938/geojson.json"
HOLC_FILE = DATA_DIR / "holc_atlanta_1938.geojson"
ACS_YEAR = 2024
ACS_TABLES = ["b25003", "b19013", "b25064", "b25070"]


def acs_url(table: str) -> str:
    return (f"https://www2.census.gov/programs-surveys/acs/summary_file/{ACS_YEAR}/table-based-SF/data/"
            f"5YRData/acsdt5y{ACS_YEAR}-{table}.dat")


def acs_file(table: str) -> Path:
    return DATA_DIR / f"acsdt5y{ACS_YEAR}-{table}.dat"


# Simulation clock: trip timestamps are seconds after 6:00 AM.
SIM_START_HOUR = 6.0


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SCENARIO_OUT_DIR.mkdir(parents=True, exist_ok=True)

