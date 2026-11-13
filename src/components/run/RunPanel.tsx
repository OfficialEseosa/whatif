"use client";
/**
 * Run log drawn as a route line (like the logo): one stop per Build-it step, joined by a line that
 * fills in as steps finish. Each stop has a title, one plain line of real result, and its real
 * duration. Collapses to a small bar shortly after a run finishes; click to reopen.
 * Shows the active entry of store.runs (selectActiveRun). Sits in Console's .run-slot.
 */
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { cancelRun, useBuildFlow } from "@/hooks/useBuildFlow";
import { selectActiveRun, useStore, type PipelineStep, type RunRecord } from "@/lib/store";
import { ChevronDownIcon } from "../icons";
import { focusComposer } from "../uiStore";
import { EditBody, PlanBody, RouteBody, ScoreBody, StopsBody } from "./StepBodies";
import { SOURCE_WORDS, editLine, fmtDur, notSimulatedText, planLine, routeLine, scoreLine, sourceKind, stepLabel } from "./runFormat";
import "./run.css";

/** How long a finished run stays open before it folds into the bar. */
const HOLD_MS = 1500;
const SLOW_MS = 30_000;

/** performance.now(), refreshed every 100 ms while `active`; one timer for the whole panel. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(performance.now());
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, 100);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [active]);
  return now;
}

const stepMs = (p: PipelineStep, now: number) => (p.startedAt === undefined ? 0 : (p.endedAt ?? Math.max(now, p.startedAt)) - p.startedAt);
const isDone = (p: PipelineStep) => p.status === "done" || p.status === "warn";

export function RunPanel() {
  const run = useStore(selectActiveRun);
  const build = useBuildFlow();
  const running = !!run && run.endedAt === null;
  const now = useNow(running);
  // Folded when the user chose so, or automatically HOLD_MS after a clean finish. Keyed by run id.
  const [folded, setFolded] = useState<{ id: number; v: boolean } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const id = run?.id ?? 0;
  const finishedClean = !!run && run.endedAt !== null && !run.error;

  useEffect(() => {
    if (!finishedClean) return;
    const t = setTimeout(() => setFolded((f) => (f?.id === id ? f : { id, v: true })), HOLD_MS);
    return () => clearTimeout(t);
  }, [finishedClean, id]);

  if (!run) return null;
  const steps = run.steps;
  const isFolded = folded?.id === id && folded.v;
  const fold = (v: boolean) => setFolded({ id, v });
  const total = (run.endedAt ?? Math.max(now, run.startedAt)) - run.startedAt;
  const failed = steps.find((p) => p.status === "error");
  const title = run.edit?.name ?? run.result?.title ?? "Reading your plan";
  const src = run.result ? sourceKind(run.result) : null;
  const sub = failed
    ? run.cancelled
      ? "Cancelled"
      : `Stopped while ${stepLabel(failed).toLowerCase()}`
    : running
      ? `Step ${Math.min(steps.length, steps.filter(isDone).length + 1)} of ${steps.length}, ${fmtDur(total, true)}`
      : run.notSimulated
        ? "Could not be tested"
        : `Done in ${fmtDur(total) || "0.0 s"}`;
  const state = failed ? "error" : running ? "running" : "done";

  if (isFolded)
    return (
      <div className="rp">
        <button className="rp-bar" onClick={() => fold(false)} aria-expanded={false} aria-label={`${title}. ${sub}. Show the steps`}>
          <span className={`rp-node is-${state === "done" ? "end" : state === "error" ? "error" : "active"}`} aria-hidden="true" />
          <span className="rp-bar-text">
            <span className="rp-bar-title">{title}</span>
            {run.prompt && (
              <span className="rp-bar-prompt" title={run.prompt.text}>
                “{run.prompt.text}”
              </span>
            )}
            <span className="rp-bar-sub">
              {sub}
              {src && <span className={src === "mock" ? "rp-amber" : undefined}>, {SOURCE_WORDS[src]}</span>}
            </span>
          </span>
          <ChevronDownIcon />
        </button>
      </div>
    );

  const toggle = (p: PipelineStep, now: boolean) => setOpen((o) => ({ ...o, [`${id}:${p.id}`]: !now }));
  const isOpen = (p: PipelineStep) => !!open[`${id}:${p.id}`];

  return (
    <section className="rp" aria-label="Progress">
      <div className="rp-card">
        <header className="rp-head">
          <div className="rp-head-text">
            <h2 className="rp-title">{title}</h2>
            {run.prompt && <PromptQuote key={run.id} text={run.prompt.text} />}
            <p className={`rp-sub${failed ? " is-error" : ""}`}>
              {sub}
            </p>
          </div>
          <button className="rp-close" onClick={() => fold(true)} aria-label="Hide the steps" title="Hide the steps">
            <span className="rp-flip"><ChevronDownIcon /></span>
          </button>
          <p className="rp-sr" aria-live="polite">
            {failed ? `${stepLabel(failed)} failed` : (steps.map((p) => (p.status === "active" ? stepLabel(p) : null)).find(Boolean) ?? (running ? "" : "Done"))}
          </p>
        </header>
        <ol className="rp-route">
          {steps.map((p, i) => {
            const last = i === steps.length - 1;
            const end = last && isDone(p) && !running;
            const detail = detailFor(p, run);
            const expanded = detail !== null && isOpen(p);
            return (
              <li key={p.id} className={`rp-step is-${isDone(p) ? "done" : p.status}${end ? " is-end" : ""}`}>
                {!last && (
                  <span className="rp-seg" aria-hidden="true">
                    <span className="rp-seg-fill" />
                  </span>
                )}
                <span className={`rp-node is-${end ? "end" : isDone(p) ? "done" : p.status}`} aria-hidden="true" />
                <div className="rp-step-body">
                  <button
                    className="rp-step-head"
                    onClick={() => detail && toggle(p, expanded)}
                    disabled={!detail}
                    aria-expanded={detail ? expanded : undefined}
                  >
                    <span className="rp-step-title">{stepLabel(p)}</span>
                    <span className="rp-time">{p.startedAt === undefined ? "" : fmtDur(stepMs(p, now), p.status === "active")}</span>
                  </button>
                  <StepLine step={p} run={run} elapsed={stepMs(p, now)} onRetry={() => build(run.overrideEdit ?? undefined, run.previousEdit ? { previousEdit: run.previousEdit } : undefined)} />
                  {expanded && <div className="rp-detail">{detail}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** Expandable detail for a finished step, or null when there is nothing more to show. */
