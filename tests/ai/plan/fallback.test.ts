import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ExtractedClaimSchema,
  GazetteerSchema,
  PlanResponseSchema,
  ScenarioEditSchema,
  checkEditAgainstGazetteer,
  type PlanRequest,
} from "@/lib/contract";
import gazetteerJson from "@/data/gazetteer.json";
import {
  DEFAULTS,
  PARSER_NOTE,
  convexHull,
  detectEditType,
  detectTech,
  fallbackPlan,
  findUnplacedPhrases,
  parseChargeUsd,
  parseHeadwayMin,
  parseLanesRemoved,
} from "@/lib/ai/plan/fallback";
import { isRailLineId, isRoadId } from "@/lib/ai/plan/network";

const gaz = GazetteerSchema.parse(gazetteerJson);
const byId = new Map(gaz.map((p) => [p.id, p]));
const req = (text: string, mode: PlanRequest["mode"] = "prompt"): PlanRequest => ({ text, mode });

/** Every output must be contract-valid, gazetteer-grounded and network-grounded. */
function checkResponse(res: unknown) {
  const parsed = PlanResponseSchema.parse(res);
  assert.ok(ScenarioEditSchema.safeParse(parsed.edit).success);
  assert.deepEqual(checkEditAgainstGazetteer(parsed.edit, gaz), []);
  assert.equal(parsed.isMock, true);
  assert.ok(parsed.edit.assumptions?.includes(PARSER_NOTE));
  if (parsed.edit.baseLineId !== undefined) assert.equal(isRailLineId(parsed.edit.baseLineId), true);
  for (const id of parsed.edit.roadIds ?? []) assert.equal(isRoadId(id), true);
  for (const c of parsed.edit.corridor ?? []) {
    assert.ok(parsed.edit.stops.some((s) => byId.get(s.gazetteerId)?.corridors?.includes(c)), `corridor ${c} must come from a stop`);
  }
  return parsed;
}

const CORPUS = [
  "Build a streetcar from PCM to Krog St",
  "Streetcar from Ponce City Market to Emory University",
  "Close Edgewood Avenue to cars",
  "BRT lane on Ponce de Leon Ave, remove 2 lanes",
  "Charge $8 to drive downtown: cordon around Five Points, Peachtree Center and Georgia State",
  "Extend the streetcar to Ponce City Market",
  "Extend the MARTA East Line to Little Five Points",
  "Run the Atlanta Streetcar every 5 minutes",
  "Run the streetcar more often",
  "New bus route from Georgia Tech to Grady",
  "A new line from Midtown to Inman Park",
  "Add a streetcar stop close to Piedmont Park",
  "Build a new road from Krog Street to Reynoldstown",
  "pedestrianize Auburn Avenue",
  "Light rail along the Beltline from Krog Street Market to Beltline at Ponce de Leon Ave every ten minutes",
  "",
  "nothing relevant at all",
  "Toll the Downtown Connector",
];

describe("fallbackPlan: contract and grounding", () => {
  test("every corpus output passes PlanResponseSchema and checkEditAgainstGazetteer === []", () => {
    for (const text of CORPUS) {
      if (text.length === 0) continue; // PlanRequestSchema would reject it upstream; fallback still handles it below
      checkResponse(fallbackPlan(req(text)));
    }
    checkResponse(fallbackPlan(req("", "prompt")));
  });

  test("is deterministic (same input -> deep-equal output, across modes)", () => {
    for (const text of CORPUS) {
      for (const mode of ["prompt", "article", "fix"] as const) {
        assert.deepEqual(fallbackPlan(req(text, mode)), fallbackPlan(req(text, mode)));
      }
    }
  });

  test("never emits metrics, costs or outcomes", () => {
    for (const text of CORPUS) {
      const res = fallbackPlan(req(text));
      const keys = Object.keys(res.edit);
      for (const k of ["riders", "cost", "metrics", "verdict"]) assert.ok(!keys.includes(k));
    }
  });
});

