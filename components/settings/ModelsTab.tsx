import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { GlassButton } from "@/components/ui/GlassButton";
import { usePalette } from "@/hooks/usePalette";
import {
  type ModelEntry,
  type OAuthTokenSet,
  useGatewayStore,
} from "@/store/gatewayStore";
import {
  Card,
  Field,
  Hairline,
  Segmented,
  isDarkPalette,
  makeId,
} from "./_shared";
import { useSettingsForm } from "./SettingsFormContext";

// ─── Providers ──────────────────────────────────────────────────────────────

const PROVIDERS = [
  { key: "claude" as const, label: "Claude" },
  { key: "openrouter" as const, label: "OpenRouter" },
  { key: "local" as const, label: "Local" },
];

const AUTH_METHODS = [
  { key: "apiKey" as const, label: "API Key" },
  { key: "oauth" as const, label: "OAuth" },
];

type OpenRouterModel = { id: string; label: string };
type ClaudeModel = { id: string; label: string };

const OPENROUTER_TOP_ENDPOINT =
  "https://openrouter.ai/api/frontend/models/find?category=programming&order=top-weekly";

const OPENROUTER_FALLBACK: OpenRouterModel[] = [
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "anthropic/claude-opus-4", label: "Claude Opus 4" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

const CLAUDE_FALLBACK: ClaudeModel[] = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
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

let claudeModelsCache: { models: ClaudeModel[]; fetchedAt: number } | null =
  null;
const CLAUDE_CACHE_TTL_MS = 1000 * 60 * 60;

async function fetchClaudeModels(apiKey: string): Promise<ClaudeModel[]> {
  if (
    claudeModelsCache &&
    Date.now() - claudeModelsCache.fetchedAt < CLAUDE_CACHE_TTL_MS
  ) {
    return claudeModelsCache.models;
  }
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const json = (await res.json()) as {
    data?: { id?: string; display_name?: string }[];
  };
  const raw = json.data ?? [];
  const models: ClaudeModel[] = raw
    .filter(
      (m): m is { id: string; display_name?: string } =>
        typeof m.id === "string" && m.id.length > 0
    )
    .map((m) => ({
      id: m.id,
      label: m.display_name || m.id,
    }));
  if (models.length === 0) throw new Error("Anthropic returned empty list");
  claudeModelsCache = { models, fetchedAt: Date.now() };
  return models;
}

// ─── Queue row ──────────────────────────────────────────────────────────────

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
  const palette = usePalette();
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const providerLabel =
    PROVIDERS.find((p) => p.key === entry.provider)?.label ?? "";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 18,
        gap: 12,
        opacity: entry.enabled ? 1 : 0.5,
      }}
    >
      {total > 1 && (
        <View style={{ gap: 2 }}>
          <TouchableBounce onPress={onMoveUp} disabled={isFirst} sensory>
            <View style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
              <IconSymbol
                name="chevron.up"
                color={isFirst ? palette.divider : palette.textMuted}
                size={12}
              />
            </View>
          </TouchableBounce>
          <TouchableBounce onPress={onMoveDown} disabled={isLast} sensory>
            <View style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
              <IconSymbol
                name="chevron.down"
                color={isLast ? palette.divider : palette.textMuted}
                size={12}
              />
            </View>
          </TouchableBounce>
        </View>
      )}

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
            : entry.authMethod === "oauth" && entry.oauthToken
            ? "  ·  OAuth"
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
  expanded,
  onExpandedChange,
}: {
  existingEntries: ModelEntry[];
  onAdd: (entry: ModelEntry) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const palette = usePalette();
  const setExpanded = onExpandedChange;
  const [provider, setProvider] = useState<ModelEntry["provider"]>("claude");
  const [authMethod, setAuthMethod] = useState<"apiKey" | "oauth">(() =>
    existingEntries.some(
      (e) => e.provider === "claude" && e.authMethod === "oauth"
    )
      ? "oauth"
      : "apiKey"
  );
  const [name, setName] = useState(CLAUDE_FALLBACK[0]?.id ?? "");
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [apiKey, setApiKey] = useState(
    () =>
      existingEntries.find((e) => e.provider === "claude" && e.apiKey)
        ?.apiKey ?? ""
  );
  // Seed true when a saved key was pre-loaded so the model picker shows on reload without re-focusing the field.
  const [apiKeyBlurred, setApiKeyBlurred] = useState(
    () => apiKey.trim().length > 10
  );
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434/v1");
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthToken, setOauthToken] = useState<OAuthTokenSet | null>(
    () =>
      existingEntries.find(
        (e) =>
          e.provider === "claude" && e.authMethod === "oauth" && e.oauthToken
      )?.oauthToken ?? null
  );
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthPendingState, setOauthPendingState] = useState<string | null>(
    null
  );
  const [oauthCode, setOauthCode] = useState("");

  const [claudeModels, setClaudeModels] = useState<ClaudeModel[] | null>(
    claudeModelsCache?.models ?? null
  );
  const [claudeModelsLoading, setClaudeModelsLoading] = useState(false);
  const [, setClaudeModelsError] = useState<string | null>(null);

  const claudeKey =
    provider === "claude"
      ? apiKey.trim() ||
        existingEntries.find((e) => e.provider === "claude" && e.apiKey)
          ?.apiKey ||
        ""
      : "";
  const hasClaudeKey = claudeKey.length > 10;

  useEffect(() => {
    if (provider !== "claude") return;
    if (!hasClaudeKey) {
      setClaudeModels(CLAUDE_FALLBACK);
      setClaudeModelsError(null);
      return;
    }
    if (claudeModelsCache && claudeModelsCache.models.length > 0) {
      setClaudeModels(claudeModelsCache.models);
      return;
    }
    let cancelled = false;
    setClaudeModelsLoading(true);
    setClaudeModelsError(null);
    fetchClaudeModels(claudeKey)
      .then((models) => {
        if (!cancelled) setClaudeModels(models);
      })
      .catch((err) => {
        if (!cancelled) {
          setClaudeModelsError(err?.message ?? "Failed to load");
          setClaudeModels(CLAUDE_FALLBACK);
        }
      })
      .finally(() => {
        if (!cancelled) setClaudeModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, hasClaudeKey]);

  const [openRouterTop, setOpenRouterTop] = useState<OpenRouterModel[] | null>(
    openRouterTopCache?.models ?? null
  );
  const [openRouterLoading, setOpenRouterLoading] = useState(false);
  const [openRouterError, setOpenRouterError] = useState<string | null>(null);

  type DiscoveredLocalModel = {
    name: string;
    sizeBytes?: number;
    parameterSize?: string;
    quantization?: string;
    endpoint: string;
    runner: string;
  };
  const [localHostMode, setLocalHostMode] = useState<"current" | "other">(
    "current"
  );
  const [localModels, setLocalModels] = useState<DiscoveredLocalModel[] | null>(
    null
  );
  const [localDiscovering, setLocalDiscovering] = useState(false);
  const [localDiscoverError, setLocalDiscoverError] = useState<string | null>(
    null
  );

  const discoverLocalModels = async () => {
    const settings = useGatewayStore.getState().settings;
    const serverUrl = settings.serverUrl?.replace(/\/+$/, "");
    const token = settings.bearerToken;
    if (!serverUrl || !token) {
      setLocalDiscoverError("Configure server connection first.");
      return;
    }
    let body: { baseUrl?: string } = {};
    if (localHostMode === "other") {
      const raw = endpoint.trim();
      if (!raw) {
        setLocalDiscoverError("Enter a URL first.");
        return;
      }
      body = { baseUrl: raw.replace(/\/v1\/?$/, "").replace(/\/+$/, "") };
    }
    setLocalDiscovering(true);
    setLocalDiscoverError(null);
    try {
      const res = await fetch(`${serverUrl}/local-models/discover`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setLocalDiscoverError(
          data?.error ?? `Server returned ${res.status}`
        );
        setLocalModels(null);
      } else {
        const flat: DiscoveredLocalModel[] = [];
        for (const r of data.runners ?? []) {
          for (const m of r.models ?? []) {
            flat.push({ ...m, endpoint: r.endpoint, runner: r.runner });
          }
        }
        setLocalModels(flat);
      }
    } catch (err: any) {
      setLocalDiscoverError(err?.message ?? "Discovery failed");
      setLocalModels(null);
    } finally {
      setLocalDiscovering(false);
    }
  };

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

  const onProviderChange = (p: ModelEntry["provider"]) => {
    setProvider(p);
    setUseCustomModel(false);
    setAuthMethod("apiKey");
    setOauthToken(null);
    setOauthError(null);
    setOauthPendingState(null);
    setOauthCode("");
    if (p === "claude") {
      setName(CLAUDE_FALLBACK[0]?.id ?? "");
    } else {
      setName("");
    }
    const existing = existingEntries.find((e) => e.provider === p && e.apiKey);
    const existingKey = existing?.apiKey ?? "";
    setApiKey(existingKey);
    setApiKeyBlurred(existingKey.trim().length > 10);
    if (p === "local") {
      const existingLocal = existingEntries.find(
        (e) => e.provider === "local" && e.endpoint
      );
      if (existingLocal?.endpoint) setEndpoint(existingLocal.endpoint);
    }
  };

  const startOAuthFlow = async () => {
    const settings = useGatewayStore.getState().settings;
    const baseUrl = settings.serverUrl?.replace(/\/+$/, "");
    const token = settings.bearerToken;
    if (!baseUrl || !token) {
      setOauthError("Configure server connection first");
      return;
    }

    setOauthLoading(true);
    setOauthError(null);
    setOauthCode("");
    try {
      const authRes = await fetch(`${baseUrl}/oauth/authorize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!authRes.ok) throw new Error(`Server returned ${authRes.status}`);
      const { url, state } = (await authRes.json()) as {
        url: string;
        state: string;
      };

      const { Linking: RNLinking } = require("react-native");
      RNLinking.openURL(url);

      setOauthPendingState(state);
      setOauthLoading(false);
    } catch (err: any) {
      setOauthLoading(false);
      setOauthError(err.message ?? "Failed to start OAuth flow");
    }
  };

  const submitOAuthCode = async () => {
    if (!oauthCode.trim() || !oauthPendingState) return;
    const settings = useGatewayStore.getState().settings;
    const baseUrl = settings.serverUrl?.replace(/\/+$/, "");
    const token = settings.bearerToken;
    if (!baseUrl || !token) return;

    setOauthLoading(true);
    setOauthError(null);
    try {
      const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: oauthCode.trim(),
          state: oauthPendingState,
        }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(
          (err as any).error ?? `Token exchange failed (${tokenRes.status})`
        );
      }
      const tokens = (await tokenRes.json()) as OAuthTokenSet;
      setOauthToken(tokens);
      setOauthPendingState(null);
      setOauthCode("");
      setOauthError(null);
    } catch (err: any) {
      setOauthError(err.message ?? "OAuth failed");
    } finally {
      setOauthLoading(false);
    }
  };

  const handleAdd = () => {
    if (!name.trim()) return;
    if (provider === "claude" && authMethod === "oauth" && !oauthToken) return;
    const effectiveApiKey =
      provider === "local"
        ? apiKey.trim() || "local-dev-token"
        : apiKey.trim();
    onAdd({
      id: makeId(),
      provider,
      name: name.trim(),
      apiKey: effectiveApiKey,
      enabled: true,
      authMethod:
        provider === "claude" && authMethod === "oauth" ? "oauth" : undefined,
      oauthToken:
        provider === "claude" && authMethod === "oauth"
          ? oauthToken ?? undefined
          : undefined,
      ...(provider === "local"
        ? { endpoint: endpoint.trim() || "http://127.0.0.1:11434/v1" }
        : {}),
    });
    onProviderChange("claude");
    setExpanded(false);
  };

  const candidateEndpoint =
    provider === "local"
      ? endpoint.trim() || "http://127.0.0.1:11434/v1"
      : "";
  const isDuplicate = !!(
    name.trim() &&
    existingEntries.some(
      (e) =>
        e.provider === provider &&
        e.name === name.trim() &&
        (e.endpoint ?? "") === candidateEndpoint
    )
  );

  const canAdd =
    !isDuplicate &&
    !!(
      name.trim() &&
      (provider === "local" ||
        (provider === "claude" &&
          authMethod === "apiKey" &&
          apiKeyBlurred &&
          hasClaudeKey) ||
        (provider === "claude" && authMethod === "oauth" && oauthToken) ||
        (provider === "openrouter" &&
          apiKeyBlurred &&
          apiKey.trim().length > 10))
    );

  if (!expanded) return null;

  return (
    <View style={{ padding: 18, paddingTop: 4, gap: 14 }}>
      <Segmented
        options={PROVIDERS}
        value={provider}
        onChange={onProviderChange}
      />

      {/* ── Claude auth + model selection ─────────────────── */}
      {provider === "claude" && (
        <>
          <Segmented
            options={AUTH_METHODS}
            value={authMethod}
            onChange={(m) => {
              setAuthMethod(m);
              setOauthToken(null);
              setOauthError(null);
              setOauthPendingState(null);
              setOauthCode("");
            }}
          />

          {authMethod === "apiKey" && (
            <View style={{ gap: 6 }}>
              <Field
                placeholder="Anthropic API key"
                value={apiKey}
                onChangeText={(v) => {
                  setApiKey(v);
                  setApiKeyBlurred(false);
                }}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={() => setApiKeyBlurred(true)}
                onEndEditing={() => setApiKeyBlurred(true)}
              />
              {apiKeyBlurred &&
                apiKey.trim().length > 0 &&
                !hasClaudeKey && (
                  <Text
                    style={{
                      color: palette.danger,
                      fontSize: 12,
                      marginLeft: 4,
                    }}
                  >
                    Invalid API key
                  </Text>
                )}
            </View>
          )}

          {authMethod === "oauth" && (
            <Text
              style={{
                color: palette.textSoft,
                fontSize: 12,
                lineHeight: 17,
                marginHorizontal: 2,
              }}
            >
              Due to an Anthropic policy update, OAuth models run through the
              official Claude Code CLI. Your Claw instructions, CLAUDE.md
              files, and project context are still used.
            </Text>
          )}

          {authMethod === "oauth" && (
            <View style={{ gap: 10 }}>
              {oauthToken ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: palette.surfaceAlt,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 3.5,
                      backgroundColor: palette.success,
                      marginRight: 8,
                    }}
                  />
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 14,
                      flex: 1,
                    }}
                  >
                    Signed in
                  </Text>
                  <TouchableBounce
                    sensory
                    onPress={() => {
                      setOauthToken(null);
                      setOauthError(null);
                    }}
                  >
                    <Text
                      style={{
                        color: palette.danger,
                        fontSize: 13,
                        fontWeight: "500",
                        paddingLeft: 12,
                      }}
                    >
                      Sign out
                    </Text>
                  </TouchableBounce>
                </View>
              ) : oauthPendingState ? (
                <View style={{ gap: 10 }}>
                  <Text
                    style={{
                      color: palette.textMuted,
                      fontSize: 13,
                      lineHeight: 18,
                    }}
                  >
                    Paste the authorization code shown after you approve
                    access.
                  </Text>
                  <Field
                    placeholder="Authorization code"
                    value={oauthCode}
                    onChangeText={setOauthCode}
                  />
                  <GlassButton
                    onPress={submitOAuthCode}
                    disabled={!oauthCode.trim() || oauthLoading}
                    style={{
                      borderRadius: 12,
                      paddingVertical: 14,
                      width: "100%",
                      opacity:
                        oauthCode.trim() && !oauthLoading ? 1 : 0.4,
                    }}
                  >
                    {oauthLoading ? (
                      <ActivityIndicator color={palette.text} size="small" />
                    ) : (
                      <Text
                        style={{
                          color: palette.text,
                          fontWeight: "600",
                          fontSize: 14,
                        }}
                      >
                        Submit code
                      </Text>
                    )}
                  </GlassButton>
                  <TouchableBounce
                    sensory
                    onPress={() => {
                      setOauthPendingState(null);
                      setOauthCode("");
                      setOauthError(null);
                    }}
                  >
                    <View
                      style={{ paddingVertical: 6, alignItems: "center" }}
                    >
                      <Text
                        style={{
                          color: palette.textMuted,
                          fontSize: 13,
                          fontWeight: "500",
                        }}
                      >
                        Cancel
                      </Text>
                    </View>
                  </TouchableBounce>
                </View>
              ) : (
                <GlassButton
                  onPress={startOAuthFlow}
                  disabled={oauthLoading}
                  style={{
                    borderRadius: 12,
                    paddingVertical: 14,
                    width: "100%",
                    opacity: oauthLoading ? 0.6 : 1,
                  }}
                >
                  {oauthLoading ? (
                    <ActivityIndicator color={palette.text} size="small" />
                  ) : (
                    <Text
                      style={{
                        color: palette.text,
                        fontWeight: "600",
                        fontSize: 14,
                        letterSpacing: 0.2,
                      }}
                    >
                      Sign in with Anthropic
                    </Text>
                  )}
                </GlassButton>
              )}
              {oauthError && (
                <Text
                  style={{
                    color: palette.danger,
                    fontSize: 13,
                    marginLeft: 4,
                  }}
                >
                  {oauthError}
                </Text>
              )}
            </View>
          )}

          {((apiKeyBlurred && hasClaudeKey) || oauthToken) && (
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
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
                  Model
                </Text>
                {claudeModelsLoading && (
                  <Text
                    style={{ fontSize: 11, color: palette.textSoft }}
                  >
                    loading
                  </Text>
                )}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingRight: 8 }}
              >
                <TouchableBounce
                  sensory
                  onPress={() => {
                    setUseCustomModel(true);
                    setName("");
                  }}
                >
                  <View
                    style={{
                      paddingVertical: 9,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: useCustomModel
                        ? palette.text
                        : palette.surfaceAlt,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: useCustomModel
                          ? palette.surface
                          : palette.textMuted,
                      }}
                    >
                      Custom
                    </Text>
                  </View>
                </TouchableBounce>
                {(claudeModels ?? []).map((m) => {
                  const selected = !useCustomModel && name === m.id;
                  return (
                    <TouchableBounce
                      key={m.id}
                      sensory
                      onPress={() => {
                        setUseCustomModel(false);
                        setName(m.id);
                      }}
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
              {useCustomModel && (
                <Field
                  placeholder="Model ID, e.g. claude-sonnet-4"
                  value={name}
                  onChangeText={setName}
                />
              )}
            </View>
          )}
        </>
      )}

      {/* ── OpenRouter model selection ─────────────────────── */}
      {provider === "openrouter" && (
        <>
          <Field
            placeholder="OpenRouter API key"
            value={apiKey}
            onChangeText={(v) => {
              setApiKey(v);
              setApiKeyBlurred(false);
            }}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={() => setApiKeyBlurred(true)}
            onEndEditing={() => setApiKeyBlurred(true)}
          />
          {apiKeyBlurred &&
            apiKey.trim().length > 0 &&
            apiKey.trim().length <= 10 && (
              <Text
                style={{
                  color: palette.danger,
                  fontSize: 12,
                  marginLeft: 4,
                }}
              >
                Invalid API key
              </Text>
            )}
          {apiKeyBlurred && apiKey.trim().length > 10 && (
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
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
                  <Text
                    style={{ fontSize: 11, color: palette.textSoft }}
                  >
                    loading
                  </Text>
                )}
                {openRouterError && (
                  <Text
                    style={{ fontSize: 11, color: palette.textSoft }}
                  >
                    offline
                  </Text>
                )}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingRight: 8 }}
              >
                <TouchableBounce
                  sensory
                  onPress={() => {
                    setUseCustomModel(true);
                    setName("");
                  }}
                >
                  <View
                    style={{
                      paddingVertical: 9,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: useCustomModel
                        ? palette.text
                        : palette.surfaceAlt,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: useCustomModel
                          ? palette.surface
                          : palette.textMuted,
                      }}
                    >
                      Custom
                    </Text>
                  </View>
                </TouchableBounce>
                {(openRouterTop ?? []).map((m) => {
                  const selected = !useCustomModel && name === m.id;
                  return (
                    <TouchableBounce
                      key={m.id}
                      sensory
                      onPress={() => {
                        setUseCustomModel(false);
                        setName(m.id);
                      }}
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
              {useCustomModel && (
                <Field
                  placeholder="Model ID, e.g. anthropic/claude-sonnet-4"
                  value={name}
                  onChangeText={setName}
                />
              )}
            </View>
          )}
        </>
      )}

      {/* Local provider — pick where the model server lives, then scan. */}
      {provider === "local" && (
        <>
          <Text
            style={{
              color: palette.textSoft,
              fontSize: 12,
              lineHeight: 17,
              marginLeft: 4,
            }}
          >
            Where is the model server?
          </Text>
          <SegmentedControl
            values={["Current backend", "Other"]}
            selectedIndex={localHostMode === "current" ? 0 : 1}
            onChange={(e) => {
              const idx = e.nativeEvent.selectedSegmentIndex;
              setLocalHostMode(idx === 0 ? "current" : "other");
              setLocalModels(null);
              setLocalDiscoverError(null);
            }}
            appearance={isDarkPalette(palette) ? "dark" : "light"}
          />
          <Text
            style={{
              color: palette.textSoft,
              fontSize: 12,
              lineHeight: 17,
              marginTop: -2,
              marginLeft: 4,
            }}
          >
            {localHostMode === "current"
              ? "Scan the same host your backend is running on (Ollama, LM Studio, llama.cpp, vLLM)."
              : "Reach a model server at a custom URL — LAN IP, tunnel, or remote host."}
          </Text>

          {localHostMode === "other" && (
            <Field
              placeholder="http://your-host:11434"
              value={endpoint}
              onChangeText={setEndpoint}
              keyboardType="url"
            />
          )}

          <GlassButton
            onPress={discoverLocalModels}
            disabled={localDiscovering}
            style={{
              borderRadius: 12,
              paddingVertical: 12,
              opacity: localDiscovering ? 0.5 : 1,
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
              {localDiscovering
                ? "Scanning…"
                : localModels
                ? "Rescan"
                : "Scan for models"}
            </Text>
          </GlassButton>

          {localDiscoverError && (
            <Text
              style={{
                color: palette.danger ?? palette.text,
                fontSize: 12,
                marginLeft: 4,
              }}
            >
              {localDiscoverError}
            </Text>
          )}

          {localModels && localModels.length === 0 && (
            <Text
              style={{
                color: palette.textSoft,
                fontSize: 12,
                marginLeft: 4,
              }}
            >
              Runner reachable but no models installed. Run e.g.{" "}
              <Text style={{ color: palette.text, fontWeight: "600" }}>
                ollama pull gpt-oss:20b
              </Text>
              .
            </Text>
          )}

          {localModels && localModels.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: palette.textSoft,
                  fontSize: 12,
                  marginLeft: 4,
                }}
              >
                {localModels.length} model
                {localModels.length === 1 ? "" : "s"} found — tap to select
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingRight: 4 }}
              >
                {localModels.map((m) => {
                  const selected =
                    name === m.name && endpoint === m.endpoint;
                  return (
                    <TouchableBounce
                      key={`${m.runner}:${m.name}`}
                      sensory
                      onPress={() => {
                        setName(m.name);
                        setEndpoint(m.endpoint);
                      }}
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
                          {m.name}
                          {m.parameterSize ? ` · ${m.parameterSize}` : ""}
                        </Text>
                      </View>
                    </TouchableBounce>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </>
      )}

      {/* Add to queue — visible once auth is done and model is selectable */}
      {(canAdd || isDuplicate) && (
        <>
          {isDuplicate && (
            <Text
              style={{
                color: palette.textSoft,
                fontSize: 12,
                marginLeft: 4,
              }}
            >
              Already in queue
            </Text>
          )}
          <GlassButton
            onPress={handleAdd}
            disabled={!canAdd}
            style={{
              borderRadius: 12,
              paddingVertical: 14,
              marginTop: 4,
              width: "100%",
              opacity: canAdd ? 1 : 0.4,
            }}
          >
            <Text
              style={{
                color: palette.text,
                fontWeight: "600",
                fontSize: 15,
                letterSpacing: 0.2,
              }}
            >
              Add to queue
            </Text>
          </GlassButton>
        </>
      )}

      <TouchableBounce
        sensory
        onPress={() => {
          setExpanded(false);
          onProviderChange("claude");
        }}
      >
        <View style={{ paddingVertical: 12, alignItems: "center" }}>
          <Text
            style={{
              color: palette.textMuted,
              fontSize: 14,
              fontWeight: "500",
            }}
          >
            Cancel
          </Text>
        </View>
      </TouchableBounce>
    </View>
  );
}

// ─── Models tab ─────────────────────────────────────────────────────────────

export function ModelsTab() {
  const palette = usePalette();
  const {
    visibleQueue,
    enabledCount,
    addEntry,
    moveUpById,
    moveDownById,
    toggleEntryById,
    deleteEntryById,
    addModelExpanded,
    setAddModelExpanded,
  } = useSettingsForm();

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          marginBottom: 14,
          marginLeft: 4,
          marginRight: 4,
          gap: 12,
        }}
      >
        {visibleQueue.length > 0 && (
          <Text
            style={{
              color: palette.textMuted,
              fontSize: 12,
              fontWeight: "500",
              letterSpacing: 0.4,
              flex: 1,
            }}
          >
            {enabledCount} of {visibleQueue.length} active
          </Text>
        )}
        {!addModelExpanded && (
          <TouchableBounce
            sensory
            onPress={() => setAddModelExpanded(true)}
            hitSlop={10}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: palette.surfaceAlt,
              }}
            >
              <IconSymbol name="plus" color={palette.text} size={14} />
            </View>
          </TouchableBounce>
        )}
      </View>

      <Card>
        {visibleQueue.length === 0 && !addModelExpanded ? (
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
          visibleQueue.map((entry, i) => (
            <View key={entry.id}>
              {i > 0 && <Hairline inset={18} />}
              <QueueRow
                entry={entry}
                index={i}
                total={visibleQueue.length}
                onToggle={() => toggleEntryById(entry.id)}
                onDelete={() => deleteEntryById(entry.id)}
                onMoveUp={() => moveUpById(entry.id)}
                onMoveDown={() => moveDownById(entry.id)}
              />
            </View>
          ))
        )}
        {visibleQueue.length > 0 && addModelExpanded && (
          <Hairline inset={18} />
        )}
        <AddModelForm
          existingEntries={visibleQueue}
          onAdd={addEntry}
          expanded={addModelExpanded}
          onExpandedChange={setAddModelExpanded}
        />
      </Card>
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
        Models are tried top to bottom. If one fails, the next takes over
        automatically.
      </Text>
    </>
  );
}
