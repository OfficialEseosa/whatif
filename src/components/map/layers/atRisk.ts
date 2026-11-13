/** Look-ahead: rings at the homes of agents at risk of being priced out by the selected horizon. */
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Agent } from "@/lib/contract";
import type { Horizon } from "@/lib/store";
import { MAP_COLORS } from "../colors";
import { LIFT_M, liftPoint, terrainProps } from "./common";

export function atRiskLayer(agents: Agent[], horizon: Horizon, photoreal: boolean) {
  const data = agents.filter((a) => (horizon === "year5" ? a.displacementRisk === "year5" : a.displacementRisk !== "none"));
  return new ScatterplotLayer<Agent>({
    id: "at-risk-homes",
    data,
    getPosition: (d) => liftPoint(d.home, photoreal ? LIFT_M.stops : 0),
    updateTriggers: { getPosition: photoreal },
    getRadius: 4,
    radiusUnits: "pixels",
    stroked: true,
    filled: false,
    getLineColor: MAP_COLORS.atRisk,
    lineWidthMinPixels: 1.2,
    ...terrainProps(photoreal),
  });
}
