/**
 * WhatIf ATL data contract — the single source of truth for every lane.
 *
 * Owner: Raphael (simulation). Changes go through him, because the Python
 * simulation mirrors these schemas in pydantic (sim/). Rules:
 *   - Additive changes (new optional fields) are cheap. Renames/removals are not:
 *     bump CONTRACT_VERSION and tell the other lanes.
 *   - All coordinates are WGS84 `[lng, lat]` (deck.gl order), never `[lat, lng]`.
 *   - All times inside trips are SECONDS AFTER 6:00 AM on a weekday (the modeled
 *     morning peak is 6:00–10:00, i.e. 0..14400). This is what deck.gl TripsLayer
 *     `currentTime` uses directly.
 *   - Shares/ratios are fractions 0..1 (not percents) unless the field name says `Pct`.
 *   - Money is USD.
 *   - Display strings that are pure presentation (e.g. "1,940 hrs") are NOT in the
 *     contract; send raw numbers + `unit` and let the UI format them.
 *
 * Exported names `ScenarioEdit` and `ScenarioResult` (schema: `...Schema`) are
 * relied on by the sim agent — keep them stable.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "1.1.0"; // 1.1.0: optional ScenarioResult.source + mockSections

/* ------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* ------------------------------------------------------------------------- */

/** `[lng, lat]` in WGS84. */
export const LngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LngLat = z.infer<typeof LngLatSchema>;

/** An open polyline. */
export const PathSchema = z.array(LngLatSchema).min(2);
export type Path = z.infer<typeof PathSchema>;

/** A closed polygon ring (first point may or may not repeat the last). */
export const RingSchema = z.array(LngLatSchema).min(3);
export type Ring = z.infer<typeof RingSchema>;

/** Traffic-light grade used by every scored item. */
export const GradeSchema = z.enum(["good", "fair", "poor"]);
export type Grade = z.infer<typeof GradeSchema>;

/** Direction of an effect, for coloring numbers (gain = green, loss = red). */
export const ToneSchema = z.enum(["gain", "loss", "neutral"]);
export type Tone = z.infer<typeof ToneSchema>;

/* ------------------------------------------------------------------------- */
/* Gazetteer — the only places Claude may put stops on                        */
/* ------------------------------------------------------------------------- */

export const GazetteerKindSchema = z.enum([
  "landmark", // Ponce City Market, Krog Street Market, ...
  "neighborhood", // Old Fourth Ward, Inman Park, ...
  "marta_station", // heavy-rail stations
  "streetcar_stop", // existing Atlanta Streetcar stops
  "corridor_point", // named points along a corridor (e.g. Beltline at Irwin St)
  "employment", // big job sites (Grady, Georgia Tech, ...)
]);
export type GazetteerKind = z.infer<typeof GazetteerKindSchema>;

export const GazetteerPlaceSchema = z.object({
  /** Stable snake_case id, e.g. "ponce_city_market". Stops reference this. */
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  /** Other spellings / nicknames the parser should match ("PCM", "the Beltline at Irwin"). */
  aliases: z.array(z.string()),
  coord: LngLatSchema,
  kind: GazetteerKindSchema,
  /** Corridor ids this place sits on (see CorridorId), used by extend_line. */
  corridors: z.array(z.string()).optional(),
  /** Where the coordinate came from, e.g. "OSM node 123" — keeps us honest. */
  source: z.string().optional(),
});
export type GazetteerPlace = z.infer<typeof GazetteerPlaceSchema>;
export const GazetteerSchema = z.array(GazetteerPlaceSchema);

/* ------------------------------------------------------------------------- */
/* ScenarioEdit — what /api/plan produces and /api/simulate consumes          */
/* ------------------------------------------------------------------------- */

export const EditTypeSchema = z.enum([
  "new_rail_line",
  "extend_line",
  "new_bus_route",
  "change_frequency",
  "brt_lane",
  "new_road",
  "close_road",
  "congestion_charge",
]);
export type EditType = z.infer<typeof EditTypeSchema>;

/** Vehicle technology for transit edits. */
export const TransitTechSchema = z.enum(["streetcar", "light_rail", "heavy_rail", "bus", "brt"]);
export type TransitTech = z.infer<typeof TransitTechSchema>;

export const StopSchema = z.object({
  /** MUST be an id from src/data/gazetteer.json. Use `checkEditAgainstGazetteer`. */
  gazetteerId: z.string(),
  name: z.string(),
  coord: LngLatSchema,
});
export type Stop = z.infer<typeof StopSchema>;

