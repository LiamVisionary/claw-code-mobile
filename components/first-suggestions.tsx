"use client";
import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import * as AC from "@bacons/apple-colors";
import { PromptOnTap } from "./prompt-on-tap";

export function FirstSuggestions() {
  return (
    <View
      style={{
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        paddingHorizontal: 16,
      }}
    >
      {[
        // ['server rendering apps', 'for native platforms'],
        ["What's the weather"],
        ["Things to do around me"],
        ["Trending movies this week"],
      ].map(([title], index) => (
        <Animated.View
          entering={FadeInDown.delay((3 - index) * 100)}
          key={String(index)}
        >
          <PromptOnTap
            key={String(index)}
            style={{}}
            activeOpacity={0.7}
            prompt={title}
          >
            <View
              style={{
                borderRadius: 16,
                borderBottomLeftRadius: 4,
                borderCurve: "continuous",
                padding: 8,
                borderColor: AC.systemGray5,
                backgroundColor: AC.secondarySystemGroupedBackground,
                borderWidth: 1,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: AC.secondaryLabel,
                  fontSize: 16,
                  // fontWeight: "bold",
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
