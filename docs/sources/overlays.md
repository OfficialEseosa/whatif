# Overlay dataset candidates

Phase 0, 2026-11-13. **Nothing was downloaded.** Sizes come from HTTP `HEAD` requests or
the publisher's page; licences from the publisher's own page unless noted. The manager
asks the user before any of these are fetched. Target shape for every overlay is
`OverlayFeature[]` (`src/lib/contract.ts`), one JSON file per overlay under
`src/data/overlays/`, with `placeholder: false` only for geometry copied/derived from the
named dataset.

Study box: lng -84.42..-84.33, lat 33.73..33.80 (contract). Every candidate below is
national or regional, so a clip-to-box step is needed; record the processing steps here
when it is done.

## 1. `redline` — HOLC grades (1938 Atlanta map)

**Primary: Mapping Inequality (University of Richmond DSL)** — "Download the Data",
https://dsl.richmond.edu/panorama/redlining/data (opened 2026-11-13 in the browser pane).

| file | URL | format | size (HEAD) |
|---|---|---|---|
| full dataset, all cities | https://dsl.richmond.edu/panorama/redlining/static/mappinginequality.json | GeoJSON (`application/json`) | 10,563,682 bytes (~10.6 MB) |
| full dataset, all cities | https://dsl.richmond.edu/panorama/redlining/static/mappinginequality.gpkg | GeoPackage | 8,826,880 bytes (~8.8 MB) |
| per-city spatial data | city selector on the same page (Atlanta entry not resolved to a URL without interaction) | GeoJSON / images | not measured |
| area-description text | https://github.com/americanpanorama/HOLC_Area_Description_Data | CSV | — |
| HOLC → 2010/2020 census tract crosswalk | https://github.com/americanpanorama/mapping-inequality-census-crosswalk | GeoPackage / GeoJSON | — |

Licence (quoted from the page): "The scans of maps and area descriptions are in the
public domain. … The georectified rasters and spatial data are available under a
CC-BY-NC license." A third-party cloud-native mirror
(https://source.coop/cboettig/mappinginequality, parquet 2.65 MB + PMTiles 14.9 MB) states
CC BY-NC-SA 4.0. **Flag:** non-commercial licence; fine for the demo, revisit before any
commercial deployment. Attribution required: "Mapping Inequality, Digital Scholarship Lab,
University of Richmond".

Processing plan (not run): fetch `mappinginequality.json`; filter features with
`city == "Atlanta"` / `state == "GA"`; keep `grade` (A–D) and `label`; clip or just keep
polygons intersecting the study box; write `src/data/overlays/redline.json` with
`overlay: "redline"`, `grade`, `label`, `placeholder: false`. Expect a few dozen polygons
in the box. The 1938 Atlanta map has 111 areas (Rhodes 2017).

Alternative for a single-city file: BTAA Geoportal record "Polygons and area descriptions
of Home Owners' Loan Corporation [Atlanta, Georgia] {1938}",
https://geo.btaa.org/catalog/53198812-de55-4563-aea0-484aed2f2696 (bot-gated; not
opened — likely the same DSL data).

## 2. `county` — Fulton / DeKalb line

Only the shared Fulton–DeKalb boundary crosses the study box (it runs roughly
north–south east of Little Five Points / Edgewood). Three options, best first:

| source | URL | format | size | licence |
|---|---|---|---|---|
| US Census Bureau cartographic boundary file, counties, 1:500k, 2025 | https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip | shapefile (zip) | 11,758,981 bytes (~11.8 MB, HEAD) | US federal government work, public domain; Census asks for a source credit |
| US Census Bureau cartographic boundary file, counties, 1:500k, 2024 | https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip | shapefile (zip) | 11,626,066 bytes (~11.6 MB, HEAD) | same |
| US Census Bureau TIGER/Line counties 2024 (full resolution) | https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip | shapefile (zip) | 83,913,260 bytes (~84 MB, HEAD) | same |
| Atlanta Regional Commission "County Boundary" layer (hosted by DeKalb County GIS) | https://dcgis.dekalbcountyga.gov/hosted/rest/services/County_Boundary/FeatureServer/0 | ArcGIS FeatureServer; `query?where=1%3D1&outFields=NAME,STCOFIPS&f=geojson` returns GeoJSON | small (ARC region, ~20 polygons; not measured) | copyrightText "Atlanta Regional Commission"; terms not stated on the layer page — ask ARC / check opendata.atlantaregional.com before use |
| OpenStreetMap county relations (Fulton, DeKalb) via Overpass | e.g. `relation["boundary"="administrative"]["admin_level"="6"]["name"="DeKalb County"]` | GeoJSON via overpass-turbo / osmtogeojson | small | ODbL (attribution + share-alike for derived databases) |

