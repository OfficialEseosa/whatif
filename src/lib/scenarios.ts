/**
 * Server-only helpers for reading prebaked scenario files from public/scenarios.
 * Owner: Raphael. Used by /api/simulate (mock fallback) and /api/persona.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ScenarioResultSchema, type ScenarioResult } from "@/lib/contract";

export const MOCK_SCENARIO_ID = "beltline-streetcar";

const cache = new Map<string, Promise<ScenarioResult>>();

/** Loads and validates public/scenarios/<id>.json (cached per process). */
export function readScenario(id: string): Promise<ScenarioResult> {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) return Promise.reject(new Error(`bad scenario id "${id}"`));
  let p = cache.get(id);
  if (!p) {
    p = readFile(path.join(process.cwd(), "public", "scenarios", `${id}.json`), "utf8").then((raw) =>
      ScenarioResultSchema.parse(JSON.parse(raw)),
    );
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}
