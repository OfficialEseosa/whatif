/**
 * Server-only helpers for scenario files in public/scenarios and source labeling.
 * Owner: Raphael. Used by /api/simulate and /api/persona.
 *
 *   <id>.json      frontend mock (scripts/make-mock-scenario.mjs)
 *   <id>.sim.json  prebaked Python sim runs (sim/run.py)
 */
import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  ScenarioResultSchema,
  type ScenarioEdit,
  type ScenarioResult,
  type ScenarioSource,
} from "@/lib/contract";

export const MOCK_SCENARIO_ID = "beltline-streetcar";
const DIR = path.join(process.cwd(), "public", "scenarios");

const cache = new Map<string, { mtimeMs: number; size: number; result: Promise<ScenarioResult> }>();

/**
 * Loads and validates public/scenarios/<file>. Cached per process, but re-read when the file's
 * mtime or size changes, so a re-baked *.sim.json is picked up without restarting the server.
 */
async function readFileScenario(file: string): Promise<ScenarioResult> {
  if (!/^[a-z0-9][a-z0-9.-]*\.json$/.test(file)) throw new Error(`bad scenario file "${file}"`);
  const full = path.join(DIR, file);
  const st = await stat(full); // throws if missing (callers fall back)
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.result;
  const result = readFile(full, "utf8").then((raw) => ScenarioResultSchema.parse(JSON.parse(raw)));
  result.catch(() => cache.delete(file));
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, result });
  return result;
}

/** The frontend mock scenario `<id>.json`. */
export const readMockScenario = (id: string) => readFileScenario(`${id}.json`);

/** Prefer the prebaked sim file for this id, else the mock. */
export async function readScenario(id: string): Promise<ScenarioResult> {
  return readFileScenario(`${id}.sim.json`).catch(() => readMockScenario(id));
}

/** Edit identity used to find a prebaked run: everything except name/assumptions (as sim/main.py does). */
export function editKey(edit: ScenarioEdit): string {
  const { name, assumptions, ...rest } = edit;
  void name;
  void assumptions;
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
        : v;
  return JSON.stringify(norm({ ...rest, roadIds: rest.roadIds ? [...rest.roadIds].sort() : undefined }));
}

/** Finds a prebaked `*.sim.json` whose edit matches. */
export async function findPrebakedSim(edit: ScenarioEdit): Promise<ScenarioResult | null> {
  const files = (await readdir(DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".sim.json")).sort();
  const want = editKey(edit);
  for (const f of files) {
    const s = await readFileScenario(f).catch(() => null);
    if (s && editKey(s.edit) === want) return s;
  }
  return null;
}

/**
 * Sections the current sim does not compute (sim/README.md "Copied from the frontend mock").
 * Used only when a sim result doesn't carry `mockSections` itself.
 */
export const SIM_DEFAULT_MOCK_SECTIONS = [
  "verdict.label",
  "verdict.headline",
  "verdict.summary",
  "verdict.grades",
  "verdict.alternatives",
  "verdict.tests.cost_per_rider",
  "verdict.tests.redlined_benefit_share",
  "verdict.tests.renters_rent_pressure",
  "impact.tiles",
  "impact.calibration",
  "whoPays.items",
  "claims",
  "personas",
  "lookahead",
  "tracts.equity",
  "agents.equity",
];

/** Stamps `source` and fills `mockSections` when the producer didn't. */
export function annotate(result: ScenarioResult, source: ScenarioSource): ScenarioResult {
  if (source === "mock") return { ...result, source, isMock: true, mockSections: result.mockSections ?? [] };
  let mockSections = result.mockSections;
  if (!mockSections) {
    const copied = result.impact.notes?.some((n) => /copied from the frontend mock/i.test(n));
    mockSections = copied ? SIM_DEFAULT_MOCK_SECTIONS : [];
  }
  return { ...result, source, mockSections };
}
