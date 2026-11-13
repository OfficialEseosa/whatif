/**
 * Article claim extraction (article-analyst).
 *
 * Two extractors share one output type, `ExtractedClaim[]` (src/lib/contract.ts):
 *
 *   extractClaimsDeterministic(text: string): ExtractedClaim[]
 *     Regex/keyword based, no network, no key. Implemented here. plan-engineer
 *     calls it from the /api/plan deterministic fallback.
 *
 *   extractClaims(text: string, opts?: { client?: ClaudeClient }): Promise<ExtractedClaim[]>
 *     INTENDED (Phase 1, after @anthropic-ai/sdk lands): Claude-backed, structured
 *     output validated with `ExtractedClaimSchema`, article text passed as untrusted
 *     data inside a delimited user block, `metric` restricted to `METRIC_KEYS`,
 *     `claimedValue` recomputed with `parseClaimedValue` from the quote, quotes
 *     filtered with `verifyQuotes`, ids reassigned with `assignIds`. On any error
 *     (no key, SDK missing, invalid output) it resolves to
 *     `extractClaimsDeterministic(text)`. It never throws for article content.
 *     Until then import `extractClaimsDeterministic` (same shape, synchronous).
 *
 * Guarantees of the deterministic extractor:
 *   - `quote` is a verbatim substring of the whitespace-normalised article (every
 *     run of whitespace collapsed to one space). `verifyQuotes` re-checks this.
 *   - `metric` is a `MetricKey` from ./metrics (or absent).
 *   - `claimedValue` only when the article states a digit-based number next to the
 *     claim; "a dozen" / "ten thousand" are not parsed (see ./parseNumber).
 *     A percentage on a count/money metric, or a non-percentage on a share metric,
 *     is not mapped at all rather than guessed.
 *   - ids are `c1`, `c2`, ... in order of appearance; output is a pure function of
 *     the input text.
 */
import { ExtractedClaimSchema, type ExtractedClaim } from "@/lib/contract";
import { type MetricKey, METRICS } from "./metrics";
import { NUMBER_TOKEN_SOURCE, parseClaimedValue, parseNumberToken } from "./parseNumber";

/** Most claims returned for one article (keeps the UI table readable). */
export const MAX_CLAIMS = 25;
/** Longest quote we return before falling back to the matched phrase. */
const MAX_QUOTE_CHARS = 110;

/* ------------------------------------------------------------------------- */
/* Helpers reused by the Claude-backed extractor                              */
/* ------------------------------------------------------------------------- */

/** Collapses every run of whitespace to one space and trims. */
export function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Keeps only claims whose `quote` is a verbatim substring of `text` after
 * whitespace normalisation (quotes are returned normalised). Empty quotes are
 * dropped. With `renumber`, surviving claims get ids `c1`, `c2`, ... in order.
 */
export function verifyQuotes(
  text: string,
  claims: readonly ExtractedClaim[],
  opts: { renumber?: boolean } = {},
): ExtractedClaim[] {
  const norm = normaliseWhitespace(text);
  const kept: ExtractedClaim[] = [];
  for (const c of claims) {
    const quote = normaliseWhitespace(c.quote);
    if (quote.length === 0 || !norm.includes(quote)) continue;
    kept.push({ ...c, quote });
  }
  return opts.renumber ? assignIds(kept) : kept;
}

/** Returns copies with ids `c1`, `c2`, ... in array order. */
export function assignIds(claims: readonly ExtractedClaim[]): ExtractedClaim[] {
  return claims.map((c, i) => ({ ...c, id: `c${i + 1}` }));
}

/* ------------------------------------------------------------------------- */
/* Rules                                                                      */
/* ------------------------------------------------------------------------- */

const N = `(?<n>${NUMBER_TOKEN_SOURCE})`;
/** Short gap inside one clause: no clause punctuation, digits or `$`. */
const GAP = String.raw`[^.;,:!?\d$]{0,60}?`;
/** Up to three filler words (numbers allowed, no sentence punctuation). */
const W = String.raw`(?:[\w,$%-]+\s+){0,3}?`;

