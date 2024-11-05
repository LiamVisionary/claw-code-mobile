"use server";

import { createOpenAI } from "@ai-sdk/openai";
import { createStreamableValue, streamUI } from "ai/rsc";
import { BotMessage } from "./stream-text";

const xai = createOpenAI({
  name: "xai",
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY ?? "",
});

export async function callServer() {
  let textStream: undefined | ReturnType<typeof createStreamableValue<string>>;
  let textNode: undefined | React.ReactNode;

  const result = await streamUI({
    model: xai("grok-beta"),
    prompt: "Invent a new holiday and describe its traditions.",
    text: ({ content, done, delta }) => {
      if (!textStream) {
        textStream = createStreamableValue("");
        textNode = <BotMessage content={textStream.value} />;
      }

      if (done) {
        textStream.done();
        // aiState.done({
        //   ...aiState.get(),
        //   messages: [
        //     ...aiState.get().messages,
        //     {
        //       id: nanoid(),
        //       role: "assistant",
        //       content,
        //     },
        //   ],
        // });
      } else {
        textStream.update(delta);
      }

      return textNode;
    },
  });
  //   //   return result.toDataStreamResponse();
    return result.value;
  // return <div>hey</div>;
}
