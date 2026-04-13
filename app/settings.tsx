import * as AC from "@bacons/apple-colors";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { useGatewayStore } from "@/store/gatewayStore";

const MODEL_PROVIDERS = [
  { key: "claude", label: "Claude" },
  { key: "openrouter", label: "OpenRouter" },
  { key: "local", label: "Local" },
] as const;

type Provider = typeof MODEL_PROVIDERS[number]["key"];

export default function SettingsScreen() {
  const { settings } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);

  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [bearerToken, setBearerToken] = useState(settings.bearerToken);
  const [provider, setProvider] = useState<Provider>(settings.model?.provider ?? "claude");
  const [modelName, setModelName] = useState(settings.model?.name ?? "");
  const [apiKey, setApiKey] = useState(settings.model?.apiKey ?? "");
  const [connStatus, setConnStatus] = useState<"idle" | "ok" | "error">("idle");
  const [connMessage, setConnMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setServerUrl(settings.serverUrl);
    setBearerToken(settings.bearerToken);
    setProvider(settings.model?.provider ?? "claude");
    setModelName(settings.model?.name ?? "");
    setApiKey(settings.model?.apiKey ?? "");
  }, [settings]);

  const save = () => {
    actions.setSettings({
      serverUrl,
      bearerToken,
      model: { provider, name: modelName, apiKey },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testConnection = async () => {
    if (!serverUrl || !bearerToken) {
      setConnMessage("Set server URL and token first.");
      setConnStatus("error");
      return;
    }
    setConnStatus("idle");
    setConnMessage(null);
    try {
      const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/health`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setConnMessage(`Connected — ${data.service ?? "ok"}`);
      setConnStatus("ok");
    } catch (err: any) {
      setConnMessage(err.message);
      setConnStatus("error");
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: AC.systemGroupedBackground }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
    >
      {/* Connection */}
      <View style={cardStyle}>
        <Text style={sectionTitle}>VPS Connection</Text>
        <TextInput
          placeholder="Server URL  (e.g. https://your-runpod.io)"
          placeholderTextColor={AC.systemGray}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          keyboardType="url"
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
        <TouchableBounce sensory onPress={testConnection}>
          <View style={[buttonStyle, { backgroundColor: AC.systemGray5 }]}>
            <Text style={{ color: AC.label, fontWeight: "600" }}>Test connection</Text>
          </View>
        </TouchableBounce>
        {connMessage && (
          <Text style={{ color: connStatus === "ok" ? AC.systemGreen : AC.systemRed, fontSize: 13 }}>
            {connMessage}
          </Text>
        )}
      </View>

      {/* Model */}
      <View style={cardStyle}>
        <Text style={sectionTitle}>Model</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {MODEL_PROVIDERS.map((p) => (
            <TouchableBounce key={p.key} sensory onPress={() => setProvider(p.key)} style={{ flex: 1 }}>
              <View
                style={{
                  paddingVertical: 10,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: provider === p.key ? AC.label : AC.systemGray5,
                  borderWidth: 1,
                  borderColor: provider === p.key ? AC.label : AC.separator,
                }}
              >
                <Text
                  style={{
                    fontWeight: "600",
                    fontSize: 14,
                    color: provider === p.key ? AC.systemBackground : AC.label,
                  }}
                >
                  {p.label}
                </Text>
              </View>
            </TouchableBounce>
          ))}
        </View>

        <TextInput
          placeholder={
            provider === "claude"
              ? "Model  (e.g. claude-opus-4-5)"
              : provider === "openrouter"
              ? "Model  (e.g. anthropic/claude-3.5-sonnet)"
              : "Model name or path"
          }
          placeholderTextColor={AC.systemGray}
          value={modelName}
          onChangeText={setModelName}
          autoCapitalize="none"
          style={inputStyle}
        />

        {provider !== "local" && (
          <TextInput
            placeholder={provider === "claude" ? "Anthropic API key" : "OpenRouter API key"}
            placeholderTextColor={AC.systemGray}
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            secureTextEntry
            style={inputStyle}
          />
        )}
      </View>

      {/* Save */}
      <TouchableBounce sensory onPress={save}>
        <View style={[buttonStyle, { backgroundColor: AC.label }]}>
          <Text style={{ color: AC.systemBackground, fontWeight: "700", fontSize: 16 }}>
            {saved ? "Saved ✓" : "Save settings"}
          </Text>
        </View>
      </TouchableBounce>
    </ScrollView>
  );
}

const cardStyle = {
  backgroundColor: AC.secondarySystemGroupedBackground,
  borderRadius: 16,
  padding: 16,
  gap: 12,
  borderWidth: 1,
  borderColor: AC.separator,
} as const;

const sectionTitle = {
  color: AC.label,
  fontSize: 17,
  fontWeight: "700",
} as const;

const inputStyle = {
  backgroundColor: AC.systemBackground,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 11,
  borderColor: AC.separator,
  borderWidth: 1,
  color: AC.label,
  fontSize: 15,
} as const;

const buttonStyle = {
  borderRadius: 14,
  paddingVertical: 14,
  alignItems: "center",
} as const;
