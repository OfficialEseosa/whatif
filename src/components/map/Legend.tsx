"use client";
import { MAP_COLORS, type RGBA } from "./colors";

const css = (c: RGBA) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
const GROUPS: { title: string; items: [string, RGBA][] }[] = [
  {
    title: "Transit",
    items: [
      ["Proposed line", MAP_COLORS.proposed],
      ["MARTA rail", MAP_COLORS.rail],
      ["Streetcar", MAP_COLORS.streetcar],
      ["Beltline trail", MAP_COLORS.beltline],
    ],
  },
  {
    title: "Commuters",
    items: [
      ["Driving", MAP_COLORS.tripDrive],
      ["On transit", MAP_COLORS.tripTransit],
      ["Riding the proposed line", MAP_COLORS.tripLine],
      ["Slower than before", MAP_COLORS.tripSlower],
    ],
  },
  {
    title: "After a plan is built",
    items: [
      ["Faster commutes", MAP_COLORS.gain],
      ["Slower commutes, more traffic", MAP_COLORS.loss],
      ["Rent pressure zone", MAP_COLORS.rentPressure],
      ["History overlay", MAP_COLORS.history],
    ],
  },
];

export function Legend() {
  return (
    <div className="scroll legend">
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="eyebrow">{g.title}</h3>
          <ul className="list">
            {g.items.map(([label, c]) => (
              <li key={label} className="row gap-sm legend-item">
                <i className="swatch" style={{ background: css(c) }} />
                {label}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
