/**
 * Deterministic fallback planner for /api/plan.
 *
 * Used when ANTHROPIC_API_KEY is missing, the model call fails/times out, or
 * the model output is still invalid after one retry. Pure: same input -> same
 * output. No network, no randomness, no model.
 *
 * Rules (all defaults are recorded in `edit.assumptions`):
 *   type   keyword precedence: congestion_charge > close_road > brt_lane >
 *          extend_line > change_frequency (only without a "new/build" cue) >
 *          new_road > new_bus_route (when tech is bus) > new_rail_line.
 *   tech   brt > streetcar > light_rail > heavy_rail > bus; default streetcar
 *          for rail edits, brt for brt_lane, bus for new_bus_route, omitted
 *          for road-only edits. If an existing line is named, its kind wins.
 *   stops  gazetteer places in order of first mention (transit edits only).
 *   corridor  only ids from the matched places' `corridors`.
 *   baseLineId  a RailLine id named in the text; else `atlanta_streetcar` when
 *          tech is streetcar (recorded); else omitted.
 *   roadIds   only roads whose network name appears in the text.
 *   headwayMin  parsed from "every N minutes" etc.; change_frequency defaults
 *          to 10 (recorded); otherwise omitted.
 *   chargeUsd  parsed from "$N"; default 5 (recorded). chargeZone = convex hull
 *          of >= 3 mentioned places (coords from gazetteer only); else omitted.
 *   lanesRemoved  parsed from "N lanes"; default 1 (recorded).
 *   unknown places: Title-Case phrases not matched -> "Could not place 'X'".
 *   name   a defaulted value that appears in the title is suffixed "(assumed)"
 *          (base line, headway, charge); stated values are unqualified.
 */
import {
  PlanResponseSchema,
  checkEditAgainstGazetteer,
  type EditType,
  type GazetteerPlace,
  type LngLat,
  type Network,
  type PlanRequest,
  type PlanResponse,
  type ScenarioEdit,
  type Stop,
  type TransitTech,
} from "@/lib/contract";
import { findPlaceMatches, loadGazetteer, preclean, toStop, tokenize } from "./gazetteer";
import { findRailLineMentions, findRoadIdsByName, findRoadMentions, getRailLine, isRailLineId, loadNetwork } from "./network";
// Article-analyst's deterministic extractor (read-only dependency; never edited here).
import { extractClaimsDeterministic } from "@/lib/ai/article/extractClaims";

export const PARSER_NOTE = "Read with keyword rules, not Claude.";

export const DEFAULTS = {
  headwayMin: 10,
  chargeUsd: 5,
  lanesRemoved: 1,
  streetcarLineId: "atlanta_streetcar",
} as const;

/**
 * What the model read from the text (see ./claude.ts). Each value replaces the matching keyword
 * rule below; ids are still checked against the gazetteer and network here, so the model never
 * supplies a coordinate or an id that does not exist.
 */
export interface PlanHints {
  type?: EditType;
  tech?: TransitTech;
  stopIds?: string[];
  roadNames?: string[];
  baseLineId?: string;
  headwayMin?: number;
  lanesRemoved?: number;
  chargeUsd?: number;
  name?: string;
  notes?: string[];
  /** The text changes the plan already on screen rather than describing a new one. */
  changesPrevious?: boolean;
}

export interface FallbackOptions {
  gazetteer?: GazetteerPlace[];
  network?: Network;
  hints?: PlanHints;
}

/* ------------------------------------------------------------------------- */
/* Keyword rules                                                               */
/* ------------------------------------------------------------------------- */

