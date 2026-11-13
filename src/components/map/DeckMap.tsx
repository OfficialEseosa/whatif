"use client";
/**
 * deck.gl map (client-only; loaded via next/dynamic with ssr:false from MapStage).
 * One camera shared by both views; the view toggle only swaps the basemap layers.
 *   Analysis : Google 2D tiles if NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, else keyless OSM vector roads.
 *   Photoreal: Google Photorealistic 3D Tiles if key (overlays sit on the tiles via TerrainExtension
 *              and are occluded by buildings), else keyless roads at a steeper pitch.
 * Camera: free orbit. Drag = pan, right-drag / ctrl-drag = rotate + tilt (to 85°), wheel = zoom,
 * two-finger touch rotate/tilt. The store's `camera` only issues fly-to moves; it never clamps.
 */
import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, type Layer, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { INITIAL_CAMERA, useStore, selectMapScenario } from "@/lib/store";
import { api } from "@/lib/api";
import { keylessRoadsLayer } from "./layers/keylessBasemap";
import { google2dLayer, fetchGoogle2dAttribution } from "./layers/google2d";
import { photorealLayer } from "./layers/photoreal3d";
import { railLayers } from "./layers/rail";
import { beltlineLayer } from "./layers/beltline";
import { spilloverLayer } from "./layers/spillover";
import { tractsLayers } from "./layers/tracts";
import { rentPressureLayer } from "./layers/rentPressure";
import { historyOverlayLayers } from "./layers/historyOverlay";
import { buildGeometry, proposedLineLayers } from "./layers/proposedLine";
import { buildTripData, tripsLayer } from "./layers/trips";
import { atRiskLayer } from "./layers/atRisk";
import { vehicleLayers, vehiclesAt } from "./layers/vehicles";
import { buildRailChains, chainFromPath } from "./railGeometry";

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const MAX_PITCH = 85;
/**
 * Google 3D tiles use ellipsoidal heights; ground in the box is roughly 220-300 m above the WGS84
 * ellipsoid. Lifting the camera target keeps a close, steep camera above the mesh instead of inside it.
 */
