import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { Stack } from "expo-router";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { type ModelEntry, useGatewayStore } from "@/store/gatewayStore";
import {
  pickVaultDirectory,
  validateLocalVault,
} from "@/util/vault/localVault";

// ─── Design tokens ───────────────────────────────────────────────────────────
// Warm, low-contrast palette from DESIGN_GUIDELINES.md.

const LIGHT = {
  bg: "#F6F2EA",
  surface: "#FBF8F1",
  surfaceAlt: "#F0EADE",
  text: "#2B2823",
  textMuted: "#78736A",
  textSoft: "#A9A397",
  divider: "#E6DFD1",
  accent: "#B85742",
  danger: "#A6463A",
  success: "#6B8F5E",
};

const DARK = {
  bg: "#1B1917",
  surface: "#242120",
  surfaceAlt: "#2E2A27",
  text: "#EDE7DA",
  textMuted: "#9E978A",
  textSoft: "#6E685E",
  divider: "#332F2B",
  accent: "#D97A63",
  danger: "#D97A63",
  success: "#9EBB90",
};

type Palette = typeof LIGHT;

// ─── Accent themes ───────────────────────────────────────────────────────────
// The original warm terracotta ("claude") is preserved as one option; lavender
// is the default so the app doesn't read as Claude-branded at a glance.

const ACCENTS = {
  claude:   { light: "#B85742", dark: "#D97A63" },
  lavender: { light: "#7B6CA8", dark: "#B9A6DB" },
} as const;

type AccentTheme = keyof typeof ACCENTS;

const ACCENT_OPTIONS: { key: AccentTheme; label: string }[] = [
  { key: "lavender", label: "Lavender" },
  { key: "claude", label: "Terracotta" },
];

// ─── Providers ───────────────────────────────────────────────────────────────

const PROVIDERS = [
  { key: "claude" as const, label: "Claude" },
  { key: "openrouter" as const, label: "OpenRouter" },
  { key: "local" as const, label: "Local" },
];

type OpenRouterModel = { id: string; label: string };

const OPENROUTER_TOP_ENDPOINT =
  "https://openrouter.ai/api/frontend/models/find?category=programming&order=top-weekly";

const OPENROUTER_FALLBACK: OpenRouterModel[] = [
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "anthropic/claude-opus-4", label: "Claude Opus 4" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

let openRouterTopCache: {
  models: OpenRouterModel[];
  fetchedAt: number;
} | null = null;
const OPENROUTER_CACHE_TTL_MS = 1000 * 60 * 60;

async function fetchOpenRouterTopCoding(): Promise<OpenRouterModel[]> {
  if (
    openRouterTopCache &&
    Date.now() - openRouterTopCache.fetchedAt < OPENROUTER_CACHE_TTL_MS
  ) {
    return openRouterTopCache.models;
  }
  const res = await fetch(OPENROUTER_TOP_ENDPOINT);
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const json = (await res.json()) as {
    data?: { models?: { slug?: string; short_name?: string; name?: string }[] };
  };
  const raw = json.data?.models ?? [];
  const models: OpenRouterModel[] = raw
    .slice(0, 10)
    .filter((m): m is { slug: string; short_name?: string; name?: string } =>
      typeof m.slug === "string" && m.slug.length > 0
    )
    .map((m) => ({
      id: m.slug,
      label: m.short_name || m.name || m.slug,
    }));
  if (models.length === 0) throw new Error("OpenRouter returned empty list");
  openRouterTopCache = { models, fetchedAt: Date.now() };
  return models;
}

const makeId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Small reusable primitives ───────────────────────────────────────────────

function SectionHeader({ title, palette }: { title: string; palette: Palette }) {
  return (
    <Text
      style={{
        color: palette.textMuted,
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 1.4,
        textTransform: "uppercase",
        marginBottom: 14,
        marginLeft: 4,
      }}
    >
      {title}
    </Text>
  );
}

function Hairline({ palette, inset = 0 }: { palette: Palette; inset?: number }) {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: palette.divider,
        marginLeft: inset,
      }}
    />
  );
}

function Caption({
  children,
  palette,
}: {
  children: React.ReactNode;
  palette: Palette;
}) {
  return (
    <Text
      style={{
        color: palette.textMuted,
        fontSize: 13,
        lineHeight: 19,
        marginTop: 10,
        marginLeft: 4,
        marginRight: 4,
      }}
    >
      {children}
    </Text>
  );
}

