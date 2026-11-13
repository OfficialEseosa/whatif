/** Atlanta Beltline trails (real OSM geometry). */
import { PathLayer } from "@deck.gl/layers";
import type { BeltlineSegment, Network } from "@/lib/contract";
import { MAP_COLORS } from "../colors";
import { LIFT_M, lift, terrainProps } from "./common";

export function beltlineLayer(network: Network, photoreal: boolean) {
  return new PathLayer<BeltlineSegment>({
    id: "beltline",
    data: network.beltline,
    getPath: (d) => lift(d.path, photoreal ? LIFT_M.beltline : 0),
    getColor: MAP_COLORS.beltline,
    getWidth: 2,
    widthUnits: "pixels",
    capRounded: true,
    updateTriggers: { getPath: photoreal },
    ...terrainProps(photoreal),
  });
}
