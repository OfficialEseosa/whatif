"use client";
import { isMockSection } from "@/lib/provenance";
import { useStore } from "@/lib/store";
import { CloseIcon } from "./icons";
import { LookaheadCard } from "./results/LookaheadCard";

/** Callout pinned at the top of the map: the look-ahead when Year 5/10 is on, else the active history event. */
export function MapNote() {
  const event = useStore((s) => s.history.find((h) => h.id === s.activeHistoryId) ?? null);
  const horizon = useStore((s) => s.horizon);
  const scenario = useStore((s) => s.scenario);
  const lookahead = scenario?.lookahead;
  const { set, toggleHistory } = useStore.getState();

  if (horizon !== "opening" && lookahead) {
    return (
      <div className="note note-ahead" role="region" aria-label="Look-ahead">
        <span className="note-tag note-tag-ahead">{horizon === "year5" ? "Year 5" : "Year 10"}</span>
        <div className="note-body">
          <LookaheadCard lookahead={lookahead} horizon={horizon} mock={isMockSection(scenario, "lookahead")} />
        </div>
        <button className="icon-btn note-close" aria-label="Back to opening day" onClick={() => set({ horizon: "opening" })}>
          <CloseIcon />
        </button>
      </div>
    );
  }
  if (!event) return null;
  return (
    <div className="note note-history" role="region" aria-label="History overlay">
      <span className="note-tag">{event.yearLabel}</span>
      <div className="note-body">
        <strong className="note-title">{event.title}</strong>
        <p className="note-text">{event.note}</p>
      </div>
      <button className="icon-btn note-close" aria-label="Hide this overlay" onClick={() => toggleHistory(event.id)}>
        <CloseIcon />
      </button>
    </div>
  );
}
