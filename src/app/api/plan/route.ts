import { fallbackPlan } from "@/lib/ai/plan/fallback";
import { PlanRequestSchema } from "@/lib/contract";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = PlanRequestSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      { error: "Invalid plan request.", issues: result.error.issues },
      { status: 400 },
    );
  }

  return Response.json(fallbackPlan(result.data));
}
