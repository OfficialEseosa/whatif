"use client";
/**
 * deck.gl map (client-only; loaded via next/dynamic with ssr:false from MapStage).
 * One camera shared by both views; the view toggle only swaps the basemap layers.
 *   Map view : Google dark roadmap 2D tiles if NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, else the keyless dark
 *              vector map (OSM roads on the CSS background).
 *   Photoreal: Google Photorealistic 3D Tiles if key, else the keyless vector map at a steeper pitch.
 *              Same overlays as the map view. They sit on the tiles through ground elevation baked
 *              into their vertices (layers/common.ts + elevation.ts) and are depth-tested, so
 *              buildings occlude them; no per-frame terrain pass.
 * Which overlays draw is store.layerVisibility (the UI's layer toggles).
 * On mount the camera flies in from orbit to Atlanta.
 * Camera: free orbit. Drag = pan, right-drag / ctrl-drag = rotate + tilt (to 85°), wheel = zoom,
 * two-finger touch rotate/tilt. The store's `camera` only issues fly-to moves; it never clamps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { AmbientLight, DirectionalLight, FlyToInterpolator, LightingEffect, type Layer, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { INITIAL_CAMERA, ORBIT_CAMERA, useStore, selectMapScenario } from "@/lib/store";
import { prefersReducedMotion } from "@/hooks/useReducedMotion";
import { api } from "@/lib/api";
import { keylessRoadsLayer } from "./layers/keylessBasemap";
import { google2dLayer, fetchGoogle2dAttribution } from "./layers/google2d";
import { photorealLayer } from "./layers/photoreal3d";
import { railLayers } from "./layers/rail";
import { beltlineLayer } from "./layers/beltline";
import { spilloverLayer } from "./layers/spillover";
import { tractsLayers } from "./layers/tracts";
import { rentPressureLayers } from "./layers/rentPressure";
import { historyOverlayLayers } from "./layers/historyOverlay";
import { buildGeometry, proposedLineLayers } from "./layers/proposedLine";
import { useRunPingLayers } from "./layers/runPings";
import { buildTripData, tripsLayer } from "./layers/trips";
import { atRiskLayer } from "./layers/atRisk";
import { vehicleLayers, vehiclesAt } from "./layers/vehicles";
import { buildRailChains, chainFromPath } from "./railGeometry";
import { loadElevation, makeGroundSampler } from "./elevation";
import { setGroundSampler } from "./layers/common";
import { controllerProps } from "./controller";
import { MODEL_URLS, carsAt, vehicleModelLayers, vehicleScale } from "./layers/vehicleModels";

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
/** Light for the vehicle models (PBR), so their sides read differently as the camera turns. */
const LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.3 }),
  sun: new DirectionalLight({ color: [255, 250, 240], intensity: 2.2, direction: [-1, -2, -2.5] }),
});
const MAX_PITCH = 85;
/** Steeper than this in photoreal puts a horizon full of tiles on screen. */
const MAX_PITCH_3D = 70;
/** Entering photoreal: a moderate tilt and a close-enough zoom so the first frame requests few tiles. */
const ENTER_3D = { pitch: 50, minZoom: 14.8 };
/**
 * Google 3D tiles use ellipsoidal heights; ground in the box is roughly 220-300 m above the WGS84
 * ellipsoid. Lifting the camera target keeps a close, steep camera above the mesh instead of inside it.
 */
const PHOTOREAL_TARGET_Z = 270;
/** How often the live camera is published to the store (status bar, compass). Not per frame: see lag notes. */
const LIVE_PUBLISH_MS = 150;


