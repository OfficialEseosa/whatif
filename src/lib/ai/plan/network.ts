/**
 * Network id validation for /api/plan.
 *
 * `baseLineId` must be a real `RailLine.id` and `roadIds` must be real
 * `NetworkRoad.id`s from public/scenarios/network.json (read-only, owned by the
 * sim lane). The file is ~500 KB, so it is read from disk lazily and cached
 * rather than imported as a JSON module. Server-side only (uses node:fs).
 *
 * Road-name lookup is exact after normalisation; it never guesses. OSM road
 * names carry a postal quadrant suffix ("Edgewood Avenue Northeast"); a mention
 * without a quadrant matches every quadrant of that street, a mention with one
 * matches only that quadrant.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NetworkSchema, type Network, type NetworkRoad, type RailLine } from "@/lib/contract";
import { tokenize } from "./gazetteer";

export const NETWORK_PATH = path.join("public", "scenarios", "network.json");

let cachedNetwork: Network | null = null;

/** Load and validate network.json once (relative to process.cwd(), the project root). */
export function loadNetwork(): Network {
  if (!cachedNetwork) {
    const file = path.resolve(process.cwd(), NETWORK_PATH);
    cachedNetwork = NetworkSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  }
  return cachedNetwork;
}

const QUADRANTS = new Set(["northeast", "northwest", "southeast", "southwest"]);

interface NetworkIndex {
  railIds: Set<string>;
  railById: Map<string, RailLine>;
  /** normalised rail line name or id -> id */
  railByName: Map<string, string>;
  roadIds: Set<string>;
  roadById: Map<string, NetworkRoad>;
  /** normalised full road name -> ids (in file order) */
  roadsByFullName: Map<string, string[]>;
  /** normalised road name with trailing quadrant removed -> ids (in file order) */
  roadsByBaseName: Map<string, string[]>;
  /** Distinct normalised road names (full and base), longest first, for text scanning. */
  roadNameTokens: { key: string; tokens: string[] }[];
  maxRoadTokens: number;
}

const indexCache = new WeakMap<Network, NetworkIndex>();

function baseNameTokens(tokens: string[]): string[] {
  if (tokens.length > 1 && QUADRANTS.has(tokens[tokens.length - 1])) return tokens.slice(0, -1);
  return tokens;
}

