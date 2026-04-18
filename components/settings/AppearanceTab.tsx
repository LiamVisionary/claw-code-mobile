import { View } from "react-native";
import { useGatewayStore } from "@/store/gatewayStore";
import { ACCENT_OPTIONS, type AccentTheme } from "@/constants/palette";
import { usePalette } from "@/hooks/usePalette";
import { Card, Caption, Segmented } from "./_shared";

/**
 * Theme and dark-mode are committed to the store immediately so every
 * component calling `usePalette()` updates in real time. The parent modal's
 * Revert button restores the pre-edit values from the SettingsForm snapshot.
 */
export function AppearanceTab() {
  const palette = usePalette();
  const darkMode = useGatewayStore((s) => s.settings.darkMode ?? "system");
  const accentTheme = useGatewayStore(
    (s) => (s.settings.accentTheme as AccentTheme | undefined) ?? "lavender"
  );
  const setSettings = useGatewayStore((s) => s.actions.setSettings);

  return (
    <>
      <Card>
        <View style={{ padding: 18, gap: 14 }}>
          <Segmented
            options={[
              { key: "system", label: "System" },
              { key: "light", label: "Light" },
              { key: "dark", label: "Dark" },
            ]}
            value={darkMode}
            onChange={(k) =>
              setSettings({ darkMode: k as "system" | "light" | "dark" })
            }
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Segmented
                options={ACCENT_OPTIONS}
                value={accentTheme}
                onChange={(k) => setSettings({ accentTheme: k })}
              />
            </View>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: palette.accent,
              }}
            />
          </View>
        </View>
      </Card>
      <Caption>
        {darkMode === "system"
          ? "Follows your device's appearance automatically."
          : darkMode === "dark"
          ? "Always use a dark background with light text."
          : "Always use a light background with dark text."}
        {" "}
        {accentTheme === "lavender"
          ? "Lavender accent."
          : accentTheme === "neo"
          ? "Neo — phosphor green on black. Always dark."
          : "Terracotta accent — the original warm tone."}
      </Caption>
    </>
  );
}
