import { StyleProp, View, ViewStyle } from "react-native";
// Media queries for web layout.
import { tw } from "@/util/tw";

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
        },
        // @ts-expect-error
        process.env.EXPO_OS === "web" && { maxHeight: "100vh" },
      ]}
    >
      <View
        style={[
          { flex: 1, maxWidth: 640, flexGrow: 1 },
          tw`md:w-[640px] md:mx-auto`,
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
