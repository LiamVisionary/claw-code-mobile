import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Link } from "expo-router";
import Stack from "@/components/ui/Stack";

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
          headerTransparent: false,
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerLeft: () => (
              <Link href="/_debug" style={{ color: "black" }}>
                Debug
              </Link>
            ),
          }}
        />
        <Stack.Screen
          name="_debug"
          options={{
            headerTransparent: false,
            headerLargeStyle: {
              backgroundColor: undefined,
            },
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="movie"
          sheet
          options={{
            presentation: "modal",
            headerShown: false,
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
