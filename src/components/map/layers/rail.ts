/**
 * Existing rail (MARTA heavy rail, Atlanta Streetcar, freight) and stations.
 * Tunnels (OSM tunnel=yes) are dashed; in photoreal they sit below the surface (z from the OSM layer
 * tag, approximate) and only show through in Underground mode.
 */
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Position } from "@deck.gl/core";
import type { LngLat, Network, RailKind, Station } from "@/lib/contract";
import { MAP_COLORS, withAlpha, type RGBA } from "../colors";
import { structureZ, type Structure } from "../railGeometry";
import { LIFT_M, ground, liftPoint, terrainProps } from "./common";

type Seg = { path: LngLat[]; kind: RailKind; structure: Structure; z: number };
const DASH = new PathStyleExtension({ dash: true });

function baseColor(d: Seg): RGBA {
  return d.kind === "streetcar" ? MAP_COLORS.streetcar : d.kind === "freight" ? MAP_COLORS.freight : MAP_COLORS.rail;
}

/** `photoreal` = draped on 3D tiles; `depth` = draw tunnels/bridges at their z (photoreal or Underground 3D). */
// Stable per-network data so deck.gl doesn't rebuild attributes on every frame.
const segCache = new WeakMap<Network, { surface: Seg[]; tunnels: Seg[] }>();
function segsFor(network: Network) {
  let c = segCache.get(network);
  if (!c) {
    const all: Seg[] = network.rail.flatMap((l) =>
      l.paths.map((path, i) => {
        const structure = (l.structures?.[i] ?? "grade") as Structure;
        return { path, kind: l.kind, structure, z: structureZ(structure, l.layers?.[i] ?? 0) };
      }),
    );
    c = { surface: all.filter((d) => d.structure !== "tunnel"), tunnels: all.filter((d) => d.structure === "tunnel") };
    segCache.set(network, c);
  }
  return c;
}

export type RailVisibility = { martaRail: boolean; streetcar: boolean; freight: boolean; tunnels: boolean; stations: boolean };

export function railLayers(network: Network, photoreal: boolean, underground = false, depth = photoreal, vis: RailVisibility = { martaRail: true, streetcar: true, freight: true, tunnels: true, stations: true }) {
  const { surface: allSurface, tunnels: allTunnels } = segsFor(network);
  const keep = (d: Seg) => (d.kind === "streetcar" ? vis.streetcar : d.kind === "freight" ? vis.freight : vis.martaRail);
  // photoreal: ground + structure (bridge/tunnel) + lift; Underground 3D without tiles: structure z only.
  const toPath = (d: Seg): Position[] => d.path.map((p) => [p[0], p[1], depth ? d.z + (photoreal ? LIFT_M.rail + ground(p[0], p[1]) : 0) : 0]);
  const color = (d: Seg): RGBA => {
    if (d.structure !== "tunnel") return underground ? withAlpha(baseColor(d), 110) : baseColor(d);
    return underground ? MAP_COLORS.tunnel : withAlpha(MAP_COLORS.tunnel, 120);
  };
  const surface = vis.martaRail && vis.streetcar && vis.freight ? allSurface : allSurface.filter(keep);
  const tunnels = vis.tunnels ? allTunnels : [];
  const visKey = `${+vis.martaRail}${+vis.streetcar}${+vis.freight}`;
  return [
    new PathLayer<Seg>({
      id: `rail-${visKey}`,
      data: surface,
      getPath: toPath,
      getColor: color,
      getWidth: (d) => (d.kind === "freight" ? 1 : d.structure === "bridge" ? 4 : 3),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getPath: [photoreal, depth], getColor: underground },
      ...terrainProps(photoreal),
    }),
    new PathLayer<Seg, PathStyleExtensionProps<Seg>>({
      id: "rail-tunnels",
      data: tunnels,
      getPath: toPath,
      getColor: color,
      getWidth: underground ? 4 : 3,
      widthUnits: "pixels",
      getDashArray: [3, 2],
      dashJustified: true,
      updateTriggers: { getPath: [photoreal, depth], getColor: underground, getWidth: underground },
      ...terrainProps(photoreal, "offset", underground),
      ...(depth && !photoreal && underground ? { parameters: { depthCompare: "always" as const } } : {}),
      extensions: [DASH],
    }),
    new ScatterplotLayer<Station>({
      id: "stations",
      data: vis.stations ? network.stations : [],
      getPosition: (d) => liftPoint(d.coord, photoreal ? LIFT_M.stops : 0),
      getRadius: (d) => (d.kind === "marta_station" ? 5 : 3),
      radiusUnits: "pixels",
      stroked: true,
      filled: true,
      getFillColor: [20, 22, 28, 255],
      getLineColor: MAP_COLORS.station,
      lineWidthMinPixels: 1.5,
      pickable: true,
      updateTriggers: { getPosition: photoreal },
      ...terrainProps(photoreal),
    }),
  ];
}