const RX = {
  congestion:
    /\bcongestion[- ](charg|pric|fee|toll)|\bcordon\b|\btoll(s|ed|ing)?\b|\bdecongestion\b|\b(entry|entrance) fee\b|\bcharg(e|ing) (cars|drivers|vehicles|motorists)\b|\bpric(e|ing) (cars|drivers|driving)\b/,
  closeRoad:
    /\bclos(e|es|ed|ing)\b(?!\s+(to|by)\b)|\bclosure\b|\bshut(s|ting)? down\b|\bpedestrianis(e|ed|ing)\b|\bpedestrianiz(e|ed|ing)\b|\bcar[- ]free\b|\bban (cars|traffic|vehicles|driving)\b|\bno cars\b/,
  brt: /\bbrt\b|\bbus[- ]rapid[- ]transit\b|\bbusway\b|\bbus[- ]only\b|\b(dedicated|exclusive|transit|bus)[- ](priority[- ])?lanes?\b/,
  extend: /\bextend(s|ed|ing)?\b|\bextension\b|\blengthen(s|ed|ing)?\b|\bcontinue (the|it)\b|\bprolong/,
  frequency:
    /\bfrequenc(y|ies)\b|\bheadways?\b|\bmore (often|frequent(ly)?)\b|\bless (often|frequent(ly)?)\b|\b(increase|boost|double|improve|cut|reduce)( the)? (service|frequency)\b|\bmore (trains|buses|streetcars|trams)\b|\bfewer (trains|buses|streetcars|trams)\b|\bevery (\d+|five|ten|fifteen|twenty|thirty)\b/,
  /** A new-line cue: proposal verbs, "along", or a "from X to Y" route. Blocks change_frequency. */
  newCue: /\b(new|build|building|construct|add|adding|create|propose|lay|put in|open|along)\b|\bfrom\b[^.]{0,80}\bto\b/,
  newRoad:
    /\bnew (road|street|bridge|connector|overpass|underpass)\b|\b(build|construct|add|open)\b[^.]{0,30}\b(road|street|bridge|connector|overpass|underpass)\b/,
  techBrt: /\bbrt\b|\bbus[- ]rapid[- ]transit\b|\bbusway\b/,
  techStreetcar: /\bstreetcars?\b|\btrams?\b|\btrolley/,
  techLightRail: /\blight[- ]rail\b|\blrt\b/,
  techHeavyRail: /\bheavy[- ]rail\b|\bsubway\b|\bmetro\b|\bmarta (rail|line|train)/,
  techBus: /\bbus(es|ses)?\b/,
} as const;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};

function toNumber(s: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return NUMBER_WORDS[s];
}

const NUM = String.raw`(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty)`;
const HEADWAY_RX = [
  new RegExp(String.raw`\bevery\s+${NUM}\s*-?\s*min(?:ute)?s?\b`),
  new RegExp(String.raw`\b${NUM}\s*-?\s*min(?:ute)?s?\s+(?:headways?|frequenc(?:y|ies)|service|intervals?)\b`),
  new RegExp(String.raw`\bheadways?\s+(?:of|to|at)\s+${NUM}\b`),
];

export function parseHeadwayMin(text: string): number | undefined {
  const lower = text.toLowerCase();
  for (const rx of HEADWAY_RX) {
    const m = lower.match(rx);
    if (m) {
      const n = toNumber(m[1]);
      if (n !== undefined && n > 0) return n;
    }
  }
  return undefined;
}