interface Rule {
  metric: MetricKey;
  /** Source of a case-insensitive regex; numeric rules capture the number as `n`. */
  patterns: readonly string[];
  /** Skip the match unless the number carries `$`/"dollars". */
  requireMoney?: boolean;
  /** Extra acceptance test on the parsed value. */
  accept?: (value: number) => boolean;
  /** Keyword rule: a number is optional; a non-percent number is ignored. */
  qualitative?: boolean;
}

const VERB_SAVE = String.raw`(?:save|saves|saved|saving|cut|cuts|cutting|shave|shaves|shaving|shorten|shortens|shortening|trim|trims|trimming)`;
const RIDER_NOUN = String.raw`(?:riders|passengers|boardings|trips|people|commuters|transit\s+riders)`;
const PER_DAY = String.raw`(?:(?:a|per|each|every)\s+(?:week)?day|/\s?day|daily)`;
const BY = String.raw`\bby\s+(?:about\s+|around\s+|up\s+to\s+|roughly\s+|nearly\s+)?`;
const PEOPLE = String.raw`(?:residents|voters|respondents|neighbors|neighbours|people|those\s+polled|households|locals)`;

/** Rules in priority order: an earlier rule claims a number before a later one can. */
const RULES: readonly Rule[] = [
  {
    metric: "headway_min",
    patterns: [
      String.raw`\bevery\s+${N}\s+minutes?\b`,
      String.raw`${N}[\s-]*minute\s+(?:peak\s+)?headways?\b`,
      String.raw`\bheadways?\s+of\s+(?:about\s+|around\s+)?${N}\s+minutes?\b`,
    ],
  },
  {
    metric: "avg_commute_min",
    patterns: [
      String.raw`\b(?:average|avg\.?|typical|mean|median)\s+${W}commutes?\b${GAP}${N}[\s-]*minutes?\b`,
      String.raw`${N}[\s-]*minute\s+(?:average\s+|typical\s+)?commutes?\b`,
      String.raw`\bcommutes?\s+${W}(?:averages?|takes?|lasts?)\s+(?:about\s+|around\s+|roughly\s+|nearly\s+)?${N}\s+minutes?\b`,
    ],
  },
  {
    metric: "cost_per_rider",
    requireMoney: true,
    patterns: [String.raw`${N}\s+(?:per|a|each|for\s+every)\s+(?:rider|trip|passenger|ride|boarding)\b`],
  },
  {
    metric: "capital_cost_usd",
    requireMoney: true,
    // Capital costs are large; keeps fares and per-household figures out.
    accept: (value) => value >= 1_000_000,
    patterns: [String.raw`${N}(?!\s+(?:per|a|each|for\s+every)\s+(?:rider|trip|passenger|ride|boarding|household|year)\b)`],
  },
  {
    metric: "time_saved",
    patterns: [
      String.raw`${N}\s+(?:person-)?hours?\b${GAP}\b${PER_DAY}\b`,
      String.raw`\b${VERB_SAVE}\b${GAP}${N}\s+(?:person-)?hours?\b`,
    ],
  },
  {
    metric: "trip_minutes_saved",
    patterns: [
      String.raw`\b${VERB_SAVE}\b${GAP}${N}\s+minutes?\b`,
      String.raw`${N}\s+minutes?\s+(?:faster|shorter|quicker|less|off)\b`,
      String.raw`${N}[\s-]*minute\s+(?:time\s+)?savings?\b`,
    ],
  },
  {
    metric: "new_riders",
    patterns: [
      String.raw`${N}\s+(?:new|additional|more|extra)\s+(?:daily\s+)?${RIDER_NOUN}\b`,
      String.raw`${N}\s+${W}(?:commuters|drivers|people|residents|motorists)\b${GAP}\b(?:switch|switching|leave\s+their\s+cars|give\s+up\s+driving|out\s+of\s+their\s+cars|stop\s+driving)\b`,
    ],
  },
  {
    metric: "daily_riders",
    patterns: [
      String.raw`${N}\s+(?:daily\s+)?${RIDER_NOUN}\s+${PER_DAY}\b`,
      String.raw`${N}\s+daily\s+${RIDER_NOUN}\b`,
      String.raw`\b(?:ridership|riders)\b${GAP}\b(?:of|to|at|reach|reaching|hit|hitting|top|topping|around|about|roughly|nearly|approach|approaching)\s+${N}\b`,
      String.raw`\b(?:carry|carrying|serve|serving|attract|attracting|draw|drawing|move|moving|handle|handling)\s+${W}${N}\s+${RIDER_NOUN}\b`,
    ],
  },
  {
    metric: "redlined_benefit_share",
    patterns: [String.raw`\bredlin\w*\b${GAP}${N}`, String.raw`${N}${GAP}\bredlin\w*\b`],
  },
  {
    metric: "transit_share",
    patterns: [
      String.raw`${N}\s+of\s+${W}(?:commuters|residents|workers|trips|travelers|travellers|commutes|people|households)\b${GAP}\b(?:transit|ride|riding|rode|bus|train|rail|streetcar|take\s+the|taking\s+the)\b`,
      String.raw`\b(?:transit|rail|streetcar|bus|mode)\s+(?:mode\s+)?share\b${GAP}${N}`,
      String.raw`${N}\s+(?:transit|mode)\s+share\b`,
      String.raw`\bshare\s+of\s+${W}(?:commut\w+|trips|workers|travel)\b${GAP}${N}`,
    ],
  },
  {
    metric: "oppose_share",
    patterns: [
      String.raw`${N}\s+(?:of\s+${W})?(?:${PEOPLE}\b${GAP})?\b(?:oppose|opposed|opposing|against|object|objected|reject|rejected)\b`,
    ],
  },
  {
    metric: "support_share",
    patterns: [
      String.raw`${N}\s+(?:of\s+${W})?(?:${PEOPLE}\b${GAP})?\b(?:support|supported|supporting|back|backed|backing|favor|favour|favored|favoured|approve|approved|in\s+favor|in\s+favour|want|wanted)\b`,
    ],
  },
  {
    metric: "renters_rent_pressure",
    patterns: [
      String.raw`${N}\s+(?:renter\s+|renting\s+|low-income\s+)?(?:households|families|renters|tenants)\b${GAP}\b(?:rent|rents|displace\w*|priced?\s+out|push\w*\s+out|forced\s+out)\b`,
    ],
  },
  {
    metric: "traffic",
    qualitative: true,
    patterns: [
      String.raw`\b(?:take|takes|taking|took|get|gets|getting|pull|pulls|pulling|keep|keeps|keeping)\s+${W}(?:cars|vehicles|drivers)\s+off\b(?:${GAP}${BY}${N})?`,
      String.raw`\b(?:reduce|reduces|reducing|ease|eases|easing|cut|cuts|cutting|relieve|relieves|relieving|lessen|lessens|worsen|worsens|worsening|increase|increases|increasing|add\s+to|adds\s+to|clog|clogs|snarl|snarls)\s+${W}(?:traffic|congestion|gridlock|backups?|car\s+trips)\b(?:${GAP}${BY}${N})?`,
      String.raw`\b(?:traffic|congestion|gridlock|delays)\s+(?:on\s+${W})?(?:would|will|could|may|might|should|is\s+(?:expected|likely|projected)\s+to)\s+${W}(?:drop|fall|ease|improve|worsen|increase|decrease|decline|rise|double|grow|get\s+worse|get\s+better)\b(?:${GAP}${BY}${N})?`,
      String.raw`\b(?:less|more|fewer|worse|heavier|lighter)\s+${W}(?:traffic|congestion|cars\s+on)\b`,
      String.raw`\bgridlock\b`,
    ],
  },
];