describe("fallbackPlan: aliases and stops", () => {
  test("PCM and Krog St resolve to the right ids and gazetteer coords", () => {
    const { edit } = checkResponse(fallbackPlan(req("Build a streetcar from PCM to Krog St")));
    assert.equal(edit.type, "new_rail_line");
    assert.equal(edit.tech, "streetcar");
    assert.deepEqual(
      edit.stops.map((s) => s.gazetteerId),
      ["ponce_city_market", "krog_street_market"],
    );
    assert.deepEqual(edit.stops[0].coord, byId.get("ponce_city_market")!.coord);
    assert.deepEqual(edit.stops[1].coord, byId.get("krog_street_market")!.coord);
    assert.equal(edit.stops[1].name, "Krog Street Market");
    assert.ok(edit.corridor?.includes("beltline_eastside"));
    assert.ok(!edit.assumptions?.some((a) => a.startsWith("Assumed streetcar")), "tech was explicit");
    assert.equal(edit.name, "Streetcar line: Ponce City Market to Krog Street Market");
  });

  test("unknown place -> assumption, never an invented stop", () => {
    const { edit } = checkResponse(fallbackPlan(req("Streetcar from Ponce City Market to Emory University")));
    assert.deepEqual(
      edit.stops.map((s) => s.gazetteerId),
      ["ponce_city_market"],
    );
    assert.ok(edit.assumptions?.includes("Could not place 'Emory University'; not in gazetteer."));
    assert.ok(edit.assumptions?.some((a) => a.startsWith("Only one place found")));
  });

  test("no place at all -> empty stops and an assumption", () => {
    const { edit } = checkResponse(fallbackPlan(req("nothing relevant at all")));
    assert.deepEqual(edit.stops, []);
    assert.ok(edit.assumptions?.includes("No gazetteer place found in the text; stops are empty."));
    assert.equal(edit.corridor, undefined);
  });

  test("corridor ids only come from matched places", () => {
    const { edit } = checkResponse(fallbackPlan(req("Streetcar from Five Points to Grady")));
    assert.equal(edit.corridor, undefined, "neither place lists corridors");
    const two = checkResponse(fallbackPlan(req("Streetcar from PCM to Beltline at North Ave"))).edit;
    assert.deepEqual(two.corridor, ["beltline_eastside", "north_ave"]);
  });
});

