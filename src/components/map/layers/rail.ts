/** Existing rail (MARTA heavy rail, Atlanta Streetcar, freight) and stations. */
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { LngLat, Network, RailKind, Station } from "@/lib/contract";
import { MAP_COLORS } from "../colors";
import { LIFT_M, lift, terrainProps } from "./common";

type Seg = { path: LngLat[]; kind: RailKind };

export function railLayers(network: Network, photoreal: boolean) {
  const segs: Seg[] = network.rail.flatMap((l) => l.paths.map((path) => ({ path, kind: l.kind })));
  return [
    new PathLayer<Seg>({
      id: "rail",
      data: segs,
      getPath: (d) => lift(d.path, photoreal ? LIFT_M.rail : 0),
      getColor: (d) => (d.kind === "streetcar" ? MAP_COLORS.streetcar : d.kind === "freight" ? MAP_COLORS.freight : MAP_COLORS.rail),
      getWidth: (d) => (d.kind === "freight" ? 1 : d.kind === "streetcar" ? 3 : 3),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getPath: photoreal },
      ...terrainProps(photoreal),
    }),
    new ScatterplotLayer<Station>({
      id: "stations",
      data: network.stations,
      getPosition: (d) => d.coord,
      getRadius: (d) => (d.kind === "marta_station" ? 5 : 3),
      radiusUnits: "pixels",
      stroked: true,
      filled: true,
      getFillColor: [20, 22, 28, 255],
      getLineColor: MAP_COLORS.station,
      lineWidthMinPixels: 1.5,
      pickable: true,
      ...terrainProps(photoreal),
    }),
  ];
}
