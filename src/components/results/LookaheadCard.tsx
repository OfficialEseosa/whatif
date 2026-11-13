import type { Lookahead } from "@/lib/contract";
import { MockTag } from "../MockTag";

export function LookaheadCard({ lookahead, horizon, mock }: { lookahead: Lookahead; horizon: "year5" | "year10"; mock: boolean }) {
  const h = lookahead[horizon];
  const last = lookahead.lastTime;
  return (
    <div className={`ahead ${mock ? "is-mock-section" : ""}`}>
      <p className="ahead-head">
        <span className="num ahead-range">
          {h.householdsAtRisk.low.toLocaleString("en-US")}–{h.householdsAtRisk.high.toLocaleString("en-US")}
        </span>{" "}
        renter households may be priced out
        <MockTag show={mock} what="the look-ahead" />
      </p>
      <p className="note-text">{h.note}</p>
      <div className="ahead-last">
        <span className="label">
          What happened before: {last.title}, {last.period}
        </span>
        <ul className="list">
          {last.stats.map((s) => (
            <li key={s.label}>
              {s.label}: <span className="num">{s.value}</span> <span className="muted">({s.source})</span>
              {!s.verified && <span className="quiet-tag">Not confirmed</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
