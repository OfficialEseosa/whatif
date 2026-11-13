/**
 * Run-panel coupling on the map (self-contained; owned by src/components/run).
 *   - placed stops ping once each, in panel order (120 ms stagger, 600 ms ring), from lastRun.pingAt
 *   - a faint dashed "schematic" polyline through the stops, and the edit's roadIds highlighted,
 *     until the simulated line starts drawing
 *   - the stop hovered in the panel (runHoverStop) gets a ring
 * Under reduced motion the rings are static and nothing pulses.
 */
import { useEffect, useMemo, useState } from "react";
import type { Layer, LayerExtension } from "@deck.gl/core";
import {
  PathStyleExtension,
  type PathStyleExtensionProps,
} from "@deck.gl/extensions";
import {
  PathLayer,
  ScatterplotLayer,
  TextLayer,
  type PathLayerProps,
} from "@deck.gl/layers";
import type { LngLat, Stop } from "@/lib/contract";
import { prefersReducedMotion } from "@/hooks/useReducedMotion";
import { selectActiveRun, useStore } from "@/lib/store";
import { LIFT_M, lift, liftPoint } from "./common";

export const PING_STAGGER_MS = 120;
export const PING_MS = 600;

const ACCENT: [number, number, number] = [198, 244, 50]; // --accent #c6f432
const INK: [number, number, number] = [242, 243, 245]; // light strokes / text on the dark map
const PAPER: [number, number, number] = [18, 19, 22]; // dark fills / label backgrounds
const DASH = new PathStyleExtension({ dash: true });

type StopD = Stop & { i: number };

/** Layers for the run panel's map coupling. Call once per DeckMap render (it is a hook). */
export function useRunPingLayers(photoreal: boolean): Layer[] {
  const run = useStore(selectActiveRun);
  const hover = useStore((s) => s.runHoverStop);
  const network = useStore((s) => s.network);
  const lineStarted = useStore((s) => s.lineProgress > 0);
  const pingAt = run?.pingAt ?? null;
  const edit = run?.edit ?? null;
  const n = edit?.stops.length ?? 0;
  const span = n ? (n - 1) * PING_STAGGER_MS + PING_MS : 0;

  // ms since pingAt while the pings play; Infinity once they are over.
  const [t, setT] = useState(Infinity);
  useEffect(() => {
    if (pingAt === null || !n) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (prefersReducedMotion()) {
      // Static rings for the same span, no animation.
      raf = requestAnimationFrame(() => setT(0));
      timer = setTimeout(() => setT(Infinity), span);
    } else {
      const tick = () => {
        const e = performance.now() - pingAt;
        setT(e < span ? e : Infinity);
        if (e < span) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [pingAt, n, span]);

  const stops = useMemo<StopD[]>(
    () => (edit ? edit.stops.map((s, i) => ({ ...s, i })) : []),
    [edit],
  );
  const schematic = useMemo(
    () => (stops.length >= 2 ? [{ path: stops.map((s) => s.coord) }] : []),
    [stops],
  );
  const label = useMemo(() => {
    if (stops.length < 2) return [];
    const a = stops[Math.floor((stops.length - 1) / 2)].coord;
    const b = stops[Math.floor((stops.length - 1) / 2) + 1].coord;
    return [{ at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as LngLat }];
  }, [stops]);
  const roads = useMemo(() => {
    if (!edit?.roadIds?.length || !network) return [];
    const ids = new Set(edit.roadIds);
    return network.roads
      .filter((r) => ids.has(r.id))
      .map((r) => ({ path: r.path }));
  }, [edit, network]);

  const failed = run?.error != null;
  const pre = !lineStarted && !failed; // until the simulated line starts drawing
  const reduced = t === 0 && prefersReducedMotion();
  const hovered = hover !== null ? stops[hover] : undefined;

  // Built only when an input changes (not on every DeckMap render).
  return useMemo(() => {
    if (!edit) return [];
    const ext = (extra: LayerExtension[] = []) => (extra.length ? { extensions: extra } : {});
    // Photoreal: sit on the 3D street surface like the other overlays (common.ts lift helpers).
    const z = photoreal ? LIFT_M.stops : 0;
    const pt = (p: LngLat) => liftPoint(p, z);
    const ln = (path: LngLat[]) => lift(path, z);
    const layers: Layer[] = [];

    if (pre && roads.length)
      layers.push(
        new PathLayer<{ path: LngLat[] }>({
          id: "run-roads",
          data: roads,
          getPath: (d) => ln(d.path),
          getColor: [...ACCENT, 150],
          getWidth: 7,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          ...ext(),
        }),
      );
    if (pre && schematic.length)
      layers.push(
        new PathLayer<{ path: LngLat[] }>({
          id: "run-schematic",
          data: schematic,
          getPath: (d) => ln(d.path),
          getColor: [...INK, 150],
          getWidth: 2.5,
          widthUnits: "pixels",
          getDashArray: [4, 3],
          dashJustified: true,
          ...ext([DASH]),
        } as PathLayerProps<{ path: LngLat[] }> &
          PathStyleExtensionProps<{ path: LngLat[] }>),
        new TextLayer<{ at: LngLat }>({
          id: "run-schematic-label",
          data: label,
          getPosition: (d) => pt(d.at),
          getText: () => "schematic",
          getSize: 12,
          getColor: [...INK, 220],
          fontFamily: "ui-monospace, Consolas, monospace",
          background: true,
          getBackgroundColor: [...PAPER, 230],
          backgroundPadding: [4, 2],
          getPixelOffset: [0, -14],
          ...ext(),
        }),
      );
    if (pre && stops.length)
      layers.push(
        new ScatterplotLayer<StopD>({
          id: "run-stops",
          data: stops,
          getPosition: (d) => pt(d.coord),
          getRadius: 4.5,
          radiusUnits: "pixels",
          filled: true,
          stroked: true,
          getFillColor: [...PAPER, 255],
          getLineColor: [...INK, 255],
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          ...ext(),
        }),
      );
    if (Number.isFinite(t) && stops.length)
      layers.push(
        new ScatterplotLayer<StopD>({
          id: "run-pings",
          data: stops,
          getPosition: (d) => pt(d.coord),
          radiusUnits: "pixels",
          filled: false,
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: 2.5,
          getRadius: (d) => {
            if (reduced) return 14;
            const k = (t - d.i * PING_STAGGER_MS) / PING_MS;
            return k <= 0 || k >= 1 ? 0 : 5 + 23 * (1 - Math.pow(1 - k, 3));
          },
          getLineColor: (d) => {
            if (reduced) return [...ACCENT, 200];
            const k = (t - d.i * PING_STAGGER_MS) / PING_MS;
            return k <= 0 || k >= 1
              ? [0, 0, 0, 0]
              : [...ACCENT, Math.round(255 * (1 - k))];
          },
          updateTriggers: {
            getRadius: [t, reduced],
            getLineColor: [t, reduced],
          },
          ...ext(),
        }),
      );
    if (hovered)
      layers.push(
        new ScatterplotLayer<StopD>({
          id: "run-hover",
          data: [hovered],
          getPosition: (d) => pt(d.coord),
          getRadius: 13,
          radiusUnits: "pixels",
          filled: true,
          stroked: true,
          getFillColor: [...ACCENT, 40],
          getLineColor: [...ACCENT, 255],
          lineWidthUnits: "pixels",
          getLineWidth: 2.5,
          ...ext(),
        }),
      );
    return layers;
  }, [
    edit,
    photoreal,
    pre,
    roads,
    schematic,
    label,
    stops,
    t,
    reduced,
    hovered,
  ]);
}
