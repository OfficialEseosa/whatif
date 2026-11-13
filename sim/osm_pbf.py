"""Fallback for when the Overpass API is down: build the OSM drive graph for config.BBOX
from the Geofabrik Georgia extract (OpenStreetMap data, ODbL).

    python osm_pbf.py        # data/georgia-latest.osm.pbf -> data/drive_<bbox>.graphml

Mirrors OSMnx's network_type="drive" filter (public drivable highways, no service
roads / private access) and truncates to the bbox like graph_from_bbox.
"""
from __future__ import annotations

import time
import xml.sax.saxutils as su

import numpy as np

import config

PBF_URL = "https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf"
PBF_FILE = config.DATA_DIR / "georgia-latest.osm.pbf"
BUFFER_DEG = 0.01
DRIVE_HIGHWAYS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
                  "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link",
                  "tertiary_link", "road", "busway"}
EXCLUDE_ACCESS = {"private", "no"}
KEEP_TAGS = ["highway", "name", "ref", "lanes", "maxspeed", "oneway", "junction", "access", "bridge", "tunnel"]


def build(out_graphml=None) -> None:
    import osmium
    import osmnx as ox

    t = time.time()
    w, s, e, n = config.BBOX
    W, S, E, N = w - BUFFER_DEG, s - BUFFER_DEG, e + BUFFER_DEG, n + BUFFER_DEG
    ids, lat, lon, signals = [], [], [], set()
    for o in osmium.FileProcessor(str(PBF_FILE), osmium.osm.NODE):
        loc = o.location
        if S <= loc.lat <= N and W <= loc.lon <= E:
            ids.append(o.id); lat.append(loc.lat); lon.append(loc.lon)
            if o.tags.get("highway") == "traffic_signals":   # network.py adds signal delay here
                signals.add(o.id)
    ids = np.asarray(ids, dtype=np.int64)
    order = np.argsort(ids)
    ids, lat, lon = ids[order], np.asarray(lat)[order], np.asarray(lon)[order]
    print(f"  pbf pass 1: {len(ids):,} nodes in buffered bbox ({time.time()-t:.0f}s)")

    ways, used = [], set()
    for o in osmium.FileProcessor(str(PBF_FILE), osmium.osm.WAY):
        hw = o.tags.get("highway")
        if hw not in DRIVE_HIGHWAYS:
            continue
        if o.tags.get("access") in EXCLUDE_ACCESS or o.tags.get("motor_vehicle") in EXCLUDE_ACCESS \
                or o.tags.get("area") == "yes" or o.tags.get("service"):
            continue
        refs = np.fromiter((nd.ref for nd in o.nodes), dtype=np.int64)
        pos = np.searchsorted(ids, refs)
        ok = (pos < len(ids)) & (ids[np.minimum(pos, len(ids) - 1)] == refs)
        if ok.sum() < 2:
            continue
        # keep the longest consecutive in-buffer run (ways crossing the buffer edge)
        tags = {k: o.tags.get(k) for k in KEEP_TAGS if o.tags.get(k) is not None}
        run = []
        for r, k in zip(refs, ok):
            if k:
                run.append(int(r))
            elif len(run) >= 2:
                ways.append((o.id, run, tags)); used.update(run); run = []
            else:
                run = []
        if len(run) >= 2:
            ways.append((o.id, run, tags)); used.update(run)
    print(f"  pbf pass 2: {len(ways):,} drivable way pieces ({time.time()-t:.0f}s)")

    xml_path = config.CACHE_DIR / "drive_bbox.osm"
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="whatif-sim">\n')
        sel = np.isin(ids, np.fromiter(used, dtype=np.int64))
        for i, la, lo in zip(ids[sel], lat[sel], lon[sel]):
            if int(i) in signals:
                f.write(f'<node id="{i}" lat="{la:.7f}" lon="{lo:.7f}"><tag k="highway" v="traffic_signals"/></node>\n')
            else:
                f.write(f'<node id="{i}" lat="{la:.7f}" lon="{lo:.7f}"/>\n')
        for wid, run, tags in ways:
            f.write(f'<way id="{wid}">')
            f.write("".join(f'<nd ref="{r}"/>' for r in run))
            f.write("".join(f'<tag k="{k}" v={su.quoteattr(str(v))}/>' for k, v in tags.items()))
            f.write("</way>\n")
        f.write("</osm>\n")
    G = ox.graph_from_xml(xml_path, simplify=False, retain_all=True)
    G = ox.truncate.truncate_graph_bbox(G, (w, s, e, n))
    G = ox.simplify_graph(G)
    G = ox.truncate.largest_component(G, strongly=False)
    out = out_graphml or config.GRAPH_FILE
    ox.save_graphml(G, out)
    print(f"  -> {out.name}: {len(G):,} nodes, {G.number_of_edges():,} edges ({time.time()-t:.0f}s)")


if __name__ == "__main__":
    build()

