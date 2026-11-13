// POST /api/plan  { text, mode } -> PlanResponse   (owner: Samuel)
import { PlanRequestSchema, PlanResponseSchema, checkEditAgainstGazetteer } from "@/lib/contract";
import { apiError, readBody } from "@/lib/http";
import { UnplaceablePlanError, parsePlan } from "@/lib/ai/plan";
import { gazetteer } from "@/lib/ai/mock";

export async function POST(req: Request) {
  const [body, err] = await readBody(req, PlanRequestSchema);
  if (err) return err;
  let plan;
  try {
    plan = await parsePlan(body);
  } catch (e) {
    if (e instanceof UnplaceablePlanError) return apiError(422, e.message);
    throw e;
  }
  const out = PlanResponseSchema.safeParse(plan);
  if (!out.success) return apiError(502, "plan parser returned an invalid edit", out.error.issues);
  const problems = checkEditAgainstGazetteer(out.data.edit, gazetteer);
  if (problems.length) return apiError(422, "edit references places outside the gazetteer", problems);
  return Response.json(out.data);
}
