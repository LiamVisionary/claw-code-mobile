import Stack from "@/components/ui/Stack";

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        title: "Movies",
        headerTransparent: false,
      }}
    />
  );
}
