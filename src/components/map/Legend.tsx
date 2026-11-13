"use client";
import { MAP_COLORS, type RGBA } from "./colors";

const css = (c: RGBA) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
const ITEMS: [string, RGBA][] = [
  ["Proposed line", MAP_COLORS.proposed],
  ["MARTA rail", MAP_COLORS.rail],
  ["Streetcar", MAP_COLORS.streetcar],
  ["Beltline", MAP_COLORS.beltline],
  ["Faster commutes", MAP_COLORS.gain],
  ["Slower commutes / more traffic", MAP_COLORS.loss],
  ["Rent pressure zone", MAP_COLORS.rentPressure],
  ["History overlay", MAP_COLORS.history],
];

export function Legend() {
  return (
    <ul className="map-ui map-ui-bl panel-float small list">
      {ITEMS.map(([label, c]) => (
        <li key={label} className="row gap-sm">
          <i className="swatch" style={{ background: css(c) }} />
          {label}
        </li>
      ))}
    </ul>
  );
}
