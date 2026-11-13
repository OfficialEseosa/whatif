# WhatIf ATL — simulation backend (`sim/`)

Thin, end-to-end slice: real OSM roads, real MARTA GTFS, real LODES commuters ->
BPR/MSA traffic assignment + frequency-based transit + logit mode choice ->
contract-shaped `ScenarioResult` JSON for the Next.js frontend.

## Setup (Windows PowerShell, from `sim/`)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Fetch data (re-runnable; skips existing files; ~2 min, Overpass is the slow part)

```powershell
.\.venv\Scripts\python.exe fetch_data.py            # all
.\.venv\Scripts\python.exe fetch_data.py --only osm # or lodes / gtfs; --force to re-download
```

| Input | Source | File |
|---|---|---|
| OSM drive graph for `config.BBOX` | Overpass via OSMnx | `data/drive_<bbox>.graphml` |
| Eastside Trail + Ponce City Market geometry | Overpass via OSMnx | `data/corridors_<bbox>.json` |
| MARTA GTFS (rail, bus, streetcar) | https://www.itsmarta.com/google_transit_feed/google_transit.zip | `data/marta_gtfs.zip` |
| LODES8 GA OD main JT00 (latest year, currently 2024) | https://lehd.ces.census.gov/data/lodes/LODES8/ga/od/ | `data/ga_od_main_JT00_<year>.csv.gz` |
| LODES8 GA geography crosswalk | https://lehd.ces.census.gov/data/lodes/LODES8/ga/ga_xwalk.csv.gz | `data/ga_xwalk.csv.gz` |

itsmarta.com rejects the default python-requests User-Agent (403); `fetch_data.py` sends a generic Mozilla-compatible one.

## Run

```powershell
.\.venv\Scripts\python.exe run.py baseline --rebuild   # builds caches, writes public/scenarios/baseline.sim.json
.\.venv\Scripts\python.exe run.py beltline             # writes public/scenarios/beltline-streetcar.sim.json
.\.venv\Scripts\python.exe run.py sanity               # common-sense checks
.\.venv\Scripts\python.exe network.py                  # rebuild network cache + public/scenarios/major-roads.sim.json
.\.venv\Scripts\python.exe demand.py --sizes           # commuter counts for bigger boxes
node --experimental-strip-types validate_contract.mjs ..\public\scenarios\beltline-streetcar.sim.json  # real zod check
```

`--sample N` changes the display-sample size (default 3000, seed 42, deterministic).
Caches live in `data/cache/` keyed by bbox; delete them (or pass `--rebuild`) after changing constants.

