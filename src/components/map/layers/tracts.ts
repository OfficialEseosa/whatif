/**
 * Tract tint: green where commutes get faster, red where slower.
 * Polygons when the scenario has them (mock); centroid discs otherwise (sim output has no polygons yet).
 */
import { PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { TractEffect } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { LIFT_M, liftPoint, liftRing, terrainProps } from "./common";

/**
 * Average commute change (minutes) a tract needs before it is tinted at all. Smaller changes are
 * rounding-level noise in a 3,000-agent sample and must not paint the city red or green.
 */
export const TRACT_EFFECT_MIN_MINUTES = 0.25;
/** Change (minutes) at which the tint reaches its maximum opacity. */
const TRACT_EFFECT_FULL_MINUTES = 3;
/** Ceiling for the fill: the tint is context, it must never dominate the map. */
const TRACT_FILL_MAX_ALPHA = 0.12 * 255;
const TRACT_LINE_ALPHA = 150;

const strength = (d: TractEffect) => Math.min(1, Math.abs(d.minutesDelta) / TRACT_EFFECT_FULL_MINUTES);
const tone = (d: TractEffect) => (d.minutesDelta < 0 ? MAP_COLORS.gain : MAP_COLORS.loss);
const fill = (d: TractEffect) => withAlpha(tone(d), 8 + strength(d) * (TRACT_FILL_MAX_ALPHA - 8));
const line = (d: TractEffect) => withAlpha(tone(d), 60 + strength(d) * (TRACT_LINE_ALPHA - 60));

// Stable filtered data per tracts array (avoids rebuilding attributes every frame).
const cache = new WeakMap<TractEffect[], { polys: TractEffect[]; discs: TractEffect[] }>();
function dataFor(tracts: TractEffect[], bbox?: [number, number, number, number]) {
  let c = cache.get(tracts);
  if (!c) {
    const shown = tracts.filter((t) => Math.abs(t.minutesDelta) >= TRACT_EFFECT_MIN_MINUTES);
    const inBox = (t: TractEffect) =>
      !bbox || (t.centroid[0] >= bbox[0] && t.centroid[0] <= bbox[2] && t.centroid[1] >= bbox[1] && t.centroid[1] <= bbox[3]);
    c = { polys: shown.filter((t) => t.polygon), discs: shown.filter((t) => !t.polygon && inBox(t)) };
    cache.set(tracts, c);
  }
  return c;
}

export function tractsLayers(tracts: TractEffect[], opts: { opacity: number; photoreal: boolean; bbox?: [number, number, number, number] }) {
  const { polys, discs } = dataFor(tracts, opts.bbox);
  return [
    new PolygonLayer<TractEffect>({
      id: "tracts",
      data: polys,
      getPolygon: (d) => liftRing(d.polygon!, opts.photoreal ? LIFT_M.fills : 0),
      getFillColor: fill,
      getLineColor: line,
      stroked: true,
      lineWidthMinPixels: 1,
      opacity: opts.opacity,
      pickable: true,
      ...terrainProps(opts.photoreal),
      updateTriggers: { getPolygon: opts.photoreal, getPosition: opts.photoreal },
    }),
    new ScatterplotLayer<TractEffect>({
      id: "tract-centroids",
      data: discs,
      getPosition: (d) => liftPoint(d.centroid, opts.photoreal ? LIFT_M.fills : 0),
      getRadius: 350,
      radiusUnits: "meters",
      getFillColor: fill,
      getLineColor: line,
      stroked: true,
      lineWidthMinPixels: 1,
      opacity: opts.opacity,
      pickable: true,
      ...terrainProps(opts.photoreal),
      updateTriggers: { getPolygon: opts.photoreal, getPosition: opts.photoreal },
    }),
  ];
}
