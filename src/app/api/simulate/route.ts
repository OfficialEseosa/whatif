// POST /api/simulate  { edit, claims? } -> ScenarioResult   (owner: Raphael)
//
// Resolution order:
//   1. prebaked sim run public/scenarios/*.sim.json whose edit matches (instant)
//   2. live sim at `${SIM_URL}/simulate` (if SIM_URL is set and answers in time)
//   3. nothing simulated it: a pointer to the placeholder file with `notSimulated` (reason "offline" when
//      SIM_URL is unset, "unsupported" when the sim says it can't run this plan). A live failure or
//      timeout is an error response (502/503/504), never a silent swap to other numbers.
// The result carries `source` ("live_sim" | "prebaked_sim" | "mock") and `mockSections`;
// the same source is in the `X-Scenario-Source` response header.
// Stored results (1 and 3, or a prebaked file the sim served) come back as a small SimulatePointer
// to the static file instead of the body: Vercel caps function responses at 4.5 MB.
// When the request carries article claims, `claims` is recomputed from the chosen result
// (compareClaims), so the article check always matches the numbers on screen; a pointer carries them.
import { ScenarioResultSchema, SimulateRequestSchema, type ScenarioResult, type SimulatePointer, type ScenarioSource, type SimulateRequest } from "@/lib/contract";
import { compareClaims } from "@/lib/ai/article/compareClaims";
import { access } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { apiError, readBody } from "@/lib/http";
import { MOCK_SCENARIO_ID, annotate, findPrebakedSim, readMockScenario } from "@/lib/scenarios";

// A live run of the full region takes tens of seconds; allow the function up to 90 s (Node runtime).
export const maxDuration = 90;
const LIVE_TIMEOUT_MS = 85_000;
/** Refuse absurd live responses (a full result is ~6 MB of JSON). */
const MAX_LIVE_BYTES = 40_000_000;
/** Above this, the JSON is gzipped here: Vercel caps function responses at 4.5 MB. */
const GZIP_OVER_BYTES = 3_000_000;

type Live =
  | { kind: "ok"; result: ScenarioResult; source: ScenarioSource }
  | { kind: "unsupported"; message?: string }
  | { kind: "error"; status: number; message: string };

/** The sim's own explanation from an error body ({detail} from FastAPI, or {error}). */
async function simMessage(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const m = typeof j.detail === "string" ? j.detail : typeof j.error === "string" ? j.error : undefined;
    if (m) return m.slice(0, 300);
  } catch {
    // not JSON
  }
  return text.trim().slice(0, 300) || undefined;
}

/** Live sim at SIM_URL, or null when none is configured. Failures are reported, never swapped for other numbers. */
async function fromLiveSim(body: SimulateRequest): Promise<Live | null> {
  const simUrl = process.env.SIM_URL;
  if (!simUrl) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SIM_TOKEN) headers["X-Sim-Token"] = process.env.SIM_TOKEN;
  let res: Response;
  try {
    res = await fetch(new URL("/simulate", simUrl), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.warn(`[simulate] sim service ${timedOut ? "timed out" : "unreachable"} (${e instanceof Error ? e.message : e})`);
    return { kind: "error", status: timedOut ? 504 : 503, message: "The simulator didn't respond." };
  }
  // 401/403: our token was refused, so for this site the simulator is effectively offline.
  if (res.status === 401 || res.status === 403) return null;
  // 400/422: the sim can't place this edit; 501: plan type not implemented.
  if (res.status === 400 || res.status === 422 || res.status === 501) return { kind: "unsupported", message: await simMessage(res) };
  if (!res.ok) {
    const m = await simMessage(res);
    console.warn(`[simulate] sim service returned ${res.status}: ${m ?? ""}`);
    return { kind: "error", status: 502, message: `The simulator failed (HTTP ${res.status})${m ? `: ${m}` : "."}` };
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_LIVE_BYTES) return { kind: "error", status: 502, message: "The simulator's result is too large." };
  const text = await res.text().catch(() => "");
  if (text.length > MAX_LIVE_BYTES) return { kind: "error", status: 502, message: "The simulator's result is too large." };
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // handled below
  }
  const parsed = ScenarioResultSchema.safeParse(json);
  if (!parsed.success) {
    console.warn("[simulate] sim result does not match the contract", parsed.error.issues.slice(0, 5));
    return { kind: "error", status: 502, message: "The simulator returned a result in the wrong format." };
  }
  // sim/main.py serves a matching prebaked file itself and says so in X-Sim-Source.
  const source: ScenarioSource = res.headers.get("x-sim-source") === "prebaked" ? "prebaked_sim" : "live_sim";
  return { kind: "ok", result: parsed.data, source };
}

/**
 * JSON response. A large body (a full live result) is sent gzipped as opaque bytes with
 * `X-Body-Encoding: gzip` (src/lib/api.ts unpacks it): Vercel caps function responses at 4.5 MB, and
 * a real Content-Encoding header would be compressed again by the framework.
 */
function json(data: unknown, headers: Record<string, string>): Response {
  const text = JSON.stringify(data);
  if (text.length <= GZIP_OVER_BYTES) return Response.json(data, { headers });
  return new Response(new Uint8Array(gzipSync(text)), { headers: { ...headers, "Content-Type": "application/octet-stream", "X-Body-Encoding": "gzip" } });
}

export async function POST(req: Request) {
  const [body, err] = await readBody(req, SimulateRequestSchema);
  if (err) return err;

  // A saved run of this exact edit answers instantly; only then is the live sim worth the wait.
  const prebaked = await findPrebakedSim(body.edit);
  let picked: { result: ScenarioResult; source: ScenarioSource } | null = prebaked ? { result: prebaked, source: "prebaked_sim" } : null;
  let notSimulated: SimulatePointer["notSimulated"];
  if (!picked) {
    const live = await fromLiveSim(body);
    if (live?.kind === "ok") picked = { result: live.result, source: live.source };
    else if (live?.kind === "error") return apiError(live.status, live.message);
    else notSimulated = live?.kind === "unsupported" ? { reason: "unsupported", ...(live.message ? { message: live.message } : {}) } : { reason: "offline" };
  }
  // Nothing simulated this edit: point at the placeholder file, flagged so the UI shows the plan, not these numbers.
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
        ...(notSimulated ? { notSimulated } : {}),
      };
      return Response.json(pointer, { headers: { "X-Scenario-Source": picked.source } });
    }
  }
  return json(out, { "X-Scenario-Source": picked.source });
}