function detailFor(p: PipelineStep, run: RunRecord): ReactNode | null {
  if (!isDone(p)) return null;
  const e = run.edit;
  switch (p.id) {
    case "plan":
      return e && (e.assumptions?.length || run.claims?.length) ? <PlanBody run={run} /> : null;
    case "stops":
      return e?.stops.length ? <StopsBody run={run} /> : null;
    case "edit":
      return e && (e.roadIds?.length || e.stops.length > 1 || e.chargeZone) ? <EditBody run={run} /> : null;
    case "route":
      return run.result ? <RouteBody run={run} /> : null;
    case "score":
      return run.result ? <ScoreBody run={run} /> : null;
    default:
      return null;
  }
}

/** The one line of result under a stop's title. */
function StepLine({ step, run, elapsed, onRetry }: { step: PipelineStep; run: RunRecord; elapsed: number; onRetry: () => void }) {
  const network = useStore((s) => s.network);
  const population = useStore((s) => s.preview?.metrics.baseline.populationModeled);
  const e = run.edit;
  const r = run.result;

  if (step.status === "pending") return null;
  if (step.status === "error") {
    const head = run.cancelled
      ? "Cancelled. Any late result will be ignored."
      : step.id === "plan"
        ? "Couldn't read this plan."
        : step.id === "route"
          ? "Couldn't run the simulation."
          : "This step failed.";
    const detail = run.cancelled ? null : run.error?.message.replace(/^\/[\w/.-]+:\s*/, "");
    return (
      <div className="rp-line-block">
        <div>
          <p className="rp-line is-error">{head}</p>
          {detail && <p className="rp-line rp-small">{detail}</p>}
        </div>
        <div className="rp-actions">
          <button className="rp-btn is-primary" onClick={onRetry}>
            Try again
          </button>
          {step.id === "plan" && !run.overrideEdit && (
            <button className="rp-btn" onClick={focusComposer}>
              Change my plan
            </button>
          )}
        </div>
      </div>
    );
  }

  const active = step.status === "active";
  switch (step.id) {
    case "plan":
      if (active) return <p className="rp-line">{run.overrideEdit ? "Loading the suggested option" : "Working out what you asked for"}</p>;
      return (
        <>
          {run.previousEdit && <p className="rp-line">Changing {run.previousEdit.name}</p>}
          {e && <p className="rp-line">{planLine(e)}</p>}
          {run.planSource === "alternative" && <p className="rp-line">From a suggested option</p>}
          {run.planSource === "restored" && <p className="rp-line">Reopened from earlier</p>}
        </>
      );
    case "stops":
      if (!e) return null;
      if (!e.stops.length) return <p className="rp-line">No new stops</p>;
      return (
        <p className={`rp-line${run.stopProblems.length ? " rp-amber" : ""}`}>
          {e.stops.length - countBad(run)} of {e.stops.length} stops found on the map
        </p>
      );
    case "edit":
      return e ? <p className="rp-line">{editLine(e, network)}</p> : null;
    case "route":
      if (active)
        return (
          <div className="rp-line-block">
            <p className="rp-line">{population ? `Simulating the morning commute for ${population.toLocaleString("en-US")} people` : "Simulating the morning commute"}</p>
            {elapsed > SLOW_MS && (
              <div className="rp-actions">
                <span className="rp-line">This is taking longer than usual.</span>
                <button className="rp-btn" onClick={cancelRun}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      if (!r) {
        if (!run.notSimulated) return null;
        const why = notSimulatedText(run);
        return (
          <>
            <p className="rp-line">Not tested. {why.reason}</p>
            {why.detail && <p className="rp-line rp-small">{why.detail}</p>}
          </>
        );
      }
      return (
        <>
          <p className="rp-line">{routeLine(r)}</p>
          {sourceKind(r) === "mock" && <p className="rp-line rp-amber">Sample numbers, not a real simulation</p>}
        </>
      );
    case "score":
      return r ? <p className="rp-line">{scoreLine(r)}</p> : null;
    case "draw":
      return active ? <DrawProgress /> : <p className="rp-line">Shown on the map</p>;
    default:
      return null;
  }
}

const countBad = (run: RunRecord) => new Set(run.stopProblems.map((x) => /stop "(.*?)"/.exec(x)?.[1])).size;

/**
 * "Drawing the line" / "Showing who switches to transit" with a thin bar. Updated through a ref from a store
 * subscription, so the line animation does not re-render React every frame.
 */
const DrawProgress = memo(function DrawProgress() {
  const fill = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<"line" | "switch">(() => (useStore.getState().lineProgress < 1 ? "line" : "switch"));
  useEffect(() => {
    const apply = (line: number, sw: number) => {
      if (fill.current) fill.current.style.transform = `scaleX(${line < 1 ? line : sw})`;
      setPhase(line < 1 ? "line" : "switch"); // no-op unless it changes
    };
    const s = useStore.getState();
    apply(s.lineProgress, s.switchProgress);
    return useStore.subscribe((st, prev) => {
      if (st.lineProgress !== prev.lineProgress || st.switchProgress !== prev.switchProgress) apply(st.lineProgress, st.switchProgress);
    });
  }, []);
  return (
    <div className="rp-line-block">
      <p className="rp-line">{phase === "line" ? "Drawing the line" : "Showing who switches to transit"}</p>
      <span className="rp-progress" aria-hidden="true">
        <span ref={fill} className="rp-progress-fill" />
      </span>
    </div>
  );
});

/** What the user typed, quoted under the plan name: up to 3 lines, expandable for long text. */
function PromptQuote({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > 140 || text.split("\n").length > 3;
  return (
    <div className="rp-prompt">
      <p className={`rp-prompt-text${all || !long ? "" : " is-clamped"}`}>“{text.trim()}”</p>
      {long && (
        <button className="rp-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
