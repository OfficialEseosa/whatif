import type { PlanMode } from "@/lib/contract";

/**
 * Works out what the single prompt box was given, so /api/plan keeps its `mode` contract.
 *
 * Rule, in order:
 *   1. article: long text (over 280 characters), a blank line between paragraphs, or three or more
 *      sentences. That is what a pasted news story or plan document looks like.
 *   2. fix: phrased as a goal or a problem ("fix", "reduce", "cut commute times", "how do we",
 *      "buses take 70 minutes") and naming no concrete build verb (extend, add, run, close, ...).
 *   3. prompt: everything else, i.e. a concrete plan to build.
 */
export function detectMode(input: string): PlanMode {
  const text = input.trim();
  if (!text) return "prompt";
  const sentences = text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 12).length;
  if (text.length > 280 || /\n\s*\n/.test(text) || sentences >= 3) return "article";
  if (PROBLEM.test(text) && !BUILD.test(text)) return "fix";
  return "prompt";
}

const PROBLEM =
  /^(fix|reduce|cut|lower|help|improve|ease|stop|speed up|make it (easier|faster|cheaper)|get more|why)\b|\bhow (do|can|could|should|would) (we|i|the city|atlanta)\b|\b(too (long|slow|far|expensive)|problem|congest\w*|takes? \d+ ?min\w*|without raising)\b/i;

const BUILD =
  /\b(extend|build|add|run|close|open|connect|create|put|reroute|double|triple|electrify|widen|remove|ban|charge|toll|new (line|route|station|stop)|every \d+ ?min\w*)\b/i;

/** Short label for the passive tag that says how the box is reading the text. */
export const MODE_NOUN: Record<PlanMode, string> = { prompt: "Plan", article: "Article", fix: "Problem" };
/** Submit label for each reading. */
export const MODE_ACTION: Record<PlanMode, string> = { prompt: "Build it", article: "Check this", fix: "Find options" };
