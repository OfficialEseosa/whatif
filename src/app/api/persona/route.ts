// POST /api/persona  { scenarioId, personaId, messages } -> PersonaResponse   (owner: Samuel)
import { PersonaRequestSchema, type PersonaResponse } from "@/lib/contract";
import { apiError, readBody } from "@/lib/http";
import { readMockScenario, readScenario } from "@/lib/scenarios";
import { personaReply } from "@/lib/ai/persona";

export async function POST(req: Request) {
  const [body, err] = await readBody(req, PersonaRequestSchema);
  if (err) return err;
  // TODO(Samuel): when the sim is live, scenarios won't be files; pass personas in the request or cache results server-side.
  const scenario = await readScenario(body.scenarioId).catch(() => null);
  if (!scenario) return apiError(404, `unknown scenario "${body.scenarioId}"`);
  const persona =
    scenario.personas.find((p) => p.id === body.personaId) ??
    (await readMockScenario(body.scenarioId).catch(() => null))?.personas.find((p) => p.id === body.personaId);
  if (!persona) return apiError(404, `unknown persona "${body.personaId}"`);
  const reply = await personaReply(scenario, persona, body.messages);
  const out: PersonaResponse = { personaId: persona.id, reply, isMock: true }; // TODO(Samuel): false once Claude answers
  return Response.json(out);
}
