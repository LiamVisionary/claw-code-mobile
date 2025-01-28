import { StyleProp, View, ViewStyle } from "react-native";
// Media queries for web layout.
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
        { backgroundColor: "#000", flex: 1, alignItems: "stretch" },
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
