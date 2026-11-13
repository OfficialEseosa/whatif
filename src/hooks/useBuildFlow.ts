"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { gazetteer } from "@/lib/ai/mock";
import { checkEditAgainstGazetteer, type LngLat, type Network, type ScenarioEdit, type ScenarioResult } from "@/lib/contract";
import { useStore, type PipelineStep, type RunRecord } from "@/lib/store";
import type { PlanMode } from "@/lib/contract";
import { prefersReducedMotion } from "./useReducedMotion";

export const RUN_STEPS: PipelineStep[] = [
  { id: "plan", label: "Read plan", status: "pending" },
  { id: "stops", label: "Place stops", status: "pending" },
  { id: "edit", label: "Edit network", status: "pending" },
  { id: "route", label: "Route commuters", status: "pending" },
  { id: "score", label: "Score", status: "pending" },
  { id: "draw", label: "Draw line", status: "pending" },
];

const BEARING = -20;
let runSeq = 0;

/** Fit the camera to the proposed line, shifted so the line sits left of the results card on wide screens. */
function cameraFor(result: ScenarioResult, photoreal: boolean) {
  return cameraForPoints(result.line.path.length ? result.line.path : result.agents.slice(0, 50).map((a) => a.home), photoreal);
}

function cameraForPoints(pts: LngLat[], photoreal: boolean) {
  const lng = pts.map((p) => p[0]);
  const lat = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...lng) - Math.min(...lng), Math.max(...lat) - Math.min(...lat), 0.005);
  // Move the camera target toward screen-right, which slides the line toward screen-left.
  const shift = typeof window !== "undefined" && window.innerWidth > 900 ? span * 0.4 : 0;
  const b = (BEARING * Math.PI) / 180;
  return {
    longitude: (Math.max(...lng) + Math.min(...lng)) / 2 + shift * Math.cos(b),
    latitude: (Math.max(...lat) + Math.min(...lat)) / 2 - shift * Math.sin(b) * 0.83,
    zoom: Math.min(16, Math.log2(0.6 / span) + 9.3),
    pitch: photoreal ? 50 : 50, // photoreal: moderate tilt keeps the tile count down
    bearing: BEARING,
    transitionDuration: 1800,
  };
}

/** Camera framing the edit itself (stops and affected roads), for plans with no simulation. */
function cameraForEdit(edit: ScenarioEdit, network: Network | null, photoreal: boolean) {
  const ids = new Set(edit.roadIds ?? []);
  const line = !edit.stops.length && edit.baseLineId ? network?.rail.find((r) => r.id === edit.baseLineId)?.paths.flat() : undefined;
  const pts: LngLat[] = [
    ...edit.stops.map((s) => s.coord),
    ...(network?.roads.filter((r) => ids.has(r.id)).flatMap((r) => r.path) ?? []),
    ...(line ?? []),
    ...(edit.chargeZone ?? []),
  ];
  if (!pts.length) return null;
  return cameraForPoints(pts, photoreal);
}

/**
 * Eased 0..1 animation on wall-clock time. Same curve as `tween`, but it also finishes on a timer:
 * a hidden or throttled tab pauses requestAnimationFrame, which used to stretch the "Draw line"
 * step to 18 s. Now the step always measures the line animation itself (about 3.8 s).
 */
function animate(ms: number, onFrame: (k: number) => void): Promise<void> {
  if (prefersReducedMotion() || ms <= 0) {
    onFrame(1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    let raf = 0;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      onFrame(1);
      resolve();
    };
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      if (k >= 1) return end();
      onFrame(1 - Math.pow(1 - k, 3));
      raf = requestAnimationFrame(step);
    };
    const timer = setTimeout(end, ms + 50);
    raf = requestAnimationFrame(step);
  });
}

/** Stops the active run (if still going) from writing further results; used by the run panel's Cancel. */
export function cancelRun() {
  const s = useStore.getState();
  const run = s.runs.find((r) => r.id === runSeq);
  if (!run || run.endedAt !== null) return;
  runSeq++; // the in-flight build sees it is stale and stops
  const now = performance.now();
  const active = run.steps.find((p) => p.status === "active");
  if (active) s.setRunStep(run.id, active.id, { status: "error", endedAt: now });
  s.patchRun(run.id, { endedAt: now, cancelled: true, error: { step: active?.id ?? "route", message: "Cancelled. The server may still finish; its result will be ignored." } });
  s.set({ phase: "error", error: "Cancelled" });
}

export type BuildOptions = {
  /** Follow-up prompt: the plan being modified; passed to /api/plan. */
  previousEdit?: ScenarioEdit;
  /** Re-running an earlier session entry from its stored edit: the prompt it came from. */
  restore?: { text: string; mode: PlanMode };
};

/**
 * Build it: /api/plan -> place stops -> edit network -> /api/simulate -> score -> line draws -> agents switch.
 * Every step records real start/end times in store.runs; nothing waits on a timer. `overrideEdit`
 * skips /api/plan (used by "Three plans that score better").
 */
