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
          <button className="timeline-btn" aria-pressed={active === e.id} title={active === e.id ? "Hide this from the map" : "Show this on the map"} onClick={() => toggle(e.id)}>
            <span className="timeline-year num">{e.yearLabel}</span>
            <span className="timeline-title">{e.title}</span>
            <span className="timeline-body">{e.body}</span>
            <span className="timeline-state">{active === e.id ? "Showing on map. Click to hide" : "Show on map"}</span>
          </button>
          <p className="timeline-source">
            {e.sourceUrl ? (
              <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                {e.source}
              </a>
            ) : (
              e.source
            )}
            {!e.verified && (
              <span className="quiet-tag" title="We have not yet confirmed this against the source">Source not yet checked</span>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
