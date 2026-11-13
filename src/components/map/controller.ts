/**
 * Map controller with every rotation channel a Windows laptop actually delivers:
 *   - touchscreen: two-finger twist rotates, two-finger vertical drag tilts (touchRotate + multiTouchDrag)
 *   - precision touchpad: two-finger scroll orbits/tilts (deck.gl `trackpadGesture` classifies the wheel
 *     stream as a trackpad and routes it to multiTouchDrag), pinch (ctrl+wheel) zooms
 *   - mouse: right-drag, or Ctrl/Alt/Shift + drag, rotates and tilts; Shift + wheel rotates (handled here)
 *   - keyboard (map focused): arrows pan, Shift+arrows rotate/tilt, +/- zoom (deck.gl defaults)
 */
import { MapController } from "@deck.gl/core";
import type { MjolnirEvent } from "mjolnir.js";

/** Degrees of bearing / pitch per pixel of Shift+wheel delta. */
const WHEEL_BEARING_PER_PX = 0.25;
const WHEEL_PITCH_PER_PX = 0.15;

export class WhatIfController extends MapController {
  handleEvent(event: MjolnirEvent) {
    const src = (event as unknown as { srcEvent?: WheelEvent }).srcEvent;
    if (event.type === "wheel" && src?.shiftKey && !src.ctrlKey) {
      src.preventDefault();
      // Browsers turn Shift+vertical-wheel into deltaX for mice; a touchpad sends both axes.
      const dx = src.deltaX || 0;
      const dy = src.deltaX ? src.deltaY || 0 : 0;
      const turn = dx || src.deltaY || 0;
      const state = this.controllerState
        .rotateStart({ pos: undefined as unknown as [number, number] })
        .rotate({ deltaAngleX: -turn * WHEEL_BEARING_PER_PX, deltaAngleY: -dy * WHEEL_PITCH_PER_PX })
        .rotateEnd();
      this.updateViewport(state, { transitionDuration: 0 }, { isRotating: false });
      return true;
    }
    return super.handleEvent(event);
  }
}

/** Controller props shared by both views. Photoreal: left-drag orbits (3D-viewer style), right-drag pans. */
export function controllerProps(photoreal: boolean) {
  return {
    type: WhatIfController,
    dragPan: true,
    dragRotate: true,
    dragMode: photoreal ? ("rotate" as const) : ("pan" as const),
    touchRotate: true,
    touchZoom: true,
    multiTouchDrag: "rotate" as const,
    trackpadGesture: true,
    scrollZoom: true,
    keyboard: true,
    inertia: 300,
  };
}
