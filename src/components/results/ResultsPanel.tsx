"use client";
import { useEffect } from "react";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import { DEFAULT_TEXT, selectActiveRun, useStore, type RunRecord } from "@/lib/store";
import { isMockSection, scenarioSource } from "@/lib/provenance";
import type { LngLat, ScenarioSource } from "@/lib/contract";
import { ChevronDownIcon, CloseIcon } from "../icons";
import { focusComposer, useUi, type UiTab } from "../uiStore";
import { editLine, notSimulatedText, planLine } from "../run/runFormat";
import { Alternatives, ClaimCheckList, TestRows, VERDICT_GRADE, VERDICT_WORD, verdictReason } from "./VerdictPane";
import { ImpactPane } from "./ImpactPane";
import { WhoPaysPane } from "./WhoPaysPane";
import { TownHallPane } from "./TownHallPane";
import { PersonaChat } from "./PersonaChat";
import "./results.css";

const SOURCE_SHORT: Record<ScenarioSource, string> = { live_sim: "Live simulation", prebaked_sim: "Saved run", mock: "Sample numbers, not a real run" };
const SOURCE_HINT: Record<ScenarioSource, string> = {
  live_sim: "Simulated just now for this plan",
  prebaked_sim: "Simulated earlier and saved",
  mock: "Placeholder numbers to show the layout, not a simulation of this plan",
};

/** One compact card on the right once a plan has run: verdict, headline, five tests; the rest under Details. */
export function ResultsPanel() {
  const scenario = useStore((s) => s.scenario);
  const phase = useStore((s) => s.phase);
  const open = useStore((s) => s.resultsOpen);
  const set = useStore((s) => s.set);
  const run = useStore(selectActiveRun);
  const preview = !scenario && phase === "done" && run?.notSimulated && run.edit ? run : null;
  if (preview)
    return open ? (
      <NotSimulated run={preview} />
    ) : (
      <button className="surface results-chip" onClick={() => set({ resultsOpen: true })}>
        Show plan
      </button>
    );
  if (!scenario || !(phase === "done" || phase === "building" || phase === "error")) return null;
  if (!open)
    return (
      <button className="surface results-chip" onClick={() => set({ resultsOpen: true })}>
        Show results
      </button>
    );
  return <Card />;
}

