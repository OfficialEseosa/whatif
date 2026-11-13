/**
 * Claude reads the user's text into PlanHints: what kind of change, which places, which streets,
 * which numbers. The edit itself is still built and checked by fallbackEdit, so every id and
 * coordinate comes from the gazetteer and the network, never from the model.
 * Returns null (caller keeps the keyword rules) when there is no key or the call fails.
 */
import { z } from "zod";
import { EditTypeSchema, TransitTechSchema, type PlanRequest } from "@/lib/contract";
import { CLAUDE_MODEL, claudeClient } from "../client";
import type { PlanHints } from "./fallback";
import { loadGazetteer } from "./gazetteer";
import { loadNetwork } from "./network";

const TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 8000;

const HintsSchema = z.object({
  type: EditTypeSchema,
  tech: TransitTechSchema.nullish(),
  stopIds: z.array(z.string()).default([]),
  roadNames: z.array(z.string()).default([]),
  changesPrevious: z.boolean().nullish(),
  baseLineId: z.string().nullish(),
  headwayMin: z.number().positive().nullish(),
  lanesRemoved: z.number().int().min(0).nullish(),
  chargeUsd: z.number().nonnegative().nullish(),
  name: z.string().min(1),
  notes: z.array(z.string()).default([]),
});

const TOOL = {
  name: "submit_plan",
  description: "Submit the transit or road plan read from the user's text.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: { type: "string", enum: EditTypeSchema.options },
      tech: { type: "string", enum: TransitTechSchema.options, description: "Vehicle for transit plans. Omit for road-only plans." },
      stopIds: { type: "array", items: { type: "string" }, description: "Place ids from PLACES, in order along the route. Empty for road-only plans." },
      roadNames: { type: "array", items: { type: "string" }, description: "Street names copied exactly from ROADS, only for streets the user named." },
      changesPrevious: { type: "boolean", description: "True when the text asks for a change to PREVIOUS PLAN. False when it describes a new plan or there is no previous plan." },
      baseLineId: { type: "string", description: "Id from LINES, for extend_line and change_frequency." },
      headwayMin: { type: "number", description: "Minutes between vehicles, only if the user gave it." },
      lanesRemoved: { type: "integer", description: "Car lanes removed per direction for brt_lane, only if the user gave it." },
      chargeUsd: { type: "number", description: "Dollars per entry for congestion_charge, only if the user gave it." },
      name: { type: "string", description: 'Short plain title a resident would say, e.g. "Bus lane from Georgia State to Georgia Tech". Under 60 characters, no jargon, no abbreviations.' },
      notes: {
        type: "array",
        items: { type: "string" },
        description:
          "At most 2 short sentences a resident would want to know: what an abbreviation or nickname was read as, or a named place that could not be found. Empty when nothing was guessed. Never mention ids, PLACES, ROADS, LINES or these instructions.",
      },
    },
    required: ["type", "stopIds", "roadNames", "name", "notes"],
  },
};

const SYSTEM = `You read plain-English transit ideas for Atlanta and turn them into a plan for a commute simulator.

Plan types:
- new_rail_line: a new streetcar, light rail or heavy rail line between places.
- extend_line: extend an existing line (LINES) to new places.
- new_bus_route: a new ordinary bus route between places.
- brt_lane: a bus lane or bus rapid transit, either on a named street or between places.
- change_frequency: run an existing line more or less often.
- close_road: close a named street to cars.
- new_road: a new road.
- congestion_charge: charge drivers to enter an area.

Rules:
- Work out what people mean. Resolve abbreviations, nicknames and misspellings to PLACES ("GSU" is Georgia State, "GT" is Georgia Tech, "PCM" is Ponce City Market).
- stopIds must be ids from PLACES, in the order the route runs. Never invent an id. If a named place is not in PLACES, leave it out and say so in notes.
- Any place in PLACES can be a stop, whatever its kind: a landmark, a neighborhood or a station. When asked to add a stop at one, add it in route order.
- When two places share a name, prefer the station.
- roadNames only when the user named a street, copied exactly from ROADS.
- For a lane, closure or new road on a named street, leave stopIds empty unless the user also named places.
- "bus lane" or "BRT" means brt_lane with tech brt. A plain "bus" between places means new_bus_route with tech bus.
- If PREVIOUS PLAN is given and the text changes it ("make it every 8 minutes", "add a stop at Krog Street", "make it a streetcar instead"), set changesPrevious and return the whole updated plan: keep its stops and numbers and change only what was asked. A new vehicle changes the type to match (rail vehicles are new_rail_line, a plain bus is new_bus_route, a bus lane is brt_lane). Otherwise ignore PREVIOUS PLAN.
- change_frequency is only for a line that already exists in LINES. Running a proposed line more often keeps the proposed line's type and sets headwayMin.
- If the text is a news article, read the main project it proposes.
- MARTA colour names: the Red and Gold lines are marta_north; the Blue and Green lines are marta_east_west.
- Always answer with the submit_plan tool.`;

