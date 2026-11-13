"use client";
import { clock } from "@/lib/format";
import { useStore, type Horizon } from "@/lib/store";
import { PauseIcon, PlayIcon } from "./icons";
import { useUi } from "./uiStore";

const HORIZONS: { id: Horizon; label: string }[] = [
  { id: "opening", label: "Opening day" },
  { id: "year5", label: "Year 5" },
  { id: "year10", label: "Year 10" },
];

/** Time strip under the prompt. Only this component re-renders on each clock tick. */
export function TimeScrubber() {
  const open = useUi((s) => s.timeOpen);
  if (!open) return null;
  return (
    <div className="timestrip">
      <PlayButton />
      <Clock />
      <Range />
      <Horizons />
    </div>
  );
}

function PlayButton() {
  const playing = useStore((s) => s.playing);
  return (
    <button className="icon-btn" onClick={() => useStore.getState().set({ playing: !playing })} aria-label={playing ? "Pause" : "Play"}>
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

function Clock() {
  const label = useStore((s) => clock(s.time));
  return (
    <span className="clock num" aria-live="off">
      {label} AM
    </span>
  );
}

function Range() {
  const step = useStore((s) => Math.round(s.time / 30) * 30);
  return (
    <input
      className="range"
      type="range"
      min={0}
      max={14400}
      step={30}
      value={step}
      aria-label="Time of day, 6 to 10 AM"
      onChange={(e) => useStore.getState().set({ time: Number(e.target.value), playing: false })}
    />
  );
}

function Horizons() {
  const horizon = useStore((s) => s.horizon);
  const built = useStore((s) => s.scenario !== null);
  if (!built) return null;
  return (
    <div className="seg seg-sm" role="group" aria-label="Look ahead">
      {HORIZONS.map((h) => (
        <button key={h.id} className="seg-btn" aria-pressed={horizon === h.id} onClick={() => useStore.getState().set({ horizon: h.id })}>
          {h.label}
        </button>
      ))}
    </div>
  );
}
