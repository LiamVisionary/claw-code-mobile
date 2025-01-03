"use client";

import { useActions, useUIState } from "ai/rsc";
import React, { useCallback, useRef } from "react";
import { View, ScrollViewProps, useWindowDimensions } from "react-native";

import Animated, {
  KeyboardState,
  useAnimatedKeyboard,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  scrollTo,
} from "react-native-reanimated";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AI } from "./ai-context";
import { ChatToolbarInner } from "./chat-toolbar";

const HEADER_HEIGHT = 0;

function ScrollToBottomScrollView({ children, ...props }: ScrollViewProps) {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const keyboard = useAnimatedKeyboard();
  const { bottom } = useSafeAreaInsets();
  const scrollOffset = useSharedValue(0);
  const lastKeyboardState = useSharedValue(KeyboardState.UNKNOWN);
  const keyboardHeight = useSharedValue(0);
  const scrollOffsetAtStart = useSharedValue(0);
  const isTouching = useSharedValue(false);
  const lastKeyboardPosition = useSharedValue(0);
  const isScrollViewControlled = useSharedValue(false);

  // A self-contained check to lazily determine how large the keyboard is when it's open.
  useDerivedValue(() => {
    if (keyboard.state.value === KeyboardState.OPEN) {
      keyboardHeight.value = keyboard.height.value;
    }
  });

  const scrollToBottom = useCallback(() => {
    // console.log('scroll');

    timeout.current && clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      ref.current?.scrollToEnd({ animated: true });
    }, 15);
  }, [keyboard, ref.current]);

  const scrollToBottomIfNotPanning = useCallback(() => {
    if (
      keyboard.state.value === KeyboardState.OPENING ||
      keyboard.state.value === KeyboardState.CLOSING ||
      isScrollViewControlled.value
    ) {
      // console.log(
      //   'scrollToBottomIfNotPanning:bail',
      //   keyboard.state.value,
      //   isScrollViewControlled.value
      // );
      return;
    }
    scrollToBottom();
  }, [keyboard, scrollToBottom]);

  useDerivedValue(() => {
    if (
      !isScrollViewControlled.value &&
      keyboard.state.value === KeyboardState.CLOSING &&
      lastKeyboardState.value === KeyboardState.OPEN &&
      isTouching.value
    ) {
      isScrollViewControlled.value = true;
    }

    if (
      keyboard.state.value === KeyboardState.OPEN ||
      keyboard.state.value === KeyboardState.CLOSED
    ) {
      if (
        // Keyboard opened without user dragging.
        // This means we can move to a controlled position without it being unexpected behavior.
        !isScrollViewControlled.value &&
        lastKeyboardState.value !== keyboard.state.value &&
        keyboard.state.value === KeyboardState.OPEN
      ) {
        // console.log('open without input');
        scrollTo(
          ref,
          0,
          // Scroll to some maximum offset
          Number.MAX_SAFE_INTEGER,
          true
        );
      }

      // Track that the native framework is no longer controlling the scroll view scrolling with the keyboard.
      isScrollViewControlled.value = false;
    }

    // Track last keyboard state
    if (lastKeyboardState.value !== keyboard.state.value) {
      lastKeyboardState.value = keyboard.state.value;
      scrollOffsetAtStart.value = scrollOffset.value;
    }
  });

  useDerivedValue(() => {
    if (isScrollViewControlled.value) {
      // The native framework is controlling the scroll view scrolling with the keyboard, so we shouldn't animate it ourselves.
      return;
    }

    if (keyboard.state.value === KeyboardState.OPENING) {
      scrollTo(
        ref,
        0,
        scrollOffsetAtStart.value + Math.max(0, keyboard.height.value - bottom),
        false
      );
    } else if (keyboard.state.value === KeyboardState.CLOSING) {
      scrollTo(
        ref,
        0,
        scrollOffsetAtStart.value -
          Math.max(0, keyboardHeight.value - keyboard.height.value - bottom), // Math.max(0, keyboard.height.value - bottom),
        false
      );
    }

    lastKeyboardPosition.value = keyboard.height.value;
  });

  const translateStyle2 = useAnimatedStyle(() => {
    const h = Math.max(keyboard.height.value, bottom);
    return {
      minHeight: h,
      maxHeight: h,
    };
  }, [bottom]);

  return (
    <Animated.ScrollView
      {...props}
      onTouchStart={() => {
        isTouching.value = true;
      }}
      onTouchMove={() => {
        isTouching.value = true;
      }}
      onTouchEnd={() => {
        isTouching.value = false;
      }}
      onTouchCancel={() => {
        isTouching.value = false;
      }}
      onScroll={(e) => {
        scrollOffset.value = e.nativeEvent.contentOffset.y;
      }}
      onContentSizeChange={scrollToBottomIfNotPanning}
      onLayout={scrollToBottomIfNotPanning}
      scrollEventThrottle={16}
      ref={ref}
    >
      {children}
      <Animated.View style={translateStyle2} />
    </Animated.ScrollView>
  );
}

function MessagesScrollView() {
  const [messages] = useUIState<typeof AI>();

  const { top } = useSafeAreaInsets();

  const textInputHeight = 8 + 36;

  return (
    <>
      <ScrollToBottomScrollView
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
        {messages.length === 0 && (
          <View
            style={{
              justifyContent: "center",
              alignItems: "center",
              flex: 1,
            }}
          >
            {/* <Image
              source={require("../assets/expo.png")}
              style={{ width: 48, height: 48 }}
            /> */}
          </View>
        )}
      </ScrollToBottomScrollView>
    </>
  );
}

export function ChatUI() {
  const { width } = useWindowDimensions();

  return (
    <Animated.View
      style={[
        { backgroundColor: "#000", flex: 1, alignItems: "stretch" },
        // @ts-expect-error
        process.env.EXPO_OS === "web" && { maxHeight: "100vh" },
      ]}
    >
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
