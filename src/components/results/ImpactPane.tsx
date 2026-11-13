import type { Impact, ModeSplit, ScenarioResult } from "@/lib/contract";
import { pct, pct1 } from "@/lib/format";
import { MockTag } from "../MockTag";

const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const tidy = (n: number) => (Math.abs(n) >= 10 ? whole(Math.abs(n)) : String(+Math.abs(n).toFixed(1)));
const plainLabel = (s: string) =>
  s
    .replace(/^(min|pts|points)\s+/i, "")
    .replace(/corridor tracts/gi, "neighborhoods along the line")
    .replace(/tracts/gi, "neighborhoods")
    .replace(/sampled residents/gi, "residents");

/** A travel-time change in everyday words. `saved` > 0 means quicker. */
function timeChange(saved: number): string {
  const sec = Math.round(Math.abs(saved) * 60);
  if (sec < 1) return "No change";
  const dir = saved > 0 ? "faster" : "slower";
  return sec < 60 ? `${sec} sec ${dir}` : `${tidy(saved)} min ${dir}`;
}

/** A value with its unit and direction, e.g. "6 min faster", "1.6 points higher". */
function plainValue(value: number, unit: string): string {
  switch (unit) {
    case "min":
      return timeChange(-value);
    case "pts":
      return value === 0 ? "No change" : `${tidy(value)} points ${value > 0 ? "higher" : "lower"}`;
    case "share":
      return pct(value);
    case "households":
      return `${whole(value)} households`;
    case "usd/yr":
      return `$${whole(value)} a year`;
    case "usd/trip":
      return `$${value.toFixed(2)} a trip`;
    case "riders/day":
      return `${whole(value)} riders a day`;
    case "hrs/day":
      return `${whole(value)} hours a day`;
    default:
      return `${value.toLocaleString("en-US")} ${unit}`;
  }
}

const change = (before: number, after: number, fmt: (n: number) => string) => (fmt(before) === fmt(after) ? `${fmt(after)}, no change` : `${fmt(before)} to ${fmt(after)}`);

function SplitBar({ label, split }: { label: string; split: ModeSplit }) {
  return (
    <div className="bar-row">
      <span className="small">{label}</span>
      <div className="bar">
        <i className="bar-drive" style={{ width: pct(split.drive) }} />
        <i className="bar-transit" style={{ width: pct(split.transit) }} />
        <i className="bar-parkride" style={{ width: pct(split.park_ride) }} />
      </div>
      <span className="small mono">{pct1(split.transit + split.park_ride)} transit</span>
    </div>
  );
}

export function ImpactPane({ impact, metrics, isMock }: { impact: Impact; metrics: ScenarioResult["metrics"]; isMock: (key: string) => boolean }) {
  const maxSaved = Math.max(1e-6, ...impact.minutesSavedByEarnings.map((b) => Math.abs(b.minutesSaved)));
  const b = metrics.baseline;
  const p = metrics.proposed;
  return (
    <div className="stack-md">
      <div className={`tiles ${isMock("impact.tiles") ? "is-mock-section" : ""}`}>
        {impact.tiles.map((t) => (
          <div key={t.key} className={`tile tone-${t.tone}`}>
            <div className="mono tile-value">{plainValue(t.value, t.unit)}</div>
            <div className="small muted">{plainLabel(t.label)}</div>
            <MockTag show={isMock("impact.tiles")} what="this tile" />
          </div>
        ))}
      </div>
      <div className="stack-sm">
        <div className="eyebrow">Commute across the area <MockTag show={isMock("impact.modeSplit")} /></div>
        <dl className="facts">
          <div>
            <dt>Average commute</dt>
            <dd className="mono">{change(b.avgCommuteMin, p.avgCommuteMin, (n) => `${n.toFixed(1)} min`)}</dd>
          </div>
          <div>
            <dt>Transit riders a day</dt>
            <dd className="mono">{change(b.dailyTransitRiders, p.dailyTransitRiders, whole)}</dd>
          </div>
        </dl>
      </div>
      <div className="stack-sm">
        <div className="eyebrow">How people get to work</div>
        <SplitBar label="Today" split={impact.modeSplit.before} />
        <SplitBar label="With plan" split={impact.modeSplit.after} />
        <div className="bar-key">
          <span><i className="bar-drive" />Drive</span>
          <span><i className="bar-transit" />Transit</span>
          <span><i className="bar-parkride" />Park and ride</span>
        </div>
      </div>
      <div className="stack-sm">
        <div className="eyebrow">Change in commute time, by monthly pay <MockTag show={isMock("impact.minutesSavedByEarnings")} /></div>
        {impact.minutesSavedByEarnings.map((e) => (
          <div key={e.band} className="bar-row">
            <span className="small">{e.label.replace("/mo", "")}</span>
            <div className="bar">
              <i className={e.minutesSaved >= 0 ? "bar-gain" : "bar-loss"} style={{ width: `${(Math.abs(e.minutesSaved) / maxSaved) * 100}%` }} />
            </div>
            <span className="small mono">{timeChange(e.minutesSaved)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
