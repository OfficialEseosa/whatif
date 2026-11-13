"use client";
/**
 * deck.gl map (client-only; loaded via next/dynamic with ssr:false from MapStage).
 * One camera shared by both views; the view toggle only swaps the basemap layers.
 *   Analysis : Google 2D tiles if NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, else keyless satellite imagery (dimmed) + OSM vector roads.
 *   Photoreal: Google Photorealistic 3D Tiles if key, else keyless satellite imagery at a steeper pitch.
 * On mount the camera flies in from orbit to Atlanta.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { useStore, selectMapScenario, INITIAL_CAMERA } from "@/lib/store";
import { prefersReducedMotion } from "@/hooks/useReducedMotion";
import { api } from "@/lib/api";
import { keylessRoadsLayer } from "./layers/keylessBasemap";
import { satelliteLayer, SATELLITE_CREDIT } from "./layers/satellite";
import { google2dLayer, fetchGoogle2dAttribution } from "./layers/google2d";
import { photorealLayer } from "./layers/photoreal3d";
import { railLayers } from "./layers/rail";
import { beltlineLayer } from "./layers/beltline";
import { spilloverLayer } from "./layers/spillover";
import { tractsLayer } from "./layers/tracts";
import { rentPressureLayer } from "./layers/rentPressure";
import { historyOverlayLayers } from "./layers/historyOverlay";
import { proposedLineLayers } from "./layers/proposedLine";
import { buildTripData, tripsLayer } from "./layers/trips";
import { atRiskLayer } from "./layers/atRisk";

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

export default function DeckMap() {
  const network = useStore((s) => s.network);
  const scenario = useStore(selectMapScenario);
  const built = useStore((s) => s.scenario !== null);
  const view = useStore((s) => s.view);
  const camera = useStore((s) => s.camera);
  const time = useStore((s) => s.time);
  const horizon = useStore((s) => s.horizon);
  const tab = useStore((s) => s.tab);
  const lineProgress = useStore((s) => s.lineProgress);
  const switchProgress = useStore((s) => s.switchProgress);
  const highlightZone = useStore((s) => s.highlightZone);
  const activeHistory = useStore((s) => s.history.find((h) => h.id === s.activeHistoryId) ?? null);

  const photoreal = view === "photoreal";
  /** True when Google's 3D tiles are on screen; overlays are lifted onto them. */
  const onTerrain = photoreal && !!GOOGLE_KEY;
  const liveFrame = useRef(0);
  const [session, setSession] = useState<string | null>(null);
  const [credits3d, setCredits3d] = useState("");
  const [credits2d, setCredits2d] = useState("");

  useEffect(() => {
    if (!GOOGLE_KEY) return;
    api.mapSession().then((s) => {
      if (!s) return;
      setSession(s.session);
      // TODO(Prosper): refresh on viewport change; for now attribution for the whole box.
      fetchGoogle2dAttribution(s.session, GOOGLE_KEY, 13, { north: 33.8, south: 33.73, east: -84.33, west: -84.42 }).then(setCredits2d);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(
      () => useStore.getState().set({ camera: { ...INITIAL_CAMERA, transitionDuration: prefersReducedMotion() ? 0 : 5200 } }),
      prefersReducedMotion() ? 0 : 900,
    );
    return () => clearTimeout(t);
  }, []);

  const initialViewState = useMemo(
    () => ({
      ...camera,
      pitch: photoreal ? Math.max(camera.pitch, 60) : camera.pitch,
      transitionDuration: camera.transitionDuration ?? 800,
      transitionInterpolator: new FlyToInterpolator(),
    }),
    [camera, photoreal],
  );

  const switchStep = built ? Math.round(switchProgress * 10) / 10 : 0;
  const agents = scenario?.agents;
  const tripData = useMemo(() => (agents ? buildTripData(agents, switchStep, horizon) : []), [agents, switchStep, horizon]);

  const layers = [];
  // --- basemap
  if (photoreal && GOOGLE_KEY) layers.push(photorealLayer(GOOGLE_KEY, setCredits3d));
  else if (!photoreal && GOOGLE_KEY && session) layers.push(google2dLayer(session, GOOGLE_KEY));
  else {
    layers.push(satelliteLayer(!photoreal));
    if (network) layers.push(keylessRoadsLayer(network, built || photoreal));
  }
  // --- analysis layers
  if (built && scenario) layers.push(tractsLayer(scenario.tracts, { opacity: switchProgress, photoreal: onTerrain }));
  if (network && activeHistory) layers.push(...historyOverlayLayers(network, activeHistory.overlay, onTerrain));
  if (built && scenario && network) {
    const hl = highlightZone === "spillover" ? scenario.whoPays.items.find((i) => i.zone === "spillover" && i.roadIds)?.roadIds : undefined;
    layers.push(spilloverLayer(network, scenario.roads, { opacity: switchProgress, highlightIds: hl, photoreal: onTerrain }));
  }
  if (network) layers.push(beltlineLayer(network, onTerrain), ...railLayers(network, onTerrain));
  if (built && scenario && (tab === "whoPays" || horizon !== "opening" || highlightZone === "rent_pressure"))
    layers.push(rentPressureLayer(scenario.tracts, onTerrain));
  if (built && scenario) layers.push(...proposedLineLayers(scenario.line, lineProgress, onTerrain));
  if (tripData.length) layers.push(tripsLayer(tripData, time, onTerrain));
  if (built && scenario && horizon !== "opening") layers.push(atRiskLayer(scenario.agents, horizon, onTerrain));

  const googleOnScreen = !!GOOGLE_KEY && (photoreal || !!session);
  const credits = googleOnScreen ? (photoreal ? credits3d : credits2d) : `${SATELLITE_CREDIT}, © OpenStreetMap contributors`;
  useEffect(() => {
    useStore.getState().set({ attribution: { google: googleOnScreen, text: credits } });
  }, [googleOnScreen, credits]);

  return (
    <div className="map-canvas">
      <DeckGL
        initialViewState={initialViewState}
        controller={{ dragRotate: true, touchRotate: true }}
        layers={layers}
        getTooltip={tooltip}
        onViewStateChange={({ viewState }) => {
          const v = viewState as MapViewState & { height?: number };
          const live = { longitude: v.longitude, latitude: v.latitude, zoom: v.zoom, pitch: v.pitch ?? 0, bearing: v.bearing ?? 0, height: v.height || window.innerHeight };
          // deck.gl can call this while it renders; publish on the next frame.
          cancelAnimationFrame(liveFrame.current);
          liveFrame.current = requestAnimationFrame(() => useStore.getState().set({ live }));
        }}
      />
    </div>
  );
}

function tooltip(info: PickingInfo) {
  const o = info.object as Record<string, unknown> | null;
  if (!o) return null;
  if (typeof o.name === "string") return o.name;
  if (typeof o.label === "string") return o.label;
  if (typeof o.minutesDelta === "number") return `${(o.minutesDelta as number).toFixed(1)} min avg commute change`;
  return null;
}
