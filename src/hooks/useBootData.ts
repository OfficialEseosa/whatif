"use client";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

/**
 * Loads the static network and a "today's network" scenario for the baseline morning rush:
 * the prebaked sim baseline (public/scenarios/baseline.sim.json) if present, else the mock.
 */
export function useBootData() {
  useEffect(() => {
    let cancelled = false;
    const { set } = useStore.getState();
    api
      .network()
      .then((network) => !cancelled && set({ network }))
      .catch((e) => !cancelled && set({ error: String(e) }));
    api
      .scenarioFile("baseline.sim")
      .then((s) => ({ ...s, source: s.source ?? ("prebaked_sim" as const) }))
      .catch(() => api.scenarioFile("beltline-streetcar").then((s) => ({ ...s, source: "mock" as const })))
      .then((preview) => !cancelled && set({ preview }))
      .catch((e) => !cancelled && set({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);
}
