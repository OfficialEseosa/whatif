import type { WhoPays, ZoneKind } from "@/lib/contract";
import { formatValue, pct } from "@/lib/format";
import { MockTag } from "../MockTag";

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/** One cost as a plain statement, in the same words as the five tests. */
function statement(i: WhoPays["items"][number]): string {
  const n = Math.round(i.value);
  switch (i.key) {
    case "slowed_roads":
      return n === 0 ? "No drivers are slowed noticeably" : `${whole(n)} drivers an hour are slowed at rush hour`;
    case "spillover_roads":
      return n === 0 ? "No nearby roads get busier" : `${whole(n)} nearby ${n === 1 ? "road gets" : "roads get"} busier`;
    case "noise_construction":
      return n === 0 ? "No households live next to the new track" : `${whole(n)} households live next to the new track`;
    case "rent_pressure":
      return n === 0 ? "No renter households near new stops face rising rent" : `${whole(n)} renter ${n === 1 ? "household" : "households"} near new stops may face rising rent`;
    case "regional_cost":
      return `About $${i.value < 20 ? i.value.toFixed(2) : whole(i.value)} a year per household to build it`;
    default:
      return `${i.label}: ${formatValue(i.value, i.unit)}`;
  }
}

export function WhoPaysPane({
  whoPays,
  highlightZone,
  onHighlight,
  isMock,
}: {
  whoPays: WhoPays;
  highlightZone: ZoneKind | null;
  onHighlight: (z: ZoneKind | null) => void;
  isMock: (key: string) => boolean;
}) {
  const a = whoPays.approval;
  const neutral = Math.max(0, 1 - a.support - a.oppose);
  const itemsMock = isMock("whoPays.items");
  return (
    <div className="stack-md">
      <ul className={`list stack-xs ${itemsMock ? "is-mock-section" : ""}`}>
        {whoPays.items.map((i) => {
          const zone = i.zone;
          const on = !!zone && highlightZone === zone;
          return (
            <li key={i.key}>
              {zone ? (
                <button className="card" aria-pressed={on} onClick={() => onHighlight(on ? null : zone)}>
                  <strong>{statement(i)}</strong>
                  <span className="item-go">{on ? "Hide on map" : "Show on map"}</span>
                </button>
              ) : (
                <div className="card card-static">
                  <strong>{statement(i)}</strong>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className={`stack-sm ${isMock("whoPays.approval") ? "is-mock-section" : ""}`}>
        <div className="eyebrow">
          Would residents support it? <MockTag show={isMock("whoPays.approval")} />
        </div>
        <div className="bar">
          <i className="bar-gain" style={{ width: pct(a.support) }} />
          <i className="bar-neutral" style={{ width: pct(neutral) }} />
          <i className="bar-loss" style={{ width: pct(a.oppose) }} />
        </div>
        <p className="small">
          {pct(a.support)} for, {pct(neutral)} undecided, {pct(a.oppose)} against
        </p>
        <p className="small muted">Estimated for {a.basis.toLocaleString("en-US")} simulated residents</p>
      </div>
    </div>
  );
}
