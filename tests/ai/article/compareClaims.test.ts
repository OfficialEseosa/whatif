import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ClaimCheckSchema, ScenarioResultSchema, type ExtractedClaim, type ScenarioResult } from "@/lib/contract";
import { compareClaims, rateNumeric } from "@/lib/ai/article/compareClaims";
import { METRIC_KEYS } from "@/lib/ai/article/metrics";

const load = (name: string): ScenarioResult =>
  ScenarioResultSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/scenarios/${name}`, import.meta.url)), "utf8")));

const sim = load("beltline-streetcar.sim.json");
const mock = load("beltline-streetcar.json");
const claim = (metric: string | undefined, claimedValue?: number, quote = "a quote"): ExtractedClaim => ({ id: "c1", quote, metric, claimedValue });
const one = (c: ExtractedClaim, r: ScenarioResult = sim) => compareClaims([c], r)[0];

test("rateNumeric: 20% band, and a claimed gain against a measured zero or loss is overstated", () => {
  assert.equal(rateNumeric(100, 100), "accurate");
  assert.equal(rateNumeric(120, 100), "accurate");
  assert.equal(rateNumeric(80, 100), "accurate");
  assert.equal(rateNumeric(121, 100), "overstated");
  assert.equal(rateNumeric(79, 100), "understated");
  assert.equal(rateNumeric(12, 0), "overstated");
  assert.equal(rateNumeric(12, -3), "overstated");
  assert.equal(rateNumeric(0, 0), "accurate");
});

test("every metric in the vocabulary yields a contract-valid row on the sim and mock results", () => {
  for (const result of [sim, mock]) {
    const claims = METRIC_KEYS.map((m, i) => ({ id: `c${i + 1}`, quote: `quote ${i}`, metric: m, claimedValue: 10 }));
    const rows = compareClaims(claims, result);
    assert.equal(rows.length, claims.length);
    rows.forEach((row, i) => {
      assert.ok(ClaimCheckSchema.safeParse(row).success, `${claims[i].metric}: not a ClaimCheck`);
      assert.equal(row.id, claims[i].id);
      assert.equal(row.quote, claims[i].quote);
      assert.ok(row.claimed.length > 0 && row.measured.length > 0, `${claims[i].metric}: empty text`);
    });
  }
});

test("is deterministic and does not modify its inputs", () => {
  const claims = [claim("daily_riders", 10000), claim("traffic", undefined, "take cars off Ponce")];
  const before = JSON.stringify(claims);
  assert.deepEqual(compareClaims(claims, sim), compareClaims(claims, sim));
  assert.equal(JSON.stringify(claims), before);
});

test("daily_riders scales the display sample to the modeled population", () => {
  const onLine = sim.agents.filter((a) => a.proposed.lines?.includes("proposed")).length;
  const row = one(claim("daily_riders", 10000, "could carry 10,000 riders a day"));
  assert.equal(row.claimed, "10,000 riders/day");
  assert.equal(row.rating, "overstated");
  assert.match(row.measured, new RegExp(`\(${onLine} of ${sim.agents.length.toLocaleString("en-US")} sampled\)`));
  assert.match(row.measured, /Work trips only/);

  const estimate = (onLine / sim.agents.length) * sim.metrics.proposed.populationModeled;
  assert.equal(one(claim("daily_riders", estimate)).rating, "accurate");
  assert.equal(one(claim("daily_riders", estimate * 0.5)).rating, "understated");
});

test("daily_riders falls back to new riders when the plan draws no line, and says so when nobody sampled rides it", () => {
  const noLine: ScenarioResult = { ...sim, line: { path: [], stops: [] } };
  assert.match(one(claim("daily_riders", 500), noLine).measured, /switch to transit/);

  const nobody: ScenarioResult = { ...sim, agents: sim.agents.map((a) => ({ ...a, proposed: { ...a.proposed, lines: [] } })) };
  const row = one(claim("daily_riders", 500), nobody);
  assert.match(row.measured, /^Fewer than .* \(none of/);
  assert.equal(row.rating, "overstated");
});

test("numeric metrics read the matching result field", () => {
  const t = (k: string) => sim.verdict.tests.find((x) => x.key === k)!.value;
  assert.equal(one(claim("cost_per_rider", t("cost_per_rider"))).rating, "accurate");
  assert.equal(one(claim("cost_per_rider", 5.5)).rating, "understated");
  assert.equal(one(claim("cost_per_rider", 5.5)).claimed, "$5.50 per trip");
  assert.equal(one(claim("renters_rent_pressure", t("renters_rent_pressure"))).rating, "accurate");
  assert.equal(one(claim("transit_share", sim.metrics.proposed.transitShare)).rating, "accurate");
  assert.equal(one(claim("transit_share", 0.5)).rating, "overstated");
  assert.equal(one(claim("avg_commute_min", sim.metrics.proposed.avgCommuteMin)).rating, "accurate");
  assert.equal(one(claim("headway_min", sim.edit.headwayMin!)).rating, "accurate");
  assert.equal(one(claim("support_share", 0.62)).claimed, "62% support");
});

test("a claimed time saving against a measured loss is overstated", () => {
  const loss: ScenarioResult = { ...sim, verdict: { ...sim.verdict, tests: sim.verdict.tests.map((x) => (x.key === "time_saved" ? { ...x, value: -41.3 } : x)) } };
  const row = one(claim("time_saved", 500), loss);
  assert.equal(row.rating, "overstated");
  assert.match(row.measured, /^Net loss of 41 hours\/day/);
});

test("claims the result cannot answer are unsupported, never guessed", () => {
  const cost = one(claim("capital_cost_usd", 190e6, "for about $190 million"));
  assert.equal(cost.rating, "unsupported");
  assert.equal(cost.claimed, "$190M to build");
  assert.equal(one(claim(undefined)).rating, "unsupported");
  assert.equal(one(claim("not_a_metric", 5)).rating, "unsupported");
  const noNumber = one(claim("new_riders"));
  assert.equal(noNumber.rating, "unsupported");
  assert.match(noNumber.measured, /switch from driving/);
  const noHeadway: ScenarioResult = { ...sim, edit: { ...sim.edit, headwayMin: undefined } };
  assert.equal(one(claim("headway_min", 10), noHeadway).rating, "unsupported");
});

test("traffic claims are rated by which way road segments move", () => {
  const road = (d: number) => ({ roadId: "w1", vcBaseline: 0.5, vcProposed: 0.5 + d, delayDeltaMin: 0 });
  const withRoads = (ds: number[]): ScenarioResult => ({ ...sim, roads: ds.map(road) });
  const less = claim("traffic", undefined, "take cars off Ponce");
  const more = claim("traffic", undefined, "would make congestion worse on Edgewood");
  assert.equal(one(less, withRoads([-0.1, -0.2])).rating, "accurate");
  assert.equal(one(less, withRoads([-0.1, 0.2])).rating, "partly");
  assert.equal(one(less, withRoads([0.1])).rating, "overstated");
  assert.equal(one(less, withRoads([0.01, -0.02])).rating, "overstated");
  assert.match(one(less, withRoads([0.01])).measured, /^No road segment/);
  assert.equal(one(more, withRoads([0.1])).rating, "accurate");
  assert.equal(one(more, withRoads([0.1])).claimed, "More traffic");
  assert.match(one(less, withRoads([-0.1, 0.2, 0.3])).measured, /eases on 1 road segment and gets heavier on 2 road segments/);
});

test("fields flagged as mock sections are marked as placeholders", () => {
  const flagged: ScenarioResult = { ...sim, isMock: false, mockSections: ["verdict.tests.cost_per_rider", "whoPays.approval"] };
  assert.match(one(claim("cost_per_rider", 5), flagged).measured, /\(placeholder\)$/);
  assert.match(one(claim("support_share", 0.5), flagged).measured, /\(placeholder\)$/);
  assert.doesNotMatch(one(claim("renters_rent_pressure", 500), flagged).measured, /placeholder/);
});
