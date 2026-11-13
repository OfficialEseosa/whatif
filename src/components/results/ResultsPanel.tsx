"use client";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import { useStore, type ResultsTab } from "@/lib/store";
import { isMockSection } from "@/lib/provenance";
import type { LngLat } from "@/lib/contract";
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
  const mk = (key: string) => isMockSection(scenario, key);
  const bbox = useStore((s) => s.network?.bbox);
  const inBox = (p: LngLat) => !bbox || (p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3]);

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
              <VerdictPane verdict={scenario.verdict} claims={scenario.claims} onAlternative={(alt) => alt.edit && build(alt.edit)} isMock={mk} />
            ) : tab === "impact" ? (
              <ImpactPane impact={scenario.impact} metrics={scenario.metrics} isMock={mk} />
            ) : tab === "whoPays" ? (
              <WhoPaysPane whoPays={scenario.whoPays} highlightZone={highlightZone} onHighlight={(z) => set({ highlightZone: z })} isMock={mk} />
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
          {chatOpen && <PersonaChat personas={scenario.personas} />}
        </>
      )}
    </section>
  );
}
