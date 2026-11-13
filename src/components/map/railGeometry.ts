/**
 * Turns the network's fragmented rail ways into continuous chains with per-vertex structure,
 * for running vehicles along them and drawing tunnels/bridges. Pure functions; memoize per network.
 */
import type { LngLat, Network, RailKind } from "@/lib/contract";

export type Structure = "tunnel" | "bridge" | "grade";
export type ChainVertex = { p: LngLat; z: number; structure: Structure; km: number };
export type RailChain = { lineId: string; kind: RailKind; vertices: ChainVertex[]; lengthKm: number };

const KM_LNG = 92.57;
const KM_LAT = 111.0;
const dist = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * KM_LNG, (a[1] - b[1]) * KM_LAT);
const key = (p: LngLat) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

/** Approximate depth/height in meters from the OSM structure + layer tags (placeholder, not surveyed). */
export function structureZ(structure: Structure, layer: number): number {
  if (structure === "tunnel") return -15 * Math.max(1, Math.abs(layer || 1));
  if (structure === "bridge") return 7 * Math.max(1, layer || 1);
  return 0;
}

export function buildRailChains(network: Network): RailChain[] {
  const chains: RailChain[] = [];
  for (const line of network.rail) {
    if (line.kind === "freight") continue;
    const segs = line.paths.map((path, i) => ({
      path,
      structure: (line.structures?.[i] ?? "grade") as Structure,
      z: structureZ((line.structures?.[i] ?? "grade") as Structure, line.layers?.[i] ?? 0),
    }));
    const byEnd = new Map<string, number[]>();
    segs.forEach((s, i) => {
      for (const p of [s.path[0], s.path[s.path.length - 1]]) {
        const k = key(p);
        byEnd.set(k, [...(byEnd.get(k) ?? []), i]);
      }
    });
    const used = new Uint8Array(segs.length);
    const degree = (p: LngLat) => (byEnd.get(key(p)) ?? []).length;
    // start from terminal ends first so chains are as long as possible
    const order = segs.map((_, i) => i).sort((a, b) => Math.min(degree(segs[a].path[0]), degree(segs[a].path.at(-1)!)) - Math.min(degree(segs[b].path[0]), degree(segs[b].path.at(-1)!)));
    for (const start of order) {
      if (used[start]) continue;
      used[start] = 1;
      let verts: { p: LngLat; z: number; structure: Structure }[] = segs[start].path.map((p) => ({ p, z: segs[start].z, structure: segs[start].structure }));
      const extend = (atEnd: boolean) => {
        for (;;) {
          const tip = atEnd ? verts[verts.length - 1].p : verts[0].p;
          const next = (byEnd.get(key(tip)) ?? []).find((j) => !used[j]);
          if (next === undefined) return;
          used[next] = 1;
          const s = segs[next];
          let pts = s.path;
          const startsHere = key(pts[0]) === key(tip);
          if (atEnd !== startsHere) pts = [...pts].reverse();
          // atEnd: pts starts at the tip -> append pts[1..]; else pts ends at the tip -> prepend pts[..-1]
          const add = (atEnd ? pts.slice(1) : pts.slice(0, -1)).map((p) => ({ p, z: s.z, structure: s.structure }));
          verts = atEnd ? [...verts, ...add] : [...add, ...verts];
        }
      };
      extend(true);
      extend(false);
      let km = 0;
      const vertices: ChainVertex[] = verts.map((v, i) => {
        if (i > 0) km += dist(verts[i - 1].p, v.p);
        return { ...v, km };
      });
      if (km > 0.3) chains.push({ lineId: line.id, kind: line.kind, vertices, lengthKm: km });
    }
  }
  return chains;
}

/** Chain from a plain path (e.g. the proposed line), all at grade. */
export function chainFromPath(lineId: string, kind: RailKind, path: LngLat[]): RailChain {
  let km = 0;
  const vertices = path.map((p, i) => {
    if (i > 0) km += dist(path[i - 1], p);
    return { p, z: 0, structure: "grade" as Structure, km };
  });
  return { lineId, kind, vertices, lengthKm: km };
}

/** Sub-path of a chain between distances a..b (km), with z per vertex, plus the structure at b. */
export function sliceChain(c: RailChain, a: number, b: number): { path: [number, number, number][]; structure: Structure } {
  const v = c.vertices;
  const at = (s: number): [number, number, number] => {
    let i = 1;
    while (i < v.length - 1 && v[i].km < s) i++;
    const p0 = v[i - 1], p1 = v[i];
    const k = (s - p0.km) / (p1.km - p0.km || 1);
    return [p0.p[0] + (p1.p[0] - p0.p[0]) * k, p0.p[1] + (p1.p[1] - p0.p[1]) * k, p0.z + (p1.z - p0.z) * k];
  };
  const path: [number, number, number][] = [at(a)];
  for (const x of v) if (x.km > a && x.km < b) path.push([x.p[0], x.p[1], x.z]);
  path.push(at(b));
  let j = 1;
  while (j < v.length - 1 && v[j].km < b) j++;
  return { path, structure: v[j].structure };
}
