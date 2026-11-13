/** One place that builds the Claude client. Returns null when no key is set, so callers fall back. */
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

export function claudeClient(timeoutMs: number): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 }) : null;
}