describe("fallbackPlan: edit types and defaults (each default is recorded in assumptions)", () => {
  test("default tech is streetcar and is recorded", () => {
    const { edit } = checkResponse(fallbackPlan(req("A new line from Midtown to Inman Park")));
    assert.equal(edit.type, "new_rail_line");
    assert.equal(edit.tech, "streetcar");
    assert.ok(edit.assumptions?.includes("Assumed streetcar technology; not stated."));
    assert.equal(edit.headwayMin, undefined, "headway not invented for a new line");
  });

  test("bus keyword -> new_bus_route", () => {
    const { edit } = checkResponse(fallbackPlan(req("New bus route from Georgia Tech to Grady")));
    assert.equal(edit.type, "new_bus_route");
    assert.equal(edit.tech, "bus");
    assert.deepEqual(
      edit.stops.map((s) => s.gazetteerId),
      ["georgia_tech", "grady_memorial"],
    );
  });

  test("extend the streetcar -> extend_line on atlanta_streetcar (recorded default)", () => {
    const { edit } = checkResponse(fallbackPlan(req("Extend the streetcar to Ponce City Market")));
    assert.equal(edit.type, "extend_line");
    assert.equal(edit.baseLineId, DEFAULTS.streetcarLineId);
    assert.equal(edit.tech, "streetcar");
    assert.ok(edit.assumptions?.some((a) => a.includes("Assumed base line is the Atlanta Streetcar")));
    assert.equal(edit.name, "Extend Atlanta Streetcar (assumed) to Ponce City Market");
  });

  test("extend a named MARTA line -> that line id, tech from the line's kind", () => {
    const { edit } = checkResponse(fallbackPlan(req("Extend the MARTA East Line to Little Five Points")));
    assert.equal(edit.type, "extend_line");
    assert.equal(edit.baseLineId, "marta_east");
    assert.equal(edit.tech, "heavy_rail");
    assert.deepEqual(
      edit.stops.map((s) => s.gazetteerId),
      ["little_five_points"],
    );
  });

  test("frequency with a stated headway", () => {
    const { edit } = checkResponse(fallbackPlan(req("Run the Atlanta Streetcar every 5 minutes")));
    assert.equal(edit.type, "change_frequency");
    assert.equal(edit.baseLineId, "atlanta_streetcar");
    assert.equal(edit.headwayMin, 5);
    assert.ok(!edit.assumptions?.some((a) => a.includes("Assumed 10-min")));
  });

  test("frequency without a headway -> documented default, recorded", () => {
    const { edit } = checkResponse(fallbackPlan(req("Run the streetcar more often")));
    assert.equal(edit.type, "change_frequency");
    assert.equal(edit.headwayMin, DEFAULTS.headwayMin);
    assert.ok(edit.assumptions?.includes(`Assumed ${DEFAULTS.headwayMin}-min peak headway; not stated.`));
  });

  test("'every N minutes' on a new line is a headway, not a frequency change", () => {
    const { edit } = checkResponse(
      fallbackPlan(req("Light rail along the Beltline from Krog Street Market to Beltline at Ponce de Leon Ave every ten minutes")),
    );
    assert.equal(edit.type, "new_rail_line");
    assert.equal(edit.tech, "light_rail");
    assert.equal(edit.headwayMin, 10);
    assert.deepEqual(edit.corridor, ["beltline_eastside"]);
  });

  test("close_road: roadIds are real network ids for the named street; stops empty", () => {
    const { edit } = checkResponse(fallbackPlan(req("Close Edgewood Avenue to cars")));
    assert.equal(edit.type, "close_road");
    assert.deepEqual(edit.stops, []);
    assert.equal(edit.tech, undefined);
    assert.ok((edit.roadIds?.length ?? 0) > 0);
    assert.equal(edit.name, "Close Edgewood Avenue Northeast");
  });

  test("close_road with no matching road -> roadIds omitted and recorded", () => {
    const { edit } = checkResponse(fallbackPlan(req("Close Imaginary Lane to cars")));
    assert.equal(edit.type, "close_road");
    assert.equal(edit.roadIds, undefined);
    assert.ok(edit.assumptions?.includes("No road in the network matched a name in the text; roadIds omitted."));
    assert.ok(edit.assumptions?.includes("Could not place 'Imaginary Lane'; not in gazetteer."));
  });

  test("'close to' is not a road closure", () => {
    const { edit } = checkResponse(fallbackPlan(req("Add a streetcar stop close to Piedmont Park")));
    assert.notEqual(edit.type, "close_road");
    assert.deepEqual(
      edit.stops.map((s) => s.gazetteerId),
      ["piedmont_park"],
    );
  });

  test("pedestrianize -> close_road", () => {
    const { edit } = checkResponse(fallbackPlan(req("pedestrianize Auburn Avenue")));
    assert.equal(edit.type, "close_road");
    assert.ok((edit.roadIds?.length ?? 0) > 0);
  });

  test("brt_lane: tech brt, parsed lanesRemoved, real roadIds", () => {
    const { edit } = checkResponse(fallbackPlan(req("BRT lane on Ponce de Leon Ave, remove 2 lanes")));
    assert.equal(edit.type, "brt_lane");
    assert.equal(edit.tech, "brt");
    assert.equal(edit.lanesRemoved, 2);
    assert.ok((edit.roadIds?.length ?? 0) > 0);
    assert.ok(!edit.assumptions?.some((a) => a.startsWith("Assumed 1 car lane")));
  });

  test("brt_lane without lane count -> default 1, recorded", () => {
    const { edit } = checkResponse(fallbackPlan(req("Dedicated bus lane on North Avenue")));
    assert.equal(edit.type, "brt_lane");
    assert.equal(edit.lanesRemoved, DEFAULTS.lanesRemoved);
    assert.ok(edit.assumptions?.includes(`Assumed ${DEFAULTS.lanesRemoved} car lane removed per direction; not stated.`));
  });

  test("congestion_charge: parsed charge and hull of >= 3 places", () => {
    const { edit } = checkResponse(
      fallbackPlan(req("Charge $8 to drive downtown: cordon around Five Points, Peachtree Center and Georgia State")),
    );
    assert.equal(edit.type, "congestion_charge");
    assert.equal(edit.chargeUsd, 8);
    assert.deepEqual(edit.stops, []);
    assert.ok(edit.chargeZone && edit.chargeZone.length >= 3);
    const coords = new Set(gaz.map((p) => p.coord.join(",")));
    for (const pt of edit.chargeZone!) assert.ok(coords.has(pt.join(",")), "zone vertices come from the gazetteer only");
  });

  test("congestion_charge without an amount or places -> defaults recorded, zone omitted", () => {
    const { edit } = checkResponse(fallbackPlan(req("Toll the Downtown Connector")));
    assert.equal(edit.type, "congestion_charge");
    assert.equal(edit.chargeUsd, DEFAULTS.chargeUsd);
    assert.equal(edit.chargeZone, undefined);
    assert.ok(edit.assumptions?.includes(`Assumed $${DEFAULTS.chargeUsd} per entry; not stated.`));
    assert.ok(edit.assumptions?.includes("Fewer than three places mentioned; chargeZone omitted."));
  });

  test("new_road when a road is proposed and no transit tech is named", () => {
    const { edit } = checkResponse(fallbackPlan(req("Build a new road from Krog Street to Reynoldstown")));
    assert.equal(edit.type, "new_road");
    assert.deepEqual(edit.stops, []);
  });
});

