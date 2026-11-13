# AI lane plan — WhatIf ATL

Approved by the lane owner on 2026-11-13. Branch: `ai-lane/phase-0`. Nothing is
committed, merged, or pushed by agents; the lane owner commits.

## Scope

AI integration (`/api/plan`, `/api/persona`), gazetteer data, history cards and overlays,
article claim extraction and checking, persona logic, pitch prep. Simulation (`sim/`,
`scripts/`, `src/lib/contract.ts`, `public/scenarios/`) is Raphael's. Backend
infrastructure (`/api/simulate`, storage, `package.json`, `tsconfig.json`, Next/ESLint
config) is Prosper's.

## Decisions

| # | Decision | Answer | Consequence |
|---|---|---|---|
| D1 | Test runner | **Node built-in `node --test`** | Runs today with no shared-file change, via the lane-owned resolver hook in `tests/setup/`. A `"test"` script in `package.json` is requested from Prosper (`requests/2026-11-13-prosper-test-script-and-sdk.md`). |
| D2 | Claude client | **Official `@anthropic-ai/sdk`** | Needs a `package.json` dependency → requested from Prosper. Until it lands, `client.ts` work that imports the SDK is **blocked**; deterministic code proceeds. |
| D3 | Scenario lookup for `/api/persona` | **Read `public/scenarios/<id>.json`** (read-only, validated) behind one swappable function | Prosper can replace the function with real storage later. |
| D4 | Claim checks after simulation | `compareClaims` ships as a pure function | Wiring into `/api/simulate` requested from Prosper/Raphael (`requests/2026-11-13-simulate-claim-checks.md`). |
| D5 | Synthetic persona labelling | **Both**: disclosure in reply text now, and request an optional `synthetic` field | Request to Raphael (`requests/2026-11-13-raphael-persona-synthetic-field.md`). |

## Test command

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/setup/register.mjs --test "tests/**/*.test.ts"
```

Verified 2026-11-13: harness smoke test passes (1/1).

The hook (`tests/setup/register.mjs`, owned by the manager) lets tests import TypeScript
the way Next does: extensionless relative imports, the `@/` alias, and `.json` imports.
Source files under `src/` therefore use normal Next-style imports (no `.ts` extensions).
Tests must not use the network or a real API key.

Also run before reporting done: `npx next typegen` (writes only to gitignored `.next/`;
without it `tsc` fails on the existing `src/app/layout.tsx`), then `npx tsc --noEmit` and
`npm run lint`. Baseline on 2026-11-13 after typegen: tsc clean, lint clean.

## File ownership

| Agent | Owns |
|---|---|
| lane owner (human) | `.claude/agents/**` (agent definitions; changed only on the lane owner's request) |
| whatif-manager | `docs/ai-lane/**`, `docs/pitch/**`, `tests/setup/**` |
| plan-engineer | `src/app/api/plan/route.ts`, `src/lib/ai/client.ts`, `src/lib/ai/plan/**`, `tests/ai/plan/**`, `.env.local.example` |
| article-analyst | `src/lib/ai/article/**`, `tests/ai/article/**`, `tests/fixtures/articles/**` |
| persona-engineer | `src/app/api/persona/route.ts`, `src/lib/ai/persona/**`, `tests/ai/persona/**` |
| history-researcher | `src/data/history.json`, `src/data/gazetteer.json`, `src/data/overlays/**`, `docs/sources/**`, `tests/data/**` |
| qa-reviewer | nothing (read-only) |

## Phases

- **Phase 0 (parallel, now):**
  - history-researcher: audit `gazetteer.json` and `history.json` against sources, write the
    source log, add validation tests. No id renames/removals.
  - article-analyst: deterministic `extractClaims` + metric vocabulary + fixtures + tests.
    Claude-backed extractor waits for D2.
  - plan-engineer: deterministic fallback parser (gazetteer alias matching, edit-type rules,
    network id validation) + `.env.local.example` + tests. `client.ts` waits for D2.
- **Phase 1:** `client.ts` (after SDK lands), `/api/plan` all three modes; article mode uses
  `extractClaims`.
- **Phase 2:** `/api/persona`; `compareClaims`.
- **Phase 3:** QA review of each piece, integration check, pitch notes.

Each task is complete only when its tests pass (re-run by the manager) and qa-reviewer
reports no blocking defects.
