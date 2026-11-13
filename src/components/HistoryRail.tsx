"use client";
import { useStore } from "@/lib/store";

export function HistoryRail() {
  const history = useStore((s) => s.history);
  const active = useStore((s) => s.activeHistoryId);
  const toggle = useStore((s) => s.toggleHistory);
  return (
    <aside className="panel rail" aria-label="History">
      <div className="panel-head">
        <div className="eyebrow">History layer</div>
        <h2 className="h2">Why does MARTA end where it does?</h2>
      </div>
      <ol className="scroll list">
        {history.map((e) => (
          <li key={e.id}>
            <button className="history-card" aria-pressed={active === e.id} onClick={() => toggle(e.id)}>
              <span className="mono muted">{e.yearLabel}</span>
              <strong>{e.title}</strong>
              <span className="small">{e.body}</span>
              <span className="small muted">
                Source: {e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.source}</a> : e.source}
                {!e.verified && <span className="badge badge-verify">unverified</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
