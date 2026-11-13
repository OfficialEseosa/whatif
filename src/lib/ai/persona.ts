/**
 * Town-hall persona chat. Claude answers as the resident, from the plan's simulated results.
 * Falls back to the resident's scripted lines when there is no key, no results, or the call fails.
 */
import type { ChatMessage, Persona, PersonaRequest } from "@/lib/contract";
import { CLAUDE_MODEL, claudeClient } from "./client";

const TIMEOUT_MS = 12_000;

function scripted(persona: Persona, messages: ChatMessage[]): string {
  const replies = persona.cannedReplies?.length ? persona.cannedReplies : [persona.quote];
  const asked = messages.filter((m) => m.role === "user").length;
  return replies[Math.max(0, asked - 1) % replies.length];
}

export async function personaReply(persona: Persona, messages: ChatMessage[], context?: PersonaRequest["context"]): Promise<{ reply: string; isMock: boolean }> {
  const client = context ? claudeClient(TIMEOUT_MS) : null;
  if (!client || !context || !messages.length) return { reply: scripted(persona, messages), isMock: true };
  const system = `You are ${persona.name}, ${persona.age}, an Atlanta resident: ${persona.descriptor}. You are speaking at a town hall about a transit plan.

Answer the question in the first person, in 2 or 3 short plain sentences, the way a neighbor would talk.
- Use only the numbers in RESULTS. Never invent a number, a place or a piece of history, and do not quote a personal commute time.
- Speak from your own situation (where you live and work, whether you rent). Say honestly whether this plan helps or hurts someone like you.
- Say numbers the way people do: round them ("about 380 hours", "about $15 a trip"), no decimals, and skip a change too small to notice.
- Few or no renter households facing rising rent is good news for renters.
- If RESULTS cannot answer the question, say you do not know.
- No ethnicity or national origin. No jargon.

PLAN: ${context.plan}
VERDICT: ${context.verdict}
RESULTS: ${context.results}`;
  try {
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
    });
    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return reply ? { reply, isMock: false } : { reply: scripted(persona, messages), isMock: true };
  } catch (e) {
    console.warn("persona: Claude call failed:", e instanceof Error ? e.message : e);
    return { reply: scripted(persona, messages), isMock: true };
  }
}
