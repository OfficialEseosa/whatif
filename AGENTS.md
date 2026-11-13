<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working on this repo

- Run: `npm install`, then `npm run dev` (http://localhost:3000, or the next free port). Verify with `npx tsc --noEmit` and `npm run lint`; `npm run check:api` validates the API routes while the app is running.
- Keys live in `.env.local` (gitignored); see `.env.local.example`. Restart `npm run dev` after changing it.
- Do not create scratch folders inside the repo while `npm run dev` is running: Tailwind scans the project and Turbopack errors on locked files (for example a browser profile).
- If a change to `src/app/globals.css` does not show up, the dev server missed the write. Re-save the file or restart `npm run dev`; if it is still stale, stop the server, delete `.next/dev/cache` and start it again.
- Frontend layout: the map fills the screen (`src/components/MapStage.tsx`) and all controls float over it (`src/components/Console.tsx`). Design tokens are at the top of `src/app/globals.css`; map colors are in `src/components/map/colors.ts`.

## Team rules (hackathon mode) — every agent and every person follows these

- **`main` is the live demo.** Every push or merge to `main` deploys to https://whatif-atl.vercel.app within about a minute. Never push or merge something you have not run.
- **Pull often.** Run `git pull --rebase origin main` before you start, before every push, and at least every 20–30 minutes while working. Never force-push. If a rebase conflicts in a file that is not yours, stop and ask its owner.
- **No unit tests.** Do not write, restore or run unit-test suites, test fixtures or test scaffolding, and do not add a `test` script. The `tests/` folder was removed on purpose. Verify by using the website.
- **How to verify before pushing:** `npm run build` passes, then open the app and click through the thing you changed. For anything touching plans or results, the demo flow must still work: type "extend the streetcar along the Beltline to Ponce City Market", run it, and confirm the results card shows the saved simulation run (272,994 commuters), not sample data. `npm run check:api` checks the API routes while the app is running.
- **Do not change what the demo prompt returns.** `/api/simulate` serves the saved run only when the plan from `/api/plan` matches the one the run was built from (`cannedStreetcarEdit()` in `src/lib/ai/mock.ts`). If you change the plan parser, re-check the flow above.
- **Small commits, few of them.** One commit per working feature, plain imperative message, no co-author or "generated with" lines of any kind. Stage your own files by name, never `git add -A`.
- **Stay in your lane** (see the table in `README.md`): map and UI in `src/components/**`; AI, gazetteer and history in `src/lib/ai/**`, `src/app/api/plan/**`, `src/app/api/persona/**`, `src/data/**`; simulation in `sim/**` and `public/scenarios/**`. `src/lib/contract.ts` changes are additive and optional only.
- **No secrets in the repo.** Keys stay in `.env.local`. Never print or commit them.
- **No planning or status documents.** Do not add plan, status, QA or request files. Put what a teammate must know in the commit message or tell them directly.
- **Keep the look.** Minimal and clear: solid near-black surfaces, one lime accent, 4–6px corners, plain labels. No purple, gradients, glows, pills, emoji or explanatory microcopy.
