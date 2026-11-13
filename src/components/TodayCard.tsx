"use client";
import { scenarioSource } from "@/lib/provenance";
import { useStore } from "@/lib/store";

const SOURCE = { live_sim: "Live simulation", prebaked_sim: "Saved run", mock: "Sample data" } as const;

/** "Atlanta today": the baseline morning commute, before any plan. Hidden once a run starts. */
export function TodayCard() {
  const preview = useStore((s) => s.preview);
  const idle = useStore((s) => s.scenario === null && s.activeRunId === null && s.phase === "idle");
  if (!preview || !idle) return null;
  const m = preview.metrics.baseline;
  const source = scenarioSource(preview);
  const rows: [string, string][] = [
    ["Commuters modeled", Math.round(m.populationModeled).toLocaleString("en-US")],
    ["Average commute", `${m.avgCommuteMin.toFixed(1)} min`],
    ["Transit share", `${(m.transitShare * 100).toFixed(1)}%`],
    ["Daily transit riders", Math.round(m.dailyTransitRiders).toLocaleString("en-US")],
  ];
  return (
    <section className="surface today" aria-label="Atlanta today">
      <header className="today-head">
        <h2 className="today-title">Atlanta today</h2>
        <span className="today-sub">Weekday morning, 6 to 10 AM</span>
      </header>
      <dl className="today-rows">
        {rows.map(([k, v]) => (
          <div key={k} className="today-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className={`source source-${preview.isMock ? "mock" : source}`}>{preview.isMock ? "Sample data" : SOURCE[source]}</p>
    </section>
  );
}
