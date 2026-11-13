/**
 * Client state (zustand). Owner: Prosper. Components read from here and call actions;
 * the async Build-it flow lives in src/hooks/useBuildFlow.ts.
 */
import { create } from "zustand";
import historyJson from "@/data/history.json";
import { SAMPLE_ARTICLE } from "@/lib/ai/mock";
import {
  HistorySchema,
  type ChatMessage,
  type ExtractedClaim,
  type HistoryEvent,
  type Network,
  type PlanMode,
  type ScenarioResult,
  type ZoneKind,
} from "@/lib/contract";

export type Phase = "idle" | "planning" | "simulating" | "building" | "done" | "error";
export type MapViewMode = "analysis" | "photoreal";
export type Horizon = "opening" | "year5" | "year10";
export type ResultsTab = "verdict" | "impact" | "whoPays" | "townHall";
export type PipelineStep = { id: string; label: string; status: "pending" | "active" | "done" };

/** Camera target; set it to move the camera (with an optional transition). */
export type CameraTarget = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
};

export const INITIAL_CAMERA: CameraTarget = { longitude: -84.374, latitude: 33.762, zoom: 13.4, pitch: 45, bearing: -12 };

export const DEFAULT_TEXT: Record<PlanMode, string> = {
  prompt: "extend the streetcar along the Beltline to Ponce City Market",
  article: SAMPLE_ARTICLE,
  fix: "cut commute times for the Eastside without raising rents",
};

export const SUGGESTIONS = [
  "extend the streetcar along the Beltline to Ponce City Market",
  "run the streetcar loop every 8 minutes",
  "add bus rapid transit on Ponce de Leon Ave and take one car lane",
  "close the Downtown Connector for a weekday",
];

type State = {
  inputMode: PlanMode;
  text: string;
  phase: Phase;
  error: string | null;
  pipeline: PipelineStep[];
  /** Prebaked scenario loaded at boot; only its baseline trips are shown before a build. */
  preview: ScenarioResult | null;
  /** Result of the last Build it. */
  scenario: ScenarioResult | null;
  claims: ExtractedClaim[] | null;
  network: Network | null;
  history: HistoryEvent[];
  view: MapViewMode;
  camera: CameraTarget;
  time: number;
  playing: boolean;
  horizon: Horizon;
  tab: ResultsTab;
  activeHistoryId: string | null;
  highlightZone: ZoneKind | null;
  /** 0..1 build animation of the proposed line. */
  lineProgress: number;
  /** 0..1 share of agents shown on their proposed trip. */
  switchProgress: number;
  chat: { personaId: string; messages: ChatMessage[]; pending: boolean } | null;
};

type Actions = {
  set: (patch: Partial<State>) => void;
  setInputMode: (m: PlanMode) => void;
  setPipelineStep: (id: string, patch: Partial<PipelineStep>) => void;
  toggleHistory: (id: string) => void;
  openChat: (personaId: string) => void;
  closeChat: () => void;
};

export const useStore = create<State & Actions>((set) => ({
  inputMode: "prompt",
  text: DEFAULT_TEXT.prompt,
  phase: "idle",
  error: null,
  pipeline: [],
  preview: null,
  scenario: null,
  claims: null,
  network: null,
  history: HistorySchema.parse(historyJson).sort((a, b) => a.year - b.year),
  view: "analysis",
  camera: INITIAL_CAMERA,
  time: 6600,
  playing: true,
  horizon: "opening",
  tab: "verdict",
  activeHistoryId: null,
  highlightZone: null,
  lineProgress: 0,
  switchProgress: 0,
  chat: null,

  set: (patch) => set(patch),
  setInputMode: (m) => set({ inputMode: m, text: DEFAULT_TEXT[m] }),
  setPipelineStep: (id, patch) =>
    set((s) => ({ pipeline: s.pipeline.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  toggleHistory: (id) => set((s) => ({ activeHistoryId: s.activeHistoryId === id ? null : id })),
  openChat: (personaId) => set({ chat: { personaId, messages: [], pending: false } }),
  closeChat: () => set({ chat: null }),
}));

/** The scenario whose agents/geometry the map should draw right now. */
export const selectMapScenario = (s: State) => s.scenario ?? s.preview;

// Debug handle for the browser console (e.g. __whatifStore.getState()). Harmless in production.
if (typeof window !== "undefined") (window as unknown as { __whatifStore?: typeof useStore }).__whatifStore = useStore;
