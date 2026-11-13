"use client";
import { clock } from "@/lib/format";
import { useStore, type Horizon } from "@/lib/store";
import { PauseIcon, PlayIcon } from "./icons";

const HORIZONS: { id: Horizon; label: string }[] = [
  { id: "opening", label: "Opening day" },
  { id: "year5", label: "Year 5" },
  { id: "year10", label: "Year 10" },
];

export function TimeScrubber() {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const horizon = useStore((s) => s.horizon);
  const built = useStore((s) => s.scenario !== null);
  const set = useStore((s) => s.set);
  return (
    <div className="scrubber surface">
      <button className="icon-btn" onClick={() => set({ playing: !playing })} aria-label={playing ? "Pause the morning rush" : "Play the morning rush"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="mono clock" aria-live="off">
        {clock(time)} AM
      </span>
      <input
        className="scrubber-range"
        type="range"
        min={0}
        max={14400}
        step={30}
        value={Math.round(time)}
        aria-label="Time of day, 6 to 10 AM"
        onChange={(e) => set({ time: Number(e.target.value), playing: false })}
      />
      <div className="seg" role="group" aria-label="Look ahead">
        {HORIZONS.map((h) => (
          <button
            key={h.id}
            className="seg-btn"
            aria-pressed={horizon === h.id}
            disabled={!built && h.id !== "opening"}
            title={!built && h.id !== "opening" ? "Build a plan first" : undefined}
            onClick={() => set({ horizon: h.id })}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}
