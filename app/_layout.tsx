import Stack from "@/components/ui/Stack";
import ThemeProvider from "@/components/ui/ThemeProvider";
import "@/global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import * as AC from "@bacons/apple-colors";
import { Link } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { View } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";

export const unstable_settings = {
  initialRouteName: "index",
};

export { ErrorBoundary } from "expo-router";

export default function Layout() {
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
                headerLargeStyle: {
                  backgroundColor: AC.systemGroupedBackground,
                },
                headerTransparent: false,
                headerLeft: () => (
                  <Link href="/settings" asChild>
                    <TouchableBounce sensory>
                      <View
                        style={[
                          {
                            flex: 1,
                            paddingHorizontal: 16,
                            paddingVertical: 8,
                            alignItems: "center",
                            display: "flex",
                            marginLeft: process.env.EXPO_OS !== "web" ? -16 : 0,
                          },
                        ]}
                      >
                        <IconSymbol name="gear" color={AC.label} />
                      </View>
                    </TouchableBounce>
                  </Link>
                ),
              }}
            />
            <Stack.Screen
              name="thread/[id]"
              options={{
                title: "Thread",
                headerTransparent: false,
              }}
            />
            <Stack.Screen
              name="settings"
              options={{
                title: "Settings",
                presentation: "formSheet",
              }}
            />
          </Stack>
        </ThemeProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
