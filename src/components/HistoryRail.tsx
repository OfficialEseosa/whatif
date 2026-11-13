"use client";
import { useStore } from "@/lib/store";

/** Timeline of cited events; choosing one draws its overlay on the map. */
export function HistoryRail() {
  const history = useStore((s) => s.history);
  const active = useStore((s) => s.activeHistoryId);
  const toggle = useStore((s) => s.toggleHistory);
  return (
    <ol className="scroll list timeline">
      {history.map((e) => (
        <li key={e.id} className="timeline-item" data-active={active === e.id}>
          <button className="timeline-btn" aria-pressed={active === e.id} onClick={() => toggle(e.id)}>
            <span className="timeline-year mono">{e.yearLabel}</span>
            <strong>{e.title}</strong>
            <span className="small timeline-body">{e.body}</span>
          </button>
          <p className="small muted timeline-source">
            Source: {e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.source}</a> : e.source}
            {!e.verified && <span className="badge badge-verify">Unverified</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}
