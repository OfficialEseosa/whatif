# Request to Prosper / Raphael: fill `ScenarioResult.claims` from article claims

**From:** AI lane · **Owners:** Prosper (`/api/simulate`), Raphael (sim output) · **Status:** open (not blocking Phase 0)

## What

When `/api/simulate` receives `SimulateRequest.claims` (from `/api/plan` article mode),
set `result.claims = compareClaims(request.claims, result)` before returning.
`compareClaims` will live in `src/lib/ai/article/compareClaims.ts` (AI lane), is pure and
deterministic, and only uses numbers already present in the `ScenarioResult`.

## Why

The `ClaimCheck` rows belong in `ScenarioResult.claims`, which only `/api/simulate`
produces. The AI lane will not edit `/api/simulate`; we will send the exact signature
once Phase 2 is done.
