/**
 * GTFS service from the sim (public/scenarios/transit-service.sim.json). Kept free of deck.gl imports
 * so the boot hook can load it without pulling the map bundle.
 */
import { z } from "zod";

/** Shape of the parts of transit-service.sim.json we use. */
export const TransitServiceSchema = z.object({
  source: z.string().optional(),
  window: z.string().optional(),
  lines: z.record(z.string(), z.object({ headwayMin: z.number().positive().nullable().optional() }).passthrough()),
});
export type Headways = Record<string, number>;

/** Loads GTFS-derived headways per line id; null when the file is missing or malformed. */
export async function loadHeadways(url = "/scenarios/transit-service.sim.json"): Promise<Headways | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const parsed = TransitServiceSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    const out: Headways = {};
    for (const [id, l] of Object.entries(parsed.data.lines)) if (l.headwayMin) out[id] = l.headwayMin;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

