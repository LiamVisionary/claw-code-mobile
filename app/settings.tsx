import * as AC from "@bacons/apple-colors";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { type ModelEntry, useGatewayStore } from "@/store/gatewayStore";

const PROVIDERS = [
  { key: "claude" as const, label: "Claude", color: "#0066FF" },
  { key: "openrouter" as const, label: "OpenRouter", color: "#7B3FE4" },
  { key: "local" as const, label: "Local", color: "#16A34A" },
];

const providerMeta = (key: ModelEntry["provider"]) =>
  PROVIDERS.find((p) => p.key === key) ?? PROVIDERS[0];

const makeId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Queue Row ──────────────────────────────────────────────────────────────

function QueueRow({
  entry,
  index,
  total,
  onToggle,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  entry: ModelEntry;
  index: number;
  total: number;
  onToggle: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const meta = providerMeta(entry.provider);
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: AC.systemBackground,
        borderWidth: 1,
        borderColor: AC.separator,
        opacity: entry.enabled ? 1 : 0.5,
      }}
    >
      {/* Order arrows */}
      <View style={{ gap: 2 }}>
        <TouchableBounce onPress={onMoveUp} disabled={isFirst}>
          <Text style={{ fontSize: 16, color: isFirst ? AC.systemGray4 : AC.label }}>▲</Text>
        </TouchableBounce>
        <TouchableBounce onPress={onMoveDown} disabled={isLast}>
          <Text style={{ fontSize: 16, color: isLast ? AC.systemGray4 : AC.label }}>▼</Text>
        </TouchableBounce>
      </View>

      {/* Provider badge */}
      <View
        style={{
          backgroundColor: meta.color + "22",
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderWidth: 1,
          borderColor: meta.color + "55",
        }}
      >
        <Text style={{ color: meta.color, fontSize: 11, fontWeight: "700" }}>
          {meta.label}
        </Text>
      </View>

      {/* Model name */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ color: AC.label, fontSize: 14, fontWeight: "600" }}
          numberOfLines={1}
        >
          {entry.name || "(unnamed)"}
        </Text>
        {entry.apiKey ? (
          <Text style={{ color: AC.secondaryLabel, fontSize: 12 }}>
            Key: ···{entry.apiKey.slice(-4)}
          </Text>
        ) : entry.provider !== "local" ? (
          <Text style={{ color: AC.systemOrange, fontSize: 12 }}>No API key</Text>
        ) : null}
      </View>

      {/* Toggle */}
      <Switch
        value={entry.enabled}
        onValueChange={onToggle}
        trackColor={{ true: AC.systemGreen as string, false: AC.systemGray4 as string }}
        thumbColor="#fff"
        style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
      />

      {/* Delete */}
      <TouchableBounce sensory onPress={onDelete}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: AC.systemRed + "22",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: AC.systemRed, fontSize: 14, fontWeight: "700" }}>×</Text>
        </View>
      </TouchableBounce>
    </View>
  );
}

// ─── Add Model Form ──────────────────────────────────────────────────────────

