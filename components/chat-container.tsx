import { StyleProp, View, ViewStyle } from "react-native";
import { theme } from "@/theme";
import { SHADOW } from "@/theme";

export function ChatContainer({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: "stretch",
          backgroundColor: "#0f0f0f",
          ...SHADOW.lg,
        },
        // @ts-expect-error
        process.env.EXPO_OS === "web" && { maxHeight: "100vh" },
        style,
      ]}
    >
      <View style={[{ flex: 1, flexGrow: 1 }, style]}>{children}</View>
    </View>
  );
}