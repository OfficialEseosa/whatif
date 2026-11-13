"use client";
import { useStore, selectMapScenario } from "@/lib/store";

export function Banner() {
  const scenario = useStore(selectMapScenario);
  const error = useStore((s) => s.error);
  const m = scenario?.metrics.baseline;
  return (
    <header className="banner">
      <h1 className="banner-title">WhatIf ATL</h1>
      {scenario?.isMock && <span className="badge badge-mock">Mock data · every number is a placeholder</span>}
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
