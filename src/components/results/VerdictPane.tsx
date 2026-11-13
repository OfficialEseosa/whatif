"use client";
import { useEffect, useState } from "react";
import type { Alternative, ClaimCheck, Verdict } from "@/lib/contract";
import { formatValue } from "@/lib/format";
import { prefersReducedMotion } from "@/hooks/useReducedMotion";

export const VERDICT_WORD = { good: "Good plan", mixed: "Mixed plan", poor: "Poor plan" } as const;
export const VERDICT_GRADE = { good: "good", mixed: "fair", poor: "poor" } as const;

/** Counts a number up from 0 over 600 ms (instant under reduced motion). */
function CountUp({ value, unit }: { value: number; unit: string }) {
  const [k, setK] = useState(0);
  useEffect(() => {
    let raf = 0;
    if (prefersReducedMotion()) {
      raf = requestAnimationFrame(() => setK(1));
      return () => cancelAnimationFrame(raf);
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 600);
      setK(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{formatValue(k >= 1 ? value : value * k, unit)}</>;
}

const RATING_WORD = { accurate: "Accurate", overstated: "Overstated", understated: "Understated", partly: "Partly", unsupported: "Can't check" } as const;

const GRADE_WORD = { good: "Good", fair: "Fair", poor: "Poor" } as const;

/** The five tests: label left, value and grade right. */
export function TestRows({ verdict }: { verdict: Verdict }) {
  return (
    <ul className="list tests">
      {verdict.tests.map((t, i) => (
        <li key={t.key} className="test" style={{ animationDelay: `${i * 60}ms` }}>
          <span className="test-label">{t.label}</span>
          <span className="test-value">
            <CountUp value={t.value} unit={t.unit} />
          </span>
          <span className={`test-grade grade-text-${t.grade}`}>{GRADE_WORD[t.grade]}</span>
        </li>
      ))}
    </ul>
  );
}
export function Alternatives({ alternatives, onAlternative }: { alternatives: Alternative[]; onAlternative: (a: Alternative) => void; mock?: boolean }) {
  if (!alternatives.length) return <p className="muted">No alternatives.</p>;
  return (
    <div className="stack-sm">
      <ul className="list stack-sm">
        {alternatives.map((a) => (
          <li key={a.id}>
            <button className="item" onClick={() => onAlternative(a)} disabled={!a.edit} title={a.edit ? "Run this plan instead" : "No edit attached yet"}>
              <span className="item-row">
                <strong className="grow">{a.title}</strong>
                {a.edit && <span className="item-go">Run this plan</span>}
              </span>
              <span className="item-detail">{a.detail}</span>
              {a.highlights.length > 0 && <span className="item-meta num">{a.highlights.join("  ·  ")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RATING_TONE: Record<ClaimCheck["rating"], "good" | "fair" | "poor"> = {
  accurate: "good",
  partly: "fair",
  overstated: "poor",
  understated: "poor",
  unsupported: "poor",
};

export function ClaimCheckList({ claims }: { claims: ClaimCheck[]; mock?: boolean }) {
  return (
    <div className="stack-md">
      <ul className="list stack-md">
        {claims.map((c) => (
          <li key={c.id} className="claim">
            <div className="item-row">
              <q className="grow claim-quote">{c.quote}</q>
              <span className={c.rating === "unsupported" ? "grade muted" : `grade grade-${RATING_TONE[c.rating]}`}>{RATING_WORD[c.rating]}</span>
            </div>
            <dl className="claim-pair">
              <div>
                <dt>Article says</dt>
                <dd className="num">{c.claimed}</dd>
              </div>
              <div>
                <dt>Model shows</dt>
                <dd className="num">{c.measured}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
