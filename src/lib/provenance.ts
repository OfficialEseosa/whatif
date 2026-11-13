/** Where the numbers on screen come from. Pure helpers; the UI decides how to show them. */
import type { ScenarioResult, ScenarioSource } from "@/lib/contract";

export function scenarioSource(s: ScenarioResult): ScenarioSource {
  return s.source ?? (s.isMock ? "mock" : "prebaked_sim");
}

export const SOURCE_LABEL: Record<ScenarioSource, string> = {
  live_sim: "Live simulation",
  prebaked_sim: "Prebaked simulation run",
  mock: "Mock data · every number is a placeholder",
};

/**
 * True when `key` (e.g. "verdict.headline", "verdict.tests.cost_per_rider") is mock-derived inside a
 * sim result. False for whole-mock scenarios: the banner already says everything is mock.
 */
export function isMockSection(s: ScenarioResult | null | undefined, key: string): boolean {
  if (!s || s.isMock || !s.mockSections) return false;
  return s.mockSections.some((k) => key === k || key.startsWith(`${k}.`));
}
