"use client";
import { useBuildFlow } from "@/hooks/useBuildFlow";
import { useStore, type ResultsTab } from "@/lib/store";
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

export function ResultsPanel() {
  const scenario = useStore((s) => s.scenario);
  const phase = useStore((s) => s.phase);
  const tab = useStore((s) => s.tab);
  const highlightZone = useStore((s) => s.highlightZone);
  const chatOpen = useStore((s) => s.chat !== null);
  const { set, openChat } = useStore.getState();
  const build = useBuildFlow();
  const ready = scenario && (phase === "done" || phase === "building");

  return (
    <section className="panel results" aria-label="Results">
      <div className="row tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="btn btn-tab grow" aria-selected={tab === t.id} onClick={() => set({ tab: t.id, highlightZone: null })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="scroll pane">
        {!ready ? (
          <p className="muted">{phase === "idle" || phase === "error" ? "Type a plan and press Build it to see results." : "Working…"}</p>
        ) : tab === "verdict" ? (
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
      {chatOpen && scenario && <PersonaChat personas={scenario.personas} />}
    </section>
  );
}
