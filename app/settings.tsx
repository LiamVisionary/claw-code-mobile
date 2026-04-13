import * as AC from "@bacons/apple-colors";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { useGatewayStore } from "@/store/gatewayStore";

export default function SettingsScreen() {
  const { settings } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [bearerToken, setBearerToken] = useState(settings.bearerToken);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");

  useEffect(() => {
    setServerUrl(settings.serverUrl);
    setBearerToken(settings.bearerToken);
  }, [settings.serverUrl, settings.bearerToken]);

  const save = () => {
    actions.setSettings({ serverUrl, bearerToken });
    setMessage("Settings saved");
    setStatus("ok");
  };

  const testConnection = async () => {
    if (!serverUrl || !bearerToken) {
      setMessage("Please set server URL and token first.");
      setStatus("error");
      return;
    }
    setStatus("idle");
    setMessage(null);
    try {
      const url = serverUrl.replace(/\/+$/, "");
      const res = await fetch(`${url}/health`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      if (!res.ok) throw new Error("Health check failed");
      const data = await res.json();
      setMessage(`Connected: ${data.service ?? "ok"}`);
      setStatus("ok");
    } catch (err: any) {
      setMessage(err.message);
      setStatus("error");
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: AC.systemGroupedBackground,
        padding: 16,
        gap: 16,
      }}
    >
      <View
        style={{
          backgroundColor: AC.secondarySystemGroupedBackground,
          borderRadius: 16,
          padding: 16,
          gap: 12,
          borderWidth: 1,
          borderColor: AC.separator,
        }}
      >
        <Text style={{ color: AC.label, fontSize: 18, fontWeight: "700" }}>
          Gateway
        </Text>
        <TextInput
          placeholder="Server URL (e.g. http://localhost:4000)"
          placeholderTextColor={AC.systemGray}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          style={inputStyle}
        />
        <TextInput
          placeholder="Bearer token"
          placeholderTextColor={AC.systemGray}
          value={bearerToken}
          onChangeText={setBearerToken}
          autoCapitalize="none"
          secureTextEntry
          style={inputStyle}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableBounce sensory onPress={save} style={{ flex: 1 }}>
            <View style={buttonStyle(AC.label)}>
              <Text style={{ color: AC.systemBackground, fontWeight: "600" }}>
                Save
              </Text>
            </View>
          </TouchableBounce>
          <TouchableBounce sensory onPress={testConnection} style={{ flex: 1 }}>
            <View style={buttonStyle(AC.systemGray2)}>
              <Text style={{ color: AC.systemBackground, fontWeight: "600" }}>
                Test
              </Text>
            </View>
          </TouchableBounce>
        </View>
        {message && (
          <Text
            style={{
              color: status === "ok" ? AC.systemGreen : AC.systemRed,
              fontSize: 13,
            }}
          >
            {message}
          </Text>
        )}
      </View>
    </View>
  );
}

const inputStyle = {
  backgroundColor: AC.systemBackground,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderColor: AC.separator,
  borderWidth: 1,
  color: AC.label,
} as const;

const buttonStyle = (backgroundColor: string) => ({
  backgroundColor,
  borderRadius: 12,
  paddingVertical: 12,
  alignItems: "center",
});
