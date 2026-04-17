import { memo, useEffect, useRef } from "react";
import { Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

type Props = {
  /** The full text content so far (grows as tokens stream in). */
  content: string;
  /** Text style to apply. */
  style?: any;
  /** Whether the message is still streaming. When false, renders plain text. */
  streaming?: boolean;
};

/**
 * Renders streaming text with a smooth fade-in on newly arrived words.
 * Already-rendered text stays solid; only the new suffix animates in.
 *
 * Uses a split-render approach: the "old" prefix renders at full opacity,
 * the "new" suffix renders in an Animated.Text that fades from 0→1.
 * On the next update, the suffix becomes part of the old prefix.
 */
function StreamingTextBase({ content, style, streaming }: Props) {
  const prevContentRef = useRef("");
  const opacity = useSharedValue(1);

  const prevContent = prevContentRef.current;
  const isNew = content !== prevContent;

  // When new content arrives, reset opacity and animate in
  useEffect(() => {
    if (isNew && streaming) {
      opacity.value = 0.0;
      opacity.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.ease),
      });
    }
    prevContentRef.current = content;
  }, [content, streaming]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  // Completed messages: plain text, no animation overhead
  if (!streaming) {
    return (
      <Text style={style} selectable>
        {content}
      </Text>
    );
  }

  // Split into old (solid) and new (animating) parts
  const oldPart = prevContent;
  const newPart = content.slice(oldPart.length);

  if (!newPart) {
    return (
      <Text style={style} selectable>
        {content}
      </Text>
    );
  }

  return (
    <Text style={style} selectable>
      {oldPart}
      <Animated.Text style={animatedStyle}>{newPart}</Animated.Text>
    </Text>
  );
}

export const StreamingText = memo(StreamingTextBase);
