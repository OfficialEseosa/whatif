import type { Alternative, ClaimCheck, Verdict } from "@/lib/contract";
import { formatValue } from "@/lib/format";

const VERDICT_WORD = { good: "A good plan", mixed: "A mixed plan", poor: "A poor plan" } as const;

export function VerdictPane({ verdict, claims, onAlternative }: { verdict: Verdict; claims: ClaimCheck[]; onAlternative: (a: Alternative) => void }) {
  const grade = verdict.label === "good" ? "good" : verdict.label === "poor" ? "poor" : "fair";
  return (
    <div className="stack-md">
      <div className="stack-sm">
        <span className={`verdict-word grade-${grade}`}>{VERDICT_WORD[verdict.label]}</span>
        <p className="verdict-headline">{verdict.headline}</p>
        <p className="muted small">{verdict.summary}</p>
      </div>
      {claims.length > 0 && <ClaimCheckList claims={claims} />}
      <div className="stack-sm">
        <h3 className="eyebrow">Five tests</h3>
        <table className="table">
          <tbody>
            {verdict.tests.map((t) => (
              <tr key={t.key}>
                <td>
                  {t.label}
                  <div className="small muted">{t.sublabel}</div>
                </td>
                <td className="mono num">{formatValue(t.value, t.unit)}</td>
                <td className="num">
                  <span className={`badge grade-${t.grade}`}>{t.grade}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stack-sm">
        <h3 className="eyebrow">Three plans that score better</h3>
        {verdict.alternatives.map((a) => (
          <button key={a.id} className="card" onClick={() => onAlternative(a)} disabled={!a.edit} title={a.edit ? "Build this plan instead" : "No edit attached yet"}>
            <strong>{a.title}</strong>
            <span className="small muted">{a.detail}</span>
            <span className="chips">
              {a.highlights.map((h) => (
                <span key={h} className="chip">
                  {h}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ClaimCheckList({ claims }: { claims: ClaimCheck[] }) {
  return (
    <div className="stack-sm">
      <h3 className="eyebrow">What the article claims, and what the model measures</h3>
      <ul className="list stack-sm">
        {claims.map((c) => (
          <li key={c.id} className="claim">
            <div className="row gap-sm">
              <q className="grow">{c.quote}</q>
              <span className={`badge rating-${c.rating}`}>{c.rating}</span>
            </div>
            <dl className="claim-pair">
              <div>
                <dt>Article</dt>
                <dd className="mono">{c.claimed}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd className="mono">{c.measured}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
