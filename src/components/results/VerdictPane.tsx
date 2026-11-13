import type { Alternative, ClaimCheck, Verdict } from "@/lib/contract";
import { formatValue } from "@/lib/format";
import { MockTag } from "../MockTag";

type MockFn = (key: string) => boolean;

const VERDICT_WORD = { good: "A good plan", mixed: "A mixed plan", poor: "A poor plan" } as const;
const RATING_WORD = { accurate: "Accurate", overstated: "Overstated", understated: "Understated", partly: "Partly", unsupported: "Can't check" } as const;

export function VerdictPane({
  verdict,
  claims,
  onAlternative,
  isMock,
}: {
  verdict: Verdict;
  claims: ClaimCheck[];
  onAlternative: (a: Alternative) => void;
  isMock: MockFn;
}) {
  const textMock = isMock("verdict.headline") || isMock("verdict.summary") || isMock("verdict.label");
  const grade = verdict.label === "good" ? "good" : verdict.label === "poor" ? "poor" : "fair";
  return (
    <div className="stack-md">
      <div className={`stack-sm ${textMock ? "is-mock-section" : ""}`}>
        <span className="row gap-sm">
          <span className={`verdict-word grade-${grade}`}>{VERDICT_WORD[verdict.label]}</span>
          <MockTag show={textMock} what="the verdict label, headline and summary" />
        </span>
        <p className="verdict-headline">{verdict.headline}</p>
        <p className="muted small">{verdict.summary}</p>
      </div>
      {claims.length > 0 && <ClaimCheckList claims={claims} mock={isMock("claims")} />}
      <div className="stack-sm">
        <h3 className="eyebrow">Five tests</h3>
        <table className="table">
          <tbody>
            {verdict.tests.map((t) => {
              const valueMock = isMock(`verdict.tests.${t.key}`);
              const gradeMock = valueMock || isMock("verdict.grades");
              return (
                <tr key={t.key} className={valueMock ? "is-mock-section" : undefined}>
                  <td>
                    {t.label}
                    <div className="small muted">{t.sublabel}</div>
                  </td>
                  <td className="mono num">
                    {formatValue(t.value, t.unit)}
                    <MockTag show={valueMock} what={`the ${t.label.toLowerCase()} value`} />
                  </td>
                  <td className="num">
                    <span className={`badge grade-${t.grade}`} title={gradeMock ? "Grade is a mock placeholder" : undefined}>
                      {t.grade}
                      {gradeMock ? "*" : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isMock("verdict.grades") && <p className="small muted">* grade is a mock placeholder, not computed from the value shown.</p>}
      </div>
      <div className={`stack-sm ${isMock("verdict.alternatives") ? "is-mock-section" : ""}`}>
        <h3 className="eyebrow">
          Three plans that score better <MockTag show={isMock("verdict.alternatives")} what="the alternative plans" />
        </h3>
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

export function ClaimCheckList({ claims, mock }: { claims: ClaimCheck[]; mock: boolean }) {
  return (
    <div className={`stack-sm ${mock ? "is-mock-section" : ""}`}>
      <h3 className="eyebrow">
        What the article claims, and what the model measures <MockTag show={mock} what="the claim check" />
      </h3>
      <ul className="list stack-sm">
        {claims.map((c) => (
          <li key={c.id} className="claim">
            <div className="row gap-sm">
              <q className="grow">{c.quote}</q>
              <span className={`badge rating-${c.rating}`}>{RATING_WORD[c.rating]}</span>
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
