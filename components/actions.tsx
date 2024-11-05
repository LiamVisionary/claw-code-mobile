"use server";

import { createOpenAI } from "@ai-sdk/openai";
import { streamUI } from "ai/rsc";

const xai = createOpenAI({
  name: "xai",
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY ?? "",
});

export async function callServer() {
  const result = await streamUI({
    model: xai("grok-beta"),
    prompt: "Invent a new holiday and describe its traditions.",
  });
  //   //   return result.toDataStreamResponse();
    return result.value;
  // return <div>hey</div>;
}
