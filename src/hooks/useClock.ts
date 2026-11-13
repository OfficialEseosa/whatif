"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Playback speeds: simulated seconds per real second. 30× is the default: at the default city zoom a
 * streetcar or a single commuter visibly glides; 300× plays the whole 6–10 AM rush in 48 s.
 */
export const PLAYBACK_SPEEDS = [10, 30, 60, 300] as const;
export const DEFAULT_PLAYBACK_SPEED = 30;
const START = 0;
const END = 14400;
/** Where the loop restarts: 6:30 AM, when the rush is already moving (6:00 is nearly empty). */
const LOOP_TO = 1800;
const SPEED_KEY = "whatif.playbackSpeed";

/** Steps the playback speed up (+1) or down (-1) through PLAYBACK_SPEEDS. */
export function stepSpeed(dir: 1 | -1) {
  const { playbackSpeed, set } = useStore.getState();
  const i = PLAYBACK_SPEEDS.findIndex((s) => s >= playbackSpeed);
  const next = PLAYBACK_SPEEDS[Math.max(0, Math.min(PLAYBACK_SPEEDS.length - 1, (i < 0 ? PLAYBACK_SPEEDS.length - 1 : i) + dir))];
  set({ playbackSpeed: next });
}

/**
 * Advances store.time while store.playing, at store.playbackSpeed, looping back to 6:30 AM after 10:00.
 * Also: the speed persists for the browser session; `[` / `]` step the speed and Space plays or pauses
 * (except while typing). Paused by default under reduced motion.
 */
export function useClock() {
  const reduced = useReducedMotion();
  const playing = useStore((s) => s.playing);

  useEffect(() => {
    if (reduced) useStore.getState().set({ playing: false });
  }, [reduced]);

  // Restore and persist the speed for this browser session.
  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(SPEED_KEY));
      if ((PLAYBACK_SPEEDS as readonly number[]).includes(saved)) useStore.getState().set({ playbackSpeed: saved });
    } catch {
      // storage blocked: keep the default
    }
    return useStore.subscribe((s, prev) => {
      if (s.playbackSpeed === prev.playbackSpeed) return;
      try {
        sessionStorage.setItem(SPEED_KEY, String(s.playbackSpeed));
      } catch {
        // storage blocked: the choice lasts until reload
      }
    });
  }, []);

  // Keyboard: [ and ] step the speed, Space plays/pauses. Ignored while typing or on a focused control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.closest("input, textarea, select, [contenteditable='true']"))) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        stepSpeed(e.key === "]" ? 1 : -1);
      } else if (e.key === " " && !t?.closest("button, a")) {
        e.preventDefault();
        const { playing: p, set } = useStore.getState();
        set({ playing: !p });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { time, playbackSpeed, set } = useStore.getState();
      let next = time + dt * playbackSpeed;
      if (next > END) next = START + LOOP_TO;
      set({ time: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
