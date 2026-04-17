import { StyleProp, View, ViewStyle } from "react-native";
import { usePalette } from "@/hooks/usePalette";

export function ChatContainer({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();

  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: "stretch",
          backgroundColor: palette.bg,
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
