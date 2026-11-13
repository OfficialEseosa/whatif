/** The proposed line drawing itself (glow + core) and its stops popping in. */
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { LngLat, ScenarioResult, Stop } from "@/lib/contract";
import { MAP_COLORS } from "../colors";
import { cumulativeFractions, overlayProps, partialPath } from "./common";

type StopD = Stop & { at: number };

export function proposedLineLayers(line: ScenarioResult["line"], progress: number, photoreal: boolean) {
  if (!line.path.length || progress <= 0) return [];
  const fr = cumulativeFractions(line.path);
  const path = partialPath(line.path, fr, progress);
  const stops: StopD[] = line.stops.map((s) => {
    let bi = 0;
    let bd = Infinity;
    line.path.forEach((p, i) => {
      const d = Math.hypot(p[0] - s.coord[0], p[1] - s.coord[1]);
      if (d < bd) { bd = d; bi = i; }
    });
    return { ...s, at: fr[bi] };
  });
  const onTerrain = overlayProps(photoreal);
  const data = [{ path }];
  return [
    new PathLayer<{ path: LngLat[] }>({
      id: "proposed-glow",
      data,
      getPath: (d) => d.path,
      getColor: MAP_COLORS.proposedGlow,
      getWidth: 16,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      ...onTerrain,
    }),
    new PathLayer<{ path: LngLat[] }>({
      id: "proposed-line",
      data,
      getPath: (d) => d.path,
      getColor: MAP_COLORS.proposed,
      getWidth: 4.5,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      ...onTerrain,
    }),
    new ScatterplotLayer<StopD>({
      id: "proposed-stops",
      data: stops,
      getPosition: (d) => d.coord,
      getRadius: (d) => (progress >= d.at - 0.01 ? 7 : 0),
      radiusUnits: "pixels",
      stroked: true,
      getFillColor: [20, 22, 28, 255],
      getLineColor: MAP_COLORS.proposed,
      lineWidthMinPixels: 2.5,
      pickable: true,
      transitions: { getRadius: { duration: 300 } },
      updateTriggers: { getRadius: stops.filter((d) => progress >= d.at - 0.01).length },
      ...onTerrain,
    }),
  ];
}
