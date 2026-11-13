"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { ScenarioEdit, ScenarioResult } from "@/lib/contract";
import { useStore, type PipelineStep } from "@/lib/store";
import { sleep, tween } from "./useReducedMotion";

const STEPS: PipelineStep[] = [
  { id: "plan", label: "Reading the plan", status: "pending" },
  { id: "stops", label: "Placing stops from the gazetteer", status: "pending" },
  { id: "edit", label: "Editing the network", status: "pending" },
  { id: "route", label: "Routing commuters", status: "pending" },
  { id: "score", label: "Scoring stakes", status: "pending" },
  { id: "draw", label: "Drawing the line", status: "pending" },
];

/** Fit the camera to the proposed line. */
function cameraFor(result: ScenarioResult, photoreal: boolean) {
  const pts = result.line.path.length ? result.line.path : result.agents.slice(0, 50).map((a) => a.home);
  const lng = pts.map((p) => p[0]);
  const lat = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...lng) - Math.min(...lng), Math.max(...lat) - Math.min(...lat), 0.005);
  return {
    longitude: (Math.max(...lng) + Math.min(...lng)) / 2,
    latitude: (Math.max(...lat) + Math.min(...lat)) / 2,
    zoom: Math.min(16, Math.log2(0.6 / span) + 9.3),
    pitch: photoreal ? 60 : 50,
    bearing: -20,
    transitionDuration: 1800,
  };
}

/**
 * Build it: /api/plan -> pipeline steps -> /api/simulate -> line draws -> agents switch -> panels fill.
 * `overrideEdit` skips /api/plan (used by "Three plans that score better").
 */
export function useBuildFlow() {
  return useCallback(async (overrideEdit?: ScenarioEdit) => {
    const s = useStore.getState();
    if (s.phase === "planning" || s.phase === "simulating" || s.phase === "building") return;
    const step = s.setPipelineStep;
    s.set({ phase: "planning", error: null, pipeline: STEPS, lineProgress: 0, switchProgress: 0, chat: null, scenario: null, highlightZone: null });
    try {
      step("plan", { status: "active" });
      const plan = overrideEdit
        ? { edit: overrideEdit, claims: undefined }
        : await api.plan({ text: s.text, mode: s.inputMode });
      step("plan", { status: "done", label: `Read the plan: ${plan.edit.name}` });

      step("stops", { status: "active" });
      await sleep(350);
      step("stops", { status: "done", label: `Placed ${plan.edit.stops.length} stops from the gazetteer` });

      step("edit", { status: "active" });
      await sleep(300);
      step("edit", { status: "done" });

      useStore.getState().set({ phase: "simulating", claims: plan.claims ?? null });
      step("route", { status: "active" });
      const result = await api.simulate({ edit: plan.edit, claims: plan.claims });
      step("route", { status: "done", label: `Routed ${result.metrics.proposed.populationModeled.toLocaleString("en-US")} commuters` });

      step("score", { status: "active" });
      await sleep(300);
      step("score", { status: "done", label: `Scored ${result.agents.length.toLocaleString("en-US")} stakes` });

      step("draw", { status: "active" });
      const st = useStore.getState();
      st.set({ phase: "building", scenario: result, camera: cameraFor(result, st.view === "photoreal") });
      await tween(2200, (k) => useStore.getState().set({ lineProgress: k }));
      await tween(1600, (k) => useStore.getState().set({ switchProgress: k }));
      step("draw", { status: "done" });
      useStore.getState().set({ phase: "done", tab: "verdict" });
      await sleep(1500);
      if (useStore.getState().phase === "done") useStore.getState().set({ pipeline: [] });
    } catch (e) {
      useStore.getState().set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, []);
}
