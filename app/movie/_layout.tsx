import Stack from "@/components/ui/Stack";
import { Platform } from "react-native";

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        title: "Movies",
        headerTintColor: "white",
        ...Platform.select({
          ios: {
            headerTransparent: false,
          },
        }),
      }}
    />
  );
}
