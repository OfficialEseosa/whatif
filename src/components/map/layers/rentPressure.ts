/**
 * Rent-pressure zone: tracts flagged rentPressure (shown on Who pays and the look-ahead).
 * Polygons when the scenario has them (mock); outlined centroid discs otherwise (sim output has no polygons yet).
 */
import { PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { TractEffect } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { LIFT_M, liftPoint, liftRing, terrainProps } from "./common";

const cache = new WeakMap<TractEffect[], { polys: TractEffect[]; discs: TractEffect[] }>();
function dataFor(tracts: TractEffect[]) {
  let c = cache.get(tracts);
  if (!c) {
    const flagged = tracts.filter((t) => t.rentPressure);
    c = { polys: flagged.filter((t) => t.polygon), discs: flagged.filter((t) => !t.polygon) };
    cache.set(tracts, c);
  }
  return c;
}

export function rentPressureLayers(tracts: TractEffect[], photoreal: boolean) {
  const { polys, discs } = dataFor(tracts);
  return [
    new PolygonLayer<TractEffect>({
      id: "rent-pressure",
      data: polys,
      getPolygon: (d) => liftRing(d.polygon!, photoreal ? LIFT_M.fills : 0),
      getFillColor: withAlpha(MAP_COLORS.rentPressure, 40),
      getLineColor: MAP_COLORS.rentPressure,
      lineWidthMinPixels: 1.5,
      stroked: true,
      ...terrainProps(photoreal),
      updateTriggers: { getPolygon: photoreal, getPosition: photoreal },
    }),
    new ScatterplotLayer<TractEffect>({
      id: "rent-pressure-discs",
      data: discs,
      getPosition: (d) => liftPoint(d.centroid, photoreal ? LIFT_M.fills : 0),
      getRadius: 380,
      radiusUnits: "meters",
      getFillColor: withAlpha(MAP_COLORS.rentPressure, 45),
      getLineColor: MAP_COLORS.rentPressure,
      lineWidthMinPixels: 1.5,
      stroked: true,
      pickable: true,
      ...terrainProps(photoreal),
      updateTriggers: { getPolygon: photoreal, getPosition: photoreal },
    }),
  ];
}
