# AI lane status

States: todo · in-progress · blocked · tests-passing · qa-passed

Last verified 2026-11-13: 89/89 tests pass, `tsc --noEmit` clean, lint clean (manager re-run).
QA: `qa/2026-11-13-phase-0.md` — PASS WITH ISSUES, no blocking defects.

| Task | Owner | State | Evidence / notes |
|---|---|---|---|
| Test harness (`tests/setup/`) | manager | qa-passed | QA #6 fixed (JSON rewrite limited to src/ and tests/) |
| History audit: all 10 cards cited with opened URLs; `beltline_prices` corrected; source log | history-researcher | qa-passed | QA #4 open (inference sentence); #5 human review |
| Gazetteer audit (no changes; 6 coord proposals P1–P6 in `docs/sources/gazetteer.md`) | history-researcher | qa-passed | Coord changes need lane-owner approval + Raphael re-running mock |
| Overlay dataset candidates (`docs/sources/overlays.md`) | history-researcher | qa-passed | Downloads need lane-owner approval; HOLC data is CC BY-NC |
| Deterministic `extractClaims`, metric vocabulary, fixtures | article-analyst | qa-passed | QA #3 open (perf) |
| Deterministic plan fallback parser, gazetteer + network helpers, `.env.local.example` | plan-engineer | qa-passed | QA #1 open (assumed values in title) |
| `src/lib/ai/client.ts` (Claude SDK) | plan-engineer | blocked | Needs `@anthropic-ai/sdk` from Prosper |
| `/api/plan` route (3 modes) | plan-engineer | blocked | Needs client.ts; QA #2 to address |
| `/api/persona` | persona-engineer | blocked | Needs client.ts |
| `compareClaims` | article-analyst | todo | Phase 2; not blocked by SDK |

## Open requests

| Request | To | Blocking? |
|---|---|---|
| `requests/2026-11-13-prosper-test-script-and-sdk.md` | Prosper | SDK part blocks all Claude-backed paths |
| `requests/2026-11-13-raphael-persona-synthetic-field.md` | Raphael | No |
| `requests/2026-11-13-simulate-claim-checks.md` | Prosper / Raphael | No (Phase 2) |

## Needs the lane owner

1. Approve or reject gazetteer coordinate proposals P3–P6 (`docs/sources/gazetteer.md`).
2. Approve overlay dataset downloads (`docs/sources/overlays.md`), noting the CC BY-NC licence on HOLC data.
3. Human verification of history cards (`docs/sources/needs-review.md`) before any `verified: true`.
