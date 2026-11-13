"use client";
import { clock } from "@/lib/format";
import { useStore, type Horizon } from "@/lib/store";
import { PauseIcon, PlayIcon } from "./icons";
import { useUi } from "./uiStore";
import { PLAYBACK_SPEEDS, stepSpeed } from "@/hooks/useClock";

const HORIZONS: { id: Horizon; label: string; title: string }[] = [
  { id: "opening", label: "Opening day", title: "The commute on the day the plan opens" },
  { id: "year5", label: "Year 5", title: "Five years on: who may be priced out near the new line" },
  { id: "year10", label: "Year 10", title: "Ten years on: who may be priced out near the new line" },
];

/** Time strip under the prompt. Only this component re-renders on each clock tick. */
export function TimeScrubber() {
  const open = useUi((s) => s.timeOpen);
  if (!open) return null;
  return (
    <div
      className="timestrip"
      role="group"
      aria-label="Morning commute replay"
      onKeyDown={(e) => {
        // - and + step the speed while focus is inside the strip (the range keeps its arrow keys).
        if (e.key === "-" || e.key === "+" || e.key === "=") {
          e.preventDefault();
          stepSpeed(e.key === "-" ? -1 : 1);
        }
      }}
    >
      <div className="ts-row">
        <PlayButton />
        <span className="ts-now">
          <span className="ts-label">Morning commute</span>
          <Clock />
        </span>
        <span className="ts-end" aria-hidden="true">6 AM</span>
        <Range />
        <span className="ts-end" aria-hidden="true">10 AM</span>
      </div>
      <div className="ts-row ts-row-2">
        <Speed />
        <Horizons />
      </div>
    </div>
  );
}

function PlayButton() {
  const playing = useStore((s) => s.playing);
  return (
    <button className="icon-btn" onClick={() => useStore.getState().set({ playing: !playing })} aria-label={playing ? "Pause the replay" : "Play the replay"} title={playing ? "Pause the replay" : "Play the replay"}>
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

const SPEED_LABEL: Record<number, string> = {
  10: "Slow: the 4 hours play in 24 minutes",
  30: "Normal: the 4 hours play in 8 minutes",
  60: "Fast: the 4 hours play in 4 minutes",
  300: "Fastest: the 4 hours play in under a minute",
};

/** Playback speed; changing it only changes how fast store.time advances. */
function Speed() {
  const speed = useStore((s) => s.playbackSpeed);
  return (
    <div className="ts-group">
      <span className="ts-label" id="ts-speed">Speed</span>
      <div className="seg seg-sm" role="group" aria-labelledby="ts-speed">
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            className="seg-btn num"
            aria-pressed={speed === s}
            aria-label={`${s} times. ${SPEED_LABEL[s]}`}
            title={SPEED_LABEL[s]}
            onClick={() => useStore.getState().set({ playbackSpeed: s })}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
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
      title="Drag to jump to a time between 6 and 10 AM"
      onChange={(e) => useStore.getState().set({ time: Number(e.target.value), playing: false })}
    />
  );
}

function Horizons() {
  const horizon = useStore((s) => s.horizon);
  const built = useStore((s) => s.scenario !== null);
  if (!built) return null;
  return (
    <div className="ts-group">
      <span className="ts-label" id="ts-ahead">Look ahead</span>
      <div className="seg seg-sm" role="group" aria-labelledby="ts-ahead">
        {HORIZONS.map((h) => (
          <button key={h.id} className="seg-btn" aria-pressed={horizon === h.id} title={h.title} onClick={() => useStore.getState().set({ horizon: h.id })}>
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}
