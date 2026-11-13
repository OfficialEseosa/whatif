/** Rent-pressure zone: tracts flagged rentPressure (shown on Who pays and the look-ahead). */
import { PolygonLayer } from "@deck.gl/layers";
import type { TractEffect } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { overlayProps } from "./common";

export function rentPressureLayer(tracts: TractEffect[], photoreal: boolean) {
  return new PolygonLayer<TractEffect>({
    id: "rent-pressure",
    data: tracts.filter((t) => t.rentPressure && t.polygon),
    getPolygon: (d) => d.polygon!,
    getFillColor: withAlpha(MAP_COLORS.rentPressure, 40),
    getLineColor: MAP_COLORS.rentPressure,
    lineWidthMinPixels: 1.5,
    stroked: true,
    ...overlayProps(photoreal),
  });
}
