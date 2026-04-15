import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { useGatewayStore } from "@/store/gatewayStore";
import {
  buildPalette,
  type Palette,
  type AccentTheme,
} from "@/constants/palette";

/**
 * React hook that returns the resolved colour palette for the current
 * dark-mode + accent-theme settings.  Re-renders automatically when the
 * user changes either setting in the store.
 */
export function usePalette(): Palette {
  const scheme = useColorScheme();
  const darkMode = useGatewayStore((s) => s.settings.darkMode ?? "system");
  const accentTheme = useGatewayStore(
    (s) => (s.settings.accentTheme as AccentTheme | undefined) ?? "lavender"
  );

  const isDark =
    darkMode === "dark" || (darkMode === "system" && scheme === "dark");

  return useMemo(() => buildPalette(isDark, accentTheme), [isDark, accentTheme]);
}
