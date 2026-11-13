"use client";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";
import { PipelineOverlay } from "./map/PipelineOverlay";
import { Legend } from "./map/Legend";
import { OverlayNote } from "./map/OverlayNote";

// deck.gl touches WebGL/window: client only.
const DeckMap = dynamic(() => import("./map/DeckMap"), {
  ssr: false,
  loading: () => <div className="map-loading muted">Loading map…</div>,
});

const HAS_KEY = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export function MapStage() {
  const view = useStore((s) => s.view);
  const underground = useStore((s) => s.underground);
  const set = useStore((s) => s.set);
  return (
    <div className="map-stage">
      <DeckMap />
      <div className="map-ui map-ui-tr row gap-sm" role="group" aria-label="Map view">
        <button className="btn btn-toggle" aria-pressed={view === "analysis"} onClick={() => set({ view: "analysis" })}>
          Analysis
        </button>
        <button
          className="btn btn-toggle"
          aria-pressed={view === "photoreal"}
          onClick={() => set({ view: "photoreal" })}
          title={HAS_KEY ? "Google Photorealistic 3D Tiles" : "Needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; showing the keyless map tilted"}
        >
          Photoreal 3D{HAS_KEY ? "" : " (no key)"}
        </button>
        <button
          className="btn btn-toggle"
          aria-pressed={underground}
          onClick={() => set({ underground: !underground })}
          title="Fade the surface to show MARTA tunnels and trains below ground"
        >
          Underground
        </button>
      </div>
      <PipelineOverlay />
      <Legend />
      <OverlayNote />
    </div>
  );
}
