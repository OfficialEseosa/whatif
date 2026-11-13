"use client";
import dynamic from "next/dynamic";

// deck.gl touches WebGL/window: client only.
const DeckMap = dynamic(() => import("./map/DeckMap"), {
  ssr: false,
  loading: () => <div className="map-loading muted">Loading map…</div>,
});

export function MapStage() {
  return (
    <div className="map-stage">
      <DeckMap />
    </div>
  );
}