// ─── Segmented control ──────────────────────────────────────────────────────

function Segmented<T extends string>({
  options,
  value,
  onChange,
  palette,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  palette: Palette;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: palette.surfaceAlt,
        borderRadius: 12,
        padding: 3,
      }}
    >
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <View key={opt.key} style={{ flex: 1 }}>
            <TouchableBounce sensory onPress={() => onChange(opt.key)}>
              <View
                style={{
                  paddingVertical: 10,
                  borderRadius: 9,
                  alignItems: "center",
                  backgroundColor: selected ? palette.surface : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: selected ? "600" : "500",
                    color: selected ? palette.text : palette.textMuted,
                    letterSpacing: 0.1,
                  }}
                >
                  {opt.label}
                </Text>
              </View>
            </TouchableBounce>
          </View>
        );
      })}
    </View>
  );
}

// ─── Input ───────────────────────────────────────────────────────────────────

function Field({
  placeholder,
  value,
  onChangeText,
  palette,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
}: {
  placeholder: string;
  value: string;
  onChangeText: (s: string) => void;
  palette: Palette;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "url";
  autoCapitalize?: "none" | "sentences";
}) {
  return (
    <TextInput
      placeholder={placeholder}
      placeholderTextColor={palette.textSoft}
      value={value}
      onChangeText={onChangeText}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      style={{
        backgroundColor: palette.surfaceAlt,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        color: palette.text,
        fontSize: 15,
        fontWeight: "500",
      }}
    />
  );
}

// ─── Queue row ───────────────────────────────────────────────────────────────

function QueueRow({
  entry,
  index,
  total,
  onToggle,
  onDelete,
  onMoveUp,
  onMoveDown,
  palette,
}: {
  entry: ModelEntry;
  index: number;
  total: number;
  onToggle: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  palette: Palette;
}) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const providerLabel = PROVIDERS.find((p) => p.key === entry.provider)?.label ?? "";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 18,
        gap: 14,
        opacity: entry.enabled ? 1 : 0.5,
      }}
    >
      <View style={{ gap: 4 }}>
        <TouchableBounce onPress={onMoveUp} disabled={isFirst}>
          <Text
            style={{
              fontSize: 11,
              color: isFirst ? palette.textSoft : palette.textMuted,
            }}
          >
            ▲
          </Text>
        </TouchableBounce>
        <TouchableBounce onPress={onMoveDown} disabled={isLast}>
          <Text
            style={{
              fontSize: 11,
              color: isLast ? palette.textSoft : palette.textMuted,
            }}
          >
            ▼
          </Text>
        </TouchableBounce>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            color: palette.text,
            fontSize: 15,
            fontWeight: "600",
            letterSpacing: 0.1,
          }}
          numberOfLines={1}
        >
          {entry.name || "Unnamed model"}
        </Text>
        <Text
          style={{
            color: palette.textMuted,
            fontSize: 12,
            marginTop: 3,
            fontWeight: "500",
          }}
          numberOfLines={1}
        >
          {providerLabel}
          {entry.provider === "local"
            ? entry.endpoint
              ? `  ·  ${entry.endpoint.replace(/^https?:\/\//, "")}`
              : "  ·  no endpoint"
            : entry.apiKey
            ? `  ·  ···${entry.apiKey.slice(-4)}`
            : "  ·  no key"}
        </Text>
      </View>

      <Switch
        value={entry.enabled}
        onValueChange={onToggle}
        trackColor={{ true: palette.text, false: palette.surfaceAlt }}
        thumbColor={palette.surface}
        ios_backgroundColor={palette.surfaceAlt}
        style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
      />

      <TouchableBounce sensory onPress={onDelete}>
        <Text
          style={{
            color: palette.textSoft,
            fontSize: 20,
            fontWeight: "300",
            paddingHorizontal: 4,
          }}
        >
          ×
        </Text>
      </TouchableBounce>
    </View>
  );
}

// ─── Add model form ─────────────────────────────────────────────────────────

