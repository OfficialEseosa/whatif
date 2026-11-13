/** Typed client for the app's API routes. Validates every response against the contract. */
import {
  NetworkSchema,
  PersonaResponseSchema,
  PlanResponseSchema,
  ScenarioResultSchema,
  SimulatePointerSchema,
  type Network,
  type PersonaRequest,
  type PlanRequest,
  type ScenarioResult,
  type ScenarioSource,
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

/** Timings of one /api/simulate call, for the run panel. */
export type SimulateTiming = {
  /** The POST to /api/simulate. */
  routeMs: number;
  /** Set when the route pointed at a stored file: the static fetch of it. */
  file: { url: string; ms: number; bytes: number } | null;
};

/**
 * POST /api/simulate. Stored results come back as a pointer (Vercel caps function responses at 4.5 MB):
 * fetch the static file, validate it, and stamp source / mockSections / isMock as the route used to.
 */
async function simulate(req: SimulateRequest): Promise<{ result: ScenarioResult; source: ScenarioSource; timing: SimulateTiming }>;
async function simulate(
  req: SimulateRequest,
  opts: { skipMock: true },
): Promise<{ result: ScenarioResult | null; source: ScenarioSource; timing: SimulateTiming }>;
/**
 * `skipMock`: when the server has no simulation for this edit it points at the placeholder scenario
 * (always the streetcar). Return `result: null` instead of loading another plan's numbers.
 */
async function simulate(req: SimulateRequest, opts?: { skipMock: true }): Promise<{ result: ScenarioResult | null; source: ScenarioSource; timing: SimulateTiming }> {
  const t0 = performance.now();
  const res = await fetch("/api/simulate", post(req));
  const json = await res.json().catch(() => null);
  const routeMs = performance.now() - t0;
  if (!res.ok) throw new Error(json?.error ? `/api/simulate: ${json.error}` : `/api/simulate: HTTP ${res.status}`);
  if (json && typeof json === "object" && "scenarioUrl" in json) {
    const ptr = SimulatePointerSchema.safeParse(json);
    if (!ptr.success) throw new Error("/api/simulate: pointer does not match the contract");
    if (opts?.skipMock && ptr.data.source === "mock") return { result: null, source: "mock" as const, timing: { routeMs, file: null } };
    const t1 = performance.now();
    const fileRes = await fetch(ptr.data.scenarioUrl);
    if (!fileRes.ok) throw new Error(`${ptr.data.scenarioUrl}: HTTP ${fileRes.status}`);
    const text = await fileRes.text();
    const parsed = ScenarioResultSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.error(ptr.data.scenarioUrl, parsed.error.issues.slice(0, 10));
      throw new Error(`${ptr.data.scenarioUrl}: file does not match the contract`);
    }
    const { source, mockSections, isMock } = ptr.data;
    const result: ScenarioResult = {
      ...parsed.data,
      source,
      mockSections: mockSections ?? parsed.data.mockSections ?? [],
      isMock: isMock ?? (source === "mock" || parsed.data.isMock),
      // Article claims are only meaningful when the plan came from an article (as the route did).
      claims: req.claims?.length ? (ptr.data.claims ?? parsed.data.claims) : [],
    };
    return { result, source, timing: { routeMs, file: { url: ptr.data.scenarioUrl, ms: performance.now() - t1, bytes: text.length } } };
  }
  const parsed = ScenarioResultSchema.safeParse(json);
  if (!parsed.success) {
    console.error("/api/simulate", parsed.error.issues.slice(0, 10));
    throw new Error("/api/simulate: response does not match the contract");
  }
  const source: ScenarioSource = parsed.data.source ?? (parsed.data.isMock ? "mock" : "live_sim");
  if (opts?.skipMock && source === "mock") return { result: null, source, timing: { routeMs, file: null } };
  return { result: parsed.data, source, timing: { routeMs, file: null } };
}

export const api = {
  plan: (req: PlanRequest) => call("/api/plan", PlanResponseSchema, post(req)),
  simulate: (req: SimulateRequest) => simulate(req).then((r) => r.result),
  /** Like simulate, plus where the time went; `result` is null when there is no simulation for the edit. */
  simulateTimed: (req: SimulateRequest) => simulate(req, { skipMock: true }),
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
