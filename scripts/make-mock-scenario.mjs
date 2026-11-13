// Deterministic mock generator (Raphael's lane).
//
//   npm run mock        -> public/scenarios/network.json + public/scenarios/beltline-streetcar.json
//
// Reads the committed OSM snapshot (scripts/data/osm-atl-core.json) and the
// gazetteer, routes ~3,000 display agents over the real road graph, invents
// plausible PLACEHOLDER numbers, and validates everything against
// src/lib/contract.ts before writing. Same seed => byte-identical output.
// Re-run it whenever the contract changes.
//
// Nothing here is a model result. Every number is a placeholder; isMock: true.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = await import(pathToFileURL(path.join(ROOT, "src/lib/contract.ts")).href);
const gazetteer = C.GazetteerSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/gazetteer.json"), "utf8")));
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/osm-atl-core.json"), "utf8")).elements;
const G = Object.fromEntries(gazetteer.map((p) => [p.id, p]));

/* ---------------- config ---------------- */
const SEED = 20261113;
const N_AGENTS = 3000;
const POPULATION = 249316; // placeholder "modeled commuters"
const SCALE = POPULATION / N_AGENTS;
// Agents and tract hexes live in the core; the network covers the whole study box (src/lib/geo.ts).
const { STUDY_BBOX, CORE_BBOX } = await import(pathToFileURL(path.join(ROOT, "src/lib/geo.ts")).href);
const BBOX = [...CORE_BBOX];
const HEADWAY_MIN = 10;
const LINE_KMH = 21;
const WALK_KMH = 4.8;
const CAPITAL_USD = 265e6; // placeholder
const OPEX_USD_YR = 8.5e6; // placeholder
const HOUSEHOLDS_FULTON_DEKALB = 720000; // placeholder

/* ---------------- utils ---------------- */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const gauss = () => {
  const u = 1 - rnd();
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = (weighted) => {
  const total = weighted.reduce((s, w) => s + w[1], 0);
  let r = rnd() * total;
  for (const [v, w] of weighted) if ((r -= w) <= 0) return v;
  return weighted[weighted.length - 1][0];
};
const KM_LNG = 92.57;
const KM_LAT = 111.0;
const km = (a, b) => Math.hypot((a[0] - b[0]) * KM_LNG, (a[1] - b[1]) * KM_LAT);
const r5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
function segDistKm(p, a, b) {
  const ax = a[0] * KM_LNG, ay = a[1] * KM_LAT, bx = b[0] * KM_LNG, by = b[1] * KM_LAT;
  const px = p[0] * KM_LNG, py = p[1] * KM_LAT;
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const pathDistKm = (p, pts) => {
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDistKm(p, pts[i], pts[i + 1]));
  return m;
};
/** Douglas-Peucker; returns kept indices. tol in km. */
function simplifyIdx(pts, tol) {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = -1, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDistKm(pts[i], pts[s], pts[e]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  const out = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}
const simplify = (pts, tol) => simplifyIdx(pts, tol).map((i) => pts[i]);
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const geom = (w) => (w.geometry || []).map((g) => [g.lon, g.lat]);

/* ---------------- network ---------------- */
const CLASS = { motorway: "motorway", trunk: "trunk", primary: "primary", secondary: "secondary", tertiary: "tertiary", motorway_link: "link", trunk_link: "link", primary_link: "link", secondary_link: "link", residential: "tertiary", unclassified: "tertiary" };
const SPEED_KMH = { motorway: 42, trunk: 28, primary: 20, secondary: 18, tertiary: 16, link: 24 }; // congested AM peak (placeholder)
const ways = osm.filter((e) => e.type === "way" && e.geometry);
const seenRoad = new Set();
const roadsFull = [];
for (const w of ways) {
  const t = w.tags || {};
  const cls = CLASS[t.highway];
  if (!cls || seenRoad.has(w.id)) continue;
  seenRoad.add(w.id);
  roadsFull.push({ id: `w${w.id}`, name: t.name || t.ref || "Unnamed road", class: cls, full: geom(w), lanes: parseInt(t.lanes, 10) || undefined, ref: t.ref });
}
roadsFull.sort((a, b) => a.id.localeCompare(b.id));
const roads = roadsFull.map((r) => ({ id: r.id, name: r.name, class: r.class, path: simplify(r.full, 0.004).map(r5), lanes: r.lanes, ref: r.ref }));

const railGroups = new Map();
for (const w of ways) {
  const t = w.tags || {};
  if (!t.railway || t.service) continue;
  let id, name, kind;
  if (t.railway === "subway" && /^MARTA /.test(t.name || "")) {
    name = t.name;
    id = "marta_" + slug(t.name.replace(/^MARTA /, "").replace(/ Line$/, ""));
    kind = "marta_heavy_rail";
  } else if (t.railway === "tram") {
    id = "atlanta_streetcar"; name = "Atlanta Streetcar"; kind = "streetcar";
  } else if (t.railway === "rail") {
    id = "freight"; name = "Freight rail (CSX / Norfolk Southern)"; kind = "freight";
  } else continue;
  if (!railGroups.has(id)) railGroups.set(id, { id, name, kind, paths: [], structures: [], layers: [] });
  const g = railGroups.get(id);
  g.paths.push(simplify(geom(w), 0.004).map(r5));
  g.structures.push(t.tunnel && t.tunnel !== "no" && t.tunnel !== "building_passage" ? "tunnel" : t.bridge && t.bridge !== "no" ? "bridge" : "grade");
  g.layers.push(parseInt(t.layer, 10) || 0);
}
const rail = [...railGroups.values()].sort((a, b) => a.id.localeCompare(b.id));

const stations = [];
const seenSt = new Set();
for (const e of osm) {
  if (e.type !== "node" || !e.tags?.name) continue;
  const kind = e.tags.railway === "station" ? "marta_station" : e.tags.railway === "tram_stop" ? "streetcar_stop" : null;
  if (!kind || (kind === "marta_station" && e.tags.name === "Atlanta")) continue;
  const id = `${kind === "marta_station" ? "st" : "sc"}_${slug(e.tags.name)}`;
  if (seenSt.has(id)) continue;
  seenSt.add(id);
  stations.push({ id, name: e.tags.name, kind, coord: r5([e.lon, e.lat]) });
}
stations.sort((a, b) => a.id.localeCompare(b.id));

const beltline = [];
for (const w of ways) {
  const t = w.tags || {};
  if (!/beltline/i.test(t.name || "") || !/Trail|Connector/.test(t.name) || !["cycleway", "footway", "path"].includes(t.highway)) continue;
  beltline.push({ id: `bl_${w.id}`, name: t.name, status: /Interim/i.test(t.name) ? "interim" : "open", path: simplify(geom(w), 0.003).map(r5) });
}
beltline.sort((a, b) => a.id.localeCompare(b.id));

const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n]];
const REDLINE = [
  ["sweet_auburn", "Sweet Auburn", box(-84.384, 33.752, -84.372, 33.759)],
  ["bedford_pine", "Bedford Pine / Old Fourth Ward", box(-84.377, 33.76, -84.368, 33.768)],
  ["reynoldstown", "Reynoldstown", box(-84.36, 33.744, -84.347, 33.752)],
  ["cabbagetown", "Cabbagetown", box(-84.366, 33.747, -84.36, 33.753)],
  ["summerhill", "Summerhill", box(-84.392, 33.733, -84.38, 33.744)],
  ["vine_city", "Vine City / English Avenue", box(-84.412, 33.752, -84.398, 33.766)],
];
const overlays = [
  ...REDLINE.map(([id, label, ring]) => ({ id: `redline_${id}`, overlay: "redline", geometry: { type: "polygon", ring }, label, grade: "D", placeholder: true })),
  { id: "renewal_buttermilk_bottom", overlay: "renewal", geometry: { type: "polygon", ring: box(-84.383, 33.762, -84.376, 33.768) }, label: "Buttermilk Bottom (Civic Center)", placeholder: true },
  { id: "renewal_summerhill", overlay: "renewal", geometry: { type: "polygon", ring: box(-84.392, 33.735, -84.384, 33.742) }, label: "Summerhill (stadium)", placeholder: true },
  ...roads.filter((r) => /^Moreland Avenue/.test(r.name)).map((r) => ({ id: `county_${r.id}`, overlay: "county", geometry: { type: "path", path: r.path }, label: "Fulton | DeKalb (approx.)", placeholder: true })),
  ...roads.filter((r) => r.class === "motorway").map((r) => ({ id: `hwy_${r.id}`, overlay: "highway", geometry: { type: "path", path: r.path }, label: r.name, placeholder: false })),
  ...beltline.map((b) => ({ id: `belt_${b.id}`, overlay: "beltline", geometry: { type: "path", path: b.path }, label: b.name, placeholder: false })),
];
const network = C.NetworkSchema.parse({
  version: "osm-2026-11-13",
  bbox: [...STUDY_BBOX],
  source: "OpenStreetMap contributors (ODbL), Overpass snapshot in scripts/data/osm-atl-core.json. Overlay polygons marked placeholder are hand-drawn stand-ins.",
  roads, rail, stations, beltline, overlays,
});

