// Re-downloads the OSM snapshot used by make-mock-scenario.mjs (network.json is built from it).
// Usage: npm run fetch:osm   (writes scripts/data/osm-atl-core.json)
// Boxes come from src/lib/geo.ts: STUDY_BBOX gets motorway..secondary roads, all rail, stations and
// the Beltline; CORE_BBOX additionally gets tertiary roads and the named corridor streets.
// The snapshot is committed so the mock is reproducible offline.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { STUDY_BBOX, CORE_BBOX } = await import(pathToFileURL(path.join(ROOT, "src/lib/geo.ts")).href);
const OUT = path.join(ROOT, "scripts/data/osm-atl-core.json");
const ov = (b) => `${b[1]},${b[0]},${b[3]},${b[2]}`; // south,west,north,east
const WIDE = ov(STUDY_BBOX);
const CORE = ov(CORE_BBOX);

const query = `
[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|motorway_link|trunk_link)$"](${WIDE});
  way["highway"="tertiary"](${CORE});
  way["highway"]["name"~"^(Edgewood Avenue|Auburn Avenue|Irwin Street|Krog Street|Jackson Street)"](${CORE});
  way["railway"~"^(subway|light_rail|tram|rail)$"](${WIDE});
  way["name"~"Beltline|BeltLine|Eastside Trail|Westside Trail|Northside Trail|Southside Trail"](${WIDE});
  node["railway"="station"](${WIDE});
  node["railway"="tram_stop"](${WIDE});
  node["public_transport"="station"](${WIDE});
  nwr["name"="Ponce City Market"](${CORE});
  nwr["aeroway"="terminal"](${WIDE});
  nwr["place"~"^(city|town|suburb|neighbourhood)$"]["name"~"^(Clarkston|Decatur|Avondale Estates|East Lake|Kirkwood|Druid Hills)$"](${WIDE});
  nwr["name"~"^(Emory University|Centers for Disease Control|Decatur Square|Clarkston City Hall)"](${WIDE});
);
out geom tags;
`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "whatif-atl-hackathon/0.1" },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const json = await res.json();
fs.writeFileSync(OUT, JSON.stringify(json));
console.log(`wrote ${OUT} (${json.elements.length} elements, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
