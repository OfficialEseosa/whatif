"use client";
import { useStore, type Drawer } from "@/lib/store";
import { HistoryRail } from "./HistoryRail";
import { CloseIcon, HistoryIcon, LayersIcon } from "./icons";
import { Legend } from "./map/Legend";

const TOOLS: { id: Drawer; label: string; title: string; icon: React.ReactNode }[] = [
  { id: "history", label: "History", title: "Why does MARTA end where it does?", icon: <HistoryIcon /> },
  { id: "layers", label: "Map key", title: "What the map shows", icon: <LayersIcon /> },
];

/** Left tool rail; each tool opens a drawer beside it. */
export function ToolRail() {
  const drawer = useStore((s) => s.drawer);
  const hasOverlay = useStore((s) => s.activeHistoryId !== null);
  const toggle = useStore((s) => s.toggleDrawer);
  const open = TOOLS.find((t) => t.id === drawer);
  return (
    <div className="tools">
      <nav className="rail surface" aria-label="Map tools">
        {TOOLS.map((t) => (
          <button key={t.id} className="icon-btn" aria-pressed={drawer === t.id} aria-label={t.label} title={t.label} onClick={() => toggle(t.id)}>
            {t.icon}
            {t.id === "history" && hasOverlay && <i className="dot" />}
          </button>
        ))}
      </nav>
      {open && (
        <aside className="drawer surface" aria-label={open.label}>
          <div className="drawer-head">
            <h2 className="h2 grow">{open.title}</h2>
            <button className="icon-btn icon-btn-sm" aria-label={`Close ${open.label.toLowerCase()}`} onClick={() => toggle(open.id)}>
              <CloseIcon />
            </button>
          </div>
          {open.id === "history" ? <HistoryRail /> : <Legend />}
        </aside>
      )}
    </div>
  );
}