const COMPILED: readonly { rule: Rule; re: RegExp }[] = RULES.flatMap((rule) =>
  rule.patterns.map((p) => ({ rule, re: new RegExp(p, "gid") })),
);

/* ------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* ------------------------------------------------------------------------- */

interface Span {
  start: number;
  end: number;
}

interface Candidate {
  metric: MetricKey;
  priority: number;
  /** Position used for ordering: the number if any, else the match start. */
  at: number;
  /** Matched phrase (plus the number range, if any); the quote is derived from it lazily. */
  span: Span;
  claimedValue?: number;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * "from 30% to 35%": the claim is the second number. Returns the token to use
 * and the span covering both numbers so neither is reused.
 */
function pickRangeEnd(text: string, numSpan: Span, raw: string): { raw: string; span: Span } {
  const before = text.slice(Math.max(0, numSpan.start - 8), numSpan.start);
  if (!/\bfrom\s+$/i.test(before)) return { raw, span: numSpan };
  const after = text.slice(numSpan.end, numSpan.end + 40);
  const m = new RegExp(String.raw`^(?:\s+[a-z]+)?\s+to\s+(${NUMBER_TOKEN_SOURCE})`, "i").exec(after);
  if (!m) return { raw, span: numSpan };
  const first = parseNumberToken(raw);
  const second = parseNumberToken(m[1]);
  if (!first || !second || first.isPercent !== second.isPercent || first.isMoney !== second.isMoney) {
    return { raw, span: numSpan };
  }
  return { raw: m[1], span: { start: numSpan.start, end: numSpan.end + m[0].length } };
}

const CLAUSE_BREAK = /[,;:!?]|\.(?=\s|$)|\s[—–-]\s|[()[\]]|["“”]/g;

/** Clause-break positions of one text, computed once per extraction. */
interface Clauses {
  text: string;
  /** Sorted, non-overlapping spans of every clause break in `text`. */
  breaks: Span[];
}

function findClauseBreaks(text: string): Clauses {
  const breaks: Span[] = [];
  CLAUSE_BREAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_BREAK.exec(text)) !== null) breaks.push({ start: m.index, end: m.index + m[0].length });
  return { text, breaks };
}

