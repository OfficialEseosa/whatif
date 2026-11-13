/** Shared helpers for layer modules. */
import type { LngLat } from "@/lib/contract";

/**
 * In the photoreal view our flat (z = 0) overlays would sit under Google's terrain/buildings,
 * so draw them on top of everything. TODO(Prosper): drape properly (elevation offset) if wanted.
 */
export const overlayParameters = (photoreal: boolean) =>
  photoreal ? ({ depthCompare: "always", depthWriteEnabled: false } as const) : undefined;

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
