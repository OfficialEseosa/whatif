"use client";
import { useEffect, useRef, useState } from "react";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import { detectMode, MODE_ACTION } from "@/lib/detectMode";
import type { PlanMode } from "@/lib/contract";
import { DEFAULT_TEXT, selectActiveRun, useStore } from "@/lib/store";
import { ArrowUpIcon, CloseIcon, EditIcon, PlusIcon } from "./icons";
import { TimeScrubber } from "./TimeScrubber";
import { editEntry, focusComposer, loadSession, newPlan, persistSession, recordRun, restoreEntry, useUi, type SessionEntry } from "./uiStore";

/** Example inputs: a couple of plans, a sample article, a problem. Clicking fills the box (never submits). */
const EXAMPLES: { label: string; text: string }[] = [
  { label: "Streetcar to Ponce City Market", text: "extend the streetcar along the Beltline to Ponce City Market" },
  { label: "Bus lane on Ponce", text: "add bus rapid transit on Ponce de Leon Ave and take one car lane" },
  { label: "Paste a news story", text: DEFAULT_TEXT.article },
  { label: "Eastside, no rent spike", text: DEFAULT_TEXT.fix },
];

const BUSY = new Set(["planning", "simulating", "building"]);
const VERDICT_GRADE = { good: "good", mixed: "fair", poor: "poor" } as const;

/** Bottom-centre prompt: one box for a plan, a pasted article, or a problem to fix. */
export function Composer() {
  const text = useStore((s) => s.text);
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const built = useStore((s) => s.scenario !== null);
  const lastPrompt = useUi((s) => s.lastPrompt);
  const hasSession = useUi((s) => s.session.length > 0);
  const hasRun = useStore((s) => s.activeRunId !== null);
  const setUi = useUi((s) => s.setUi);
  const build = useBuildFlow();
  const ref = useRef<HTMLTextAreaElement>(null);

  const busy = BUSY.has(phase);
  const mode = detectMode(text);
  const multiline = text.includes("\n") || mode === "article";
  // Examples show on first load and whenever the empty box is focused; typing or a result hides them.
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const showChips = !busy && !built && !hasSession && !text.trim() && (focused || !touched);

  // Start empty: the store seeds a demo prompt, but an empty box shows the placeholder and the examples.
  useEffect(() => {
    const s = useStore.getState();
    if (s.phase === "idle" && s.text === DEFAULT_TEXT.prompt) s.set({ text: "" });
  }, []);

  // Each finished run (simulated or only previewed) joins the session thread, kept in sessionStorage.
  useEffect(() => {
    loadSession();
    const unPersist = persistSession();
    const unRecord = useStore.subscribe((s, prev) => {
      if (s.phase !== "done" || prev.phase === "done" || !BUSY.has(prev.phase)) return;
      const run = selectActiveRun(s);
      if (run) recordRun(run, s.scenario);
    });
    return () => {
      unPersist();
      unRecord();
    };
  }, []);

  // "/" focuses the box from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || t.isContentEditable)) return;
      e.preventDefault();
      focusComposer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    const m = detectMode(value);
    const s = useStore.getState();
    s.set({ inputMode: m });
    setUi({ lastPrompt: value, pending: { text: value, mode: m }, popover: null });
    ref.current?.blur();
    // A follow-up modifies the plan on screen; a pasted article starts a new one.
    const shown = s.scenario?.edit ?? s.runs.find((r) => r.id === s.activeRunId)?.edit ?? undefined;
    const previousEdit = shown && m !== "article" ? shown : undefined;
    build(undefined, previousEdit ? { previousEdit } : undefined);
  };
  const fill = (value: string) => {
    useStore.getState().set({ text: value });
    // Focus now so Enter right after a chip click runs it; place the caret once React has rendered the text.
    ref.current?.focus();
    requestAnimationFrame(focusComposer);
  };

  return (
    <div className="dock" data-state={busy ? "running" : built ? "result" : "idle"}>
      {/* A run's own failure is shown in the run panel; this banner is for anything else. */}
      {error && !busy && !hasRun && (
        <p className="surface dock-error" role="alert">
          <span className="grow">{error === "Cancelled" ? "Run cancelled." : `Run failed. ${error}`}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => useStore.getState().set({ error: null })}>
            <CloseIcon />
          </button>
        </p>
      )}

      {hasSession && !busy && <Breadcrumb />}

      {showChips && (
        <ul className="list examples" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <li key={ex.label}>
              <button className="example" onMouseDown={(e) => e.preventDefault()} onClick={() => fill(ex.text)}>
                {ex.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="surface composer"
        data-multiline={multiline}
        data-chips={showChips}
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {busy && <RunProgress />}
        <textarea
          id="composer-input"
          ref={ref}
          className="composer-input"
          aria-label={built ? "Change the plan" : "Describe a transit plan, paste an article, or name a problem"}
          placeholder={built ? "Change the plan" : "Describe a transit plan for Atlanta"}
          rows={1}
          value={text}
          readOnly={busy}
          onChange={(e) => useStore.getState().set({ text: e.target.value })}
          onFocus={() => {
            setFocused(true);
            setTouched(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.currentTarget.blur();
            } else if (e.key === "ArrowUp" && !text) {
              // Recall the last prompt (or the newest in the session list after a refresh).
              const recall = lastPrompt || [...useUi.getState().session].reverse().find((x) => x.mode !== "alternative")?.text;
              if (!recall) return;
              e.preventDefault();
              useStore.getState().set({ text: recall });
            }
          }}
        />
        <div className="composer-side">
          <button className="btn-run" type="submit" disabled={busy || !text.trim()} aria-label={busy ? "Running" : "Run plan"} title={busy ? undefined : MODE_ACTION[mode]}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <ArrowUpIcon />}
          </button>
        </div>
      </form>

      <TimeScrubber />
    </div>
  );
}

