/**
 * Public surface of the article-check lane (article-analyst).
 *
 * Phase 0 (now): deterministic extractor + metric vocabulary + number parsing.
 * Phase 1: `extractClaims` (Claude-backed, async) is added here with the signature
 *          documented at the top of ./extractClaims.ts.
 * Phase 2: `compareClaims(claims, scenarioResult): ClaimCheck[]` from ./compareClaims.
 */
export { extractClaimsDeterministic, verifyQuotes, assignIds, normaliseWhitespace, MAX_CLAIMS } from "./extractClaims";
export { METRICS, METRIC_KEYS, isMetricKey, isModeled, resolveMetricPath } from "./metrics";
export type { MetricKey, MetricDef, MetricKind } from "./metrics";
export { compareClaims, rateNumeric, TOLERANCE, VC_CHANGE } from "./compareClaims";
export { parseNumberToken, parseClaimedValue, NUMBER_TOKEN_SOURCE } from "./parseNumber";
export type { ParsedNumber } from "./parseNumber";
