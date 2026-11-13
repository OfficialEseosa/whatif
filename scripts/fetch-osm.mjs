// Re-downloads the OSM snapshot used by make-mock-scenario.mjs.
// Usage: npm run fetch:osm   (writes scripts/data/osm-atl-core.json)
// The snapshot is committed so the mock is reproducible offline; only re-run
// this if you want fresher geometry or a different box.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts/data/osm-atl-core.json");
const BBOX = "33.73,-84.42,33.80,-84.33"; // south,west,north,east

const query = `
[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link)$"](${BBOX});
  way["highway"]["name"~"^(Edgewood Avenue|Auburn Avenue|Irwin Street|Krog Street|Jackson Street)"](${BBOX});
  way["railway"~"^(subway|light_rail|tram|rail)$"](${BBOX});
  way["name"~"Beltline|BeltLine|Eastside Trail|Westside Trail|Northside Trail|Southside Trail"](${BBOX});
  node["railway"="station"](${BBOX});
  node["railway"="tram_stop"](${BBOX});
  node["public_transport"="station"](${BBOX});
  nwr["name"="Ponce City Market"](${BBOX});
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
console.log(`wrote ${OUT} (${json.elements.length} elements)`);
