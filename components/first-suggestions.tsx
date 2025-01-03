"use client";
import { Text } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { PromptOnTap } from "./prompt-on-tap";

export function FirstSuggestions() {
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
