/**
 * Metric vocabulary for article claims (article-analyst).
 *
 * Every `ExtractedClaim.metric` produced by this lane is one of the keys below.
 * Each entry says exactly which `ScenarioResult` field(s) the claim can be checked
 * against in Phase 2 (`compareClaims`). `fields: null` means the simulation does
 * not model the quantity at all — such claims are still extracted (so the UI can
 * show them) but will be rated `"unsupported"`.
 *
 * Field paths use a small notation that `resolveMetricPath` understands:
 *   - `a.b.c`                      plain property access
 *   - `verdict.tests[key=x].value` first array element whose `key` equals `x`
 *   - `roads[].delayDeltaMin`      every element of an array (returns number[])
 *
 * Only real paths from `src/lib/contract.ts` (`ScenarioResultSchema`) are listed;
 * `tests/ai/article/metrics.test.ts` resolves each one against
 * `public/scenarios/beltline-streetcar.json` so a contract rename breaks the test
 * instead of silently producing "Not modeled".
 *
 * Unit conventions follow the contract: shares are fractions 0..1, money is USD,
 * minutes are door-to-door minutes, `time_saved` is person-hours per weekday.
 */
import type { ScenarioResult, VerdictTestKey } from "@/lib/contract";

export const METRIC_KEYS = [
  "daily_riders",
  "new_riders",
  "time_saved",
  "trip_minutes_saved",
  "avg_commute_min",
  "transit_share",
  "cost_per_rider",
  "capital_cost_usd",
  "headway_min",
  "traffic",
  "redlined_benefit_share",
  "renters_rent_pressure",
  "support_share",
  "oppose_share",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/**
 * How a claimed number should be read.
 *   count      — people, households, riders per day
 *   share      — fraction 0..1 of a population ("15%" → 0.15)
 *   pct_change — relative change ("cut traffic 20%" → 0.2); also a fraction
 *   money      — USD
 *   minutes    — minutes (per trip, per commute, or between vehicles)
 *   hours      — person-hours per weekday
 *   qualitative — no number expected; a number may still be attached if the
 *                 article gives one
 */
export type MetricKind = "count" | "share" | "pct_change" | "money" | "minutes" | "hours" | "qualitative";

export interface MetricDef {
  key: MetricKey;
  /** Short human label for UI/debug. */
  label: string;
  kind: MetricKind;
  /** Display unit of the simulation field(s), or null when nothing is modeled. */
  unit: string | null;
  /**
   * `ScenarioResult` paths the claim can be compared with, or `null` when the
   * simulation does not model the quantity. When several are listed, the first
   * is the primary one; the rest are related fields `compareClaims` may cite.
   */
  fields: readonly string[] | null;
  /** Verdict test with the same meaning, if any. */
  verdictTest?: VerdictTestKey;
  /** Whether "N%" in the article is converted to a fraction for this metric. */
  acceptsPercent: boolean;
  /** What the mapping means and its caveats. */
  note: string;
}

export const METRICS: Readonly<Record<MetricKey, MetricDef>> = {
  daily_riders: {
    key: "daily_riders",
    label: "Daily transit riders",
    kind: "count",
    unit: "riders/day",
    fields: ["metrics.proposed.dailyTransitRiders", "metrics.baseline.dailyTransitRiders", "verdict.tests[key=new_riders].value"],
    acceptsPercent: false,
    note:
      "Article says the line/system would carry N riders a day. The model reports total " +
      "modeled transit riders (baseline and proposed) and the number who switched " +
      "(new_riders); it does not report boardings on one line only.",
  },
  new_riders: {
    key: "new_riders",
    label: "New transit riders",
    kind: "count",
    unit: "riders/day",
    fields: ["verdict.tests[key=new_riders].value"],
    verdictTest: "new_riders",
    acceptsPercent: false,
    note: "Daily riders who switched from driving (verdict test new_riders).",
  },
  time_saved: {
    key: "time_saved",
    label: "Time saved per weekday",
    kind: "hours",
    unit: "hrs/day",
    fields: ["verdict.tests[key=time_saved].value"],
    verdictTest: "time_saved",
    acceptsPercent: false,
    note: "Net person-hours saved per weekday across all modeled commuters.",
  },
  trip_minutes_saved: {
    key: "trip_minutes_saved",
    label: "Minutes saved per trip",
    kind: "minutes",
    unit: "min",
    fields: ["impact.minutesSavedByEarnings[].minutesSaved", "agents[].stake.minutesDelta"],
    acceptsPercent: false,
    note:
      "Article says riders would save N minutes per trip. Compare with minutes saved by " +
      "earnings band (positive = saved) and the per-agent minutesDelta (negative = faster).",
  },
  avg_commute_min: {
    key: "avg_commute_min",
    label: "Average commute",
    kind: "minutes",
    unit: "min",
    fields: ["metrics.proposed.avgCommuteMin", "metrics.baseline.avgCommuteMin"],
    acceptsPercent: false,
    note: "Average door-to-door commute minutes for all modeled commuters.",
  },
  transit_share: {
    key: "transit_share",
    label: "Transit share",
    kind: "share",
    unit: "share",
    fields: [
      "metrics.proposed.transitShare",
      "metrics.baseline.transitShare",
      "impact.modeSplit.after.transit",
      "impact.modeSplit.before.transit",
    ],
    acceptsPercent: true,
    note:
      "Share of commuters using transit or park-and-ride (0..1). metrics.* is all modeled " +
      "commuters; impact.modeSplit is corridor commuters only (see modeSplit.scope).",
  },
  cost_per_rider: {
    key: "cost_per_rider",
    label: "Cost per trip",
    kind: "money",
    unit: "usd/trip",
    fields: ["verdict.tests[key=cost_per_rider].value"],
    verdictTest: "cost_per_rider",
    acceptsPercent: false,
    note: "20-year capital + operating cost divided by trips (verdict test cost_per_rider).",
  },
  capital_cost_usd: {
    key: "capital_cost_usd",
    label: "Capital cost",
    kind: "money",
    unit: null,
    fields: null,
    acceptsPercent: false,
    note:
      "Total price tag to build. No ScenarioResult field holds the capital cost " +
      "(cost_per_rider is derived from it but cannot be inverted), so this cannot be checked.",
  },
  headway_min: {
    key: "headway_min",
    label: "Headway",
    kind: "minutes",
    unit: "min",
    fields: ["edit.headwayMin"],
    acceptsPercent: false,
    note: "Minutes between vehicles in the peak. An input to the simulation (edit.headwayMin), not an output.",
  },
  traffic: {
    key: "traffic",
    label: "Road traffic",
    kind: "qualitative",
    unit: "v/c",
    fields: ["roads[].vcProposed", "roads[].vcBaseline", "roads[].delayDeltaMin"],
    acceptsPercent: true,
    note:
      "Qualitative unless the article gives a percentage. Per-road peak volume/capacity " +
      "before and after, and the change in per-trip delay (positive = slower).",
  },
  redlined_benefit_share: {
    key: "redlined_benefit_share",
    label: "Benefit to formerly redlined tracts",
    kind: "share",
    unit: "share",
    fields: ["verdict.tests[key=redlined_benefit_share].value"],
    verdictTest: "redlined_benefit_share",
    acceptsPercent: true,
    note: "Share of minutes saved accruing to formerly HOLC grade D tracts.",
  },
  renters_rent_pressure: {
    key: "renters_rent_pressure",
    label: "Renters under rent pressure",
    kind: "count",
    unit: "households",
    fields: ["verdict.tests[key=renters_rent_pressure].value"],
    verdictTest: "renters_rent_pressure",
    acceptsPercent: false,
    note: "Renter households near new stops in rent-pressure tracts.",
  },
  support_share: {
    key: "support_share",
    label: "Resident support",
    kind: "share",
    unit: "share",
    fields: ["whoPays.approval.support"],
    acceptsPercent: true,
    note: "Share of sampled residents whose stake score is positive (0..1).",
  },
  oppose_share: {
    key: "oppose_share",
    label: "Resident opposition",
    kind: "share",
    unit: "share",
    fields: ["whoPays.approval.oppose"],
    acceptsPercent: true,
    note: "Share of sampled residents whose stake score is negative (0..1).",
  },
};

export function isMetricKey(s: string | undefined): s is MetricKey {
  return s !== undefined && Object.prototype.hasOwnProperty.call(METRICS, s);
}

/** True when the simulation has at least one field for this metric. */
export function isModeled(metric: MetricKey): boolean {
  return METRICS[metric].fields !== null;
}

/**
 * Resolves one path from `MetricDef.fields` against a result. Returns `undefined`
 * when any step is missing. Array steps (`x[]`) return an array of the resolved
 * tails; `x[key=v]` picks the first element whose `key` equals `v`.
 *
 * Pure lookup: it never computes, rounds, or invents a value.
 */
export function resolveMetricPath(result: ScenarioResult, path: string): unknown {
  const steps = path.split(".");
  return walk(result, steps);
}

function walk(node: unknown, steps: string[]): unknown {
  if (steps.length === 0) return node;
  if (node === null || typeof node !== "object") return undefined;
  const [step, ...rest] = steps;

  const all = /^([A-Za-z_]\w*)\[\]$/.exec(step);
  if (all) {
    const arr = (node as Record<string, unknown>)[all[1]];
    if (!Array.isArray(arr)) return undefined;
    return arr.map((el) => walk(el, rest));
  }

  const byKey = /^([A-Za-z_]\w*)\[key=([^\]]+)\]$/.exec(step);
  if (byKey) {
    const arr = (node as Record<string, unknown>)[byKey[1]];
    if (!Array.isArray(arr)) return undefined;
    const el = arr.find((e) => e !== null && typeof e === "object" && (e as Record<string, unknown>).key === byKey[2]);
    return el === undefined ? undefined : walk(el, rest);
  }

  return walk((node as Record<string, unknown>)[step], rest);
}
