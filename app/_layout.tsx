import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { PlatformColor } from "react-native";

export default function Layout() {
  return (
  <ThemeProvider value={DarkTheme}>
  <Stack   screenOptions={{
    headerTransparent: true,
    headerBlurEffect: "prominent",
    headerShadowVisible: true,
    headerLargeTitle: true,
    headerLargeTitleShadowVisible: false,
    headerStyle: {
      // Hack to ensure the collapsed small header shows the shadow / border.
      backgroundColor: "rgba(255,255,255,0.01)",
    },
    headerLargeStyle: {
      backgroundColor: PlatformColor("systemGroupedBackgroundColor"), // Color of your background
    },
    contentStyle: {
      backgroundColor: PlatformColor("systemGroupedBackgroundColor"),
    },
    title: "Expo xAI"
  }}
  />
  </ThemeProvider>)
}
