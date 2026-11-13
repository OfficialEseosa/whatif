/** Shared helpers for layer modules. */
import type { LngLat } from "@/lib/contract";

/** Height of the ground in Google's 3D tiles around central Atlanta, in meters above the WGS84 ellipsoid (approximate). */
export const GROUND_Z = 275;
const LIFT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, GROUND_Z, 1]);

/**
 * Over Google's photoreal 3D tiles our flat (z = 0) overlays would sit under the terrain and buildings,
 * so lift them to ground height and draw them on top of everything.
 * TODO(Prosper): drape properly (TerrainExtension) if the single ground height isn't close enough.
 */
export const overlayProps = (onTerrain: boolean) =>
  onTerrain ? { parameters: { depthCompare: "always" as const, depthWriteEnabled: false }, modelMatrix: LIFT } : {};

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
