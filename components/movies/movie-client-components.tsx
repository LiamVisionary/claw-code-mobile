"use client";

import React from "react";
import { TouchableOpacity, View, ViewStyle } from "react-native";

import type { AI } from "@/components/ai-context";
import { useAIState, useUIState } from "ai/rsc";

import { useId } from "react";
import { Suggestions } from "@/components/suggestions";
import { AssistantMessage } from "../assistant-message";
import { router } from "expo-router";
import type { MovieEntry } from "./movie-card";
import TouchableBounce from "../ui/TouchableBounce";
import * as Haptics from "expo-haptics";

export function MovieTouchable({
  movie,
  children,
  style,
}: {
  movie: Pick<
    MovieEntry,
    "poster_path" | "title" | "name" | "media_type" | "id"
  >;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const [aiState, setAIState] = useAIState<typeof AI>();
  const [, setMessages] = useUIState<typeof AI>();

  const id = useId();
  const name = movie.title ?? movie.name;

  return (
    <TouchableOpacity
      delayLongPress={1000}
      style={style}
      activeOpacity={0.8}
      onPress={() => {
        if (process.env.EXPO_OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }

        console.log("Push:", movie.id, movie.media_type);
        router.push({
          pathname: "/movie/[id]",
          params: { id: movie.id, media_type: movie.media_type },
        });
      }}
      onLongPress={() => {
        // console.log('>>>', aiState);
        // Insert a new message into the AI state.
        const info = {
          role: "assistant" as const,
          content: `[User has selected ${movie.media_type} "${name}" with attachment image "${movie.poster_path}"]`,

          // Identifier of this UI component, so we don't insert it many times.
          // id,
        };

        // If the last message is already inserted by us, update it. This is to avoid
        // adding every slider change to the AI state.
        // if (aiState[aiState.length - 1]?.id === id) {
        //   setAIState([...aiState.slice(0, -1), info]);
        // } else {
        // If it doesn't exist, append it to the AI state.
        setAIState({
          ...aiState,
          messages: [...aiState.messages, info],
        });

        setMessages((messages) => [
          ...messages,
          {
            display: (
              <View key={String(id)} style={{ gap: 8 }}>
                <AssistantMessage>{`[Selected ${movie.media_type} "${name}"]`}</AssistantMessage>
                <View style={{ paddingHorizontal: 16 }}>
                  <Suggestions
                    suggestions={[
                      [
                        `Create an event`,
                        `Remind me to watch the ${movie.media_type} ${name} this weekend`,
                      ],
                      `See showtimes`,
                    ]}
                  />
                </View>
              </View>
            ),
            // display: <AssistantMessage key={String(id)}>{info.content}</AssistantMessage>,
            id,
          },
        ]);

        // }
      }}
    >
      {children}
    </TouchableOpacity>
  );
}