function Card() {
  const scenario = useStore((s) => s.scenario)!;
  const highlightZone = useStore((s) => s.highlightZone);
  // Claude's plain summary of this result, once it has arrived; the simulator's own headline until then.
  const insight = useStore((s) => {
    const run = selectActiveRun(s);
    return run && run.result === s.scenario ? run.insight : null;
  });
  const chatOpen = useStore((s) => s.chat !== null);
  const bbox = useStore((s) => s.network?.bbox);
  const details = useUi((s) => s.details);
  const tab = useUi((s) => s.tab);
  const setUi = useUi((s) => s.setUi);
  const { set, openChat } = useStore.getState();
  const build = useBuildFlow();
  const mk = (key: string) => isMockSection(scenario, key);
  const inBox = (p: LngLat) => !bbox || (p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3]);
  const v = scenario.verdict;
  const grade = VERDICT_GRADE[v.label];
  const reason = verdictReason(v);
  const source = scenarioSource(scenario);
  const hasClaims = scenario.claims.length > 0;
  const anyMock = scenario.isMock || (scenario.mockSections?.length ?? 0) > 0;

  // A result from an article opens on its claim check; anything else opens collapsed.
  useEffect(() => {
    setUi(scenario.claims.length > 0 ? { details: true, tab: "claims" } : { details: false, tab: "impact" });
  }, [scenario.id, scenario.claims.length, setUi]);

  const tabs: { id: UiTab; label: string }[] = [
    ...(hasClaims ? [{ id: "claims" as const, label: "Fact check" }] : []),
    { id: "impact", label: "Travel" },
    { id: "whoPays", label: "Who pays" },
    { id: "townHall", label: "Ask residents" },
    { id: "better", label: "Better options" },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  const pick = (t: UiTab) => {
    setUi({ tab: t });
    set({ tab: t === "whoPays" || t === "impact" || t === "townHall" ? t : "verdict", highlightZone: null });
  };

  return (
    <aside className="surface results" aria-label="Results" data-details={details}>
      <header className="results-head">
        <div className="grow">
          <h2 className={`verdict-word grade-text-${grade}`}>{VERDICT_WORD[v.label]}</h2>
          <p className="results-title">{scenario.title}</p>
        </div>
        <button className="icon-btn" aria-label="Close results" onClick={() => set({ resultsOpen: false })}>
          <CloseIcon />
        </button>
      </header>
      <p className="verdict-headline">{insight?.summary ?? v.headline}</p>
      {!insight && reason && <p className="verdict-reason">{reason}</p>}

      <div className="results-tests">
        <TestRows verdict={v} />
      </div>

      <div className="results-foot">
        <span className={`source source-${anyMock ? "mock" : source}`} title={SOURCE_HINT[anyMock ? "mock" : source]}>
          {SOURCE_SHORT[anyMock ? "mock" : source]}
        </span>
        <button className="btn details-btn" aria-expanded={details} onClick={() => setUi({ details: !details })}>
          {details ? "Hide breakdown" : "See the full breakdown"}
          <ChevronDownIcon />
        </button>
      </div>
      {details && (
        <div className="details">
          <div className="tabs" role="tablist" aria-label="Full breakdown">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                className="tab"
                aria-selected={current === t.id}
                tabIndex={current === t.id ? 0 : -1}
                onClick={() => pick(t.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  const i = tabs.findIndex((x) => x.id === current);
                  const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                  pick(next.id);
                  (e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement | undefined)?.focus();
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="scroll pane" role="tabpanel" key={current}>
            {current === "claims" ? (
              <ClaimCheckList claims={scenario.claims} mock={mk("claims")} />
            ) : current === "impact" ? (
              <ImpactPane impact={scenario.impact} metrics={scenario.metrics} isMock={mk} />
            ) : current === "whoPays" ? (
              <WhoPaysPane whoPays={scenario.whoPays} highlightZone={highlightZone} onHighlight={(z) => set({ highlightZone: z })} isMock={mk} />
            ) : current === "better" ? (
              <Alternatives alternatives={v.alternatives} onAlternative={(alt) => alt.edit && build(alt.edit)} mock={mk("verdict.alternatives")} />
            ) : (
              <TownHallPane
                personas={scenario.personas}
                mock={mk("personas")}
                onSelect={(p) => {
                  openChat(p.id);
                  // Persona agentIds may not exist in this run (sim output copies mock personas): fall back to persona.home.
                  const agent = p.agentId ? scenario.agents.find((a) => a.id === p.agentId) : undefined;
                  const target = agent && inBox(agent.home) ? agent.home : p.home;
                  if (inBox(target)) set({ camera: { longitude: target[0], latitude: target[1], zoom: 15, pitch: 50, bearing: -20, transitionDuration: 1200 } });
                }}
              />
            )}
          </div>
          {chatOpen && current === "townHall" && <PersonaChat personas={scenario.personas} />}
        </div>
      )}
    </aside>
  );
}

/** A plan the parser understood but the server has no simulation for: the plan itself, no numbers. */
function NotSimulated({ run }: { run: RunRecord }) {
  const network = useStore((s) => s.network);
  const set = useStore((s) => s.set);
  const e = run.edit!;
  const why = notSimulatedText(run);
  const tryStreetcar = () => {
    set({ text: DEFAULT_TEXT.prompt });
    requestAnimationFrame(focusComposer);
  };
  return (
    <aside className="surface results" aria-label="Results">
      <header className="results-head">
        <div className="grow">
          <h2 className="verdict-word">No results for this plan</h2>
          <p className="results-title">{e.name}</p>
        </div>
        <button className="icon-btn" aria-label="Close results" onClick={() => set({ resultsOpen: false })}>
          <CloseIcon />
        </button>
      </header>
      <p className="verdict-headline">
        {e.type === "change_frequency" ? `${editLine(e, network)}.` : `${planLine(e)}. ${editLine(e, network)}.`}
      </p>
      <p className="verdict-reason">We understood the plan and drew it on the map, but could not test it. {why.reason}</p>
      <div className="results-foot results-actions">
        {/* The only plan with a saved simulation run today (public/scenarios/beltline-streetcar.sim.json). */}
        <button className="btn" onClick={tryStreetcar}>
          Try the streetcar example
        </button>
        <button className="btn" onClick={focusComposer}>
          Change my plan
        </button>
      </div>
    </aside>
  );
}
