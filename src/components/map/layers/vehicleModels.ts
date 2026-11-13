/**
 * Transit vehicles as 3D models (glTF in public/models, real metres, nose along glTF -Z, +Y up):
 * MARTA trains as consists of railcars chained along the track (each car with its own position and
 * heading, so trains bend through curves and show the right side as the camera turns), streetcars as
 * single cars. Same schedule as layers/vehicles.ts (GTFS headways when available).
 * Commuters stay as trails; buses are not drawn (no real bus positions yet).
 */
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import type { RailChain, Structure } from "../railGeometry";
import type { Headways } from "../transitService";
import { VEHICLE_SERVICE } from "./vehicles";
import { ground } from "./common";

export const MODEL_URLS = {
  railcar: "/models/marta-railcar.glb",
  streetcar: "/models/atlanta-streetcar.glb",
} as const;

/** Car lengths from the models (m) and the gap between coupled cars. */
const RAILCAR_M = 22.86;
const STREETCAR_M = 24.1;
const COUPLER_GAP_M = 0.3;
/** Typical consists (not from the GTFS feed): 6 cars on Red/Gold/Blue, 2 on Green. */
const CONSIST: Record<string, number> = { marta_proctor_creek: 2, marta_procotor_creek: 2, marta_east_west: 2 };
const DEFAULT_CONSIST = 6;

/**
 * Size exaggeration so a 23 m car stays visible at city zoom: true size from zoom 15 in,
 * doubling per zoom level out, capped at 12x. Spacing along the track scales with it.
 */
export const vehicleScale = (zoom: number) => Math.min(12, Math.max(1, 2 ** (15 - zoom)));

export type Car = { position: [number, number, number]; headingDeg: number; structure: Structure; model: keyof typeof MODEL_URLS };

const KM_LNG = 92.57;
const KM_LAT = 111.0;

/** Point and travel heading (deg clockwise from north) at distance s (km) along a chain. */
function pointAt(c: RailChain, s: number, forward: boolean) {
  const v = c.vertices;
  let i = 1;
  while (i < v.length - 1 && v[i].km < s) i++;
  const a = v[i - 1], b = v[i];
  const k = (s - a.km) / (b.km - a.km || 1);
  const lng = a.p[0] + (b.p[0] - a.p[0]) * k;
  const lat = a.p[1] + (b.p[1] - a.p[1]) * k;
  let heading = (Math.atan2((b.p[0] - a.p[0]) * KM_LNG, (b.p[1] - a.p[1]) * KM_LAT) * 180) / Math.PI;
  if (!forward) heading += 180;
  return { lng, lat, z: a.z + (b.z - a.z) * k, heading, structure: k < 0.5 ? a.structure : b.structure };
}

/**
 * All cars at `timeSec`. `chains` may include the proposed line (service: "proposed").
 * `onGround` adds the baked ground height (photoreal); `depth` keeps tunnel/bridge z.
 */
export function carsAt(
  chains: (RailChain & { service?: "proposed"; headwayMin?: number })[],
  timeSec: number,
  headways: Headways | null | undefined,
  opts: { scale: number; onGround: boolean; depth: boolean; underground: boolean },
): Car[] {
  const out: Car[] = [];
  chains.forEach((c, ci) => {
    const svc = c.service === "proposed" ? VEHICLE_SERVICE.proposed : c.kind === "streetcar" ? VEHICLE_SERVICE.streetcar : VEHICLE_SERVICE.marta_heavy_rail;
    const headway = c.headwayMin ?? headways?.[c.lineId] ?? svc.headwayMin;
    const spacing = (svc.kmh * headway) / 60;
    const n = Math.max(1, Math.floor(c.lengthKm / spacing));
    const travelled = ((timeSec / 3600) * svc.kmh + ci * 0.37) % c.lengthKm;
    const reverse = ci % 2 === 1; // parallel tracks run opposite ways
    const isRail = c.kind === "marta_heavy_rail" && c.service !== "proposed";
    const cars = isRail ? CONSIST[c.lineId] ?? DEFAULT_CONSIST : 1;
    const carKm = (((isRail ? RAILCAR_M : STREETCAR_M) + COUPLER_GAP_M) * opts.scale) / 1000;
    for (let k = 0; k < n; k++) {
      const headS = (travelled + k * spacing) % c.lengthKm;
      for (let j = 0; j < cars; j++) {
        // car centres trail the head, against the direction of travel
        const back = (j + 0.5) * carKm;
        const s = reverse ? headS + back : headS - back;
        if (s < 0 || s > c.lengthKm) continue;
        const p = pointAt(c, reverse ? c.lengthKm - s : s, !reverse);
        if (p.structure === "tunnel" && !opts.underground) continue; // below ground: only in Underground mode
        const z = (opts.depth ? p.z : 0) + (opts.onGround ? ground(p.lng, p.lat) + 1.5 : 0); // +1.5 m: the grid is within ~2 m of the mesh
        // married pairs: every second railcar is turned so the cab ends face outward
        const heading = isRail && j % 2 === 1 ? p.heading + 180 : p.heading;
        out.push({ position: [p.lng, p.lat, z], headingDeg: heading, structure: p.structure, model: isRail ? "railcar" : "streetcar" });
      }
    }
  });
  return out;
}

/** One instanced ScenegraphLayer per model. Orientation: [pitch, yaw, roll]; nose (-Z) along the heading. */
export function vehicleModelLayers(cars: Car[], opts: { scale: number; xray: boolean; time: number }) {
  const parameters = opts.xray ? { depthCompare: "always" as const } : undefined;
  return (Object.keys(MODEL_URLS) as (keyof typeof MODEL_URLS)[]).map(
    (model) =>
      new ScenegraphLayer<Car>({
        id: `vehicle-models-${model}`,
        data: cars.filter((c) => c.model === model),
        scenegraph: MODEL_URLS[model],
        getPosition: (d) => d.position,
        getOrientation: (d) => [0, -d.headingDeg, 90],
        sizeScale: opts.scale,
        _lighting: "pbr",
        pickable: false,
        updateTriggers: { getPosition: opts.time, getOrientation: opts.time },
        ...(parameters ? { parameters } : {}),
      }),
  );
}
