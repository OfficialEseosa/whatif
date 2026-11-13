"use client";
/** One-screen console. Layout only; data comes from the store and hooks. */
import { useBootData } from "@/hooks/useBootData";
import { useClock } from "@/hooks/useClock";
import { Banner } from "./Banner";
import { CommandBar } from "./CommandBar";
import { HistoryRail } from "./HistoryRail";
import { MapStage } from "./MapStage";
import { TimeScrubber } from "./TimeScrubber";
import { ResultsPanel } from "./results/ResultsPanel";

export function Console() {
  useBootData();
  useClock();
  return (
    <div className="console">
      <Banner />
      <CommandBar />
      <div className="console-main">
        <HistoryRail />
        <div className="console-center">
          <MapStage />
          <TimeScrubber />
        </div>
        <ResultsPanel />
      </div>
    </div>
  );
}
