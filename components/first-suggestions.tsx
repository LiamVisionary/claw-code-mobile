"use client";
import { Text, View, useColorScheme } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { tw } from "@/util/tw";
import * as AC from "@bacons/apple-colors";
import { PromptOnTap } from "./prompt-on-tap";

export function FirstSuggestions() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <View
      style={{
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        paddingHorizontal: 16,
      }}
    >
      {(
        [
          "What's the weather",
          process.env.EXPO_OS !== "web" && "Things to do around me",
          "Trending movies this week",
        ].filter(Boolean) as string[]
      ).map((title, index) => (
        <Animated.View
          entering={FadeInDown.delay((3 - index) * 80).springify()}
          key={String(index)}
        >
          <PromptOnTap
            key={String(index)}
            style={{}}
            activeOpacity={0.6}
            prompt={title}
          >
            <View
              style={[
                {
                  borderRadius: 20,
                  borderBottomLeftRadius: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)",
                  flexDirection: "row",
                  alignItems: "center",
                },
                tw`transition-colors hover:bg-systemGray4`,
              ]}
            >
              <Text
                style={{
                  color: AC.label,
                  fontSize: 14,
                  fontWeight: "400",
                }}
              >
                {title}
              </Text>
            </View>
          </PromptOnTap>
        </Animated.View>
      ))}
    </View>
  );
}
