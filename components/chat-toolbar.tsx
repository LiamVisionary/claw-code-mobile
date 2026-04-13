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
import { SIZES, SPACING, TYPOGRAPHY } from "@/theme";

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
              alignItems: "stretch",
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
            selectionColor={AC.label}
            style={{
              pointerEvents: disabled ? "none" : "auto",
              color: AC.label,
              paddingHorizontal: SPACING.lg,
              paddingVertical: SPACING.sm,
              borderColor: AC.separator,
              backgroundColor: "#1a1a1a",
              borderWidth: 1,
              borderRadius: BORDER_RADIUS.full,
              fontSize: TYPOGRAPHY.fontSizes.md,
              outline: "none",
              flex: 1,
            }}
            placeholder="Ask anything…"
            autoCapitalize="sentences"
            autoCorrect
            placeholderTextColor={AC.systemGray2}
            onSubmitEditing={onSubmitEditing}
          />

          <SendButton
            enabled={!!inputValue.length}
            onPress={() => onSubmitMessage(inputValue)}
          />
        </View>
      </AnimatedBlurView>
    </Animated.View>
  );
}

function SendButton({
  enabled,
  onPress,
}: {
  enabled?: boolean;
  onPress: () => void;
}) {
  const backgroundColor = enabled ? AC.label : "#333333";
  
  return (
    <TouchableBounce
      disabled={!enabled}
      sensory
      style={[
        process.env.EXPO_OS === "web"
          ? {
              display: "grid",
              marginRight: SPACING.sm,
            }
          : {},
      ]}
      onPress={onPress}
    >
      <View
        style={[
          {
            justifyContent: "center",
            alignItems: "center",
            borderColor: AC.separator,
            borderWidth: 1,
            backgroundColor: backgroundColor,
            borderRadius: BORDER_RADIUS.full,
          },
          !enabled && { opacity: 0.5 },
          tw`transition-transform hover:scale-95`,
          {
            width: SIZES.touchable,
            height: SIZES.touchable,
          },
        ]}
      >
        <IconSymbol
          name="arrow.up"
          size={SIZES.icon.sm}
          color={enabled ? AC.systemBackground : AC.systemGray}
        />
      </View>
    </TouchableBounce>
  );
}