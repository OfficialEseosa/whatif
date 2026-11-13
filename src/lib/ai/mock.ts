/**
 * Canned AI outputs used until Claude is wired in. Owner: Samuel.
 * Everything here must stay contract-valid (the routes validate it).
 */
import gazetteerJson from "@/data/gazetteer.json";
import {
  GazetteerSchema,
  type ExtractedClaim,
  type GazetteerPlace,
  type ScenarioEdit,
} from "@/lib/contract";

export const gazetteer: GazetteerPlace[] = GazetteerSchema.parse(gazetteerJson);
const byId = new Map(gazetteer.map((p) => [p.id, p]));

export const stopFromGazetteer = (id: string) => {
  const p = byId.get(id);
  if (!p) throw new Error(`unknown gazetteer id ${id}`);
  return { gazetteerId: p.id, name: p.name, coord: p.coord };
};

/** Sample article for "Paste an article" mode (written for the demo; not a real article). */
export const SAMPLE_ARTICLE =
  "City officials are studying a plan to run the Atlanta Streetcar east from its loop along Edgewood Avenue " +
  "and north up the Beltline's Eastside Trail to Ponce City Market. Backers say the extension could carry 10,000 riders a day " +
  "and would take cars off Ponce. The first estimate puts construction at about $190 million.";

/** Same stops the mock scenario generator uses (scripts/make-mock-scenario.mjs). */
export const STREETCAR_STOP_IDS = [
  "streetcar_king_historic_district",
  "beltline_edgewood",
  "beltline_irwin",
  "beltline_freedom_pkwy",
  "beltline_north_ave",
  "ponce_city_market",
];

export const EDGEWOOD_ROAD_IDS = ["w1378033903", "w1390663415", "w243830599", "w44062172", "w44062182", "w44163840", "w905997420", "w9272974"];

export function cannedStreetcarEdit(): ScenarioEdit {
  return {
    type: "extend_line",
    name: "Streetcar East to Ponce City Market",
    stops: STREETCAR_STOP_IDS.map(stopFromGazetteer),
    corridor: ["edgewood_ave", "beltline_eastside"],
    baseLineId: "atlanta_streetcar",
    tech: "streetcar",
    headwayMin: 10,
    // Edgewood Ave OSM ways (east of the loop to the Beltline) that lose a lane. Same list the mock
    // generator derives, so this canned edit matches the prebaked sim run exactly.
    roadIds: EDGEWOOD_ROAD_IDS,
    lanesRemoved: 1,
    assumptions: ["Canned edit: the plan parser is not wired to Claude yet."],
  };
}

export const CANNED_CLAIMS: ExtractedClaim[] = [
  { id: "c1", quote: "could carry 10,000 riders a day", metric: "daily_riders", claimedValue: 10000 },
  { id: "c2", quote: "for about $190 million", metric: "capital_cost_usd", claimedValue: 190e6 },
  { id: "c3", quote: "take cars off Ponce", metric: "traffic" },
];
