"use client";
import * as AC from "@bacons/apple-colors";
import React from "react";
import { Text, View, useColorScheme } from "react-native";

export function UserMessage({ children }: { children?: React.ReactNode }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "flex-end",
        paddingHorizontal: 16,
      }}
    >
      <View
        style={{
          maxWidth: "80%",
          backgroundColor: AC.systemBlue,
          borderRadius: 18,
          borderBottomRightRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text
          numberOfLines={100}
          style={{
            color: "#fff",
            fontSize: 15,
            lineHeight: 20,
            flexWrap: "wrap",
            wordWrap: "break-word",
          }}
          selectable
        >
          {children}
        </Text>
      </View>
    </View>
  );
}
