/**
 * Client state (zustand). Owner: Prosper. Components read from here and call actions;
 * the async Build-it flow lives in src/hooks/useBuildFlow.ts.
 */
import { create } from "zustand";
import historyJson from "@/data/history.json";
import { SAMPLE_ARTICLE, gazetteer } from "@/lib/ai/mock";
import {
  HistorySchema,
  type ChatMessage,
  type ExtractedClaim,
  type HistoryEvent,
  type ScenarioEdit,
  type Network,
  type PlanMode,
  type ScenarioResult,
  type ZoneKind,
} from "@/lib/contract";

export type Phase = "idle" | "planning" | "simulating" | "building" | "done" | "error";
export type MapViewMode = "analysis" | "photoreal";
export type Horizon = "opening" | "year5" | "year10";
export type ResultsTab = "verdict" | "impact" | "whoPays" | "townHall";
export type PipelineStep = {
  id: string;
  label: string;
  /** warn = finished, but with something the user must know (mock data, unmatched stops). */
  status: "pending" | "active" | "done" | "warn" | "error";
  /** performance.now() when the step started / finished (run panel timings). */
  startedAt?: number;
  endedAt?: number;
};

/** One Build it, kept after it finishes so its run log can be reopened. Times are performance.now(). */
export type RunRecord = {
  /** Run id (increments per Build it). */
  id: number;
  startedAt: number;
  endedAt: number | null;
  /** Steps with their own start/end times. */
  steps: PipelineStep[];
  /** Set when the run was started from an alternative's edit (skips /api/plan); Retry reuses it. */
  overrideEdit: ScenarioEdit | null;
  /** Follow-up prompt: the plan this run modifies (sent to /api/plan as previousEdit). */
  previousEdit: ScenarioEdit | null;
  /** Who produced the edit: the Claude parser, the canned mock parser, or a stored alternative. */
  planSource: "claude" | "mock_parser" | "alternative" | null;
  edit: ScenarioEdit | null;
  claims: ExtractedClaim[] | null;
  /** checkEditAgainstGazetteer problems for the placed stops. */
  stopProblems: string[];
  /** When the placed stops start pinging on the map (one after another). */
  pingAt: number | null;
  /** Wall time of the whole simulate step, and its parts. */
  simMs: number | null;
  /** Time of the POST /api/simulate call alone. */
  routeMs: number | null;
  /** Set when the route pointed at a stored file and the client fetched it. */
  file: { url: string; ms: number; bytes: number } | null;
  result: ScenarioResult | null;
  error: { step: string; message: string } | null;
  cancelled: boolean;
};

/** How many past runs to keep. */
export const MAX_RUNS = 12;

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

/** Where the camera starts before it flies in to INITIAL_CAMERA. */
export const ORBIT_CAMERA: CameraTarget = { longitude: -96, latitude: 37, zoom: 2.4, pitch: 0, bearing: 0, transitionDuration: 0 };

/** The camera as it is right now (follows drags and transitions). Read-only for the UI. */
export type LiveView = { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number; height: number };
export type Drawer = "history" | "layers";
export type Attribution = { google: boolean; text: string };

/** Map layers the user can switch on and off (the UI shell renders the toggles from LAYER_META). */
export type LayerKey =
  | "proposedLine"
  | "martaRail"
  | "streetcar"
  | "beltline"
  | "tunnels"
  | "vehicles"
  | "commuters"
  | "roads"
  | "tractEffects"
  | "spillover"
  | "rentPressure"
  | "history";

export type LayerGroup = "Transit" | "Commuters" | "After a plan is built" | "Context";

/** Labels, groups and swatches for the layer toggles. `colorKey` is a key of MAP_COLORS (src/components/map/colors.ts). */
export const LAYER_META: Record<LayerKey, { label: string; group: LayerGroup; requiresResult?: boolean; colorKey?: string }> = {
  proposedLine: { label: "Proposed line", group: "After a plan is built", requiresResult: true, colorKey: "proposed" },
  martaRail: { label: "MARTA rail", group: "Transit", colorKey: "rail" },
  streetcar: { label: "Streetcar", group: "Transit", colorKey: "streetcar" },
  beltline: { label: "Beltline trail", group: "Context", colorKey: "beltline" },
  tunnels: { label: "Rail in tunnel", group: "Transit", colorKey: "tunnel" },
  vehicles: { label: "Trains and streetcars", group: "Transit", colorKey: "martaTrain" },
  commuters: { label: "Commuters", group: "Commuters", colorKey: "tripDrive" },
  roads: { label: "Road network", group: "Context", colorKey: "roadLegend" },
  tractEffects: { label: "Faster / slower commutes by tract", group: "After a plan is built", requiresResult: true, colorKey: "gain" },
  spillover: { label: "Traffic spillover", group: "After a plan is built", requiresResult: true, colorKey: "loss" },
  rentPressure: { label: "Rent pressure zone", group: "After a plan is built", requiresResult: true, colorKey: "rentPressure" },
  history: { label: "History overlay", group: "Context", colorKey: "history" },
};

