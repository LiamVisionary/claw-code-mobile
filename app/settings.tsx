import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { GlassButton } from "@/components/ui/GlassButton";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { type ModelEntry, type OAuthTokenSet, useGatewayStore } from "@/store/gatewayStore";
import {
  buildPalette,
  ACCENT_OPTIONS,
  type AccentTheme,
  type Palette,
} from "@/constants/palette";

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

// ─── Segmented control (native iOS) ─────────────────────────────────────────

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  palette?: Palette;
}) {
  const selectedIndex = options.findIndex((o) => o.key === value);
  return (
    <SegmentedControl
      values={options.map((o) => o.label)}
      selectedIndex={selectedIndex >= 0 ? selectedIndex : 0}
      onChange={(e) => {
        const idx = e.nativeEvent.selectedSegmentIndex;
        if (options[idx]) onChange(options[idx].key);
      }}
    />
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
  onSubmitEditing,
  onEndEditing,
  returnKeyType,
}: {
  placeholder: string;
  value: string;
  onChangeText: (s: string) => void;
  palette: Palette;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "url";
  autoCapitalize?: "none" | "sentences";
  onSubmitEditing?: () => void;
  onEndEditing?: () => void;
  returnKeyType?: "done" | "go" | "next" | "search" | "send";
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
      onSubmitEditing={onSubmitEditing}
      onEndEditing={onEndEditing}
      returnKeyType={returnKeyType}
      blurOnSubmit
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
          {entry.authMethod === "oauth" && entry.oauthToken
            ? "  ·  OAuth"
            : entry.apiKey
            ? `  ·  ···${entry.apiKey.slice(-4)}`
            : entry.provider !== "local"
            ? "  ·  no key"
            : ""}
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

const AUTH_METHODS = [
  { key: "apiKey" as const, label: "API Key" },
  { key: "oauth" as const, label: "OAuth" },
];

type ClaudeModel = { id: string; label: string };

const CLAUDE_FALLBACK: ClaudeModel[] = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

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
  const [authMethod, setAuthMethod] = useState<"apiKey" | "oauth">(
    () => existingEntries.some((e) => e.provider === "claude" && e.authMethod === "oauth") ? "oauth" : "apiKey"
  );
  const [name, setName] = useState(CLAUDE_FALLBACK[0]?.id ?? "");
  const [useCustomModel, setUseCustomModel] = useState(false);
  /** Flipped to true when the user blurs or submits the API key field */
  const [apiKeyBlurred, setApiKeyBlurred] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  // Reuse OAuth token from any existing Claude OAuth entry in the queue
  const [oauthToken, setOauthToken] = useState<OAuthTokenSet | null>(
    () => existingEntries.find((e) => e.provider === "claude" && e.authMethod === "oauth" && e.oauthToken)?.oauthToken ?? null
  );
  const [oauthError, setOauthError] = useState<string | null>(null);
  /** After opening the browser, holds the state param so we can exchange the code */
  const [oauthPendingState, setOauthPendingState] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState("");
  // height animation removed — was causing scroll jumps

  const [claudeModels, setClaudeModels] = useState<ClaudeModel[] | null>(
    claudeModelsCache?.models ?? null
  );
  const [claudeModelsLoading, setClaudeModelsLoading] = useState(false);
  const [claudeModelsError, setClaudeModelsError] = useState<string | null>(null);

  // Fetch Claude models when provider is "claude" and we have a key to auth with.
  // Re-trigger when the API key changes (debounced by checking length threshold).
  const claudeKey =
    provider === "claude"
      ? apiKey.trim() ||
        existingEntries.find((e) => e.provider === "claude" && e.apiKey)?.apiKey ||
        ""
      : "";
  const hasClaudeKey = claudeKey.length > 10; // rough sanity check

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
    setApiKeyBlurred(false);
    setAuthMethod("apiKey");
    setOauthToken(null);
    setOauthError(null);
    setOauthPendingState(null);
    setOauthCode("");
    // Set a sensible default model name per provider
    if (p === "claude") {
      setName(CLAUDE_FALLBACK[0]?.id ?? "");
    } else {
      setName("");
    }
    // Only carry over the API key if switching to a provider that has
    // one saved — and clear it when switching away so Claude keys
    // don't bleed into OpenRouter and vice-versa.
    const existing = existingEntries.find((e) => e.provider === p && e.apiKey);
    setApiKey(existing?.apiKey ?? "");
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

      // Open the browser — the callback page will show the auth code
      const { Linking: RNLinking } = require("react-native");
      RNLinking.openURL(url);

      // Show the code input field
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
    onAdd({
      id: makeId(),
      provider,
      name: name.trim(),
      apiKey: apiKey.trim(),
      enabled: true,
      // For OAuth, store both the API key and the OAuth token so the
      // backend can pass both to the claw binary (ApiKeyAndBearer auth).
      authMethod: provider === "claude" && authMethod === "oauth" ? "oauth" : undefined,
      oauthToken: provider === "claude" && authMethod === "oauth" ? oauthToken ?? undefined : undefined,
    });
    setName(CLAUDE_FALLBACK[0]?.id ?? "");
    setApiKey("");
    setApiKeyBlurred(false);
    setOauthToken(null);
    setOauthError(null);
    setAuthMethod("apiKey");
    setUseCustomModel(false);
    setExpanded(false);
  };

  const isDuplicate = !!(
    name.trim() &&
    existingEntries.some((e) => e.provider === provider && e.name === name.trim())
  );

  const canAdd = !isDuplicate && !!(
    name.trim() &&
    (provider === "local" ||
      (provider === "claude" && authMethod === "apiKey" && apiKeyBlurred && hasClaudeKey) ||
      (provider === "claude" && authMethod === "oauth" && oauthToken) ||
      (provider === "openrouter" && apiKeyBlurred && apiKey.trim().length > 10))
  );

  return (
    <View>
      {!expanded && (
        <TouchableBounce sensory onPress={() => setExpanded(true)}>
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
              Add a model
            </Text>
          </View>
        </TouchableBounce>
      )}

      {expanded && (
        <View style={{ padding: 18, paddingTop: 4, gap: 14 }}>
          <Segmented
            options={PROVIDERS}
            value={provider}
            onChange={onProviderChange}
            palette={palette}
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
                palette={palette}
              />

              {/* API Key mode */}
              {authMethod === "apiKey" && (
                <View style={{ gap: 6 }}>
                  <Field
                    placeholder="Anthropic API key"
                    value={apiKey}
                    onChangeText={(v) => { setApiKey(v); setApiKeyBlurred(false); }}
                    palette={palette}
                    secureTextEntry
                    returnKeyType="done"
                    onSubmitEditing={() => setApiKeyBlurred(true)}
                    onEndEditing={() => setApiKeyBlurred(true)}
                  />
                  {apiKeyBlurred && apiKey.trim().length > 0 && !hasClaudeKey && (
                    <Text style={{ color: palette.danger, fontSize: 12, marginLeft: 4 }}>
                      Invalid API key
                    </Text>
                  )}
                </View>
              )}

              {/* OAuth note */}
              {authMethod === "oauth" && (
                <Text
                  style={{
                    color: palette.textSoft,
                    fontSize: 12,
                    lineHeight: 17,
                    marginHorizontal: 2,
                  }}
                >
                  Due to an Anthropic policy update, OAuth models run through
                  the official Claude Code CLI. Your Claw instructions,
                  CLAUDE.md files, and project context are still used.
                </Text>
              )}

              {/* OAuth mode */}
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
                        style={{ color: palette.textMuted, fontSize: 14, flex: 1 }}
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
                        palette={palette}
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
                          <ActivityIndicator
                            color={palette.text}
                            size="small"
                          />
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
                        <ActivityIndicator
                          color={palette.text}
                          size="small"
                        />
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

              {/* Model chips — only shown once key submitted and valid, or OAuth */}
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
                      <Text style={{ fontSize: 11, color: palette.textSoft }}>
                        loading
                      </Text>
                    )}
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingRight: 8 }}
                  >
                    {/* Custom pill */}
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
                                color: selected
                                  ? palette.surface
                                  : palette.text,
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
                      palette={palette}
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
                onChangeText={(v) => { setApiKey(v); setApiKeyBlurred(false); }}
                palette={palette}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={() => setApiKeyBlurred(true)}
                onEndEditing={() => setApiKeyBlurred(true)}
              />
              {apiKeyBlurred && apiKey.trim().length > 0 && apiKey.trim().length <= 10 && (
                <Text style={{ color: palette.danger, fontSize: 12, marginLeft: 4 }}>
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
                                color: selected
                                  ? palette.surface
                                  : palette.text,
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
                      palette={palette}
                    />
                  )}
                </View>
              )}
            </>
          )}

          {/* Model name — only for local provider */}
          {provider === "local" && (
            <Field
              placeholder="Model name or path"
              value={name}
              onChangeText={setName}
              palette={palette}
            />
          )}

          {/* Add to queue — visible once auth is done and model is selectable */}
          {(canAdd || isDuplicate) && (
            <>
              {isDuplicate && (
                <Text style={{ color: palette.textSoft, fontSize: 12, marginLeft: 4 }}>
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

          <TouchableBounce sensory onPress={() => { setExpanded(false); setName(CLAUDE_FALLBACK[0]?.id ?? ""); setApiKey(""); setApiKeyBlurred(false); setOauthToken(null); setOauthError(null); setOauthPendingState(null); setOauthCode(""); setAuthMethod("apiKey"); setUseCustomModel(false); }}>
            <View style={{ paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ color: palette.textMuted, fontSize: 14, fontWeight: "500" }}>
                Cancel
              </Text>
            </View>
          </TouchableBounce>
        </View>
      )}
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
  const settings = useGatewayStore((s) => s.settings);
  const _hasHydrated = useGatewayStore((s) => s._hasHydrated);
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
  const effectiveScheme =
    darkMode === "system" ? scheme ?? "light" : darkMode;
  const palette = useMemo<Palette>(
    () => buildPalette(effectiveScheme === "dark", accentTheme),
    [effectiveScheme, accentTheme]
  );

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
    setQueue(buildQueue(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_hasHydrated]);

  // Persist all local state to the store on every change via a ref
  // so the save never causes a re-render cycle. The ref is flushed
  // on unmount (modal close) and also kept in sync so "revert" works.
  const pendingRef = useRef({
    serverUrl, bearerToken, queue, autoCompact, streamingEnabled,
    darkMode, accentTheme, autoCompactThreshold, telemetryEnabled,
    autoContinueEnabled,
  });
  // Keep the ref current without triggering effects
  pendingRef.current = {
    serverUrl, bearerToken, queue, autoCompact, streamingEnabled,
    darkMode, accentTheme, autoCompactThreshold, telemetryEnabled,
    autoContinueEnabled,
  };
  // Flush to store on unmount (modal close)
  useEffect(() => {
    return () => {
      const s = pendingRef.current;
      actions.setSettings({
        serverUrl: s.serverUrl,
        bearerToken: s.bearerToken,
        modelQueue: s.queue,
        autoCompact: s.autoCompact,
        streamingEnabled: s.streamingEnabled,
        darkMode: s.darkMode,
        accentTheme: s.accentTheme,
        autoCompactThreshold: s.autoCompactThreshold,
        telemetryEnabled: s.telemetryEnabled,
        autoContinueEnabled: s.autoContinueEnabled,
      });
    };
  }, [actions]);


  // Snapshot the initial values so "Revert" can restore them.
  const initialRef = useRef({
    serverUrl: settings.serverUrl,
    bearerToken: settings.bearerToken,
    queue: buildQueue(settings),
    autoCompact: settings.autoCompact ?? true,
    streamingEnabled: settings.streamingEnabled ?? true,
    darkMode: (settings.darkMode ?? "system") as "system" | "light" | "dark",
    accentTheme: (settings.accentTheme ?? "lavender") as "claude" | "lavender",
    autoCompactThreshold: settings.autoCompactThreshold ?? 70,
    telemetryEnabled: settings.telemetryEnabled ?? true,
    autoContinueEnabled: settings.autoContinueEnabled ?? true,
  });

  const hasChanges =
    serverUrl !== initialRef.current.serverUrl ||
    bearerToken !== initialRef.current.bearerToken ||
    autoCompact !== initialRef.current.autoCompact ||
    streamingEnabled !== initialRef.current.streamingEnabled ||
    darkMode !== initialRef.current.darkMode ||
    accentTheme !== initialRef.current.accentTheme ||
    autoCompactThreshold !== initialRef.current.autoCompactThreshold ||
    telemetryEnabled !== initialRef.current.telemetryEnabled ||
    autoContinueEnabled !== initialRef.current.autoContinueEnabled ||
    JSON.stringify(queue.map((q) => q.id)) !==
      JSON.stringify(initialRef.current.queue.map((q) => q.id));

  const revert = () => {
    const s = initialRef.current;
    setServerUrl(s.serverUrl);
    setBearerToken(s.bearerToken);
    setQueue(s.queue);
    setAutoCompact(s.autoCompact);
    setStreamingEnabled(s.streamingEnabled);
    setDarkMode(s.darkMode);
    setAccentTheme(s.accentTheme);
    setAutoCompactThreshold(s.autoCompactThreshold);
    setTelemetryEnabled(s.telemetryEnabled);
    setAutoContinueEnabled(s.autoContinueEnabled);
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
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 60,
      }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustsScrollIndicatorInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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
            <GlassButton onPress={testConnection} style={{ borderRadius: 12, paddingVertical: 13, width: "100%" }}>
              <Text style={{ color: palette.text, fontWeight: "600", fontSize: 14, letterSpacing: 0.2 }}>
                Test connection
              </Text>
            </GlassButton>
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

        <View style={{ height: 40 }} />

        {/* ── Revert (only shown when settings differ from initial) ── */}
        {hasChanges && (
          <GlassButton onPress={revert} style={{ borderRadius: 14, paddingVertical: 16, width: "100%" }}>
            <Text style={{ color: palette.danger, fontWeight: "600", fontSize: 15, letterSpacing: 0.3 }}>
              Revert changes
            </Text>
          </GlassButton>
        )}
    </ScrollView>
  );
}
