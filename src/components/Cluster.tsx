"use client";
import { useStore } from "@/lib/store";
import { ClockIcon, HistoryIcon, LayersIcon } from "./icons";
import { NavCluster } from "./NavCluster";
import { useUi } from "./uiStore";

/** Top-right controls: view switch, layers, history, time, camera. */
export function Cluster() {
  const view = useStore((s) => s.view);
  const hasOverlay = useStore((s) => s.activeHistoryId !== null);
  const popover = useUi((s) => s.popover);
  const timeOpen = useUi((s) => s.timeOpen);
  const setUi = useUi((s) => s.setUi);
  const pick = (to: "analysis" | "photoreal") => {
    if (to === view) return;
    const { live, set, flyTo } = useStore.getState();
    set({ view: to });
    flyTo({ pitch: to === "photoreal" ? Math.max(live.pitch, 60) : Math.min(live.pitch, 40) }, 900);
  };
  const toggle = (p: "layers" | "history") => setUi({ popover: popover === p ? null : p });

  return (
    <nav className="cluster" aria-label="Map controls">
      <div className="seg" role="group" aria-label="Map view">
        <button className="seg-btn" aria-pressed={view === "analysis"} onClick={() => pick("analysis")}>
          Map
        </button>
        <button className="seg-btn" aria-pressed={view === "photoreal"} onClick={() => pick("photoreal")}>
          3D
        </button>
      </div>
      <button className="cbtn" aria-expanded={popover === "layers"} aria-pressed={popover === "layers"} onClick={() => toggle("layers")}>
        <LayersIcon />
        Layers
      </button>
      <button className="cbtn" aria-expanded={popover === "history"} aria-pressed={popover === "history"} onClick={() => toggle("history")}>
        <HistoryIcon />
        History
        {hasOverlay && <i className="cbtn-dot" aria-hidden="true" />}
      </button>
      <button className="cbtn" aria-pressed={timeOpen} onClick={() => setUi({ timeOpen: !timeOpen })}>
        <ClockIcon />
        Time
      </button>
      <NavCluster />
    </nav>
  );
}