/* ---------------- road graph ---------------- */
const nodeIdx = new Map();
const coords = [];
const adj = [];
const edgeRoad = new Map();
const nid = (p) => {
  const k = `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  let i = nodeIdx.get(k);
  if (i === undefined) { i = coords.length; nodeIdx.set(k, i); coords.push(p); adj.push([]); }
  return i;
};
for (const r of roadsFull) {
  for (let i = 0; i < r.full.length - 1; i++) {
    const a = nid(r.full[i]), b = nid(r.full[i + 1]);
    if (a === b) continue;
    const sec = (km(r.full[i], r.full[i + 1]) / SPEED_KMH[r.class]) * 3600;
    adj[a].push([b, sec]); adj[b].push([a, sec]);
    edgeRoad.set(a < b ? `${a}_${b}` : `${b}_${a}`, r.id);
  }
}
// largest connected component
const comp = new Int32Array(coords.length).fill(-1);
let best = -1, bestSize = 0;
for (let s = 0, c = 0; s < coords.length; s++) {
  if (comp[s] >= 0) continue;
  const q = [s]; comp[s] = c; let n = 0;
  while (q.length) { const u = q.pop(); n++; for (const [v] of adj[u]) if (comp[v] < 0) { comp[v] = c; q.push(v); } }
  if (n > bestSize) { bestSize = n; best = c; }
  c++;
}
const CELL = 0.004;
const grid = new Map();
coords.forEach((p, i) => {
  if (comp[i] !== best) return;
  const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});
function nearestNode(p) {
  const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
  for (let rad = 1; rad < 12; rad++) {
    let bi = -1, bd = Infinity;
    for (let x = cx - rad; x <= cx + rad; x++) for (let y = cy - rad; y <= cy + rad; y++) {
      for (const i of grid.get(`${x},${y}`) || []) { const d = km(p, coords[i]); if (d < bd) { bd = d; bi = i; } }
    }
    if (bi >= 0) return bi;
  }
  throw new Error("no node near " + p);
}
function dijkstra(src, penalty) {
  const dist = new Float64Array(coords.length).fill(Infinity);
  const prev = new Int32Array(coords.length).fill(-1);
  dist[src] = 0;
  const heap = [[0, src]];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    for (const [v, sec] of adj[u]) {
      const rid = edgeRoad.get(u < v ? `${u}_${v}` : `${v}_${u}`);
      const nd = d + sec * (penalty.get(rid) || 1);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); }
    }
  }
  return { dist, prev };
}

/* ---------------- proposed line ---------------- */
const KHD = G.streetcar_king_historic_district.coord;
const edgewoodRoads = roadsFull.filter((r) => /^Edgewood Avenue/.test(r.name) && r.full.some((p) => p[0] > KHD[0] - 0.0005 && p[0] < G.beltline_edgewood.coord[0] + 0.0005));
const edgewoodIds = edgewoodRoads.map((r) => r.id);
const binAvg = (pts, keyIdx, step) => {
  const bins = new Map();
  for (const p of pts) { const k = Math.round(p[keyIdx] / step); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(p); }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, ps]) => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length]);
};
const edgePts = edgewoodRoads.flatMap((r) => r.full).filter((p) => p[0] > KHD[0] + 0.0003 && p[0] < G.beltline_edgewood.coord[0] - 0.0003);
const trailPts = ways.filter((w) => /Eastside Trail/.test(w.tags?.name || "")).flatMap(geom).filter((p) => p[1] > G.beltline_edgewood.coord[1] + 0.0002 && p[1] < G.beltline_ponce.coord[1] - 0.0002);
const linePath = [KHD, ...binAvg(edgePts, 0, 0.0006), G.beltline_edgewood.coord, ...binAvg(trailPts, 1, 0.0004), G.beltline_ponce.coord, G.ponce_city_market.coord].map(r5);
const STOP_IDS = ["streetcar_king_historic_district", "beltline_edgewood", "beltline_irwin", "beltline_freedom_pkwy", "beltline_north_ave", "ponce_city_market"];
const lineStops = STOP_IDS.map((id) => ({ gazetteerId: id, name: G[id].name, coord: G[id].coord }));
const NEW_STOPS = lineStops.slice(1);
const lineCum = [0];
for (let i = 1; i < linePath.length; i++) lineCum.push(lineCum[i - 1] + km(linePath[i - 1], linePath[i]));
const nearestLineIdx = (p) => { let bi = 0, bd = Infinity; linePath.forEach((q, i) => { const d = km(p, q); if (d < bd) { bd = d; bi = i; } }); return bi; };
const stopIdx = lineStops.map((s) => nearestLineIdx(s.coord));

const edit = C.ScenarioEditSchema.parse({
  type: "extend_line",
  name: "Streetcar East to Ponce City Market",
  stops: lineStops,
  corridor: ["edgewood_ave", "beltline_eastside"],
  baseLineId: "atlanta_streetcar",
  tech: "streetcar",
  headwayMin: HEADWAY_MIN,
  roadIds: edgewoodIds,
  lanesRemoved: 1,
  assumptions: ["Runs in a shared lane on Edgewood Ave, taking one car lane east of the existing loop", "Runs in its own right-of-way along the Eastside Trail", "Peak headway 10 minutes"],
});

/* ---------------- work hubs + routing trees ---------------- */
const HUBS = [
  ["peachtree_center_station", 0.13], ["five_points_station", 0.11], ["north_avenue_station", 0.1], ["midtown", 0.08],
  ["georgia_tech", 0.09], ["grady_memorial", 0.07], ["georgia_state_station", 0.06], ["civic_center_station", 0.05],
  ["ponce_city_market", 0.07], ["krog_street_market", 0.03], ["mercedes_benz_stadium", 0.03],
  ["__west", 0.07], ["__north", 0.05], ["__east", 0.04],
].map(([id, w]) => {
  const coord = id === "__west" ? [-84.4185, 33.7555] : id === "__north" ? [-84.3905, 33.7985] : id === "__east" ? [-84.3315, 33.7615] : G[id].coord;
  const label = id === "__west" ? "a job west of the box" : id === "__north" ? "a job up I-75/85" : id === "__east" ? "a job in Decatur" : G[id].name;
  return { id, coord, label, w, node: nearestNode(coord) };
});
const PENALTY_BASE = new Map();
const PENALTY_PROP = new Map();
const SPILL_RE = /^(John Lewis Freedom Parkway|North Avenue|Auburn Avenue|Decatur Street|Highland Avenue)/;
const PONCE_RE = /^Ponce de Leon Avenue/;
for (const r of roadsFull) {
  if (edgewoodIds.includes(r.id)) PENALTY_PROP.set(r.id, 1.3);
  else if (SPILL_RE.test(r.name)) PENALTY_PROP.set(r.id, 1.08);
  else if (PONCE_RE.test(r.name)) PENALTY_PROP.set(r.id, 0.98);
}
const treesBase = HUBS.map((h) => dijkstra(h.node, PENALTY_BASE));
const treesProp = HUBS.map((h) => dijkstra(h.node, PENALTY_PROP));

/** Road leg from node `from` to hub `h` along the shortest-path tree; returns pts, per-step seconds, road ids. */
function roadLeg(tree, from, speedFactor, penalty) {
  const pts = [coords[from]], secs = [0], ids = [];
  let u = from;
  while (tree.prev[u] >= 0) {
    const v = tree.prev[u];
    const rid = edgeRoad.get(u < v ? `${u}_${v}` : `${v}_${u}`);
    const base = adj[u].find((e) => e[0] === v)[1];
    pts.push(coords[v]); secs.push((base * (penalty.get(rid) || 1)) / speedFactor);
    if (ids[ids.length - 1] !== rid) ids.push(rid);
    u = v;
  }
  return { pts, secs, ids };
}

/** Builds a Trip from segments [{pts, secs}] (secs[i] = seconds to reach pts[i] from pts[i-1]). */
function makeTrip(mode, depart, segs, extraMin = 0, lines) {
  const pts = [], ts = [];
  let t = depart;
  for (const s of segs) for (let i = 0; i < s.pts.length; i++) {
    t += s.secs[i];
    if (pts.length && i === 0 && km(pts[pts.length - 1], s.pts[0]) < 1e-6 && s.secs[0] === 0) continue;
    pts.push(s.pts[i]); ts.push(t);
  }
  const keep = simplifyIdx(pts, 0.012);
  const path = keep.map((i) => r5(pts[i]));
  const timestamps = keep.map((i) => Math.round(ts[i]));
  for (let i = 1; i < timestamps.length; i++) timestamps[i] = Math.max(timestamps[i], timestamps[i - 1]);
  if (path.length < 2) { path.push(path[0]); timestamps.push(timestamps[0] + 60); }
  return { mode, minutes: round((t - depart) / 60 + extraMin, 1), path, timestamps, ...(lines ? { lines } : {}) };
}
const walkSeg = (a, b) => ({ pts: [a, b], secs: [0, (km(a, b) / WALK_KMH) * 3600] });
const waitSeg = (p, min) => ({ pts: [p], secs: [min * 60] });
const MARTA = stations.filter((s) => s.kind === "marta_station");
const nearestOf = (p, list) => list.reduce((b, s) => (km(p, s.coord) < km(p, b.coord) ? s : b));

function lineSegment(i0, i1) {
  const idx = [];
  if (i0 <= i1) for (let i = i0; i <= i1; i++) idx.push(i); else for (let i = i0; i >= i1; i--) idx.push(i);
  const pts = idx.map((i) => linePath[i]);
  const secs = pts.map((p, k) => (k === 0 ? 0 : (km(pts[k - 1], p) / LINE_KMH) * 3600));
  return { pts, secs };
}

/* ---------------- tracts (hex placeholders) ---------------- */
const HEX_KM = 0.45;
const tracts = [];
{
  const dx = (Math.sqrt(3) * HEX_KM) / KM_LNG, dy = (1.5 * HEX_KM) / KM_LAT;
  let n = 0;
  for (let row = 0, y = BBOX[1]; y <= BBOX[3] + dy; row++, y += dy) {
    for (let x = BBOX[0] + (row % 2 ? dx / 2 : 0); x <= BBOX[2] + dx; x += dx) {
      const c = [x, y];
      const ring = [];
      for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (60 * k - 30); ring.push(r5([x + (HEX_KM * Math.cos(a)) / KM_LNG, y + (HEX_KM * Math.sin(a)) / KM_LAT])); }
      const redlined = REDLINE.some(([, , r]) => pointInRing(c, r));
      const nearStop = Math.min(...NEW_STOPS.map((s) => km(c, s.coord)));
      const renterShare = clamp(0.42 + (redlined ? 0.15 : 0) + gauss() * 0.12, 0.15, 0.9);
      tracts.push({ id: `mock_tract_${String(++n).padStart(3, "0")}`, centroid: r5(c), polygon: ring, minutesDelta: 0, redlined, rentPressure: nearStop < 0.8 && renterShare > 0.48, renterShare: round(renterShare, 2), households: Math.round(700 + rnd() * 1700) });
    }
  }
}
const tractOf = (p) => tracts.reduce((b, t) => (km(p, t.centroid) < km(p, b.centroid) ? t : b));

/* ---------------- agents ---------------- */
const HOODS = [
  ["Old Fourth Ward", [-84.37, 33.763], 0.12, 0.35], ["Inman Park", [-84.358, 33.759], 0.07, 0.15], ["Reynoldstown", [-84.352, 33.7495], 0.07, 0.4],
  ["Cabbagetown", [-84.362, 33.75], 0.04, 0.3], ["Sweet Auburn", [-84.379, 33.755], 0.05, 0.5], ["Poncey-Highland", [-84.356, 33.772], 0.06, 0.2],
  ["Virginia-Highland", [-84.354, 33.783], 0.06, 0.1], ["Midtown", [-84.384, 33.781], 0.1, 0.15], ["Home Park", [-84.401, 33.786], 0.04, 0.3],
  ["English Avenue", [-84.407, 33.761], 0.06, 0.6], ["West End", [-84.413, 33.74], 0.05, 0.55], ["Grant Park", [-84.37, 33.738], 0.07, 0.25],
  ["Summerhill", [-84.386, 33.738], 0.04, 0.5], ["Downtown", [-84.389, 33.757], 0.05, 0.4], ["Little Five Points", [-84.349, 33.765], 0.04, 0.2],
];
const hoodName = (p) => HOODS.reduce((b, h) => (km(p, h[1]) < km(p, b[1]) ? h : b))[0];
const agents = [];
for (let i = 0; i < N_AGENTS; i++) {
  let home, lowBias;
  if (rnd() < 0.08) { home = [BBOX[0] + 0.005 + rnd() * 0.08, BBOX[1] + 0.005 + rnd() * 0.06]; lowBias = 0.3; }
  else { const h = pick(HOODS.map((h) => [h, h[2]])); home = [h[1][0] + gauss() * 0.0045, h[1][1] + gauss() * 0.0038]; lowBias = h[3]; }
  home = [clamp(home[0], BBOX[0] + 0.002, BBOX[2] - 0.002), clamp(home[1], BBOX[1] + 0.002, BBOX[3] - 0.002)];
  const earningsBand = rnd() < lowBias ? "low" : rnd() < 0.55 ? "mid" : "high";
  const renter = rnd() < (earningsBand === "low" ? 0.8 : earningsBand === "mid" ? 0.6 : 0.4);
  const hasCar = rnd() < (earningsBand === "low" ? 0.68 : earningsBand === "mid" ? 0.88 : 0.96);
  let hi = HUBS.indexOf(pick(HUBS.map((h) => [h, h.w])));
  if (km(home, HUBS[hi].coord) < 0.6) hi = (hi + 1) % HUBS.length;
  const hub = HUBS[hi];
  const work = r5([hub.coord[0] + gauss() * 0.002, hub.coord[1] + gauss() * 0.0017]);
  const homeNode = nearestNode(home);
  const depart = Math.round(clamp(6900 + gauss() * 2300, 900, 11800));

  // --- baseline
  const sHome = nearestOf(home, MARTA), sWork = nearestOf(work, MARTA);
  const railOk = sHome.id !== sWork.id && km(home, sHome.coord) < 0.9 && km(work, sWork.coord) < 0.8;
  const transitBase = !hasCar ? rnd() < 0.9 : rnd() < (railOk ? 0.38 : 0.1);
  const driveLegB = roadLeg(treesBase[hi], homeNode, 1, PENALTY_BASE);
  const parkMin = hub.id.startsWith("__") ? 2 : ["peachtree_center_station", "five_points_station", "georgia_state_station", "grady_memorial", "civic_center_station", "georgia_tech"].includes(hub.id) ? 9 : 5;
  let baseline;
  if (!transitBase) {
    baseline = makeTrip("drive", depart, [{ pts: [home], secs: [0] }, { pts: driveLegB.pts, secs: driveLegB.secs.map((s, k) => (k === 0 ? 60 : s)) }, walkSeg(coords[hub.node], work)], parkMin);
  } else if (railOk) {
    baseline = makeTrip("transit", depart, [walkSeg(home, sHome.coord), waitSeg(sHome.coord, 4), { pts: [sHome.coord, sWork.coord], secs: [0, (km(sHome.coord, sWork.coord) / 32) * 3600] }, walkSeg(sWork.coord, work)], 0, ["marta"]);
  } else {
    baseline = makeTrip("transit", depart, [walkSeg(home, coords[homeNode]), waitSeg(coords[homeNode], 9), { pts: driveLegB.pts, secs: driveLegB.secs.map((s) => s / 0.45) }, walkSeg(coords[hub.node], work)], 0, ["bus"]);
  }

  // --- proposed
  const driveLegP = roadLeg(treesProp[hi], homeNode, 1, PENALTY_PROP);
  const driveP = makeTrip("drive", depart, [{ pts: [home], secs: [0] }, { pts: driveLegP.pts, secs: driveLegP.secs.map((s, k) => (k === 0 ? 60 : s)) }, walkSeg(coords[hub.node], work)], parkMin);
  let proposed = baseline.mode === "drive" ? driveP : baseline;
  const board = NEW_STOPS.reduce((b, s) => (km(home, s.coord) < km(home, b.coord) ? s : b));
  if (km(home, board.coord) < 0.9 && !hub.id.startsWith("__")) {
    const bi = stopIdx[lineStops.indexOf(board)];
    const alightStop = lineStops.reduce((b, s) => (km(work, s.coord) < km(work, b.coord) ? s : b));
    const ai = stopIdx[lineStops.indexOf(alightStop)];
    const segs = [walkSeg(home, board.coord), waitSeg(board.coord, HEADWAY_MIN / 2)];
    if (km(work, alightStop.coord) < 0.7 && ai !== bi) {
      segs.push(lineSegment(bi, ai), walkSeg(alightStop.coord, work));
    } else if (bi !== 0) {
      // ride to the existing loop, transfer, continue on the streetcar/bus toward work
      const khdNode = nearestNode(KHD);
      const leg = roadLeg(treesProp[hi], khdNode, 0.9, PENALTY_PROP);
      segs.push(lineSegment(bi, 0), waitSeg(KHD, 3), { pts: leg.pts, secs: leg.secs }, walkSeg(coords[hub.node], work));
    }
    if (segs.length > 2) {
      const lineTrip = makeTrip("transit", depart, segs, 0, ["proposed", "atlanta_streetcar"]);
      const switches = baseline.mode === "drive" ? lineTrip.minutes <= baseline.minutes + 2 && rnd() < (renter ? 0.6 : 0.45) : lineTrip.minutes < baseline.minutes + 1 && rnd() < 0.92;
      if (switches) { proposed = lineTrip; }
    }
  }

  const minutesDelta = round(proposed.minutes - baseline.minutes, 1);
  const tract = tractOf(home);
  const rentPressure = renter && tract.rentPressure;
  const noiseZone = pathDistKm(home, linePath) < 0.15;
  const costShareUsdYr = round((CAPITAL_USD / 20 + OPEX_USD_YR) / HOUSEHOLDS_FULTON_DEKALB, 2);
  const supportScore = round(clamp(-minutesDelta * 0.09 - (rentPressure ? 0.45 : 0) - (noiseZone ? 0.15 : 0) - 0.05 + gauss() * 0.18 + (proposed.lines?.includes("proposed") ? 0.25 : 0), -1, 1), 2);
  let displacementRisk = "none";
  if (rentPressure && earningsBand !== "high") { const q = rnd(); displacementRisk = q < 0.35 ? "year5" : q < 0.7 ? "year10" : "none"; }
  agents.push({
    id: `a${String(i).padStart(4, "0")}`, home: r5(home), work, tractId: tract.id, earningsBand, renter, hasCar,
    baseline, proposed, stake: { minutesDelta, rentPressure, noiseZone, costShareUsdYr, supportScore }, displacementRisk,
    _hood: hoodName(home), _hub: hub.label, _edgewood: driveLegB.ids.some((id) => edgewoodIds.includes(id)) && baseline.mode === "drive",
    _roadsB: baseline.mode === "drive" ? driveLegB.ids : [], _roadsP: proposed.mode === "drive" ? driveLegP.ids : [],
  });
}

/* ---------------- aggregates ---------------- */
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
for (const t of tracts) {
  const here = agents.filter((a) => a.tractId === t.id);
  t.minutesDelta = round(mean(here.map((a) => a.stake.minutesDelta)), 2);
}
const isTransit = (trip) => trip.mode !== "drive";
const metricsOf = (key) => ({
  avgCommuteMin: round(mean(agents.map((a) => a[key].minutes)), 1),
  transitShare: round(agents.filter((a) => isTransit(a[key])).length / agents.length, 3),
  dailyTransitRiders: Math.round(agents.filter((a) => isTransit(a[key])).length * SCALE),
  populationModeled: POPULATION,
  displaySampleSize: N_AGENTS,
});
const switchers = agents.filter((a) => a.proposed.lines?.includes("proposed"));
const newRiders = switchers.filter((a) => a.baseline.mode === "drive");
const gains = agents.filter((a) => a.stake.minutesDelta < 0);
const totalSavedMin = -agents.reduce((s, a) => s + a.stake.minutesDelta, 0) * SCALE;
const gainedMin = -gains.reduce((s, a) => s + a.stake.minutesDelta, 0);
const redlinedTracts = new Set(tracts.filter((t) => t.redlined).map((t) => t.id));
const redlinedShare = gainedMin ? -gains.filter((a) => redlinedTracts.has(a.tractId)).reduce((s, a) => s + a.stake.minutesDelta, 0) / gainedMin : 0;
const pressureHouseholds = Math.round(tracts.filter((t) => t.rentPressure).reduce((s, t) => s + t.households * t.renterShare, 0));
// The display sample over-weights corridor homes, so scale line riders down (placeholder factor).
const CORRIDOR_OVERSAMPLE = 0.5;
const lineDailyRiders = Math.round(switchers.length * SCALE * CORRIDOR_OVERSAMPLE);
const costPerRider = (CAPITAL_USD / 20 + OPEX_USD_YR) / (Math.max(1, lineDailyRiders) * 255);
const timeSavedHrs = Math.round(totalSavedMin / 60);
const newRidersDay = Math.round(newRiders.length * SCALE);

const tests = [
  { key: "time_saved", label: "Time saved", sublabel: "Net, all modeled commuters, per weekday", value: timeSavedHrs, unit: "hrs/day", grade: timeSavedHrs > 1000 ? "good" : timeSavedHrs > 250 ? "fair" : "poor" },
  { key: "new_riders", label: "New transit riders", sublabel: "Commuters who switch from driving", value: newRidersDay, unit: "riders/day", grade: newRidersDay > 5000 ? "good" : newRidersDay > 1500 ? "fair" : "poor" },
  { key: "cost_per_rider", label: "Cost per trip on the line", sublabel: "20-year capital + operating, estimated", value: round(costPerRider, 2), unit: "usd/trip", grade: costPerRider < 4 ? "good" : costPerRider < 9 ? "fair" : "poor" },
  { key: "redlined_benefit_share", label: "Benefit to formerly redlined tracts", sublabel: "Share of minutes saved", value: round(redlinedShare, 3), unit: "share", grade: redlinedShare > 0.35 ? "good" : redlinedShare > 0.15 ? "fair" : "poor" },
  { key: "renters_rent_pressure", label: "Renters under rent pressure", sublabel: "Renter households near new stops", value: pressureHouseholds, unit: "households", grade: pressureHouseholds < 1000 ? "good" : pressureHouseholds < 2500 ? "fair" : "poor" },
];

const corridor = agents.filter((a) => pathDistKm(a.home, linePath) < 1.2);
const split = (key) => {
  const n = corridor.length || 1;
  const c = (m) => round(corridor.filter((a) => a[key].mode === m).length / n, 3);
  return { drive: c("drive"), transit: c("transit"), park_ride: c("park_ride") };
};
const edgeDrivers = agents.filter((a) => a._edgewood && a.proposed.mode === "drive");
const support = agents.filter((a) => a.stake.supportScore > 0).length / agents.length;
const bandLabel = { low: "≤ $1,250/mo", mid: "$1,251–3,333/mo", high: "> $3,333/mo" };

const usageB = new Map(), usageP = new Map();
for (const a of agents) { for (const id of a._roadsB) usageB.set(id, (usageB.get(id) || 0) + 1); for (const id of a._roadsP) usageP.set(id, (usageP.get(id) || 0) + 1); }
const maxUse = Math.max(...usageB.values());
const roadEffects = roadsFull.map((r) => {
  const ub = usageB.get(r.id) || 0, up = usageP.get(r.id) || 0;
  const vcB = round(clamp(0.3 + rnd() * 0.35 + (ub / maxUse) * 0.6, 0.05, 1.4), 2);
  const pen = PENALTY_PROP.get(r.id) || 1;
  const vcP = round(clamp(vcB * (ub ? (0.7 + 0.3 * (up / ub)) : 1) * (pen > 1.2 ? 1.25 : pen), 0.05, 1.6), 2);
  const lenKm = r.full.slice(1).reduce((s, p, k) => s + km(r.full[k], p), 0);
  const delay = round((lenKm / SPEED_KMH[r.class]) * 60 * (pen - 1) + (vcP - vcB) * 0.5, 2);
  return { roadId: r.id, vcBaseline: vcB, vcProposed: vcP, delayDeltaMin: delay };
});

const noiseHouseholds = Math.round(agents.filter((a) => a.stake.noiseZone).length * SCALE / 1.35);
const edgeDelta = round(mean(edgeDrivers.map((a) => a.stake.minutesDelta)), 1);
const spillDelta = round(mean(agents.filter((a) => a._roadsP.some((id) => SPILL_RE.test(roadsFull.find((r) => r.id === id)?.name || "")) && !a._edgewood && a.proposed.mode === "drive").map((a) => a.stake.minutesDelta)), 1);
const costShare = agents[0].stake.costShareUsdYr;
const ponceVol = -2, edgewoodVol = 11; // placeholder % volume changes

/* ---------------- personas ---------------- */
const used = new Set();
const choose = (pred, score) => { const c = agents.filter((a) => !used.has(a.id) && pred(a)).sort((x, y) => score(x) - score(y) || x.id.localeCompare(y.id))[0]; if (c) used.add(c.id); return c; };
const chips = (a) => [`${Math.round(a.baseline.minutes)} → ${Math.round(a.proposed.minutes)} min`, a.renter ? "renter" : "owner", ...(a.stake.rentPressure ? ["rent pressure"] : []), ...(a.stake.noiseZone ? ["noise zone"] : []), ...(a.hasCar ? [] : ["no car"])];
const PERSONA_SPECS = [
  ["tasha", "Tasha", 33, (a) => a.renter && !a.stake.rentPressure && a.proposed.lines?.includes("proposed"), (a) => a.stake.minutesDelta, "for"],
  ["kevin", "Kevin", 57, (a) => a.stake.rentPressure && Math.abs(a.stake.minutesDelta) < 0.5, (a) => -a.tractId.localeCompare("z"), "against"],
  ["elena", "Elena", 44, (a) => a._edgewood && a.proposed.mode === "drive", (a) => -a.stake.minutesDelta, "against"],
  ["andre", "Andre", 24, (a) => !a.hasCar && a.proposed.lines?.includes("proposed"), (a) => a.stake.minutesDelta, "for"],
  ["ruth", "Ruth", 69, (a) => !a.renter && a.stake.noiseZone, (a) => Math.abs(a.stake.minutesDelta), "mixed"],
  ["miguel", "Miguel", 38, (a) => a.stake.minutesDelta === 0 && pathDistKm(a.home, linePath) > 3, (a) => -pathDistKm(a.home, linePath), "against"],
];
const personas = PERSONA_SPECS.map(([id, name, age, pred, score, stance]) => {
  const a = choose(pred, score) || choose(() => true, () => 0);
  const b = Math.round(a.baseline.minutes), p = Math.round(a.proposed.minutes);
  const where = `${a.renter ? "renter" : "homeowner"} in ${a._hood}`;
  const quote = {
    for: `My trip to ${a._hub} goes from ${b} to ${p} minutes. That's real time back every morning.`,
    against: a._edgewood ? `They take a lane on Edgewood and my drive goes from ${b} to ${p} minutes.` : a.stake.rentPressure ? `It barely changes my commute, and it puts my block right next to a new stop. I rent.` : `My commute stays ${b} minutes and I still pay about $${Math.round(costShare)} a year for it.`,
    mixed: `Construction outside my door for two years, but the stop would be a short walk.`,
  }[stance];
  return {
    id, name, age, descriptor: `Commutes to ${a._hub} · ${where}`, stance, quote, stakeChips: chips(a), tractId: a.tractId, agentId: a.id, home: a.home,
    cannedReplies: [
      `By the model's numbers my commute is ${b} minutes today and ${p} minutes with the line.`,
      a.stake.rentPressure ? "I'm inside the rent-pressure zone. That's the part that worries me most." : "My block isn't in the rent-pressure zone, so rent isn't my main worry.",
      a.stake.noiseZone ? "I'm within 150 meters of the new track, so I'd live with the construction." : "I'm not near the construction zone.",
      `I'd pay about $${Math.round(costShare)} a year toward it either way.`,
    ],
  };
});

