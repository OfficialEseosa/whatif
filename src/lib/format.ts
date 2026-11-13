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
