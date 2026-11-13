// POST /api/explain  { plan, verdict, metrics } -> { insight: { summary, followUps } | null }
import { readBody } from "@/lib/http";
import { ExplainRequestSchema, explainResult } from "@/lib/ai/explain";

export const maxDuration = 30;

export async function POST(req: Request) {
  const [body, err] = await readBody(req, ExplainRequestSchema);
  if (err) return err;
  return Response.json({ insight: await explainResult(body) });
}
