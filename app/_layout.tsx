import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { PlatformColor } from "react-native";

export default function Layout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack
        screenOptions={{
          title: "Expo xAI",
        }}
      />
    </ThemeProvider>
  );
}
