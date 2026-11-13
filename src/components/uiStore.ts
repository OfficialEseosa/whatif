/**
 * Chrome-only UI state (which panels are open, which results tab) and the session thread. Kept apart
 * from src/lib/store.ts so layout changes never touch the data store other lanes edit.
 */
import { create } from "zustand";
import type { PlanMode, ScenarioEdit, ScenarioResult, ScenarioSource } from "@/lib/contract";
import { scenarioSource } from "@/lib/provenance";
import { INITIAL_CAMERA, useStore, type RunRecord } from "@/lib/store";

export type UiTab = "impact" | "whoPays" | "townHall" | "claims" | "better";

/**
 * One submitted prompt and what came back. The session list is kept in sessionStorage (prompts, edits,
 * source; not the multi-MB results), so a refresh keeps it; a restored entry re-fetches its run.
 */
export type SessionEntry = {
  n: number;
  /** The run panel's record of this run (store.runs), while this tab still has it. */
  runId: number | null;
  text: string;
  mode: PlanMode | "alternative";
  title: string;
  /** null when nothing was simulated for this plan. */
  verdict: ScenarioResult["verdict"]["label"] | null;
  source: ScenarioSource | null;
  edit: ScenarioEdit;
  /** In memory only. */
  scenario?: ScenarioResult | null;
};

const STORAGE_KEY = "whatif.session.v1";
type Stored = Omit<SessionEntry, "scenario" | "runId">;

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
  /** What was submitted for the run in flight (null for an alternative's re-run); `restoreOf` = session entry being restored. */
  pending: { text: string; mode: PlanMode; restoreOf?: number } | null;
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

/** Called when a run finishes (simulated or not): add it to the session thread, or update the entry it restored. */
export function recordRun(run: RunRecord, scenario: ScenarioResult | null) {
  const { session, pending, setUi } = useUi.getState();
  if (!run.edit) return;
  const restoring = pending?.restoreOf !== undefined ? session.find((e) => e.n === pending.restoreOf) : undefined;
  if (restoring) {
    const entry: SessionEntry = { ...restoring, runId: run.id, scenario, title: scenario?.title ?? run.edit.name };
    setUi({ session: session.map((e) => (e.n === restoring.n ? entry : e)), activeEntry: restoring.n, pending: null, timeOpen: !!scenario });
    return;
  }
  const n = (session.at(-1)?.n ?? 0) + 1;
  const entry: SessionEntry = {
    n,
    runId: run.id,
    text: run.prompt?.text || pending?.text || run.edit.name,
    mode: run.prompt?.mode ?? pending?.mode ?? "alternative",
    title: scenario?.title ?? run.edit.name,
    verdict: scenario?.verdict.label ?? null,
    source: scenario ? scenarioSource(scenario) : null,
    edit: run.edit,
    scenario,
  };
  setUi({ session: [...session, entry].slice(-12), activeEntry: n, pending: null, timeOpen: !!scenario });
  if (pending) useStore.getState().set({ text: "" });
}

/** Put an earlier result back on the map and in the panels. After a refresh it re-runs the stored edit. */
export function restoreEntry(entry: SessionEntry, rerun: (edit: ScenarioEdit, restore: { text: string; mode: PlanMode }) => void) {
  const s = useStore.getState();
  if (s.phase === "planning" || s.phase === "simulating" || s.phase === "building") return;
  const run = entry.runId !== null ? s.runs.find((r) => r.id === entry.runId) : undefined;
  if (entry.scenario || (run && run.notSimulated)) {
    s.set({
      scenario: entry.scenario ?? null,
      claims: null,
      phase: "done",
      error: null,
      lineProgress: entry.scenario ? 1 : 0,
      switchProgress: entry.scenario ? 1 : 0,
      highlightZone: null,
      chat: null,
      resultsOpen: true,
      ...(run ? { activeRunId: run.id } : {}),
    });
    useUi.getState().setUi({ activeEntry: entry.n });
    return;
  }
  // Not in memory (the page was refreshed): run its stored edit again, which re-fetches the saved run.
  const mode = entry.mode === "alternative" ? "prompt" : entry.mode;
  useUi.getState().setUi({ activeEntry: entry.n, pending: { text: entry.text, mode, restoreOf: entry.n } });
  rerun(entry.edit, { text: entry.text, mode });
}

/** Put an earlier prompt back in the box to edit and run again. */
export function editEntry(entry: SessionEntry) {
  if (entry.mode !== "alternative") useStore.getState().set({ text: entry.text });
  requestAnimationFrame(focusComposer);
}

/** Load the session list saved in this tab (call once on mount, client only). */
export function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { session: Stored[]; lastPrompt?: string };
    if (!Array.isArray(saved.session)) return;
    useUi.getState().setUi({ session: saved.session.map((e) => ({ ...e, runId: null })), lastPrompt: saved.lastPrompt ?? "" });
  } catch {
    // Storage blocked or bad data: start with an empty list.
  }
}

/** Keep the saved copy in step with the list (prompts, edits and sources only). */
export function persistSession() {
  return useUi.subscribe((u, prev) => {
    if (u.session === prev.session && u.lastPrompt === prev.lastPrompt) return;
    try {
      const session: Stored[] = u.session.map(({ n, text, mode, title, verdict, source, edit }) => ({ n, text, mode, title, verdict, source, edit }));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ session, lastPrompt: u.lastPrompt }));
    } catch {
      // Storage full or blocked: the list still works for this page.
    }
  });
}

/** Start over: no line, no results (the session list stays); today's network, default camera, focus in the box. */
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
  // The session list stays: earlier prompts remain one click away.
  useUi.getState().setUi({ activeEntry: null, pending: null, tab: "impact", details: false, timeOpen: false });
  requestAnimationFrame(focusComposer);
}
