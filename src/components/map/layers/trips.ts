/**
 * Commuter dots with trails (deck.gl TripsLayer). Agents switch from baseline to proposed
 * trips as `switchProgress` goes 0 -> 1; at-risk agents fade with the look-ahead horizon.
 */
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Agent, LngLat } from "@/lib/contract";
import type { Horizon } from "@/lib/store";
import { MAP_COLORS, withAlpha, type RGBA } from "../colors";
import { hash01, overlayParameters } from "./common";

export type TripDatum = { path: LngLat[]; timestamps: number[]; color: RGBA };

/** Builds per-agent trip data. Memoize on (agents, switchStep, horizon). */
export function buildTripData(agents: Agent[], switchStep: number, horizon: Horizon): TripDatum[] {
  return agents.map((a, i) => {
    const switched = hash01(i) < switchStep;
    const trip = switched ? a.proposed : a.baseline;
    let color: RGBA = trip.mode === "drive" ? MAP_COLORS.tripDrive : MAP_COLORS.tripTransit;
    if (switched && trip.lines?.includes("proposed")) color = MAP_COLORS.tripLine;
    else if (switched && a.stake.minutesDelta > 1) color = MAP_COLORS.tripSlower;
    const atRisk = (horizon === "year5" && a.displacementRisk === "year5") || (horizon === "year10" && a.displacementRisk !== "none");
    if (atRisk) color = withAlpha(color, 35);
    return { path: trip.path, timestamps: trip.timestamps, color };
  });
}

export function tripsLayer(data: TripDatum[], currentTime: number, photoreal: boolean) {
  return new TripsLayer<TripDatum>({
    id: "trips",
    data,
    getPath: (d) => d.path,
    getTimestamps: (d) => d.timestamps,
    getColor: (d) => d.color,
    widthMinPixels: 2.5,
    capRounded: true,
    jointRounded: true,
    trailLength: 240,
    fadeTrail: true,
    currentTime,
    parameters: overlayParameters(photoreal),
  });
}
