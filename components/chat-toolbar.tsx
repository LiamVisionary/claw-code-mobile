"use client";

import { nanoid } from "@/util/nanoid";
import { tw } from "@/util/tw";
import * as AC from "@bacons/apple-colors";
import { useActions, useUIState } from "ai/rsc";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import React, { useCallback, useRef, useState } from "react";
import {
  NativeSyntheticEvent,
  TextInput,
  TextInputSubmitEditingEventData,
  useColorScheme,
  View,
} from "react-native";
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AI } from "./ai-context";
import { FirstSuggestions } from "./first-suggestions";
import { IconSymbol } from "./ui/IconSymbol";
import TouchableBounce from "./ui/TouchableBounce";
import { UserMessage } from "./user-message";
import { BORDER_RADIUS, SPACING, TYPOGRAPHY } from "@/theme";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

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

  const theme = useColorScheme();

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "transparent",
          gap: SPACING.sm,
          pointerEvents: "box-none",
        },
        translateStyle,
      ]}
    >
      <View style={tw`md:w-[768px] max-w-[768px] md:mx-auto`}>
        {!disabled && messages.length === 0 && <FirstSuggestions />}
      </View>

      <AnimatedBlurView
        tint={
          theme === "light"
            ? "systemChromeMaterial"
            : "systemChromeMaterialDark"
        }
        style={[
          {
            paddingTop: SPACING.sm,
            paddingBottom: SPACING.sm,
            paddingHorizontal: SPACING.lg,
            alignItems: "stretch",
          },
          blurStyle,
        ]}
      >
        <View
          style={[
            {
              flexDirection: "row",
              gap: SPACING.sm,
              alignItems: "flex-end",
            },
            tw`md:w-[768px] max-w-[768px] md:mx-auto`,
          ]}
        >
          <TextInput
            ref={textInput}
            onChangeText={setInputValue}
            keyboardAppearance={theme ?? "light"}
            cursorColor={AC.label}
            returnKeyType="send"
            blurOnSubmit={false}
            selectionHandleColor={AC.label}
            selectionColor={isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)"}
            style={{
              pointerEvents: disabled ? "none" : "auto",
              color: AC.label,
              paddingHorizontal: SPACING.lg,
              paddingVertical: SPACING.sm,
              backgroundColor: isDark ? "#1c1c1e" : "rgba(0,0,0,0.04)",
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              borderRadius: 22,
              fontSize: TYPOGRAPHY.fontSizes.md,
              outline: "none",
              flex: 1,
              minHeight: 44,
            }}
            placeholder="Message…"
            autoCapitalize="sentences"
            autoCorrect
            placeholderTextColor={AC.systemGray3}
            onSubmitEditing={onSubmitEditing}
          />

          <SendButton
            enabled={!!inputValue.length}
            onPress={() => onSubmitMessage(inputValue)}
            isDark={isDark}
          />
        </View>
      </AnimatedBlurView>
    </Animated.View>
  );
}

function SendButton({
  enabled,
  onPress,
  isDark,
}: {
  enabled?: boolean;
  onPress: () => void;
  isDark: boolean;
}) {
  return (
    <TouchableBounce
      disabled={!enabled}
      sensory
      style={[
        // @ts-expect-error web only
        process.env.EXPO_OS === "web"
          ? { display: "grid" }
          : {},
      ]}
      onPress={onPress}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: enabled ? AC.label : (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)"),
          justifyContent: "center",
          alignItems: "center",
          opacity: enabled ? 1 : 0.5,
          marginBottom: 4,
        }}
      >
        <IconSymbol
          name="arrow.up"
          size={16}
          color={enabled ? (isDark ? "#000" : "#fff") : AC.systemGray3}
        />
      </View>
    </TouchableBounce>
  );
}
