# WhatIf ATL

Type a transit plan in plain English, or paste a news article about one. The line draws itself on Atlanta, commuters reroute, and panels show a verdict (five scored tests), impact, who pays, a town hall of residents, an article claim check, a cited history timeline that overlays the map, and a Year 5 / Year 10 look-ahead.

Everything currently runs on **mock data** (`isMock: true`, and the UI says so). The UI is a deliberately plain functional shell; a designer owns the visual design.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run build
npm run mock         # regenerate the mock scenario (deterministic)
npm run check:api    # with the app running: validates all API routes against the contract
```

Node 22.18+ is required (the scripts import `src/lib/contract.ts` directly via Node's type stripping).

## Environment

Copy `.env.local.example` to `.env.local` (gitignored). All optional:

| Var | Used by | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | `/api/plan`, `/api/persona` (server) | canned plan/claims/replies |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Photorealistic 3D Tiles + Map Tiles 2D (browser) | keyless vector map |
| `SIM_URL` | `/api/simulate` proxies to `${SIM_URL}/simulate` | serves `public/scenarios/beltline-streetcar.json` |

## Lanes (who owns what)

| Lane | Owner | Paths |
|---|---|---|
| Map + frontend | Prosper | `src/components/**`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/store.ts`, `src/lib/api.ts`, `src/lib/format.ts`, `src/hooks/**`, `src/app/api/map-session/**` |
| Visual design | Designer | restyles `src/components/**` and `src/app/globals.css` (tokens at the top) and `src/components/map/colors.ts`, alongside Prosper |
| AI, gazetteer, history, claims | Samuel | `src/app/api/plan/**`, `src/app/api/persona/**`, `src/lib/ai/**`, `src/data/gazetteer.json`, `src/data/history.json` |
| Simulation | Raphael | `sim/**`, `src/app/api/simulate/**`, `public/scenarios/**`, `scripts/**`, `src/lib/scenarios.ts`, and **owner of `src/lib/contract.ts`** (contract changes go through him) |

Shared helper `src/lib/http.ts` is tiny; coordinate before changing it.

## The contract

`src/lib/contract.ts` is the single source of truth: zod schemas + inferred TS types for `ScenarioEdit`, `ScenarioResult` (line, metrics, verdict, impact, agents with TripsLayer-shaped trips, road and tract effects, who pays, claims, personas, look-ahead), `Network`, `HistoryEvent`, `GazetteerPlace`, and the request/response types of every API route. The Python sim mirrors it in `sim/contract.py`. Conventions: coordinates are `[lng, lat]`; trip timestamps are seconds after 6:00 AM; shares are 0..1.

Contract 1.1.0 added two **optional** `ScenarioResult` fields: `source` and `mockSections: string[]` (keys from `MOCK_SECTION_KEYS`, e.g. `"verdict.headline"`, `"verdict.tests.cost_per_rider"`, `"personas"`; a key covers everything under it). The UI marks those sections "mock" when the result is sim output. If a sim result doesn't send `mockSections`, the route infers them from `impact.notes` (`SIM_DEFAULT_MOCK_SECTIONS` in `src/lib/scenarios.ts`). At boot the map shows `baseline.sim.json` if it exists, else the mock.

API routes (all validate input and output with the contract):

- `POST /api/plan` `{ text, mode: "prompt" | "article" | "fix" }` → `{ edit, claims?, candidates?, isMock }` — `TODO(Samuel)` in `src/lib/ai/plan.ts`
- `POST /api/simulate` `{ edit, claims? }` → `ScenarioResult`. Resolution order, falling through on any failure: live sim at `${SIM_URL}/simulate` (40 s timeout) → prebaked `public/scenarios/*.sim.json` whose edit matches (ignoring `name`/`assumptions`) → the mock. The response carries `source` (`live_sim` | `prebaked_sim` | `mock`, also in the `X-Scenario-Source` header) and `mockSections`.
- `POST /api/persona` `{ scenarioId, personaId, messages }` → `{ personaId, reply, isMock }` — `TODO(Samuel)` in `src/lib/ai/persona.ts`
- `GET /api/map-session` → Google 2D tiles session token (404 without a key)

## Mock data

- `src/data/gazetteer.json` — 31 places; coordinates from OpenStreetMap (Overpass), the source noted per place. Plan stops may only use these ids.
- `src/data/history.json` — events from the plan's history-layer table, all `verified: false` until checked.
- `public/scenarios/network.json` — real OSM roads (motorway → tertiary), MARTA rail, Atlanta Streetcar, freight rail, stations and Beltline trails for lng −84.42..−84.33, lat 33.73..33.80, plus history overlay shapes (redline/renewal/county shapes are hand-drawn **placeholders**, flagged `placeholder: true`).
- `public/scenarios/beltline-streetcar.json` — one full `ScenarioResult`: Streetcar East along Edgewood Ave and the Eastside Trail to Ponce City Market, 3,000 agents routed over the real road graph. Every number is a placeholder.

Regenerate both with `npm run mock` (`scripts/make-mock-scenario.mjs`, seeded, validates against the contract before writing). The OSM snapshot is committed at `scripts/data/osm-atl-core.json`; `npm run fetch:osm` refreshes it.

## Map and the keyless fallback

deck.gl only (no MapLibre/Mapbox), client-only via `next/dynamic` (`ssr: false`). One camera is shared by both views; the toggle swaps the basemap. Each layer is its own module in `src/components/map/layers/`.

- **Analysis**: Google Map Tiles 2D (dark style) when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set; otherwise the **keyless fallback**: the CSS background plus real OSM roads drawn as `PathLayer`s.
- **Photoreal 3D**: Google Photorealistic 3D Tiles via `Tile3DLayer` when the key is set; otherwise the keyless map, tilted.
- Google attribution is shown whenever Google tiles are on screen; otherwise "© OpenStreetMap contributors".

- **Photoreal overlays** use deck.gl `TerrainExtension` (offset mode for paths/points, drape for fills) with the 3D tiles as terrain, so buildings occlude them. The camera target is lifted 270 m (ellipsoidal ground height) so steep close-ups stay above the mesh. Free orbit: right-drag or Ctrl-drag rotates/tilts up to 85°; the compass resets north.
- **Vehicles**: MARTA trains and streetcars run along the rail (and the proposed line once built), positioned from headway and speed and tied to the scrubber. Headways/speeds are **placeholders** (`VEHICLE_SERVICE` in `layers/vehicles.ts`) until the sim exports GTFS headways.
- **Underground**: `network.json` rail carries OSM `tunnel`/`bridge`/`layer` tags (optional `RailLine.structures` / `layers`). Tunnels are dashed; the Underground toggle fades the 2D basemap, or in photoreal hides the 3D tiles and shows tunnels at approximate depth over a flat road wireframe.

Build it: `/api/plan` → pipeline steps → `/api/simulate` → the line draws → agents switch from baseline to proposed trips → panels fill. The scrubber drives `TripsLayer.currentTime`; history cards switch on overlays; Year 5/10 fades at-risk agents and shows the rent-pressure zone.
