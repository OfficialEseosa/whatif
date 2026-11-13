/**
 * Map colors in one place (deck.gl needs RGBA arrays, so these can't be CSS variables).
 * Neutral defaults — the designer restyles here.
 */
export type RGBA = [number, number, number, number];

export const MAP_COLORS = {
  road: { motorway: [120, 128, 150, 200], trunk: [100, 108, 130, 180], primary: [80, 88, 110, 170], secondary: [66, 72, 92, 160], tertiary: [52, 58, 76, 150], link: [80, 88, 110, 140] } as Record<string, RGBA>,
  rail: [150, 160, 180, 230] as RGBA,
  streetcar: [200, 205, 215, 255] as RGBA,
  freight: [70, 74, 86, 160] as RGBA,
  station: [200, 205, 215, 255] as RGBA,
  beltline: [110, 150, 120, 200] as RGBA,
  proposed: [255, 176, 64, 255] as RGBA,
  proposedGlow: [255, 176, 64, 70] as RGBA,
  proposedRoad: [235, 235, 240, 255] as RGBA,
  proposedRoadGlow: [255, 176, 64, 50] as RGBA,
  buildHead: [255, 230, 160, 255] as RGBA,
  // Vehicles (schedule-shaped, placeholder headways; see layers/vehicles.ts)
  martaTrain: [255, 255, 255, 255] as RGBA,
  streetcarVehicle: [120, 220, 255, 255] as RGBA,
  proposedVehicle: [255, 210, 120, 255] as RGBA,
  // Rail structure (Underground mode)
  tunnel: [170, 120, 255, 230] as RGBA,
  bridge: [150, 160, 180, 230] as RGBA,
  gain: [60, 200, 140, 255] as RGBA,
  loss: [240, 100, 100, 255] as RGBA,
  history: [200, 165, 120, 255] as RGBA,
  rentPressure: [255, 176, 64, 255] as RGBA,
  tripDrive: [130, 150, 190, 200] as RGBA,
  tripTransit: [235, 235, 245, 220] as RGBA,
  tripLine: [255, 176, 64, 255] as RGBA,
  tripSlower: [240, 100, 100, 230] as RGBA,
  atRisk: [200, 165, 120, 200] as RGBA,
};

export const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a)];
