import type { Lookahead } from "@/lib/contract";

export function LookaheadCard({ lookahead, horizon }: { lookahead: Lookahead; horizon: "year5" | "year10" }) {
  const h = lookahead[horizon];
  const last = lookahead.lastTime;
  return (
    <div className="stack-sm">
      <strong>
        {horizon === "year5" ? "Year 5" : "Year 10"}: {h.householdsAtRisk.low.toLocaleString("en-US")}–
        {h.householdsAtRisk.high.toLocaleString("en-US")} renter households at risk
      </strong>
      <p className="small muted">{h.note}</p>
      <div className="small">
        <div className="eyebrow">
          {last.title}, {last.period}
        </div>
        <ul className="list">
          {last.stats.map((s) => (
            <li key={s.label}>
              {s.label}: <span className="mono">{s.value}</span> <span className="muted">({s.source})</span>
              {!s.verified && <span className="badge badge-verify">unverified</span>}
            </li>
          ))}
        </ul>
        <p className="muted">{last.note}</p>
      </div>
    </div>
  );
}
