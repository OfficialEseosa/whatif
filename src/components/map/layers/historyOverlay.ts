/** History overlay (redline / county / highway / beltline / renewal) for the active timeline card. */
import { PathLayer, PolygonLayer } from "@deck.gl/layers";
import type { HistoryOverlay, LngLat, Network, OverlayFeature } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { overlayProps } from "./common";

export function historyOverlayLayers(network: Network, overlay: HistoryOverlay, photoreal: boolean) {
  const feats = network.overlays.filter((f) => f.overlay === overlay);
  const polys = feats.filter((f) => f.geometry.type === "polygon");
  const paths = feats.filter((f) => f.geometry.type === "path");
  const onTerrain = overlayProps(photoreal);
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
      ...onTerrain,
    }),
    new PathLayer<OverlayFeature>({
      id: `history-${overlay}-paths`,
      data: paths,
      getPath: (d) => (d.geometry as { path: LngLat[] }).path,
      getColor: withAlpha(MAP_COLORS.history, 200),
      getWidth: overlay === "county" ? 3 : 6,
      widthUnits: "pixels",
      capRounded: true,
      pickable: true,
      ...onTerrain,
    }),
  ];
}
