// Validation tests for src/data/history.json (owned by history-researcher).
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/setup/register.mjs --test "tests/**/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { HistorySchema, HistoryOverlaySchema } from "@/lib/contract";
import history from "@/data/history.json";

/** Ids present on 2026-11-13. Removing or renaming any of these is a breaking change. */
const PINNED_IDS = [
  "holc_1938",
  "highways_barriers",
  "peyton_road_barricades",
  "urban_renewal",
  "marta_cobb_1965",
  "marta_1968",
  "marta_1971",
  "marta_clayton_2014",
  "marta_gwinnett_2019",
  "beltline_prices",
];

test("history.json validates against HistorySchema", () => {
  const result = HistorySchema.safeParse(history);
  assert.ok(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2));
});

test("history ids are unique", () => {
  const ids = history.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids.join(", ")}`);
});

test("every pinned history id still exists", () => {
  const ids = new Set(history.map((e) => e.id));
  for (const id of PINNED_IDS) assert.ok(ids.has(id), `missing pinned id "${id}"`);
});

test("every history event has a non-empty source", () => {
  for (const e of history) {
    assert.ok(e.source.trim().length > 0, `event "${e.id}" has an empty source`);
    assert.ok(e.title.trim().length > 0, `event "${e.id}" has an empty title`);
    assert.ok(e.body.trim().length > 0, `event "${e.id}" has an empty body`);
  }
});

test("sourceUrl, when present, is an absolute https URL", () => {
  for (const e of history) {
    if (e.sourceUrl === undefined) continue;
    assert.ok(e.sourceUrl.startsWith("https://"), `event "${e.id}" sourceUrl is not https: ${e.sourceUrl}`);
  }
});

test("verified stays false until a human checks the card", () => {
  for (const e of history) assert.equal(e.verified, false, `event "${e.id}" must not be marked verified by an agent`);
});

test("overlay is one of the contract's HistoryOverlay values", () => {
  for (const e of history) {
    assert.ok(HistoryOverlaySchema.safeParse(e.overlay).success, `event "${e.id}" has unknown overlay "${e.overlay}"`);
  }
});

test("year (sort key) falls inside the period named by yearLabel", () => {
  for (const e of history) {
    const match = /(\d{4})(s)?/.exec(e.yearLabel);
    assert.ok(match, `event "${e.id}" yearLabel "${e.yearLabel}" has no 4-digit year`);
    const first = Number(match[1]);
    // "1950s" means the decade; "1962" or "2019–20" means that exact first year.
    const last = match[2] ? first + 9 : first;
    assert.ok(
      e.year >= first && e.year <= last,
      `event "${e.id}" year ${e.year} is outside the period "${e.yearLabel}" (${first}–${last})`,
    );
  }
});
