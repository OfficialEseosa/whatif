import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GazetteerSchema, StopSchema } from "@/lib/contract";
import gazetteerJson from "@/data/gazetteer.json";
import {
  findPlaceMatches,
  findPlaces,
  loadGazetteer,
  normalizeName,
  resolveAlias,
  toStop,
  tokenize,
} from "@/lib/ai/plan/gazetteer";

const gaz = GazetteerSchema.parse(gazetteerJson);
const byId = new Map(gaz.map((p) => [p.id, p]));

describe("normalisation", () => {
  test("case, punctuation and street abbreviations are normalised", () => {
    assert.equal(normalizeName("Krog St."), "krog street");
    assert.equal(normalizeName("KROG STREET"), "krog street");
    assert.equal(normalizeName("Ponce de Leon Ave"), "ponce de leon avenue");
    assert.equal(normalizeName("Ralph McGill Blvd"), "ralph mcgill boulevard");
    assert.equal(normalizeName("Freedom Pkwy"), "freedom parkway");
    assert.equal(normalizeName("Mercedes-Benz Stadium"), "mercedes benz stadium");
    assert.equal(normalizeName("Inman Park/Reynoldstown station"), "inman park reynoldstown station");
    assert.equal(normalizeName("Edgewood Ave NE"), "edgewood avenue northeast");
  });

  test("tokenize drops apostrophes instead of splitting on them", () => {
    assert.deepEqual(tokenize("Krog's market & Ponce"), ["krogs", "market", "and", "ponce"]);
    assert.deepEqual(tokenize(""), []);
  });
});

describe("resolveAlias / toStop", () => {
  test("known aliases resolve to the right ids", () => {
    assert.equal(resolveAlias("PCM"), "ponce_city_market");
    assert.equal(resolveAlias("pcm"), "ponce_city_market");
    assert.equal(resolveAlias("Krog St"), "krog_street_market");
    assert.equal(resolveAlias("krog street"), "krog_street_market");
    assert.equal(resolveAlias("O4W"), "old_fourth_ward");
    assert.equal(resolveAlias("Five Points"), "five_points_station");
    assert.equal(resolveAlias("the Capitol"), "georgia_state_capitol");
  });

  test("every gazetteer name resolves to its own id (unless an earlier entry shares the normalised name)", () => {
    const seen = new Map<string, string>();
    for (const p of gaz) {
      const key = normalizeName(p.name);
      const owner = seen.get(key) ?? p.id;
      seen.set(key, owner);
      assert.equal(resolveAlias(p.name), owner, `name "${p.name}"`);
    }
  });

  test("toStop builds a contract Stop with the gazetteer coordinate", () => {
    const stop = toStop("krog_street_market");
    assert.ok(stop);
    assert.ok(StopSchema.safeParse(stop).success);
    assert.equal(stop.name, "Krog Street Market");
    assert.deepEqual(stop.coord, byId.get("krog_street_market")?.coord);
    assert.notEqual(stop.coord, byId.get("krog_street_market")?.coord, "coord is a copy, not the gazetteer's array");
  });

  test("toStop never guesses an unknown id", () => {
    assert.equal(toStop("emory_university"), undefined);
    assert.equal(toStop(""), undefined);
  });

  test("loadGazetteer validates and caches", () => {
    assert.equal(loadGazetteer(), loadGazetteer());
    assert.equal(loadGazetteer().length, gaz.length);
  });
});

describe("findPlaces", () => {
  test("returns ids in order of first mention, de-duplicated", () => {
    assert.deepEqual(findPlaces("From Krog St to PCM, then back to Krog Street Market and PCM again"), [
      "krog_street_market",
      "ponce_city_market",
    ]);
    assert.deepEqual(findPlaces("PCM first, then Krog St"), ["ponce_city_market", "krog_street_market"]);
  });

  test("prefers the longest match and never double-matches overlapping aliases", () => {
    // "Beltline at Ponce de Leon Ave" must not also yield ponce-related stops from its tail.
    assert.deepEqual(findPlaces("a stop at the Beltline at Ponce de Leon Ave"), ["beltline_ponce"]);
    // "Five Points station" (name) beats the shorter alias "Five Points".
    const m = findPlaceMatches("Five Points station");
    assert.equal(m.length, 1);
    assert.equal(m[0].matched, "five points station");
    // "Georgia State Capitol" beats the alias "Georgia State" (station).
    assert.deepEqual(findPlaces("to the Georgia State Capitol"), ["georgia_state_capitol"]);
    // "Inman Park station" (alias) is one match, not neighborhood + "station".
    assert.deepEqual(findPlaces("Inman Park station"), ["inman_park_reynoldstown_station"]);
  });

  test("is case- and punctuation-insensitive", () => {
    assert.deepEqual(findPlaces("krog st. -> P.C.M."), ["krog_street_market", "ponce_city_market"]);
    assert.deepEqual(findPlaces("MERCEDES BENZ STADIUM"), ["mercedes_benz_stadium"]);
  });

  test("match spans are contiguous and non-overlapping", () => {
    const text = "Streetcar from Ponce City Market via Beltline at Irwin St to Krog Street Market";
    const matches = findPlaceMatches(text);
    assert.deepEqual(
      matches.map((m) => m.id),
      ["ponce_city_market", "beltline_irwin", "krog_street_market"],
    );
    for (let i = 1; i < matches.length; i++) assert.ok(matches[i].start >= matches[i - 1].end);
  });

  test("unknown text yields nothing", () => {
    assert.deepEqual(findPlaces("Build a line to Emory University"), []);
    assert.deepEqual(findPlaces(""), []);
  });

  test("every alias in the gazetteer is found when it appears alone in text", () => {
    for (const p of gaz) {
      for (const alias of [p.name, ...p.aliases]) {
        const ids = findPlaces(`Go to ${alias} please`);
        assert.equal(ids.length, 1, `alias "${alias}" of ${p.id}`);
        assert.equal(ids[0], resolveAlias(alias), `alias "${alias}" of ${p.id}`);
      }
    }
  });

  test("works with an injected gazetteer (so new entries added in parallel are picked up)", () => {
    const custom = [
      ...gaz,
      { id: "test_place", name: "Test Place", aliases: ["TP"], coord: [-84.4, 33.75] as [number, number], kind: "landmark" as const },
    ];
    assert.deepEqual(findPlaces("from TP to PCM", custom), ["test_place", "ponce_city_market"]);
    assert.equal(toStop("test_place", custom)?.name, "Test Place");
    assert.equal(toStop("test_place"), undefined);
  });
});