export default function DeckMap() {
  const network = useStore((s) => s.network);
  const scenario = useStore(selectMapScenario);
  const built = useStore((s) => s.scenario !== null);
  const view = useStore((s) => s.view);
  const time = useStore((s) => s.time);
  const horizon = useStore((s) => s.horizon);
  const lineProgress = useStore((s) => s.lineProgress);
  const switchProgress = useStore((s) => s.switchProgress);
  const highlightZone = useStore((s) => s.highlightZone);
  const activeHistory = useStore((s) => s.history.find((h) => h.id === s.activeHistoryId) ?? null);
  const underground = useStore((s) => s.underground);
  const quality3d = useStore((s) => s.quality3d);
  const vis = useStore((s) => s.layerVisibility);
  const playbackSpeed = useStore((s) => s.playbackSpeed);
  const headways = useStore((s) => s.headways);
  // Zoom drives the vehicle-model size exaggeration; quantized so it doesn't re-render on every zoom tick.
  const zoomQ = useStore((s) => Math.round(s.live.zoom * 4) / 4);

  const photoreal = view === "photoreal";
  /** Overlays use the 3D-tiles terrain only when the tiles are actually there. */
  /** Underground in photoreal hides the tiles and shows a flat road "wireframe" with tunnels at depth. */
  const p3d = photoreal && !!GOOGLE_KEY && !underground;
  const depth3d = photoreal && underground;
  const [session, setSession] = useState<string | null>(null);
  const [credits3d, setCredits3d] = useState("");
  const [credits2d, setCredits2d] = useState("");
  // Google Earth keys: N = north up, U = level the tilt, R = reset view (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const st = useStore.getState();
      if (e.key === "n" || e.key === "N") st.nudgeCamera({ bearing: 0, ms: 400 });
      else if (e.key === "u" || e.key === "U") st.nudgeCamera({ pitch: 0, ms: 400 });
      else if (e.key === "r" || e.key === "R") st.flyTo(INITIAL_CAMERA, 1200);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 3D vehicle models: used when the .glb files are reachable, else the flat markers.
  const [modelsOk, setModelsOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all(Object.values(MODEL_URLS).map((u) => fetch(u, { method: "HEAD" }).then((r) => r.ok)))
      .then((ok) => !cancelled && setModelsOk(ok.every(Boolean)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Ground elevation for placing overlays on the 3D tiles; overlays wait for it in photoreal.
  const [groundOk, setGroundOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadElevation().then((g) => {
      if (cancelled || !g) return;
      setGroundSampler(makeGroundSampler(g));
      setGroundOk(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!GOOGLE_KEY) return;
    api.mapSession().then((s) => {
      if (!s) return;
      setSession(s.session);
      // TODO(Prosper): refresh on viewport change; for now attribution for the whole box.
      fetchGoogle2dAttribution(s.session, GOOGLE_KEY, 13, { north: 33.8, south: 33.73, east: -84.33, west: -84.42 }).then(setCredits2d);
    });
  }, []);

  // --- camera. deck.gl owns the live view (uncontrolled, so nothing here clamps or resets it);
  // we only hand it a new `initialViewState` to fly somewhere: store.camera moves, view toggles,
  // compass/reset. `live` tracks the current view so those moves start from where the user is.
  const live = useRef<MapViewState>({ ...ORBIT_CAMERA, maxPitch: MAX_PITCH });
  const [ivs, setIvs] = useState<MapViewState>({ ...ORBIT_CAMERA, maxPitch: MAX_PITCH });
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fly = useCallback((to: Partial<MapViewState>, ms: number, threeD: boolean) => {
    const maxPitch = threeD ? MAX_PITCH_3D : MAX_PITCH;
    const next = { ...live.current, ...to, pitch: Math.min(maxPitch, to.pitch ?? live.current.pitch ?? 0), maxPitch };
    if (!ms) {
      live.current = next as MapViewState;
      const m = next as MapViewState & { height?: number };
      useStore.getState().set({ live: { longitude: m.longitude, latitude: m.latitude, zoom: m.zoom, pitch: m.pitch ?? 0, bearing: m.bearing ?? 0, height: m.height || window.innerHeight } });
    }
    setIvs({
      ...next,
      position: [0, 0, threeD ? PHOTOREAL_TARGET_Z : 0],
      transitionDuration: ms,
      transitionInterpolator: new FlyToInterpolator(),
    });
  }, []);
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        const threeD = s.view === "photoreal" && !!GOOGLE_KEY && !s.underground;
        const wasThreeD = prev.view === "photoreal" && !!GOOGLE_KEY && !prev.underground;
        if (s.cameraNudge !== prev.cameraNudge && s.cameraNudge) {
          // On-screen rotate/tilt buttons and the draggable compass: relative to where the camera is now.
          const n = s.cameraNudge;
          const cur = live.current;
          fly(
            {
              bearing: n.bearing ?? (cur.bearing ?? 0) + (n.dBearing ?? 0),
              pitch: Math.max(0, n.pitch ?? (cur.pitch ?? 0) + (n.dPitch ?? 0)),
            },
            n.ms ?? 0,
            threeD,
          );
        } else if (s.camera !== prev.camera) fly(s.camera, s.camera.transitionDuration ?? 800, threeD);
        else if (threeD !== wasThreeD) {
          // Entering photoreal: moderate tilt and a close zoom (few tiles on the first frame); keep bearing/center.
          if (threeD) fly({ pitch: ENTER_3D.pitch, zoom: Math.max(live.current.zoom ?? 0, ENTER_3D.minZoom) }, 600, true);
          else fly({}, 400, false);
        }
      }),
    [fly],
  );

  // Opening move: fly in from orbit to Atlanta.
  useEffect(() => {
    const t = setTimeout(
      () => useStore.getState().set({ camera: { ...INITIAL_CAMERA, transitionDuration: prefersReducedMotion() ? 0 : 5200 } }),
      prefersReducedMotion() ? 0 : 900,
    );
    return () => clearTimeout(t);
  }, []);

  const switchStep = built ? Math.round(switchProgress * 3) / 3 : 0; // 3 steps: each rebuilds 3,000 trips
  const agents = scenario?.agents;
  const tripData = useMemo(() => (agents ? buildTripData(agents, switchStep, horizon) : []), [agents, switchStep, horizon]);
  const geom = useMemo(() => (built && scenario ? buildGeometry(scenario, network) : null), [built, scenario, network]);
  const railChains = useMemo(() => (network ? buildRailChains(network) : []), [network]);
  const lineChain = useMemo(
    () => (geom && geom.kind === "transit" ? { ...chainFromPath("proposed", "streetcar", geom.path), service: "proposed" as const, headwayMin: scenario?.edit.headwayMin } : null),
    [geom, scenario],
  );
  const surfaceOpacity = underground ? 0.18 : 1;

  // Basemaps are memoized: Tile3DLayer/TileLayer mark every tile sub-layer for update whenever their
  // props change, and new closures/objects on each render (the clock re-renders this component every
  // frame) meant hundreds of tile layers were updated per frame. Same instance => no prop change.
  // The 3D tileset is only created while photoreal is selected and is destroyed when leaving it.
  const show3dTiles = photoreal && !!GOOGLE_KEY;
  const tiles3d = useMemo(
    () => (show3dTiles ? photorealLayer(GOOGLE_KEY, setCredits3d, !underground, quality3d) : null),
    [show3dTiles, underground, quality3d],
  );
  const google2dOn = !photoreal && !!GOOGLE_KEY && !!session;
  const tiles2d = useMemo(() => (google2dOn ? google2dLayer(session!, GOOGLE_KEY, surfaceOpacity) : null), [google2dOn, session, surfaceOpacity]);

  const layers: Layer[] = [];
  if (tiles3d) layers.push(tiles3d);
  if (tiles2d) layers.push(tiles2d);
  const overlaysOk = !p3d || groundOk;
  // OSM roads: the keyless basemap itself (whenever no Google basemap is drawn), or on top of Google when toggled on.
  const keylessBase = !p3d && !google2dOn;
  if (network && (keylessBase || vis.roads)) layers.push(keylessRoadsLayer(network, built && keylessBase, underground ? 0.15 : undefined));
  const before = layers.length;
  // --- analysis layers (only those whose toggle is on)
  if (vis.tractEffects && built && scenario) layers.push(...tractsLayers(scenario.tracts, { opacity: switchProgress, photoreal: p3d, bbox: network?.bbox }));
  if (vis.history && network && activeHistory) layers.push(...historyOverlayLayers(network, activeHistory.overlay, p3d));
  if (vis.spillover && built && scenario && network) {
    const hl = highlightZone === "spillover" ? scenario.whoPays.items.find((i) => i.zone === "spillover" && i.roadIds)?.roadIds : undefined;
    layers.push(spilloverLayer(network, scenario.roads, { opacity: switchProgress, highlightIds: hl, photoreal: p3d }));
  }
  if (vis.beltline && network) layers.push(beltlineLayer(network, p3d));
  if (network && (vis.martaRail || vis.streetcar || vis.tunnels))
    layers.push(
      ...railLayers(network, p3d, underground, p3d || depth3d, {
        martaRail: vis.martaRail,
        streetcar: vis.streetcar,
        freight: vis.martaRail,
        tunnels: vis.tunnels,
        stations: vis.martaRail || vis.streetcar,
      }),
    );
  if (vis.rentPressure && built && scenario) layers.push(...rentPressureLayers(scenario.tracts, p3d));
  if (vis.proposedLine && geom) layers.push(...proposedLineLayers(geom, lineProgress, p3d));
  layers.push(...useRunPingLayers(p3d)); // run panel: stop pings, schematic line, hovered stop
  if (vis.commuters && tripData.length && !underground) layers.push(tripsLayer(tripData, time, p3d, playbackSpeed));
  // vehicles: existing rail (per its toggle) and the proposed line once it has finished drawing
  if (vis.vehicles) {
    const chains = railChains.filter((c) => (c.kind === "streetcar" ? vis.streetcar : vis.martaRail));
    const runChains = lineChain && lineProgress >= 1 && vis.proposedLine ? [...chains, lineChain] : chains;
    if (runChains.length) {
      if (modelsOk) {
        const scale = vehicleScale(zoomQ);
        const cars = carsAt(runChains, time, headways, { scale, onGround: p3d, depth: p3d || depth3d, underground });
        layers.push(...vehicleModelLayers(cars, { scale, xray: underground, time }));
      } else layers.push(...vehicleLayers(vehiclesAt(runChains, time, headways), { photoreal: p3d, underground, depth: p3d || depth3d }));
    }
  }
  if (built && scenario && horizon !== "opening") layers.push(atRiskLayer(scenario.agents, horizon, p3d));

  if (!overlaysOk) layers.splice(before);
  // Overlays get a view-specific id so switching views rebuilds their (elevated or flat) geometry.
  const sfx = p3d ? "@3d" : depth3d ? "@ug" : "";
  const finalLayers = layers.map((l) => (sfx && !l.id.startsWith("google-") ? l.clone({ id: `${l.id}${sfx}` }) : l));
  const googleOnScreen = p3d || (!photoreal && !!GOOGLE_KEY && !!session);
  const credits = googleOnScreen ? (photoreal ? credits3d : credits2d) : "© OpenStreetMap contributors";
  useEffect(() => {
    useStore.getState().set({ attribution: { google: googleOnScreen, text: credits } });
  }, [googleOnScreen, credits]);

  return (
    <div className="map-canvas">
      <DeckGL
        initialViewState={ivs}
        onViewStateChange={({ viewState: v }) => {
          live.current = v as MapViewState;
          // Publishing the camera to the store re-renders every store subscriber (status bar, compass,
          // panels' selectors). Doing it every frame made orbiting in photoreal lag; publish at most
          // every LIVE_PUBLISH_MS (trailing, so the final position always lands).
          if (liveTimer.current) return;
          liveTimer.current = setTimeout(() => {
            liveTimer.current = null;
            const m = live.current as MapViewState & { height?: number };
            useStore.getState().set({ live: { longitude: m.longitude, latitude: m.latitude, zoom: m.zoom, pitch: m.pitch ?? 0, bearing: m.bearing ?? 0, height: m.height || window.innerHeight } });
          }, LIVE_PUBLISH_MS);
        }}
        controller={controllerProps()}
        layers={finalLayers}
        effects={[LIGHTING]}
        getTooltip={tooltip}
      />
    </div>
  );
}

function tooltip(info: PickingInfo) {
  const o = info.object as Record<string, unknown> | null;
  if (!o) return null;
  if (typeof o.name === "string") return o.name;
  if (typeof o.label === "string") return o.label;
  if (typeof o.minutesDelta === "number") return `${(o.minutesDelta as number).toFixed(2)} min avg commute change`;
  return null;
}