export const ScenarioEditSchema = z.object({
  type: EditTypeSchema,
  /** Human title, e.g. "Streetcar East to Ponce City Market". */
  name: z.string(),
  /** Ordered stops (for transit edits). Empty for road-only edits. */
  stops: z.array(StopSchema),
  /** Named corridor the line follows, e.g. "edgewood_ave" or "beltline_eastside". */
  corridor: z.array(z.string()).optional(),
  /** For extend_line/change_frequency: the existing line id (see RailLine.id), e.g. "atlanta_streetcar". */
  baseLineId: z.string().optional(),
  tech: TransitTechSchema.optional(),
  /** Minutes between vehicles in the peak. */
  headwayMin: z.number().positive().optional(),
  /** For close_road / brt_lane / new_road: NetworkRoad ids affected. */
  roadIds: z.array(z.string()).optional(),
  /** brt_lane: car lanes removed per direction. */
  lanesRemoved: z.number().int().min(0).optional(),
  /** congestion_charge: USD per entry. */
  chargeUsd: z.number().nonnegative().optional(),
  /** congestion_charge: cordon polygon. */
  chargeZone: RingSchema.optional(),
  /** Free-text notes from the parser (assumptions it made). Display only. */
  assumptions: z.array(z.string()).optional(),
});
export type ScenarioEdit = z.infer<typeof ScenarioEditSchema>;

/**
 * Checks that every stop references a real gazetteer id and that the coord
 * matches the gazetteer (so Claude can't invent coordinates). Returns a list
 * of problems; empty means OK.
 */
export function checkEditAgainstGazetteer(edit: ScenarioEdit, gazetteer: GazetteerPlace[]): string[] {
  const byId = new Map(gazetteer.map((p) => [p.id, p]));
  const problems: string[] = [];
  for (const s of edit.stops) {
    const place = byId.get(s.gazetteerId);
    if (!place) {
      problems.push(`stop "${s.name}" references unknown gazetteer id "${s.gazetteerId}"`);
      continue;
    }
    const [dx, dy] = [Math.abs(place.coord[0] - s.coord[0]), Math.abs(place.coord[1] - s.coord[1])];
    if (dx > 1e-4 || dy > 1e-4) problems.push(`stop "${s.name}" coord does not match gazetteer "${place.id}"`);
  }
  return problems;
}

/* ------------------------------------------------------------------------- */
/* Network — static context geometry (roads, rail, Beltline)                  */
/* Lives in public/scenarios/network.json; ScenarioResult.networkUrl points    */
/* at it. Real OSM geometry for the box lng -84.42..-84.33, lat 33.73..33.80.  */
/* ------------------------------------------------------------------------- */

export const RoadClassSchema = z.enum(["motorway", "trunk", "primary", "secondary", "tertiary", "link"]);
export type RoadClass = z.infer<typeof RoadClassSchema>;

export const NetworkRoadSchema = z.object({
  /** Stable id: "w<OSM way id>". RoadEffect.roadId and ScenarioEdit.roadIds use it. */
  id: z.string(),
  name: z.string(),
  class: RoadClassSchema,
  path: PathSchema,
  lanes: z.number().int().positive().optional(),
  /** Highway ref, e.g. "I 75;I 85". */
  ref: z.string().optional(),
});
export type NetworkRoad = z.infer<typeof NetworkRoadSchema>;

export const RailKindSchema = z.enum(["marta_heavy_rail", "streetcar", "freight"]);
export type RailKind = z.infer<typeof RailKindSchema>;

export const RailLineSchema = z.object({
  /** e.g. "marta_east", "atlanta_streetcar". */
  id: z.string(),
  name: z.string(),
  kind: RailKindSchema,
  /** One line = many OSM ways; each is its own polyline. */
  paths: z.array(PathSchema),
});
export type RailLine = z.infer<typeof RailLineSchema>;

export const StationSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["marta_station", "streetcar_stop"]),
  coord: LngLatSchema,
});
export type Station = z.infer<typeof StationSchema>;

export const BeltlineSegmentSchema = z.object({
  id: z.string(),
  /** "Atlanta Beltline Eastside Trail", ... */
  name: z.string(),
  status: z.enum(["open", "interim", "planned"]),
  path: PathSchema,
});
export type BeltlineSegment = z.infer<typeof BeltlineSegmentSchema>;

