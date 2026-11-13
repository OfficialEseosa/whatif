/**
 * Plan parsing: plain English / article text -> ScenarioEdit (+ claims). Owner: Samuel.
 */
import type { PlanRequest, PlanResponse, ScenarioEdit, Stop } from "@/lib/contract";
import { fallbackPlan, type PlanHints } from "./plan/fallback";
import { toStop } from "./plan/gazetteer";
import { findRoadIdsByName } from "./plan/network";
import { readPlanWithClaude } from "./plan/claude";
import { KNOWN_CORRIDORS, isActionable, matchesCorridor, resolveKnownCorridor } from "./plan/corridors";

/** The text names nothing the simulator can act on (no place, road or line). The route answers 422. */
export class UnplaceablePlanError extends Error {
  constructor() {
    super(
      "Couldn't find a place, road or transit line from the WhatIf map in that text. " +
        'Try naming a station, neighborhood or street, e.g. "extend the streetcar to Ponce City Market".',
    );
    this.name = "UnplaceablePlanError";
  }
}

/**
 * A follow-up that keeps the kind of plan ("every 5 minutes", "add a stop at Krog Street"): the plan on
 * screen with only what was asked changed, so its route, streets and lanes carry over. Null when the
 * text is a new plan or changes the kind of plan; those are built from scratch.
 */
function applyFollowUp(prev: ScenarioEdit, hints: PlanHints): ScenarioEdit | null {
  if (!hints.changesPrevious || hints.type !== prev.type || (hints.tech ?? prev.tech) !== prev.tech) return null;
  const stops = (hints.stopIds ?? []).map((id) => toStop(id)).filter((s): s is Stop => s !== undefined);
  const roadIds = [...new Set((hints.roadNames ?? []).flatMap((name) => findRoadIdsByName(name)))];
  return {
    ...prev,
    name: hints.name ?? prev.name,
    stops: stops.length > 0 ? stops : prev.stops,
    ...(hints.headwayMin !== undefined ? { headwayMin: hints.headwayMin } : {}),
    ...(hints.lanesRemoved !== undefined ? { lanesRemoved: hints.lanesRemoved } : {}),
    ...(hints.chargeUsd !== undefined ? { chargeUsd: hints.chargeUsd } : {}),
    ...(roadIds.length > 0 ? { roadIds } : {}),
    assumptions: hints.notes ?? [],
  };
}

export async function parsePlan(req: PlanRequest): Promise<PlanResponse> {
  const byRules = fallbackPlan(req);
  let res = resolveKnownCorridor(req, byRules);
  // A studied corridor keeps its saved run untouched. Anything else is read by Claude when it answers;
  // the keyword rules stay as the fallback. Fix mode still uses the rules.
  const studied = KNOWN_CORRIDORS.some((c) => matchesCorridor(byRules.edit, c));
  if (!studied && req.mode !== "fix") {
    const hints = await readPlanWithClaude(req);
    const changed = hints && req.previousEdit ? applyFollowUp(req.previousEdit, hints) : null;
    if (changed) res = { edit: changed, isMock: false };
    else if (hints) res = resolveKnownCorridor(req, fallbackPlan(req, { hints }));
  }
  // An article whose claims were extracted is still worth answering; anything else with nothing to place is not.
  const hasClaims = (res.claims?.length ?? 0) > 0;
  if (res.edit.stops.length === 0 && !isActionable(res.edit) && !hasClaims) throw new UnplaceablePlanError();
  return res;
}
