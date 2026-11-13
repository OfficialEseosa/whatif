/** Display formatting for contract values (`value` + `unit`). Presentation only. */
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;

export function formatValue(value: number, unit: string): string {
  switch (unit) {
    case "share":
      return `${Math.round(value * 100)}%`;
    case "usd/trip":
      return `$${value.toFixed(2)}`;
    case "usd/yr":
      return `$${Math.round(value)}/yr`;
    case "hrs/day":
      return `${int(value)} hrs/day`;
    case "riders/day":
      return `${int(value)}/day`;
    case "households":
      return `${int(value)} hh`;
    case "min":
      return `${signed(value)} min`;
    case "pts":
      return `${signed(value)} pts`;
    case "r2":
      return `r² ${value.toFixed(2)}`;
    default:
      return `${value.toLocaleString("en-US")} ${unit}`;
  }
}

/** Seconds after 6:00 AM -> "7:42". */
export function clock(sec: number): string {
  const m = Math.floor(sec / 60) + 360;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Percent with one decimal: 0.1204 -> "12.0%". */
export const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 33.762, -84.374 -> 33°45'43"N 84°22'26"W. */
export function dms(lat: number, lng: number): string {
  const part = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const sec = Math.floor(((a - d) * 60 - m) * 60);
    return `${d}°${String(m).padStart(2, "0")}'${String(sec).padStart(2, "0")}"${v >= 0 ? pos : neg}`;
  };
  return `${part(lat, "N", "S")} ${part(lng, "E", "W")}`;
}

/** Height of the camera above the ground for a deck.gl web-mercator view (512 px tiles, altitude 1.5). */
export function eyeAltitude(v: { latitude: number; zoom: number; pitch: number; height: number }): string {
  const metersPerPixel = (78271.517 * Math.cos((v.latitude * Math.PI) / 180)) / 2 ** v.zoom;
  const m = 1.5 * v.height * metersPerPixel * Math.cos((v.pitch * Math.PI) / 180);
  return m >= 10000 ? `${Math.round(m / 1000).toLocaleString("en-US")} km` : `${(Math.round(m / 10) * 10).toLocaleString("en-US")} m`;
}
