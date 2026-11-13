"use client";
import { INITIAL_CAMERA, useStore } from "@/lib/store";
import { HomeIcon, MinusIcon, PlusIcon } from "./icons";

const HAS_KEY = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/** Camera controls: home, 2D/3D, zoom, compass. */
export function NavCluster() {
  const view = useStore((s) => s.view);
  const bearing = useStore((s) => s.live.bearing);
  const { set, flyTo } = useStore.getState();
  const is3d = view === "photoreal";

  const toggle3d = () => {
    const { live } = useStore.getState();
    set({ view: is3d ? "analysis" : "photoreal" });
    flyTo({ pitch: is3d ? Math.min(live.pitch, 40) : Math.max(live.pitch, 60) }, 900);
  };
  const zoom = (d: number) => flyTo({ zoom: Math.max(2, Math.min(19, useStore.getState().live.zoom + d)) }, 300);

  return (
    <div className="nav" role="group" aria-label="Camera">
      <button className="icon-btn surface" aria-label="Fly to Atlanta" title="Fly to Atlanta" onClick={() => flyTo(INITIAL_CAMERA, 1600)}>
        <HomeIcon />
      </button>
      <button
        className="icon-btn surface nav-3d"
        aria-pressed={is3d}
        onClick={toggle3d}
        title={is3d ? "Switch to the flat analysis map" : HAS_KEY ? "Switch to Google Photorealistic 3D" : "Tilt the map (photoreal buildings need NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)"}
      >
        {is3d ? "3D" : "2D"}
      </button>
      <div className="nav-zoom surface">
        <button className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(-1)}>
          <MinusIcon />
        </button>
        <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1)}>
          <PlusIcon />
        </button>
      </div>
      <button className="icon-btn surface compass" aria-label="Face north" title="Face north" onClick={() => flyTo({ bearing: 0 }, 500)}>
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
          <path d="M13 2.5 17 13H9l4-10.5Z" fill="var(--poor)" />
          <path d="M13 23.5 9 13h8l-4 10.5Z" fill="var(--text)" opacity="0.85" />
        </svg>
      </button>
    </div>
  );
}
