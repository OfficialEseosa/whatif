"use client";
/** Full-screen map with floating controls. Layout only; data comes from the store and hooks. */
import { useBootData } from "@/hooks/useBootData";
import { useClock } from "@/hooks/useClock";
import { Banner } from "./Banner";
import { CommandBar } from "./CommandBar";
import { MapStage } from "./MapStage";
import { NavCluster } from "./NavCluster";
import { StatusBar } from "./StatusBar";
import { TimeScrubber } from "./TimeScrubber";
import { ToolRail } from "./ToolRail";
import { OverlayNote } from "./map/OverlayNote";
import { ResultsPanel } from "./results/ResultsPanel";

export function Console() {
  useBootData();
  useClock();
  return (
    <div className="earth">
      <MapStage />
      <div className="left">
        <header className="top">
          <Banner />
          <CommandBar />
        </header>
        <ToolRail />
      </div>
      <ResultsPanel />
      <OverlayNote />
      <div className="dock">
        <span className="dock-side" />
        <TimeScrubber />
        <NavCluster />
      </div>
      <StatusBar />
    </div>
  );
}
