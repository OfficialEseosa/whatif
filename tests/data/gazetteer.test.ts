// Validation tests for src/data/gazetteer.json (owned by history-researcher).
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/setup/register.mjs --test "tests/**/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { GazetteerSchema } from "@/lib/contract";
import gazetteer from "@/data/gazetteer.json";

/** Study box from src/lib/contract.ts (Network comment): lng -84.42..-84.33, lat 33.73..33.80. */
const STUDY_BOX = { west: -84.42, south: 33.73, east: -84.33, north: 33.8 };

/**
 * Places allowed to sit outside the study box, with the reason. Empty on 2026-11-13:
 * all 31 places are inside the box. Add `id: "reason"` entries here (and a note in
 * docs/sources/gazetteer.md) before adding a place outside it.
 */
const OUTSIDE_BOX_ALLOWLIST: Record<string, string> = {};

/**
 * Ids present on 2026-11-13. scripts/make-mock-scenario.mjs, sim/sanity.py and the plan
 * parser resolve stops through these ids: never rename or delete one.
 */
const PINNED_IDS = [
  "ponce_city_market",
  "krog_street_market",
  "beltline_edgewood",
  "beltline_irwin",
  "beltline_freedom_pkwy",
  "beltline_ralph_mcgill",
  "beltline_north_ave",
  "beltline_ponce",
  "piedmont_park",
  "centennial_olympic_park",
  "georgia_state_capitol",
  "mercedes_benz_stadium",
  "grady_memorial",
  "georgia_tech",
  "five_points_station",
  "peachtree_center_station",
  "civic_center_station",
  "north_avenue_station",
  "georgia_state_station",
  "king_memorial_station",
  "inman_park_reynoldstown_station",
  "streetcar_centennial_olympic_park",
  "streetcar_dobbs_plaza",
  "streetcar_edgewood_hilliard",
  "streetcar_king_historic_district",
  "old_fourth_ward",
  "inman_park",
  "little_five_points",
  "sweet_auburn",
  "midtown",
  "reynoldstown",
];

test("gazetteer.json validates against GazetteerSchema", () => {
  const result = GazetteerSchema.safeParse(gazetteer);
  assert.ok(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2));
});

test("gazetteer ids are unique", () => {
  const ids = gazetteer.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate gazetteer ids");
});

test("every pinned gazetteer id still exists", () => {
  const ids = new Set(gazetteer.map((p) => p.id));
  for (const id of PINNED_IDS) assert.ok(ids.has(id), `missing pinned id "${id}"`);
  assert.equal(PINNED_IDS.length, 31);
});

test("every place has a non-empty name and source", () => {
  for (const p of gazetteer) {
    assert.ok(p.name.trim().length > 0, `place "${p.id}" has an empty name`);
    assert.ok(typeof p.source === "string" && p.source.trim().length > 0, `place "${p.id}" has no source`);
  }
});

test("every coordinate is inside the study box or explicitly allowlisted", () => {
  for (const p of gazetteer) {
    const [lng, lat] = p.coord;
    const inside = lng >= STUDY_BOX.west && lng <= STUDY_BOX.east && lat >= STUDY_BOX.south && lat <= STUDY_BOX.north;
    if (inside) continue;
    const reason = OUTSIDE_BOX_ALLOWLIST[p.id];
    assert.ok(reason, `place "${p.id}" at [${lng}, ${lat}] is outside the study box and not allowlisted`);
  }
});

test("allowlist entries name real places and give a reason", () => {
  const ids = new Set(gazetteer.map((p) => p.id));
  for (const [id, reason] of Object.entries(OUTSIDE_BOX_ALLOWLIST)) {
    assert.ok(ids.has(id), `allowlisted id "${id}" is not in the gazetteer`);
    assert.ok(reason.trim().length > 0, `allowlisted id "${id}" has no reason`);
  }
});

test("names and aliases are unique across places (case-insensitive)", () => {
  const seen = new Map<string, string>();
  for (const p of gazetteer) {
    for (const label of [p.name, ...p.aliases]) {
      const key = label.trim().toLowerCase();
      const prev = seen.get(key);
      assert.ok(!prev, `label "${label}" is used by both "${prev}" and "${p.id}"`);
      seen.set(key, p.id);
    }
  }
});

test("corridor ids are well-formed snake_case", () => {
  for (const p of gazetteer) {
    for (const c of p.corridors ?? []) assert.match(c, /^[a-z0-9_]+$/, `place "${p.id}" has bad corridor id "${c}"`);
  }
});
