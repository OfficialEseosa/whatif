"use client";
import { useEffect } from "react";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import { useStore } from "@/lib/store";
import { isMockSection, scenarioSource } from "@/lib/provenance";
import type { LngLat, ScenarioSource } from "@/lib/contract";
import { ChevronDownIcon, CloseIcon } from "../icons";
import { useUi, type UiTab } from "../uiStore";
import { Alternatives, ClaimCheckList, TestRows, VERDICT_GRADE, VERDICT_WORD } from "./VerdictPane";
import { ImpactPane } from "./ImpactPane";
import { WhoPaysPane } from "./WhoPaysPane";
import { TownHallPane } from "./TownHallPane";
import { PersonaChat } from "./PersonaChat";

const SOURCE_SHORT: Record<ScenarioSource, string> = { live_sim: "Live simulation", prebaked_sim: "Saved run", mock: "Sample data" };

/** One compact card on the right once a plan has run: verdict, headline, five tests; the rest under Details. */
export function ResultsPanel() {
  const scenario = useStore((s) => s.scenario);
  const phase = useStore((s) => s.phase);
  const open = useStore((s) => s.resultsOpen);
  const set = useStore((s) => s.set);
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
  const source = scenarioSource(scenario);
  const hasClaims = scenario.claims.length > 0;
  const anyMock = scenario.isMock || (scenario.mockSections?.length ?? 0) > 0;

  // A result from an article opens on its claim check; anything else opens collapsed.
  useEffect(() => {
    setUi(scenario.claims.length > 0 ? { details: true, tab: "claims" } : { details: false, tab: "impact" });
  }, [scenario.id, scenario.claims.length, setUi]);

  const tabs: { id: UiTab; label: string }[] = [
    ...(hasClaims ? [{ id: "claims" as const, label: "Article check" }] : []),
    { id: "impact", label: "Impact" },
    { id: "whoPays", label: "Who pays" },
    { id: "townHall", label: "Residents" },
    { id: "better", label: "Alternatives" },
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
      <p className="verdict-headline">{v.headline}</p>

      <div className="results-tests">
        <TestRows verdict={v} />
      </div>

      <div className="results-foot">
        <span className={`source source-${anyMock ? "mock" : source}`}>{anyMock ? "Sample data" : SOURCE_SHORT[source]}</span>
        <button className="btn details-btn" aria-expanded={details} onClick={() => setUi({ details: !details })}>
          {details ? "Hide details" : "Details"}
          <ChevronDownIcon />
        </button>
      </div>
      {details && (
        <div className="details">
          <div className="tabs" role="tablist" aria-label="Details">
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
