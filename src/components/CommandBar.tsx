"use client";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import type { PlanMode } from "@/lib/contract";
import { SUGGESTIONS, useStore } from "@/lib/store";
import { SearchIcon } from "./icons";

const MODES: { id: PlanMode; label: string; button: string }[] = [
  { id: "prompt", label: "What if…", button: "Build it" },
  { id: "article", label: "Paste an article", button: "Check this plan" },
  { id: "fix", label: "Fix a problem", button: "Find options" },
];

export function CommandBar() {
  const mode = useStore((s) => s.inputMode);
  const text = useStore((s) => s.text);
  const phase = useStore((s) => s.phase);
  const { set, setInputMode } = useStore.getState();
  const build = useBuildFlow();
  const busy = phase === "planning" || phase === "simulating" || phase === "building";
  const current = MODES.find((m) => m.id === mode)!;

  return (
    <section className="search surface" aria-label="Plan input">
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          build();
        }}
      >
        <span className="search-icon">
          <SearchIcon />
        </span>
        <textarea
          className="search-input"
          aria-label="Your plan"
          rows={mode === "article" ? 5 : 1}
          value={text}
          onChange={(e) => set({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && mode !== "article") {
              e.preventDefault();
              build();
            }
          }}
        />
        <button className="btn-go" type="submit" disabled={busy || !text.trim()}>
          {busy ? "Working…" : current.button}
        </button>
      </form>
      <div className="seg search-modes" role="group" aria-label="Input type">
        {MODES.map((m) => (
          <button key={m.id} className="seg-btn" aria-pressed={mode === m.id} onClick={() => setInputMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "prompt" && (
        <ul className="search-suggest list">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button className="suggest" onClick={() => set({ text: s })}>
                <SearchIcon />
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
