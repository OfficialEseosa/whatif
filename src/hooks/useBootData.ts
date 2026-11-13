"use client";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

/** Loads the static network and the prebaked scenario (for the baseline morning rush) once. */
export function useBootData() {
  useEffect(() => {
    let cancelled = false;
    const { set } = useStore.getState();
    api
      .network()
      .then((network) => !cancelled && set({ network }))
      .catch((e) => !cancelled && set({ error: String(e) }));
    api
      .scenarioFile("beltline-streetcar")
      .then((preview) => !cancelled && set({ preview }))
      .catch((e) => !cancelled && set({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);
}
