// POST /api/simulate  { edit, claims? } -> ScenarioResult   (owner: Raphael)
//
// Resolution order (falls through on any failure, never 5xx for a valid request):
//   1. prebaked sim run public/scenarios/*.sim.json whose edit matches (instant)
//   2. live sim at `${SIM_URL}/simulate` (if SIM_URL is set and answers in time)
//   3. frontend mock public/scenarios/beltline-streetcar.json
// The result carries `source` ("live_sim" | "prebaked_sim" | "mock") and `mockSections`;
// the same source is in the `X-Scenario-Source` response header.
// Stored results (2 and 3, or a prebaked file the sim served) come back as a small SimulatePointer
// to the static file instead of the body: Vercel caps function responses at 4.5 MB.
// When the request carries article claims, `claims` is recomputed from the chosen result
// (compareClaims), so the article check always matches the numbers on screen; a pointer carries them.
import { ScenarioResultSchema, SimulateRequestSchema, type ScenarioResult, type SimulatePointer, type ScenarioSource, type SimulateRequest } from "@/lib/contract";
import { compareClaims } from "@/lib/ai/article/compareClaims";
import { access } from "node:fs/promises";
import path from "node:path";
import { readBody } from "@/lib/http";
import { MOCK_SCENARIO_ID, annotate, findPrebakedSim, readMockScenario } from "@/lib/scenarios";

export const maxDuration = 60;
const LIVE_TIMEOUT_MS = 40_000; // live runs take ~13 s (sim/README.md)

async function fromLiveSim(body: SimulateRequest): Promise<{ result: ScenarioResult; source: ScenarioSource } | null> {
  const simUrl = process.env.SIM_URL;
  if (!simUrl) return null;
  try {
    const res = await fetch(new URL("/simulate", simUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[simulate] sim service returned ${res.status}; falling back`);
      return null;
    }
    const parsed = ScenarioResultSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.warn("[simulate] sim result does not match the contract; falling back", parsed.error.issues.slice(0, 5));
      return null;
    }
    // sim/main.py serves a matching prebaked file itself and says so in X-Sim-Source.
    const source: ScenarioSource = res.headers.get("x-sim-source") === "prebaked" ? "prebaked_sim" : "live_sim";
    return { result: parsed.data, source };
  } catch (e) {
    console.warn(`[simulate] sim service unreachable (${e instanceof Error ? e.message : e}); falling back`);
    return null;
  }
}

export async function POST(req: Request) {
  const [body, err] = await readBody(req, SimulateRequestSchema);
  if (err) return err;

  // A saved run of this exact edit answers instantly; only then is the live sim worth the wait.
  const prebaked = await findPrebakedSim(body.edit);
  let picked: { result: ScenarioResult; source: ScenarioSource } | null = prebaked ? { result: prebaked, source: "prebaked_sim" } : null;
  if (!picked) picked = await fromLiveSim(body);
  // TODO(Raphael): the mock is always the streetcar scenario, whatever the edit says.
  if (!picked) picked = { result: await readMockScenario(MOCK_SCENARIO_ID), source: "mock" };

  const out = annotate(picked.result, picked.source);
  // Article claims are only meaningful when the plan came from an article.
  if (!body.claims?.length) out.claims = [];
  else {
    out.claims = compareClaims(body.claims, out);
    out.mockSections = out.mockSections?.filter((k) => k !== "claims");
  }
  if (picked.source !== "live_sim") {
    // Stored files are named after the result id (<id>.sim.json, mock <id>.json); see src/lib/scenarios.ts.
    const file = picked.source === "mock" ? `${MOCK_SCENARIO_ID}.json` : `${picked.result.id}.sim.json`;
    const onDisk = await access(path.join(process.cwd(), "public", "scenarios", file)).then(() => true, () => false);
    if (onDisk) {
      const pointer: SimulatePointer = {
        source: picked.source,
        scenarioUrl: `/scenarios/${file}`,
        mockSections: out.mockSections ?? [],
        isMock: out.isMock,
        matched: picked.source === "prebaked_sim",
        ...(body.claims?.length ? { claims: out.claims } : {}),
      };
      return Response.json(pointer, { headers: { "X-Scenario-Source": picked.source } });
    }
  }
  return Response.json(out, { headers: { "X-Scenario-Source": picked.source } });
}
