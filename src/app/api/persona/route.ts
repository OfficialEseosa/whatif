// POST /api/persona  { scenarioId, personaId, messages } -> PersonaResponse   (owner: Samuel)
import { PersonaRequestSchema, type PersonaResponse } from "@/lib/contract";
import { apiError, readBody } from "@/lib/http";
import { readMockScenario, readScenario } from "@/lib/scenarios";
import { personaReply } from "@/lib/ai/persona";

export const maxDuration = 30;

export async function POST(req: Request) {
  const [body, err] = await readBody(req, PersonaRequestSchema);
  if (err) return err;
  // A live run is not a stored file: the client sends the resident and the plan's results with the question.
  if (body.persona && body.context) {
    const { reply, isMock } = await personaReply(body.persona, body.messages, body.context);
    const live: PersonaResponse = { personaId: body.persona.id, reply, isMock };
    return Response.json(live);
  }
  const scenario = await readScenario(body.scenarioId).catch(() => null);
  if (!scenario) return apiError(404, `unknown scenario "${body.scenarioId}"`);
  const persona =
    scenario.personas.find((p) => p.id === body.personaId) ??
    (await readMockScenario(body.scenarioId).catch(() => null))?.personas.find((p) => p.id === body.personaId);
  if (!persona) return apiError(404, `unknown persona "${body.personaId}"`);
  const { reply, isMock } = await personaReply(persona, body.messages);
  const out: PersonaResponse = { personaId: persona.id, reply, isMock };
  return Response.json(out);
}
