/**
 * Article check, step 2 (after simulation): ExtractedClaim[] + ScenarioResult -> ClaimCheck[].
 *
 * Pure and deterministic. Every number in `measured` is read or counted from the
 * ScenarioResult passed in; nothing comes from the article, a model, or a constant.
 *
 * Rating rule for numeric claims (same thresholds the mock generator used):
 *   claimed > measured * 1.2  -> "overstated"
 *   claimed < measured * 0.8  -> "understated"
 *   otherwise                 -> "accurate"
 * and when the model measures zero or a loss where the article claims a gain -> "overstated".
 * "partly" is used for traffic claims that hold on some roads and fail on others.
 * "unsupported" means the claim cannot be checked: no metric, a metric the simulation
 * does not output (see METRICS[...].fields === null), or no number to compare.
 *
 * Fields flagged in `result.mockSections` are still used, with " (placeholder)" appended.
 */
import type { ClaimCheck, ClaimRating, ExtractedClaim, ScenarioResult, VerdictTestKey } from "@/lib/contract";
import { isMockSection } from "@/lib/provenance";
import { METRICS, isMetricKey, type MetricKey } from "./metrics";

/** A claim within this share of the measured value counts as accurate. */
export const TOLERANCE = 0.2;
/** Change in peak volume/capacity that counts as a road getting busier or quieter (the map uses the same). */
export const VC_CHANGE = 0.03;

type Measured = { value: number; text: string; mockKey?: string };

