/**
 * Gazetteer resolver for /api/plan.
 *
 * The gazetteer (src/data/gazetteer.json, owned by history-researcher) is the
 * only source of stop coordinates. This module:
 *   - normalises names/aliases (case, punctuation, "St"/"Street", "Ave"/"Avenue", ...),
 *   - finds place mentions in free text (`findPlaces`), longest match first, no
 *     overlapping matches, in order of first mention,
 *   - builds contract `Stop`s from gazetteer ids only (`toStop`).
 *
 * Everything here is pure and deterministic. No coordinate is ever derived from
 * text; it always comes from the gazetteer entry.
 */
import { GazetteerSchema, type GazetteerPlace, type Stop } from "@/lib/contract";
import gazetteerJson from "@/data/gazetteer.json";

/* ------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* ------------------------------------------------------------------------- */

/** Token-level abbreviation expansions (applied after lower-casing). */
const EXPANSIONS: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  pkwy: "parkway",
  pky: "parkway",
  dr: "drive",
  rd: "road",
  hwy: "highway",
  fwy: "freeway",
  expy: "expressway",
  ln: "lane",
  ct: "court",
  pl: "place",
  ter: "terrace",
  sq: "square",
  ctr: "center",
  centre: "center",
  mt: "mount",
  ft: "fort",
  jr: "junior",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  and: "and",
  "&": "and",
};

/**
 * Case-preserving pre-clean shared by `tokenize` and the raw-token scanner in
 * fallback.ts (they must stay 1:1 aligned): apostrophes deleted ("O'Neal" ->
 * "ONeal"), "&" -> "and", dotted acronyms collapsed ("P.C.M." -> "PCM").
 */
export function preclean(text: string): string {
  return text
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(?:[a-z]\.){2,}/gi, (m) => m.replace(/\./g, ""));
}

/**
 * Split text into normalised tokens: lower-case, punctuation removed
 * (everything non-alphanumeric splits), common street abbreviations expanded.
 */
export function tokenize(text: string): string[] {
  const cleaned = preclean(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(" ").map((t) => EXPANSIONS[t] ?? t);
}

/** Normalised form of a name or alias: tokens joined by single spaces. */
export function normalizeName(name: string): string {
  return tokenize(name).join(" ");
}

/* ------------------------------------------------------------------------- */
/* Gazetteer loading and index                                                 */
/* ------------------------------------------------------------------------- */

let cachedGazetteer: GazetteerPlace[] | null = null;

/** The validated gazetteer (parsed once, then cached). */
export function loadGazetteer(): GazetteerPlace[] {
  if (!cachedGazetteer) cachedGazetteer = GazetteerSchema.parse(gazetteerJson);
  return cachedGazetteer;
}

interface AliasEntry {
  id: string;
  tokens: string[];
}

interface GazetteerIndex {
  byId: Map<string, GazetteerPlace>;
  /** normalised alias -> place id (first gazetteer entry wins on exact duplicates). */
  byAlias: Map<string, AliasEntry>;
  /** Alias token lists, longest first, for longest-match scanning. */
  aliases: AliasEntry[];
  /** Longest alias length in tokens. */
  maxTokens: number;
}

const indexCache = new WeakMap<GazetteerPlace[], GazetteerIndex>();

function buildIndex(gazetteer: GazetteerPlace[]): GazetteerIndex {
  const byId = new Map<string, GazetteerPlace>();
  const byAlias = new Map<string, AliasEntry>();
  for (const place of gazetteer) {
    byId.set(place.id, place);
    for (const raw of [place.name, ...place.aliases]) {
      const tokens = tokenize(raw);
      if (tokens.length === 0) continue;
      const key = tokens.join(" ");
      if (!byAlias.has(key)) byAlias.set(key, { id: place.id, tokens });
    }
  }
  const aliases = [...byAlias.values()].sort((a, b) => b.tokens.length - a.tokens.length);
  const maxTokens = aliases.reduce((m, a) => Math.max(m, a.tokens.length), 0);
  return { byId, byAlias, aliases, maxTokens };
}

function getIndex(gazetteer: GazetteerPlace[]): GazetteerIndex {
  let idx = indexCache.get(gazetteer);
  if (!idx) {
    idx = buildIndex(gazetteer);
    indexCache.set(gazetteer, idx);
  }
  return idx;
}

/* ------------------------------------------------------------------------- */
/* Lookup                                                                      */
/* ------------------------------------------------------------------------- */

/** Place by id, or undefined. */
export function getPlace(id: string, gazetteer: GazetteerPlace[] = loadGazetteer()): GazetteerPlace | undefined {
  return getIndex(gazetteer).byId.get(id);
}

/** Resolve one exact name/alias (normalised) to a place id, or undefined. */
export function resolveAlias(name: string, gazetteer: GazetteerPlace[] = loadGazetteer()): string | undefined {
  return getIndex(gazetteer).byAlias.get(normalizeName(name))?.id;
}

export interface PlaceMatch {
  id: string;
  /** Index of the first matched token in `tokenize(text)`. */
  start: number;
  /** Index one past the last matched token. */
  end: number;
  /** The normalised alias that matched. */
  matched: string;
}

/**
 * Scan text for gazetteer names/aliases. At each token position the longest
 * alias wins; the scan then resumes after it, so matches never overlap.
 * Returns every match in text order (the same place may appear more than once).
 */
export function findPlaceMatches(text: string, gazetteer: GazetteerPlace[] = loadGazetteer()): PlaceMatch[] {
  const idx = getIndex(gazetteer);
  const tokens = tokenize(text);
  const matches: PlaceMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    let found: PlaceMatch | null = null;
    const maxLen = Math.min(idx.maxTokens, tokens.length - i);
    for (let len = maxLen; len >= 1 && !found; len--) {
      const key = tokens.slice(i, i + len).join(" ");
      const entry = idx.byAlias.get(key);
      if (entry) found = { id: entry.id, start: i, end: i + len, matched: key };
    }
    if (found) {
      matches.push(found);
      i = found.end;
    } else {
      i += 1;
    }
  }
  return matches;
}

/**
 * Gazetteer ids mentioned in the text, in order of first mention, de-duplicated.
 * Longest alias wins at each position; no overlapping double matches.
 */
export function findPlaces(text: string, gazetteer: GazetteerPlace[] = loadGazetteer()): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of findPlaceMatches(text, gazetteer)) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      ids.push(m.id);
    }
  }
  return ids;
}

/**
 * Build a contract Stop from a gazetteer id. The coordinate comes from the
 * gazetteer only. Returns undefined for unknown ids (never guesses).
 */
export function toStop(id: string, gazetteer: GazetteerPlace[] = loadGazetteer()): Stop | undefined {
  const place = getIndex(gazetteer).byId.get(id);
  if (!place) return undefined;
  return { gazetteerId: place.id, name: place.name, coord: [place.coord[0], place.coord[1]] };
}
