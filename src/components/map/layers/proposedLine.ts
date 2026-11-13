/**
 * The proposed line or road being built: glow + core drawn progressively along the path,
 * a construction "head" at the tip while it is drawing, and stops popping in as it passes them.
 */
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Position } from "@deck.gl/core";
import type { LngLat, Network, ScenarioResult, Stop } from "@/lib/contract";
import { MAP_COLORS } from "../colors";
import { LIFT_M, cumulativeFractions, lift, partialPath, terrainProps } from "./common";

export type BuildGeometry = { path: LngLat[]; stops: Stop[]; kind: "transit" | "road" };

/**
 * What to draw for this edit. Transit edits use `line`; road edits (`new_road`) use `line.path` if the
 * producer filled it, else the network roads listed in `edit.roadIds`, chained in order.
 */
export function buildGeometry(s: ScenarioResult, network: Network | null): BuildGeometry | null {
  const road = s.edit.type === "new_road";
  if (s.line.path.length >= 2) return { path: s.line.path, stops: road ? [] : s.line.stops, kind: road ? "road" : "transit" };
  if (road && network && s.edit.roadIds?.length) {
    const byId = new Map(network.roads.map((r) => [r.id, r]));
    const path = s.edit.roadIds.flatMap((id) => byId.get(id)?.path ?? []);
    if (path.length >= 2) return { path, stops: [], kind: "road" };
  }
  return null;
}

type StopD = Stop & { at: number };

export function proposedLineLayers(geom: BuildGeometry, progress: number, photoreal: boolean) {
  if (geom.path.length < 2 || progress <= 0) return [];
  const fr = cumulativeFractions(geom.path);
  const drawn = partialPath(geom.path, fr, progress);
  const stops: StopD[] = geom.stops.map((s) => {
    let bi = 0;
    let bd = Infinity;
    geom.path.forEach((p, i) => {
      const d = Math.hypot(p[0] - s.coord[0], p[1] - s.coord[1]);
      if (d < bd) { bd = d; bi = i; }
    });
    return { ...s, at: fr[bi] };
  });
  const z = photoreal ? LIFT_M.proposed : 0;
  const road = geom.kind === "road";
  const core = road ? MAP_COLORS.proposedRoad : MAP_COLORS.proposed;
  const data = [{ path: lift(drawn, z) }];
  const tip = drawn[drawn.length - 1];
  const scale = photoreal ? 1.5 : 1;
  const shown = stops.filter((d) => progress >= d.at - 0.01).length;
  return [
    new PathLayer<{ path: Position[] }>({
      id: "proposed-glow",
      data,
      getPath: (d) => d.path,
      getColor: road ? MAP_COLORS.proposedRoadGlow : MAP_COLORS.proposedGlow,
      getWidth: 16 * scale,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      ...terrainProps(photoreal),
    }),
    new PathLayer<{ path: Position[] }>({
      id: "proposed-line",
      data,
      getPath: (d) => d.path,
      getColor: core,
      getWidth: (road ? 6 : 4.5) * scale,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      ...terrainProps(photoreal),
    }),
    // construction head while drawing
    new ScatterplotLayer<{ p: number[] }>({
      id: "proposed-build-head",
      data: progress < 1 && tip ? [{ p: [tip[0], tip[1], z] }] : [],
      getPosition: (d) => d.p as [number, number, number],
      getRadius: 9 * scale,
      radiusUnits: "pixels",
      getFillColor: MAP_COLORS.buildHead,
      stroked: true,
      getLineColor: core,
      lineWidthMinPixels: 2,
      ...terrainProps(photoreal),
    }),
    new ScatterplotLayer<StopD>({
      id: "proposed-stops",
      data: stops,
      getPosition: (d) => [d.coord[0], d.coord[1], photoreal ? LIFT_M.stops : 0],
      getRadius: (d) => (progress >= d.at - 0.01 ? 7 * scale : 0),
      radiusUnits: "pixels",
      stroked: true,
      getFillColor: [20, 22, 28, 255],
      getLineColor: core,
      lineWidthMinPixels: 2.5,
      pickable: true,
      transitions: { getRadius: { duration: 300 } },
      updateTriggers: { getRadius: shown, getPosition: photoreal },
      ...terrainProps(photoreal),
    }),
  ];
}