export function parseChargeUsd(text: string): number | undefined {
  const lower = text.toLowerCase();
  const m = lower.match(/\$\s?(\d+(?:\.\d+)?)/) ?? lower.match(/\b(\d+(?:\.\d+)?)\s*(?:dollars|usd|bucks)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseLanesRemoved(text: string): number | undefined {
  const m = text.toLowerCase().match(new RegExp(String.raw`\b${NUM}\s*-?\s*(?:car\s+|general[- ]purpose\s+|travel\s+|traffic\s+)?lanes?\b`));
  if (!m) return undefined;
  const n = toNumber(m[1]);
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function detectTech(text: string): TransitTech | undefined {
  const lower = text.toLowerCase();
  if (RX.techBrt.test(lower)) return "brt";
  if (RX.techStreetcar.test(lower)) return "streetcar";
  if (RX.techLightRail.test(lower)) return "light_rail";
  if (RX.techHeavyRail.test(lower)) return "heavy_rail";
  if (RX.techBus.test(lower)) return "bus";
  return undefined;
}

export function detectEditType(text: string, tech: TransitTech | undefined): EditType {
  const lower = text.toLowerCase();
  if (RX.congestion.test(lower)) return "congestion_charge";
  if (RX.closeRoad.test(lower)) return "close_road";
  if (RX.brt.test(lower)) return "brt_lane";
  if (RX.extend.test(lower)) return "extend_line";
  if (RX.frequency.test(lower) && !RX.newCue.test(lower)) return "change_frequency";
  if (RX.newRoad.test(lower) && tech === undefined) return "new_road";
  if (tech === "bus") return "new_bus_route";
  return "new_rail_line";
}

const TECH_LABEL: Record<TransitTech, string> = {
  streetcar: "Streetcar",
  light_rail: "Light rail",
  heavy_rail: "Heavy rail",
  bus: "Bus",
  brt: "BRT",
};

const TRANSIT_TYPES: ReadonlySet<EditType> = new Set(["new_rail_line", "extend_line", "new_bus_route", "change_frequency", "brt_lane"]);
const ROAD_TYPES: ReadonlySet<EditType> = new Set(["close_road", "brt_lane", "new_road"]);

/* ------------------------------------------------------------------------- */
/* Unknown-place detection                                                     */
/* ------------------------------------------------------------------------- */

/** Words that are capitalised in proposals without naming a place. Normalised tokens. */
const PLACE_STOPWORDS = new Set(
  (
    "the a an and or to from via along through between with at in on of by for into onto under over " +
    "i we it this that these those there here new build building construct add adding run running extend " +
    "extending close closing closed make create put turn connect link convert open remove give propose " +
    "proposal plan let lets please what if would could should can will want need imagine suppose " +
    "streetcar streetcars tram trams trolley brt bus buses rail light heavy route routes " +
    "service stop stops marta atlanta beltline downtown uptown city council mayor state " +
    "toll tolls congestion charge charging pricing cordon zone frequency headway headways minute minutes min " +
    "peak every hour hours hourly daily day days week weeks am pm rush transit train trains subway metro " +
    "traffic cars car drivers riders commuters people " +
    "north south east west northeast northwest southeast southwest " +
    "usd million billion dollars extension corridor project phase study"
  ).split(/\s+/),
);
/** Place-type words: allowed inside or at the end of a phrase ("Imaginary Lane"), never on their own or first. */
const SUFFIX_WORDS = new Set(
  (
    "road roads street streets avenue boulevard parkway drive highway freeway expressway bridge lane lanes " +
    "line lines station stations square market plaza center university college hospital park district trail"
  ).split(/\s+/),
);
const CONNECTORS = new Set(["of", "de", "the", "la", "le", "du", "des", "del"]);

interface RawToken {
  raw: string;
  /** True when the token begins a sentence (first token or preceded by . ! ? ; : or a line break). */
  sentenceStart: boolean;
  /** True when only whitespace, "-" or "/" separate this token from the previous one. */
  joinedToPrev: boolean;
}

/** Raw tokens aligned 1:1 with `tokenize(text)`. */
function rawTokens(text: string): RawToken[] {
  const cleaned = preclean(text);
  const out: RawToken[] = [];
  let last = 0;
  for (const m of cleaned.matchAll(/[A-Za-z0-9]+/g)) {
    const gap = cleaned.slice(last, m.index);
    out.push({
      raw: m[0],
      sentenceStart: out.length === 0 || /[.!?;:\n\r]/.test(gap),
      joinedToPrev: out.length > 0 && /^[\s\-/]*$/.test(gap),
    });
    last = m.index + m[0].length;
  }
  return out;
}

/**
 * Title-Case phrases in the text that are not covered by any gazetteer or road
 * match and are not ordinary proposal words. Heuristic; used only to tell the
 * user what could not be placed. Never produces a stop.
 */
export function findUnplacedPhrases(text: string, covered: ReadonlySet<number>): string[] {
  const raws = rawTokens(text);
  const norm = tokenize(text);
  if (raws.length !== norm.length) return []; // alignment lost (should not happen); stay silent rather than guess
  const isCap = (i: number) => /^[A-Z]/.test(raws[i].raw);
  const isStop = (i: number) => PLACE_STOPWORDS.has(norm[i]);
  const isSuffix = (i: number) => SUFFIX_WORDS.has(norm[i]);
  const usable = (i: number) => !covered.has(i) && isCap(i);
  const canStart = (i: number) => usable(i) && !isStop(i) && !isSuffix(i);
  const phrases: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < raws.length) {
    if (!canStart(i)) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < raws.length && raws[end].joinedToPrev && !covered.has(end)) {
      if (isCap(end)) end += 1;
      else if (CONNECTORS.has(norm[end]) && end + 1 < raws.length && raws[end + 1].joinedToPrev && canStart(end + 1)) end += 2;
      else break;
    }
    // Trim generic stopwords and dangling connectors from the end (suffix words stay).
    const s = i;
    let e = end;
    while (e > s && (isStop(e - 1) || CONNECTORS.has(norm[e - 1]))) e -= 1;
    const len = e - s;
    const singleOk = len === 1 && !raws[s].sentenceStart && raws[s].raw.length > 1;
    if (len >= 2 || singleOk) {
      const phrase = raws.slice(s, e).map((t) => t.raw).join(" ");
      const key = phrase.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        phrases.push(phrase);
      }
    }
    i = Math.max(end, i + 1);
  }
  return phrases;
}