const int = (n: number) => Math.round(n).toLocaleString("en-US");
/** Round to two significant figures: 364 -> 360. Estimates from a sample should not look exact. */
const sig2 = (n: number) => {
  if (n === 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(Math.abs(n))) - 1);
  return Math.round(n / p) * p;
};
const usd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : n >= 1000 ? `$${int(n)}` : `$${n.toFixed(2)}`;
const pct = (x: number) => `${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
const plural = (n: number, one: string) => `${int(n)} ${one}${n === 1 ? "" : "s"}`;

export function rateNumeric(claimed: number, measured: number): ClaimRating {
  if (measured <= 0) return claimed > 0 ? "overstated" : "accurate";
  const ratio = claimed / measured;
  return ratio > 1 + TOLERANCE ? "overstated" : ratio < 1 - TOLERANCE ? "understated" : "accurate";
}

function testValue(result: ScenarioResult, key: VerdictTestKey): number | undefined {
  return result.verdict.tests.find((t) => t.key === key)?.value;
}

function fromTest(result: ScenarioResult, key: VerdictTestKey, text: (v: number) => string): Measured | null {
  const value = testValue(result, key);
  return value === undefined ? null : { value, text: text(value), mockKey: `verdict.tests.${key}` };
}

/** What the model says about one metric, or null when the result has nothing to compare with. */
function measure(metric: MetricKey, result: ScenarioResult): Measured | null {
  const { baseline, proposed } = result.metrics;
  switch (metric) {
    case "daily_riders": {
      // The result has no boardings field for the new line, so scale the display sample:
      // sampled commuters whose proposed trip rides the line, as a share of all modeled commuters.
      const n = result.agents.length;
      const switched = testValue(result, "new_riders");
      const also = switched === undefined ? "" : `; ${int(Math.max(0, switched))} switch from driving`;
      if (result.line.path.length > 0 && n > 0) {
        const onLine = result.agents.filter((a) => a.proposed.lines?.includes("proposed")).length;
        const value = (onLine / n) * proposed.populationModeled;
        const text = onLine
          ? `About ${int(sig2(value))} commuters/day ride the line (${int(onLine)} of ${int(n)} sampled)${also}. Work trips only`
          : `Fewer than ${int(sig2(proposed.populationModeled / n))} commuters/day ride the line (none of ${int(n)} sampled)${also}. Work trips only`;
        return { value, text };
      }
      return fromTest(result, "new_riders", (v) => `${int(Math.max(0, v))} commuters/day switch to transit. Work trips only`);
    }
    case "new_riders":
      return fromTest(result, "new_riders", (v) => `${int(Math.max(0, v))} commuters/day switch from driving`);
    case "time_saved":
      return fromTest(result, "time_saved", (v) =>
        v >= 0 ? `${int(v)} hours/day saved across all modeled commuters` : `Net loss of ${int(-v)} hours/day across all modeled commuters`,
      );
    case "trip_minutes_saved": {
      const bands = result.impact.minutesSavedByEarnings.map((b) => b.minutesSaved);
      if (!bands.length) return null;
      const lo = Math.min(...bands);
      const hi = Math.max(...bands);
      const range = lo === hi ? hi.toFixed(1) : `${lo.toFixed(1)} to ${hi.toFixed(1)}`;
      return { value: hi, text: `${range} min saved per commute, averaged over all modeled commuters by earnings band`, mockKey: "impact.minutesSavedByEarnings" };
    }
    case "avg_commute_min":
      return { value: proposed.avgCommuteMin, text: `${proposed.avgCommuteMin.toFixed(1)} min average commute (${baseline.avgCommuteMin.toFixed(1)} today)` };
    case "transit_share":
      return { value: proposed.transitShare, text: `${pct(proposed.transitShare)} of commuters on transit (${pct(baseline.transitShare)} today)` };
    case "cost_per_rider":
      return fromTest(result, "cost_per_rider", (v) => `${usd(v)} per trip over 20 years of capital and operating cost`);
    case "headway_min": {
      const h = result.edit.headwayMin;
      return h === undefined ? null : { value: h, text: `Modeled with a vehicle every ${h} min` };
    }
    case "redlined_benefit_share":
      return fromTest(result, "redlined_benefit_share", (v) => `${pct(v)} of time saved goes to formerly redlined tracts`);
    case "renters_rent_pressure":
      return fromTest(result, "renters_rent_pressure", (v) => `${int(v)} renter households near new stops in rent-pressure tracts`);
    case "support_share": {
      const a = result.whoPays.approval;
      return { value: a.support, text: `${pct(a.support)} of ${int(a.basis)} sampled residents come out ahead`, mockKey: "whoPays.approval" };
    }
    case "oppose_share": {
      const a = result.whoPays.approval;
      return { value: a.oppose, text: `${pct(a.oppose)} of ${int(a.basis)} sampled residents come out behind`, mockKey: "whoPays.approval" };
    }
    default:
      return null; // capital_cost_usd (no field in the result) and traffic (handled separately)
  }
}

/** How the article's number reads back, short: "10,000 riders/day". */
function claimedText(metric: MetricKey, v: number): string {
  switch (metric) {
    case "daily_riders":
    case "new_riders":
      return `${int(v)} riders/day`;
    case "time_saved":
      return `${int(v)} hours/day saved`;
    case "trip_minutes_saved":
      return `${v} min saved per trip`;
    case "avg_commute_min":
      return `${v} min average commute`;
    case "transit_share":
      return `${pct(v)} transit share`;
    case "cost_per_rider":
      return `${usd(v)} per trip`;
    case "capital_cost_usd":
      return `${usd(v)} to build`;
    case "headway_min":
      return `A vehicle every ${v} min`;
    case "redlined_benefit_share":
      return `${pct(v)} of benefit to redlined tracts`;
    case "renters_rent_pressure":
      return `${int(v)} renter households`;
    case "support_share":
      return `${pct(v)} support`;
    case "oppose_share":
      return `${pct(v)} oppose`;
    case "traffic":
      return `${pct(v)} change in traffic`;
  }
}

const WORSE_TRAFFIC = /\b(worse|worsen\w*|more (traffic|congestion|cars)|gridlock|snarl\w*|clog\w*|back(s|ed)? up|slow(er|s)? (traffic|drivers|cars))\b/i;

/** Traffic is qualitative: count road segments whose peak volume/capacity moves either way. */
function checkTraffic(claim: ExtractedClaim, result: ScenarioResult): Pick<ClaimCheck, "claimed" | "measured" | "rating"> {
  const claimsWorse = WORSE_TRAFFIC.test(claim.quote);
  const busier = result.roads.filter((r) => r.vcProposed - r.vcBaseline > VC_CHANGE).length;
  const quieter = result.roads.filter((r) => r.vcBaseline - r.vcProposed > VC_CHANGE).length;
  const [backing, against] = claimsWorse ? [busier, quieter] : [quieter, busier];
  return {
    claimed: claimsWorse ? "More traffic" : "Less traffic",
    measured:
      busier + quieter === 0
        ? "No road segment's peak traffic changes noticeably"
        : `Peak traffic eases on ${plural(quieter, "road segment")} and gets heavier on ${plural(busier, "road segment")}`,
    rating: backing === 0 ? "overstated" : against === 0 ? "accurate" : "partly",
  };
}

export function compareClaims(claims: ExtractedClaim[], result: ScenarioResult): ClaimCheck[] {
  return claims.map((claim): ClaimCheck => {
    if (!isMetricKey(claim.metric))
      return { ...claim, claimed: "No measurable figure", measured: "Not something the model measures", rating: "unsupported" };
    const metric = claim.metric;
    if (metric === "traffic") return { ...claim, ...checkTraffic(claim, result) };

    const claimed = claim.claimedValue === undefined ? METRICS[metric].label : claimedText(metric, claim.claimedValue);
    const m = measure(metric, result);
    if (!m) return { ...claim, claimed, measured: "The simulation output has no figure for this", rating: "unsupported" };
    const measured = m.mockKey && isMockSection(result, m.mockKey) ? `${m.text} (placeholder)` : m.text;
    const rating = claim.claimedValue === undefined ? "unsupported" : rateNumeric(claim.claimedValue, m.value);
    return { ...claim, claimed, measured, rating };
  });
}
