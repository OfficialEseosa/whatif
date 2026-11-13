/** Keyless fallback basemap: real OSM roads as vector paths (the CSS background is the "ground"). */
import { PathLayer } from "@deck.gl/layers";
import type { Network, NetworkRoad } from "@/lib/contract";
import { MAP_COLORS } from "../colors";

const WIDTH: Record<string, number> = { motorway: 4, trunk: 3, primary: 2.4, secondary: 1.8, tertiary: 1.2, link: 1.4 };

export function keylessRoadsLayer(network: Network, dim = false, opacity?: number) {
  return new PathLayer<NetworkRoad>({
    id: "keyless-roads",
    data: network.roads,
    getPath: (d) => d.path,
    getColor: (d) => MAP_COLORS.road[d.class],
    getWidth: (d) => WIDTH[d.class] ?? 1,
    widthUnits: "pixels",
    widthMinPixels: 0.6,
    capRounded: true,
    jointRounded: true,
    opacity: opacity ?? (dim ? 0.5 : 1),
  });
}
