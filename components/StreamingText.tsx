import { memo, useEffect, useRef } from "react";
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
 * Animated letter component — each letter fades in and rises from below.
 */
function AnimatedLetter({ char, delay }: { char: string; delay: number }) {
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

  // Whitespace doesn't need animation
  if (char === " " || char === "\n") {
    return <Text>{char}</Text>;
  }

  return <Animated.Text style={style}>{char}</Animated.Text>;
}

/**
 * Streaming text with per-letter blur-in-up animation.
 *
 * Words that have already been rendered are plain text.
 * When a new word finishes streaming in, each of its letters
 * animates individually — starting slightly below and transparent,
 * rising to final position and full opacity with a stagger.
 */
function StreamingTextBase({ content, style, streaming }: Props) {
  const prevWordCountRef = useRef(0);
  const prevContentRef = useRef("");

  // Split into words (preserving whitespace as separate tokens)
  const tokens = content.split(/(\s+)/);

  const prevWordCount = prevWordCountRef.current;

  useEffect(() => {
    prevWordCountRef.current = tokens.length;
    prevContentRef.current = content;
  }, [content]);

  // Completed messages: plain text, no animation
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
        // Already rendered words — plain text
        if (wordIdx < prevWordCount) {
          return <Text key={wordIdx}>{token}</Text>;
        }

        // Whitespace token
        if (/^\s+$/.test(token)) {
          return <Text key={wordIdx}>{token}</Text>;
        }

        // New word — animate each letter
        return (
          <Text key={wordIdx}>
            {token.split("").map((char, charIdx) => (
              <AnimatedLetter
                key={`${wordIdx}-${charIdx}`}
                char={char}
                delay={charIdx * 25}
              />
            ))}
          </Text>
        );
      })}
    </Text>
  );
}

export const StreamingText = memo(StreamingTextBase);
