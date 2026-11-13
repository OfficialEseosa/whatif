import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExtractedClaimSchema, type ExtractedClaim } from "@/lib/contract";
import { extractClaimsDeterministic, verifyQuotes, assignIds, normaliseWhitespace, MAX_CLAIMS } from "@/lib/ai/article/extractClaims";
import { isMetricKey } from "@/lib/ai/article/metrics";

const FIXTURES = ["streetcar-east.txt", "brt-campbellton.txt", "clifton-rail.txt", "no-claims.txt"] as const;

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/articles/${name}`, import.meta.url)), "utf8");
}

/** Shape-only view for readable assertions. */
function brief(claims: ExtractedClaim[]): Array<[string | undefined, number | undefined]> {
  return claims.map((c) => [c.metric, c.claimedValue]);
}

function checkInvariants(text: string, claims: ExtractedClaim[]) {
  const norm = normaliseWhitespace(text);
  claims.forEach((c, i) => {
    assert.ok(ExtractedClaimSchema.safeParse(c).success, `claim ${i} fails schema`);
    assert.equal(c.id, `c${i + 1}`);
    assert.ok(norm.includes(c.quote), `quote not verbatim: ${c.quote}`);
    assert.ok(c.quote.length <= 120, `quote too long: ${c.quote}`);
    assert.ok(c.metric === undefined || isMetricKey(c.metric), `unknown metric ${c.metric}`);
    if (c.claimedValue !== undefined) assert.ok(Number.isFinite(c.claimedValue));
  });
  assert.ok(claims.length <= MAX_CLAIMS);
}

test("invariants hold on every fixture and output is deterministic", () => {
  for (const name of FIXTURES) {
    const text = fixture(name);
    const a = extractClaimsDeterministic(text);
    const b = extractClaimsDeterministic(text);
    checkInvariants(text, a);
    assert.deepEqual(a, b, name);
    assert.deepEqual(a, extractClaimsDeterministic(text.replace(/\n/g, "  \n ")), `${name}: whitespace changes output`);
  }
});

test("streetcar-east: riders/day, headway, cost, cost per rider, minutes saved, traffic", () => {
  const text = fixture("streetcar-east.txt");
  const claims = extractClaimsDeterministic(text);
  assert.deepEqual(brief(claims), [
    ["daily_riders", 10000],
    ["headway_min", 10],
    ["capital_cost_usd", 190e6],
    ["cost_per_rider", 5.5],
    ["trip_minutes_saved", 12],
    ["traffic", undefined],
  ]);
  assert.equal(claims[0].quote, "Planners say the line could carry 10,000 riders a day once it opens");
  assert.equal(claims[2].quote, "The extension would be built for about $190 million");
  assert.ok(claims[4].quote.includes("12 minutes"));
  assert.ok(claims[5].quote.includes("take cars off"));
  // "twenty years", "next month" and "a federal grant" are not numbers to us.
  assert.ok(!claims.some((c) => c.claimedValue === 20));
});

test("brt-campbellton: cost, daily riders, support/oppose shares, traffic %, hours saved", () => {
  const claims = extractClaimsDeterministic(fixture("brt-campbellton.txt"));
  assert.deepEqual(brief(claims), [
    ["capital_cost_usd", 85e6],
    ["daily_riders", 8500],
    ["support_share", 0.62],
    ["oppose_share", 0.21],
    ["traffic", 0.2],
    ["time_saved", 1900],
  ]);
  assert.ok(claims[2].quote.includes("62% of residents"));
  assert.ok(claims[4].quote.includes("cut congestion on Campbellton Road by 20%"));
});

test("clifton-rail: new riders, from-to share, average commute, billions, rent pressure, redlined share", () => {
  const claims = extractClaimsDeterministic(fixture("clifton-rail.txt"));
  assert.deepEqual(brief(claims), [
    ["new_riders", 4000], // headline
    ["new_riders", 4000], // body
    ["transit_share", 0.35], // "from 30% to 35%" -> the after value
    ["avg_commute_min", 24],
    ["capital_cost_usd", 2.1e9],
    ["renters_rent_pressure", 1100],
    ["redlined_benefit_share", 0.18],
  ]);
  assert.equal(claims[4].quote, "$2.1 billion before financing");
  assert.ok(claims[2].quote.endsWith("from 30% to 35%"));
});

test("no-claims: an opinion piece with a bare year yields nothing", () => {
  assert.deepEqual(extractClaimsDeterministic(fixture("no-claims.txt")), []);
  assert.deepEqual(extractClaimsDeterministic("The council is expected to vote on the plan next month."), []);
  assert.deepEqual(extractClaimsDeterministic(""), []);
  assert.deepEqual(extractClaimsDeterministic("   \n\t "), []);
});

test("numbers of the wrong kind are not mapped rather than guessed", () => {
  // percent on a count metric
  assert.deepEqual(extractClaimsDeterministic("Ridership could reach 15% higher than today."), []);
  // number words
  assert.deepEqual(extractClaimsDeterministic("A dozen riders a day would use it, backers say."), []);
  // fare, not capital cost
  assert.deepEqual(extractClaimsDeterministic("The fare would be $2.50 per trip."), [
    { id: "c1", quote: "The fare would be $2.50 per trip", metric: "cost_per_rider", claimedValue: 2.5 },
  ]);
  assert.deepEqual(extractClaimsDeterministic("Each household would pay $30 a year."), []);
});

test("unit forms inside sentences", () => {
  assert.deepEqual(brief(extractClaimsDeterministic("The line would carry 10k riders per day for $1.2B.")), [
    ["daily_riders", 10000],
    ["capital_cost_usd", 1.2e9],
  ]);
  assert.deepEqual(brief(extractClaimsDeterministic("About 15 percent of commuters would take the train.")), [["transit_share", 0.15]]);
  assert.deepEqual(brief(extractClaimsDeterministic("Trains every 6 minutes would save riders 1,900 hours a day.")), [
    ["headway_min", 6],
    ["time_saved", 1900],
  ]);
  assert.deepEqual(brief(extractClaimsDeterministic("Traffic on Edgewood would get worse, with 2,000 more cars.")), [["traffic", undefined]]);
});

test("verifyQuotes drops non-verbatim quotes and keeps whitespace variants", () => {
  const text = "Planners say the line could carry\n   10,000 riders a day.";
  const fromModel: ExtractedClaim[] = [
    { id: "c1", quote: "could carry 10,000 riders a day", metric: "daily_riders", claimedValue: 10000 },
    { id: "c2", quote: "could carry 12,000 riders a day", metric: "daily_riders", claimedValue: 12000 }, // invented
    { id: "c3", quote: "carry   10,000 riders", metric: "daily_riders" }, // extra whitespace
    { id: "c4", quote: "", metric: "traffic" },
  ];
  const kept = verifyQuotes(text, fromModel);
  assert.deepEqual(kept.map((c) => c.id), ["c1", "c3"]);
  assert.equal(kept[1].quote, "carry 10,000 riders");
  assert.deepEqual(verifyQuotes(text, fromModel, { renumber: true }).map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(assignIds(fromModel.slice(1, 3)).map((c) => c.id), ["c1", "c2"]);
  assert.ok(kept.every((c) => ExtractedClaimSchema.safeParse(c).success));
});
