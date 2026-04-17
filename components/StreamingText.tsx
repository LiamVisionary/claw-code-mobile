import { memo, useEffect, useRef } from "react";
import { Text, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
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
 * Renders streaming text with a blur-in-up animation on newly arrived words.
 * New text starts slightly below its final position and semi-transparent,
 * then rises into place while fading to full opacity — similar to the
 * "blurInUp" animation from Magic UI.
 *
 * React Native doesn't support CSS blur on Text, so we approximate
 * the blur effect with a rapid opacity ramp + slight vertical slide.
 * The perceptual result is very close to a blur-in on mobile displays.
 */
function StreamingTextBase({ content, style, streaming }: Props) {
  const prevContentRef = useRef("");
  const progress = useSharedValue(1);

  const prevContent = prevContentRef.current;
  const isNew = content !== prevContent;

  useEffect(() => {
    if (isNew && streaming) {
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: 400,
        easing: Easing.out(Easing.cubic),
      });
    }
    prevContentRef.current = content;
  }, [content, streaming]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.7, 1]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [6, 0]) },
    ],
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
