/**
 * Claude reads a finished simulation and writes two things for a resident: what happened, in plain
 * words, and three changes worth trying next. It is given the simulator's numbers and adds none.
 * Returns null when there is no key or the call fails; the UI then keeps the simulator's own headline.
 */
import { z } from "zod";
import { EditTypeSchema, TransitTechSchema, VerdictSchema } from "@/lib/contract";
import { CORE_BBOX } from "@/lib/geo";
import { CLAUDE_MODEL, claudeClient } from "./client";
import { loadGazetteer } from "./plan/gazetteer";

const TIMEOUT_MS = 12_000;

const MetricsSchema = z.object({ avgCommuteMin: z.number(), transitShare: z.number(), dailyTransitRiders: z.number(), populationModeled: z.number() });
export const ExplainRequestSchema = z.object({
  plan: z.object({
    name: z.string().max(200),
    type: EditTypeSchema,
    tech: TransitTechSchema.optional(),
    stops: z.array(z.string().max(120)).max(40),
    headwayMin: z.number().optional(),
    lanesRemoved: z.number().optional(),
    stations: z.number().optional(),
  }),
  verdict: VerdictSchema.pick({ label: true, summary: true, tests: true }),
  metrics: z.object({ baseline: MetricsSchema, proposed: MetricsSchema }),
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export const InsightSchema = z.object({ summary: z.string().min(1), followUps: z.array(z.string().min(1)) });
export type Insight = z.infer<typeof InsightSchema>;

const TOOL = {
  name: "submit_explanation",
  description: "Submit the plain-words explanation and three follow-up changes.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "Two short sentences, 35 words at most, for a resident with no transit background: what the plan does to commutes and why it got its verdict. Do not repeat the plan's name.",
      },
      followUps: {
        type: "array",
        items: { type: "string" },
        description: 'Exactly 3 changes to this plan, each 6 words at most, written as the user would type them, e.g. "Run it every 5 minutes".',
      },
    },
    required: ["summary", "followUps"],
  },
};

const SYSTEM = `You explain the result of a commute simulation for Atlanta to a resident.

The simulator models weekday morning work commutes only. The verdict rule is fixed: Poor when commuters as a whole lose time, or when the plan draws few new riders at a high cost per trip; Good when at least 3 of the 5 tests are good and none of time, new riders or cost is poor; otherwise Mixed. If a Good plan still has a poor test, say so plainly.

summary:
- Use only the numbers you are given. Round them to whole numbers ("under an hour" for less than 1). Do not add facts.
- Plain words. Say "hours of commuting", "people switch to transit", "formerly redlined neighborhoods". Never say commuter-hours, headway, tract, mode share, BRT.
- Give a reason only when the plan itself shows it (a car lane was taken, the line has only two stops, it runs rarely), and call it likely.
- Mention the average commute only when it changes by a whole minute or more. Never write "from 49 to 49 minutes".
- No advice in the summary, no hedging filler, no exclamation marks.

followUps:
- Each must be a change this simulator can run: how often it runs ("Run it every 5 minutes"), adding or dropping a stop at a place from PLACES ("Add a stop at Centennial Olympic Park"), extending it to a place from PLACES, switching the vehicle (bus, bus lane, streetcar, light rail), or for a bus lane how many car lanes it takes ("Keep all car lanes").
- When the plan only changes how often an existing line runs (type change_frequency), suggest only other frequencies or the same change on another line ("Run the Blue Line every 5 minutes"). Never suggest adding a stop to it.
- Aim them at what scored worst. Do not suggest what the plan already has.
- Always answer with the submit_explanation tool.`;

let places: string | null = null;
function placesText(): string {
  if (places) return places;
  const [w, s, e, n] = CORE_BBOX;
  places = loadGazetteer()
    .filter((p) => p.coord[0] >= w && p.coord[0] <= e && p.coord[1] >= s && p.coord[1] <= n)
    .map((p) => p.name)
    .join("; ");
  return places;
}

export async function explainResult(req: ExplainRequest): Promise<Insight | null> {
  const client = claudeClient(TIMEOUT_MS);
  if (!client) return null;
  const tests = req.verdict.tests.map((t) => ({ test: t.label, value: t.value, unit: t.unit, grade: /^(Not applicable|Baseline)/.test(t.sublabel) ? "not scored" : t.grade }));
  const data = { plan: req.plan, verdict: req.verdict.label, tests, today: req.metrics.baseline, withPlan: req.metrics.proposed, simulatorNotes: req.verdict.summary };
  try {
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: [{ type: "text", text: `${SYSTEM}\n\nPLACES: ${placesText()}`, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: JSON.stringify(data) }],
    });
    const block = msg.content.find((b) => b.type === "tool_use");
    const parsed = InsightSchema.safeParse(block?.type === "tool_use" ? block.input : null);
    if (!parsed.success) return null;
    // Two sentences at most, whatever the model wrote, so the five tests stay in view.
    const summary = parsed.data.summary.trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    // A frequency change has no stops to add to: drop that suggestion if the model made it anyway.
    const noStops = req.plan.type === "change_frequency";
    const followUps = parsed.data.followUps.map((f) => f.trim().replace(/[.!]+$/, "")).filter((f) => !(noStops && /\bstop\b/i.test(f)));
    return { summary, followUps: followUps.slice(0, 3) };
  } catch (e) {
    console.warn("explain: Claude call failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
