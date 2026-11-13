/** Atlanta Beltline trails (real OSM geometry). */
import { PathLayer } from "@deck.gl/layers";
import type { BeltlineSegment, Network } from "@/lib/contract";
import { MAP_COLORS } from "../colors";
import { overlayParameters } from "./common";

export function beltlineLayer(network: Network, photoreal: boolean) {
  return new PathLayer<BeltlineSegment>({
    id: "beltline",
    data: network.beltline,
    getPath: (d) => d.path,
    getColor: MAP_COLORS.beltline,
    getWidth: 2,
    widthUnits: "pixels",
    capRounded: true,
    parameters: overlayParameters(photoreal),
  });
}
