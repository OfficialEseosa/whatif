"use client";
import { useEffect } from "react";
import { DEFAULT_LAYER_VISIBILITY, LAYER_META, useStore, type LayerKey } from "@/lib/store";
import { MAP_COLORS, type RGBA } from "./map/colors";
import { HistoryRail } from "./HistoryRail";
import { CloseIcon } from "./icons";
import { useUi } from "./uiStore";

const GROUPS = ["Transit", "Commuters", "After a plan is built", "Context"] as const;
const GROUP_LABEL: Record<(typeof GROUPS)[number], string> = {
  Transit: "Transit today",
  Commuters: "People commuting",
  "After a plan is built": "Your plan's effects",
  Context: "Background",
};
const css = (c: RGBA) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.6, c[3] / 255)})`;

/** On-demand surfaces opened from the control cluster: the layers popover or the history slide-over. */
export function Popovers() {
  const popover = useUi((s) => s.popover);
  const setUi = useUi((s) => s.setUi);
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUi({ popover: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover, setUi]);
  if (popover === "layers") return <LayersPopover />;
  if (popover === "history") return <HistorySheet />;
  return null;
}

function LayersPopover() {
  const vis = useStore((s) => s.layerVisibility);
  const toggle = useStore((s) => s.toggleLayer);
  const underground = useStore((s) => s.underground);
  const built = useStore((s) => s.scenario !== null);
  const keys = Object.keys(LAYER_META) as LayerKey[];
  return (
    <div className="surface pop layers" role="dialog" aria-label="Map layers">
      <div className="pop-head">
        <h2 className="pop-title">Show on map</h2>
        <button
          className="text-btn"
          title="Turn layers back to the starting set and hide any history overlay"
          onClick={() => useStore.getState().set({ layerVisibility: { ...DEFAULT_LAYER_VISIBILITY }, activeHistoryId: null, highlightZone: null, underground: false })}
        >
          Reset layers
        </button>
      </div>
      <div className="scroll pop-body">
        {GROUPS.map((g) => {
          const rows = keys.filter((k) => LAYER_META[k].group === g);
          if (!rows.length) return null;
          return (
            <section key={g} className="layer-group">
              <h3 className="group-title">{GROUP_LABEL[g]}</h3>
              {g === "After a plan is built" && !built && <p className="pop-note">Available after you build a plan.</p>}
              <ul className="list">
                {rows.map((k) => {
                  const meta = LAYER_META[k];
                  const locked = !!meta.requiresResult && !built;
                  const color = meta.colorKey ? (MAP_COLORS as Record<string, unknown>)[meta.colorKey] : undefined;
                  return (
                    <li key={k}>
                      <label className="layer-row" data-locked={locked} title={locked ? "Build a plan first to see this" : undefined}>
                        <i
                          className={`swatch swatch-${k}`}
                          style={Array.isArray(color) ? ({ "--sw": css(color as RGBA) } as React.CSSProperties) : undefined}
                          aria-hidden="true"
                        />
                        <span className="layer-name">{meta.label}</span>
                        <input type="checkbox" role="switch" className="switch" checked={vis[k] && !locked} disabled={locked} onChange={() => toggle(k)} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <section className="layer-group">
          <label className="layer-row" title="See through the ground to tunnels and underground stations">
            <i className="swatch swatch-underground" aria-hidden="true" />
            <span className="layer-name">See underground</span>
            <input type="checkbox" role="switch" className="switch" checked={underground} onChange={() => useStore.getState().set({ underground: !underground })} />
          </label>
        </section>
      </div>
    </div>
  );
}

function HistorySheet() {
  const count = useStore((s) => s.history.length);
  return (
    <aside className="surface sheet" aria-label="History">
      <div className="pop-head">
        <div className="grow">
          <h2 className="pop-title">History</h2>
          <p className="pop-sub">{count} past decisions that shaped today&apos;s map, such as redlining and highways. Pick one to show it on the map.</p>
        </div>
        <button className="icon-btn" aria-label="Close history" onClick={() => useUi.getState().setUi({ popover: null })}>
          <CloseIcon />
        </button>
      </div>
      <HistoryRail />
    </aside>
  );
}
