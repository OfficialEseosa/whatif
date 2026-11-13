/**
 * Plan parsing: plain English / article text -> ScenarioEdit (+ claims). Owner: Samuel.
 */
import type { PlanRequest, PlanResponse } from "@/lib/contract";
import { CANNED_CLAIMS, cannedStreetcarEdit } from "./mock";

export async function parsePlan(req: PlanRequest): Promise<PlanResponse> {
  // TODO(Samuel): call Claude here when process.env.ANTHROPIC_API_KEY is set.
  //  - Give it the gazetteer (src/data/gazetteer.json) and the ScenarioEdit schema;
  //    stops may ONLY use gazetteer ids (the route re-checks with checkEditAgainstGazetteer).
  //  - mode "article": also extract claims (short verbatim quotes + metric + claimedValue).
  //  - mode "fix": return `candidates` (several edits), `edit` = the best one.
  //  - On a bad edit: one retry, then fall back to the canned edit below.
  const edit = cannedStreetcarEdit();
  return {
    edit,
    claims: req.mode === "article" ? CANNED_CLAIMS : undefined,
    isMock: true,
  };
}
