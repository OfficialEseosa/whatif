"use client";
import { clock } from "@/lib/format";
import { useStore, type Horizon } from "@/lib/store";

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
    <div className="panel scrubber row gap-md wrap">
      <button className="btn" onClick={() => set({ playing: !playing })} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "Pause" : "Play"}
      </button>
      <span className="mono clock" aria-live="off">
        {clock(time)}
      </span>
      <input
        className="grow"
        type="range"
        min={0}
        max={14400}
        step={30}
        value={Math.round(time)}
        aria-label="Time of day, 6 to 10 AM"
        onChange={(e) => set({ time: Number(e.target.value), playing: false })}
      />
      <div className="row" role="group" aria-label="Look ahead">
        {HORIZONS.map((h) => (
          <button
            key={h.id}
            className="btn btn-toggle"
            aria-pressed={horizon === h.id}
            disabled={!built && h.id !== "opening"}
            onClick={() => set({ horizon: h.id })}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}
