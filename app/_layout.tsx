import "react-native-gesture-handler";
import Stack from "@/components/ui/Stack";
import ThemeProvider from "@/components/ui/ThemeProvider";
import "@/global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Appearance } from "react-native";
import { useEffect } from "react";
import { useGatewayStore } from "@/store/gatewayStore";

export const unstable_settings = {
  initialRouteName: "index",
};

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  const darkMode = useGatewayStore((s) => s.settings.darkMode ?? "system");

  useEffect(() => {
    if (darkMode === "dark") {
      Appearance.setColorScheme("dark");
    } else if (darkMode === "light") {
      Appearance.setColorScheme("light");
    } else {
      Appearance.setColorScheme(null);
    }
  }, [darkMode]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <ThemeProvider>
          <Stack
            screenOptions={{
              title: "Claw Code",
            }}
          >
            <Stack.Screen
              name="index"
              options={{
                title: "Chats",
              }}
            />
            <Stack.Screen
              name="thread/[id]"
              options={{
                title: "",
              }}
            />
            <Stack.Screen
              name="settings"
              options={{
                title: "Settings",
                presentation: "modal",
                headerBlurEffect: undefined,
                headerShadowVisible: false,
                headerStyle: { backgroundColor: "transparent" },
              }}
            />
          </Stack>
        </ThemeProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