Census page listing (opened 2026-11-13):
https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html
lists `cb_2025_us_county_500k.zip` (shapefile 11 MB, KML 8.2 MB) and coarser 5m/20m
versions (too coarse for a city-scale map). Census files are the least ambiguous licence;
the 500k generalised file is accurate to tens of metres, enough for a map overlay but
check against OSM near the Edgewood/Candler Park station before relying on it for tract
logic.

Processing plan (not run): unzip; select `STATEFP == "13"` and `COUNTYFP in
("121","089")` (Fulton, DeKalb); extract the shared edge (or just both polygons clipped to
a slightly padded study box); write `src/data/overlays/county.json` as `path` features
(`overlay: "county"`, `label: "Fulton–DeKalb line"`, `placeholder: false`). Note the
Fulton/DeKalb line also coincides with part of the Atlanta city limit; keep the layer
labelled as a county line only.

## 3. `renewal` — urban renewal project areas (1950–1974)

**Primary: Renewing Inequality (University of Richmond DSL)**, Atlanta view
https://dsl.richmond.edu/panorama/renewal/#view=0/0/1&viz=cartogram&city=atlantaGA
(opened 2026-11-13).

- Per-city tabular download exists now: https://dsl.richmond.edu/panorama/renewal/static/cityData/ga-atlanta.csv
  (CSV; size not measured; link on the Atlanta page labelled "Downloadable Data for
  City"). Contents expected: project names, years, families displaced by race — **not
  geometry**.
- Project footprint polygons are drawn on the site for projects "in bold" (Butler St,
  Rawson-Washington, Georgia Tech, Rockdale, Thomasville, Bedford-Pine, Buttermilk
  Bottom, Transportation Plaza, West End, ...). As of Hurley's 2018 review the DSL did
  not offer a GIS download of these footprints; no public GeoJSON URL was found on
  2026-11-13 either. The site's map tiles are rendered from an internal JSON that is not
  advertised for reuse. Ask the DSL (contact link on the site) or check
  https://github.com/americanpanorama for a `renewal` data repo before scraping.
- Caveat from Hurley (2018): the DSL map omits the Georgia State project (25 downtown
  acres, 1962–71) and wrongly includes Transportation Plaza.
- Licence: not stated on the Atlanta page; the DSL's other project uses CC BY-NC, assume
  the same and confirm with them.

Fallbacks if no geometry can be obtained:
1. Keep hand-drawn placeholders (`placeholder: true`) for Butler Street, Buttermilk
   Bottom/Bedford-Pine and Rawson-Washington, labelled with the DSL's displacement
   figures (4,077 families citywide, 89% families of color).
2. Georgia State University Library "Planning Atlanta" digital collection (urban renewal
   maps, e.g. Research Atlanta 1979 *Urban Redevelopment in Atlanta* with a project list)
   — scanned maps only; would need georeferencing.

## 4. `highway` and `beltline`

Not in scope for this note: the interstates and Beltline segments already come from OSM in
`public/scenarios/network.json` (Raphael's `scripts/fetch-osm.mjs`), licence ODbL. The
history cards only highlight those existing layers.

## Attribution strings to show in the UI (once data is loaded)

- Redline: "HOLC 1938 map: Mapping Inequality, Digital Scholarship Lab, University of
  Richmond (CC BY-NC)".
- County: "County boundaries: US Census Bureau cartographic boundary files (2025)".
- Renewal: "Urban renewal projects and displacement: Renewing Inequality, Digital
  Scholarship Lab, University of Richmond".
- Roads/rail/Beltline/places: "© OpenStreetMap contributors (ODbL)".
