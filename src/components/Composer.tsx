"use client";
import { useEffect, useRef, useState } from "react";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import { detectMode, MODE_ACTION } from "@/lib/detectMode";
import type { PlanMode, ScenarioEdit } from "@/lib/contract";
import { DEFAULT_TEXT, selectActiveRun, useStore } from "@/lib/store";
import { ArrowUpIcon, ChevronDownIcon, CloseIcon, EditIcon, PlusIcon } from "./icons";
import { TimeScrubber } from "./TimeScrubber";
import "./firstrun.css";
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
const VERDICT_WORD = { good: "Good plan", mixed: "Mixed plan", poor: "Poor plan" } as const;

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
  // Before the first run the dock says what the site does; examples stay visible until something is typed.
  const firstRun = !busy && !built && !hasSession && !hasRun;
  const showChips = firstRun && !text.trim();

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

  const submit = (typed: string = text) => {
    const value = typed.trim();
    if (!value || busy) return;
    if (value !== text) useStore.getState().set({ text: value });
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
          <span className="grow">
            {error === "Cancelled" ? "Run cancelled." : `That did not run. ${error}`} <span className="fr-error-next">Press Simulate to try again, or reword the plan.</span>
          </span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => useStore.getState().set({ error: null })}>
            <CloseIcon />
          </button>
        </p>
      )}

      {!busy && (hasSession || hasRun) && <PlanBar />}
      {!busy && built && <FollowUps onPick={submit} />}

      {firstRun && (
        <div className="surface fr-intro">
          <h1 className="fr-title">What if Atlanta changed its transit?</h1>
          <p className="fr-lead">Describe a change. See who it helps, who pays, and whether it is worth it.</p>
        </div>
      )}

      {showChips && (
        <div className="fr-try">
          <span className="fr-try-label" id="fr-try-label">
            Try one
          </span>
          <ul className="list examples" aria-labelledby="fr-try-label">
            {EXAMPLES.map((ex) => (
              <li key={ex.label}>
                <button type="button" className="example" onMouseDown={(e) => e.preventDefault()} onClick={() => fill(ex.text)}>
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
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
          aria-label={built ? "Ask for a change to this plan, or describe a new one" : "Describe a transit plan, paste an article, or name a problem"}
          placeholder={built ? "Ask for a change, or describe a new plan" : "Try: extend the streetcar to Ponce City Market"}
          rows={1}
          value={text}
          readOnly={busy}
          onChange={(e) => useStore.getState().set({ text: e.target.value })}
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
          <button className="btn-run fr-run" type="submit" disabled={busy || !text.trim()} aria-label={busy ? "Running" : undefined} title={busy ? undefined : MODE_ACTION[mode]}>
            {busy ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <>
                Simulate
                <ArrowUpIcon />
              </>
            )}
          </button>
        </div>
      </form>

      <TimeScrubber />
    </div>
  );
}

/** Follow-ups to offer when Claude's have not arrived: changes every plan of that kind can take. */
function defaultFollowUps(edit: ScenarioEdit): string[] {
  const often = edit.headwayMin === 5 ? "Run it every 10 minutes" : "Run it every 5 minutes";
  if (edit.type === "brt_lane") return [often, edit.lanesRemoved === 0 ? "Take one car lane" : "Keep all car lanes", "Make it a streetcar instead"];
  if (edit.type === "new_bus_route") return [often, "Give it its own bus lane", "Make it a streetcar instead"];
  if (edit.type === "new_rail_line" || edit.type === "extend_line") return [often, "Make it a bus lane instead"];
  return [];
}

/** Up to three one-click changes to the plan on screen. Claude writes them from the results; clicking one runs it. */
function FollowUps({ onPick }: { onPick: (text: string) => void }) {
  const edit = useStore((s) => s.scenario?.edit);
  const insight = useStore((s) => {
    const run = selectActiveRun(s);
    return run && run.result === s.scenario ? run.insight : null;
  });
  if (!edit) return null;
  const items = (insight?.followUps.length ? insight.followUps : defaultFollowUps(edit)).slice(0, 3);
  if (!items.length) return null;
  return (
    <ul className="list followups" aria-label="Changes to try">
      {items.map((f) => (
        <li key={f}>
          <button type="button" className="example" onClick={() => onPick(f)} title="Run this change">
            {f}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Above the box: which plan a follow-up changes, the earlier plans of this session, and a way to start over. */
function PlanBar() {
  const session = useUi((s) => s.session);
  const active = useUi((s) => s.activeEntry);
  const title = useStore((s) => s.scenario?.title ?? selectActiveRun(s)?.edit?.name ?? null);
  const build = useBuildFlow();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const rerun = (edit: SessionEntry["edit"], restore: { text: string; mode: PlanMode }) => build(edit, { restore });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="crumbs">
      {title && (
        <p className="surface fu-context" title={title}>
          <span className="fu-label">Follow up on</span>
          <span className="fu-title">{title}</span>
        </p>
      )}
      <div className="fu-actions">
        {session.length > 0 && (
          <div className="fu-menu" ref={menu}>
            <button className="btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
              Earlier plans
              <span className="fu-count">{session.length}</span>
              <ChevronDownIcon />
            </button>
            {open && (
              <ol className="surface list fu-list" aria-label="Earlier plans">
                {[...session].reverse().map((e) => (
                  <li key={e.n} className="fu-row">
                    <button
                      className="fu-entry"
                      aria-current={e.n === active}
                      onClick={() => {
                        setOpen(false);
                        restoreEntry(e, rerun);
                      }}
                    >
                      <i className={e.verdict ? `dot grade-bg-${VERDICT_GRADE[e.verdict]}` : "dot rp-dot-plan"} aria-hidden="true" />
                      <span className="fu-entry-text">
                        <span className="fu-entry-title">{e.title}</span>
                        <span className="fu-entry-prompt">
                          {e.verdict ? VERDICT_WORD[e.verdict] : "Not tested"}
                          {e.mode !== "alternative" && e.text !== e.title ? `, you asked: ${e.text}` : ""}
                        </span>
                      </span>
                    </button>
                    {e.mode !== "alternative" && (
                      <button
                        className="fu-edit"
                        aria-label={`Put this back in the box: ${e.text}`}
                        title="Put this prompt back in the box"
                        onClick={() => {
                          setOpen(false);
                          editEntry(e);
                        }}
                      >
                        <EditIcon />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {title && (
          <button className="btn" onClick={newPlan}>
            <PlusIcon />
            New plan
          </button>
        )}
      </div>
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
