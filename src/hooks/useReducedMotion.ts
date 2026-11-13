"use client";
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** rAF tween 0..1 (eased). Resolves immediately under reduced motion. */
export function tween(durationMs: number, onFrame: (k: number) => void): Promise<void> {
  if (prefersReducedMotion() || durationMs <= 0) {
    onFrame(1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / durationMs);
      onFrame(1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, prefersReducedMotion() ? Math.min(ms, 50) : ms));
