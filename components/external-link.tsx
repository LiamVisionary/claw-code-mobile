"use client";

import { useEffect, useRef } from "react";
import { Animated, Easing, ViewProps } from "react-native";

export function SubtleScaleAndFadeIn({
  delay,
  ...props
}: ViewProps & { delay?: number }) {
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animation, {
      toValue: 1,
      delay,
      duration: 500,
      useNativeDriver: true,

      easing: Easing.out(Easing.ease),
    }).start();
  }, [delay]);

  return (
    <Animated.View
      {...props}
      style={[
        props.style,
        {
          opacity: animation.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 2],
          }),

          transform: [
            {
              scale: animation.interpolate({
                inputRange: [0, 1],
                outputRange: [0.7, 1],
              }),
            },
          ],
        },
      ]}
    />
  );
}
