# Source log — `src/data/gazetteer.json`

Phase 0 audit by the history-researcher agent, 2026-11-13. **No ids were added, renamed
or removed and no coordinate was changed.** Proposed corrections are listed at the end
for the manager; Raphael's `scripts/make-mock-scenario.mjs` and `sim/sanity.py` must be
re-run after any coordinate edit.

Study box (contract): lng -84.42..-84.33, lat 33.73..33.80. All 31 places are inside it
(`tests/data/gazetteer.test.ts` enforces this; the allowlist is empty).

Tolerance used: the contract's `checkEditAgainstGazetteer` accepts a stop within 1e-4
degrees (~9–11 m) of the gazetteer coordinate, so "match" below means the gazetteer value
agrees with the OSM feature within 1e-4 on both axes. Larger gaps are reported.

How the checks were made (all on 2026-11-13, data © OpenStreetMap contributors, ODbL):

- **Overpass API** (`overpass-api.de`, `overpass.kumi.systems`): one query for every
  `railway=station`, `railway=tram_stop` and `place=*` node in the study box; one
  `way(around:35, lat, lon)[highway]` query per Beltline corridor point; the raw JSON
  replies are in the agent scratchpad only (not committed).
- **Nominatim** search (`nominatim.openstreetmap.org/search?...&format=jsonv2`) for the
  landmark / employment polygons; Nominatim returns the feature's centroid.
- MARTA GTFS `stops.txt` was **not** fetched (it is a zip download; the OSM station nodes
  are the MARTA platforms/entrances and agree with the gazetteer, so GTFS was not needed
  for this pass).

## Per-place findings

| id | gazetteer `[lng, lat]` | OSM feature checked | OSM `[lng, lat]` | gap | verdict |
|---|---|---|---|---|---|
| ponce_city_market | [-84.3658, 33.7724] | way 184803195 (building, 675 Ponce de Leon Ave) | [-84.36520, 33.77244] | Δlng 0.0006 (~55 m) | OK — gazetteer is the relation bbox centre, Nominatim gives the building centroid; both are on the PCM site |
| krog_street_market | [-84.364, 33.7569] | relation 5413435 (building, 99 Krog St) | [-84.36401, 33.75699] | <1e-4 | match |
| beltline_edgewood | [-84.3655, 33.7544] | ways within 35 m: Edgewood Avenue NE (44062182, 243830599) and Atlanta Beltline Eastside Trail (722838793) | — | — | match: point is at the trail/street crossing |
| beltline_irwin | [-84.3649, 33.7576] | within 35 m: Irwin Street NE (30872856), Eastside Trail (83291377, 742982445, 1043756762) | — | — | match |
| beltline_freedom_pkwy | [-84.3596, 33.7647] | within 35 m: John Lewis Freedom Parkway NE (29094065, 156324717/22/25), Eastside Trail (83291377) | — | — | match |
| beltline_ralph_mcgill | [-84.3609, 33.7676] | within 35 m: Ralph McGill Boulevard NE (28685648), Eastside Trail (83291376/77, 83294499) | — | — | match |
| beltline_north_ave | [-84.3639, 33.771] | within 35 m: North Avenue NE (782645243, 1216499871), Eastside Trail (83294497 et al.); Nominatim reverse → Eastside Trail way 83294497 at [-84.36388, 33.77101] | — | — | match |
| beltline_ponce | [-84.3646, 33.7735] | within 35 m: Ponce de Leon Avenue NE (119882125, 1499709551), Eastside Trail (83291378/79, 741964053) | — | — | match |
| piedmont_park | [-84.3727, 33.7888] | way 208357832 (leisure=park) | [-84.37189, 33.78905] | Δlng 0.0008 (~75 m), Δlat 0.0002 | OK for a 75-ha park ("OSM relation vertex mean" vs Nominatim centroid); see proposal P1 |
| centennial_olympic_park | [-84.3935, 33.7602] | relation 9685734 (leisure=park) | [-84.39345, 33.76014] | <1e-4 | match |
| georgia_state_capitol | [-84.3882, 33.749] | way 113041732 (amenity=townhall, 206 Washington St SW) | [-84.38817, 33.74906] | <1e-4 | match |
| mercedes_benz_stadium | [-84.4009, 33.7555] | way 536744534 (leisure=stadium) | [-84.40085, 33.75541] | <1e-4 | match |
| grady_memorial | [-84.3822, 33.7518] | way 270880941 (building=hospital, 80 Jesse Hill Jr Dr SE) | [-84.38201, 33.75173] | <1e-4 | match |
| georgia_tech | [-84.3966, 33.776] | relation 3341535 (amenity=university) | [-84.39881, 33.77609] | Δlng 0.0022 (~205 m) | OK — campus is ~1.5 km wide; gazetteer uses the relation bbox centre, Nominatim the polygon centroid. See proposal P2 |
| five_points_station | [-84.3916, 33.7539] | node 318451223 (railway=station "Five Points") | [-84.39160, 33.75389] | <1e-4 | match |
| peachtree_center_station | [-84.3876, 33.7581] | node 4170221445 | [-84.38761, 33.75815] | <1e-4 | match |
| civic_center_station | [-84.3875, 33.7665] | node 4172450832 | [-84.38754, 33.76651] | <1e-4 | match |
| north_avenue_station | [-84.3868, 33.7716] | node 4172450833 | [-84.38677, 33.77160] | <1e-4 | match |
| georgia_state_station | [-84.386, 33.7502] | node 4172458490 | [-84.38596, 33.75017] | <1e-4 | match |
| king_memorial_station | [-84.3755, 33.75] | node 4172458489 | [-84.37545, 33.75001] | <1e-4 | match |
| inman_park_reynoldstown_station | [-84.3524, 33.7578] | node 4172458491 | [-84.35236, 33.75782] | <1e-4 | match |
| streetcar_centennial_olympic_park | [-84.392, 33.7594] | node 3424138129 (railway=tram_stop) | [-84.39202, 33.75939] | <1e-4 | match |
| streetcar_dobbs_plaza | [-84.3788, 33.7556] | node 3424138130 | [-84.37882, 33.75555] | <1e-4 | match |
| streetcar_edgewood_hilliard | [-84.3763, 33.7544] | node 3424138131 ("Edgewood at Hillard") | [-84.37634, 33.75437] | <1e-4 | match (OSM spelling "Hillard" noted in `source`) |
| streetcar_king_historic_district | [-84.3749, 33.7555] | node 3424138133 | [-84.37492, 33.75552] | <1e-4 | match |
| old_fourth_ward | [-84.37, 33.763] | node 8433055867 (place=neighbourhood) | [-84.37176, 33.76411] | Δlng 0.0018 (~165 m), Δlat 0.0011 (~120 m) | source says "approximate centroid"; see proposal P3 |
| inman_park | [-84.3627, 33.7576] | node 154039197 (place=neighbourhood) | [-84.36270, 33.75761] | <1e-4 | match |
| little_five_points | [-84.3492, 33.765] | node 2710191943 (place=neighbourhood) | [-84.34917, 33.76498] | <1e-4 | match |
| sweet_auburn | [-84.38, 33.7553] | node 154167969 (place=neighbourhood) | [-84.38021, 33.75550] | Δlng 0.0002, Δlat 0.0002 (~25 m) | source says "approximate centroid"; see proposal P4 |
| midtown | [-84.385, 33.781] | node 8433055871 (place=neighbourhood) | [-84.38407, 33.78166] | Δlng 0.0009 (~85 m), Δlat 0.0007 (~75 m) | source says "approximate centroid"; see proposal P5 |
| reynoldstown | [-84.3535, 33.7495] | node 329571517 (place=neighbourhood) | [-84.35536, 33.75028] | Δlng 0.0019 (~170 m), Δlat 0.0008 (~85 m) | source says "approximate centroid"; see proposal P6 |