describe("fallbackPlan: titles mark defaulted values as assumed, stated values stay unqualified", () => {
  test("change_frequency: stated line and headway -> no qualifier", () => {
    const { edit } = checkResponse(fallbackPlan(req("Run the Atlanta Streetcar every 5 minutes")));
    assert.equal(edit.name, "Atlanta Streetcar: every 5 min");
    assert.ok(!edit.name.includes("(assumed)"));
  });

  test("change_frequency: defaulted line and headway -> both marked", () => {
    const { edit } = checkResponse(fallbackPlan(req("Run the streetcar more often")));
    assert.equal(edit.name, "Atlanta Streetcar (assumed): every 10 min (assumed)");
  });

  test("change_frequency: stated line, defaulted headway -> only the headway marked", () => {
    const { edit } = checkResponse(fallbackPlan(req("Run the Atlanta Streetcar more often")));
    assert.equal(edit.name, "Atlanta Streetcar: every 10 min (assumed)");
  });

  test("extend_line: named line -> no qualifier; defaulted line -> marked", () => {
    const named = checkResponse(fallbackPlan(req("Extend the MARTA East Line to Little Five Points"))).edit;
    assert.equal(named.name, "Extend MARTA East Line to Little Five Points");
    const defaulted = checkResponse(fallbackPlan(req("Extend the streetcar to Ponce City Market"))).edit;
    assert.equal(defaulted.name, "Extend Atlanta Streetcar (assumed) to Ponce City Market");
  });

  test("congestion_charge: stated amount -> no qualifier; defaulted amount -> marked", () => {
    const stated = checkResponse(fallbackPlan(req("Charge drivers $8 to enter downtown"))).edit;
    assert.equal(stated.name, "Congestion charge: $8 per entry");
    const defaulted = checkResponse(fallbackPlan(req("Toll the Downtown Connector"))).edit;
    assert.equal(defaulted.name, "Congestion charge: $5 per entry (assumed)");
  });

  test("a title contains '(assumed)' only when a matching default is recorded in assumptions", () => {
    for (const text of CORPUS) {
      if (!text) continue;
      const { edit } = fallbackPlan(req(text));
      const marked = edit.name.includes("(assumed)");
      const recorded = edit.assumptions?.some((a) => a.startsWith("Assumed")) ?? false;
      if (marked) assert.ok(recorded, `"${text}": title marks an assumption that is not recorded`);
    }
  });
});

