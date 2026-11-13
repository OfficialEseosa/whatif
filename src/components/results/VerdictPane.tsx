import type { Alternative, ClaimCheck, Verdict } from "@/lib/contract";
import { formatValue } from "@/lib/format";

export function VerdictPane({ verdict, claims, onAlternative }: { verdict: Verdict; claims: ClaimCheck[]; onAlternative: (a: Alternative) => void }) {
  return (
    <div className="stack-md">
      {claims.length > 0 && <ClaimCheckList claims={claims} />}
      <div className="stack-sm">
        <span className={`badge grade-${verdict.label === "good" ? "good" : verdict.label === "poor" ? "poor" : "fair"}`}>{verdict.label}</span>
        <h2 className="h2">{verdict.headline}</h2>
        <p className="muted small">{verdict.summary}</p>
      </div>
      <table className="table">
        <tbody>
          {verdict.tests.map((t) => (
            <tr key={t.key}>
              <td>
                {t.label}
                <div className="small muted">{t.sublabel}</div>
              </td>
              <td className="mono num">{formatValue(t.value, t.unit)}</td>
              <td>
                <span className={`badge grade-${t.grade}`}>{t.grade}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stack-sm">
        <div className="eyebrow">Three plans that score better</div>
        {verdict.alternatives.map((a) => (
          <button key={a.id} className="card" onClick={() => onAlternative(a)} disabled={!a.edit} title={a.edit ? "Run this plan" : "No edit attached yet"}>
            <strong>{a.title}</strong>
            <span className="small muted">{a.detail}</span>
            <span className="small mono">{a.highlights.join(" · ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ClaimCheckList({ claims }: { claims: ClaimCheck[] }) {
  return (
    <div className="stack-sm">
      <div className="eyebrow">Checking the article&apos;s claims</div>
      <ul className="list stack-sm">
        {claims.map((c) => (
          <li key={c.id} className="card">
            <q>{c.quote}</q>
            <span className="small">
              <span className={`badge rating-${c.rating}`}>{c.rating}</span> Article: {c.claimed} · Model: {c.measured}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
