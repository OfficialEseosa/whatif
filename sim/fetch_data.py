"""Download all public inputs into sim/data/. Re-runnable: skips files that exist.

    python fetch_data.py            # everything
    python fetch_data.py --force    # re-download

Sources (official publishers only):
  - OSM drive network via OSMnx / Overpass (cached as graphml)
  - OSM corridor geometry (Beltline Eastside Trail, Edgewood Ave, Ponce City Market)
  - MARTA GTFS (rail, bus, Atlanta Streetcar) from itsmarta.com
  - Census LEHD LODES8 Georgia OD main JT00 (latest year) + GA geography crosswalk

TODO (not needed for the first slice):
  - HPMS Georgia AADT (FHWA) -> background traffic calibration (assign.py)
  - ACS B08301 / B08302 / B08141 -> per-tract mode share + departure-time share
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time

import requests

import config

# itsmarta.com returns 403 to the default python-requests UA; a generic
# Mozilla-compatible UA identifying this tool is accepted.
UA = {"User-Agent": "Mozilla/5.0 (compatible; whatif-atl-sim/0.1)"}


def download(url: str, dest, force: bool = False) -> None:
    if dest.exists() and dest.stat().st_size > 0 and not force:
        print(f"  exists: {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")
        return
    print(f"  GET {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, headers=UA, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.replace(dest)
    print(f"  -> {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")


def latest_lodes_year() -> int:
    html = requests.get(config.LODES_OD_INDEX, headers=UA, timeout=60).text
    years = [int(y) for y in re.findall(r"ga_od_main_JT00_(\d{4})\.csv\.gz", html)]
    if not years:
        raise RuntimeError("Could not find any ga_od_main_JT00 files in LODES index")
    return max(years)


def fetch_lodes(force: bool) -> None:
    year = latest_lodes_year()
    name = f"ga_od_main_JT00_{year}.csv.gz"
    download(config.LODES_OD_INDEX + name, config.DATA_DIR / name, force)
    download(config.LODES_XWALK_URL, config.XWALK_FILE, force)


def fetch_gtfs(force: bool) -> None:
    download(config.MARTA_GTFS_URL, config.GTFS_FILE, force)


def fetch_osm(force: bool) -> None:
    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = str(config.CACHE_DIR / "osmnx")
    if config.GRAPH_FILE.exists() and not force:
        print(f"  exists: {config.GRAPH_FILE.name}")
    else:
        w, s, e, n = config.BBOX
        print(f"  OSMnx drive graph for bbox {config.BBOX} ...")
        t = time.time()
        # osmnx>=2: bbox=(left, bottom, right, top)
        G = ox.graph_from_bbox(bbox=(w, s, e, n), network_type="drive", simplify=True)
        ox.save_graphml(G, config.GRAPH_FILE)
        print(f"  -> {config.GRAPH_FILE.name}: {len(G)} nodes, {G.number_of_edges()} edges "
              f"({time.time()-t:.0f}s)")
    fetch_corridors(force)


def _lines_to_coords(geom):
    from shapely.geometry import LineString, MultiLineString

    if isinstance(geom, LineString):
        return [list(map(list, geom.coords))]
    if isinstance(geom, MultiLineString):
        return [list(map(list, g.coords)) for g in geom.geoms]
    return []


def fetch_corridors(force: bool) -> None:
    """Real OSM geometry for scenario corridors (no hand-typed coordinates)."""
    if config.CORRIDOR_FILE.exists() and not force:
        print(f"  exists: {config.CORRIDOR_FILE.name}")
        return
    import osmnx as ox

    w, s, e, n = config.BBOX
    out: dict = {"source": "OpenStreetMap contributors via Overpass (OSMnx)", "features": {}}

    # Beltline Eastside Trail (path/cycleway ways named like "Eastside Trail")
    trail = ox.features_from_bbox(bbox=(w, s, e, n), tags={"highway": ["cycleway", "path", "footway"]})
    names = trail.get("name")
    if names is not None:
        mask = names.fillna("").str.contains("Eastside Trail|BeltLine Eastside", case=False, regex=True)
        segs = []
        for g in trail[mask].geometry:
            segs += _lines_to_coords(g)
        out["features"]["beltline_eastside_trail"] = segs
        print(f"  Eastside Trail: {len(segs)} OSM line segments")

    # Ponce City Market (building / amenity)
    try:
        pcm = ox.features_from_bbox(bbox=(w, s, e, n), tags={"name": "Ponce City Market"})
        c = pcm.geometry.union_all().centroid
        out["features"]["ponce_city_market"] = [c.x, c.y]
        print(f"  Ponce City Market centroid: {c.x:.5f},{c.y:.5f}")
    except Exception as ex:  # noqa: BLE001
        print(f"  WARN Ponce City Market lookup failed: {ex}")

    config.CORRIDOR_FILE.write_text(json.dumps(out))
    print(f"  -> {config.CORRIDOR_FILE.name}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", choices=["lodes", "gtfs", "osm"], default=None)
    args = ap.parse_args()
    config.ensure_dirs()
    steps = {"gtfs": fetch_gtfs, "lodes": fetch_lodes, "osm": fetch_osm}
    failed = []
    for name, fn in steps.items():
        if args.only and name != args.only:
            continue
        print(f"[{name}]")
        try:
            fn(args.force)
        except Exception as ex:  # noqa: BLE001
            print(f"  FAILED {name}: {ex}")
            failed.append(name)
    if failed:
        print(f"Failed steps: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
