/**
 * Schedule-shaped vehicles: MARTA trains and streetcars running along the rail chains (and the
 * proposed line once built), positioned from headway + speed and tied to the time scrubber.
 *
 * PLACEHOLDER headways/speeds (not from GTFS): the sim's GTFS headways aren't exported to the
 * frontend yet. Replace VEHICLE_SERVICE when they are.
 */
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { RailKind } from "@/lib/contract";
import { MAP_COLORS, withAlpha, type RGBA } from "../colors";
import { sliceChain, type RailChain, type Structure } from "../railGeometry";
import { LIFT_M, terrainProps } from "./common";

export const VEHICLE_SERVICE: Record<"marta_heavy_rail" | "streetcar" | "proposed", { headwayMin: number; kmh: number; lengthKm: number }> = {
  marta_heavy_rail: { headwayMin: 10, kmh: 45, lengthKm: 0.15 }, // placeholder: ~10 min peak per line
  streetcar: { headwayMin: 15, kmh: 12, lengthKm: 0.03 }, // placeholder: ~15 min
  proposed: { headwayMin: 10, kmh: 15, lengthKm: 0.03 }, // overridden by edit.headwayMin
};

type Vehicle = { path: [number, number, number][]; head: [number, number, number]; color: RGBA; structure: Structure };

function serviceFor(kind: RailKind | "proposed") {
  return kind === "streetcar" ? VEHICLE_SERVICE.streetcar : kind === "proposed" ? VEHICLE_SERVICE.proposed : VEHICLE_SERVICE.marta_heavy_rail;
}

/** Vehicle positions at `timeSec` (seconds after 6:00 AM). */
export function vehiclesAt(chains: (RailChain & { service?: "proposed"; headwayMin?: number })[], timeSec: number): Vehicle[] {
  const out: Vehicle[] = [];
  chains.forEach((c, ci) => {
    const svc = serviceFor(c.service ?? c.kind);
    const headway = c.headwayMin ?? svc.headwayMin;
    const spacing = (svc.kmh * headway) / 60; // km between vehicles
    const n = Math.max(1, Math.floor(c.lengthKm / spacing));
    const travelled = ((timeSec / 3600) * svc.kmh + ci * 0.37) % c.lengthKm; // stagger chains
    const color = c.service === "proposed" ? MAP_COLORS.proposedVehicle : c.kind === "streetcar" ? MAP_COLORS.streetcarVehicle : MAP_COLORS.martaTrain;
    const reverse = ci % 2 === 1; // parallel tracks run opposite ways
    for (let k = 0; k < n; k++) {
      let s = (travelled + k * spacing) % c.lengthKm;
      if (reverse) s = c.lengthKm - s;
      const a = Math.max(0, s - svc.lengthKm), b = Math.min(c.lengthKm, Math.max(s, a + 0.001));
      const { path, structure } = sliceChain(c, a, b);
      out.push({ path, head: path[reverse ? 0 : path.length - 1], color, structure });
    }
  });
  return out;
}

export function vehicleLayers(vehicles: Vehicle[], opts: { photoreal: boolean; underground: boolean; depth?: boolean }) {
  const depth = opts.depth ?? opts.photoreal;
  const lift = opts.photoreal ? LIFT_M.vehicles : 0;
  const z = (p: [number, number, number]): [number, number, number] => [p[0], p[1], depth ? p[2] + lift : 0];
  // Below-ground vehicles are dimmed unless Underground mode is on.
  const color = (v: Vehicle) => (v.structure === "tunnel" && !opts.underground ? withAlpha(v.color, 90) : v.color);
  const terrain = { ...terrainProps(opts.photoreal, "offset", opts.underground), ...(depth && !opts.photoreal && opts.underground ? { parameters: { depthCompare: "always" as const } } : {}) };
  return [
    new PathLayer<Vehicle>({
      id: "vehicles-body",
      data: vehicles,
      getPath: (v) => v.path.map(z),
      getColor: color,
      getWidth: opts.photoreal ? 8 : 6,
      widthUnits: "pixels",
      capRounded: true,
      ...terrain,
    }),
    new ScatterplotLayer<Vehicle>({
      id: "vehicles-head",
      data: vehicles,
      getPosition: (v) => z(v.head),
      getRadius: opts.photoreal ? 5 : 4,
      radiusUnits: "pixels",
      getFillColor: color,
      stroked: true,
      getLineColor: [20, 22, 28, 255],
      lineWidthMinPixels: 1,
      ...terrain,
    }),
  ];
}
