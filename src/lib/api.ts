/** Typed client for the app's API routes. Validates every response against the contract. */
import {
  NetworkSchema,
  PersonaResponseSchema,
  PlanResponseSchema,
  ScenarioResultSchema,
  type Network,
  type PersonaRequest,
  type PlanRequest,
  type ScenarioResult,
  type SimulateRequest,
} from "@/lib/contract";
import type { ZodType } from "zod";

async function call<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ? `${url}: ${json.error}` : `${url}: HTTP ${res.status}`);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error(url, parsed.error.issues.slice(0, 10));
    throw new Error(`${url}: response does not match the contract`);
  }
  return parsed.data;
}
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  plan: (req: PlanRequest) => call("/api/plan", PlanResponseSchema, post(req)),
  simulate: (req: SimulateRequest) => call("/api/simulate", ScenarioResultSchema, post(req)),
  persona: (req: PersonaRequest) => call("/api/persona", PersonaResponseSchema, post(req)),
  /** Static context geometry (roads, rail, Beltline, overlays). */
  network: (url = "/scenarios/network.json"): Promise<Network> => call(url, NetworkSchema),
  /** Prebaked scenario file, used at boot to animate the baseline morning rush. */
  scenarioFile: (id: string): Promise<ScenarioResult> => call(`/scenarios/${id}.json`, ScenarioResultSchema),
  mapSession: async (): Promise<{ session: string; expiry: number } | null> => {
    const res = await fetch("/api/map-session");
    return res.ok ? res.json() : null;
  },
};
