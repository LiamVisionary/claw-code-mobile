import { memo, useEffect, useRef } from "react";
import { Text, View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

type Props = {
  /** The full text content so far (grows as tokens stream in). */
  content: string;
  /** Text style to apply. */
  style?: any;
  /** Whether the message is still streaming. When false, renders plain text. */
  streaming?: boolean;
};

/**
 * Renders streaming text with a blur-in-up animation.
 *
 * Architecture: the full text renders normally, with a BlurView overlay
 * covering only the bottom portion (where new text appears). On each
 * new chunk, the blur overlay resets to high intensity and dissolves
 * to 0, creating a smooth blur-to-sharp reveal on the latest line(s).
 * The text also slides up slightly for the "rise into place" feel.
 */
function StreamingTextBase({ content, style, streaming }: Props) {
  const prevContentRef = useRef("");
  const prevLenRef = useRef(0);
  const progress = useSharedValue(1);

  const isNew = content !== prevContentRef.current;

  useEffect(() => {
    if (isNew && streaming) {
      prevLenRef.current = prevContentRef.current.length;
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: 450,
        easing: Easing.out(Easing.cubic),
      });
    }
    prevContentRef.current = content;
  }, [content, streaming]);

  // Completed messages: plain text, no animation overhead
  if (!streaming) {
    return (
      <Text style={style} selectable>
        {content}
      </Text>
    );
  }

  const oldPart = content.slice(0, prevLenRef.current);
  const newPart = content.slice(prevLenRef.current);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [4, 0]) },
    ],
  }));

  const blurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 0.8, 1], [30, 4, 0]),
  }));

  const blurOpacity = useAnimatedStyle(() => ({
    opacity: progress.value < 1 ? 1 : 0,
  }));

  if (!newPart) {
    return (
      <Text style={style} selectable>
        {content}
      </Text>
    );
  }

  return (
    <View>
      <Text style={style} selectable>
        {oldPart}
      </Text>
      <Animated.View style={containerStyle}>
        <Text style={style}>{newPart}</Text>
        <Animated.View style={[StyleSheet.absoluteFill, blurOpacity]}>
          <AnimatedBlurView
            tint="default"
            animatedProps={blurProps}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export const StreamingText = memo(StreamingTextBase);
