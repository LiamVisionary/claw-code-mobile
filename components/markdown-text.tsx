"use client";

import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import Markdown from "react-native-markdown-display";

export default function MarkdownText({
  done,
  ...props
}: React.ComponentProps<typeof Markdown> & { done?: boolean }) {
  useEffect(() => {
    if (process.env.EXPO_OS === "ios") {
      if (done) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.selectionAsync();
      }
    }
  }, [done]);
  return (
    <>
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
      {/* TODO: Add a toolbar to the end of the text message when it's complete. */}
    </>
  );
}