/** Overlay kinds a history card can switch on. */
export const HistoryOverlaySchema = z.enum(["redline", "county", "highway", "beltline", "renewal"]);
export type HistoryOverlay = z.infer<typeof HistoryOverlaySchema>;

/** Geometry drawn when a history overlay is on. `placeholder: true` = not yet from the cited source. */
export const OverlayFeatureSchema = z.object({
  id: z.string(),
  overlay: HistoryOverlaySchema,
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("polygon"), ring: RingSchema }),
    z.object({ type: z.literal("path"), path: PathSchema }),
  ]),
  label: z.string().optional(),
  /** HOLC grade for redline polygons. */
  grade: z.enum(["A", "B", "C", "D"]).optional(),
  placeholder: z.boolean(),
});
export type OverlayFeature = z.infer<typeof OverlayFeatureSchema>;

export const NetworkSchema = z.object({
  version: z.string(),
  /** [west, south, east, north] */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  source: z.string(),
  roads: z.array(NetworkRoadSchema),
  rail: z.array(RailLineSchema),
  stations: z.array(StationSchema),
  beltline: z.array(BeltlineSegmentSchema),
  overlays: z.array(OverlayFeatureSchema),
});
export type Network = z.infer<typeof NetworkSchema>;

/* ------------------------------------------------------------------------- */
/* ScenarioResult — what /api/simulate returns                                 */
/* ------------------------------------------------------------------------- */

export const ModeSchema = z.enum(["drive", "transit", "park_ride"]);
export type Mode = z.infer<typeof ModeSchema>;

/** One commute, shaped for deck.gl TripsLayer. */
export const TripSchema = z
  .object({
    mode: ModeSchema,
    /** Door-to-door minutes. */
    minutes: z.number().nonnegative(),
    path: PathSchema,
    /** Seconds after 6:00 AM, one per path vertex, non-decreasing. */
    timestamps: z.array(z.number().min(0)),
    /** Optional: which transit line(s) this trip rides (RailLine ids or "proposed"). */
    lines: z.array(z.string()).optional(),
  })
  .refine((t) => t.timestamps.length === t.path.length, { message: "timestamps must match path length" });
export type Trip = z.infer<typeof TripSchema>;

export const EarningsBandSchema = z.enum(["low", "mid", "high"]); // LODES SE01/SE02/SE03
export type EarningsBand = z.infer<typeof EarningsBandSchema>;

export const StakeSchema = z.object({
  /** proposed.minutes - baseline.minutes (negative = faster). */
  minutesDelta: z.number(),
  /** Lives in a rent-pressure tract near a new stop. */
  rentPressure: z.boolean(),
  /** Lives within the noise/construction buffer (~150 m) of new track. */
  noiseZone: z.boolean(),
  /** Household's share of the capital cost, USD per year. */
  costShareUsdYr: z.number().nonnegative(),
  /** -1 (strongly against) .. +1 (strongly for). */
  supportScore: z.number().min(-1).max(1),
});
export type Stake = z.infer<typeof StakeSchema>;

export const DisplacementRiskSchema = z.enum(["none", "year5", "year10"]);
export type DisplacementRisk = z.infer<typeof DisplacementRiskSchema>;

/** A display-sample commuter (the model runs on everyone; these are the dots). */
export const AgentSchema = z.object({
  id: z.string(),
  home: LngLatSchema,
  work: LngLatSchema,
  /** Tract id (matches TractEffect.id). */
  tractId: z.string(),
  earningsBand: EarningsBandSchema,
  renter: z.boolean(),
  hasCar: z.boolean(),
  baseline: TripSchema,
  proposed: TripSchema,
  stake: StakeSchema,
  /** "year5" = at risk by year 5 (and therefore also year 10). */
  displacementRisk: DisplacementRiskSchema,
});
export type Agent = z.infer<typeof AgentSchema>;

export const ModelMetricsSchema = z.object({
  avgCommuteMin: z.number(),
  /** 0..1 share of modeled commuters using transit or park-and-ride. */
  transitShare: z.number().min(0).max(1),
  dailyTransitRiders: z.number().nonnegative(),
  /** Commuters the model actually ran (~248k). */
  populationModeled: z.number().int().nonnegative(),
  /** Number of agents in `agents` (display sample). */
  displaySampleSize: z.number().int().nonnegative(),
});
export type ModelMetrics = z.infer<typeof ModelMetricsSchema>;

