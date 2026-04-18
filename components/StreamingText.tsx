import { Fragment, memo, useEffect, useMemo, useRef } from "react";
import { Text } from "react-native";
import Markdown from "react-native-markdown-display";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";

import { StreamingTable } from "@/components/StreamingTable";
import type { Palette } from "@/constants/palette";
import { parseTableBlocks } from "@/utils/parseTableBlocks";

type Props = {
  content: string;
  /** Markdown styles (same as you'd pass to <Markdown style={...}>) */
  mdStyles?: Record<string, any>;
  /** Whether the message is still streaming. */
  streaming?: boolean;
  /** Palette for theming the live table renderer. Required when the
   * content contains markdown tables; ignored otherwise. */
  palette?: Palette;
};

// ── Animated letter ─────────────────────────────────────────────────

const AnimatedLetter = memo(function AnimatedLetter({
  char,
  delay,
}: {
  char: string;
  delay: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      })
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.7, 1]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [8, 0]) },
    ],
  }));

  return <Animated.Text style={style}>{char}</Animated.Text>;
});

// ── Streaming markdown ──────────────────────────────────────────────

/**
 * Full markdown rendering with per-letter animation on new text.
 *
 * Overrides the markdown `text` render rule so leaf text nodes animate
 * their characters in with a staggered rise+fade. Already-seen characters
 * render instantly; only newly arrived ones animate.
 *
 * When the streamed content contains a markdown table we switch to a
 * segmented renderer: non-table runs go through the per-letter markdown
 * path, table runs go through `StreamingTable` which grows row-by-row
 * as cells arrive.
 */
function StreamingTextBase({ content, mdStyles, streaming, palette }: Props) {
  const prevLenRef = useRef(0);
  // Global character position tracker — shared across text rule calls
  // within a single render. Reset on each render via ref.
  const globalCharIdx = useRef(0);

  const prevLen = prevLenRef.current;

  useEffect(() => {
    prevLenRef.current = content.length;
  }, [content]);

  // Reset the global counter at the start of each render
  globalCharIdx.current = 0;

  const segments = useMemo(() => parseTableBlocks(content), [content]);
  const hasTables = segments.some((s) => s.type === "table");

  const rules = useMemo(() => {
    if (!streaming || hasTables) return undefined;

    return {
      text: (
        node: any,
        _children: any,
        _parent: any,
        styles: any,
        inheritedStyles: any = {}
      ) => {
        const text: string = node.content ?? "";
        const startIdx = globalCharIdx.current;
        globalCharIdx.current += text.length;

        // All characters in this node are old — render plain
        if (startIdx + text.length <= prevLen) {
          return (
            <Text key={node.key} style={[inheritedStyles, styles.text]}>
              {text}
            </Text>
          );
        }

        // Split into old prefix and new suffix
        const splitAt = Math.max(0, prevLen - startIdx);
        const oldPart = text.slice(0, splitAt);
        const newPart = text.slice(splitAt);

        // Compute delay offset: how many new chars came before this node
        const newCharsBeforeThisNode = Math.max(0, startIdx - prevLen);

        // Iterate by code points (not UTF-16 code units) so surrogate-pair
        // emojis like 🔒 / 💰 stay intact. `String.prototype.split("")`
        // splits into high/low surrogates which each render as "?".
        const newGlyphs = Array.from(newPart);
        return (
          <Text key={node.key} style={[inheritedStyles, styles.text]}>
            {oldPart}
            {newGlyphs.map((char, i) => {
              if (char === " " || char === "\n") {
                return <Text key={i}>{char}</Text>;
              }
              return (
                <AnimatedLetter
                  key={i}
                  char={char}
                  delay={(newCharsBeforeThisNode + i) * 20}
                />
              );
            })}
          </Text>
        );
      },
    };
  }, [streaming, prevLen, hasTables]);

  if (!hasTables) {
    return (
      <Markdown style={mdStyles} rules={rules}>
        {content}
      </Markdown>
    );
  }

  // Mixed text + table rendering. Per-letter animation is disabled in
  // this path; table rows carry their own fade-in via StreamingTable.
  return (
    <>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg.type === "table" ? (
            palette ? (
              <StreamingTable
                segment={seg}
                palette={palette}
                streaming={streaming}
              />
            ) : null
          ) : (
            <Markdown style={mdStyles}>{seg.content}</Markdown>
          )}
        </Fragment>
      ))}
    </>
  );
}

export const StreamingText = memo(StreamingTextBase);
