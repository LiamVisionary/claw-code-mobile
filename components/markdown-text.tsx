"use client";

import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import Markdown from "react-native-markdown-display";

export default function MarkdownText(
  props: React.ComponentProps<typeof Markdown>
) {
  useEffect(() => {
    if (process.env.EXPO_OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);
  return (
    <Markdown
      debugPrintTree={false}
      style={{
        body: {
          color: "white",
          paddingHorizontal: 16,
        },
        paragraph: {
          fontSize: 16,
        },
        em: {
          fontStyle: "italic",
        },
        code_inline: {
          backgroundColor: "#353940",
          paddingHorizontal: 2,
          borderRadius: 2,
        },
        strong: {},
        blockquote: {
          backgroundColor: "#191A20",
        },
        fence: {
          borderWidth: 0,
          backgroundColor: "#191A20",
        },
      }}
      {...props}
    />
  );
}
