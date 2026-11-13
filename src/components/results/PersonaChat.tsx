"use client";
import { useState } from "react";
import type { Persona } from "@/lib/contract";
import { usePersonaChat } from "@/hooks/usePersonaChat";
import { useStore } from "@/lib/store";

export function PersonaChat({ personas }: { personas: Persona[] }) {
  const chat = useStore((s) => s.chat);
  const close = useStore((s) => s.closeChat);
  const send = usePersonaChat();
  const [draft, setDraft] = useState("");
  const persona = personas.find((p) => p.id === chat?.personaId);
  if (!chat || !persona) return null;
  return (
    <div className="chat stack-sm">
      <div className="row">
        <strong className="grow">Ask {persona.name}</strong>
        <button className="btn" onClick={close}>
          Back to residents
        </button>
      </div>
      <ul className="list chat-log stack-sm" aria-live="polite">
        <li className="msg msg-persona">{persona.quote}</li>
        {chat.messages.map((m, i) => (
          <li key={i} className={`msg msg-${m.role}`}>
            {m.content}
          </li>
        ))}
        {chat.pending && <li className="msg msg-persona muted">{persona.name.split(" ")[0]} is typing</li>}
      </ul>
      <form
        className="row gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
          setDraft("");
        }}
      >
        <input className="input grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about the plan" aria-label={`Your question for ${persona.name}`} />
        <button className="btn btn-primary" type="submit" disabled={!draft.trim() || chat.pending}>
          Ask
        </button>
      </form>
    </div>
  );
}
