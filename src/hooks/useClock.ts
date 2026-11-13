"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useReducedMotion } from "./useReducedMotion";

/** Simulated seconds per real second while playing (4 h window in ~60 s). */
export const PLAYBACK_RATE = 240;
const START = 0;
const END = 14400;

/** Advances store.time while store.playing. Paused by default under reduced motion. */
export function useClock() {
  const reduced = useReducedMotion();
  const playing = useStore((s) => s.playing);

  useEffect(() => {
    if (reduced) useStore.getState().set({ playing: false });
  }, [reduced]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { time, set } = useStore.getState();
      let next = time + dt * PLAYBACK_RATE;
      if (next > END) next = START + 1800;
      set({ time: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
