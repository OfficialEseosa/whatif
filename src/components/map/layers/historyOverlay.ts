/** History overlay (redline / county / highway / beltline / renewal) for the active timeline card. */
import { PathLayer, PolygonLayer } from "@deck.gl/layers";
import type { HistoryOverlay, LngLat, Network, OverlayFeature } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { LIFT_M, lift, terrainProps } from "./common";

export function historyOverlayLayers(network: Network, overlay: HistoryOverlay, photoreal: boolean) {
  const feats = network.overlays.filter((f) => f.overlay === overlay);
  const polys = feats.filter((f) => f.geometry.type === "polygon");
  const paths = feats.filter((f) => f.geometry.type === "path");
  return [
    new PolygonLayer<OverlayFeature>({
      id: `history-${overlay}-polygons`,
      data: polys,
      getPolygon: (d) => (d.geometry as { ring: LngLat[] }).ring,
      getFillColor: withAlpha(MAP_COLORS.history, 55),
      getLineColor: MAP_COLORS.history,
      lineWidthMinPixels: 1.5,
      stroked: true,
      pickable: true,
      ...terrainProps(photoreal, "drape"),
    }),
    new PathLayer<OverlayFeature>({
      id: `history-${overlay}-paths`,
      data: paths,
      getPath: (d) => lift((d.geometry as { path: LngLat[] }).path, photoreal ? LIFT_M.history : 0),
      getColor: withAlpha(MAP_COLORS.history, 200),
      getWidth: overlay === "county" ? 3 : 6,
      widthUnits: "pixels",
      capRounded: true,
      pickable: true,
      updateTriggers: { getPath: photoreal },
      ...terrainProps(photoreal),
    }),
  ];
}
