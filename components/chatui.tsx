"use client";

import { useActions, useUIState } from "ai/rsc";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Text,
  TextInput,
  View,
  NativeSyntheticEvent,
  TextInputSubmitEditingEventData,
  ScrollViewProps,
  TouchableHighlight,
  useWindowDimensions,
  Easing,
  TouchableOpacityProps,
  TouchableOpacity,
} from "react-native";

import Animated, {
  KeyboardState,
  useAnimatedKeyboard,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  scrollTo,
  BounceIn,
  FadeInUp,
  FadeInDown,
} from "react-native-reanimated";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { onSubmit } from "./actions";

const HEADER_HEIGHT = 0;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

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

function MessagesScrollView({ messages }) {
  //   const [messages] = useUIState<typeof AI>();

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
  const [messages, setMessages] = useState([]);

  const { width } = useWindowDimensions();

  return (
    <Animated.View
      style={[
        { backgroundColor: "#000", flex: 1, alignItems: "stretch" },
        process.env.EXPO_OS === "web" && { maxHeight: "100vh" },
        // translateStyle,
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
        <MessagesScrollView messages={messages} setMessages={setMessages} />

        <ChatToolbar
          messages={messages}
          setMessages={setMessages}
          onSubmit={onSubmit}
        />
      </View>
    </Animated.View>
  );
}

export function PromptOnTap({
  prompt,
  onPress,
  ...props
}: { prompt: string | [string, string] } & TouchableOpacityProps) {
  return (
    <TouchableOpacity
      {...props}
      onPress={async (e) => {
        onPress?.(e);
        onSubmit(prompt);
      }}
    />
  );
}

function FirstSuggestions() {
  return (
    <Animated.View
      entering={FadeInDown}
      style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16 }}
    >
      {[
        // ['server rendering apps', 'for native platforms'],
        ["Get the weather", "for my area"],
        ["List new movies", "playing around me"],
      ].map(([title, subtitle], index) => (
        <PromptOnTap
          key={String(index)}
          style={{
            borderRadius: 12,
            padding: 24,
            flex: 1,
            // borderWidth: 1,
            // borderColor: 'white',
            backgroundColor: "rgba(255,255,255,0.1)",
          }}
          activeOpacity={0.7}
          prompt={title}
        >
          <Text
            style={{
              color: "white",
              fontSize: 16,
              fontWeight: "bold",
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: "white",
              fontSize: 14,
              opacity: 0.8,
            }}
          >
            {subtitle}
          </Text>
        </PromptOnTap>
      ))}
    </Animated.View>
  );
}

function ChatToolbar({ messages, setMessages }) {
  const [inputValue, setInputValue] = useState("");
  //   const [, setMessages] = useUIState<typeof AI>();
  //   const { submitUserMessage } = useActions<typeof AI>();
  const textInput = useRef<TextInput>(null);
  const { bottom } = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();

  // useEffect(() => {
  //   setMessages((currentMessages) => [
  //     ...currentMessages.filter((message) => message.id !== 'movies'),
  //     {
  //       id: 'movies',
  //       display: <TestMoviesCard />,
  //     },
  //   ]);
  // }, []);

  // useEffect(() => {
  //   setMessages((currentMessages) => [
  //     ...currentMessages,
  //     {
  //       id: Date.now(),
  //       display: (
  //         <>
  //           <UserMessage>
  //             {
  //               '1 wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip '
  //             }
  //           </UserMessage>
  //           <UserMessage>
  //             {
  //               '2 wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip '
  //             }
  //           </UserMessage>
  //           <UserMessage>
  //             {
  //               '3 wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip '
  //             }
  //           </UserMessage>
  //           <UserMessage>
  //             {
  //               '4 wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip '
  //             }
  //           </UserMessage>
  //           <UserMessage>
  //             {
  //               '5 wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip '
  //             }
  //           </UserMessage>
  //           <UserMessage>
  //             {
  //               '6 wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip wip '
  //             }
  //           </UserMessage>
  //         </>
  //       ),
  //     },
  //   ]);
  // }, []);

  const translateStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: -keyboard.height.value }],
    };
  }, [bottom]);

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
        return;
      }

      setTimeout(() => {
        textInput.current?.clear();
      });

      // Add user message to UI state
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: Date.now(),
          display: <UserMessage>{value}</UserMessage>,
        },
        // {
        //   id: Date.now() + 3,
        //   display: <MapCard city="Austin" data={require('../components/map/map-krakow-fixture.json')} />,
        // },
      ]);

      console.log('send', onSubmit);
      // Submit and get response message
      onSubmit(value).then((responseMessage) => {
        // console.log('responseMessage', responseMessage);
        setMessages((currentMessages) => [...currentMessages, responseMessage]);
      });

      setInputValue("");
    },
    [textInput, setMessages, onSubmit, setInputValue]
  );

  const onSubmitEditing = useCallback(
    (e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      onSubmitMessage(e.nativeEvent.text);
    },
    [onSubmitMessage]
  );
  //   const [messages] = useUIState<typeof AI>();

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
        },
        translateStyle,
      ]}
    >
      {messages.length === 0 && <FirstSuggestions />}

      <AnimatedBlurView
        tint="systemChromeMaterialDark"
        style={[
          {
            paddingTop: 8,
            paddingBottom: 8,
            paddingHorizontal: 16,
            flexDirection: "row",
            gap: 8,
          },
          blurStyle,
        ]}
      >
        <TextInput
          ref={textInput}
          onChangeText={setInputValue}
          keyboardAppearance="dark"
          cursorColor={"white"}
          returnKeyType="send"
          blurOnSubmit={false}
          selectionHandleColor={"white"}
          selectionColor={"white"}
          style={{
            color: "white",
            // #1E1E1E
            borderColor: "rgba(255, 255, 255, 0.3)",
            padding: 16,
            borderWidth: 0.5,
            borderRadius: 999,
            paddingVertical: 8,
            fontSize: 16,
            fontWeight: "bold",
            outline: "none",
            flex: 1,
          }}
          placeholder="Message"
          autoCapitalize="sentences"
          autoCorrect
          placeholderTextColor={"rgba(255, 255, 255, 0.3)"}
          onSubmitEditing={onSubmitEditing}
        />
        {/* <SubtleScaleAndFadeIn>
          <TouchableHighlight
            underlayColor={"rgba(255, 255, 255, 0.8)"}
            onPress={() => onSubmitMessage(inputValue)}
            style={{
              width: 36,
              alignItems: "center",
              justifyContent: "center",
              aspectRatio: 1,
              backgroundColor: "white",
              borderRadius: 666,
            }}
          >
            <AnimatedSwap
              on={!!inputValue}
              childA={<UpSvg />}
              childB={<SparkleSvg fill={"black"} />}
              style={{
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          </TouchableHighlight>
        </SubtleScaleAndFadeIn> */}
      </AnimatedBlurView>
    </Animated.View>
  );
}

export function UserMessage({ children }) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "flex-end",
        flexDirection: "row",
        maxWidth: "100%",
        paddingHorizontal: 16,
        gap: 8,
      }}
    >
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text
          numberOfLines={100}
          style={{
            borderCurve: "continuous",
            backgroundColor: "white",
            borderRadius: 20,
            flexWrap: "wrap",
            wordWrap: "break-word",
            textAlign: "right",
            color: "#102151",
            padding: 12,
            fontSize: 16,
          }}
          selectable
        >
          {children}
        </Text>
      </View>

      <View
        style={{
          overflow: "hidden",
          backgroundColor: "#83189F",
          borderRadius: 777,
          width: 48,
          height: 48,
        }}
      />
    </View>
  );
}