function AddModelForm({
  existingEntries,
  onAdd,
  palette,
}: {
  existingEntries: ModelEntry[];
  onAdd: (entry: ModelEntry) => void;
  palette: Palette;
}) {
  const [provider, setProvider] = useState<ModelEntry["provider"]>("claude");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434/v1");
  const [expanded, setExpanded] = useState(false);
  const height = useRef(new Animated.Value(0)).current;

  const [openRouterTop, setOpenRouterTop] = useState<OpenRouterModel[] | null>(
    openRouterTopCache?.models ?? null
  );
  const [openRouterLoading, setOpenRouterLoading] = useState(false);
  const [openRouterError, setOpenRouterError] = useState<string | null>(null);

  useEffect(() => {
    if (provider !== "openrouter") return;
    if (openRouterTopCache && openRouterTopCache.models.length > 0) {
      setOpenRouterTop(openRouterTopCache.models);
      return;
    }
    let cancelled = false;
    setOpenRouterLoading(true);
    setOpenRouterError(null);
    fetchOpenRouterTopCoding()
      .then((models) => {
        if (!cancelled) setOpenRouterTop(models);
      })
      .catch((err) => {
        if (!cancelled) {
          setOpenRouterError(err?.message ?? "Failed to load");
          setOpenRouterTop(OPENROUTER_FALLBACK);
        }
      })
      .finally(() => {
        if (!cancelled) setOpenRouterLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    Animated.spring(height, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: false,
      tension: 70,
      friction: 12,
    }).start();
  }, [expanded]);

  const onProviderChange = (p: ModelEntry["provider"]) => {
    setProvider(p);
    const existing = existingEntries.find((e) => e.provider === p && e.apiKey);
    if (existing) setApiKey(existing.apiKey);
    if (p === "local") {
      const existingLocal = existingEntries.find((e) => e.provider === "local" && e.endpoint);
      if (existingLocal?.endpoint) setEndpoint(existingLocal.endpoint);
    }
  };

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      id: makeId(),
      provider,
      name: name.trim(),
      apiKey: apiKey.trim(),
      enabled: true,
      ...(provider === "local" ? { endpoint: endpoint.trim() || "http://127.0.0.1:11434/v1" } : {}),
    });
    setName("");
    setApiKey("");
    setExpanded(false);
  };

  return (
    <View>
      <TouchableBounce sensory onPress={() => setExpanded((e) => !e)}>
        <View
          style={{
            paddingVertical: 16,
            paddingHorizontal: 18,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: palette.accent,
              fontSize: 14,
              fontWeight: "600",
              letterSpacing: 0.2,
            }}
          >
            {expanded ? "Cancel" : "Add a model"}
          </Text>
        </View>
      </TouchableBounce>

      <Animated.View
        style={{
          overflow: "hidden",
          maxHeight: height.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 560],
          }),
          opacity: height,
        }}
      >
        <View style={{ padding: 18, paddingTop: 4, gap: 14 }}>
          <Segmented
            options={PROVIDERS}
            value={provider}
            onChange={onProviderChange}
            palette={palette}
          />

          {provider === "openrouter" && (
            <View style={{ gap: 10 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: palette.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: 1.2,
                  }}
                >
                  Top coding models this week
                </Text>
                {openRouterLoading && (
                  <Text style={{ fontSize: 11, color: palette.textSoft }}>
                    loading
                  </Text>
                )}
                {openRouterError && (
                  <Text style={{ fontSize: 11, color: palette.textSoft }}>
                    offline
                  </Text>
                )}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingRight: 8 }}
              >
                {(openRouterTop ?? []).map((m) => {
                  const selected = name === m.id;
                  return (
                    <TouchableBounce
                      key={m.id}
                      sensory
                      onPress={() => setName(m.id)}
                    >
                      <View
                        style={{
                          paddingVertical: 9,
                          paddingHorizontal: 14,
                          borderRadius: 999,
                          backgroundColor: selected
                            ? palette.text
                            : palette.surfaceAlt,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "600",
                            color: selected ? palette.surface : palette.text,
                          }}
                        >
                          {m.label}
                        </Text>
                      </View>
                    </TouchableBounce>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <Field
            placeholder={
              provider === "claude"
                ? "Model name, e.g. claude-opus-4-5"
                : provider === "openrouter"
                ? "Model name, e.g. anthropic/claude-3.5-sonnet"
                : "Model name or path"
            }
            value={name}
            onChangeText={setName}
            palette={palette}
          />

          {provider !== "local" ? (
            <Field
              placeholder={
                provider === "claude"
                  ? "Anthropic API key"
                  : "OpenRouter API key"
              }
              value={apiKey}
              onChangeText={setApiKey}
              palette={palette}
              secureTextEntry
            />
          ) : (
            <>
              <Field
                placeholder="Endpoint, e.g. http://127.0.0.1:11434/v1"
                value={endpoint}
                onChangeText={setEndpoint}
                palette={palette}
                keyboardType="url"
              />
              <Text
                style={{
                  color: palette.textSoft,
                  fontSize: 12,
                  lineHeight: 17,
                  marginTop: -4,
                  marginLeft: 4,
                }}
              >
                OpenAI-compatible URL for Ollama, LM Studio, llama.cpp, etc.
                The backend reaches this from its own host — use your Mac's
                LAN IP (not 127.0.0.1) when the backend runs on a different
                machine.
              </Text>
            </>
          )}

          <TouchableBounce sensory onPress={handleAdd}>
            <View
              style={{
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
                backgroundColor: name.trim() ? palette.text : palette.surfaceAlt,
                marginTop: 4,
              }}
            >
              <Text
                style={{
                  color: name.trim() ? palette.surface : palette.textSoft,
                  fontWeight: "600",
                  fontSize: 15,
                  letterSpacing: 0.2,
                }}
              >
                Add to queue
              </Text>
            </View>
          </TouchableBounce>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function Card({
  children,
  palette,
}: {
  children: React.ReactNode;
  palette: Palette;
}) {
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: 16,
      }}
    >
      {children}
    </View>
  );
}

// ─── Toggle row ─────────────────────────────────────────────────────────────

function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  palette,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  palette: Palette;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 16,
        paddingHorizontal: 20,
        gap: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: palette.text,
            fontSize: 15,
            fontWeight: "600",
            letterSpacing: 0.1,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            color: palette.textMuted,
            fontSize: 13,
            marginTop: 4,
            lineHeight: 18,
          }}
        >
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: palette.text, false: palette.surfaceAlt }}
        thumbColor={palette.surface}
        ios_backgroundColor={palette.surfaceAlt}
      />
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const { settings, _hasHydrated } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);

  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [bearerToken, setBearerToken] = useState(settings.bearerToken);
  const [connStatus, setConnStatus] = useState<"idle" | "ok" | "error">("idle");
  const [connMessage, setConnMessage] = useState<string | null>(null);
  const [autoCompact, setAutoCompact] = useState(settings.autoCompact ?? true);
  const [streamingEnabled, setStreamingEnabled] = useState(
    settings.streamingEnabled ?? true
  );
  const [darkMode, setDarkMode] = useState<"system" | "light" | "dark">(
    settings.darkMode ?? "system"
  );
  const [accentTheme, setAccentTheme] = useState<AccentTheme>(
    settings.accentTheme ?? "lavender"
  );
  const [autoCompactThreshold, setAutoCompactThreshold] = useState<number>(
    settings.autoCompactThreshold ?? 70
  );
  const [telemetryEnabled, setTelemetryEnabled] = useState(
    settings.telemetryEnabled ?? true
  );
  const [autoContinueEnabled, setAutoContinueEnabled] = useState(
    settings.autoContinueEnabled ?? true
  );
  const [obsidianEnabled, setObsidianEnabled] = useState(
    settings.obsidianVault?.enabled ?? false
  );
  const [obsidianProvider, setObsidianProvider] = useState<"backend" | "local">(
    settings.obsidianVault?.provider ?? "backend"
  );
  const [obsidianPath, setObsidianPath] = useState(
    settings.obsidianVault?.path ?? ""
  );
  const [obsidianLocalUri, setObsidianLocalUri] = useState(
    settings.obsidianVault?.localDirectoryUri ?? ""
  );
  const [obsidianLocalDisplay, setObsidianLocalDisplay] = useState(
    settings.obsidianVault?.localDisplayPath ?? ""
  );
  const [obsidianUseForMemory, setObsidianUseForMemory] = useState(
    settings.obsidianVault?.useForMemory ?? true
  );
  const [obsidianUseForReference, setObsidianUseForReference] = useState(
    settings.obsidianVault?.useForReference ?? true
  );
  const [obsidianStatus, setObsidianStatus] = useState<"idle" | "ok" | "error">(
    "idle"
  );
  const [obsidianMessage, setObsidianMessage] = useState<string | null>(null);
  const [obsidianChecking, setObsidianChecking] = useState(false);
  const [saved, setSaved] = useState(false);

  const effectiveScheme =
    darkMode === "system" ? scheme ?? "light" : darkMode;
  const palette = useMemo<Palette>(() => {
    const base = effectiveScheme === "dark" ? DARK : LIGHT;
    const accent =
      ACCENTS[accentTheme][effectiveScheme === "dark" ? "dark" : "light"];
    return { ...base, accent };
  }, [effectiveScheme, accentTheme]);

  const buildQueue = (s: typeof settings): ModelEntry[] => {
    if (s.modelQueue && s.modelQueue.length > 0) return s.modelQueue;
    if (s.model) {
      return [
        {
          id: makeId(),
          provider: s.model.provider,
          name: s.model.name,
          apiKey: s.model.apiKey,
          enabled: true,
        },
      ];
    }
    return [];
  };

  const [queue, setQueue] = useState<ModelEntry[]>(() => buildQueue(settings));

  useEffect(() => {
    if (!_hasHydrated) return;
    setServerUrl(settings.serverUrl);
    setBearerToken(settings.bearerToken);
    setAutoCompact(settings.autoCompact ?? true);
    setStreamingEnabled(settings.streamingEnabled ?? true);
    setDarkMode(settings.darkMode ?? "system");
    setAccentTheme(settings.accentTheme ?? "lavender");
    setAutoCompactThreshold(settings.autoCompactThreshold ?? 70);
    setTelemetryEnabled(settings.telemetryEnabled ?? true);
    setAutoContinueEnabled(settings.autoContinueEnabled ?? true);
    setObsidianEnabled(settings.obsidianVault?.enabled ?? false);
    setObsidianProvider(settings.obsidianVault?.provider ?? "backend");
    setObsidianPath(settings.obsidianVault?.path ?? "");
    setObsidianLocalUri(settings.obsidianVault?.localDirectoryUri ?? "");
    setObsidianLocalDisplay(settings.obsidianVault?.localDisplayPath ?? "");
    setObsidianUseForMemory(settings.obsidianVault?.useForMemory ?? true);
    setObsidianUseForReference(settings.obsidianVault?.useForReference ?? true);
    setQueue(buildQueue(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_hasHydrated]);

  const save = () => {
    actions.setSettings({
      serverUrl,
      bearerToken,
      modelQueue: queue,
      autoCompact,
      streamingEnabled,
      darkMode,
      accentTheme,
      autoCompactThreshold,
      telemetryEnabled,
      autoContinueEnabled,
      obsidianVault: {
        enabled: obsidianEnabled,
        provider: obsidianProvider,
        path: obsidianPath.trim(),
        localDirectoryUri: obsidianLocalUri,
        localDisplayPath: obsidianLocalDisplay,
        useForMemory: obsidianUseForMemory,
        useForReference: obsidianUseForReference,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const validateObsidianBackend = async () => {
    if (!serverUrl || !bearerToken) {
      setObsidianMessage("Set server URL and token first.");
      setObsidianStatus("error");
      return;
    }
    if (!obsidianPath.trim()) {
      setObsidianMessage("Enter a vault path first.");
      setObsidianStatus("error");
      return;
    }
    setObsidianChecking(true);
    setObsidianStatus("idle");
    setObsidianMessage(null);
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/obsidian/validate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: obsidianPath.trim() }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setObsidianMessage(data.reason ?? data.error ?? `Server returned ${res.status}`);
        setObsidianStatus("error");
      } else {
        const n = data.noteCount ?? 0;
        setObsidianMessage(
          `Connected — ${n} note${n === 1 ? "" : "s"} found` +
            (data.resolvedPath ? ` at ${data.resolvedPath}` : "")
        );
        setObsidianStatus("ok");
        setObsidianEnabled(true);
      }
    } catch (err: any) {
      setObsidianMessage(err.message ?? "Validation failed");
      setObsidianStatus("error");
    } finally {
      setObsidianChecking(false);
    }
  };

  const pickLocalVault = async () => {
    setObsidianChecking(true);
    setObsidianStatus("idle");
    setObsidianMessage(null);
    try {
      const pick = await pickVaultDirectory();
      if (!pick.ok) {
        setObsidianMessage(pick.reason);
        setObsidianStatus("error");
        return;
      }
      const check = await validateLocalVault(pick.directoryUri);
      if (!check.ok) {
        setObsidianMessage(check.reason);
        setObsidianStatus("error");
        return;
      }
      setObsidianLocalUri(pick.directoryUri);
      setObsidianLocalDisplay(pick.displayPath);
      setObsidianMessage(
        `Connected — ${check.noteCount} note${check.noteCount === 1 ? "" : "s"} found at ${pick.displayPath}`
      );
      setObsidianStatus("ok");
      setObsidianEnabled(true);
    } catch (err: any) {
      setObsidianMessage(err?.message ?? "Picker failed");
      setObsidianStatus("error");
    } finally {
      setObsidianChecking(false);
    }
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
    setQueue((q) =>
      q.map((e, idx) => (idx === i ? { ...e, enabled: !e.enabled } : e))
    );

  const deleteEntry = (i: number) =>
    setQueue((q) => q.filter((_, idx) => idx !== i));

  const addEntry = (entry: ModelEntry) => setQueue((q) => [...q, entry]);

  const enabledCount = queue.filter((e) => e.enabled).length;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Settings",
          headerTransparent: false,
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: palette.bg },
          headerTitleStyle: { color: palette.text, fontWeight: "600" },
          headerTintColor: palette.accent,
          contentStyle: { backgroundColor: palette.bg },
        }}
      />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingTop: 20,
          paddingBottom: 60,
        }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text
          style={{
            color: palette.textMuted,
            fontSize: 14,
            lineHeight: 20,
            marginBottom: 28,
            marginLeft: 4,
            marginRight: 4,
          }}
        >
          Connection, models, and the small preferences that shape how Claw
          behaves.
        </Text>

        {/* ── Connection ───────────────────────────────────────── */}
        <SectionHeader title="Connection" palette={palette} />
        <Card palette={palette}>
          <View style={{ padding: 18, gap: 12 }}>
            <Field
              placeholder="Server URL"
              value={serverUrl}
              onChangeText={setServerUrl}
              palette={palette}
              keyboardType="url"
            />
            <Field
              placeholder="Bearer token"
              value={bearerToken}
              onChangeText={setBearerToken}
              palette={palette}
              secureTextEntry
            />
            <TouchableBounce sensory onPress={testConnection}>
              <View
                style={{
                  borderRadius: 12,
                  paddingVertical: 13,
                  alignItems: "center",
                  backgroundColor: palette.surfaceAlt,
                }}
              >
                <Text
                  style={{
                    color: palette.text,
                    fontWeight: "600",
                    fontSize: 14,
                    letterSpacing: 0.2,
                  }}
                >
                  Test connection
                </Text>
              </View>
            </TouchableBounce>
            {connMessage && (
              <Text
                style={{
                  color:
                    connStatus === "ok" ? palette.success : palette.danger,
                  fontSize: 13,
                  marginTop: 2,
                }}
              >
                {connMessage}
              </Text>
            )}
          </View>
        </Card>

        <View style={{ height: 32 }} />

        {/* ── Appearance ───────────────────────────────────────── */}
        <SectionHeader title="Appearance" palette={palette} />
        <Card palette={palette}>
          <View style={{ padding: 18, gap: 14 }}>
            <Segmented
              options={[
                { key: "system", label: "System" },
                { key: "light", label: "Light" },
                { key: "dark", label: "Dark" },
              ]}
              value={darkMode}
              onChange={(k) => setDarkMode(k as "system" | "light" | "dark")}
              palette={palette}
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
                  onChange={setAccentTheme}
                  palette={palette}
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
        <Caption palette={palette}>
          {darkMode === "system"
            ? "Follows your device's appearance automatically."
            : darkMode === "dark"
            ? "Always use a dark background with light text."
            : "Always use a light background with dark text."}
          {" "}
          {accentTheme === "lavender"
            ? "Lavender accent."
            : "Terracotta accent — the original warm tone."}
        </Caption>

        <View style={{ height: 32 }} />

        {/* ── Model Queue ──────────────────────────────────────── */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            marginLeft: 4,
            marginRight: 4,
          }}
        >
          <Text
            style={{
              color: palette.textMuted,
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            Models
          </Text>
          {queue.length > 0 && (
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 12,
                fontWeight: "500",
                letterSpacing: 0.4,
              }}
            >
              {enabledCount} of {queue.length} active
            </Text>
          )}
        </View>

        <Card palette={palette}>
          {queue.length === 0 ? (
            <View style={{ paddingVertical: 32, alignItems: "center" }}>
              <Text
                style={{
                  color: palette.textSoft,
                  fontSize: 14,
                  fontWeight: "500",
                }}
              >
                No models yet
              </Text>
            </View>
          ) : (
            queue.map((entry, i) => (
              <View key={entry.id}>
                {i > 0 && <Hairline palette={palette} inset={18} />}
                <QueueRow
                  entry={entry}
                  index={i}
                  total={queue.length}
                  onToggle={() => toggleEntry(i)}
                  onDelete={() => deleteEntry(i)}
                  onMoveUp={() => moveUp(i)}
                  onMoveDown={() => moveDown(i)}
                  palette={palette}
                />
              </View>
            ))
          )}
          {queue.length > 0 && <Hairline palette={palette} inset={18} />}
          <AddModelForm
            existingEntries={queue}
            onAdd={addEntry}
            palette={palette}
          />
        </Card>
        <Caption palette={palette}>
          Models are tried top to bottom. If one fails, the next takes over
          automatically.
        </Caption>

        <View style={{ height: 32 }} />

        {/* ── Behaviour ────────────────────────────────────────── */}
        <SectionHeader title="Behaviour" palette={palette} />
        <Card palette={palette}>
          <ToggleRow
            title="Auto-compact"
            description="Summarise the conversation when the context window fills up and retry automatically."
            value={autoCompact}
            onValueChange={setAutoCompact}
            palette={palette}
          />
          {autoCompact && (
            <>
              <Hairline palette={palette} inset={20} />
              <View style={{ padding: 18, gap: 12 }}>
                <View style={{ gap: 4 }}>
                  <Text
                    style={{
                      color: palette.text,
                      fontSize: 15,
                      fontWeight: "600",
                      letterSpacing: 0.1,
                    }}
                  >
                    Compact threshold
                  </Text>
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 13,
                      lineHeight: 18,
                    }}
                  >
                    Compact the conversation when the last turn used at least
                    this much of the model's context window.
                  </Text>
                </View>
                <Segmented
                  options={[
                    { key: "50", label: "50%" },
                    { key: "60", label: "60%" },
                    { key: "70", label: "70%" },
                    { key: "80", label: "80%" },
                    { key: "90", label: "90%" },
                  ]}
                  value={String(autoCompactThreshold)}
                  onChange={(k) => setAutoCompactThreshold(parseInt(k, 10))}
                  palette={palette}
                />
              </View>
            </>
          )}
          <Hairline palette={palette} inset={20} />
          <ToggleRow
            title="Stream responses"
            description="Show words as they arrive. Turn off to display the full reply at once."
            value={streamingEnabled}
            onValueChange={setStreamingEnabled}
            palette={palette}
          />
          <Hairline palette={palette} inset={20} />
          <ToggleRow
            title="Auto-continue truncated replies"
            description="When a turn ends mid-sentence (ends with “:” or “,” etc.), automatically fire one “continue” so the model can finish. Helps with GLM and other models that give up early after tool-heavy turns."
            value={autoContinueEnabled}
            onValueChange={setAutoContinueEnabled}
            palette={palette}
          />
          <Hairline palette={palette} inset={20} />
          <ToggleRow
            title="Diagnostic telemetry"
            description="Mirror every SSE event the client receives to the backend events table. Used to diff what the server sent against what the client rendered."
            value={telemetryEnabled}
            onValueChange={setTelemetryEnabled}
            palette={palette}
          />
        </Card>

        <View style={{ height: 32 }} />

        {/* ── Obsidian vault ──────────────────────────────────── */}
        <SectionHeader title="Obsidian Vault" palette={palette} />
        <Card palette={palette}>
          <View style={{ padding: 18, gap: 14 }}>
            <Segmented
              options={[
                { key: "backend", label: "Backend (VPS)" },
                { key: "local", label: "This device" },
              ]}
              value={obsidianProvider}
              onChange={(k) => {
                setObsidianProvider(k as "backend" | "local");
                setObsidianStatus("idle");
                setObsidianMessage(null);
              }}
              palette={palette}
            />
            {obsidianProvider === "backend" ? (
              <>
                <Field
                  placeholder="Vault path (absolute path on your backend host)"
                  value={obsidianPath}
                  onChangeText={setObsidianPath}
                  palette={palette}
                />
                <TouchableBounce sensory onPress={validateObsidianBackend}>
                  <View
                    style={{
                      borderRadius: 12,
                      paddingVertical: 13,
                      alignItems: "center",
                      backgroundColor: palette.surfaceAlt,
                      opacity: obsidianChecking ? 0.6 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: palette.text,
                        fontWeight: "600",
                        fontSize: 14,
                        letterSpacing: 0.2,
                      }}
                    >
                      {obsidianChecking ? "Checking…" : "Connect vault"}
                    </Text>
                  </View>
                </TouchableBounce>
              </>
            ) : (
              <>
                {obsidianLocalDisplay ? (
                  <View
                    style={{
                      backgroundColor: palette.surfaceAlt,
                      borderRadius: 12,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                    }}
                  >
                    <Text
                      style={{
                        color: palette.textMuted,
                        fontSize: 11,
                        fontWeight: "600",
                        letterSpacing: 1.2,
                        textTransform: "uppercase",
                        marginBottom: 4,
                      }}
                    >
                      Current folder
                    </Text>
                    <Text
                      style={{ color: palette.text, fontSize: 14, fontWeight: "500" }}
                      numberOfLines={2}
                    >
                      {obsidianLocalDisplay}
                    </Text>
                  </View>
                ) : null}
                <TouchableBounce sensory onPress={pickLocalVault}>
                  <View
                    style={{
                      borderRadius: 12,
                      paddingVertical: 13,
                      alignItems: "center",
                      backgroundColor: palette.surfaceAlt,
                      opacity: obsidianChecking ? 0.6 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: palette.text,
                        fontWeight: "600",
                        fontSize: 14,
                        letterSpacing: 0.2,
                      }}
                    >
                      {obsidianChecking
                        ? "Checking…"
                        : obsidianLocalUri
                        ? "Pick different folder"
                        : "Pick vault folder"}
                    </Text>
                  </View>
                </TouchableBounce>
                <Text
                  style={{
                    color: palette.textSoft,
                    fontSize: 12,
                    lineHeight: 17,
                  }}
                >
                  Read-only: the agent sees your vault as context but can't
                  write back to this device. For memory write-back, use the
                  backend provider.
                </Text>
              </>
            )}
            {obsidianMessage && (
              <Text
                style={{
                  color:
                    obsidianStatus === "ok" ? palette.success : palette.danger,
                  fontSize: 13,
                  marginTop: 2,
                }}
              >
                {obsidianMessage}
              </Text>
            )}
          </View>
          <Hairline palette={palette} inset={20} />
          <ToggleRow
            title="Enable Obsidian integration"
            description="Let the AI read and write your vault for memory and reference. Auto-enabled once a vault connects; toggle off to pause without losing the path."
            value={obsidianEnabled}
            onValueChange={setObsidianEnabled}
            palette={palette}
          />
          {obsidianEnabled && (
            <>
              <Hairline palette={palette} inset={20} />
              <ToggleRow
                title="Use for memory"
                description={
                  obsidianProvider === "backend"
                    ? "Inject notes from claw-code/memory/ as persistent context, and let the AI add or update memory notes there."
                    : "Inject notes from claw-code/memory/ as read-only persistent context."
                }
                value={obsidianUseForMemory}
                onValueChange={setObsidianUseForMemory}
                palette={palette}
              />
              <Hairline palette={palette} inset={20} />
              <ToggleRow
                title="Use for reference"
                description="Let the AI read and search any note in your vault when answering."
                value={obsidianUseForReference}
                onValueChange={setObsidianUseForReference}
                palette={palette}
              />
            </>
          )}
        </Card>
        <Caption palette={palette}>
          {obsidianProvider === "backend"
            ? "Vault lives on your backend host — full read/write. If you have Obsidian Sync, other devices see changes automatically."
            : "Vault lives on this device — read-only. Pick the folder Obsidian stores its vault in."}
        </Caption>

        <View style={{ height: 40 }} />

        {/* ── Save ─────────────────────────────────────────────── */}
        <TouchableBounce sensory onPress={save}>
          <View
            style={{
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              backgroundColor: palette.text,
            }}
          >
            <Text
              style={{
                color: palette.bg,
                fontWeight: "600",
                fontSize: 15,
                letterSpacing: 0.3,
              }}
            >
              {saved ? "Saved" : "Save settings"}
            </Text>
          </View>
        </TouchableBounce>
      </ScrollView>
    </>
  );
}