Summary: 24 of 31 coordinates match their OSM feature within the contract tolerance; the
other 7 are area features (parks, campus, neighbourhoods) whose "centre" is a modelling
choice, and none is wrong by more than ~200 m. Nothing is outside the study box.

Other observations:

- The 4 streetcar stops cover only the eastern loop; OSM also has tram stops for Auburn
  at Piedmont, Sweet Auburn Market, Hurt Park, Woodruff Park, Park Place, Peachtree
  Center, Carnegie at Spring and Luckie at Cone (node ids 3424138127/37/32,
  3582046404/487/279/287, 3424138128). Not added in phase 0 (no new places rule); listed
  here for a later additive pass.
- MARTA stations in the box missing from the gazetteer: Edgewood/Candler Park
  (4172458492), Garnett (5346183223), Vine City (7745032438), SEC District / GWCC
  (6863551312), Ashby (6863544212), West End (4172450826), Arts Center (4172450835,
  lat 33.7891 — inside the box). Same note: candidates for an additive pass.
- Alias check: every name/alias is unique across places (tested). "Georgia State" is the
  station alias; the Capitol has "the Capitol" — no clash.
- `corridors` ids (`beltline_eastside`, `ponce_de_leon_ave`, `north_ave`, `edgewood_ave`,
  `atlanta_streetcar`) are free strings in the contract; they are not validated against
  any list because none exists yet in `src/lib/contract.ts`.

## Proposed coordinate corrections (NOT applied; need manager + Raphael)

Each proposal replaces an "approximate centroid"/bbox-centre value with an OSM feature so
the `source` field can cite a node/way id. None changes which block the point is in.

| # | id | current | proposed `[lng, lat]` | proposed `source` | why |
|---|---|---|---|---|---|
| P1 | piedmont_park | [-84.3727, 33.7888] | keep, or [-84.3719, 33.7891] | "OSM way 208357832 centroid (Nominatim)" | cosmetic; either point is inside the park |
| P2 | georgia_tech | [-84.3966, 33.776] | keep | — | relation bbox centre is a defensible campus centre; no change recommended |
| P3 | old_fourth_ward | [-84.37, 33.763] | [-84.3718, 33.7641] | "OSM place node 8433055867" | replaces an unsourced estimate with a cited node |
| P4 | sweet_auburn | [-84.38, 33.7553] | [-84.3802, 33.7555] | "OSM place node 154167969" | same; 25 m shift |
| P5 | midtown | [-84.385, 33.781] | [-84.3841, 33.7817] | "OSM place node 8433055871" | same; ~110 m shift |
| P6 | reynoldstown | [-84.3535, 33.7495] | [-84.3554, 33.7503] | "OSM place node 329571517" | same; ~190 m shift |

If the manager approves P3–P6, the edit is four coordinate values plus four `source`
strings; `tests/data/gazetteer.test.ts` needs no change (ids unchanged, still in box), but
`public/scenarios/network.json` / the mock must be regenerated by Raphael because stops
copy coordinates from the gazetteer.

## Licence

All coordinates above derive from OpenStreetMap (© OpenStreetMap contributors, ODbL
1.0). The gazetteer is a small derived dataset; the app should carry an OSM attribution
line. ODbL share-alike applies to the derived *database* if it is publicly redistributed.