export function useBuildFlow() {
  return useCallback(async (overrideEdit?: ScenarioEdit, opts?: BuildOptions) => {
    const s = useStore.getState();
    if (s.phase === "planning" || s.phase === "simulating" || s.phase === "building") return;
    const id = ++runSeq;
    const live = () => id === runSeq;
    const previousEdit = opts?.previousEdit ?? null;
    const run: RunRecord = {
      id,
      startedAt: performance.now(),
      endedAt: null,
      steps: RUN_STEPS.map((p) => ({ ...p })),
      overrideEdit: overrideEdit ?? null,
      previousEdit,
      prompt: opts?.restore ?? (overrideEdit ? null : { text: s.text.trim(), mode: s.inputMode }),
      planSource: null,
      edit: null,
      claims: null,
      stopProblems: [],
      pingAt: null,
      simMs: null,
      routeMs: null,
      file: null,
      result: null,
      insight: null,
      notSimulated: false,
      notSimulatedReason: null,
      error: null,
      cancelled: false,
    };
    s.addRun(run);
    s.set({ phase: "planning", error: null, lineProgress: 0, switchProgress: 0, chat: null, scenario: null, highlightZone: null });
    const st = () => useStore.getState();
    const patch = (p: Partial<RunRecord>) => st().patchRun(id, p);
    const start = (step: string) => st().setRunStep(id, step, { status: "active", startedAt: performance.now() });
    const finish = (step: string, status: PipelineStep["status"] = "done") => st().setRunStep(id, step, { status, endedAt: performance.now() });
    let current = "plan";

    try {
      // 1. Read plan
      start("plan");
      const plan = overrideEdit
        ? { edit: overrideEdit, claims: undefined, isMock: false }
        : await api.plan({ text: s.text, mode: s.inputMode, ...(previousEdit ? { previousEdit } : {}) });
      if (!live()) return;
      patch({ edit: plan.edit, claims: plan.claims ?? null, planSource: opts?.restore ? "restored" : overrideEdit ? "alternative" : plan.isMock ? "mock_parser" : "claude" });
      finish("plan", !overrideEdit && plan.isMock ? "warn" : "done");

      // 2. Place stops: a local gazetteer lookup, so it finishes immediately.
      current = "stops";
      start("stops");
      const problems = checkEditAgainstGazetteer(plan.edit, gazetteer);
      patch({ stopProblems: problems, pingAt: plan.edit.stops.length ? performance.now() : null });
      finish("stops", problems.length ? "warn" : "done");

      // 3. Edit network: applied by the simulation; the panel summarises the edit.
      current = "edit";
      start("edit");
      finish("edit");

      // 4. Route commuters (the only slow step).
      current = "route";
      st().set({ phase: "simulating", claims: plan.claims ?? null });
      start("route");
      const simStart = performance.now();
      const { result, timing, notSimulated } = await api.simulateTimed({ edit: plan.edit, claims: plan.claims });
      if (!live()) return;
      patch({ simMs: performance.now() - simStart, routeMs: timing.routeMs, file: timing.file, result });
      if (!result) {
        // No saved or live simulation for this edit. Show the plan itself (stops, roads) and stop here:
        // never draw or score another plan's results.
        finish("route", "warn");
        const steps = st().runs.find((r) => r.id === id)?.steps.filter((p) => p.id !== "score" && p.id !== "draw") ?? [];
        patch({ notSimulated: true, notSimulatedReason: notSimulated ?? { reason: "offline" }, steps, endedAt: performance.now() });
        st().set({ phase: "done", pipeline: steps, resultsOpen: true });
        const cam = cameraForEdit(plan.edit, st().network, st().view === "photoreal");
        if (cam) st().set({ camera: cam });
        return;
      }
      finish("route", result.source === "mock" || result.isMock ? "warn" : "done");
      // Claude's plain summary and follow-ups arrive on their own; nothing waits for them.
      if (!result.isMock) void api.explain(result).then((insight) => insight && patch({ insight }));

      // 5. Score stakes: computed by the simulation in the same result; recorded as its own step.
      current = "score";
      start("score");
      finish("score");

      // 6. Draw line: the real map animation; the panel reads lineProgress / switchProgress.
      current = "draw";
      // The step's timer starts with the line animation itself, not the camera wait or map render before it.
      st().setRunStep(id, "draw", { status: "active" });
      st().set({ phase: "building", scenario: result, camera: cameraFor(result, st().view === "photoreal") });
      // Stagger instead of animating everything at once: let the camera land, then draw the line,
      // then switch commuters in 3 steps (each step rebuilds trip data for every agent, so not per frame).
      await animate(1500, () => {});
      if (live()) st().setRunStep(id, "draw", { startedAt: performance.now() });
      await animate(2200, (k) => live() && st().set({ lineProgress: k }));
      await animate(1600, (k) => live() && st().set({ switchProgress: Math.round(k * 3) / 3 }));
      if (!live()) return;
      finish("draw");
      patch({ endedAt: performance.now() });
      st().set({ phase: "done", tab: "verdict" });
    } catch (e) {
      if (!live()) return;
      const message = e instanceof Error ? e.message : String(e);
      st().setRunStep(id, current, { status: "error", endedAt: performance.now() });
      patch({ endedAt: performance.now(), error: { step: current, message } });
      st().set({ phase: "error", error: message });
    }
  }, []);
}