/** The five verdict tests. Keys are fixed so the UI and sim agree. */
export const VerdictTestKeySchema = z.enum([
  "time_saved", // total person-hours saved per weekday
  "new_riders", // daily riders who switched to transit
  "cost_per_rider", // 20-yr cost / (new riders * trips over 20 yrs)
  "redlined_benefit_share", // share of time saved accruing to formerly HOLC-D tracts
  "renters_rent_pressure", // renter households near new stops in rent-pressure tracts
]);
export type VerdictTestKey = z.infer<typeof VerdictTestKeySchema>;

export const VerdictTestSchema = z.object({
  key: VerdictTestKeySchema,
  label: z.string(),
  sublabel: z.string(),
  value: z.number(),
  /** "hrs/day", "riders/day", "usd/trip", "share", "households". */
  unit: z.string(),
  grade: GradeSchema,
});
export type VerdictTest = z.infer<typeof VerdictTestSchema>;

export const AlternativeSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** One-line why-it-scores-better. */
  detail: z.string(),
  /** Short facts, e.g. ["−3.1 min for riders", "$18M"]. */
  highlights: z.array(z.string()),
  /** If present, clicking it can re-run /api/simulate with this edit. */
  edit: ScenarioEditSchema.optional(),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const VerdictSchema = z.object({
  label: z.enum(["good", "mixed", "poor"]),
  headline: z.string(),
  summary: z.string(),
  tests: z.array(VerdictTestSchema).length(5),
  /** Three plans that score better ("fix mode"). */
  alternatives: z.array(AlternativeSchema),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const ImpactTileSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  tone: ToneSchema,
});
export type ImpactTile = z.infer<typeof ImpactTileSchema>;

/** Shares 0..1 that sum to ~1. */
export const ModeSplitSchema = z.object({ drive: z.number(), transit: z.number(), park_ride: z.number() });
export type ModeSplit = z.infer<typeof ModeSplitSchema>;

export const ImpactSchema = z.object({
  tiles: z.array(ImpactTileSchema),
  /** Corridor commuters only. */
  modeSplit: z.object({ before: ModeSplitSchema, after: ModeSplitSchema, scope: z.string() }),
  minutesSavedByEarnings: z.array(
    z.object({ band: EarningsBandSchema, label: z.string(), minutesSaved: z.number() }),
  ),
  /** How well the model matches reality (Google Routes, ACS). */
  calibration: z.array(
    z.object({ key: z.string(), label: z.string(), value: z.number(), unit: z.string(), detail: z.string() }),
  ),
  notes: z.array(z.string()).optional(),
});
export type Impact = z.infer<typeof ImpactSchema>;

/** Per-road spillover, for coloring the road network. */
export const RoadEffectSchema = z.object({
  roadId: z.string(),
  /** Peak-hour volume / capacity. */
  vcBaseline: z.number().nonnegative(),
  vcProposed: z.number().nonnegative(),
  /** Change in average per-trip delay on this road, minutes (positive = slower). */
  delayDeltaMin: z.number(),
});
export type RoadEffect = z.infer<typeof RoadEffectSchema>;

export const TractEffectSchema = z.object({
  /** Census tract GEOID when real; "mock_..." in the mock. */
  id: z.string(),
  name: z.string().optional(),
  centroid: LngLatSchema,
  polygon: RingSchema.optional(),
  /** Avg commute change for residents, minutes (negative = faster). */
  minutesDelta: z.number(),
  /** Mostly HOLC grade D in 1938. */
  redlined: z.boolean(),
  /** High renter share + low income within 800 m of a new stop. */
  rentPressure: z.boolean(),
  renterShare: z.number().min(0).max(1).optional(),
  households: z.number().int().nonnegative().optional(),
});
export type TractEffect = z.infer<typeof TractEffectSchema>;

/** Map zones the "Who pays" items can highlight. */
export const ZoneKindSchema = z.enum(["rent_pressure", "noise_construction", "spillover", "regional_cost"]);
export type ZoneKind = z.infer<typeof ZoneKindSchema>;

export const WhoPaysSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.number(),
      /** "min", "households", "usd/yr", ... */
      unit: z.string(),
      detail: z.string(),
      zone: ZoneKindSchema.optional(),
      /** RoadEffect ids this item is about (for highlighting). */
      roadIds: z.array(z.string()).optional(),
    }),
  ),
  approval: z.object({
    /** 0..1 */
    support: z.number().min(0).max(1),
    oppose: z.number().min(0).max(1),
    /** Number of stake scores it was computed from. */
    basis: z.number().int(),
    note: z.string(),
  }),
});
export type WhoPays = z.infer<typeof WhoPaysSchema>;