const PHOTOREAL_TARGET_Z = 270;

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
  const underground = useStore((s) => s.underground);

  const photoreal = view === "photoreal";
  /** Overlays use the 3D-tiles terrain only when the tiles are actually there. */
  /** Underground in photoreal hides the tiles and shows a flat road "wireframe" with tunnels at depth. */
  const p3d = photoreal && !!GOOGLE_KEY && !underground;
  const depth3d = photoreal && underground;
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

  // --- camera (controlled; fly-to on store.camera changes, never resets bearing/pitch otherwise)
  const [viewState, setViewState] = useState<MapViewState>({ ...INITIAL_CAMERA, maxPitch: MAX_PITCH });
  // React's "adjust state when a prop changes" pattern (no effects).
  const [seenCamera, setSeenCamera] = useState(camera);
  if (seenCamera !== camera) {
    setSeenCamera(camera);
    setViewState((v) => ({
      ...v,
      ...camera,
      maxPitch: MAX_PITCH,
      transitionDuration: camera.transitionDuration ?? 800,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }
  const [seenPhotoreal, setSeenPhotoreal] = useState(photoreal);
  if (seenPhotoreal !== photoreal) {
    setSeenPhotoreal(photoreal);
    // Entering photoreal from a flat view: tilt so the buildings read. Keep bearing/zoom/center.
    if (photoreal && (viewState.pitch ?? 0) < 45)
      setViewState({ ...viewState, pitch: 55, transitionDuration: 600, transitionInterpolator: new FlyToInterpolator() });
  }

  const switchStep = built ? Math.round(switchProgress * 10) / 10 : 0;
  const agents = scenario?.agents;
  const tripData = useMemo(() => (agents ? buildTripData(agents, switchStep, horizon) : []), [agents, switchStep, horizon]);
  const geom = useMemo(() => (built && scenario ? buildGeometry(scenario, network) : null), [built, scenario, network]);
  const railChains = useMemo(() => (network ? buildRailChains(network) : []), [network]);
  const lineChain = useMemo(
    () => (geom && geom.kind === "transit" ? { ...chainFromPath("proposed", "streetcar", geom.path), service: "proposed" as const, headwayMin: scenario?.edit.headwayMin } : null),
    [geom, scenario],
  );
  const surfaceOpacity = underground ? 0.18 : 1;

  const layers: Layer[] = [];
  // --- basemap (the dense all-roads layer is skipped in photoreal: the photo shows the streets)
  // Keep the 3D tiles mounted while Underground hides them, so toggling back needs no reload.
  if (photoreal && GOOGLE_KEY) layers.push(photorealLayer(GOOGLE_KEY, setCredits3d, !underground));
  if (!p3d) {
    if (!photoreal && GOOGLE_KEY && session) layers.push(google2dLayer(session, GOOGLE_KEY, surfaceOpacity));
    else if (network) layers.push(keylessRoadsLayer(network, built, underground ? 0.15 : undefined));
  }
  // --- analysis layers
  if (built && scenario) layers.push(...tractsLayers(scenario.tracts, { opacity: switchProgress, photoreal: p3d, bbox: network?.bbox }));
  if (network && activeHistory) layers.push(...historyOverlayLayers(network, activeHistory.overlay, p3d));
  if (built && scenario && network) {
    const hl = highlightZone === "spillover" ? scenario.whoPays.items.find((i) => i.zone === "spillover" && i.roadIds)?.roadIds : undefined;
    layers.push(spilloverLayer(network, scenario.roads, { opacity: switchProgress, highlightIds: hl, photoreal: p3d }));
  }
  if (network) layers.push(beltlineLayer(network, p3d), ...railLayers(network, p3d, underground, p3d || depth3d));
  if (built && scenario && (tab === "whoPays" || horizon !== "opening" || highlightZone === "rent_pressure"))
    layers.push(rentPressureLayer(scenario.tracts, p3d));
  if (geom) layers.push(...proposedLineLayers(geom, lineProgress, p3d));
  if (tripData.length && !underground) layers.push(tripsLayer(tripData, time, p3d));
  // vehicles: existing rail always; the proposed line once it has finished drawing
  const runChains = lineChain && lineProgress >= 1 ? [...railChains, lineChain] : railChains;
  if (runChains.length) layers.push(...vehicleLayers(vehiclesAt(runChains, time), { photoreal: p3d, underground, depth: p3d || depth3d }));
  if (built && scenario && horizon !== "opening") layers.push(atRiskLayer(scenario.agents, horizon, p3d));

  // deck.gl can't add/remove extensions (TerrainExtension) on a live layer, so overlays get a
  // mode-specific id: switching views recreates them instead of silently drawing under the mesh.
  const sfx = p3d ? "@3d" : depth3d ? "@ug" : "";
  const finalLayers = layers.map((l) => (sfx && !l.id.startsWith("google-") ? l.clone({ id: `${l.id}${sfx}` }) : l));
  const googleOnScreen = p3d || (!photoreal && !!GOOGLE_KEY && !!session);
  const credits = photoreal ? credits3d : credits2d;
  const bearing = viewState.bearing ?? 0;

  return (
    <div className="map-canvas">
      <DeckGL
        viewState={{ ...viewState, position: [0, 0, p3d ? PHOTOREAL_TARGET_Z : 0] }}
        onViewStateChange={({ viewState: v }) => setViewState({ ...(v as MapViewState), maxPitch: MAX_PITCH })}
        controller={{ dragRotate: true, touchRotate: true, keyboard: true, inertia: 300 }}
        layers={finalLayers}
        getTooltip={tooltip}
      />
      <div className="map-ui map-ui-compass row gap-sm">
        <button
          className="btn compass"
          title="North up (drag with right mouse button or Ctrl to rotate and tilt)"
          aria-label={`Bearing ${Math.round(bearing)} degrees. Reset to north`}
          onClick={() => setViewState((v) => ({ ...v, bearing: 0, transitionDuration: 500, transitionInterpolator: new FlyToInterpolator() }))}
        >
          <span style={{ display: "inline-block", transform: `rotate(${-bearing}deg)` }}>▲</span>
        </button>
        <button
          className="btn"
          title="Reset view"
          onClick={() => setViewState({ ...INITIAL_CAMERA, pitch: photoreal ? 55 : INITIAL_CAMERA.pitch, maxPitch: MAX_PITCH, transitionDuration: 900, transitionInterpolator: new FlyToInterpolator() })}
        >
          Reset view
        </button>
      </div>
      <div className="map-attribution">
        {googleOnScreen ? (
          <>
            {/* TODO(Prosper): use Google's official logo asset per Map Tiles API policies. */}
            <strong>Google</strong> {credits}
          </>
        ) : (
          <>© OpenStreetMap contributors</>
        )}
      </div>
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
