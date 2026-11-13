"use client";
import { useStore, selectMapScenario } from "@/lib/store";
import { SOURCE_LABEL, scenarioSource } from "@/lib/provenance";

export function Banner() {
  const scenario = useStore(selectMapScenario);
  const built = useStore((s) => s.scenario !== null);
  const error = useStore((s) => s.error);
  const m = scenario?.metrics.baseline;
  const source = scenario ? scenarioSource(scenario) : null;
  return (
    <header className="banner">
      <h1 className="banner-title">WhatIf ATL</h1>
      {scenario && source && (
        <span className={`badge badge-source source-${source}`} title={`Showing: ${scenario.title}`}>
          {built ? "" : "Today's network · "}
          {SOURCE_LABEL[source]}
        </span>
      )}
      {scenario && !scenario.isMock && (scenario.mockSections?.length ?? 0) > 0 && (
        <span className="badge badge-mock-section" title={scenario.mockSections!.join(", ")}>
          some sections still mock
        </span>
      )}
      <span className="spacer" />
      {error && <span className="badge badge-error" role="alert">{error}</span>}
      {m && (
        <span className="muted mono">
          Modeled {m.populationModeled.toLocaleString("en-US")} commuters · showing {m.displaySampleSize.toLocaleString("en-US")}
        </span>
      )}
    </header>
  );
}
