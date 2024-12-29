import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, Link } from "expo-router";

export const unstable_settings = {
  initialRouteName: "index",
};

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack
        screenOptions={{
          title: "Expo xAI",
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerRight: () => (
              <Link href="/_debug" style={{ color: "black" }}>
                Debug
              </Link>
            ),
          }}
        />
        <Stack.Screen
          name="_debug"
          options={{
            presentation: "modal",
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
