/**
 * Map navigation tuned to feel like Google Maps (Map view) and Google Earth for web (3D view) on a
 * Windows PC with a mouse or a precision touchpad.
 *
 * Measured on google.com/maps (desktop, dispatched input): one mouse-wheel notch (deltaY 100) zooms
 * about +0.25 levels around the cursor, animated; a touchpad two-finger scroll zooms continuously at
 * about the same rate per pixel; horizontal two-finger scroll does nothing; pinch (wheel + ctrlKey)
 * zooms about 4x faster per pixel; left-drag pans with inertia. Google Earth for web: left-drag pans,
 * Shift/Ctrl+drag or middle-drag tilts and rotates, wheel zooms toward the cursor, Shift+arrows
 * tilt/rotate, arrows pan, +/- zoom, N = north up, U = level the tilt, R = reset view.
 *
 * | Input                          | Map view (Google Maps)            | 3D view (Google Earth)            |
 * |--------------------------------|-----------------------------------|-----------------------------------|
 * | Mouse wheel notch              | zoom 0.4 toward cursor, animated   | same                              |
 * | Touchpad two-finger scroll     | zoom toward cursor, per pixel      | same                              |
 * | Touchpad horizontal scroll     | nothing                            | nothing                           |
 * | Touchpad pinch (ctrl+wheel)    | zoom toward cursor, 4x per pixel   | same                              |
 * | Shift + wheel / two-finger     | rotate (and tilt on the 2nd axis)  | same                              |
 * | Left-drag                      | pan, with inertia                  | pan, with inertia                 |
 * | Shift/Ctrl/Alt + left-drag     | rotate + tilt                      | rotate + tilt (orbit the cursor)  |
 * | Right-drag, middle-drag        | rotate + tilt                      | rotate + tilt                     |
 * | Double-click                   | zoom in one level                  | same                              |
 * | Arrows / Shift+arrows / +,-    | pan / rotate+tilt / zoom           | same                              |
 * | N / U / R                      | north up / level tilt / reset view | same (in DeckMap)                 |
 * | Touchscreen                    | 2-finger pinch zoom, twist rotate, 2-finger vertical drag tilts |  |
 * A Windows precision touchpad delivers no twist/rotate gesture to web pages, so rotation there is
 * Shift + two-finger scroll, a modifier + drag, or the on-screen rotate/tilt buttons and compass.
 */
import { MapController } from "@deck.gl/core";
import type { MjolnirEvent } from "mjolnir.js";

/** Zoom levels per mouse-wheel notch (animated). */
const ZOOM_PER_NOTCH = 0.4;
/** Zoom levels per pixel of touchpad scroll (continuous). Google Maps: ~0.0025. */
const ZOOM_PER_PX = 0.003;
/** Zoom levels per pixel of pinch (ctrl+wheel). */
const ZOOM_PER_PINCH_PX = 0.012;
/** Degrees of bearing / pitch per pixel of Shift+wheel delta. */
const WHEEL_BEARING_PER_PX = 0.25;
const WHEEL_PITCH_PER_PX = 0.15;
/**
 * A mouse notch: a single large vertical delta. Chrome reports a notch as 100 / devicePixelRatio
 * CSS px (57 at 1.75x) and touchpads as streams of small deltas, so the threshold is in CSS px.
 */
const NOTCH_MIN_PX = 40;

type AnyEvent = MjolnirEvent & { srcEvent: WheelEvent & MouseEvent; rightButton?: boolean };

export class WhatIfController extends MapController {
  handleEvent(event: MjolnirEvent) {
    const e = event as AnyEvent;
    if (event.type === "wheel") {
      // deck.gl caches the controller state per event inside handleEvent; reset it ourselves, or every
      // wheel event computes from the view as it was before the first one.
      (this as unknown as { _controllerState?: unknown })._controllerState = undefined;
      return this.onWheel(e);
    }
    // Middle-drag behaves like right-drag (rotate + tilt), as in Google Earth.
    if (event.type === "panstart" && e.srcEvent && (e.srcEvent.buttons & 4) === 4) {
      return super.handleEvent({ ...e, rightButton: true } as unknown as MjolnirEvent);
    }
    return super.handleEvent(event);
  }

  private onWheel(event: AnyEvent) {
    const src = event.srcEvent;
    const pos = this.getCenter(event as unknown as Parameters<MapController["getCenter"]>[0]);
    if (!this.isPointInBounds(pos, event as unknown as Parameters<MapController["isPointInBounds"]>[1])) return false;
    src.preventDefault(); // never let the page itself scroll or browser-zoom over the map
    const lines = src.deltaMode === 1 ? 40 : 1;
    const dx = (src.deltaX || 0) * lines;
    const dy = (src.deltaY || 0) * lines;

    if (src.shiftKey && !src.ctrlKey) {
      // Browsers turn Shift+vertical-wheel into deltaX for mice; a touchpad sends both axes.
      const turn = dx || dy;
      const tilt = dx ? dy : 0;
      const state = this.controllerState
        .rotateStart({ pos })
        .rotate({ pos: undefined, deltaAngleX: -turn * WHEEL_BEARING_PER_PX, deltaAngleY: -tilt * WHEEL_PITCH_PER_PX })
        .rotateEnd();
      this.updateViewport(state, { transitionDuration: 0 }, { isRotating: false });
      return true;
    }
    if (!dy) return true; // horizontal-only two-finger scroll: nothing (Google Maps)

    const notch = !src.ctrlKey && dx === 0 && Math.abs(dy) >= NOTCH_MIN_PX;
    const levels = src.ctrlKey ? -dy * ZOOM_PER_PINCH_PX : notch ? -Math.sign(dy) * ZOOM_PER_NOTCH : -dy * ZOOM_PER_PX;
    const state = this.controllerState.zoom({ pos, scale: 2 ** levels });
    const self = this as unknown as { _getTransitionProps: (o: { around: number[] }) => Record<string, unknown> };
    this.updateViewport(state, notch ? { ...self._getTransitionProps({ around: pos }), transitionDuration: 180 } : { transitionDuration: 0 }, {
      isZooming: true,
      isPanning: true,
    });
    return true;
  }
}

/** Controller props shared by both views (left-drag pans in both, like Google Maps and Google Earth). */
export function controllerProps() {
  return {
    type: WhatIfController,
    dragPan: true,
    dragRotate: true,
    touchRotate: true,
    touchZoom: true,
    multiTouchDrag: "rotate" as const,
    scrollZoom: true,
    doubleClickZoom: true,
    keyboard: true,
    inertia: 350,
  };
}