let reference: string | null = null;
function referenceText(): string {
  if (reference) return reference;
  const net = loadNetwork();
  const places = loadGazetteer().map((p) => `${p.id} | ${p.name}${p.aliases.length ? ` | also: ${p.aliases.join(", ")}` : ""} | ${p.kind}`);
  const lines = net.rail.filter((l) => l.kind !== "freight").map((l) => `${l.id} | ${l.name}`);
  const roads = [...new Set(net.roads.map((r) => r.name).filter(Boolean))].sort();
  reference = `PLACES (id | name | also known as | kind):\n${places.join("\n")}\n\nLINES (id | name):\n${lines.join("\n")}\n\nROADS:\n${roads.join("\n")}`;
  return reference;
}

export async function readPlanWithClaude(req: PlanRequest): Promise<PlanHints | null> {
  const client = claudeClient(TIMEOUT_MS);
  if (!client) return null;
  const prev = req.previousEdit;
  const previous = prev
    ? `\n\nPREVIOUS PLAN:\n${JSON.stringify({ type: prev.type, tech: prev.tech, name: prev.name, stopIds: prev.stops.map((s) => s.gazetteerId), baseLineId: prev.baseLineId, headwayMin: prev.headwayMin, lanesRemoved: prev.lanesRemoved, chargeUsd: prev.chargeUsd, streets: prev.roadIds?.length ?? 0 })}`
    : "";
  try {
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: `${SYSTEM}\n\n${referenceText()}`, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: `TEXT:\n${req.text.slice(0, MAX_TEXT_CHARS)}${previous}` }],
    });
    const block = msg.content.find((b) => b.type === "tool_use");
    const parsed = HintsSchema.safeParse(block?.type === "tool_use" ? block.input : null);
    if (!parsed.success) {
      console.warn("plan: Claude's answer did not fit, using keyword rules:", parsed.error.issues[0]?.path.join("."), parsed.error.issues[0]?.message);
      return null;
    }
    const h = parsed.data;
    // A proposed line run more often is still that proposed line, not a change to an existing one.
    // Naming an existing line ("run the Red Line every 5 minutes") is a new plan about that line.
    const aboutPrevious = !!h.changesPrevious || !h.baseLineId;
    const keepsType = h.type === "change_frequency" && prev && prev.type !== "change_frequency" && !prev.baseLineId && aboutPrevious;
    let type = keepsType ? prev.type : h.type;
    // The vehicle decides between the three "new line" types when the two disagree.
    if (type === "brt_lane" || type === "new_bus_route" || type === "new_rail_line") {
      if (h.tech === "streetcar" || h.tech === "light_rail" || h.tech === "heavy_rail") type = "new_rail_line";
      else if (h.tech === "brt") type = "brt_lane";
      else if (h.tech === "bus") type = "new_bus_route";
    }
    return {
      type,
      changesPrevious: !!prev && !!h.changesPrevious,
      tech: h.tech ?? undefined,
      stopIds: h.stopIds,
      roadNames: h.roadNames,
      baseLineId: keepsType ? undefined : (h.baseLineId ?? undefined),
      headwayMin: h.headwayMin ?? undefined,
      lanesRemoved: h.lanesRemoved ?? undefined,
      chargeUsd: h.chargeUsd ?? undefined,
      name: h.name,
      notes: h.notes.slice(0, 2),
    };
  } catch (e) {
    console.warn("plan: Claude call failed, using keyword rules:", e instanceof Error ? e.message : e);
    return null;
  }
}
