import * as AC from "@bacons/apple-colors";
import React from "react";
import { Text, View, useColorScheme } from "react-native";

export function AssistantMessage({ children }: { children?: React.ReactNode }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <View
      style={{
        paddingHorizontal: 16,
        flexDirection: "row",
        justifyContent: "flex-start",
      }}
    >
      <View
        style={{
          maxWidth: "85%",
          backgroundColor: isDark ? "#1c1c1e" : "#f0f0f0",
          borderRadius: 18,
          borderBottomLeftRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text
          style={{
            color: AC.label,
            fontSize: 15,
            lineHeight: 20,
          }}
          selectable
        >
          {children}
        </Text>
      </View>
    </View>
  );
}
