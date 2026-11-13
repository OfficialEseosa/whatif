import type { Impact, ModeSplit, ScenarioResult } from "@/lib/contract";
import { formatValue, pct, pct1 } from "@/lib/format";
import { MockTag } from "../MockTag";

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
  return (
    <div className="stack-md">
      <div className={`tiles ${isMock("impact.tiles") ? "is-mock-section" : ""}`}>
        {impact.tiles.map((t) => (
          <div key={t.key} className={`tile tone-${t.tone}`}>
            <div className="mono tile-value">{formatValue(t.value, t.unit)}</div>
            <div className="small muted">{t.label}</div>
            <MockTag show={isMock("impact.tiles")} what="this tile" />
          </div>
        ))}
      </div>
      <div className="stack-sm">
        <div className="eyebrow">Mode split <MockTag show={isMock("impact.modeSplit")} /></div>
        <SplitBar label="Before" split={impact.modeSplit.before} />
        <SplitBar label="After" split={impact.modeSplit.after} />
        <p className="small muted">{impact.modeSplit.scope}</p>
      </div>
      <div className="stack-sm">
        <div className="eyebrow">Minutes saved by earnings band <MockTag show={isMock("impact.minutesSavedByEarnings")} /></div>
        {impact.minutesSavedByEarnings.map((b) => (
          <div key={b.band} className="bar-row">
            <span className="small">{b.label}</span>
            <div className="bar">
              <i className={b.minutesSaved >= 0 ? "bar-gain" : "bar-loss"} style={{ width: `${(Math.abs(b.minutesSaved) / maxSaved) * 100}%` }} />
            </div>
            <span className="small mono">{b.minutesSaved.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="stack-sm">
        <div className="eyebrow">Whole model</div>
        <p className="small">
          Avg commute {metrics.baseline.avgCommuteMin} → {metrics.proposed.avgCommuteMin} min · transit share {pct1(metrics.baseline.transitShare)} →{" "}
          {pct1(metrics.proposed.transitShare)} · transit riders {Math.round(metrics.baseline.dailyTransitRiders).toLocaleString("en-US")} →{" "}
          {Math.round(metrics.proposed.dailyTransitRiders).toLocaleString("en-US")}/day
        </p>
      </div>
      <div className={`tiles ${isMock("impact.calibration") ? "is-mock-section" : ""}`}>
        {impact.calibration.map((c) => (
          <div key={c.key} className="tile">
            <div className="mono tile-value">{formatValue(c.value, c.unit)}</div>
            <div className="small muted">{c.detail}</div>
            <MockTag show={isMock("impact.calibration")} what="calibration" />
          </div>
        ))}
      </div>
      {impact.notes?.map((n) => (
        <p key={n} className="small muted">
          {n}
        </p>
      ))}
    </div>
  );
}
