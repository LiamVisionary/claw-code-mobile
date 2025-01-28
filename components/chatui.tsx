"use client";

import { useActions, useAIState, useUIState } from "ai/rsc";
import React, { useEffect } from "react";
import { Image, Keyboard, useWindowDimensions, View } from "react-native";

import Animated from "react-native-reanimated";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Stack } from "expo-router";
import { AI } from "./ai-context";
import { ChatToolbarInner } from "./chat-toolbar";
import { KeyboardFriendlyScrollView } from "./keyboard-friendly-scrollview";
import { HeaderButton } from "./ui/Header";
import { IconSymbol } from "./ui/IconSymbol";

import * as AC from "@bacons/apple-colors";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ChatContainer } from "./chat-container";

const HEADER_HEIGHT = 0;
const nanoid = () => Math.random().toString(36).slice(2);

function useKeyboardOpen() {
  const [keyboardOpen, setKeyboardOpen] = React.useState(false);
  useEffect(() => {
    const off = Keyboard.addListener("keyboardWillShow", () => {
      setKeyboardOpen(true);
    });
    const off2 = Keyboard.addListener("keyboardWillHide", () => {
      setKeyboardOpen(false);
    });
    return () => {
      off.remove();
      off2.remove();
    };
  }, []);

  return keyboardOpen;
}

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
        keyboardShouldPersistTaps="handled"
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
      </KeyboardFriendlyScrollView>
      {messages.length === 0 && <Logo />}
    </>
  );
}

function Logo() {
  const isOpen = useKeyboardOpen();
  const translateY = useSharedValue(0);
  const { height } = useWindowDimensions();
  useEffect(() => {
    translateY.value = withTiming(isOpen ? height * -0.25 : 0, {
      duration: 200,
    });
  }, [isOpen, translateY, height]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          justifyContent: "center",
          alignItems: "center",
          flex: 1,
        },
        animatedStyle,
      ]}
    >
      <Image
        source={require("@/assets/images/logo.dark.png")}
        style={{ width: 128, height: 128, opacity: 0.3 }}
      />
    </Animated.View>
  );
}

export function ChatUI() {
  const { width } = useWindowDimensions();
  const [, setAIState] = useAIState<typeof AI>();
  const [, setMessages] = useUIState<typeof AI>();

  return (
    <ChatContainer>
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

      <MessagesScrollView />

      <ChatToolbar />
    </ChatContainer>
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
