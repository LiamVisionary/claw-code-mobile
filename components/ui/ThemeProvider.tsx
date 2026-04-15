import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as RNTheme,
  Theme,
} from "@react-navigation/native";
import { useColorScheme } from "react-native";
import { useGatewayStore } from "@/store/gatewayStore";
import { buildPalette, type AccentTheme } from "@/constants/palette";

export default function ThemeProvider(props: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const darkMode = useGatewayStore((s) => s.settings.darkMode);
  const accentTheme = useGatewayStore(
    (s) => (s.settings.accentTheme as AccentTheme | undefined) ?? "lavender"
  );

  const isDark =
    darkMode === "dark" || (darkMode === "system" && systemColorScheme === "dark");

  const palette = buildPalette(isDark, accentTheme);

  const navTheme: Theme = {
    dark: isDark,
    colors: {
      primary: palette.accent,
      background: palette.bg,
      card: palette.surface,
      text: palette.text,
      border: palette.divider,
      notification: palette.danger,
    },
    fonts: isDark ? DarkTheme.fonts : DefaultTheme.fonts,
  };

  return (
    <RNTheme value={navTheme}>
      {props.children}
    </RNTheme>
  );
}