export const ClaimRatingSchema = z.enum(["accurate", "overstated", "understated", "partly", "unsupported"]);
export type ClaimRating = z.infer<typeof ClaimRatingSchema>;

/** A claim pulled out of a pasted article by /api/plan (before simulation). */
export const ExtractedClaimSchema = z.object({
  id: z.string(),
  /** Verbatim short quote from the article. */
  quote: z.string(),
  /** Which metric it maps to, if any: "daily_riders", "capital_cost_usd", "traffic", ... */
  metric: z.string().optional(),
  /** Number the article asserts, if numeric. */
  claimedValue: z.number().optional(),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

/** Article check row after simulation. */
export const ClaimCheckSchema = ExtractedClaimSchema.extend({
  /** What the article says, paraphrased short: "10,000 riders/day". */
  claimed: z.string(),
  /** What the model measured: "3,800–4,400 riders/day". */
  measured: z.string(),
  rating: ClaimRatingSchema,
});
export type ClaimCheck = z.infer<typeof ClaimCheckSchema>;

export const StanceSchema = z.enum(["for", "against", "mixed"]);
export type Stance = z.infer<typeof StanceSchema>;

export const PersonaSchema = z.object({
  id: z.string(),
  /** First name only. */
  name: z.string(),
  age: z.number().int(),
  /** "ICU nurse, renter in Old Fourth Ward" — no ethnicity / national origin. */
  descriptor: z.string(),
  stance: StanceSchema,
  /** Opening one-liner, generated from their own numbers. */
  quote: z.string(),
  /** Short facts: ["31 → 19 min", "renter", "noise zone"]. */
  stakeChips: z.array(z.string()),
  tractId: z.string(),
  /** Agent this persona is drawn from, if any. */
  agentId: z.string().optional(),
  home: LngLatSchema,
  /** Mock only: canned replies for /api/persona until Claude is wired in. */
  cannedReplies: z.array(z.string()).optional(),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const HorizonSchema = z.object({
  /** Renter households at risk of being priced out (a proxy range, not a forecast). */
  householdsAtRisk: z.object({ low: z.number().int(), high: z.number().int() }),
  note: z.string(),
});
export type Horizon = z.infer<typeof HorizonSchema>;

export const LookaheadSchema = z.object({
  year5: HorizonSchema,
  year10: HorizonSchema,
  /** "What happened last time" — e.g. Eastside Trail tracts 2010–2020. */
  lastTime: z.object({
    title: z.string(),
    period: z.string(),
    stats: z.array(
      z.object({ label: z.string(), value: z.string(), source: z.string(), verified: z.boolean() }),
    ),
    note: z.string(),
  }),
});
export type Lookahead = z.infer<typeof LookaheadSchema>;

/** Where a ScenarioResult came from. /api/simulate always sets it on the way out. */
export const ScenarioSourceSchema = z.enum([
  "live_sim", // computed just now by the Python service at SIM_URL
  "prebaked_sim", // a sim run saved as public/scenarios/<id>.sim.json
  "mock", // the frontend's seeded mock generator (every number is a placeholder)
]);
export type ScenarioSource = z.infer<typeof ScenarioSourceSchema>;

/**
 * Vocabulary for ScenarioResult.mockSections: parts of a sim result that were NOT computed by
 * the sim (copied from the mock / placeholders). A key also covers everything below it
 * ("verdict" covers "verdict.headline"). The UI marks these sections as mock.
 */
export const MOCK_SECTION_KEYS = [
  "verdict.label",
  "verdict.headline",
  "verdict.summary",
  "verdict.grades",
  "verdict.alternatives",
  "verdict.tests.time_saved",
  "verdict.tests.new_riders",
  "verdict.tests.cost_per_rider",
  "verdict.tests.redlined_benefit_share",
  "verdict.tests.renters_rent_pressure",
  "impact.tiles",
  "impact.calibration",
  "impact.modeSplit",
  "impact.minutesSavedByEarnings",
  "whoPays.items",
  "whoPays.approval",
  "claims",
  "personas",
  "lookahead",
  "tracts.equity", // TractEffect.redlined / rentPressure / renterShare / households
  "agents.equity", // Agent.renter / stake.rentPressure / stake.costShareUsdYr / displacementRisk
] as const;

export const ScenarioResultSchema = z.object({
  id: z.string(),
  /** Optional (added in 1.1.0). Set by /api/simulate; the sim may also emit it. */
  source: ScenarioSourceSchema.optional(),
  /**
   * Optional (added in 1.1.0). Keys from MOCK_SECTION_KEYS that are placeholders in this result.
   * Ignored when isMock is true (then everything is mock).
   */
  mockSections: z.array(z.string()).optional(),
  contractVersion: z.string(),
  title: z.string(),
  edit: ScenarioEditSchema,
  /** True for anything not produced by the real simulation. UI shows a "mock data" badge. */
  isMock: z.boolean(),
  generatedAt: z.string(),
  /** Modeled window, seconds after 6:00 AM. */
  timeWindow: z.object({ startSec: z.number(), endSec: z.number() }),
  /** The proposed line, for the build animation. Empty path for road-only edits. */
  line: z.object({ path: z.array(LngLatSchema), stops: z.array(StopSchema) }),
  /** URL of the static Network JSON (roads/rail/Beltline/overlays). */
  networkUrl: z.string(),
  /** Optional inline network (otherwise fetch networkUrl). */
  network: NetworkSchema.optional(),
  metrics: z.object({ baseline: ModelMetricsSchema, proposed: ModelMetricsSchema }),
  verdict: VerdictSchema,
  impact: ImpactSchema,
  agents: z.array(AgentSchema),
  roads: z.array(RoadEffectSchema),
  tracts: z.array(TractEffectSchema),
  whoPays: WhoPaysSchema,
  /** Article check; empty unless the plan came from an article. */
  claims: z.array(ClaimCheckSchema),
  personas: z.array(PersonaSchema),
  lookahead: LookaheadSchema,
});
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;

/* ------------------------------------------------------------------------- */
/* History                                                                     */
/* ------------------------------------------------------------------------- */

export const HistoryEventSchema = z.object({
  id: z.string(),
  /** Sort key (first year of the period). */
  year: z.number().int(),
  /** Display year, e.g. "1960s" or "2019–20". */
  yearLabel: z.string(),
  title: z.string(),
  body: z.string(),
  /** Citation. Only cited records reach the screen. */
  source: z.string(),
  sourceUrl: z.string().url().optional(),
  /** False until a teammate has checked it against the source. */
  verified: z.boolean(),
  overlay: HistoryOverlaySchema,
  /** Shown over the map when the overlay is on. */
  note: z.string(),
});
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;
export const HistorySchema = z.array(HistoryEventSchema);

/* ------------------------------------------------------------------------- */
/* API request / response types                                                */
/* ------------------------------------------------------------------------- */

export const PlanModeSchema = z.enum(["prompt", "article", "fix"]);
export type PlanMode = z.infer<typeof PlanModeSchema>;

/** POST /api/plan */
export const PlanRequestSchema = z.object({
  text: z.string().min(1).max(20000),
  mode: PlanModeSchema,
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const PlanResponseSchema = z.object({
  edit: ScenarioEditSchema,
  /** Present in article mode. */
  claims: z.array(ExtractedClaimSchema).optional(),
  /** Fix mode may return several candidate edits. */
  candidates: z.array(ScenarioEditSchema).optional(),
  isMock: z.boolean(),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

/** POST /api/simulate → ScenarioResult */
export const SimulateRequestSchema = z.object({
  edit: ScenarioEditSchema,
  /** Article claims to check against the result. */
  claims: z.array(ExtractedClaimSchema).optional(),
});
export type SimulateRequest = z.infer<typeof SimulateRequestSchema>;
export const SimulateResponseSchema = ScenarioResultSchema;
export type SimulateResponse = ScenarioResult;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "persona"]),
  content: z.string().min(1).max(4000),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** POST /api/persona */
export const PersonaRequestSchema = z.object({
  scenarioId: z.string(),
  personaId: z.string(),
  messages: z.array(ChatMessageSchema).max(50),
});
export type PersonaRequest = z.infer<typeof PersonaRequestSchema>;

export const PersonaResponseSchema = z.object({
  personaId: z.string(),
  reply: z.string(),
  isMock: z.boolean(),
});
export type PersonaResponse = z.infer<typeof PersonaResponseSchema>;

/** Every API route returns this on 4xx/5xx. */
export const ApiErrorSchema = z.object({ error: z.string(), details: z.unknown().optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;
