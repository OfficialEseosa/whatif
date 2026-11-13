"use client";
import { useRef } from "react";
import { INITIAL_CAMERA, useStore } from "@/lib/store";
import { ResetIcon } from "./icons";

/** Degrees per step for the hold-to-repeat rotate/tilt buttons, and the repeat interval. */
const STEP_BEARING = 6;
const STEP_PITCH = 4;
const REPEAT_MS = 70;

/** Press-and-hold repeat: fires once on press, then every REPEAT_MS until release. */
function useHold(fn: () => void) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      fn();
      stop();
      timer.current = setInterval(fn, REPEAT_MS);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn();
      }
    },
  };
}

/**
 * Camera buttons in the control bar: reset to Atlanta; a compass you can click (north up) or drag
 * around to set the bearing; rotate left/right and tilt up/down with press-and-hold repeat.
 */
export function NavCluster() {
  const bearing = useStore((s) => s.live.bearing);
  const { flyTo, nudgeCamera } = useStore.getState();
  const drag = useRef<{ cx: number; cy: number; moved: boolean } | null>(null);

  const rotL = useHold(() => nudgeCamera({ dBearing: -STEP_BEARING }));
  const rotR = useHold(() => nudgeCamera({ dBearing: STEP_BEARING }));
  const tiltUp = useHold(() => nudgeCamera({ dPitch: STEP_PITCH }));
  const tiltDown = useHold(() => nudgeCamera({ dPitch: -STEP_PITCH }));

  const angleFrom = (e: React.PointerEvent) => {
    const d = drag.current!;
    // Bearing = direction of the pointer from the compass centre, clockwise from up.
    return (Math.atan2(e.clientX - d.cx, -(e.clientY - d.cy)) * 180) / Math.PI;
  };

  return (
    <>
      <button className="cbtn cbtn-reset" title="Fly back to the starting view of Atlanta" onClick={() => flyTo(INITIAL_CAMERA, 1600)}>
        <ResetIcon />
        Reset view
      </button>
      <button className="cbtn cbtn-icon cbtn-nav" aria-label="Turn map left (hold to keep turning)" title="Turn map left (hold to keep turning)" {...rotL}>
        ⟲
      </button>
      <button
        className="cbtn cbtn-icon cbtn-compass"
        aria-label="Compass: click to put north at the top, drag around it to turn the map"
        title="Compass. Click to put north at the top, drag to turn the map"
        onPointerDown={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          drag.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 6) return;
          d.moved = true;
          // Dragging the needle: the map turns so north follows the pointer.
          nudgeCamera({ bearing: -angleFrom(e) });
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) flyTo({ bearing: 0 }, 500);
        }}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            flyTo({ bearing: 0 }, 500);
          }
        }}
        style={{ touchAction: "none" }}
      >
        <svg className="north" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
          <path d="M9 1.5 12.5 9h-7L9 1.5Z" fill="var(--loss)" />
          <path d="M9 16.5 5.5 9h7L9 16.5Z" fill="currentColor" opacity="0.55" />
        </svg>
      </button>
      <button className="cbtn cbtn-icon cbtn-nav" aria-label="Turn map right (hold to keep turning)" title="Turn map right (hold to keep turning)" {...rotR}>
        ⟳
      </button>
      <button className="cbtn cbtn-icon cbtn-nav" aria-label="Tilt view toward the horizon (hold to keep tilting)" title="Tilt view toward the horizon (hold to keep tilting)" {...tiltUp}>
        ⤒
      </button>
      <button className="cbtn cbtn-icon cbtn-nav" aria-label="Tilt view to look straight down (hold to keep tilting)" title="Tilt view to look straight down (hold to keep tilting)" {...tiltDown}>
        ⤓
      </button>
    </>
  );
}
