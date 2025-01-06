if (!process.env.XAI_API_KEY) {
  throw new Error("XAI_API_KEY is required");
}
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

// const xai = createOpenAI({
//   name: "xai",
//   baseURL: "https://api.x.ai/v1",
//   apiKey: process.env.XAI_API_KEY ?? "",
// });

// import { unstable_headers } from "expo-router/rsc/headers";

import type { CoreMessage } from "ai";
import { createAI } from "ai/rsc";
import "server-only";
import { createStreamableValue, getMutableAIState, streamUI } from "ai/rsc";
import { BotMessage } from "./stream-text";
import { z } from "zod";

import { getWeatherAsync, WeatherCard } from "./weather";
import { openai } from "@ai-sdk/openai";

// -- MOVIES UTILS ----------------------------------------------------------

// Skeleton and display components
import { MoviesCard, MoviesSkeleton } from "./movies/movie-card";

// --------------------------------------------------------------------------

if (!process.env.XAI_API_KEY) {
  throw new Error("XAI_API_KEY is required");
}
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

export async function onSubmit(message: string) {
  "use server";

  const aiState = getMutableAIState();

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

  let textStream: undefined | ReturnType<typeof createStreamableValue<string>>;
  let textNode: undefined | React.ReactNode;

  // Chat streaming with GPT-3.5-turbo
  const result = await streamUI({
    model: openai("gpt-3.5-turbo"),
    messages: [
      {
        role: "system",
        content: `\
You are a helpful chatbot assistant. You can provide weather info and movie recommendations. 
You have the following tools available:
- get_trending_movies: Lists trending movies from TMDB.
- search_movies: Search for any movie by a query string on TMDB.
- get_weather: Gets the weather for a city.
`,
      },
      ...aiState.get().messages.map((message: any) => ({
        role: message.role,
        content: message.content,
        name: message.name,
      })),
    ],
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
    // Define the tools here:
    tools: {
      get_trending_movies: {
        description:
          "List trending movies or TV shows today or this week from TMDB",
        parameters: z
          .object({
            time_window: z
              .enum(["day", "week"])
              .describe("time window to search for")
              .default("day"),
            media_type: z
              .enum(["tv", "movie"])
              .describe("type of media to search for")
              .default("movie"),
            generated_description: z
              .string()
              .describe("AI-generated description of the tool call"),
          })
          .required(),
        async *generate({ generated_description, time_window, media_type }) {
          console.log("get_trending_movies:", {
            time_window,
            media_type,
            generated_description,
          });
          yield <MoviesSkeleton />;

          const url = `https://api.themoviedb.org/3/trending/${media_type}/${time_window}?api_key=${process.env.TMDB_API_KEY}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error("Failed to fetch trending movies");
          }
          const data = await response.json();
          const movies = data.results;

          console.log("results:", movies);
          return <MoviesCard data={movies} title={generated_description} />;
        },
      },
      search_movies: {
        description: "Search for movies by a query string",
        parameters: z
          .object({
            query: z.string().describe("The query to use for searching movies"),
            media_type: z
              .enum(["tv", "movie"])
              .describe("type of media to search for")
              .default("movie"),
            generated_description: z
              .string()
              .describe("AI-generated description of the tool call"),
          })
          .required(),
        async *generate({ query, media_type, generated_description }) {
          console.log("search_movies:", {
            query,
            media_type,
            generated_description,
          });
          yield <MoviesSkeleton />;

          const url = `https://api.themoviedb.org/3/search/${media_type}?api_key=${
            process.env.TMDB_API_KEY
          }&query=${encodeURIComponent(query)}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error("Failed to fetch searched movies");
          }
          const data = await response.json();
          const movies = data.results;

          return <MoviesCard data={movies} title={generated_description} />;
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
          const weatherInfo = await getWeatherAsync(city);
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

export const AI = createAI<AIState, UIState, typeof actions>({
  actions,
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
});
