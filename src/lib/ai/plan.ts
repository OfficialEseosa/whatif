/**
 * Plan parsing: plain English / article text -> ScenarioEdit (+ claims). Owner: Samuel.
 */
import type { PlanRequest, PlanResponse } from "@/lib/contract";
import { fallbackPlan } from "./plan/fallback";
import { resolveKnownCorridor } from "./plan/corridors";

export async function parsePlan(req: PlanRequest): Promise<PlanResponse> {
  return resolveKnownCorridor(req, fallbackPlan(req));
}
