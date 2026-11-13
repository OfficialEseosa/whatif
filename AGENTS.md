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
