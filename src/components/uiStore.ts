/**
 * Chrome-only UI state (which panels are open, which results tab) and the session thread. Kept apart
 * from src/lib/store.ts so layout changes never touch the data store other lanes edit.
 */
import { create } from "zustand";
import type { PlanMode, ScenarioResult, ScenarioSource } from "@/lib/contract";
import { scenarioSource } from "@/lib/provenance";
import { INITIAL_CAMERA, useStore } from "@/lib/store";

export type UiTab = "impact" | "whoPays" | "townHall" | "claims" | "better";

/** One submitted prompt and what came back. Results stay in memory for this tab only. */
export type SessionEntry = {
  n: number;
  /** The run panel's record of this run (store.runs), if it is still kept. */
  runId: number | null;
  text: string;
  mode: PlanMode | "alternative";
  title: string;
  verdict: ScenarioResult["verdict"]["label"];
  source: ScenarioSource;
  scenario: ScenarioResult;
};

type Ui = {
  /** Which on-demand surface is open (one at a time keeps the map clear). */
  popover: "layers" | "history" | null;
  /** Results card expanded past the five tests. */
  details: boolean;
  /** Morning-rush time strip under the prompt (opens itself when a run finishes). */
  timeOpen: boolean;
  tab: UiTab;
  /** Last submitted input, recalled with Up in an empty composer. */
  lastPrompt: string;
  /** What was submitted for the run in flight (null for an alternative's re-run). */
  pending: { text: string; mode: PlanMode } | null;
  session: SessionEntry[];
  /** `n` of the entry shown on the map and panels. */
  activeEntry: number | null;
  setUi: (patch: Partial<Omit<Ui, "setUi">>) => void;
};

export const useUi = create<Ui>((set) => ({
  popover: null,
  details: false,
  timeOpen: false,
  tab: "impact",
  lastPrompt: "",
  pending: null,
  session: [],
  activeEntry: null,
  setUi: (patch) => set(patch),
}));

/** Focus the composer from anywhere (the `/` shortcut, example cards). */
export function focusComposer() {
  const el = document.getElementById("composer-input") as HTMLTextAreaElement | null;
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

/** Called when a run finishes: append it to the session thread and empty the box for a follow-up. */
export function recordRun(scenario: ScenarioResult) {
  const { session, pending, setUi } = useUi.getState();
  const n = (session.at(-1)?.n ?? 0) + 1;
  const entry: SessionEntry = {
    n,
    runId: useStore.getState().activeRunId,
    text: pending?.text ?? scenario.title,
    mode: pending?.mode ?? "alternative",
    title: scenario.title,
    verdict: scenario.verdict.label,
    source: scenarioSource(scenario),
    scenario,
  };
  setUi({ session: [...session, entry].slice(-12), activeEntry: n, pending: null, timeOpen: true });
  if (pending) useStore.getState().set({ text: "" });
}

/** Put an earlier result back on the map and in the panels. */
export function restoreEntry(entry: SessionEntry) {
  useStore.getState().set({
    scenario: entry.scenario,
    claims: null,
    phase: "done",
    error: null,
    lineProgress: 1,
    switchProgress: 1,
    highlightZone: null,
    chat: null,
    resultsOpen: true,
    ...(entry.runId !== null && useStore.getState().runs.some((r) => r.id === entry.runId) ? { activeRunId: entry.runId } : {}),
  });
  useUi.getState().setUi({ activeEntry: entry.n });
}

/** Start over: no line, no results, no session; today's network, default camera, focus in the box. */
export function newPlan() {
  const s = useStore.getState();
  if (s.phase === "planning" || s.phase === "simulating" || s.phase === "building") return;
  s.set({
    scenario: null,
    claims: null,
    phase: "idle",
    error: null,
    pipeline: [],
    lineProgress: 0,
    switchProgress: 0,
    highlightZone: null,
    activeHistoryId: null,
    horizon: "opening",
    chat: null,
    text: "",
    resultsOpen: true,
  });
  s.resetRun();
  s.flyTo(INITIAL_CAMERA, 1400);
  useUi.getState().setUi({ session: [], activeEntry: null, pending: null, tab: "impact", details: false, timeOpen: false });
  requestAnimationFrame(focusComposer);
}
