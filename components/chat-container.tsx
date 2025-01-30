import { StyleProp, View, ViewStyle } from "react-native";
// Media queries for web layout.
import { tw } from "@/util/tw";
import * as AC from "@bacons/apple-colors";

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
        className="w-160"
        style={[
          { flex: 1, maxWidth: 640, flexGrow: 1 },
          tw`md:w-160 md:mx-auto`,
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