## Serve

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
.\.venv\Scripts\python.exe smoke_test.py http://127.0.0.1:8000
```

- `GET /health` — status, bbox, prebaked files, population.
- `POST /simulate` with `{ "edit": ScenarioEdit }` — returns a prebaked `public/scenarios/*.sim.json`
  when its edit matches (ignoring `name`/`assumptions`; header `X-Sim-Source: prebaked`), else runs
  live on the in-memory baseline (~5 s, 2000-agent sample; `X-Sim-Source: live`).
  Only `extend_line` / `new_rail_line` are implemented; other types return 501.
- CORS open for `http://localhost:*` and `http://127.0.0.1:*`.

## Module map

| File | What it does |
|---|---|
| `config.py` | `BBOX` (single value; env `WHATIF_BBOX` overrides), paths, URLs |
| `fetch_data.py` | downloads all inputs |
| `network.py` | OSM graph -> edge table (length, free-flow time, lanes, capacity, way ids), stable edge ids `<u>-<v>-<key>`; road ids for the contract are OSM way ids `w<id>` |
| `demand.py` | LODES flows with home AND work in the box -> block-group pairs (jobs + earnings bands), snapped to network nodes |
| `assign.py` | BPR + 4-iteration MSA; `scipy.sparse.csgraph.dijkstra` from all origins, vectorised predecessor-walk loading |
| `transit.py` | GTFS -> peak patterns (headway from 7-9 AM trip counts, in-vehicle times from schedule) -> layered frequency graph |
| `mode_choice.py` | binary logit drive vs transit, one global ASC calibrated on the baseline |
| `model.py` | assignment <-> mode-choice loop; baseline cached to `data/cache/baseline_*.pkl` |
| `scenario.py` | `extend_line`: corridor geometry from OSM, through-running extension of a GTFS line, lane removal on `roadIds` |
| `export.py` | display sample, trip paths/timestamps, roads/tracts/metrics, mock pass-through, pydantic validation |
| `contract.py` | pydantic mirror of `src/lib/contract.ts` |
| `validate_contract.mjs` | validates output with the real zod schema (uses the repo's `node_modules`) |
| `main.py` | FastAPI app |
| `run.py`, `sanity.py`, `smoke_test.py` | CLI, checks, API smoke test |

## Assumptions and placeholders

Every number below is a named constant in the file listed. **Placeholders are not measurements.**

| Constant | Value | File | Status |
|---|---|---|---|
| `BBOX` | -84.42,33.73,-84.33,33.80 | config | choice (same as frontend mock) |
| `PEAK_HOUR_SHARE` | 0.25 | demand | **placeholder** for ACS B08302 departure share |
| Intrazonal flows (same block group / same node) | dropped from assignment | demand | simplification (913 jobs) |
| `CAPACITY_PER_LANE` by class | 450-1900 veh/h/lane | network | assumption |
| `DEFAULT_LANES`, `DEFAULT_SPEED_KPH` | by class, when OSM tags missing | network | assumption |
| `SIGNAL_DELAY_S` / `INTERSECTION_DELAY_S` | 15 s / 4 s per edge end | network | **placeholder** for signal timing |
| `BPR_ALPHA`, `BPR_BETA` | 0.15, 4 | assign | standard |
| `BACKGROUND_VC_PLACEHOLDER` | 0.05-0.85 of capacity by class | assign | **placeholder** for HPMS AADT x K x D minus commuters |
| `VEHICLE_OCCUPANCY` | 1.08 | assign | assumption |
| `DRIVE_TERMINAL_MIN` | 4 min per trip (park + walk) | assign | assumption |
| `WALK_SPEED_KPH`, `WALK_CIRCUITY` | 4.8, 1.3 | transit | assumption |
| `ACCESS_MAX_M`, `TRANSFER_MAX_M` | 1000 m, 300 m | transit | assumption |
| `TRANSFER_PENALTY_MIN` | 5 min (counted in minutes too) | transit | assumption |
| Headway | 120 min / trips in 7-9 AM (trip's middle in-box stop) | transit | from GTFS |
| `BETA_TIME` | 0.08 / min | mode_choice | assumption |
| `TARGET_TRANSIT_SHARE` | 0.12 | mode_choice | **placeholder** for ACS B08301 |
| All commuters have a car; no park-and-ride; no walk/bike mode | | mode_choice | simplification |
| `SPEED_MIXED_TRAFFIC_KPH` / `SPEED_OWN_ROW_KPH` (streetcar) | 12 / 20 km/h | scenario | assumption |
| `SHARED_LANE_CAPACITY_FACTOR` | 0.7 when a 1-lane road "loses" a lane | scenario | assumption |
| Display departures | Normal(7:30, 30 min), clipped 6:15-9:30 | export | display only |
| Agent home/work | a real LODES block point in the block group (flow-weighted) | export | real |
| `earningsBand` | drawn from the OD pair's LODES SE01/02/03 counts | export | real |
| `renter=false`, `hasCar=true`, `rentPressure=false`, `costShareUsdYr=0`, `displacementRisk="none"`, tract `redlined=false` | | export | **placeholders** (ACS / HOLC not wired) |
| `supportScore` | tanh(-minutesDelta/5) - 0.3 if within 150 m of new track | export | assumption |
| `dailyTransitRiders` | transit commuters (persons) per weekday, not boardings | export | definition |

**Copied from the frontend mock** (`public/scenarios/beltline-streetcar.json`) into every sim output:
verdict headline/summary/grades/alternatives and the 3 tests the sim doesn't compute, impact tiles and
calibration, whoPays items, claims, personas, lookahead. The sim overwrites: metrics, agents, roads,
tracts, line, impact.modeSplit, impact.minutesSavedByEarnings, whoPays.approval, and the values of the
`time_saved` and `new_riders` tests. `impact.notes` says this inside every file. Persona `agentId`s
refer to mock agents and do not exist in sim output.

**TODOs (not done):** HPMS AADT background traffic; ACS B08301/B08302/B08141 + per-tract ASC; park-and-ride;
buses slowed by road congestion; GTFS shapes for bus/rail display paths (now straight stop-to-stop);
other edit types; HOLC/ACS equity fields; Xpress / Ride Gwinnett feeds.

## Honest limits of the current numbers

- **Only commuters who live AND work in the box (25,726 in 2024 LODES).** ~298k people work in the box
  but most live outside it. Box size vs. in-box commuters (`demand.py --sizes`):
  8x8 km (current) 26.6k · 11x11 km 46k · 15x15 km 72k · 18x18 km 110k · 24x24 km 187k ·
  30x30 km 285k · 37x37 km 460k. The plan's "quarter million" needs roughly a 28x28 km box.
- In-box commuter cars are ~3% of modeled motorway volume; road congestion is almost entirely the
  placeholder background, so peak drive times are close to free-flow (+signal delay).
- The streetcar extension effect is small at this scale (~250 in-box commuters ride the new line).

## What Raphael should do next (in order)

1. **Add inbound commuters** (work in box, live outside): route them from the box-boundary node nearest
   their home direction (or a park-and-ride station). This is the biggest realism gain (10x population).
2. **Replace background traffic** with HPMS AADT x 0.09 x 0.55 minus modeled commuters (`assign.background_volume`).
3. **ACS B08301 per-tract ASC** in `mode_choice` (and B08302 for `PEAK_HOUR_SHARE`); then fill `renter`/`rentPressure`.
4. Grow the box once (1) is in (`WHATIF_BBOX`), re-run `fetch_data.py` + `run.py baseline --rebuild`; check run time.
5. Compute the remaining verdict tests (cost per rider, redlined share) so less is copied from the mock.
6. GTFS `shapes.txt` for transit display paths; `brt_lane` / `change_frequency` edits reuse `apply_extend_line` pieces.