/* ---------------- claims ---------------- */
const ridersLo = Math.round((lineDailyRiders * 0.85) / 100) * 100, ridersHi = Math.round((lineDailyRiders * 1.15) / 100) * 100;
const claims = [
  { id: "c1", quote: "could carry 10,000 riders a day", metric: "daily_riders", claimedValue: 10000, claimed: "10,000 riders/day", measured: `${ridersLo.toLocaleString("en-US")}–${ridersHi.toLocaleString("en-US")} riders/day (model)`, rating: 10000 > ridersHi * 1.2 ? "overstated" : 10000 < ridersLo * 0.8 ? "understated" : "accurate" },
  { id: "c2", quote: "for about $190 million", metric: "capital_cost_usd", claimedValue: 190e6, claimed: "$190M to build", measured: "$240M–$310M from per-mile benchmarks of recent US streetcar projects (placeholder)", rating: "understated" },
  { id: "c3", quote: "take cars off Ponce", metric: "traffic", claimed: "Less traffic on Ponce de Leon Ave", measured: `Ponce peak volume ${ponceVol}%, Edgewood Ave +${edgewoodVol}% (placeholder)`, rating: "partly" },
];

/* ---------------- assemble ---------------- */
const baseM = metricsOf("baseline"), propM = metricsOf("proposed");
const scenario = {
  id: "beltline-streetcar",
  contractVersion: C.CONTRACT_VERSION,
  title: edit.name,
  edit,
  isMock: true,
  source: "mock",
  generatedAt: "2026-11-13T00:00:00.000Z",
  timeWindow: { startSec: 0, endSec: 14400 },
  line: { path: linePath, stops: lineStops },
  networkUrl: "/scenarios/network.json",
  metrics: { baseline: baseM, proposed: propM },
  verdict: {
    label: "mixed",
    headline: "Faster trips along the Eastside, with the risk landing on renters near the new stops.",
    summary: `${switchers.length} of ${N_AGENTS} sampled commuters move onto the line. Edgewood Ave drivers lose a lane and average ${edgeDelta > 0 ? "+" : ""}${edgeDelta} min. About ${pressureHouseholds.toLocaleString("en-US")} renter households sit in rent-pressure tracts near the new stops. All placeholder numbers.`,
    tests,
    alternatives: [
      { id: "alt_frequency", title: "Run the existing streetcar loop every 8 minutes, with signal priority", detail: "No lane removed and no new rent-pressure zone; smaller time savings.", highlights: ["no lane removed", "about $20M", "nobody slower"], edit: { type: "change_frequency", name: "Streetcar loop every 8 minutes", stops: [], baseLineId: "atlanta_streetcar", headwayMin: 8 } },
      { id: "alt_brt_ponce", title: "Bus rapid transit on Ponce de Leon Ave, plus an affordable-housing set-aside", detail: "More riders per dollar; Ponce drivers pay with a lane.", highlights: ["more riders per dollar", "Ponce drivers slower"], edit: { type: "brt_lane", name: "BRT on Ponce de Leon Ave", stops: ["north_avenue_station", "ponce_city_market", "little_five_points"].map((id) => ({ gazetteerId: id, name: G[id].name, coord: G[id].coord })), corridor: ["ponce_de_leon_ave"], tech: "brt", headwayMin: 8, lanesRemoved: 1 } },
      { id: "alt_westside", title: "Extend west toward the Westside Beltline instead", detail: "Sends a larger share of the benefit to formerly redlined tracts.", highlights: ["higher redlined-benefit share", "similar cost"] },
    ],
  },
  impact: {
    tiles: [
      { key: "switcher_minutes", label: "min per trip for people who switch to the line", value: round(mean(switchers.map((a) => a.stake.minutesDelta)), 1), unit: "min", tone: "gain" },
      { key: "edgewood_minutes", label: "min per trip for Edgewood Ave drivers", value: edgeDelta, unit: "min", tone: "loss" },
      { key: "corridor_transit_share", label: "transit share in corridor tracts", value: round((split("proposed").transit - split("baseline").transit) * 100, 1), unit: "pts", tone: "gain" },
      { key: "support", label: "of sampled residents support it", value: round(support, 2), unit: "share", tone: "neutral" },
    ],
    modeSplit: { before: split("baseline"), after: split("proposed"), scope: "Commuters living within 1.2 km of the line" },
    minutesSavedByEarnings: ["low", "mid", "high"].map((band) => ({ band, label: bandLabel[band], minutesSaved: round(-mean(corridor.filter((a) => a.earningsBand === band).map((a) => a.stake.minutesDelta)), 2) })),
    calibration: [
      { key: "routes_r2", label: "r²", value: 0.8, unit: "r2", detail: "Model drive times vs. Google Routes, 200 trips (placeholder until calibration runs)" },
      { key: "acs_share_err", label: "± pts", value: 4, unit: "pts", detail: "Tract transit share vs. ACS B08301 after calibration (placeholder)" },
    ],
    notes: ["Earnings bands are LODES bands; the lowest includes many part-time workers."],
  },
  agents: agents.map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith("_")))),
  roads: roadEffects,
  tracts,
  whoPays: {
    items: [
      { key: "edgewood_drivers", label: "Edgewood Ave drivers", value: edgeDelta, unit: "min", detail: `The line takes a lane on Edgewood. About ${Math.round(edgeDrivers.length * SCALE).toLocaleString("en-US")} peak trips slow down.`, zone: "spillover", roadIds: edgewoodIds },
      { key: "spillover", label: "Freedom Pkwy, North Ave and Auburn Ave", value: spillDelta, unit: "min", detail: "Spillover traffic avoiding Edgewood.", zone: "spillover" },
      { key: "rent_pressure", label: "Renters near the new stops", value: pressureHouseholds, unit: "households", detail: "High renter share within 800 m of a new stop. A risk flag, not a forecast.", zone: "rent_pressure" },
      { key: "noise", label: "Noise and construction zone", value: noiseHouseholds, unit: "households", detail: "Households within 150 m of new track during roughly two years of construction.", zone: "noise_construction" },
      { key: "regional_cost", label: "Every household in Fulton and DeKalb", value: costShare, unit: "usd/yr", detail: "20-year cost split across all households, including people who gain nothing.", zone: "regional_cost" },
    ],
    approval: { support: round(support, 3), oppose: round(1 - support, 3), basis: N_AGENTS, note: "Share of sampled stake scores above zero." },
  },
  claims,
  personas,
  lookahead: {
    year5: { householdsAtRisk: { low: Math.round(pressureHouseholds * 0.18), high: Math.round(pressureHouseholds * 0.3) }, note: "Proxy: renter households in rent-pressure tracts × Beltline-era price-change rate. Counts households at risk, not moves." },
    year10: { householdsAtRisk: { low: Math.round(pressureHouseholds * 0.34), high: Math.round(pressureHouseholds * 0.52) }, note: "Same proxy, ten years out. Wider range, lower confidence." },
    lastTime: {
      title: "What happened along the Eastside Trail",
      period: "2010–2020",
      stats: [
        { label: "Median rent change", value: "TBD", source: "ACS B25064, 2010 vs 2020", verified: false },
        { label: "Cost-burdened renters", value: "TBD", source: "ACS B25070", verified: false },
        { label: "Home value change near the trail", value: "TBD", source: "Immergluck & Balan (2018)", verified: false },
      ],
      note: "Team fills these from real data before the demo.",
    },
  },
};

const parsed = C.ScenarioResultSchema.parse(scenario);
const outDir = path.join(ROOT, "public/scenarios");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "network.json"), JSON.stringify(network));
fs.writeFileSync(path.join(outDir, "beltline-streetcar.json"), JSON.stringify(parsed));
const size = (f) => (fs.statSync(path.join(outDir, f)).size / 1e6).toFixed(2) + " MB";
console.log(`network.json ${size("network.json")}: ${roads.length} roads, ${rail.length} rail lines, ${stations.length} stations, ${beltline.length} beltline segments, ${overlays.length} overlay features`);
console.log(`beltline-streetcar.json ${size("beltline-streetcar.json")}: ${agents.length} agents, ${switchers.length} switch to the line (${newRiders.length} were drivers), ${edgeDrivers.length} Edgewood drivers, ${tracts.length} tracts`);
console.log("tests:", tests.map((t) => `${t.key}=${t.value} (${t.grade})`).join(", "));
console.log(`line: ${linePath.length} vertices, ${lineCum[lineCum.length - 1].toFixed(2)} km; personas: ${personas.map((p) => p.name).join(", ")}`);
