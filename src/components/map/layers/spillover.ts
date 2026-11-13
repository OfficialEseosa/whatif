/** Road spillover: roads whose volume/capacity changes, colored red (worse) / green (better). */
import { PathLayer } from "@deck.gl/layers";
import type { Network, NetworkRoad, RoadEffect } from "@/lib/contract";
import { MAP_COLORS, withAlpha } from "../colors";
import { overlayProps } from "./common";

type D = NetworkRoad & { delta: number; highlighted: boolean };

export function spilloverLayer(network: Network, effects: RoadEffect[], opts: { opacity: number; highlightIds?: string[]; photoreal: boolean }) {
  const byId = new Map(effects.map((e) => [e.roadId, e]));
  const hl = new Set(opts.highlightIds ?? []);
  const data: D[] = [];
  for (const r of network.roads) {
    const e = byId.get(r.id);
    if (!e) continue;
    const delta = e.vcProposed - e.vcBaseline;
    if (Math.abs(delta) < 0.03 && !hl.has(r.id)) continue;
    data.push({ ...r, delta, highlighted: hl.has(r.id) });
  }
  return new PathLayer<D>({
    id: "spillover",
    data,
    getPath: (d) => d.path,
    getColor: (d) => withAlpha(d.delta > 0 ? MAP_COLORS.loss : MAP_COLORS.gain, d.highlighted ? 255 : 120 + Math.min(1, Math.abs(d.delta) * 4) * 135),
    getWidth: (d) => (d.highlighted ? 6 : 3),
    widthUnits: "pixels",
    capRounded: true,
    opacity: opts.opacity,
    updateTriggers: { getColor: [...hl].join(), getWidth: [...hl].join() },
    ...overlayProps(opts.photoreal),
  });
}
