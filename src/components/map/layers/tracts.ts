/** Tract tint: green where commutes get faster, red where slower. */
import { PolygonLayer } from "@deck.gl/layers";
import type { TractEffect } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { overlayProps } from "./common";

export function tractsLayer(tracts: TractEffect[], opts: { opacity: number; photoreal: boolean }) {
  return new PolygonLayer<TractEffect>({
    id: "tracts",
    data: tracts.filter((t) => t.polygon && Math.abs(t.minutesDelta) > 0.05),
    getPolygon: (d) => d.polygon!,
    getFillColor: (d) => withAlpha(d.minutesDelta < 0 ? MAP_COLORS.gain : MAP_COLORS.loss, 30 + Math.min(1, Math.abs(d.minutesDelta) / 4) * 110),
    stroked: false,
    opacity: opts.opacity,
    pickable: true,
    ...overlayProps(opts.photoreal),
  });
}
