import { ActivityIndicator, Text, View } from "react-native";
import { GlassButton } from "@/components/ui/GlassButton";
import { usePalette } from "@/hooks/usePalette";
import { Card, Field } from "./_shared";
import { useSettingsForm } from "./SettingsFormContext";

export function ConnectionTab() {
  const palette = usePalette();
  const {
    serverUrl,
    setServerUrl,
    bearerToken,
    setBearerToken,
    handleServerUrlBlur,
    handleBearerTokenBlur,
    testConnection,
    connTesting,
    connStatus,
    connMessage,
  } = useSettingsForm();

  return (
    <>
      <Card>
        <View style={{ padding: 18, gap: 12 }}>
          <Field
            placeholder="Server URL (e.g. 192.168.1.9:5000)"
            value={serverUrl}
            onChangeText={setServerUrl}
            onEndEditing={handleServerUrlBlur}
            keyboardType="url"
          />
          <Field
            placeholder="Bearer token"
            value={bearerToken}
            onChangeText={setBearerToken}
            onEndEditing={handleBearerTokenBlur}
            secureTextEntry
          />
          <GlassButton
            onPress={testConnection}
            disabled={connTesting}
            style={{ borderRadius: 12, paddingVertical: 13, width: "100%", opacity: connTesting ? 0.7 : 1 }}
          >
            {connTesting ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator color={palette.text} size="small" />
                <Text style={{ color: palette.text, fontWeight: "600", fontSize: 14, letterSpacing: 0.2 }}>
                  Testing…
                </Text>
              </View>
            ) : (
              <Text style={{ color: palette.text, fontWeight: "600", fontSize: 14, letterSpacing: 0.2 }}>
                Test connection
              </Text>
            )}
          </GlassButton>
          {connMessage && (
            <Text
              style={{
                color: connStatus === "ok" ? palette.success : palette.danger,
                fontSize: 13,
                marginTop: 2,
              }}
            >
              {connMessage}
            </Text>
          )}
        </View>
      </Card>
    </>
  );
}
