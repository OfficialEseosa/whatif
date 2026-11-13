"use client";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import { useStore, type ResultsTab } from "@/lib/store";
import { CloseIcon } from "../icons";
import { PipelineOverlay } from "../map/PipelineOverlay";
import { VerdictPane } from "./VerdictPane";
import { ImpactPane } from "./ImpactPane";
import { WhoPaysPane } from "./WhoPaysPane";
import { TownHallPane } from "./TownHallPane";
import { PersonaChat } from "./PersonaChat";

const TABS: { id: ResultsTab; label: string }[] = [
  { id: "verdict", label: "Verdict" },
  { id: "impact", label: "Impact" },
  { id: "whoPays", label: "Who pays" },
  { id: "townHall", label: "Town hall" },
];

/** Card on the right: build progress while a plan runs, then the results. Hidden until a plan is built. */
export function ResultsPanel() {
  const scenario = useStore((s) => s.scenario);
  const phase = useStore((s) => s.phase);
  const tab = useStore((s) => s.tab);
  const open = useStore((s) => s.resultsOpen);
  const highlightZone = useStore((s) => s.highlightZone);
  const chatOpen = useStore((s) => s.chat !== null);
  const { set, openChat } = useStore.getState();
  const build = useBuildFlow();
  const ready = scenario && (phase === "done" || phase === "building");

  if (phase === "idle" || (phase === "error" && !scenario)) return null;
  if (!open)
    return (
      <button className="results-reopen surface" onClick={() => set({ resultsOpen: true })}>
        Show results
      </button>
    );

  return (
    <section className="results surface" aria-label="Results">
      <div className="results-head">
        <h2 className="h2 grow">{ready ? scenario.title : "Building your plan"}</h2>
        <button className="icon-btn icon-btn-sm" aria-label="Hide results" onClick={() => set({ resultsOpen: false })}>
          <CloseIcon />
        </button>
      </div>
      {!ready ? (
        <div className="pane">
          <PipelineOverlay />
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => set({ tab: t.id, highlightZone: null })}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="scroll pane">
            {tab === "verdict" ? (
              <VerdictPane verdict={scenario.verdict} claims={scenario.claims} onAlternative={(alt) => alt.edit && build(alt.edit)} />
            ) : tab === "impact" ? (
              <ImpactPane impact={scenario.impact} metrics={scenario.metrics} />
            ) : tab === "whoPays" ? (
              <WhoPaysPane whoPays={scenario.whoPays} highlightZone={highlightZone} onHighlight={(z) => set({ highlightZone: z })} />
            ) : (
              <TownHallPane
                personas={scenario.personas}
                onSelect={(p) => {
                  openChat(p.id);
                  set({ camera: { longitude: p.home[0], latitude: p.home[1], zoom: 15, pitch: 50, bearing: -20, transitionDuration: 1200 } });
                }}
              />
            )}
          </div>
          {chatOpen && <PersonaChat personas={scenario.personas} />}
        </>
      )}
    </section>
  );
}