/** Smallest clause range of the text that contains `span` (binary search over the breaks). */
function clauseAround(clauses: Clauses, span: Span): Span {
  const { breaks } = clauses;
  // Last break that ends at or before the span → clause starts where it ends.
  let lo = 0;
  let hi = breaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (breaks[mid].end <= span.start) lo = mid + 1;
    else hi = mid;
  }
  const start = lo > 0 ? breaks[lo - 1].end : 0;
  // First break that starts at or after the span → clause ends where it starts.
  hi = breaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (breaks[mid].start < span.end) lo = mid + 1;
    else hi = mid;
  }
  const end = lo < breaks.length ? breaks[lo].start : clauses.text.length;
  return { start, end };
}

// Character classes for quote trimming. All scans below are bounded by the clause
// and by the number of characters actually stripped, never by the article length.
const WS = /\s/;
const QUOTE_LEAD = /[\s"'“”‘’([]/; // stripped from the front of a quote
const QUOTE_TRAIL = /[\s"'“”‘’)\].,;:!?]/; // stripped from the end of a quote
const NON_WORD = /[\s,;:.!?()[\]"“”]/; // a "word" for phraseAround is a run of anything else

/** `[start, end)` with leading/trailing quote punctuation and whitespace removed. */
function tidyBounds(text: string, start: number, end: number): Span {
  while (start < end && QUOTE_LEAD.test(text[start])) start++;
  while (end > start && QUOTE_TRAIL.test(text[end - 1])) end--;
  return { start, end };
}

/** The matched phrase plus up to three whitespace-separated words on each side, within the clause. */
function phraseAround(text: string, clause: Span, match: Span): Span {
  let start = match.start;
  for (let k = 0; k < 3; k++) {
    let p = start;
    while (p > clause.start && WS.test(text[p - 1])) p--;
    if (p === start) break; // a word must be separated from what follows by whitespace
    let q = p;
    while (q > clause.start && !NON_WORD.test(text[q - 1])) q--;
    if (q === p) break;
    start = q;
  }
  let end = match.end;
  for (let k = 0; k < 3; k++) {
    let p = end;
    while (p < clause.end && WS.test(text[p])) p++;
    if (p === end) break;
    let q = p;
    while (q < clause.end && !NON_WORD.test(text[q])) q++;
    if (q === p) break;
    end = q;
  }
  return tidyBounds(text, start, end);
}

function quoteFor(clauses: Clauses, match: Span): string {
  const { text } = clauses;
  const clause = clauseAround(clauses, match);
  const full = tidyBounds(text, clause.start, clause.end);
  const len = full.end - full.start;
  if (len > 0 && len <= MAX_QUOTE_CHARS) return text.slice(full.start, full.end);
  const phrase = phraseAround(text, clause, match);
  return text.slice(phrase.start, phrase.end);
}

function collect(text: string): Candidate[] {
  const consumedNumbers: Span[] = [];
  const qualitativeSpans: Span[] = [];
  const out: Candidate[] = [];

  COMPILED.forEach(({ rule, re }, priority) => {
    const def = METRICS[rule.metric];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const matchSpan: Span = { start: m.index, end: m.index + m[0].length };
      const rawNum = m.groups?.n;
      const idx = m.indices?.groups?.n;

      if (rawNum === undefined || idx === undefined) {
        if (!rule.qualitative) continue;
        if (qualitativeSpans.some((s) => overlaps(s, matchSpan))) continue;
        qualitativeSpans.push(matchSpan);
        out.push({ metric: rule.metric, priority, at: matchSpan.start, span: matchSpan });
        continue;
      }

      const picked = pickRangeEnd(text, { start: idx[0], end: idx[1] }, rawNum);
      if (consumedNumbers.some((s) => overlaps(s, picked.span))) continue;
      const parsed = parseNumberToken(picked.raw);
      if (!parsed) continue;

      if (rule.qualitative) {
        if (qualitativeSpans.some((s) => overlaps(s, matchSpan))) continue;
        qualitativeSpans.push(matchSpan);
        const value = parsed.isPercent ? parseClaimedValue(picked.raw, rule.metric) : undefined;
        if (value !== undefined) consumedNumbers.push(picked.span);
        out.push({ metric: rule.metric, priority, at: matchSpan.start, span: matchSpan, claimedValue: value });
        continue;
      }

      // Never map a number of the wrong kind: leave it for a later rule or drop it.
      if (parsed.isPercent !== def.acceptsPercent) continue;
      if (parsed.isMoney && def.kind !== "money") continue;
      if (rule.requireMoney && !parsed.isMoney) continue;
      if (rule.accept && !rule.accept(parsed.value)) continue;

      consumedNumbers.push(picked.span);
      const span: Span = { start: Math.min(matchSpan.start, picked.span.start), end: Math.max(matchSpan.end, picked.span.end) };
      out.push({
        metric: rule.metric,
        priority,
        at: picked.span.start,
        span,
        claimedValue: parseClaimedValue(picked.raw, rule.metric),
      });
    }
  });

  return out;
}

/**
 * Deterministic, offline claim extractor. See the module comment for guarantees.
 * Returns at most `MAX_CLAIMS` claims, ordered by position in the article.
 */
export function extractClaimsDeterministic(text: string): ExtractedClaim[] {
  const norm = normaliseWhitespace(text);
  if (norm.length === 0) return [];

  const candidates = collect(norm).sort((a, b) => a.at - b.at || a.priority - b.priority);
  // Clause breaks are found once; quotes are built lazily, in output order, until the cap.
  const clauses = findClauseBreaks(norm);

  const seen = new Set<string>();
  const claims: ExtractedClaim[] = [];
  for (const c of candidates) {
    const quote = quoteFor(clauses, c.span);
    if (quote.length === 0) continue;
    const key = `${c.metric}\u0000${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const claim: ExtractedClaim = { id: `c${claims.length + 1}`, quote, metric: c.metric };
    if (c.claimedValue !== undefined) claim.claimedValue = c.claimedValue;
    claims.push(ExtractedClaimSchema.parse(claim));
    if (claims.length >= MAX_CLAIMS) break;
  }

  return verifyQuotes(norm, claims, { renumber: true });
}