/** Earlier prompts in this session: click one to show its result again, or Edit to put its text back in the box. */
function Breadcrumb() {
  const session = useUi((s) => s.session);
  const active = useUi((s) => s.activeEntry);
  const build = useBuildFlow();
  const rerun = (edit: SessionEntry["edit"], restore: { text: string; mode: PlanMode }) => build(edit, { restore });
  return (
    <div className="crumbs">
      {session.length > 0 && (
        <ol className="list crumb-list" aria-label="Earlier prompts">
          {session.map((e) => (
            <li key={e.n} className="rp-crumb">
              <button className="crumb" aria-pressed={e.n === active} onClick={() => restoreEntry(e, rerun)} title={`${e.text} (${e.title})`}>
                <i className={e.verdict ? `dot grade-bg-${VERDICT_GRADE[e.verdict]}` : "dot rp-dot-plan"} aria-hidden="true" />
                <span className="crumb-text">{e.text}</span>
              </button>
              {e.mode !== "alternative" && (
                <button className="rp-crumb-edit" aria-label={`Edit: ${e.text}`} title="Edit this prompt" onClick={() => editEntry(e)}>
                  <EditIcon />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <button className="btn" onClick={newPlan}>
        <PlusIcon />
        New plan
      </button>
    </div>
  );
}

/** Progress line on the composer's top edge, with the current step. */
function RunProgress() {
  const phase = useStore((s) => s.phase);
  const steps = useStore((s) => s.pipeline);
  const people = useStore((s) => (s.preview ?? s.scenario)?.metrics.baseline.populationModeled);
  const finished = steps.filter((p) => p.status !== "pending" && p.status !== "active").length;
  const k = steps.length ? Math.max(0.05, finished / steps.length) : 0.05;
  const label = phase === "planning" ? "Reading the plan" : phase === "simulating" ? `Simulating ${people ? people.toLocaleString("en-US") : "270,000"} commuters` : "Drawing the line";
  return (
    <div className="run-progress" role="status" aria-live="polite">
      <i className="run-bar" style={{ transform: `scaleX(${k})` }} />
      <span className="run-step">{label}</span>
    </div>
  );
}
