import { StyleProp, View, ViewStyle } from "react-native";
// Media queries for web layout.
import * as AC from "@bacons/apple-colors";
import { unstable_styles } from "./chat-container.module.css";

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
          backgroundColor: AC.systemBackground,
          flex: 1,
          alignItems: "stretch",
        },
        // @ts-expect-error
        process.env.EXPO_OS === "web" && { maxHeight: "100vh" },
      ]}
    >
      <View
        style={[
          { flex: 1, maxWidth: 640, flexGrow: 1 },
          unstable_styles.container,
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
