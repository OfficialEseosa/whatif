"use client";
import { useStore } from "@/lib/store";
import { LookaheadCard } from "../results/LookaheadCard";

/** Note floating over the map: active history card, or the look-ahead when a horizon is selected. */
export function OverlayNote() {
  const event = useStore((s) => s.history.find((h) => h.id === s.activeHistoryId) ?? null);
  const horizon = useStore((s) => s.horizon);
  const lookahead = useStore((s) => s.scenario?.lookahead);
  if (horizon !== "opening" && lookahead) {
    return (
      <div className="map-ui map-ui-br panel-float note">
        <LookaheadCard lookahead={lookahead} horizon={horizon} />
      </div>
    );
  }
  if (!event) return null;
  return (
    <div className="map-ui map-ui-br panel-float note">
      <strong>
        {event.yearLabel} · {event.title}
      </strong>
      <p className="small">{event.note}</p>
    </div>
  );
}
