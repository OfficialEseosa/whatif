/**
 * Map colors in one place (deck.gl needs RGBA arrays, so these can't be CSS variables).
 * Neutral defaults — the designer restyles here.
 */
export type RGBA = [number, number, number, number];

export const MAP_COLORS = {
  road: { motorway: [236, 240, 248, 120], trunk: [236, 240, 248, 100], primary: [236, 240, 248, 80], secondary: [236, 240, 248, 60], tertiary: [236, 240, 248, 42], link: [236, 240, 248, 60] } as Record<string, RGBA>,
  rail: [138, 180, 248, 240] as RGBA,
  streetcar: [232, 234, 237, 255] as RGBA,
  freight: [30, 32, 36, 170] as RGBA,
  station: [232, 234, 237, 255] as RGBA,
  beltline: [126, 214, 160, 220] as RGBA,
  proposed: [255, 210, 63, 255] as RGBA,
  proposedGlow: [255, 210, 63, 70] as RGBA,
  gain: [110, 216, 163, 255] as RGBA,
  loss: [255, 122, 112, 255] as RGBA,
  history: [220, 185, 138, 255] as RGBA,
  rentPressure: [255, 150, 90, 255] as RGBA,
  tripDrive: [170, 200, 255, 215] as RGBA,
  tripTransit: [255, 255, 255, 235] as RGBA,
  tripLine: [255, 210, 63, 255] as RGBA,
  tripSlower: [255, 122, 112, 240] as RGBA,
  atRisk: [255, 150, 90, 230] as RGBA,
};

export const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a)];
