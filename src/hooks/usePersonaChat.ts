"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

/** Sends a message to the open persona and appends the reply. */
export function usePersonaChat() {
  return useCallback(async (content: string) => {
    const { chat, scenario, set } = useStore.getState();
    if (!chat || !scenario || !content.trim() || chat.pending) return;
    const messages = [...chat.messages, { role: "user" as const, content: content.trim() }];
    set({ chat: { ...chat, messages, pending: true } });
    try {
      const res = await api.persona({ scenarioId: scenario.id, personaId: chat.personaId, messages });
      const cur = useStore.getState().chat;
      if (cur?.personaId === chat.personaId)
        set({ chat: { ...cur, messages: [...messages, { role: "persona", content: res.reply }], pending: false } });
    } catch (e) {
      const cur = useStore.getState().chat;
      if (cur) set({ chat: { ...cur, pending: false }, error: String(e) });
    }
  }, []);
}
