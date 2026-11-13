/** Plain-word lines and formatting for the run panel. Presentation only. */
import type { LngLat, Network, ScenarioEdit, ScenarioResult } from "@/lib/contract";
import { scenarioSource } from "@/lib/provenance";

const TECH_NOUN: Record<string, string> = {
  streetcar: "streetcar",
  light_rail: "light rail",
  heavy_rail: "rail line",
  bus: "bus",
  brt: "rapid bus",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Duration for the timing column. Running: tenths under 10 s, then whole seconds.
 * Finished: tenths; steps under 50 ms show nothing (they are local lookups).
 */
export function fmtDur(ms: number, running = false): string {
  const v = Math.max(0, ms);
  if (!running && v < 50) return "";
  if (running && v >= 10_000) return `${Math.floor(v / 1000)} s`;
  if (!running && v >= 60_000) return `${Math.floor(v / 60_000)} m ${String(Math.round((v % 60_000) / 1000)).padStart(2, "0")} s`;
  return `${(v / 1000).toFixed(1)} s`;
}

export const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** Straight-line km along the stops (not the routed track). */
export function stopsKm(stops: { coord: LngLat }[]): number {
  let km = 0;
  for (let i = 1; i < stops.length; i++) {
    const [a, b] = [stops[i - 1].coord, stops[i].coord];
    const kx = 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    km += Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57);
  }
  return km;
}

export type SourceKind = "live" | "saved" | "mock";
export function sourceKind(r: ScenarioResult): SourceKind {
  const src = r.isMock ? "mock" : scenarioSource(r);
  return src === "live_sim" ? "live" : src === "prebaked_sim" ? "saved" : "mock";
}
export const SOURCE_WORDS: Record<SourceKind, string> = { live: "live simulation", saved: "saved run", mock: "sample data" };

/** "Extend the streetcar, 6 stops, every 10 min" */
export function planLine(e: ScenarioEdit): string {
  const tech = e.tech ? (TECH_NOUN[e.tech] ?? e.tech) : "line";
  let head: string;
  switch (e.type) {
    case "extend_line":
      head = `Extend the ${tech}`;
      break;
    case "new_rail_line":
      head = `New ${tech} line`;
      break;
    case "new_bus_route":
      head = "New bus route";
      break;
    case "change_frequency":
      head = e.headwayMin !== undefined ? `${cap(tech)} every ${e.headwayMin} min` : `Change how often the ${tech} runs`;
      break;
    case "brt_lane":
      head = "Bus lane";
      break;
    case "new_road":
      head = "New road";
      break;
    case "close_road":
      head = "Close a road";
      break;
    case "congestion_charge":
      head = "Congestion charge";
      break;
  }
  const parts = [head];
  if (e.stops.length) parts.push(`${e.stops.length} stops`);
  if (e.headwayMin !== undefined && e.type !== "change_frequency") parts.push(`every ${e.headwayMin} min`);
  if (e.chargeUsd !== undefined) parts.push(`$${e.chargeUsd.toFixed(2)} per entry`);
  return parts.join(", ");
}

function names(list: string[]): string {
  const u = [...new Set(list)];
  if (u.length <= 2) return u.join(" and ");
  return `${u.slice(0, 2).join(", ")} and ${u.length - 2} more`;
}

/** "6 stops added, 1 lane removed on Edgewood Ave" */
export function editLine(e: ScenarioEdit, network: Network | null): string {
  const roads = new Map(network?.roads.map((r) => [r.id, r.name]) ?? []);
  const roadNames = (e.roadIds ?? []).map((id) => roads.get(id) || "an unnamed road");
  const parts: string[] = [];
  if (e.stops.length) parts.push(`${e.stops.length} stops added`);
  if (roadNames.length) {
    if (e.lanesRemoved) parts.push(`${e.lanesRemoved} ${e.lanesRemoved === 1 ? "lane" : "lanes"} removed on ${names(roadNames)}`);
    else if (e.type === "close_road") parts.push(`${names(roadNames)} closed`);
    else if (e.type === "new_road") parts.push(`${roadNames.length} road segments added`);
    else parts.push(`${roadNames.length} road segments changed`);
  }
  if (e.type === "change_frequency" && e.headwayMin !== undefined) {
    const line = network?.rail.find((r) => r.id === e.baseLineId)?.name ?? e.baseLineId ?? "the line";
    parts.push(`${line} every ${e.headwayMin} min`);
  }
  if (e.chargeUsd !== undefined) parts.push(`$${e.chargeUsd.toFixed(2)} to enter the zone`);
  return parts.length ? parts.join(", ") : "No change to the network";
}

/** "272,994 commuters, saved run" */
export function routeLine(r: ScenarioResult): string {
  return `${int(r.metrics.proposed.populationModeled)} commuters, ${SOURCE_WORDS[sourceKind(r)]}`;
}

/** "Poor, 5 tests" */
export function scoreLine(r: ScenarioResult): string {
  return `${cap(r.verdict.label)}, ${r.verdict.tests.length} tests`;
}
