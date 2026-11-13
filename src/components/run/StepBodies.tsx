"use client";
/** Details shown when a stop on the run line is expanded. Only values the app actually has. */
import { useState, type CSSProperties } from "react";
import { gazetteer } from "@/lib/ai/mock";
import type { GazetteerKind, VerdictTestKey, ZoneKind } from "@/lib/contract";
import { pct1 } from "@/lib/format";
import { isMockSection } from "@/lib/provenance";
import { useStore, type RunRecord } from "@/lib/store";
import { KindIcon } from "./icons";
import { plain } from "../results/VerdictPane";
import { fmtDur, int, stopsKm } from "./runFormat";

const GRADE_WORD = { good: "Good", fair: "Fair", poor: "Poor" } as const;

const mb = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`);
const KIND = new Map<string, GazetteerKind>(gazetteer.map((p) => [p.id, p.kind]));
const KIND_LABEL: Record<GazetteerKind, string> = {
  landmark: "Landmark",
  neighborhood: "Neighborhood",
  marta_station: "MARTA station",
  streetcar_stop: "Streetcar stop",
  corridor_point: "Beltline point",
  employment: "Job site",
};
/** Verdict tests that have a map zone to light up. */
const TEST_ZONE: Partial<Record<VerdictTestKey, ZoneKind>> = { renters_rent_pressure: "rent_pressure" };

export function PlanBody({ run }: { run: RunRecord }) {
  const [all, setAll] = useState(false);
  const e = run.edit;
  if (!e) return null;
  const notes = e.assumptions ?? [];
  const shown = all ? notes : notes.slice(0, 3);
  return (
    <>
      {notes.length > 0 && (
        <div className="rp-quotes">
          <span className="rp-label">What we assumed</span>
          {shown.map((a, i) => (
            <p key={i} className="rp-quote">
              {a}
            </p>
          ))}
          {notes.length > 3 && (
            <button className="rp-more" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `${notes.length - 3} more`}
            </button>
          )}
        </div>
      )}
      {!!run.claims?.length && (
        <div className="rp-quotes">
          <span className="rp-label">{run.claims.length} claims found in the article</span>
          <p className="rp-quote">“{run.claims[0].quote}”</p>
        </div>
      )}
    </>
  );
}

export function StopsBody({ run }: { run: RunRecord }) {
  const hover = useStore((s) => s.runHoverStop);
  const e = run.edit;
  if (!e || !e.stops.length) return null;
  const { set, flyTo } = useStore.getState();
  return (
    <>
      <ol className="rp-stops">
        {e.stops.map((s, i) => {
          const kind = KIND.get(s.gazetteerId);
          return (
            <li key={`${s.gazetteerId}-${i}`}>
              <button
                className={`rp-place${hover === i ? " is-hover" : ""}`}
                style={{ "--i": i } as CSSProperties}
                title={`${kind ? KIND_LABEL[kind] : "Unknown place"}. Click to see it on the map.`}
                onMouseEnter={() => set({ runHoverStop: i })}
                onMouseLeave={() => set({ runHoverStop: null })}
                onFocus={() => set({ runHoverStop: i })}
                onBlur={() => set({ runHoverStop: null })}
                onClick={() => flyTo({ longitude: s.coord[0], latitude: s.coord[1], zoom: 15.5 }, 900)}
              >
                <span className="rp-place-kind">
                  <KindIcon kind={kind} />
                </span>
                <span className="rp-place-name">{s.name}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {run.stopProblems.length > 0 && (
        <ul className="rp-problems">
          {run.stopProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function EditBody({ run }: { run: RunRecord }) {
  const network = useStore((s) => s.network);
  const e = run.edit;
  if (!e) return null;
  const byId = new Map(network?.roads.map((r) => [r.id, r]) ?? []);
  // Group the affected road segments by street name.
  const groups = new Map<string, number[]>();
  for (const id of e.roadIds ?? []) {
    const r = byId.get(id);
    const name = r?.name || "Unnamed road";
    const g = groups.get(name) ?? [];
    if (r?.lanes) g.push(r.lanes);
    groups.set(name, g);
  }
  const lanes = (l: number[]) => {
    if (!l.length) return "lanes unknown";
    const lo = Math.min(...l);
    const hi = Math.max(...l);
    const fmt = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);
    return e.lanesRemoved ? `${fmt(lo, hi)} → ${fmt(Math.max(0, lo - e.lanesRemoved), Math.max(0, hi - e.lanesRemoved))} lanes` : `${fmt(lo, hi)} lanes`;
  };
  return (
    <dl className="rp-kv">
      {e.stops.length > 1 && (
        <>
          <dt>Length, stop to stop</dt>
          <dd>{stopsKm(e.stops).toFixed(1)} km</dd>
        </>
      )}
      {[...groups].map(([name, l]) => (
        <span key={name} style={{ display: "contents" }}>
          <dt>{name}</dt>
          <dd>{lanes(l)}</dd>
        </span>
      ))}
      {e.chargeZone && (
        <>
          <dt>Charge zone</dt>
          <dd>Drawn on the map</dd>
        </>
      )}
    </dl>
  );
}

export function RouteBody({ run }: { run: RunRecord }) {
  const r = run.result;
  if (!r) return null;
  const b = r.metrics.baseline;
  const p = r.metrics.proposed;
  return (
    <dl className="rp-kv">
      <dt>Average commute</dt>
      <dd>
        {b.avgCommuteMin.toFixed(1)} → {p.avgCommuteMin.toFixed(1)} min
      </dd>
      <dt>Share on transit</dt>
      <dd>
        {pct1(b.transitShare)} → {pct1(p.transitShare)}
      </dd>
      <dt>Transit riders a day</dt>
      <dd>
        {int(b.dailyTransitRiders)} → {int(p.dailyTransitRiders)}
      </dd>
      {run.file && (
        <>
          <dt>Simulator replied in</dt>
          <dd>{fmtDur(run.routeMs ?? 0)}</dd>
          <dt>Result loaded in ({mb(run.file.bytes)})</dt>
          <dd>{fmtDur(run.file.ms)}</dd>
        </>
      )}
      {!r.isMock && !!r.mockSections?.length && (
        <>
          <dt>Parts using sample numbers</dt>
          <dd>{r.mockSections.length}</dd>
        </>
      )}
    </dl>
  );
}

export function ScoreBody({ run }: { run: RunRecord }) {
  const r = run.result;
  if (!r) return null;
  const { set } = useStore.getState();
  return (
    <ul className="rp-tests">
      {r.verdict.tests.map((t, i) => {
        const zone = TEST_ZONE[t.key];
        const p = plain(t);
        const sample = r.isMock || isMockSection(r, `verdict.tests.${t.key}`);
        return (
          <li
            key={t.key}
            className={`rp-test${zone ? " is-linked" : ""}`}
            style={{ "--i": i } as CSSProperties}
            onMouseEnter={zone ? () => set({ highlightZone: zone }) : undefined}
            onMouseLeave={zone ? () => set({ highlightZone: null }) : undefined}
          >
            <span className="rp-test-label">
              {p.num ? `${p.num.fmt(p.num.value)} ` : ""}
              {p.text}
            </span>
            <span className={`rp-test-val is-${t.grade}`}>
              {/^(Not applicable|Baseline)/.test(t.sublabel) ? "" : GRADE_WORD[t.grade]}
              {sample && <span className="rp-tag"> sample</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
