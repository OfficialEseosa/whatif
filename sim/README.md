# WhatIf ATL â€” simulation backend (`sim/`)

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
| Census cartographic boundary tracts GA 2023 | https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_13_tract_500k.zip | `data/cb_2023_13_tract_500k.zip` |
| ACS 2024 5-year B25003/B19013/B25064/B25070 (table-based summary files) | https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/ | `data/acsdt5y2024-*.dat` |
| HOLC 1938 Atlanta (Mapping Inequality) | https://dsl.richmond.edu/panorama/redlining/static/citiesData/GAAtlanta1938/geojson.json | `data/holc_atlanta_1938.geojson` |
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

- `GET /health` â€” status, bbox, prebaked files, population.
- `POST /simulate` with `{ "edit": ScenarioEdit }` â€” returns a prebaked `public/scenarios/*.sim.json`
  when its edit matches (ignoring `name`/`assumptions`; header `X-Sim-Source: prebaked`), else runs
  live on the in-memory baseline (~13 s, 2000-agent sample; `X-Sim-Source: live`).
  Only `extend_line` / `new_rail_line` are implemented; other types return 501.
- CORS open for `http://localhost:*` and `http://127.0.0.1:*`.

## Module map

| File | What it does |
|---|---|
| `config.py` | `BBOX` (single value; env `WHATIF_BBOX` overrides), paths, URLs |
| `fetch_data.py` | downloads all inputs |
| `network.py` | boundary gateways; OSM graph -> edge table (length, free-flow time, lanes, capacity, way ids), stable edge ids `<u>-<v>-<key>`; road ids for the contract are OSM way ids `w<id>` |
| `demand.py` | LODES internal flows (home and work in box) -> block-group pairs; inbound flows (home outside, work inside) -> home tract -> work BG; zones snapped to network nodes |
| `assign.py` | BPR + 12-iteration MSA; `scipy.sparse.csgraph.dijkstra` from all origins and gateways, vectorised predecessor-walk loading; inbound gateway choice |
| `transit.py` | GTFS -> peak patterns (headway from 7-9 AM trip counts, in-vehicle times from schedule; rail kept region-wide) -> layered frequency graph; inbound rail access |
| `mode_choice.py` | binary logit drive vs transit, one global ASC calibrated on the baseline |
| `model.py` | assignment <-> mode-choice loop; baseline cached to `data/cache/baseline_*.pkl` |
| `scenario.py` | `extend_line`: corridor geometry from OSM, through-running extension of a GTFS line, lane removal on `roadIds` |
| `export.py` | display sample, trip paths/timestamps, roads/tracts/metrics, mock pass-through, pydantic validation |
| `equity.py` | tract polygons + ACS tenure/income/rent/burden + HOLC grade-D share per GA tract |
| `costs.py` | streetcar per-mile cost benchmarks, annualisation, cost per new-rider trip |
| `verdict.py` | five tests + grades, verdict label/headline/summary, who-pays items, tract and agent equity fields |
| `contract.py` | pydantic mirror of `src/lib/contract.ts` (1.1.0) |
| `validate_contract.mjs` | validates output with the real zod schema (uses the repo's `node_modules`) |
| `main.py` | FastAPI app |
| `run.py`, `sanity.py`, `smoke_test.py` | CLI, checks, API smoke test |

## Assumptions and placeholders

Every number below is a named constant in the file listed. **Placeholders are not measurements.**

| Constant | Value | File | Status |
|---|---|---|---|
| `BBOX` | -84.42,33.73,-84.33,33.80 | config | choice (same as frontend mock) |
| `PEAK_HOUR_SHARE` | 0.25 | demand | **placeholder** for ACS B08302 departure share |
| No work-from-home / absence reduction (LODES JT00 counts jobs) | | demand | simplification: peak volumes likely overstated |
| `MAX_INBOUND_HOME_KM` | 80 km (drops 24,039 of 271,316 inbound) | demand | assumption |
| Inbound home point | job-weighted mean of LODES home blocks per home tract | demand | real (aggregated) |
| Gateways | 25 boundary crossings of motorway/trunk/primary/secondary roads (`network.find_gateways`) | network | from OSM |
| `OUT_OF_BOX_DETOUR`, `OUT_OF_BOX_SPEED_KPH` | 1.25; 50 motorway / 38 trunk / 33 primary / 30 secondary km/h | assign | **estimate** of the out-of-box drive |
| `APPROACH_REF_MIN` | 10 min x BPR term of the gateway edge | assign | assumption (queue on the approach) |
| `MSA_ITERATIONS` | 12 (rel. gap ~1%) | assign | choice |
| Zone connectors | zones snap to the nearest tertiary-or-higher node | demand | simplification |
| `STATION_CANDIDATES`, `PNR_DRIVE_KPH`, `PNR_DETOUR`, `PNR_PENALTY_MIN`, `PNR_MAX_KM` | 6, 35 km/h, 1.3, 5 min, 25 km | transit | **estimate** of inbound access to MARTA rail |
| Intrazonal flows (same block group / same node) | dropped from assignment | demand | simplification (913 jobs) |
| `CAPACITY_PER_LANE` by class | 450-1900 veh/h/lane | network | assumption |
| `DEFAULT_LANES`, `DEFAULT_SPEED_KPH` | by class, when OSM tags missing | network | assumption |
| `SIGNAL_DELAY_S` / `INTERSECTION_DELAY_S` | 15 s / 4 s per edge end | network | **placeholder** for signal timing |
| `BPR_ALPHA`, `BPR_BETA` | 0.15, 4 | assign | standard |
| `BACKGROUND_VC_PLACEHOLDER` | 0.55 motorway ... 0.05 residential (lowered once inbound trips were modeled) | assign | **placeholder** for HPMS AADT x K x D minus commuters |
| `VEHICLE_OCCUPANCY` | 1.08 | assign | assumption |
| `DRIVE_TERMINAL_MIN` | 4 min per trip (park + walk) | assign | assumption |
| `WALK_SPEED_KPH`, `WALK_CIRCUITY` | 4.8, 1.3 | transit | assumption |
| `ACCESS_MAX_M`, `TRANSFER_MAX_M` | 1000 m, 300 m | transit | assumption |
| `TRANSFER_PENALTY_MIN` | 5 min (counted in minutes too) | transit | assumption |
| Headway | 120 min / trips in 7-9 AM (trip's middle in-box stop) | transit | from GTFS |
| `BETA_TIME` | 0.08 / min | mode_choice | assumption |
| `TARGET_TRANSIT_SHARE` | 0.12 (transit + park-and-ride, whole modeled population) | mode_choice | **placeholder** for ACS B08301 |
| All commuters have a car; no walk/bike mode; no bus feeders to rail | | mode_choice | simplification |
| `SPEED_MIXED_TRAFFIC_KPH` / `SPEED_OWN_ROW_KPH` (streetcar) | 12 / 20 km/h | scenario | assumption |
| `SHARED_LANE_CAPACITY_FACTOR` | 0.7 when a 1-lane road "loses" a lane | scenario | assumption |
| Display times | work arrival ~ Normal(8:20, 30 min), clipped 7:00-9:50; departure = arrival - baseline minutes | export | display only |
| Agent home/work | a real LODES block point in the block group (flow-weighted) | export | real |
| `earningsBand` | drawn from the OD pair's LODES SE01/02/03 counts | export | real |
| `hasCar=true`, `displacementRisk="none"` | | export | **placeholders** (see equity table below) |

| `dailyTransitRiders` | transit commuters (persons) per weekday, not boardings | export | definition |

### Verdict, grades, cost and equity (`verdict.py`, `costs.py`, `equity.py`)

Grades come only from these thresholds (judgment calls unless a source is named). The baseline file has no
plan, so its five tests are 0 and graded "fair" with sublabel "Baseline - no plan applied".

| Test | Value | good | fair | poor | Constant(s) |
|---|---|---|---|---|---|
| `time_saved` | net commuter-hours/weekday, all modeled commuters | >= 500 | 0 to 500 | < 0 (any net loss) | `TIME_SAVED_GOOD_HRS`, `TIME_SAVED_FAIR_HRS` |
| `new_riders` | commuters/day switching to transit (work trips only) | >= 3,000 | >= 1,000 | < 1,000 | `NEW_RIDERS_GOOD`, `NEW_RIDERS_FAIR` |
| `cost_per_rider` | mid capital cost / (new riders x 2 trips x 250 days x 20 yrs) | < $6 | < $15 | >= $15 | `COST_PER_TRIP_*`; breakpoints borrowed from FTA CIG cost-effectiveness (FAST Act interim policy guidance, June 2016: High < $4, Med-High $4-5.99, Medium $6-9.99, Med-Low $10-14.99, Low >= $15). FTA's measure is annual capital + O&M per project trip, so this is a looser comparison |
| `redlined_benefit_share` | share of positive time gains going to residents of redlined tracts | >= their share of modeled commuters | >= 0.5 x that share | below, or no gains at all | `REDLINED_FAIR_RATIO` |
| `renters_rent_pressure` | renter households within 800 m of new stops in rent-pressure tracts | <= 250 | <= 1,000 | > 1,000 | `RENTERS_GOOD_MAX`, `RENTERS_FAIR_MAX` |

**Verdict label rule:** `poor` if `time_saved` is poor, or if `new_riders` and `cost_per_rider` are both poor;
`good` if >= 3 tests are good and none is poor; otherwise `mixed`. Headline and summary are fixed sentence
templates filled with the numbers (including negative or negligible results) and state the work-trips-only limit.

**Capital cost (ESTIMATE, `costs.py`)** - per-mile benchmarks, nominal year-of-expenditure dollars, no
inflation adjustment, no operating cost. Range = lowest..highest benchmark; midpoint = median benchmark:

| Project | Opened | Miles | Capital cost | $/mile | Source |
|---|---|---|---|---|---|
| Atlanta Streetcar loop | 2014 | 2.7 | ~$98M | $36.3M | City of Atlanta final cost as reported 2014-15 (Railway Technology; Wikipedia "Atlanta Streetcar"); nominal 2014 $ |
| Tempe Streetcar | 2022 | 3.0 | $201.85M | $67.3M | FTA Small Starts project profile, rating Nov 2018 (transit.dot.gov `az-tempe-streetcar-ar20-profile.pdf`) |
| Kansas City Streetcar Main Street Extension | 2025 | 3.5 | $351.71M | $100.5M | FTA FFGA project profile FY22 (transit.dot.gov `MO-Kansas-City-Streetcar-Main-St-Ext-Project-FFGA-Profile-FY22.pdf`) |

Annualised straight-line over `ANNUALIZE_YEARS` = 20 (no discounting) and split over Fulton + DeKalb
households (ACS 2024 B25003 occupied units: 462,481 + 287,239 = 749,720). Agents living in Fulton/DeKalb get
the midpoint as `costShareUsdYr`; others 0.

**Equity inputs (`equity.py`)** - ACS 2024 5-year from the Census table-based summary files (no API key; the
Census API now requires one): B25003, B19013, B25064, B25070. Tract polygons: Census cartographic boundary
2023 (1:500k), simplified 25 m. HOLC: Mapping Inequality, Atlanta 1938 GeoJSON (University of Richmond).

| Rule | Value | Constant |
|---|---|---|
| Tract is "formerly redlined" | >= 50% of its area in HOLC grade-D polygons | `REDLINED_D_SHARE` |
| Rent-pressure tract | renter share >= 0.5 AND median HH income < 80% of Atlanta MSA median ($89,724, ACS 2024; HUD "low income" convention) | `RENT_PRESSURE_RENTER_SHARE`, `RENT_PRESSURE_INCOME_RATIO` |
| Rent-pressure zone | 800 m around NEW stops (gazetteer kinds other than existing streetcar/MARTA stops) | `RENT_PRESSURE_RADIUS_M` |
| Noise / construction zone | 150 m around the new track | `NOISE_BUFFER_M` |
| Households in a zone | tract households (or renters) x share of tract AREA inside the buffer (uniform-density proxy) | `equity.buffer_share` |
| Agent `renter` | **sampled** from the home tract's renter share (seeded RNG), not observed | `export` |
| Agent `stake.rentPressure` | sampled renter AND home in a rent-pressure tract AND within 800 m of a new stop | `verdict.agent_equity` |
| `displacementRisk` | always `"none"` - **not modeled**; no defensible year-5/10 proxy yet | |
| Who pays: slowed roads | roads whose per-trip delay grows >= 0.05 min (3 s) | `SLOWED_ROAD_MIN` |
| Who pays: spillover roads | unedited roads whose peak v/c grows >= 0.05 | `SPILLOVER_VC_DELTA` |
| Support score | tanh(-minutesDelta/5) - 0.3 if noise zone - 0.2 if rent-pressure renter | `export` |

**Still copied from the frontend mock** (listed in every file's `mockSections` and `impact.notes`):
`verdict.alternatives`, `impact.tiles`, `impact.calibration`, `claims`, `personas`, `lookahead`.
Persona `agentId`s refer to mock agents and do not exist in sim output.

**Transit service** - `public/scenarios/transit-service.sim.json`: weekday 07:00-09:00 trips and headways per
GTFS route and per `network.json` line id (`transit.export_service`, written by `run.py baseline`). The
Atlanta Streetcar's first weekday departures are about 08:17-08:33, then every ~15 min, so its 7-9 AM
headway is 40-60 min.
**TODOs (not done):** HPMS AADT background traffic; ACS B08301/B08302/B08141 + per-tract ASC; park-and-ride;
buses slowed by road congestion; GTFS shapes for bus/rail display paths (now straight stop-to-stop);
other edit types; operating cost; displacement look-ahead; Xpress / Ride Gwinnett feeds.

## Who is modeled (and what is estimated)

- **Internal commuters** (live and work in the box, 25,717 in LODES 2024): whole trip routed on the network.
- **Inbound commuters** (work in the box, home outside within 80 km, 247,277): **only the in-box part is
  modeled on the network.** The approach outside the box is an estimate added to their minutes:
  - drive: straight line home -> gateway x 1.25 at a class speed, plus a queue term on the gateway road;
    the gateway is re-chosen every MSA iteration (min of approach estimate + congested in-box time);
  - transit: walk (<= 1 km) or drive (park-and-ride, <= 25 km, +5 min) to one of the 6 nearest MARTA rail
    platforms (estimate), then the real GTFS rail schedule, transfers and in-box egress (modeled).
  - Their display paths start where they enter the box (gateway node or first in-box rail stop).
- **Not modeled:** outbound commuters (live in box, work outside: ~58k), buses entering the box from
  outside, bus feeders to rail, station parking capacity, work-from-home.
- `populationModeled` = 272,994 = internal + inbound (intrazonal 922 and far-away 24,039 excluded).

## Honest limits of the current numbers

- Freeway gateways take most inbound cars (I-85 N ~17.7k veh/h, Connector S ~9k, I-20 E/W 6-7k);
  arterial gateways 100-1,700 veh/h each. Downtown Connector v/c median 1.05, max 1.45 (6 edges > 1.3);
  59 edges > 1.3 overall, mostly freeway ramps and the tertiary/secondary streets they feed
  (Techwood Dr, Williams St, Broad St, Coca-Cola Pl, up to 2.3). No work-from-home reduction is applied,
  so peak volumes are likely overstated.
- In-box drive time, job-weighted: free-flow 5.6 min vs peak 7.1 min (x1.28); inbound x1.30, internal x1.11.
  Intown point-to-point trips on streets the inbound flow does not use barely change (Five Points -> PCM 9.5 -> 9.9).
- Mode split is calibrated to a placeholder 12% total; it comes out as 1.1% walk-access transit and 10.9%
  park-and-ride, because inbound riders mostly drive to stations (bus feeders are not modeled).
  28% of OD units have no transit option (home > 25 km from rail).
- The streetcar extension effect is small (~240 commuters per day ride the new line).
- Box size vs commuters with home AND work inside (`demand.py --sizes`): 8x8 km 26.6k, 11x11 km 46k,
  15x15 km 72k, 18x18 km 110k, 24x24 km 187k, 30x30 km 285k, 37x37 km 460k.
## What Raphael should do next (in order)

1. **Replace background traffic** with HPMS AADT x 0.09 x 0.55 minus modeled commuters (`assign.background_volume`).
2. **ACS B08301 per-tract ASC** (and the work-from-home share) in `mode_choice` (and B08302 for `PEAK_HOUR_SHARE`); then fill `renter`/`rentPressure`.
3. Add outbound commuters (reverse of the gateway logic) and bus feeders / buses entering the box.
4. Grow the box (`WHATIF_BBOX`), re-run `fetch_data.py` + `run.py baseline --rebuild`; check run time.
5. Compute the remaining verdict tests (cost per rider, redlined share) so less is copied from the mock.
6. GTFS `shapes.txt` for transit display paths; `brt_lane` / `change_frequency` edits reuse `apply_extend_line` pieces.




