// "use client";
// import { createAI } from "ai/rsc/dist/rsc-server.mjs";

import type { CoreMessage } from "ai";

import { createAI } from "ai/rsc";
import { onSubmit } from "./actions";

const nanoid = () => Math.random().toString(36).slice(2);

export type Message = CoreMessage & {
  id: string;
};

export type AIState = {
  chatId: string;
  messages: Message[];
};

export type UIState = {
  id: string;
  display: React.ReactNode;
}[];

const actions = {
  onSubmit,
} as const;

// AI is a provider you wrap your application with so you can access AI and UI state in your components.
export const AI = createAI<AIState, UIState, typeof actions>({
  actions,
  // Each state can be any shape of object, but for chat applications
  // it makes sense to have an array of messages. Or you may prefer something like { id: number, messages: Message[] }
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
});
