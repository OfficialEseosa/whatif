/** Road spillover: roads whose volume/capacity changes, colored red (worse) / green (better). */
import { PathLayer } from "@deck.gl/layers";
import type { Network, NetworkRoad, RoadEffect } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { LIFT_M, lift, terrainProps } from "./common";

type D = NetworkRoad & { delta: number; highlighted: boolean };

// Stable data per (network, effects, highlight) so deck.gl doesn't rebuild attributes every frame.
const cache = new WeakMap<Network, WeakMap<RoadEffect[], Map<string, D[]>>>();
function dataFor(network: Network, effects: RoadEffect[], highlightIds: string[]): D[] {
  const key = highlightIds.join();
  let byEffects = cache.get(network);
  if (!byEffects) cache.set(network, (byEffects = new WeakMap()));
  let byHl = byEffects.get(effects);
  if (!byHl) byEffects.set(effects, (byHl = new Map()));
  const hit = byHl.get(key);
  if (hit) return hit;
  const byId = new Map(effects.map((e) => [e.roadId, e]));
  const hl = new Set(highlightIds);
  const data: D[] = [];
  for (const r of network.roads) {
    const e = byId.get(r.id);
    if (!e) continue;
    const delta = e.vcProposed - e.vcBaseline;
    if (Math.abs(delta) < 0.03 && !hl.has(r.id)) continue;
    data.push({ ...r, delta, highlighted: hl.has(r.id) });
  }
  byHl.set(key, data);
  return data;
}

export function spilloverLayer(network: Network, effects: RoadEffect[], opts: { opacity: number; highlightIds?: string[]; photoreal: boolean }) {
  const hl = new Set(opts.highlightIds ?? []);
  const data = dataFor(network, effects, opts.highlightIds ?? []);
  return new PathLayer<D>({
    id: "spillover",
    data,
    getPath: (d) => lift(d.path, opts.photoreal ? LIFT_M.spillover : 0),
    getColor: (d) => withAlpha(d.delta > 0 ? MAP_COLORS.loss : MAP_COLORS.gain, d.highlighted ? 255 : 120 + Math.min(1, Math.abs(d.delta) * 4) * 135),
    getWidth: (d) => (d.highlighted ? 6 : 3),
    widthUnits: "pixels",
    capRounded: true,
    opacity: opts.opacity,
    updateTriggers: { getColor: [...hl].join(), getWidth: [...hl].join(), getPath: opts.photoreal },
    ...terrainProps(opts.photoreal),
  });
}
