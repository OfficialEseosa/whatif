"use client";
/**
 * Screen layout: the map fills the screen; on it, only the wordmark (top-left, with the run panel slot
 * under it), the control cluster (top-right), the prompt dock (bottom-centre) and the map credit.
 * The results card, history, layers and time strip appear only when they are needed.
 */
import { useBootData } from "@/hooks/useBootData";
import { useClock } from "@/hooks/useClock";
import { Popovers } from "./Atlas";
import { Cluster } from "./Cluster";
import { Composer } from "./Composer";
import { MapNote } from "./MapNote";
import { MapStage } from "./MapStage";
import { StatusBar } from "./StatusBar";
import { TodayCard } from "./TodayCard";
import { Wordmark } from "./Wordmark";
import { ResultsPanel } from "./results/ResultsPanel";
import { RunPanel } from "./run/RunPanel";
import "./phone.css";

export function Console() {
  useBootData();
  useClock();
  return (
    <div className="app">
      <MapStage />
      <div className="corner">
        <h1 className="brand">
          <Wordmark />
        </h1>
        <TodayCard />
        {/* Run panel slot: the build/pipeline card mounts here, under the wordmark. */}
        <div className="run-slot">
          <RunPanel />
        </div>
      </div>
      <Cluster />
      <ResultsPanel />
      <MapNote />
      <Composer />
      <StatusBar />
      <Popovers />
    </div>
  );
}
