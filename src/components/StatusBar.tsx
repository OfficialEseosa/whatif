"use client";
import { dms, eyeAltitude } from "@/lib/format";
import { SOURCE_LABEL, scenarioSource } from "@/lib/provenance";
import { useStore, selectMapScenario } from "@/lib/store";

/** Bottom strip: what is modeled, where the camera is, and map credits. */
export function StatusBar() {
  const scenario = useStore(selectMapScenario);
  const live = useStore((s) => s.live);
  const attribution = useStore((s) => s.attribution);
  const built = useStore((s) => s.scenario !== null);
  const m = scenario?.metrics.baseline;
  const source = scenario ? scenarioSource(scenario) : null;
  return (
    <footer className="status">
      {scenario && source && (
        <span className={`status-source source-${source}`} title={`Showing: ${scenario.title}`}>
          {built ? "" : "Today's network: "}
          {SOURCE_LABEL[source].replace(" · ", ": ")}
        </span>
      )}
      {scenario && !scenario.isMock && (scenario.mockSections?.length ?? 0) > 0 && (
        <span className="status-mock" title={scenario.mockSections!.join(", ")}>
          Some sections still mock
        </span>
      )}
      {m && (
        <span className="status-model mono">
          Showing {m.displaySampleSize.toLocaleString("en-US")} of {m.populationModeled.toLocaleString("en-US")} modeled commuters
        </span>
      )}
      <span className="spacer" />
      <span className="status-coords mono">{dms(live.latitude, live.longitude)}</span>
      <span className="status-coords mono">Camera {eyeAltitude(live)}</span>
      <span className="status-credit">
        {/* TODO(Prosper): use Google's official logo asset per Map Tiles API policies. */}
        {attribution.google && <strong>Google </strong>}
        {attribution.text}
      </span>
    </footer>
  );
}
