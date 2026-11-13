"use client";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import type { PlanMode } from "@/lib/contract";
import { SUGGESTIONS, useStore } from "@/lib/store";

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
    <section className="panel command" aria-label="Plan input">
      <div className="row gap-sm" role="group" aria-label="Input type">
        {MODES.map((m) => (
          <button key={m.id} className="btn btn-toggle" aria-pressed={mode === m.id} onClick={() => setInputMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <form
        className="row gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          build();
        }}
      >
        <textarea
          className="input grow"
          aria-label="Your plan"
          rows={mode === "article" ? 4 : 1}
          value={text}
          onChange={(e) => set({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && mode !== "article") {
              e.preventDefault();
              build();
            }
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? "Working…" : current.button}
        </button>
      </form>
      {mode === "prompt" && (
        <div className="row gap-sm wrap">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn btn-chip" onClick={() => set({ text: s })}>
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