function push(map: Map<string, string[]>, key: string, id: string) {
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

function buildIndex(network: Network): NetworkIndex {
  const railById = new Map<string, RailLine>();
  const railByName = new Map<string, string>();
  for (const line of network.rail) {
    railById.set(line.id, line);
    for (const key of [tokenize(line.id).join(" "), tokenize(line.name).join(" ")]) {
      if (key && !railByName.has(key)) railByName.set(key, line.id);
    }
  }
  const roadById = new Map<string, NetworkRoad>();
  const roadsByFullName = new Map<string, string[]>();
  const roadsByBaseName = new Map<string, string[]>();
  for (const road of network.roads) {
    roadById.set(road.id, road);
    const tokens = tokenize(road.name);
    if (tokens.length === 0) continue;
    push(roadsByFullName, tokens.join(" "), road.id);
    push(roadsByBaseName, baseNameTokens(tokens).join(" "), road.id);
  }
  const names = new Set<string>([...roadsByFullName.keys(), ...roadsByBaseName.keys()]);
  const roadNameTokens = [...names]
    .map((key) => ({ key, tokens: key.split(" ") }))
    .sort((a, b) => b.tokens.length - a.tokens.length);
  const maxRoadTokens = roadNameTokens.reduce((m, n) => Math.max(m, n.tokens.length), 0);
  return {
    railIds: new Set(railById.keys()),
    railById,
    railByName,
    roadIds: new Set(roadById.keys()),
    roadById,
    roadsByFullName,
    roadsByBaseName,
    roadNameTokens,
    maxRoadTokens,
  };
}

function getIndex(network: Network): NetworkIndex {
  let idx = indexCache.get(network);
  if (!idx) {
    idx = buildIndex(network);
    indexCache.set(network, idx);
  }
  return idx;
}

/* ------------------------------------------------------------------------- */
/* Rail lines                                                                  */
/* ------------------------------------------------------------------------- */

/** All RailLine ids in the network. */
export function railLineIds(network: Network = loadNetwork()): string[] {
  return network.rail.map((l) => l.id);
}

export function isRailLineId(id: string, network: Network = loadNetwork()): boolean {
  return getIndex(network).railIds.has(id);
}

export function getRailLine(id: string, network: Network = loadNetwork()): RailLine | undefined {
  return getIndex(network).railById.get(id);
}

/** Validate a candidate baseLineId; returns the id if real, otherwise undefined. */
export function validateBaseLineId(id: string | undefined, network: Network = loadNetwork()): string | undefined {
  return id !== undefined && isRailLineId(id, network) ? id : undefined;
}

/**
 * Rail line ids whose id or name (normalised) appears in the text, in order of
 * first mention. Longest name wins at each position; no overlaps.
 */
export function findRailLineMentions(text: string, network: Network = loadNetwork()): string[] {
  const idx = getIndex(network);
  const tokens = tokenize(text);
  const keys = [...idx.railByName.keys()].map((k) => k.split(" ")).sort((a, b) => b.length - a.length);
  const maxLen = keys.reduce((m, k) => Math.max(m, k.length), 0);
  const seen = new Set<string>();
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let hit: { id: string; len: number } | null = null;
    for (let len = Math.min(maxLen, tokens.length - i); len >= 1 && !hit; len--) {
      const id = idx.railByName.get(tokens.slice(i, i + len).join(" "));
      if (id) hit = { id, len };
    }
    if (hit) {
      if (!seen.has(hit.id)) {
        seen.add(hit.id);
        out.push(hit.id);
      }
      i += hit.len;
    } else i += 1;
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Roads                                                                      */
/* ------------------------------------------------------------------------- */

export function isRoadId(id: string, network: Network = loadNetwork()): boolean {
  return getIndex(network).roadIds.has(id);
}

export function getRoad(id: string, network: Network = loadNetwork()): NetworkRoad | undefined {
  return getIndex(network).roadById.get(id);
}

/** Split candidate road ids into those that exist in the network and those that do not. */
export function validateRoadIds(
  ids: readonly string[] | undefined,
  network: Network = loadNetwork(),
): { valid: string[]; unknown: string[] } {
  const idx = getIndex(network);
  const valid: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const id of ids ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    (idx.roadIds.has(id) ? valid : unknown).push(id);
  }
  return { valid, unknown };
}

/**
 * Road ids whose name matches the mention exactly after normalisation.
 * "Edgewood Ave" matches "Edgewood Avenue Northeast" (and any other quadrant);
 * "Edgewood Avenue NE" matches only the Northeast segments. Unknown -> [].
 */
export function findRoadIdsByName(name: string, network: Network = loadNetwork()): string[] {
  const idx = getIndex(network);
  const tokens = tokenize(name);
  if (tokens.length === 0) return [];
  const key = tokens.join(" ");
  const hasQuadrant = baseNameTokens(tokens).length !== tokens.length;
  // With a quadrant: exact full name only. Without: every quadrant of that street
  // (the base-name index also holds roads whose name carries no quadrant).
  const ids = hasQuadrant ? idx.roadsByFullName.get(key) : idx.roadsByBaseName.get(key);
  return ids ? [...ids] : [];
}

export interface RoadMention {
  /** The normalised road name that matched. */
  name: string;
  /** Display name: the first matching road's `name` from the network. */
  displayName: string;
  roadIds: string[];
  /** Token span in `tokenize(text)` of the first mention: [start, end). */
  start: number;
  end: number;
}

/**
 * Road names from the network that appear in the text, longest match first,
 * no overlaps, in order of first mention. Single-token road names (e.g. the
 * street literally called "Boulevard") are skipped when scanning free text
 * because they collide with ordinary words; use `findRoadIdsByName` for those.
 */
export function findRoadMentions(text: string, network: Network = loadNetwork()): RoadMention[] {
  const idx = getIndex(network);
  const tokens = tokenize(text);
  const seen = new Set<string>();
  const out: RoadMention[] = [];
  let i = 0;
  while (i < tokens.length) {
    let hit: { key: string; len: number } | null = null;
    for (let len = Math.min(idx.maxRoadTokens, tokens.length - i); len >= 2 && !hit; len--) {
      const key = tokens.slice(i, i + len).join(" ");
      if (idx.roadsByFullName.has(key) || idx.roadsByBaseName.has(key)) hit = { key, len };
    }
    if (hit) {
      if (!seen.has(hit.key)) {
        seen.add(hit.key);
        const roadIds = findRoadIdsByName(hit.key, network);
        const first = roadIds[0] ? idx.roadById.get(roadIds[0]) : undefined;
        out.push({ name: hit.key, displayName: first?.name ?? hit.key, roadIds, start: i, end: i + hit.len });
      }
      i += hit.len;
    } else i += 1;
  }
  return out;
}
