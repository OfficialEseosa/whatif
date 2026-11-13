"use client";
import { dms, eyeAltitude } from "@/lib/format";
import { useStore, selectMapScenario } from "@/lib/store";

/** Bottom strip: what is modeled, where the camera is, and map credits. */
export function StatusBar() {
  const scenario = useStore(selectMapScenario);
  const live = useStore((s) => s.live);
  const attribution = useStore((s) => s.attribution);
  const m = scenario?.metrics.baseline;
  return (
    <footer className="status">
      {scenario?.isMock && <span className="status-mock">Mock data: every number is a placeholder</span>}
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
