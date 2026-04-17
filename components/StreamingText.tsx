import { memo, useCallback, useEffect, useRef } from "react";
import { Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";

type Props = {
  content: string;
  style?: any;
  streaming?: boolean;
};

/**
 * Animated letter — starts below and transparent, rises into place.
 */
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

  if (char === " " || char === "\n") {
    return <Text>{char}</Text>;
  }

  return <Animated.Text style={style}>{char}</Animated.Text>;
});

/**
 * Streaming markdown text with per-letter animation on new content.
 *
 * Renders the full content as a Text tree. Already-streamed words are
 * plain text; newly arrived words animate letter-by-letter with a
 * staggered rise+fade effect.
 *
 * NOTE: This renders as plain styled Text (not Markdown) during streaming.
 * The parent component should switch to a full Markdown renderer once
 * streaming completes to get rich formatting (bold, code blocks, etc.).
 * During streaming, basic readability is fine — users are watching text
 * arrive, not reading formatted documentation.
 */
function StreamingTextBase({ content, style, streaming }: Props) {
  const prevWordCountRef = useRef(0);

  const tokens = content.split(/(\s+)/);
  const prevWordCount = prevWordCountRef.current;

  useEffect(() => {
    prevWordCountRef.current = tokens.length;
  }, [content]);

  if (!streaming) {
    return (
      <Text style={style} selectable>
        {content}
      </Text>
    );
  }

  return (
    <Text style={style} selectable>
      {tokens.map((token, wordIdx) => {
        if (wordIdx < prevWordCount) {
          return <Text key={wordIdx}>{token}</Text>;
        }

        if (/^\s+$/.test(token)) {
          return <Text key={wordIdx}>{token}</Text>;
        }

        const charsInPriorNewWords = tokens
          .slice(prevWordCount, wordIdx)
          .join("")
          .replace(/\s/g, "").length;

        return (
          <Text key={wordIdx}>
            {token.split("").map((char, charIdx) => (
              <AnimatedLetter
                key={`${wordIdx}-${charIdx}`}
                char={char}
                delay={(charsInPriorNewWords + charIdx) * 20}
              />
            ))}
          </Text>
        );
      })}
    </Text>
  );
}

export const StreamingText = memo(StreamingTextBase);
