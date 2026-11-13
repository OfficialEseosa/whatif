import type { WhoPays, ZoneKind } from "@/lib/contract";
import { formatValue, pct, pct1 } from "@/lib/format";
import { MockTag } from "../MockTag";

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
      <ul className={`list stack-sm ${itemsMock ? "is-mock-section" : ""}`}>
        {whoPays.items.map((i) => (
          <li key={i.key}>
            <button
              className="card"
              aria-pressed={!!i.zone && highlightZone === i.zone}
              onClick={() => onHighlight(i.zone && highlightZone !== i.zone ? i.zone : null)}
            >
              <span className="row">
                <strong className="grow">{i.label}</strong>
                <span className="mono tone-loss">{formatValue(i.value, i.unit)}</span>
              </span>
              <span className="small muted">{i.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={`stack-sm ${isMock("whoPays.approval") ? "is-mock-section" : ""}`}>
        <div className="eyebrow">
          Approval from {a.basis.toLocaleString("en-US")} stake scores <MockTag show={isMock("whoPays.approval")} />
        </div>
        <div className="bar">
          <i className="bar-gain" style={{ width: pct(a.support) }} />
          <i className="bar-neutral" style={{ width: pct(neutral) }} />
          <i className="bar-loss" style={{ width: pct(a.oppose) }} />
        </div>
        <p className="small">
          {pct1(a.support)} support · {pct1(neutral)} neutral · {pct1(a.oppose)} oppose. <span className="muted">{a.note}</span>
        </p>
      </div>
    </div>
  );
}
