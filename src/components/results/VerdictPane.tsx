"use client";
import { useEffect, useState } from "react";
import type { Alternative, ClaimCheck, Verdict, VerdictTest } from "@/lib/contract";
import { prefersReducedMotion } from "@/hooks/useReducedMotion";

export const VERDICT_WORD = { good: "Good plan", mixed: "Mixed plan", poor: "Poor plan" } as const;
export const VERDICT_GRADE = { good: "good", mixed: "fair", poor: "poor" } as const;

/** Counts a number up from 0 over 600 ms (instant under reduced motion). */
function CountUp({ value, fmt }: { value: number; fmt: (n: number) => string }) {
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
  return <>{fmt(k >= 1 ? value : value * k)}</>;
}

const RATING_WORD = { accurate: "Accurate", overstated: "Overstated", understated: "Understated", partly: "Partly true", unsupported: "Can't check" } as const;

const GRADE_WORD = { good: "Good", fair: "Fair", poor: "Poor" } as const;

const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const notScored = (t: VerdictTest) => /^(Not applicable|Baseline)/.test(t.sublabel);

type Plain = { num?: { value: number; fmt: (n: number) => string }; text: string };

/** One test as a plain statement: an optional leading number, then what it means. */
export function plain(t: VerdictTest): Plain {
  if (t.sublabel.startsWith("Baseline")) return { text: t.label };
  if (t.sublabel.startsWith("Not applicable")) return { text: `${t.label}: does not apply to this plan` };
  const n = Math.round(Math.abs(t.value));
  switch (t.key) {
    case "time_saved":
      if (n === 0) return { text: "No real change in commute time" };
      return { num: { value: Math.abs(t.value), fmt: whole }, text: `${n === 1 ? "hour" : "hours"} of commuting ${t.value < 0 ? "added" : "saved"} per day` };
    case "new_riders":
      if (t.value < 0.5) return { text: "Nobody switches to transit" };
      return { num: { value: t.value, fmt: whole }, text: n === 1 ? "person a day switches to transit" : "people a day switch to transit" };
    case "cost_per_rider":
      if (t.value <= 0) return { text: "No new riders to spread the cost over" };
      return { num: { value: t.value, fmt: (x) => (t.value < 20 ? `$${x.toFixed(2)}` : `$${whole(x)}`) }, text: "per new transit trip" };
    case "redlined_benefit_share":
      if (t.value * 100 < 0.5) return { text: "None of the time savings reach formerly redlined neighborhoods" };
      return { num: { value: t.value, fmt: (x) => `${Math.round(x * 100)}%` }, text: "of the time savings reach formerly redlined neighborhoods" };
    case "renters_rent_pressure":
      if (n === 0) return { text: "No renter households near new stops face rising rent" };
      return { num: { value: t.value, fmt: whole }, text: `renter ${n === 1 ? "household" : "households"} near new stops may face rising rent` };
  }
}

/** Why the plan got its verdict, in one sentence. Null when the grades do not follow the sim's rule (sim/verdict.py). */
export function verdictReason(v: Verdict): string | null {
  const by = Object.fromEntries(v.tests.map((t) => [t.key, t])) as Record<VerdictTest["key"], VerdictTest | undefined>;
  if (v.tests.some((t) => t.sublabel.startsWith("Baseline"))) return null;
  const count = (g: VerdictTest["grade"]) => v.tests.filter((t) => t.grade === g).length;
  const timePoor = by.time_saved?.grade === "poor";
  const costPoor = by.new_riders?.grade === "poor" && by.cost_per_rider?.grade === "poor" && !notScored(by.cost_per_rider);
  const corePoor = [by.time_saved, by.new_riders, by.cost_per_rider].some((t) => t?.grade === "poor");
  const rule = timePoor || costPoor ? "poor" : count("good") >= 3 && !corePoor ? "good" : "mixed";
  if (rule !== v.label) return null;
  if (timePoor) return "Poor because commuters lose time overall.";
  if (costPoor) return "Poor because it draws few new riders at a high cost per trip.";
  if (rule === "good") return `Good because ${count("good")} of the 5 tests are good, and time, riders and cost all hold up.`;
  const split = (["good", "fair", "poor"] as const).filter((g) => count(g) > 0).map((g) => `${count(g)} ${g}`);
  return `Mixed because the tests split: ${split.join(", ")}.`;
}

/** The five tests: a plain statement left, grade right. */
export function TestRows({ verdict }: { verdict: Verdict }) {
  return (
    <ul className="list tests">
      {verdict.tests.map((t, i) => {
        const p = plain(t);
        return (
          <li key={t.key} className="test" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="test-label">
              {p.num && (
                <span className="test-value" style={{ minWidth: `${p.num.fmt(p.num.value).length}ch` }}>
                  <CountUp value={p.num.value} fmt={p.num.fmt} />
                </span>
              )}
              {p.num ? " " : ""}
              {p.text}
            </span>
            {!notScored(t) && <span className={`test-grade grade-text-${t.grade}`}>{GRADE_WORD[t.grade]}</span>}
          </li>
        );
      })}
    </ul>
  );
}
export function Alternatives({ alternatives, onAlternative }: { alternatives: Alternative[]; onAlternative: (a: Alternative) => void; mock?: boolean }) {
  if (!alternatives.length) return <p className="muted">No better options found for this plan.</p>;
  return (
    <div className="stack-sm">
      <ul className="list stack-sm">
        {alternatives.map((a) => (
          <li key={a.id}>
            <button className="item" onClick={() => onAlternative(a)} disabled={!a.edit} title={a.edit ? "Test this option instead" : "This option can't be tested yet"}>
              <span className="item-row">
                <strong className="grow">{a.title}</strong>
                {a.edit && <span className="item-go">Try this instead</span>}
              </span>
              <span className="item-detail">{a.detail}</span>
              {a.highlights.length > 0 && <span className="item-meta num">{a.highlights.join(", ")}</span>}
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
                <dt>Our simulation shows</dt>
                <dd className="num">{c.measured}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
