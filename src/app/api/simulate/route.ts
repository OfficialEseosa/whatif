// POST /api/simulate  { edit, claims? } -> ScenarioResult   (owner: Raphael)
//
// If SIM_URL is set, proxies to `${SIM_URL}/simulate` (the Python service in sim/)
// and validates the reply against the contract. Otherwise serves the prebaked mock
// public/scenarios/beltline-streetcar.json.
import { ScenarioResultSchema, SimulateRequestSchema } from "@/lib/contract";
import { apiError, readBody } from "@/lib/http";
import { MOCK_SCENARIO_ID, readScenario } from "@/lib/scenarios";

export const maxDuration = 60;

export async function POST(req: Request) {
  const [body, err] = await readBody(req, SimulateRequestSchema);
  if (err) return err;

  const simUrl = process.env.SIM_URL;
  if (simUrl) {
    // TODO(Raphael): agree on the exact path/timeout with sim/; add a prebaked-file fallback on failure if wanted.
    let res: Response;
    try {
      res = await fetch(new URL("/simulate", simUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(55_000),
      });
    } catch (e) {
      return apiError(502, "simulation service unreachable", String(e));
    }
    if (!res.ok) return apiError(502, `simulation service returned ${res.status}`, await res.text().catch(() => undefined));
    const parsed = ScenarioResultSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return apiError(502, "simulation result does not match the contract", parsed.error.issues.slice(0, 20));
    return Response.json(parsed.data);
  }

  // Mock: always the streetcar scenario, whatever the edit says.
  const mock = await readScenario(MOCK_SCENARIO_ID);
  return Response.json({ ...mock, claims: body.claims?.length ? mock.claims : [] });
}
