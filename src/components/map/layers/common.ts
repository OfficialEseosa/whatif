/** Shared helpers for layer modules. */
import type { Position } from "@deck.gl/core";
import type { LngLat } from "@/lib/contract";

/*
 * Photoreal view: overlays are placed on Google's 3D tiles by BAKING ground elevation into their
 * vertices (see ../elevation.ts: a USGS 3DEP grid converted to the tiles' ellipsoidal heights), then
 * drawn with ordinary depth testing so buildings and trees occlude them. This replaced deck.gl's
 * TerrainExtension, which re-rendered the whole tileset into a height map (and a cover texture per
 * draped layer) on every frame the camera or an animated layer changed.
 */
let sampler: ((lng: number, lat: number) => number) | null = null;

/** Installs the ground-height function (ellipsoidal metres). DeckMap calls this once the grid loads. */
export function setGroundSampler(f: ((lng: number, lat: number) => number) | null) {
  sampler = f;
}
export const groundReady = () => sampler !== null;
/** Ground height (WGS84 ellipsoidal metres) at a point; 0 until the grid has loaded. */
export const ground = (lng: number, lat: number) => (sampler ? sampler(lng, lat) : 0);

/**
 * Layer props for the 3D view. No extension any more; `xray` (Underground mode) turns depth testing
 * off so tunnels and trains below the surface show through.
 */
export function terrainProps(photoreal: boolean, _mode: "offset" | "drape" = "offset", xray = false) {
  void _mode;
  if (!photoreal || !xray) return {};
  return { parameters: { depthCompare: "always" as const, depthWriteEnabled: false } };
}

/**
 * Metres above the baked ground for each overlay in photoreal. Checked against the tiles by picking the
 * mesh: on open ground the grid matches within about +-2 m, and the tiles' depth precision at this range
 * hides lines lifted less than ~6 m, so lines ride 7-9 m up (a street-lamp height) and stay occluded
 * by buildings and trees.
 */
export const LIFT_M = { trips: 7, rail: 8, beltline: 7, spillover: 8, history: 8, proposed: 9, stops: 10, fills: 9 } as const;

/**
 * Photoreal z for a path: ground under each vertex + the vertex's own z (bridges/tunnels) + `z`.
 * Identity when `z` is 0 (the flat map).
 */
export function lift(path: Position[], z: number): Position[] {
  if (!z) return path;
  return path.map((p) => [p[0], p[1], (p[2] ?? 0) + z + ground(p[0], p[1])] as Position);
}

/** Photoreal z for a point (same rule as `lift`). */
export const liftPoint = (p: Position, z: number): Position => (z ? [p[0], p[1], (p[2] ?? 0) + z + ground(p[0], p[1])] : p);

/**
 * Photoreal z for a filled polygon: one flat height at the highest ground under its corners + `z`,
 * so the low-opacity fill never sinks into a hillside (it may hover a few metres over low ground).
 */
export function liftRing(ring: Position[], z: number): Position[] {
  if (!z) return ring;
  let top = -Infinity;
  for (const p of ring) top = Math.max(top, ground(p[0], p[1]));
  return ring.map((p) => [p[0], p[1], top + z] as Position);
}

export const lengthKm = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * 92.57, (a[1] - b[1]) * 111.0);

/** Cumulative length fractions (0..1) for each vertex of a path. */
export function cumulativeFractions(path: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + lengthKm(path[i - 1], path[i]));
  const total = cum[cum.length - 1] || 1;
  return cum.map((c) => c / total);
}

/** The first `progress` (0..1) of a path, by length. */
export function partialPath(path: LngLat[], fr: number[], progress: number): LngLat[] {
  if (progress >= 1) return path;
  if (progress <= 0 || path.length < 2) return [];
  const out: LngLat[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (fr[i] <= progress) out.push(path[i]);
    else {
      const k = (progress - fr[i - 1]) / (fr[i] - fr[i - 1] || 1);
      out.push([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k]);
      break;
    }
  }
  return out;
}

/** Stable pseudo-random 0..1 per index (which agents switch first). */
export const hash01 = (i: number) => {
  let x = (i + 1) * 2654435761;
  x ^= x >>> 16;
  return ((x >>> 0) % 10000) / 10000;
};
