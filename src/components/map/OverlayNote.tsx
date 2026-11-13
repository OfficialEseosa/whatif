"use client";
import { useStore } from "@/lib/store";
import { CloseIcon } from "../icons";
import { LookaheadCard } from "../results/LookaheadCard";
import { isMockSection } from "@/lib/provenance";

/** Note floating over the map: active history card, or the look-ahead when a horizon is selected. */
export function OverlayNote() {
  const event = useStore((s) => s.history.find((h) => h.id === s.activeHistoryId) ?? null);
  const horizon = useStore((s) => s.horizon);
  const scenario = useStore((s) => s.scenario);
  const lookahead = scenario?.lookahead;
  const { set, toggleHistory } = useStore.getState();
  if (horizon !== "opening" && lookahead) {
    return (
      <div className="note surface">
        <button className="icon-btn icon-btn-sm note-close" aria-label="Back to opening day" onClick={() => set({ horizon: "opening" })}>
          <CloseIcon />
        </button>
        <LookaheadCard lookahead={lookahead} horizon={horizon} mock={isMockSection(scenario, "lookahead")} />
      </div>
    );
  }
  if (!event) return null;
  return (
    <div className="note note-history surface">
      <button className="icon-btn icon-btn-sm note-close" aria-label="Hide this overlay" onClick={() => toggleHistory(event.id)}>
        <CloseIcon />
      </button>
      <span className="note-year mono">{event.yearLabel}</span>
      <strong>{event.title}</strong>
      <p className="small">{event.note}</p>
    </div>
  );
}
