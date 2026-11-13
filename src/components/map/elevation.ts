/**
 * Ground elevation for the study area (public/elevation/atl.json, baked by scripts/fetch-elevation.mjs
 * from the USGS 3DEP bare-earth DEM): a fine grid over the core and a coarse one over the whole box.
 * Heights there are NAVD88 (orthometric); Google Photorealistic 3D Tiles are WGS84 ellipsoidal, so the
 * sampler adds the GEOID18 geoid height (about -29.6 m in Atlanta).
 * No deck.gl imports, so it can load without the map bundle.
 */
import { z } from "zod";

const GridSchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  step: z.number().positive(),
  nx: z.number().int().positive(),
  ny: z.number().int().positive(),
  values: z.array(z.number()),
});
const ElevationSchema = z.object({ geoidHeightM: z.number(), grids: z.array(GridSchema).min(1) });
export type ElevationData = z.infer<typeof ElevationSchema>;
type Grid = z.infer<typeof GridSchema>;

export async function loadElevation(url = "/elevation/atl.json"): Promise<ElevationData | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const parsed = ElevationSchema.safeParse(await res.json());
    if (!parsed.success || parsed.data.grids.some((g) => g.values.length !== g.nx * g.ny)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function bilinear(g: Grid, v: Float32Array, lng: number, lat: number) {
  const fx = Math.min(g.nx - 1.000001, Math.max(0, (lng - g.bbox[0]) / g.step));
  const fy = Math.min(g.ny - 1.000001, Math.max(0, (lat - g.bbox[1]) / g.step));
  const i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  const a = v[j * g.nx + i], b = v[j * g.nx + i + 1], c = v[(j + 1) * g.nx + i], d = v[(j + 1) * g.nx + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Ground height (WGS84 ellipsoidal metres): the finest grid that contains the point; clamps at the edges. */
export function makeGroundSampler(data: ElevationData): (lng: number, lat: number) => number {
  const grids = [...data.grids].sort((a, b) => a.step - b.step).map((g) => ({ g, v: Float32Array.from(g.values) }));
  const geoid = data.geoidHeightM;
  return (lng, lat) => {
    for (const { g, v } of grids)
      if (lng >= g.bbox[0] && lng <= g.bbox[2] && lat >= g.bbox[1] && lat <= g.bbox[3]) return bilinear(g, v, lng, lat) + geoid;
    const { g, v } = grids[grids.length - 1];
    return bilinear(g, v, lng, lat) + geoid;
  };
}
