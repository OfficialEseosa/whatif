/** Shared helpers for layer modules. */
import { _TerrainExtension as TerrainExtension } from "@deck.gl/extensions"; // experimental in deck.gl 9.x
import type { Position } from "@deck.gl/core";
import type { LngLat } from "@/lib/contract";

export const TERRAIN = new TerrainExtension();

/**
 * Photoreal view: overlays sit on Google's 3D tiles via deck.gl TerrainExtension (the Tile3DLayer
 * is the terrain source, `operation: "terrain+draw"`), and keep normal depth testing so buildings
 * occlude them.
 *   offset: vertices are lifted by the terrain height under them (paths, points, trips)
 *   drape : drawn into a texture laid over the terrain (flat fills like tract tints)
 * `xray` (Underground mode) disables depth testing so tunnels/trains below the surface show through.
 */
export function terrainProps(photoreal: boolean, mode: "offset" | "drape" = "offset", xray = false) {
  if (!photoreal) return {};
  return {
    extensions: [TERRAIN],
    terrainDrawMode: mode,
    ...(xray ? { parameters: { depthCompare: "always" as const, depthWriteEnabled: false } } : {}),
  };
}

/** Meters above the terrain surface for each overlay in photoreal (avoids z-fighting with the mesh). */
export const LIFT_M = { trips: 2, rail: 3, beltline: 2, spillover: 3, history: 4, proposed: 8, vehicles: 4, stops: 9 } as const;

/** Adds a z (meters) to every vertex; identity when z is 0. */
export function lift(path: Position[], z: number): Position[] {
  if (!z) return path;
  return path.map((p) => [p[0], p[1], (p[2] ?? 0) + z] as Position);
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
