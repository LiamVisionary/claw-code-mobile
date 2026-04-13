import { StyleProp, View, ViewStyle, useColorScheme } from "react-native";
import * as AC from "@bacons/apple-colors";

export function ChatContainer({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: "stretch",
          backgroundColor: isDark ? "#000" : AC.systemGroupedBackground,
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