/** Photoreal 3D tile detail. High (loaders.gl default detail) is the default; Low is a fallback for weak GPUs. */
export type Quality3d = "low" | "high";

export const DEFAULT_LAYER_VISIBILITY: Record<LayerKey, boolean> = {
  proposedLine: true,
  martaRail: true,
  streetcar: true,
  vehicles: true,
  commuters: true,
  tractEffects: true,
  roads: false,
  beltline: false,
  tunnels: false,
  spillover: false,
  rentPressure: false,
  history: false,
};

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
  /** Steps of the current or last run (kept after it finishes). */
  pipeline: PipelineStep[];
  /** Recent runs, oldest first (at most MAX_RUNS). */
  runs: RunRecord[];
  /** Run whose log the run panel shows; null hides it ("New plan"). */
  activeRunId: number | null;
  /** Stop index hovered in the run panel; the map highlights its ping. */
  runHoverStop: number | null;
  /** Prebaked scenario loaded at boot; only its baseline trips are shown before a build. */
  preview: ScenarioResult | null;
  /** Result of the last Build it. */
  scenario: ScenarioResult | null;
  claims: ExtractedClaim[] | null;
  network: Network | null;
  history: HistoryEvent[];
  view: MapViewMode;
  camera: CameraTarget;
  live: LiveView;
  drawer: Drawer | null;
  resultsOpen: boolean;
  attribution: Attribution;
  time: number;
  playing: boolean;
  /** Simulated seconds per real second while playing (see PLAYBACK_SPEEDS in src/hooks/useClock.ts). */
  playbackSpeed: number;
  horizon: Horizon;
  tab: ResultsTab;
  activeHistoryId: string | null;
  /** Fade the surface to show tunnels and trains below ground. */
  underground: boolean;
  highlightZone: ZoneKind | null;
  /** 0..1 build animation of the proposed line. */
  lineProgress: number;
  /** 0..1 share of agents shown on their proposed trip. */
  switchProgress: number;
  chat: { personaId: string; messages: ChatMessage[]; pending: boolean } | null;
  /** Which map layers are drawn. Features that switch layers (history cards, Underground, Who pays) set these. */
  layerVisibility: Record<LayerKey, boolean>;
  /** GTFS 7-9 AM headways (minutes) per network line id, from transit-service.sim.json; null = placeholders. */
  headways: Record<string, number> | null;
  /** Photoreal 3D quality (tile detail, cache, pixel ratio). */
  quality3d: Quality3d;
  /** Relative or absolute camera rotation request (compass drag, rotate/tilt buttons). DeckMap applies it. */
  cameraNudge: { seq: number; dBearing?: number; dPitch?: number; bearing?: number; pitch?: number; ms?: number } | null;
};

type Actions = {
  set: (patch: Partial<State>) => void;
  setInputMode: (m: PlanMode) => void;
  setPipelineStep: (id: string, patch: Partial<PipelineStep>) => void;
  /** Adds a run (dropping the oldest past MAX_RUNS) and makes it active. */
  addRun: (run: RunRecord) => void;
  patchRun: (id: number, patch: Partial<RunRecord>) => void;
  /** Updates one step of a run (and mirrors it into `pipeline` when it is the active run). */
  setRunStep: (id: number, stepId: string, patch: Partial<PipelineStep>) => void;
  /** Hides the run panel (e.g. "New plan"); past runs stay in `runs`. */
  resetRun: () => void;
  toggleHistory: (id: string) => void;
  toggleDrawer: (d: Drawer) => void;
  /** Move the camera from where it is now. */
  flyTo: (patch: Partial<CameraTarget>, ms?: number) => void;
  openChat: (personaId: string) => void;
  closeChat: () => void;
  setLayerVisible: (key: LayerKey, on: boolean) => void;
  toggleLayer: (key: LayerKey) => void;
  /** Back to DEFAULT_LAYER_VISIBILITY ("Clear map"). */
  resetLayerVisibility: () => void;
  /** Fly the camera to a gazetteer place (e.g. "clarkston"). Returns false for an unknown id. */
  flyToPlace: (id: string, zoom?: number) => boolean;
  /** Rotate/tilt the camera from where it is (dBearing/dPitch, degrees) or to an absolute bearing/pitch. */
  nudgeCamera: (n: { dBearing?: number; dPitch?: number; bearing?: number; pitch?: number; ms?: number }) => void;
};

