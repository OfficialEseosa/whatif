/**
 * The study area, in one place. Change STUDY_BBOX here and re-run `npm run fetch:osm`,
 * `npm run fetch:elevation` and `npm run mock`; the map, camera and layers follow it.
 * [west, south, east, north] in WGS84 degrees.
 */
export type BBox = readonly [number, number, number, number];

/** Whole modeled area: downtown Atlanta east to Decatur and Clarkston, south to the airport. */
export const STUDY_BBOX: BBox = [-84.47, 33.62, -84.21, 33.83];

/** Urban core / streetcar corridor: the demo scenario and the opening view live here. */
export const CORE_BBOX: BBox = [-84.42, 33.73, -84.33, 33.8];

export const bboxCenter = (b: BBox): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
export const inBBox = (b: BBox, lng: number, lat: number) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
