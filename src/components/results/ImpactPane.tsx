import type { Impact, ModeSplit, ScenarioResult } from "@/lib/contract";
import { formatValue, pct } from "@/lib/format";

function SplitBar({ label, split }: { label: string; split: ModeSplit }) {
  return (
    <div className="bar-row">
      <span className="small">{label}</span>
      <div className="bar">
        <i className="bar-drive" style={{ width: pct(split.drive) }} />
        <i className="bar-transit" style={{ width: pct(split.transit) }} />
        <i className="bar-parkride" style={{ width: pct(split.park_ride) }} />
      </div>
      <span className="small mono">{pct(split.transit + split.park_ride)} transit</span>
    </div>
  );
}

export function ImpactPane({ impact, metrics }: { impact: Impact; metrics: ScenarioResult["metrics"] }) {
  const maxSaved = Math.max(0.1, ...impact.minutesSavedByEarnings.map((b) => Math.abs(b.minutesSaved)));
  return (
    <div className="stack-md">
      <div className="tiles">
        {impact.tiles.map((t) => (
          <div key={t.key} className={`tile tone-${t.tone}`}>
            <div className="mono tile-value">{formatValue(t.value, t.unit)}</div>
            <div className="small muted">{t.label}</div>
          </div>
        ))}
      </div>
      <div className="stack-sm">
        <h3 className="eyebrow">How corridor commuters travel</h3>
        <SplitBar label="Before" split={impact.modeSplit.before} />
        <SplitBar label="After" split={impact.modeSplit.after} />
        <p className="small muted">{impact.modeSplit.scope}</p>
      </div>
      <div className="stack-sm">
        <h3 className="eyebrow">Minutes saved by earnings band</h3>
        {impact.minutesSavedByEarnings.map((b) => (
          <div key={b.band} className="bar-row">
            <span className="small">{b.label}</span>
            <div className="bar">
              <i className="bar-gain" style={{ width: `${(Math.abs(b.minutesSaved) / maxSaved) * 100}%` }} />
            </div>
            <span className="small mono">{b.minutesSaved.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="stack-sm">
        <h3 className="eyebrow">Whole model</h3>
        <p className="small">
          Avg commute {metrics.baseline.avgCommuteMin} → {metrics.proposed.avgCommuteMin} min, transit share {pct(metrics.baseline.transitShare)} →{" "}
          {pct(metrics.proposed.transitShare)}
        </p>
      </div>
      <div className="tiles">
        {impact.calibration.map((c) => (
          <div key={c.key} className="tile">
            <div className="mono tile-value">{formatValue(c.value, c.unit)}</div>
            <div className="small muted">{c.detail}</div>
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
