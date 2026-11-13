/**
 * Plan parsing: plain English / article text -> ScenarioEdit (+ claims). Owner: Samuel.
 */
import type { PlanRequest, PlanResponse } from "@/lib/contract";
import { fallbackPlan } from "./plan/fallback";
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

export async function parsePlan(req: PlanRequest): Promise<PlanResponse> {
  const byRules = fallbackPlan(req);
  let res = resolveKnownCorridor(req, byRules);
  // A studied corridor keeps its saved run untouched. Anything else is read by Claude when it answers;
  // the keyword rules stay as the fallback. Fix mode still uses the rules.
  const studied = KNOWN_CORRIDORS.some((c) => matchesCorridor(byRules.edit, c));
  if (!studied && req.mode !== "fix") {
    const hints = await readPlanWithClaude(req);
    if (hints) res = resolveKnownCorridor(req, fallbackPlan(req, { hints }));
  }
  // An article whose claims were extracted is still worth answering; anything else with nothing to place is not.
  const hasClaims = (res.claims?.length ?? 0) > 0;
  if (res.edit.stops.length === 0 && !isActionable(res.edit) && !hasClaims) throw new UnplaceablePlanError();
  return res;
}