describe("fallbackPlan: modes", () => {
  test("fix mode omits candidates and says so", () => {
    const res = checkResponse(fallbackPlan(req("Build a streetcar from PCM to Krog St", "fix")));
    assert.equal(res.candidates, undefined);
    assert.ok(res.edit.assumptions?.some((a) => a.startsWith("Fix mode:")));
  });

  test("article mode returns the edit plus deterministic claims", () => {
    const text = "The city will extend the streetcar to Ponce City Market, carrying 10,000 riders a day.";
    const res = checkResponse(fallbackPlan(req(text, "article")));
    assert.equal(res.edit.type, "extend_line");
    assert.equal(res.edit.baseLineId, "atlanta_streetcar");
    assert.ok(res.claims && res.claims.length >= 1, "claims present in article mode");
    for (const c of res.claims) {
      assert.ok(ExtractedClaimSchema.safeParse(c).success);
      assert.ok(text.replace(/\s+/g, " ").includes(c.quote), "quote is verbatim");
    }
    assert.ok(res.claims.some((c) => c.metric === "daily_riders" && c.claimedValue === 10000));
    assert.ok(res.edit.assumptions?.some((a) => a.startsWith("Article mode:")));
  });

  test("prompt mode has neither claims nor candidates", () => {
    const res = checkResponse(fallbackPlan(req("Build a streetcar from PCM to Krog St")));
    assert.equal(res.claims, undefined);
    assert.equal(res.candidates, undefined);
  });
});

describe("parsers", () => {
  test("detectTech precedence", () => {
    assert.equal(detectTech("a BRT line with buses"), "brt");
    assert.equal(detectTech("replace the bus with a streetcar"), "streetcar");
    assert.equal(detectTech("light rail"), "light_rail");
    assert.equal(detectTech("a new subway"), "heavy_rail");
    assert.equal(detectTech("more buses"), "bus");
    assert.equal(detectTech("a line"), undefined);
  });

  test("detectEditType precedence", () => {
    assert.equal(detectEditType("close the road and toll it", undefined), "congestion_charge");
    assert.equal(detectEditType("close the road for a BRT lane", "brt"), "close_road");
    assert.equal(detectEditType("extend the line and run it every 5 minutes", "streetcar"), "extend_line");
    assert.equal(detectEditType("run it every 5 minutes", "streetcar"), "change_frequency");
    assert.equal(detectEditType("build a bus route", "bus"), "new_bus_route");
    assert.equal(detectEditType("do something", undefined), "new_rail_line");
  });

  test("numeric parsers", () => {
    assert.equal(parseHeadwayMin("every 7 minutes"), 7);
    assert.equal(parseHeadwayMin("every ten min"), 10);
    assert.equal(parseHeadwayMin("5-minute headways"), 5);
    assert.equal(parseHeadwayMin("headway of 12"), 12);
    assert.equal(parseHeadwayMin("no number"), undefined);
    assert.equal(parseChargeUsd("$5.50 per entry"), 5.5);
    assert.equal(parseChargeUsd("10 dollars"), 10);
    assert.equal(parseChargeUsd("free"), undefined);
    assert.equal(parseLanesRemoved("remove two lanes"), 2);
    assert.equal(parseLanesRemoved("one lane"), 1);
    assert.equal(parseLanesRemoved("a bus lane"), undefined);
  });

  test("findUnplacedPhrases ignores proposal words and sentence-initial single words", () => {
    assert.deepEqual(findUnplacedPhrases("Build a streetcar to Emory University and Decatur Square.", new Set()), ["Emory University", "Decatur Square"]);
    assert.deepEqual(findUnplacedPhrases("Build MARTA to the Atlanta Beltline", new Set()), []);
    assert.deepEqual(findUnplacedPhrases("Krog Street Market", new Set([0, 1, 2])), []);
  });

  test("convexHull needs three non-collinear points", () => {
    assert.deepEqual(convexHull([]), []);
    assert.deepEqual(
      convexHull([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
      [],
    );
    const hull = convexHull([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ]);
    assert.equal(hull.length, 4);
  });
});