export const useStore = create<State & Actions>((set) => ({
  inputMode: "prompt",
  text: DEFAULT_TEXT.prompt,
  phase: "idle",
  error: null,
  pipeline: [],
  runs: [],
  activeRunId: null,
  runHoverStop: null,
  preview: null,
  scenario: null,
  claims: null,
  network: null,
  history: HistorySchema.parse(historyJson).sort((a, b) => a.year - b.year),
  view: "analysis",
  camera: ORBIT_CAMERA,
  live: { longitude: ORBIT_CAMERA.longitude, latitude: ORBIT_CAMERA.latitude, zoom: ORBIT_CAMERA.zoom, pitch: 0, bearing: 0, height: 800 },
  drawer: null,
  resultsOpen: true,
  attribution: { google: false, text: "" },
  time: 6600,
  playing: true,
  playbackSpeed: 30,
  horizon: "opening",
  tab: "verdict",
  activeHistoryId: null,
  underground: false,
  highlightZone: null,
  lineProgress: 0,
  switchProgress: 0,
  chat: null,
  layerVisibility: DEFAULT_LAYER_VISIBILITY,
  headways: null,
  quality3d: "high",
  cameraNudge: null,

  set: (patch) => set(patch),
  setInputMode: (m) => set({ inputMode: m, text: DEFAULT_TEXT[m] }),
  setPipelineStep: (id, patch) =>
    set((s) => ({ pipeline: s.pipeline.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  addRun: (run) => set((s) => ({ runs: [...s.runs, run].slice(-MAX_RUNS), activeRunId: run.id, pipeline: run.steps, runHoverStop: null })),
  patchRun: (id, patch) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  setRunStep: (id, stepId, patch) =>
    set((s) => {
      const runs = s.runs.map((r) => (r.id === id ? { ...r, steps: r.steps.map((p) => (p.id === stepId ? { ...p, ...patch } : p)) } : r));
      const run = runs.find((r) => r.id === id);
      return s.activeRunId === id && run ? { runs, pipeline: run.steps } : { runs };
    }),
  resetRun: () => set({ activeRunId: null, pipeline: [], runHoverStop: null }),
  toggleHistory: (id) => set((s) => ({ activeHistoryId: s.activeHistoryId === id ? null : id })),
  toggleDrawer: (d) => set((s) => ({ drawer: s.drawer === d ? null : d })),
  flyTo: (patch, ms = 500) =>
    set(({ live, camera }) => {
      // Mid-flight to a far-away target (the opening fly-in): keep heading there instead of stopping short.
      const from = Math.abs(camera.zoom - live.zoom) > 3 ? camera : live;
      return {
        camera: { longitude: from.longitude, latitude: from.latitude, zoom: from.zoom, pitch: from.pitch, bearing: from.bearing, ...patch, transitionDuration: ms },
      };
    }),
  openChat: (personaId) => set({ chat: { personaId, messages: [], pending: false } }),
  closeChat: () => set({ chat: null }),
  setLayerVisible: (key, on) => set((s) => ({ layerVisibility: { ...s.layerVisibility, [key]: on } })),
  toggleLayer: (key) => set((s) => ({ layerVisibility: { ...s.layerVisibility, [key]: !s.layerVisibility[key] } })),
  resetLayerVisibility: () => set({ layerVisibility: DEFAULT_LAYER_VISIBILITY }),
  nudgeCamera: (n) => set((s) => ({ cameraNudge: { ...n, seq: (s.cameraNudge?.seq ?? 0) + 1 } })),
  flyToPlace: (id, zoom = 14.5) => {
    const p = gazetteer.find((g) => g.id === id);
    if (!p) return false;
    useStore.getState().flyTo({ longitude: p.coord[0], latitude: p.coord[1], zoom }, 1800);
    return true;
  },
}));

/**
 * Features that used to switch layers directly now flip the layer flags (once, on change), so the
 * toggles always reflect what is drawn and the user can still override afterwards:
 *   picking a history card -> history on (off when it is cleared)
 *   Underground on/off      -> tunnels on/off
 *   Who pays tab, a look-ahead horizon or the rent-pressure highlight -> rent pressure on (off when none apply)
 */
const wantsRentPressure = (s: State) => s.tab === "whoPays" || s.horizon !== "opening" || s.highlightZone === "rent_pressure";
useStore.subscribe((s, prev) => {
  const patch: Partial<Record<LayerKey, boolean>> = {};
  if (s.activeHistoryId !== prev.activeHistoryId) patch.history = s.activeHistoryId !== null;
  if (s.underground !== prev.underground) patch.tunnels = s.underground;
  if (wantsRentPressure(s) !== wantsRentPressure(prev)) patch.rentPressure = wantsRentPressure(s);
  const changed = (Object.keys(patch) as LayerKey[]).filter((k) => s.layerVisibility[k] !== patch[k]);
  if (changed.length) useStore.setState({ layerVisibility: { ...s.layerVisibility, ...patch } });
});

/** The run the run panel shows (null when hidden). */
export const selectActiveRun = (s: State) => (s.activeRunId === null ? null : (s.runs.find((r) => r.id === s.activeRunId) ?? null));

/** The scenario whose agents/geometry the map should draw right now. */
export const selectMapScenario = (s: State) => s.scenario ?? s.preview;

// Debug handle for the browser console (e.g. __whatifStore.getState()): dev builds, or NEXT_PUBLIC_WHATIF_DEBUG=1.
if ((process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_WHATIF_DEBUG === "1") && typeof window !== "undefined")
  (window as unknown as { __whatifStore?: typeof useStore }).__whatifStore = useStore;
