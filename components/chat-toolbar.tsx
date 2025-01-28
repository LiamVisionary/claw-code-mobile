"use client";

import * as AC from "@bacons/apple-colors";
import { useActions, useUIState } from "ai/rsc";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import React, { useCallback, useRef, useState } from "react";
import {
  NativeSyntheticEvent,
  TextInput,
  TextInputSubmitEditingEventData,
  View,
} from "react-native";
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AI } from "./ai-context";
import { FirstSuggestions } from "./first-suggestions";
import { IconSymbol } from "./ui/IconSymbol";
import TouchableBounce from "./ui/TouchableBounce";
import { UserMessage } from "./user-message";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const nanoid = () => String(Math.random().toString(36).slice(2));

interface ChatToolbarInnerProps {
  messages: ReturnType<typeof useUIState<typeof AI>>[0];
  setMessages: ReturnType<typeof useUIState<typeof AI>>[1];
  onSubmit: ReturnType<typeof useActions<typeof AI>>["onSubmit"];
  disabled?: boolean;
}

export function ChatToolbarInner({
  messages,
  setMessages,
  onSubmit,
  disabled = false,
}: ChatToolbarInnerProps) {
  const [inputValue, setInputValue] = useState("");
  const textInput = useRef<TextInput>(null);
  const { bottom } = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();

  const translateStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateY: -keyboard.height.value }],
    }),
    [bottom]
  );

  const blurStyle = useAnimatedStyle(() => {
    const assumedKeyboardHeight = 100;
    const inverse = Math.max(
      0,
      Math.min(
        1,
        (assumedKeyboardHeight - keyboard.height.value) / assumedKeyboardHeight
      )
    );

    return {
      paddingBottom: 8 + bottom * inverse,
    };
  }, [bottom]);

  const onSubmitMessage = useCallback(
    (value: string) => {
      if (value.trim() === "") {
        textInput.current?.blur();
        return;
      }

      if (process.env.EXPO_OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      setTimeout(() => {
        textInput.current?.clear();
      });

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: nanoid(),
          display: <UserMessage>{value}</UserMessage>,
        },
      ]);

      onSubmit(value).then((responseMessage) => {
        setMessages((currentMessages) => [...currentMessages, responseMessage]);
      });

      setInputValue("");
    },
    [textInput, setMessages, onSubmit]
  );

  const onSubmitEditing = useCallback(
    (e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      onSubmitMessage(e.nativeEvent.text);
    },
    [onSubmitMessage]
  );

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "transparent",
          gap: 8,
          pointerEvents: "box-none",
        },
        translateStyle,
      ]}
    >
      {!disabled && messages.length === 0 && <FirstSuggestions />}

      <AnimatedBlurView
        tint="systemChromeMaterialDark"
        style={[
          {
            paddingTop: 8,
            paddingBottom: 8,
            paddingHorizontal: 16,
            flexDirection: "row",
            gap: 8,
            alignItems: "stretch",
          },
          blurStyle,
        ]}
      >
        <TextInput
          ref={textInput}
          onChangeText={setInputValue}
          keyboardAppearance="dark"
          cursorColor="white"
          returnKeyType="send"
          blurOnSubmit={false}
          selectionHandleColor="white"
          selectionColor="white"
          style={{
            pointerEvents: disabled ? "none" : "auto",
            color: "white",
            padding: 16,
            borderColor: "rgba(44, 44, 46, 1)",
            backgroundColor: AC.secondarySystemGroupedBackground,
            borderWidth: 1,
            borderRadius: 999,
            paddingVertical: 8,
            fontSize: 16,
            outline: "none",
            flex: 1,
          }}
          placeholder="Ask anything"
          autoCapitalize="sentences"
          autoCorrect
          placeholderTextColor={AC.systemGray2}
          onSubmitEditing={onSubmitEditing}
        />
        <SendButton onPress={() => onSubmitMessage(inputValue)} />
      </AnimatedBlurView>
    </Animated.View>
  );
}

function SendButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableBounce
      sensory
      // @ts-expect-error
      style={{
        display: process.env.EXPO_OS === "web" ? "grid" : "flex",
      }}
      onPress={onPress}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          borderColor: "rgba(44, 44, 46, 1)",
          borderWidth: 1,
          aspectRatio: 1,
          backgroundColor: AC.label,
          borderRadius: 999,
        }}
      >
        <IconSymbol name="arrow.up" size={20} color={AC.systemBackground} />
      </View>
    </TouchableBounce>
  );
}
