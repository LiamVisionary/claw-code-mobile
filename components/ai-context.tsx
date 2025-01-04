// "use client";
// import { createAI } from "ai/rsc/dist/rsc-server.mjs";

import type { CoreMessage } from "ai";

import { createAI } from "ai/rsc";

import "server-only";
import { createStreamableValue, getMutableAIState, streamUI } from "ai/rsc";
import { BotMessage } from "./stream-text";
import { z } from "zod";
import { getWeatherAsync, WeatherCard } from "./weather";

if (!process.env.XAI_API_KEY) {
  throw new Error("XAI_API_KEY is required");
}
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}
import { openai } from "@ai-sdk/openai";
import { getMoviesData, MoviesCard, MoviesSkeleton } from "./movies/movie-card";

// const xai = createOpenAI({
//   name: "xai",
//   baseURL: "https://api.x.ai/v1",
//   apiKey: process.env.XAI_API_KEY ?? "",
// });

// import { unstable_headers } from "expo-router/rsc/headers";

export async function onSubmit(message: string) {
  "use server";

  const aiState = getMutableAIState();
  // const aiState = getMutableAIState<typeof AI>();

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: "user",
        content: message,
      },
    ],
  });

  // console.log("onSubmit", message);
  // return {
  //   id: Date.now(),
  //   display: <></>,
  // };

  let textStream: undefined | ReturnType<typeof createStreamableValue<string>>;
  let textNode: undefined | React.ReactNode;
  // const headers = await unstable_headers();
  // https://sdk.vercel.ai/docs/reference/ai-sdk-rsc/stream-ui
  const result = await streamUI({
    model: openai("gpt-3.5-turbo"),
    messages: [
      {
        role: "system",
        content: `\
You are a chatbot assistant that can help with a variety of tasks.`,
      },
      ...aiState.get().messages.map((message: any) => ({
        role: message.role,
        content: message.content,
        name: message.name,
      })),
    ],
    // model: xai("grok-beta"),
    // system: `
    // You are a chatbot assistant that can help with a variety of tasks.

    // User info:
    // - city: ${headers.get("eas-ip-city") ?? (__DEV__ ? "Austin" : "unknown")}
    // - country: ${headers.get("eas-ip-country") ?? (__DEV__ ? "US" : "unknown")}
    // - region: ${headers.get("eas-ip-region") ?? (__DEV__ ? "TX" : "unknown")}
    // - device platform: ${headers.get("expo-platform") ?? "unknown"}
    // `,
    // prompt: message, //"What is the weather in Austin Texas?",
    text: ({ content, done, delta }) => {
      if (!textStream) {
        textStream = createStreamableValue("");
        textNode = <BotMessage content={textStream.value} />;
      }

      if (done) {
        textStream.done();
        aiState.done({
          ...aiState.get(),
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: "assistant",
              content,
            },
          ],
        });
      } else {
        textStream.update(delta);
      }

      return textNode;
    },
    tools: {
      get_movies: {
        description: "List trending movies",
        parameters: z.object({}).required(),
        async *generate() {
          // Show a spinner on the client while we wait for the response.
          yield (
            <>
              <MoviesSkeleton />
            </>
          );

          const movies = await getMoviesData();

          // Update the final AI state.
          // aiState.done([
          //   ...aiState.get(),
          //   {
          //     role: 'function',
          //     name: 'get_movies',
          //     content: JSON.stringify(movies.map((movie) => movie.title)),
          //   },
          // ]);

          // Return the movies card to the client.
          return (
            <>
              <MoviesCard data={movies} />
            </>
          );
        },
      },

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
          //     role: "function",
          //     name: "get_weather",
          //     // Content can be any string to provide context to the LLM in the rest of the conversation.
          //     // content: '',
          //     content: JSON.stringify(weatherInfo.current.feelslike_f),
          //   },
          // ]);

          // Return the weather card to the client.
          return <WeatherCard city={city} data={weatherInfo} />;
        },
      },
    },
  });
  return {
    id: nanoid(),
    display: result.value,
  };
}

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
