/**
 * Known corridors: proposals we have a saved simulation run for.
 *
 * /api/simulate serves a prebaked run (public/scenarios/*.sim.json) only when
 * the edit equals the run's edit exactly (ignoring name/assumptions). A short
 * prompt like "extend the streetcar to Ponce City Market" names the terminus
 * but not the route, intermediate stops, headway or lane changes, so the
 * deterministic parser's edit never matches. When a parsed edit is clearly
 * the studied proposal, `resolveKnownCorridor` fills in what the user left out
 * from the corridor's canonical edit (and says so in `assumptions`).
 *
 * Rules:
 *   - only line edits (extend_line, or new_rail_line for "streetcar to X")
 *     with the corridor's tech, a compatible base line, the terminus among the
 *     stops and no stop outside the corridor's places;
 *   - values the user stated (headway, lanes removed) are kept even if they
 *     differ from the saved run (the edit then simply won't match it);
 *   - fix mode: when the parser found nothing it can simulate and the problem
 *     names an area the corridor serves, the corridor is offered as the plan.
 *
 * Add an entry here when a new saved run is added to public/scenarios.
 */
import type { PlanRequest, PlanResponse, ScenarioEdit, TransitTech } from "@/lib/contract";
import { cannedStreetcarEdit } from "@/lib/ai/mock";
import { PARSER_NOTE, parseLanesRemoved } from "./fallback";

export interface KnownCorridor {
  id: string;
  /** Plain-language description used in assumptions. */
  description: string;
  tech: TransitTech;
  baseLineId: string;
  /** Gazetteer id the line must reach. */
  terminusId: string;
  /** Gazetteer places a request may name and still mean this corridor (its stops and areas it runs through). */
  placeIds: string[];
  /** Fix mode: areas this corridor serves. */
  serves: RegExp;
  /** The edit the saved run was built from (must equal that run's `edit`). */
  edit: () => ScenarioEdit;
}

export const KNOWN_CORRIDORS: KnownCorridor[] = [
  {
    id: "streetcar_east_pcm",
    description: "the studied Streetcar East route (Edgewood Ave and the Beltline Eastside Trail to Ponce City Market)",
    tech: "streetcar",
    baseLineId: "atlanta_streetcar",
    terminusId: "ponce_city_market",
    placeIds: [
      ...cannedStreetcarEdit().stops.map((s) => s.gazetteerId),
      "beltline_ralph_mcgill",
      "beltline_ponce",
      "krog_street_market",
      "old_fourth_ward",
      "inman_park",
    ],
    serves: /\beast ?side\b|\bold fourth ward\b|\bo4w\b|\binman park\b|\bponce city market\b|\bedgewood\b|\bbeltline\b/i,
    edit: cannedStreetcarEdit,
  },
];

const LINE_TYPES = new Set<ScenarioEdit["type"]>(["extend_line", "new_rail_line"]);

/** Parser notes that no longer hold once the corridor fills the route in. */
const STALE_PREFIXES = ["Only one place found", "Assumed base line is", "Assumed streetcar technology", "No gazetteer place found"];

export function matchesCorridor(edit: ScenarioEdit, corridor: KnownCorridor): boolean {
  if (!LINE_TYPES.has(edit.type) || edit.tech !== corridor.tech) return false;
  if (edit.baseLineId !== undefined && edit.baseLineId !== corridor.baseLineId) return false;
  const ids = edit.stops.map((s) => s.gazetteerId);
  return ids.includes(corridor.terminusId) && ids.every((id) => corridor.placeIds.includes(id));
}

/** True when the edit gives the simulator something to change (places, roads, a line, or a zone). */
export function isActionable(edit: ScenarioEdit): boolean {
  if (edit.type === "congestion_charge") return true;
  if (edit.roadIds?.length || edit.baseLineId) return true;
  return LINE_TYPES.has(edit.type) || edit.type === "new_bus_route" ? edit.stops.length >= 2 : edit.stops.length > 0;
}

/** "keep all car lanes", "without removing a lane", "no lane removal" -> 0 lanes removed. */
const KEEP_LANES_RX = /\bkeep(ing)?\b[^.]{0,20}\blanes?\b|\bwithout (removing|taking|losing)\b[^.]{0,20}\blanes?\b|\bno lanes? (removed|removal|taken)\b/i;

function corridorEdit(corridor: KnownCorridor, parsed: ScenarioEdit, text: string, note: string): ScenarioEdit {
  const base = corridor.edit();
  const filled: string[] = ["route", "intermediate stops"];
  const kept: string[] = [];
  let headwayMin = base.headwayMin;
  if (parsed.headwayMin !== undefined && parsed.headwayMin !== base.headwayMin) {
    headwayMin = parsed.headwayMin;
    kept.push(`your ${parsed.headwayMin}-minute headway`);
  } else if (parsed.headwayMin === undefined) filled.push(`${base.headwayMin}-minute headway`);
  let lanesRemoved = base.lanesRemoved;
  const statedLanes = KEEP_LANES_RX.test(text) ? 0 : parseLanesRemoved(text);
  if (statedLanes !== undefined && statedLanes !== base.lanesRemoved) {
    lanesRemoved = statedLanes;
    kept.push(`${statedLanes} car lane${statedLanes === 1 ? "" : "s"} removed, as stated`);
  } else if (statedLanes === undefined) filled.push(`removal of ${base.lanesRemoved} Edgewood Ave car lane`);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  const assumptions = [
    PARSER_NOTE,
    note,
    `The ${list(filled)} were filled in from ${corridor.description}.`,
    ...(parsed.type !== base.type ? [`Treated as ${base.type === "extend_line" ? "an extension of" : "a change to"} the existing line ("${corridor.baseLineId}").`] : []),
    ...(kept.length ? [`Kept ${list(kept)}, so this differs from the saved simulation run.`] : []),
    ...(parsed.assumptions ?? []).filter((a) => a !== PARSER_NOTE && !STALE_PREFIXES.some((p) => a.startsWith(p))),
  ];
  return {
    ...base,
    ...(headwayMin !== undefined ? { headwayMin } : {}),
    ...(lanesRemoved !== undefined ? { lanesRemoved } : {}),
    assumptions,
  };
}

/**
 * Bridge a parsed plan to a known corridor when it is clearly that proposal.
 * Returns the response unchanged otherwise. `claims`, `candidates` and `isMock` are kept.
 */
export function resolveKnownCorridor(req: PlanRequest, res: PlanResponse, corridors: KnownCorridor[] = KNOWN_CORRIDORS): PlanResponse {
  const direct = corridors.find((c) => matchesCorridor(res.edit, c));
  if (direct) return { ...res, edit: corridorEdit(direct, res.edit, req.text, "Matched a studied corridor that has a saved simulation run.") };
  if (req.mode === "fix" && !isActionable(res.edit)) {
    const served = corridors.find((c) => c.serves.test(req.text));
    if (served) {
      const note = "Fix mode: the keyword parser cannot design a fix, so this suggests a studied corridor that serves the area you named.";
      return { ...res, edit: corridorEdit(served, { ...res.edit, type: served.edit().type, headwayMin: undefined }, req.text, note) };
    }
  }
  return res;
}
