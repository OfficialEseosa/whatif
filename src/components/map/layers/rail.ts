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
import { LIFT_M, TERRAIN, terrainProps } from "./common";

type Seg = { path: LngLat[]; kind: RailKind; structure: Structure; z: number };
const DASH = new PathStyleExtension({ dash: true });

function baseColor(d: Seg): RGBA {
  return d.kind === "streetcar" ? MAP_COLORS.streetcar : d.kind === "freight" ? MAP_COLORS.freight : MAP_COLORS.rail;
}

/** `photoreal` = draped on 3D tiles; `depth` = draw tunnels/bridges at their z (photoreal or Underground 3D). */
export function railLayers(network: Network, photoreal: boolean, underground = false, depth = photoreal) {
  const segs: Seg[] = network.rail.flatMap((l) =>
    l.paths.map((path, i) => {
      const structure = (l.structures?.[i] ?? "grade") as Structure;
      return { path, kind: l.kind, structure, z: structureZ(structure, l.layers?.[i] ?? 0) };
    }),
  );
  const toPath = (d: Seg): Position[] => d.path.map((p) => [p[0], p[1], depth ? d.z + (photoreal ? LIFT_M.rail : 0) : 0]);
  const color = (d: Seg): RGBA => {
    if (d.structure !== "tunnel") return underground ? withAlpha(baseColor(d), 110) : baseColor(d);
    return underground ? MAP_COLORS.tunnel : withAlpha(MAP_COLORS.tunnel, 120);
  };
  const surface = segs.filter((d) => d.structure !== "tunnel");
  const tunnels = segs.filter((d) => d.structure === "tunnel");
  return [
    new PathLayer<Seg>({
      id: "rail",
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
      extensions: photoreal ? [DASH, TERRAIN] : [DASH],
    }),
    new ScatterplotLayer<Station>({
      id: "stations",
      data: network.stations,
      getPosition: (d) => [d.coord[0], d.coord[1], photoreal ? LIFT_M.stops : 0],
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
