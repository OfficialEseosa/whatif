import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  findRailLineMentions,
  findRoadIdsByName,
  findRoadMentions,
  getRoad,
  isRailLineId,
  isRoadId,
  loadNetwork,
  railLineIds,
  validateBaseLineId,
  validateRoadIds,
} from "@/lib/ai/plan/network";

const network = loadNetwork();

describe("rail lines", () => {
  test("ids come from network.json", () => {
    const ids = railLineIds();
    assert.ok(ids.includes("atlanta_streetcar"));
    assert.ok(ids.includes("marta_east"));
    assert.deepEqual(ids, network.rail.map((l) => l.id));
  });

  test("isRailLineId / validateBaseLineId accept only real ids", () => {
    assert.equal(isRailLineId("atlanta_streetcar"), true);
    assert.equal(isRailLineId("blue_line"), false);
    assert.equal(isRailLineId(""), false);
    assert.equal(validateBaseLineId("marta_east"), "marta_east");
    assert.equal(validateBaseLineId("MARTA_EAST"), undefined);
    assert.equal(validateBaseLineId(undefined), undefined);
  });

  test("findRailLineMentions matches names and ids, longest first, in order", () => {
    assert.deepEqual(findRailLineMentions("Extend the MARTA East Line past the Atlanta Streetcar"), ["marta_east", "atlanta_streetcar"]);
    assert.deepEqual(findRailLineMentions("marta_east_west is distinct from marta_east"), ["marta_east_west", "marta_east"]);
    assert.deepEqual(findRailLineMentions("Extend the Blue Line"), []);
  });
});

describe("roads", () => {
  test("isRoadId / validateRoadIds accept only real ids", () => {
    const real = network.roads[0].id;
    assert.equal(isRoadId(real), true);
    assert.equal(isRoadId("w0"), false);
    assert.deepEqual(validateRoadIds([real, "w0", real, "nope"]), { valid: [real], unknown: ["w0", "nope"] });
    assert.deepEqual(validateRoadIds(undefined), { valid: [], unknown: [] });
  });

  test("findRoadIdsByName matches exact normalised names and never guesses", () => {
    const ids = findRoadIdsByName("Edgewood Ave");
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.equal(isRoadId(id), true);
      assert.match(getRoad(id)!.name, /^Edgewood Avenue/);
    }
    // A quadrant in the mention restricts to that quadrant.
    const ne = findRoadIdsByName("Edgewood Avenue NE");
    assert.ok(ne.length > 0 && ne.length <= ids.length);
    for (const id of ne) assert.equal(getRoad(id)!.name, "Edgewood Avenue Northeast");
    // Unknown or partial names yield nothing.
    assert.deepEqual(findRoadIdsByName("Edgewood"), []);
    assert.deepEqual(findRoadIdsByName("Nonexistent Road"), []);
    assert.deepEqual(findRoadIdsByName(""), []);
  });

  test("a mention without a quadrant covers every quadrant of the street", () => {
    const all = findRoadIdsByName("North Avenue");
    const ne = findRoadIdsByName("North Avenue Northeast");
    const nw = findRoadIdsByName("North Avenue Northwest");
    assert.ok(ne.length > 0 && nw.length > 0);
    assert.equal(all.length, ne.length + nw.length);
  });

  test("findRoadMentions scans text, longest match first, skipping single-word names", () => {
    const m = findRoadMentions("Close Edgewood Avenue and Ralph McGill Blvd to cars; keep the boulevard open");
    assert.deepEqual(
      m.map((x) => x.name),
      ["edgewood avenue", "ralph mcgill boulevard"],
    );
    for (const x of m) {
      assert.ok(x.roadIds.length > 0);
      assert.ok(x.end > x.start);
      for (const id of x.roadIds) assert.equal(isRoadId(id), true);
    }
    assert.deepEqual(findRoadMentions("nothing here"), []);
  });
});
