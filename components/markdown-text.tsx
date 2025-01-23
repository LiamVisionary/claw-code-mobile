"use client";

import Markdown from "react-native-markdown-display";

export default function MarkdownText(props) {
  return (
    <Markdown
      debugPrintTree={false}
      style={{
        body: {
          color: "white",
          paddingHorizontal: 16,
        },
        paragraph: {
          // fontFamily: "AnonymousPro-Regular",
          fontSize: 16,
        },
        em: {
          // fontFamily: "AnonymousPro-Italic",
          fontStyle: "italic",
        },
        code_inline: {
          backgroundColor: "#353940",
          paddingHorizontal: 2,
          borderRadius: 2,
        },
        strong: {
          // fontFamily: "AnonymousPro-Bold",
        },
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
