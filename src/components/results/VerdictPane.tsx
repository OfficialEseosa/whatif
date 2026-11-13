import type { Alternative, ClaimCheck, Verdict } from "@/lib/contract";
import { formatValue } from "@/lib/format";
import { MockTag } from "../MockTag";

type MockFn = (key: string) => boolean;

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
  return (
    <div className="stack-md">
      {claims.length > 0 && <ClaimCheckList claims={claims} mock={isMock("claims")} />}
      <div className={`stack-sm ${textMock ? "is-mock-section" : ""}`}>
        <span>
          <span className={`badge grade-${verdict.label === "good" ? "good" : verdict.label === "poor" ? "poor" : "fair"}`}>{verdict.label}</span>
          <MockTag show={textMock} what="the verdict label, headline and summary" />
        </span>
        <h2 className="h2">{verdict.headline}</h2>
        <p className="muted small">{verdict.summary}</p>
      </div>
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
                <td>
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
      <div className={`stack-sm ${isMock("verdict.alternatives") ? "is-mock-section" : ""}`}>
        <div className="eyebrow">
          Three plans that score better <MockTag show={isMock("verdict.alternatives")} what="the alternative plans" />
        </div>
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

export function ClaimCheckList({ claims, mock }: { claims: ClaimCheck[]; mock: boolean }) {
  return (
    <div className={`stack-sm ${mock ? "is-mock-section" : ""}`}>
      <div className="eyebrow">
        Checking the article&apos;s claims <MockTag show={mock} what="the claim check" />
      </div>
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
