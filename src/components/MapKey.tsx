import { MAP_COLORS, type RGBA } from "./map/colors";
import "./firstrun.css";

const css = (c: RGBA) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

const ITEMS: { label: string; color: RGBA; shape: "line" | "dot" }[] = [
  { label: "Your proposed line", color: MAP_COLORS.proposed, shape: "line" },
  { label: "MARTA rail", color: MAP_COLORS.rail, shape: "line" },
  { label: "Streetcar", color: MAP_COLORS.streetcar, shape: "line" },
  { label: "Beltline", color: MAP_COLORS.beltline, shape: "line" },
  { label: "Station", color: MAP_COLORS.station, shape: "dot" },
  { label: "Commuters", color: MAP_COLORS.tripDrive, shape: "dot" },
];

/** Compact key for the map's lines and dots; colors come from the map palette. */
export function MapKey() {
  return (
    <div className="map-key">
      <h3 className="map-key-title">On the map</h3>
      <ul className="list map-key-list">
        {ITEMS.map((it) => (
          <li key={it.label} className="map-key-item">
            <span className="map-key-swatch" aria-hidden="true">
              <i className={it.shape === "line" ? "map-key-line" : "map-key-dot"} style={{ background: css(it.color) }} />
            </span>
            {it.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