function AddModelForm({
  existingEntries,
  onAdd,
}: {
  existingEntries: ModelEntry[];
  onAdd: (entry: ModelEntry) => void;
}) {
  const [provider, setProvider] = useState<ModelEntry["provider"]>("claude");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [expanded, setExpanded] = useState(false);
  const height = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(height, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: false,
      tension: 70,
      friction: 12,
    }).start();
  }, [expanded]);

  // Auto-fill API key when provider changes (from existing entries)
  const onProviderChange = (p: ModelEntry["provider"]) => {
    setProvider(p);
    const existing = existingEntries.find((e) => e.provider === p && e.apiKey);
    if (existing) setApiKey(existing.apiKey);
  };

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      id: makeId(),
      provider,
      name: name.trim(),
      apiKey: apiKey.trim(),
      enabled: true,
    });
    setName("");
    setApiKey("");
    setExpanded(false);
  };

  const meta = providerMeta(provider);

  return (
    <View>
      <TouchableBounce sensory onPress={() => setExpanded((e) => !e)}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: AC.systemBlue + "66",
            borderStyle: "dashed",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: AC.systemBlue, fontSize: 16, fontWeight: "700" }}>
            {expanded ? "−" : "+"}
          </Text>
          <Text style={{ color: AC.systemBlue, fontSize: 15, fontWeight: "600" }}>
            {expanded ? "Cancel" : "Add model"}
          </Text>
        </View>
      </TouchableBounce>

      <Animated.View
        style={{
          overflow: "hidden",
          maxHeight: height.interpolate({ inputRange: [0, 1], outputRange: [0, 400] }),
          opacity: height,
        }}
      >
        <View style={{ paddingTop: 12, gap: 10 }}>
          {/* Provider tabs */}
          <View style={{ flexDirection: "row", gap: 6 }}>
            {PROVIDERS.map((p) => (
              <TouchableBounce
                key={p.key}
                sensory
                onPress={() => onProviderChange(p.key)}
                style={{ flex: 1 }}
              >
                <View
                  style={{
                    paddingVertical: 8,
                    borderRadius: 10,
                    alignItems: "center",
                    backgroundColor: provider === p.key ? p.color : AC.systemGray6,
                    borderWidth: 1,
                    borderColor: provider === p.key ? p.color : AC.separator,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: provider === p.key ? "#fff" : AC.secondaryLabel,
                    }}
                  >
                    {p.label}
                  </Text>
                </View>
              </TouchableBounce>
            ))}
          </View>

          {/* Model name */}
          <TextInput
            placeholder={
              provider === "claude"
                ? "Model name  (e.g. claude-opus-4-5)"
                : provider === "openrouter"
                ? "Model name  (e.g. anthropic/claude-3.5-sonnet)"
                : "Model name or path"
            }
            placeholderTextColor={AC.systemGray}
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            style={inputStyle}
          />

          {/* API key (hidden for local) */}
          {provider !== "local" && (
            <TextInput
              placeholder={
                provider === "claude" ? "Anthropic API key  (sk-ant-…)" : "OpenRouter API key  (sk-or-…)"
              }
              placeholderTextColor={AC.systemGray}
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              secureTextEntry
              style={inputStyle}
            />
          )}

          {/* Add button */}
          <TouchableBounce sensory onPress={handleAdd}>
            <View
              style={[
                buttonStyle,
                { backgroundColor: name.trim() ? meta.color : AC.systemGray4 },
              ]}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                Add to queue
              </Text>
            </View>
          </TouchableBounce>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { settings } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);

  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [bearerToken, setBearerToken] = useState(settings.bearerToken);
  const [connStatus, setConnStatus] = useState<"idle" | "ok" | "error">("idle");
  const [connMessage, setConnMessage] = useState<string | null>(null);
  const [autoCompact, setAutoCompact] = useState(settings.autoCompact ?? true);
  const [streamingEnabled, setStreamingEnabled] = useState(settings.streamingEnabled ?? true);
  const [saved, setSaved] = useState(false);

  // Build initial queue: use stored queue, or migrate from legacy single model
  const initialQueue = useMemo<ModelEntry[]>(() => {
    if (settings.modelQueue && settings.modelQueue.length > 0) return settings.modelQueue;
    if (settings.model) {
      return [
        {
          id: makeId(),
          provider: settings.model.provider,
          name: settings.model.name,
          apiKey: settings.model.apiKey,
          enabled: true,
        },
      ];
    }
    return [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [queue, setQueue] = useState<ModelEntry[]>(initialQueue);

  useEffect(() => {
    setServerUrl(settings.serverUrl);
    setBearerToken(settings.bearerToken);
  }, [settings.serverUrl, settings.bearerToken]);

  const save = () => {
    actions.setSettings({
      serverUrl,
      bearerToken,
      modelQueue: queue,
      autoCompact,
      streamingEnabled,
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

  const moveUp = (i: number) =>
    setQueue((q) => {
      if (i === 0) return q;
      const next = [...q];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });

  const moveDown = (i: number) =>
    setQueue((q) => {
      if (i === q.length - 1) return q;
      const next = [...q];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });

  const toggleEntry = (i: number) =>
    setQueue((q) => q.map((e, idx) => (idx === i ? { ...e, enabled: !e.enabled } : e)));

  const deleteEntry = (i: number) =>
    setQueue((q) => q.filter((_, idx) => idx !== i));

  const addEntry = (entry: ModelEntry) => setQueue((q) => [...q, entry]);

  const enabledCount = queue.filter((e) => e.enabled).length;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: AC.systemGroupedBackground }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
      {/* ── Connection ────────────────────────────────────────── */}
      <View style={cardStyle}>
        <Text style={sectionTitle}>VPS Connection</Text>
        <TextInput
          placeholder="Server URL  (e.g. https://your-vps.io)"
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

      {/* ── Model Queue ───────────────────────────────────────── */}
      <View style={cardStyle}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={sectionTitle}>Model Queue</Text>
          {queue.length > 0 && (
            <View
              style={{
                backgroundColor: enabledCount > 0 ? AC.systemBlue + "22" : AC.systemGray5,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: enabledCount > 0 ? AC.systemBlue : AC.secondaryLabel,
                }}
              >
                {enabledCount}/{queue.length} active
              </Text>
            </View>
          )}
        </View>

        <Text style={{ color: AC.secondaryLabel, fontSize: 13 }}>
          Models are tried top-to-bottom, automatically falling back if one fails.
        </Text>

        {queue.length === 0 && (
          <View
            style={{
              paddingVertical: 20,
              alignItems: "center",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: AC.separator,
              backgroundColor: AC.systemGray6,
            }}
          >
            <Text style={{ color: AC.tertiaryLabel, fontSize: 14 }}>
              No models — add one below
            </Text>
          </View>
        )}

        {queue.map((entry, i) => (
          <QueueRow
            key={entry.id}
            entry={entry}
            index={i}
            total={queue.length}
            onToggle={() => toggleEntry(i)}
            onDelete={() => deleteEntry(i)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
          />
        ))}

        <AddModelForm existingEntries={queue} onAdd={addEntry} />
      </View>

      {/* ── Behaviour ─────────────────────────────────────────── */}
      <View style={cardStyle}>
        <Text style={sectionTitle}>Behaviour</Text>

        {/* Auto-compact toggle */}
        <View style={toggleRowStyle}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: AC.label, fontSize: 15, fontWeight: "600" }}>
              Auto-compact
            </Text>
            <Text style={{ color: AC.secondaryLabel, fontSize: 13, marginTop: 2 }}>
              Summarise the conversation when the context window fills up and retry automatically
            </Text>
          </View>
          <Switch
            value={autoCompact}
            onValueChange={setAutoCompact}
            trackColor={{ true: AC.systemGreen as string, false: AC.systemGray4 as string }}
            thumbColor="#fff"
          />
        </View>

        {/* Stream responses toggle */}
        <View style={toggleRowStyle}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: AC.label, fontSize: 15, fontWeight: "600" }}>
              Stream responses
            </Text>
            <Text style={{ color: AC.secondaryLabel, fontSize: 13, marginTop: 2 }}>
              Show words appearing as they arrive — turn off to display the full reply instantly
            </Text>
          </View>
          <Switch
            value={streamingEnabled}
            onValueChange={setStreamingEnabled}
            trackColor={{ true: AC.systemBlue as string, false: AC.systemGray4 as string }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* ── Save ──────────────────────────────────────────────── */}
      <TouchableBounce sensory onPress={save}>
        <View style={[buttonStyle, { backgroundColor: AC.label }]}>
          <Text style={{ color: AC.systemBackground, fontWeight: "700", fontSize: 16 }}>
            {saved ? "Saved ✓" : "Save settings"}
          </Text>
        </View>
      </TouchableBounce>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

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
  paddingVertical: 13,
  alignItems: "center",
} as const;

const toggleRowStyle = {
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: AC.systemBackground,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: AC.separator,
  paddingHorizontal: 14,
  paddingVertical: 12,
  gap: 12,
} as const;
