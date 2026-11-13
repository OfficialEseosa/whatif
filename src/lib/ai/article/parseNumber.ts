/**
 * Unit-aware number parsing for article claims (article-analyst).
 *
 * Handles the forms that show up in transportation reporting:
 *   "10,000"  "1.2"  "$190 million"  "$1.2 billion"  "$190M"  "$5.5B"  "10k"
 *   "2 million riders"  "190 million dollars"  "15%"  "15 percent"
 *
 * Deliberately NOT handled (returns `undefined` rather than guessing):
 *   number words ("ten thousand", "a dozen", "half"), ranges ("8,000 to 10,000"
 *   — callers pick one token), ordinals, fractions written as "1/3".
 *
 * Percentages are only turned into a fraction for metrics whose definition says
 * `acceptsPercent` (shares and relative changes); a percent attached to a count
 * or money metric yields `undefined` so no number is invented.
 */
import { METRICS, type MetricKey } from "./metrics";

/**
 * Regex source for one numeric token, used by the extractor to locate numbers in
 * a sentence. Matches an optional `$`, digits with optional thousands separators
 * and decimals, and an optional magnitude/percent suffix. The lookbehind stops it
 * from matching the tail of another number or identifier ("w1234", "1.2"); the
 * trailing lookahead stops a regex from backtracking to "15" when the text says
 * "15%" or to "$190" when it says "$190 million".
 */
export const NUMBER_TOKEN_SOURCE = String.raw`(?<![\w.$])\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:thousand|million|billion|bn|mm|k|m|b)\b|\s?%|\s?percent\b)?(?:\s?dollars\b)?(?!\s?(?:thousand|million|billion|bn|mm|k|m|b)\b|\s?%|\s?percent\b|[\d,.]\d)`;

const TOKEN_RE = new RegExp(`^${NUMBER_TOKEN_SOURCE}$`, "i");

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

export interface ParsedNumber {
  /** Numeric value with magnitude applied; percents are left as written (15 for "15%"). */
  value: number;
  /** The token as it appeared in the text. */
  raw: string;
  isPercent: boolean;
  /** Had a `$` or "dollars". */
  isMoney: boolean;
}

/**
 * Parses one numeric token (see `NUMBER_TOKEN_SOURCE`). Returns `undefined` for
 * anything it cannot read exactly.
 */
export function parseNumberToken(raw: string): ParsedNumber | undefined {
  const token = raw.trim();
  if (!TOKEN_RE.test(token)) return undefined;

  let s = token.toLowerCase();
  let isMoney = false;
  let isPercent = false;

  if (s.startsWith("$")) {
    isMoney = true;
    s = s.slice(1).trim();
  }
  if (s.endsWith("%")) {
    isPercent = true;
    s = s.slice(0, -1).trim();
  } else if (s.endsWith("percent")) {
    isPercent = true;
    s = s.slice(0, -"percent".length).trim();
  } else if (s.endsWith("dollars")) {
    isMoney = true;
    s = s.slice(0, -"dollars".length).trim();
  }

  let multiplier = 1;
  const suffix = /(thousand|million|billion|bn|mm|k|m|b)$/.exec(s);
  if (suffix) {
    multiplier = MULTIPLIERS[suffix[1]];
    s = s.slice(0, -suffix[1].length).trim();
  }

  const digits = s.replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return undefined;
  const value = Number(digits) * multiplier;
  if (!Number.isFinite(value)) return undefined;

  return { value, raw: token, isPercent, isMoney };
}

/**
 * Turns a numeric token into `ExtractedClaim.claimedValue` for a given metric.
 *   - percent + metric that accepts percents → fraction ("15%" → 0.15)
 *   - percent + any other metric (or no metric) → undefined
 *   - otherwise the parsed value
 */
export function parseClaimedValue(raw: string, metric: MetricKey | undefined): number | undefined {
  const parsed = parseNumberToken(raw);
  if (!parsed) return undefined;
  if (parsed.isPercent) {
    if (metric !== undefined && METRICS[metric].acceptsPercent) return parsed.value / 100;
    return undefined;
  }
  return parsed.value;
}
