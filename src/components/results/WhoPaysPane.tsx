import type { WhoPays, ZoneKind } from "@/lib/contract";
import { formatValue, pct } from "@/lib/format";

export function WhoPaysPane({
  whoPays,
  highlightZone,
  onHighlight,
}: {
  whoPays: WhoPays;
  highlightZone: ZoneKind | null;
  onHighlight: (z: ZoneKind | null) => void;
}) {
  const a = whoPays.approval;
  return (
    <div className="stack-md">
      <ul className="list stack-sm">
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
      <div className="stack-sm">
        <h3 className="eyebrow">Approval from {a.basis.toLocaleString("en-US")} stake scores</h3>
        <div className="bar">
          <i className="bar-gain" style={{ width: pct(a.support) }} />
          <i className="bar-loss" style={{ width: pct(a.oppose) }} />
        </div>
        <p className="small">
          {pct(a.support)} support, {pct(a.oppose)} oppose. <span className="muted">{a.note}</span>
        </p>
      </div>
    </div>
  );
}
