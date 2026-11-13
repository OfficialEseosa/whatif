/** History overlay (redline / county / highway / beltline / renewal) for the active timeline card. */
import { PathLayer, PolygonLayer } from "@deck.gl/layers";
import type { HistoryOverlay, LngLat, Network, OverlayFeature } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { LIFT_M, lift, liftRing, terrainProps } from "./common";

const cache = new WeakMap<Network, Map<HistoryOverlay, { polys: OverlayFeature[]; paths: OverlayFeature[] }>>();
function dataFor(network: Network, overlay: HistoryOverlay) {
  let m = cache.get(network);
  if (!m) cache.set(network, (m = new Map()));
  let c = m.get(overlay);
  if (!c) {
    const feats = network.overlays.filter((f) => f.overlay === overlay);
    c = { polys: feats.filter((f) => f.geometry.type === "polygon"), paths: feats.filter((f) => f.geometry.type === "path") };
    m.set(overlay, c);
  }
  return c;
}

export function historyOverlayLayers(network: Network, overlay: HistoryOverlay, photoreal: boolean) {
  const { polys, paths } = dataFor(network, overlay);
  return [
    new PolygonLayer<OverlayFeature>({
      id: `history-${overlay}-polygons`,
      data: polys,
      getPolygon: (d) => liftRing((d.geometry as { ring: LngLat[] }).ring, photoreal ? LIFT_M.fills : 0),
      getFillColor: withAlpha(MAP_COLORS.history, 55),
      getLineColor: MAP_COLORS.history,
      lineWidthMinPixels: 1.5,
      stroked: true,
      pickable: true,
      updateTriggers: { getPolygon: photoreal },
      ...terrainProps(photoreal),
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
