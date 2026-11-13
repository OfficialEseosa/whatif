import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ScenarioResultSchema, VerdictTestKeySchema } from "@/lib/contract";
import { METRICS, METRIC_KEYS, isMetricKey, isModeled, resolveMetricPath } from "@/lib/ai/article/metrics";

const scenario = ScenarioResultSchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../public/scenarios/beltline-streetcar.json", import.meta.url)), "utf8")),
);

function isNumberOrNumbers(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

test("vocabulary is consistent with itself", () => {
  assert.deepEqual(Object.keys(METRICS).sort(), [...METRIC_KEYS].sort());
  for (const key of METRIC_KEYS) {
    const def = METRICS[key];
    assert.equal(def.key, key);
    assert.equal(def.fields === null, def.unit === null, `${key}: unit and fields must both be null or both set`);
    if (def.fields) assert.ok(def.fields.length > 0, `${key}: empty fields list`);
    if (def.verdictTest) assert.ok(VerdictTestKeySchema.safeParse(def.verdictTest).success, `${key}: bad verdictTest`);
    assert.equal(def.acceptsPercent, def.kind === "share" || def.kind === "pct_change" || def.kind === "qualitative", key);
  }
  assert.ok(isMetricKey("daily_riders"));
  assert.ok(!isMetricKey("riders"));
  assert.ok(!isMetricKey(undefined));
});

test("every listed field path resolves to a number in the real scenario file", () => {
  for (const key of METRIC_KEYS) {
    const def = METRICS[key];
    if (def.fields === null) continue;
    for (const path of def.fields) {
      const v = resolveMetricPath(scenario, path);
      assert.ok(isNumberOrNumbers(v), `${key}: ${path} resolved to ${String(JSON.stringify(v)).slice(0, 60)}`);
    }
  }
});

test("values come straight from the file, unchanged", () => {
  assert.equal(resolveMetricPath(scenario, "metrics.proposed.dailyTransitRiders"), scenario.metrics.proposed.dailyTransitRiders);
  assert.equal(resolveMetricPath(scenario, "verdict.tests[key=new_riders].value"), scenario.verdict.tests.find((t) => t.key === "new_riders")?.value);
  assert.equal(resolveMetricPath(scenario, "edit.headwayMin"), scenario.edit.headwayMin);
  assert.deepEqual(resolveMetricPath(scenario, "roads[].delayDeltaMin"), scenario.roads.map((r) => r.delayDeltaMin));
  assert.equal(resolveMetricPath(scenario, "verdict.tests[key=nope].value"), undefined);
  assert.equal(resolveMetricPath(scenario, "metrics.nothing.here"), undefined);
});

test("capital cost is explicitly not modeled", () => {
  assert.equal(METRICS.capital_cost_usd.fields, null);
  assert.equal(isModeled("capital_cost_usd"), false);
  assert.equal(isModeled("daily_riders"), true);
});

test("verdict-backed metrics point at the verdict test with the same key", () => {
  for (const key of METRIC_KEYS) {
    const def = METRICS[key];
    if (!def.verdictTest) continue;
    assert.ok(def.fields?.includes(`verdict.tests[key=${def.verdictTest}].value`), key);
  }
});
