import { IconSymbol } from "@/components/ui/IconSymbol";
import Stack from "@/components/ui/Stack";
import * as AC from "@bacons/apple-colors";
import { Link } from "expo-router";
import { Platform, TouchableOpacity } from "react-native";
export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        title: "Movies",
        headerTintColor: "white",
        headerRight: () => (
          <Link
            href="/"
            dismissTo
            asChild
            style={{ padding: 8, marginRight: -8 }}
          >
            <TouchableOpacity>
              <IconSymbol
                name="xmark.circle.fill"
                color={AC.systemGray}
                size={28}
              />
            </TouchableOpacity>
          </Link>
        ),
        ...Platform.select({
          ios: {
            headerTransparent: false,
          },
        }),
      }}
    />
  );
}