/* ------------------------------------------------------------------------- */
/* Geometry helper (gazetteer coords only)                                     */
/* ------------------------------------------------------------------------- */

/** Convex hull (Andrew's monotone chain). Returns [] when fewer than 3 non-collinear points. */
export function convexHull(points: LngLat[]): LngLat[] {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return [];
  const cross = (o: LngLat, a: LngLat, b: LngLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LngLat[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: LngLat[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? hull : [];
}

/* ------------------------------------------------------------------------- */
/* Main entry                                                                  */
/* ------------------------------------------------------------------------- */

function techFromLineKind(kind: "marta_heavy_rail" | "streetcar" | "freight"): TransitTech | undefined {
  if (kind === "marta_heavy_rail") return "heavy_rail";
  if (kind === "streetcar") return "streetcar";
  return undefined;
}

function corridorsFor(stops: Stop[], gazetteer: GazetteerPlace[]): string[] {
  const byId = new Map(gazetteer.map((p) => [p.id, p]));
  const count = new Map<string, number>();
  const order: string[] = [];
  for (const s of stops) {
    for (const c of byId.get(s.gazetteerId)?.corridors ?? []) {
      if (!count.has(c)) order.push(c);
      count.set(c, (count.get(c) ?? 0) + 1);
    }
  }
  const shared = order.filter((c) => (count.get(c) ?? 0) >= 2).sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b));
  return shared.length > 0 ? shared : order;
}

/** Build the deterministic ScenarioEdit for a request. Exported for tests; `fallbackPlan` wraps it. */
export function fallbackEdit(text: string, opts: FallbackOptions = {}): ScenarioEdit {
  const gazetteer = opts.gazetteer ?? loadGazetteer();
  const network = opts.network ?? loadNetwork();
  const hints = opts.hints;
  const assumptions: string[] = hints ? [...(hints.notes ?? [])] : [PARSER_NOTE];
  /** Which title-visible values came from DEFAULTS rather than the text; the title marks them "(assumed)". */
  const assumed = { baseLine: false, headway: false, charge: false };
  const mark = (value: string | number, isAssumed: boolean) => `${value}${isAssumed ? " (assumed)" : ""}`;

  // Tech and type.
  const explicitTech = hints?.tech ?? detectTech(text);
  const type = hints?.type ?? detectEditType(text, explicitTech);
  let tech: TransitTech | undefined = explicitTech;

  // Base line (extend_line / change_frequency only).
  let baseLineId: string | undefined;
  if (type === "extend_line" || type === "change_frequency") {
    const mentioned =
      hints?.baseLineId && isRailLineId(hints.baseLineId, network) ? [hints.baseLineId] : findRailLineMentions(text, network).filter((id) => id !== "freight");
    // MARTA colour names ("Red line") are not track names in network.json; map them to the track they run on.
    const colour = /\b(red|gold|blue|green)\s+line\b/i.exec(text)?.[1].toLowerCase();
    if (mentioned.length === 0 && colour) {
      const id = colour === "red" || colour === "gold" ? "marta_north" : "marta_east_west";
      if (isRailLineId(id, network)) {
        mentioned.push(id);
        assumptions.push(`The MARTA ${colour[0].toUpperCase()}${colour.slice(1)} line is read as the ${getRailLine(id, network)?.name ?? id}, the track it runs on here.`);
      }
    }
    if (mentioned.length > 0) {
      baseLineId = mentioned[0];
      const line = getRailLine(baseLineId, network);
      const lineTech = line ? techFromLineKind(line.kind) : undefined;
      if (lineTech && lineTech !== tech) {
        if (tech) assumptions.push(`Treated as ${TECH_LABEL[lineTech].toLowerCase()}, which is what the ${line?.name} runs.`);
        tech = lineTech;
      }
    } else if ((tech ?? "streetcar") === "streetcar" && isRailLineId(DEFAULTS.streetcarLineId, network)) {
      baseLineId = DEFAULTS.streetcarLineId;
      assumed.baseLine = true;
      assumptions.push("No existing line was named, so this extends the Atlanta Streetcar.");
    } else {
      assumptions.push("Couldn't tell which existing line you meant.");
    }
  }

  // Tech defaults.
  if (type === "brt_lane") {
    tech = "brt";
  } else if (type === "new_bus_route") {
    tech = "bus";
  } else if (TRANSIT_TYPES.has(type) && tech === undefined) {
    tech = "streetcar";
    assumptions.push("Assumed a streetcar; you didn't say what kind of vehicle.");
  } else if (!TRANSIT_TYPES.has(type)) {
    tech = undefined;
  }

  // Places and stops.
  const placeMatches = findPlaceMatches(text, gazetteer);
  const covered = new Set<number>();
  const placeIds: string[] = [];
  for (const m of placeMatches) {
    for (let i = m.start; i < m.end; i++) covered.add(i);
    if (!placeIds.includes(m.id)) placeIds.push(m.id);
  }
  if (hints?.stopIds) placeIds.splice(0, placeIds.length, ...new Set(hints.stopIds));
  const places = placeIds.map((id) => toStop(id, gazetteer)).filter((s): s is Stop => s !== undefined);
  const stops = TRANSIT_TYPES.has(type) ? places : [];
  if (TRANSIT_TYPES.has(type)) {
    // A frequency change needs a line and a bus lane can run on a named street; neither needs places.
    const needsPlaces = type !== "change_frequency" && type !== "brt_lane";
    if (needsPlaces && stops.length === 0) assumptions.push("No place from the map was found in your text, so the plan has no stops.");
    else if (needsPlaces && stops.length === 1) assumptions.push(`Only found one place, ${stops[0].name}. A line needs at least two.`);
  } else if (places.length > 0) {
    assumptions.push(`${places.map((p) => p.name).join(", ")} noted, but this kind of plan has no stops.`);
  }

  // Roads.
  let roadIds: string[] | undefined;
  let roadNames: string[] = [];
  // Road shorthands ("Ponce") never match inside a place name ("Ponce City Market").
  const placeTokens: ReadonlySet<number> = new Set(covered);
  if (ROAD_TYPES.has(type)) {
    const mentions = findRoadMentions(text, network, placeTokens);
    for (const m of mentions) for (let i = m.start; i < m.end; i++) covered.add(i);
    const hinted = (hints?.roadNames ?? []).map((name) => ({ name, ids: findRoadIdsByName(name, network) })).filter((r) => r.ids.length > 0);
    const hintIds = hinted.flatMap((r) => r.ids);
    const ids = [...new Set(hintIds.length > 0 ? hintIds : mentions.flatMap((m) => m.roadIds))];
    roadNames = hintIds.length > 0 ? hinted.map((r) => r.name) : mentions.map((m) => m.displayName);
    if (ids.length > 0) roadIds = ids;
    else if (type === "brt_lane" && stops.length >= 2) assumptions.push("No street named, so the bus lane follows the streets between the stops.");
    else assumptions.push("No street from the map matched your text.");
  } else {
    // Still mark road mentions as covered so they are not reported as unknown places.
    for (const m of findRoadMentions(text, network, placeTokens)) for (let i = m.start; i < m.end; i++) covered.add(i);
  }

  // Unknown places.
  if (!hints) for (const phrase of findUnplacedPhrases(text, covered)) assumptions.push(`Couldn't find '${phrase}' on the map.`);

  // Numeric fields.
  let headwayMin: number | undefined;
  if (TRANSIT_TYPES.has(type)) {
    headwayMin = hints?.headwayMin ?? parseHeadwayMin(text);
    if (headwayMin === undefined && type === "change_frequency") {
      headwayMin = DEFAULTS.headwayMin;
      assumed.headway = true;
      assumptions.push(`Assumed every ${DEFAULTS.headwayMin} minutes; you didn't say how often.`);
    }
  }
  let lanesRemoved: number | undefined;
  if (type === "brt_lane") {
    lanesRemoved = hints?.lanesRemoved ?? parseLanesRemoved(text);
    if (lanesRemoved === undefined) {
      lanesRemoved = DEFAULTS.lanesRemoved;
      assumptions.push(`Assumed ${DEFAULTS.lanesRemoved} car lane each way becomes the bus lane; you didn't say how many.`);
    }
  }
  let chargeUsd: number | undefined;
  let chargeZone: LngLat[] | undefined;
  if (type === "congestion_charge") {
    chargeUsd = hints?.chargeUsd ?? parseChargeUsd(text);
    if (chargeUsd === undefined) {
      chargeUsd = DEFAULTS.chargeUsd;
      assumed.charge = true;
      assumptions.push(`Assumed $${DEFAULTS.chargeUsd} per entry; you didn't give a price.`);
    }
    const hull = convexHull(places.map((p) => p.coord));
    if (hull.length >= 3) {
      chargeZone = hull;
      assumptions.push(`The charge zone is drawn around ${places.map((p) => p.name).join(", ")}.`);
    } else {
      assumptions.push("Fewer than three places named, so no charge zone could be drawn.");
    }
  }

  // Corridor.
  const corridor = corridorsFor(stops, gazetteer);

  // Name.
  const first = stops[0]?.name;
  const last = stops.length > 1 ? stops[stops.length - 1].name : undefined;
  const span = first && last ? `${first} to ${last}` : first;
  // Title: any value that came from DEFAULTS is marked "(assumed)"; stated values stay unqualified.
  const lineName = mark(baseLineId ? (getRailLine(baseLineId, network)?.name ?? baseLineId) : "line", assumed.baseLine);
  const roadLabel = roadNames.length > 0 ? roadNames.join(", ") : undefined;
  let name: string;
  switch (type) {
    case "new_rail_line":
      name = span ? `${TECH_LABEL[tech ?? "streetcar"]} line: ${span}` : `${TECH_LABEL[tech ?? "streetcar"]} line (no stops found)`;
      break;
    case "new_bus_route":
      name = span ? `Bus route: ${span}` : "Bus route (no stops found)";
      break;
    case "extend_line":
      name = (last ?? first) !== undefined ? `Extend ${lineName} to ${last ?? first}` : `Extend ${lineName}`;
      break;
    case "change_frequency":
      name = `${lineName}: every ${mark(`${headwayMin} min`, assumed.headway)}`;
      break;
    case "brt_lane":
      name = roadLabel ? `BRT lane on ${roadLabel}` : span ? `BRT lane: ${span}` : "BRT lane (no road matched)";
      break;
    case "close_road":
      name = roadLabel ? `Close ${roadLabel}` : "Close road (no road matched)";
      break;
    case "new_road":
      name = roadLabel ? `New road near ${roadLabel}` : "New road (no road matched)";
      break;
    case "congestion_charge":
      name = `Congestion charge: ${mark(`$${chargeUsd} per entry`, assumed.charge)}`;
      break;
  }
  if (hints?.name) name = hints.name;

  const edit: ScenarioEdit = {
    type,
    name,
    stops,
    ...(corridor.length > 0 ? { corridor } : {}),
    ...(baseLineId ? { baseLineId } : {}),
    ...(tech ? { tech } : {}),
    ...(headwayMin !== undefined ? { headwayMin } : {}),
    ...(roadIds ? { roadIds } : {}),
    ...(lanesRemoved !== undefined ? { lanesRemoved } : {}),
    ...(chargeUsd !== undefined ? { chargeUsd } : {}),
    ...(chargeZone ? { chargeZone } : {}),
    assumptions,
  };

  // Belt and braces: stops come from toStop(), so this is always [].
  const problems = checkEditAgainstGazetteer(edit, gazetteer);
  if (problems.length > 0) {
    edit.stops = edit.stops.filter((s) => !problems.some((p) => p.includes(`"${s.name}"`)));
    edit.assumptions = [...assumptions, ...problems.map((p) => `Dropped stop: ${p}`)];
  }
  return edit;
}

/**
 * PlanResponse built by the rules above. `isMock: true` unless the model's `hints` were used. Article mode: `claims`
 * from article-analyst's `extractClaimsDeterministic`. Fix mode: `candidates`
 * omitted; alternatives need the model and simulation results.
 */
export function fallbackPlan(req: PlanRequest, opts: FallbackOptions = {}): PlanResponse {
  const edit = fallbackEdit(req.text, opts);
  if (req.mode === "fix") {
    edit.assumptions = [...(edit.assumptions ?? []), "No alternative fixes were generated for this."];
    return PlanResponseSchema.parse({ edit, isMock: true });
  }
  const isMock = !opts.hints;
  if (req.mode === "article") {
    if (isMock) edit.assumptions = [...(edit.assumptions ?? []), "Claims in the article were picked out by keyword rules."];
    return PlanResponseSchema.parse({ edit, claims: extractClaimsDeterministic(req.text), isMock });
  }
  return PlanResponseSchema.parse({ edit, isMock });
}
