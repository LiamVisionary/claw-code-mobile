import { memo, useEffect, useRef } from "react";
import { Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";

type Props = {
  content: string;
  style?: any;
  streaming?: boolean;
};

function StreamingTextBase({ content, style, streaming }: Props) {
  const prevContentRef = useRef("");
  const progress = useSharedValue(1);

  const prevContent = prevContentRef.current;
  const isNew = content !== prevContent;

  useEffect(() => {
    if (isNew && streaming) {
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: 600,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });
    }
    prevContentRef.current = content;
  }, [content, streaming]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0.6, 1]),
  }));

  if (!streaming) {
    return (
      <Text style={style} selectable>
        {content}
      </Text>
    );
  }

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
