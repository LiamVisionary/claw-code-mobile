"use client";

import * as AC from "@bacons/apple-colors";
import { forwardRef } from "react";
import { ScrollView, ScrollViewProps } from "react-native";

export const BodyScrollView = forwardRef<any, ScrollViewProps>((props, ref) => {
  const paddingBottom = 72; // useBottomTabOverflow();
  return (
    <ScrollView
      automaticallyAdjustsScrollIndicatorInsets
      contentInsetAdjustmentBehavior="automatic"
      contentInset={{ bottom: paddingBottom }}
      scrollIndicatorInsets={{ bottom: paddingBottom }}
      {...props}
      style={[{ backgroundColor: AC.systemGroupedBackground }, props.style]}
      ref={ref}
    />
  );
});
