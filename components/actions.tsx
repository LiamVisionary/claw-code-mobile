"use server";

import { createOpenAI } from "@ai-sdk/openai";
import { createStreamableValue, streamUI } from "ai/rsc";
import { BotMessage } from "./stream-text";
import { z } from "zod";
import { getWeatherAsync, WeatherCard } from "./weather";

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
    prompt: "What is the weather in Austin Texas?",
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
    tools: {
      get_weather: {
        description: "Get the current weather for a city",
        parameters: z
          .object({
            city: z.string().describe("the city to get the weather for"),
          })
          .required(),
        async *generate({ city }) {
          // const codeJsx = getColoredFunctionJsx("queryWeather", city);
          // // Show a spinner on the client while we wait for the response.
          // yield (
          //   <>
          //     {codeJsx}
          //     <WeatherSkeleton />
          //   </>
          // );

          // await sleep(1000);

          // Fetch the weather information from an external API.
          const weatherInfo = await getWeatherAsync(city);

          // Update the final AI state.
          // aiState.done([
          //   ...aiState.get(),
          //   {
          //     role: 'function',
          //     name: 'get_weather',
          //     // Content can be any string to provide context to the LLM in the rest of the conversation.
          //     // content: '',
          //     content: JSON.stringify(weatherInfo.current.feelslike_f),
          //   },
          // ]);

          // Return the weather card to the client.
          return (
            <>
              
              <WeatherCard city={city} data={weatherInfo} />
            </>
          );
        },
      },
    }
  });
  //   //   return result.toDataStreamResponse();
    return result.value;
  // return <div>hey</div>;
}
