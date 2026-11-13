/**
 * Tract tint: green where commutes get faster, red where slower.
 * Polygons when the scenario has them (mock); centroid discs otherwise (sim output has no polygons yet).
 */
import { PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { TractEffect } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { overlayParameters } from "./common";

const MIN_DELTA = 0.005; // minutes; below this a tract is not drawn

const fill = (d: TractEffect) =>
  withAlpha(d.minutesDelta < 0 ? MAP_COLORS.gain : MAP_COLORS.loss, Math.min(1, Math.abs(d.minutesDelta) / 3) * 150); // alpha proportional: tiny effects stay faint

export function tractsLayers(tracts: TractEffect[], opts: { opacity: number; photoreal: boolean; bbox?: [number, number, number, number] }) {
  const shown = tracts.filter((t) => Math.abs(t.minutesDelta) > MIN_DELTA);
  const inBox = (t: TractEffect) =>
    !opts.bbox || (t.centroid[0] >= opts.bbox[0] && t.centroid[0] <= opts.bbox[2] && t.centroid[1] >= opts.bbox[1] && t.centroid[1] <= opts.bbox[3]);
  const parameters = overlayParameters(opts.photoreal);
  return [
    new PolygonLayer<TractEffect>({
      id: "tracts",
      data: shown.filter((t) => t.polygon),
      getPolygon: (d) => d.polygon!,
      getFillColor: fill,
      stroked: false,
      opacity: opts.opacity,
      pickable: true,
      parameters,
    }),
    new ScatterplotLayer<TractEffect>({
      id: "tract-centroids",
      data: shown.filter((t) => !t.polygon && inBox(t)),
      getPosition: (d) => d.centroid,
      getRadius: 350,
      radiusUnits: "meters",
      getFillColor: fill,
      stroked: false,
      opacity: opts.opacity,
      pickable: true,
      parameters,
    }),
  ];
}
