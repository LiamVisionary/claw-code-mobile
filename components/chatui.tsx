"use client";

import { useActions, useAIState, useUIState } from "ai/rsc";
import React from "react";
import { Image, Text, View, useWindowDimensions } from "react-native";

import Animated from "react-native-reanimated";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AI } from "./ai-context";
import { ChatToolbarInner } from "./chat-toolbar";
import { KeyboardFriendlyScrollView } from "./keyboard-friendly-scrollview";
import { MapCard } from "./map/map-card";
import { MoviesCard } from "./movies/movie-card";
import { MOCK_TRENDING_SHOWS_THIS_WEEK } from "./movies/mock-movie-data";
import { ToolCallsFyi } from "./tool-calls-fyi";
import { MOCK_LOCATION_DATA_VEGAS } from "./map/googleapis-maps";
import { Stack } from "expo-router";
import { HeaderButton } from "./ui/Header";
import { IconSymbol } from "./ui/IconSymbol";

const HEADER_HEIGHT = 0;

function MessagesScrollView() {
  const [messages] = useUIState<typeof AI>();

  const { top } = useSafeAreaInsets();

  const textInputHeight = 8 + 36;

  return (
    <>
      <KeyboardFriendlyScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: top + HEADER_HEIGHT + 24,
          paddingBottom: textInputHeight,
          gap: 16,
          flex: messages.length ? undefined : 1,
        }}
      >
        {
          // View messages in UI state
          messages.map((message) => (
            <View key={message.id}>{message.display}</View>
          ))
        }
        {messages.length === 0 && <ToolCallsFyi />}
        {/* {messages.length === 0 && (
          <View
            style={{
              justifyContent: "center",
              alignItems: "center",
              flex: 1,
            }}
          >
            <Image
              source={require("@/assets/images/logo.dark.png")}
              style={{ width: 128, height: 128 }}
            />
          </View>
        )} */}
      </KeyboardFriendlyScrollView>
    </>
  );
}

import * as AC from "@bacons/apple-colors";

const nanoid = () => Math.random().toString(36).slice(2);

export function ChatUI() {
  const { width } = useWindowDimensions();
  const [, setAIState] = useAIState<typeof AI>();
  const [, setMessages] = useUIState<typeof AI>();

  return (
    <Animated.View
      style={[
        { backgroundColor: "#000", flex: 1, alignItems: "stretch" },
        // @ts-expect-error
        process.env.EXPO_OS === "web" && { maxHeight: "100vh" },
      ]}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <HeaderButton
              pressOpacity={0.7}
              style={[
                process.env.EXPO_OS === "web"
                  ? {
                      paddingHorizontal: 16,
                      alignItems: "center",
                      display: "flex",
                    }
                  : {
                      // Offset on the side so the margins line up. Unclear how to handle when this is used in headerLeft.
                      // We should automatically detect it somehow.
                      marginRight: -8,
                    },
              ]}
              onPress={() => {
                setAIState({ chatId: nanoid(), messages: [] });
                setMessages([]);
              }}
            >
              <IconSymbol name="square.and.pencil" color={AC.label} />
            </HeaderButton>
          ),
        }}
      />
      <View
        style={[
          { flex: 1, maxWidth: 640, flexGrow: 1 },
          width > 640 && {
            width: 640,
            marginHorizontal: "auto",
          },
        ]}
      >
        <MessagesScrollView />

        <ChatToolbar />
      </View>
    </Animated.View>
  );
}

function ChatToolbar() {
  const [messages, setMessages] = useUIState<typeof AI>();
  const { onSubmit } = useActions<typeof AI>();

  return (
    <ChatToolbarInner
      messages={messages}
      setMessages={setMessages}
      onSubmit={onSubmit}
    />
  );
}
