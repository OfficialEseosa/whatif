/**
 * Town-hall persona chat. Owner: Samuel.
 */
import type { ChatMessage, Persona, ScenarioResult } from "@/lib/contract";

export async function personaReply(scenario: ScenarioResult, persona: Persona, messages: ChatMessage[]): Promise<string> {
  // TODO(Samuel): call Claude when process.env.ANTHROPIC_API_KEY is set.
  //  System prompt = this persona's own numbers only (stakeChips, their agent's stake,
  //  their tract from scenario.tracts) + cited history for their tract. No ethnicity or
  //  national origin. Never invent numbers or history.
  void scenario;
  const replies = persona.cannedReplies?.length ? persona.cannedReplies : [persona.quote];
  const asked = messages.filter((m) => m.role === "user").length;
  return replies[Math.max(0, asked - 1) % replies.length];
}
