/**
 * Map colors in one place (deck.gl needs RGBA arrays, so these can't be CSS variables).
 * Neutral defaults — the designer restyles here.
 */
export type RGBA = [number, number, number, number];

/** The one accent colour: the proposed plan and the commuters riding it. Everything else is neutral. */
const ACCENT: RGBA = [198, 244, 50, 255]; // #C6F432

export const MAP_COLORS = {
  road: { motorway: [232, 232, 228, 120], trunk: [232, 232, 228, 100], primary: [232, 232, 228, 80], secondary: [232, 232, 228, 60], tertiary: [232, 232, 228, 42], link: [232, 232, 228, 60] } as Record<string, RGBA>,
  rail: [200, 200, 196, 235] as RGBA,
  streetcar: [240, 240, 236, 255] as RGBA,
  freight: [96, 96, 94, 150] as RGBA,
  station: [240, 240, 236, 255] as RGBA,
  beltline: [146, 176, 146, 210] as RGBA,
  proposed: ACCENT,
  proposedGlow: [198, 244, 50, 70] as RGBA,
  proposedRoad: [236, 236, 232, 255] as RGBA,
  proposedRoadGlow: [198, 244, 50, 50] as RGBA,
  buildHead: [228, 250, 170, 255] as RGBA,
  // Vehicles (schedule-shaped: GTFS headways when available; see layers/vehicles.ts)
  martaTrain: [255, 255, 255, 255] as RGBA,
  streetcarVehicle: [214, 214, 208, 255] as RGBA,
  proposedVehicle: [222, 250, 150, 255] as RGBA,
  // Rail structure (Underground mode): tunnels dashed in a darker grey
  tunnel: [150, 150, 146, 225] as RGBA,
  bridge: [200, 200, 196, 235] as RGBA,
  /** Swatch for the "Road network" toggle. */
  roadLegend: [232, 232, 228, 140] as RGBA,
  gain: [104, 170, 128, 255] as RGBA,
  loss: [200, 98, 88, 255] as RGBA,
  history: [196, 170, 130, 255] as RGBA,
  rentPressure: [206, 142, 94, 255] as RGBA,
  tripDrive: [160, 160, 156, 170] as RGBA,
  tripTransit: [220, 220, 216, 200] as RGBA,
  tripLine: ACCENT,
  tripSlower: [200, 98, 88, 235] as RGBA,
  atRisk: [206, 142, 94, 220] as RGBA,
};

export const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a)];
