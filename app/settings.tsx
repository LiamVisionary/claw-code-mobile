import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
import { modelEntryMatchesBackend, normalizeServerUrlForMatch, type ModelEntry, type OAuthTokenSet, useGatewayStore } from "@/store/gatewayStore";
import {
  buildPalette,
  ACCENT_OPTIONS,
  type AccentTheme,
  type Palette,
} from "@/constants/palette";
import {
  pickVaultDirectory,
  validateLocalVault,
} from "@/util/vault/localVault";

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

function isDarkPalette(p?: Palette): boolean {
  if (!p) return false;
  const hex = p.bg.replace("#", "");
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r + g + b) / 3 < 128;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  palette,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  palette?: Palette;
}) {
  const selectedIndex = options.findIndex((o) => o.key === value);
  const dark = isDarkPalette(palette);
  return (
    <SegmentedControl
      values={options.map((o) => o.label)}
      selectedIndex={selectedIndex >= 0 ? selectedIndex : 0}
      onChange={(e) => {
        const idx = e.nativeEvent.selectedSegmentIndex;
        if (options[idx]) onChange(options[idx].key);
      }}
      appearance={dark ? "dark" : "light"}
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
  expanded,
  onExpandedChange,
}: {
  existingEntries: ModelEntry[];
  onAdd: (entry: ModelEntry) => void;
  palette: Palette;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const setExpanded = onExpandedChange;
  const [provider, setProvider] = useState<ModelEntry["provider"]>("claude");
  const [authMethod, setAuthMethod] = useState<"apiKey" | "oauth">(
    () => existingEntries.some((e) => e.provider === "claude" && e.authMethod === "oauth") ? "oauth" : "apiKey"
  );
  const [name, setName] = useState(CLAUDE_FALLBACK[0]?.id ?? "");
  const [useCustomModel, setUseCustomModel] = useState(false);
  /** Flipped to true when the user blurs or submits the API key field */
  const [apiKeyBlurred, setApiKeyBlurred] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434/v1");
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

  type DiscoveredLocalModel = {
    name: string;
    sizeBytes?: number;
    parameterSize?: string;
    quantization?: string;
    // Endpoint (/v1 URL) that actually serves this model, stamped on each
    // model so the picker works with multiple runners side-by-side.
    endpoint: string;
    runner: string;
  };
  /** "current" = scan the backend host. "other" = scan an arbitrary URL. */
  const [localHostMode, setLocalHostMode] = useState<"current" | "other">("current");
  const [localModels, setLocalModels] = useState<DiscoveredLocalModel[] | null>(null);
  const [localDiscovering, setLocalDiscovering] = useState(false);
  const [localDiscoverError, setLocalDiscoverError] = useState<string | null>(null);

  const discoverLocalModels = async () => {
    const settings = useGatewayStore.getState().settings;
    const serverUrl = settings.serverUrl?.replace(/\/+$/, "");
    const token = settings.bearerToken;
    if (!serverUrl || !token) {
      setLocalDiscoverError("Configure server connection first.");
      return;
    }
    // Current-backend mode sends no baseUrl — the server scans its own
    // loopback for known runner ports. Other mode sends the user-entered
    // URL (trailing /v1 stripped, since discovery uses /api/tags or /models).
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
        setLocalDiscoverError(data?.error ?? `Server returned ${res.status}`);
        setLocalModels(null);
      } else {
        // Flatten runners into one list so pills render uniformly even if
        // Ollama + LM Studio are both up.
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
    if (p === "local") {
      const existingLocal = existingEntries.find((e) => e.provider === "local" && e.endpoint);
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
    // Local runners ignore the API key but OpenAI-compat clients insist on
    // one being present — ship a harmless placeholder so the user never has
    // to think about it.
    const effectiveApiKey =
      provider === "local" ? apiKey.trim() || "local-dev-token" : apiKey.trim();
    onAdd({
      id: makeId(),
      provider,
      name: name.trim(),
      apiKey: effectiveApiKey,
      enabled: true,
      // For OAuth, store both the API key and the OAuth token so the
      // backend can pass both to the claw binary (ApiKeyAndBearer auth).
      authMethod: provider === "claude" && authMethod === "oauth" ? "oauth" : undefined,
      oauthToken: provider === "claude" && authMethod === "oauth" ? oauthToken ?? undefined : undefined,
      ...(provider === "local" ? { endpoint: endpoint.trim() || "http://127.0.0.1:11434/v1" } : {}),
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

  // Dedupe within the active backend on (provider, name, endpoint) so the
  // same model name can be registered against multiple endpoints (e.g.
  // gpt-oss:20b at 127.0.0.1 and at a cloudflared URL). existingEntries is
  // already filtered to the active backend by the parent.
  const candidateEndpoint =
    provider === "local" ? endpoint.trim() || "http://127.0.0.1:11434/v1" : "";
  const isDuplicate = !!(
    name.trim() &&
    existingEntries.some(
      (e) =>
        e.provider === provider &&
        e.name === name.trim() &&
        ((e.endpoint ?? "") === candidateEndpoint)
    )
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
                  palette={palette}
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
  const [obsidianEnabled, setObsidianEnabled] = useState(
    settings.obsidianVault?.enabled ?? false
  );
  const [obsidianProvider, setObsidianProvider] = useState<"sync" | "backend" | "local">(
    settings.obsidianVault?.provider ?? "sync"
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
  const [obsidianUseMcpVault, setObsidianUseMcpVault] = useState(
    settings.obsidianVault?.useMcpVault ?? false
  );
  const [obsidianStatus, setObsidianStatus] = useState<"idle" | "ok" | "error">(
    // If vault was previously connected and enabled, show as connected
    (settings.obsidianVault?.enabled && (settings.obsidianVault?.path || settings.obsidianVault?.localDirectoryUri)) ? "ok" : "idle"
  );
  const [obsidianMessage, setObsidianMessage] = useState<string | null>(null);
  const [obsidianChecking, setObsidianChecking] = useState(false);
  const [detectedVaults, setDetectedVaults] = useState<{ path: string; name: string; noteCount: number }[]>([]);
  // Headless sync state
  const [headlessStep, setHeadlessStep] = useState<
    "checking" | "not_installed" | "not_logged_in" | "pick_vault" | "syncing" | "done"
  >("checking");
  const [headlessEmail, setHeadlessEmail] = useState("");
  const [headlessPassword, setHeadlessPassword] = useState("");
  const [headlessMfa, setHeadlessMfa] = useState("");
  const [headlessRemoteVaults, setHeadlessRemoteVaults] = useState<{ id: string; name: string; encryption: string }[]>([]);
  const [headlessMessage, setHeadlessMessage] = useState<string | null>(null);
  const [headlessBusy, setHeadlessBusy] = useState(false);

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
    setObsidianEnabled(settings.obsidianVault?.enabled ?? false);
    setObsidianProvider(settings.obsidianVault?.provider ?? "sync");
    setObsidianPath(settings.obsidianVault?.path ?? "");
    setObsidianLocalUri(settings.obsidianVault?.localDirectoryUri ?? "");
    setObsidianLocalDisplay(settings.obsidianVault?.localDisplayPath ?? "");
    setObsidianUseForMemory(settings.obsidianVault?.useForMemory ?? true);
    setObsidianUseForReference(settings.obsidianVault?.useForReference ?? true);
    setObsidianUseMcpVault(settings.obsidianVault?.useMcpVault ?? false);
    setQueue(buildQueue(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_hasHydrated]);

  // Persist all local state to the store on every change via a ref
  // so the save never causes a re-render cycle. The ref is flushed
  // on unmount (modal close) and also kept in sync so "revert" works.
  const pendingRef = useRef({
    serverUrl, bearerToken, queue, autoCompact, streamingEnabled,
    darkMode, accentTheme, autoCompactThreshold, telemetryEnabled,
    autoContinueEnabled, obsidianEnabled, obsidianProvider, obsidianPath,
    obsidianLocalUri, obsidianLocalDisplay, obsidianUseForMemory, obsidianUseForReference, obsidianUseMcpVault,
  });
  // Keep the ref current without triggering effects
  pendingRef.current = {
    serverUrl, bearerToken, queue, autoCompact, streamingEnabled,
    darkMode, accentTheme, autoCompactThreshold, telemetryEnabled,
    autoContinueEnabled, obsidianEnabled, obsidianProvider, obsidianPath,
    obsidianLocalUri, obsidianLocalDisplay, obsidianUseForMemory, obsidianUseForReference, obsidianUseMcpVault,
  };
  // Check headless status on mount if sync provider is selected
  useEffect(() => {
    if (obsidianProvider === "sync" && serverUrl && bearerToken) {
      checkHeadlessStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        obsidianVault: {
          enabled: s.obsidianEnabled,
          provider: s.obsidianProvider,
          path: s.obsidianPath.trim(),
          localDirectoryUri: s.obsidianLocalUri,
          localDisplayPath: s.obsidianLocalDisplay,
          useForMemory: s.obsidianUseForMemory,
          useForReference: s.obsidianUseForReference,
          useMcpVault: s.obsidianUseMcpVault,
        },
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
    accentTheme: (settings.accentTheme ?? "lavender") as AccentTheme,
    autoCompactThreshold: settings.autoCompactThreshold ?? 70,
    telemetryEnabled: settings.telemetryEnabled ?? true,
    autoContinueEnabled: settings.autoContinueEnabled ?? true,
    obsidianEnabled: settings.obsidianVault?.enabled ?? false,
    obsidianProvider: (settings.obsidianVault?.provider ?? "backend") as "backend" | "local",
    obsidianPath: settings.obsidianVault?.path ?? "",
    obsidianLocalUri: settings.obsidianVault?.localDirectoryUri ?? "",
    obsidianLocalDisplay: settings.obsidianVault?.localDisplayPath ?? "",
    obsidianUseForMemory: settings.obsidianVault?.useForMemory ?? true,
    obsidianUseForReference: settings.obsidianVault?.useForReference ?? true,
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
    obsidianEnabled !== initialRef.current.obsidianEnabled ||
    JSON.stringify(queue.map((q) => q.id)) !==
      JSON.stringify(initialRef.current.queue.map((q) => q.id));

  const revert = () => {
    const s = initialRef.current;
    setServerUrl(s.serverUrl);
    setBearerToken(s.bearerToken);
    // Connection settings are committed on blur, so revert must also
    // push the original values back to the store — otherwise the store
    // keeps whatever the user last typed even after the UI rewinds.
    commitConnectionToStore({
      serverUrl: s.serverUrl,
      bearerToken: s.bearerToken,
    });
    setQueue(s.queue);
    setAutoCompact(s.autoCompact);
    setStreamingEnabled(s.streamingEnabled);
    setDarkMode(s.darkMode);
    setAccentTheme(s.accentTheme);
    setAutoCompactThreshold(s.autoCompactThreshold);
    setTelemetryEnabled(s.telemetryEnabled);
    setAutoContinueEnabled(s.autoContinueEnabled);
    setObsidianEnabled(s.obsidianEnabled);
    setObsidianProvider(s.obsidianProvider);
    setObsidianPath(s.obsidianPath);
    setObsidianLocalUri(s.obsidianLocalUri);
    setObsidianLocalDisplay(s.obsidianLocalDisplay);
    setObsidianUseForMemory(s.obsidianUseForMemory);
    setObsidianUseForReference(s.obsidianUseForReference);
    setObsidianUseMcpVault(s.obsidianUseMcpVault);
    setObsidianStatus(
      (s.obsidianEnabled && (s.obsidianPath || s.obsidianLocalUri)) ? "ok" : "idle"
    );
    setObsidianMessage(null);
    setDetectedVaults([]);
    setHeadlessMessage(null);
    setHeadlessStep("checking");
  };

  // ── Headless sync helpers ─────────────────────────────────────────
  const headlessApi = async (
    path: string,
    method = "GET",
    body?: Record<string, unknown>
  ) => {
    const res = await fetch(
      `${serverUrl.replace(/\/+$/, "")}/obsidian/headless${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }
    );
    return res.json();
  };

  const checkHeadlessStatus = async () => {
    if (!serverUrl || !bearerToken) {
      setHeadlessStep("not_installed");
      setHeadlessMessage("Set server URL and token first.");
      return;
    }
    setHeadlessBusy(true);
    setHeadlessStep("checking");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/obsidian/headless/status`,
        {
          headers: { Authorization: `Bearer ${bearerToken}` },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      const data = await res.json();
      if (data.state === "not_installed") setHeadlessStep("not_installed");
      else if (data.state === "not_logged_in") setHeadlessStep("not_logged_in");
      else if (data.state === "syncing") {
        setHeadlessStep("syncing");
        setObsidianPath(data.path);
        setObsidianStatus("ok");
        setObsidianEnabled(true);
      } else if (data.state === "idle" || data.state === "no_vault") {
        setHeadlessStep("pick_vault");
        await loadRemoteVaults();
      } else if (data.state === "error") {
        setHeadlessMessage(data.message);
        setHeadlessStep("not_logged_in");
      } else {
        setHeadlessStep("not_installed");
      }
    } catch (err: any) {
      setHeadlessStep("not_installed");
      setHeadlessMessage(
        err?.name === "AbortError"
          ? "Server took too long to respond."
          : (err.message ?? "Cannot reach server")
      );
    } finally {
      setHeadlessBusy(false);
    }
  };

  const installHeadless = async () => {
    setHeadlessBusy(true);
    setHeadlessMessage("Installing obsidian-headless…");
    try {
      const data = await headlessApi("/install", "POST");
      if (data.ok) {
        setHeadlessMessage("Installed. Log in to continue.");
        setHeadlessStep("not_logged_in");
      } else {
        setHeadlessMessage(data.message);
      }
    } catch (err: any) {
      setHeadlessMessage(err.message ?? "Install failed");
    } finally {
      setHeadlessBusy(false);
    }
  };

  const headlessLogin = async () => {
    if (!headlessEmail || !headlessPassword) {
      setHeadlessMessage("Enter email and password.");
      return;
    }
    setHeadlessBusy(true);
    setHeadlessMessage(null);
    try {
      const data = await headlessApi("/login", "POST", {
        email: headlessEmail,
        password: headlessPassword,
        ...(headlessMfa ? { mfa: headlessMfa } : {}),
      });
      if (data.ok) {
        setHeadlessMessage(null);
        setHeadlessStep("pick_vault");
        await loadRemoteVaults();
      } else {
        setHeadlessMessage(data.message);
      }
    } catch (err: any) {
      setHeadlessMessage(err.message ?? "Login failed");
    } finally {
      setHeadlessBusy(false);
    }
  };

  const loadRemoteVaults = async () => {
    try {
      const data = await headlessApi("/vaults");
      setHeadlessRemoteVaults(data.vaults ?? []);
    } catch {
      // ignore
    }
  };

  const headlessSetupAndSync = async (vaultIdOrName: string) => {
    setHeadlessBusy(true);
    setHeadlessMessage("Setting up sync…");
    try {
      const setupData = await headlessApi("/setup", "POST", { vault: vaultIdOrName });
      if (!setupData.ok) {
        setHeadlessMessage(setupData.message);
        return;
      }
      const localPath = setupData.localPath;
      setObsidianPath(localPath);

      // Run initial sync
      setHeadlessMessage("Running initial sync…");
      await headlessApi("/sync", "POST", { path: localPath });

      // Start continuous sync
      const startData = await headlessApi("/sync/start", "POST", { path: localPath });
      if (startData.ok) {
        setHeadlessStep("syncing");
        setObsidianStatus("ok");
        setObsidianEnabled(true);
        setHeadlessMessage("Syncing — vault is live.");
      } else {
        setHeadlessMessage(startData.message);
      }
    } catch (err: any) {
      setHeadlessMessage(err.message ?? "Setup failed");
    } finally {
      setHeadlessBusy(false);
    }
  };

  const validateObsidianBackend = async (pathOverride?: string) => {
    const vaultPath = pathOverride ?? obsidianPath;
    if (!serverUrl || !bearerToken) {
      setObsidianMessage("Set server URL and token first.");
      setObsidianStatus("error");
      return;
    }
    if (!vaultPath.trim()) {
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
          body: JSON.stringify({ path: vaultPath.trim() }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setObsidianMessage(data.reason ?? data.error ?? `Server returned ${res.status}`);
        setObsidianStatus("error");
      } else {
        const n = data.noteCount ?? 0;
        setObsidianMessage(
          `Connected — ${n} note${n === 1 ? "" : "s"} found`
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

  const detectVaultsOnBackend = async () => {
    if (!serverUrl || !bearerToken) {
      setObsidianMessage("Set server URL and token first.");
      setObsidianStatus("error");
      return;
    }
    setObsidianChecking(true);
    setObsidianMessage(null);
    setDetectedVaults([]);
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/obsidian/detect`,
        {
          headers: { Authorization: `Bearer ${bearerToken}` },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setObsidianMessage(data.error ?? `Server returned ${res.status}`);
        setObsidianStatus("error");
      } else if (!data.vaults?.length) {
        setObsidianMessage("No vaults found — tap \"Create vault\" to set one up.");
      } else if (data.vaults.length === 1) {
        // Single vault — auto-connect
        const v = data.vaults[0];
        setObsidianPath(v.path);
        await validateObsidianBackend(v.path);
        return; // validateObsidianBackend handles setObsidianChecking
      } else {
        setDetectedVaults(data.vaults);
      }
    } catch (err: any) {
      setObsidianMessage(err.message ?? "Detection failed");
      setObsidianStatus("error");
    } finally {
      setObsidianChecking(false);
    }
  };

  const createVaultOnBackend = async () => {
    if (!serverUrl || !bearerToken) {
      setObsidianMessage("Set server URL and token first.");
      setObsidianStatus("error");
      return;
    }
    setObsidianChecking(true);
    setObsidianMessage(null);
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/obsidian/init`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setObsidianMessage(data.reason ?? data.error ?? "Failed to create vault");
        setObsidianStatus("error");
      } else {
        setObsidianPath(data.path);
        setObsidianMessage(
          `Vault created and connected. To sync with Obsidian on your devices, set up git sync — see the Welcome note inside the vault for instructions.`
        );
        setObsidianStatus("ok");
        setObsidianEnabled(true);
      }
    } catch (err: any) {
      setObsidianMessage(err.message ?? "Failed to create vault");
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

  /**
   * Default a missing scheme to http:// so users can paste bare host:port
   * (e.g. "192.168.1.9:5000") without remembering the protocol. Strip
   * trailing slashes since the rest of the app appends paths directly.
   */
  const normalizeServerUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
  };

  /**
   * Push the current connection settings to the store immediately, so
   * other parts of the app (e.g. the Local model picker) see them without
   * waiting for the settings modal to close. The initialRef snapshot is
   * left untouched so the Revert button still restores the pre-edit
   * values.
   */
  const commitConnectionToStore = (next: {
    serverUrl: string;
    bearerToken: string;
  }) => {
    actions.setSettings({
      serverUrl: next.serverUrl,
      bearerToken: next.bearerToken,
    });
  };

  const handleServerUrlBlur = () => {
    const normalized = normalizeServerUrl(serverUrl);
    if (normalized !== serverUrl) setServerUrl(normalized);
    commitConnectionToStore({ serverUrl: normalized, bearerToken });
  };

  const handleBearerTokenBlur = () => {
    commitConnectionToStore({ serverUrl: normalizeServerUrl(serverUrl), bearerToken });
  };

  const testConnection = async () => {
    const url = normalizeServerUrl(serverUrl);
    if (!url || !bearerToken) {
      setConnMessage("Set server URL and token first.");
      setConnStatus("error");
      return;
    }
    if (url !== serverUrl) setServerUrl(url);
    setConnStatus("idle");
    setConnMessage(null);
    try {
      const res = await fetch(`${url}/health`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      // Persist immediately on a successful test so the rest of the app
      // can use the new URL without waiting for the modal to close.
      commitConnectionToStore({ serverUrl: url, bearerToken });
      setConnMessage(`Connected — ${data.service ?? "ok"}`);
      setConnStatus("ok");
    } catch (err: any) {
      setConnMessage(err.message);
      setConnStatus("error");
    }
  };

  // Each entry is scoped to the backend it was added under; the queue UI
  // and dispatch only see entries matching the active Server URL. The full
  // `queue` state still holds entries for other backends so switching back
  // restores them — but they're invisible (and silent) until then.
  const activeServerUrl = useMemo(
    () => normalizeServerUrlForMatch(serverUrl),
    [serverUrl]
  );
  const visibleQueue = useMemo(
    () => queue.filter((e) => modelEntryMatchesBackend(e, activeServerUrl)),
    [queue, activeServerUrl]
  );

  const moveUpById = (id: string) =>
    setQueue((q) => {
      // Operate on the visible slice so reordering one backend doesn't
      // shuffle entries from another. We then splice the result back into
      // the full queue at the same offsets the visible entries occupied.
      const visibleIdxs = q
        .map((e, idx) => (modelEntryMatchesBackend(e, activeServerUrl) ? idx : -1))
        .filter((idx) => idx >= 0);
      const pos = visibleIdxs.findIndex((idx) => q[idx].id === id);
      if (pos <= 0) return q;
      const next = [...q];
      const a = visibleIdxs[pos - 1];
      const b = visibleIdxs[pos];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });

  const moveDownById = (id: string) =>
    setQueue((q) => {
      const visibleIdxs = q
        .map((e, idx) => (modelEntryMatchesBackend(e, activeServerUrl) ? idx : -1))
        .filter((idx) => idx >= 0);
      const pos = visibleIdxs.findIndex((idx) => q[idx].id === id);
      if (pos < 0 || pos >= visibleIdxs.length - 1) return q;
      const next = [...q];
      const a = visibleIdxs[pos];
      const b = visibleIdxs[pos + 1];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });

  const toggleEntryById = (id: string) =>
    setQueue((q) => q.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)));

  const deleteEntryById = (id: string) =>
    setQueue((q) => q.filter((e) => e.id !== id));

  const addEntry = (entry: ModelEntry) =>
    // Stamp the active backend so this entry only surfaces (and only fires)
    // when the user is connected to the same backend later.
    setQueue((q) => [...q, { ...entry, serverUrl: activeServerUrl || undefined }]);

  const enabledCount = visibleQueue.filter((e) => e.enabled).length;
  const [addModelExpanded, setAddModelExpanded] = useState(false);


  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
    >
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
              placeholder="Server URL (e.g. 192.168.1.9:5000)"
              value={serverUrl}
              onChangeText={setServerUrl}
              onEndEditing={handleServerUrlBlur}
              palette={palette}
              keyboardType="url"
            />
            <Field
              placeholder="Bearer token"
              value={bearerToken}
              onChangeText={setBearerToken}
              onEndEditing={handleBearerTokenBlur}
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
            : accentTheme === "neo"
            ? "Neo — phosphor green on black. Always dark."
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {visibleQueue.length > 0 && (
              <Text
                style={{
                  color: palette.textMuted,
                  fontSize: 12,
                  fontWeight: "500",
                  letterSpacing: 0.4,
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
        </View>

        <Card palette={palette}>
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
                {i > 0 && <Hairline palette={palette} inset={18} />}
                <QueueRow
                  entry={entry}
                  index={i}
                  total={visibleQueue.length}
                  onToggle={() => toggleEntryById(entry.id)}
                  onDelete={() => deleteEntryById(entry.id)}
                  onMoveUp={() => moveUpById(entry.id)}
                  onMoveDown={() => moveDownById(entry.id)}
                  palette={palette}
                />
              </View>
            ))
          )}
          {visibleQueue.length > 0 && addModelExpanded && <Hairline palette={palette} inset={18} />}
          <AddModelForm
            existingEntries={visibleQueue}
            onAdd={addEntry}
            palette={palette}
            expanded={addModelExpanded}
            onExpandedChange={setAddModelExpanded}
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
                { key: "sync", label: "Obsidian Sync" },
                { key: "backend", label: "Manual path" },
                { key: "local", label: "This device" },
              ]}
              value={obsidianProvider}
              onChange={(k) => {
                setObsidianProvider(k as "sync" | "backend" | "local");
                setObsidianStatus("idle");
                setObsidianMessage(null);
                setDetectedVaults([]);
                setHeadlessMessage(null);
                if (k === "sync") checkHeadlessStatus();
              }}
              palette={palette}
            />
            {obsidianProvider === "sync" ? (
              /* ── Obsidian Sync (headless) flow ── */
              <View style={{ gap: 12 }}>
                {headlessStep === "checking" && (
                  <Text style={{ color: palette.textMuted, fontSize: 13, textAlign: "center" }}>
                    Checking server…
                  </Text>
                )}

                {headlessStep === "not_installed" && (
                  <>
                    <Text style={{ color: palette.textSoft, fontSize: 13, lineHeight: 18 }}>
                      Obsidian Headless syncs your vault via Obsidian Sync — same encryption, no desktop app needed. Requires an Obsidian Sync subscription.
                    </Text>
                    <TouchableBounce sensory onPress={installHeadless}>
                      <View style={{
                        borderRadius: 12, paddingVertical: 13, alignItems: "center",
                        backgroundColor: palette.accent, opacity: headlessBusy ? 0.6 : 1,
                      }}>
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                          {headlessBusy ? "Installing…" : "Install Obsidian Headless"}
                        </Text>
                      </View>
                    </TouchableBounce>
                  </>
                )}

                {headlessStep === "not_logged_in" && (
                  <>
                    <Field
                      placeholder="Obsidian account email"
                      value={headlessEmail}
                      onChangeText={setHeadlessEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      palette={palette}
                    />
                    <Field
                      placeholder="Password"
                      value={headlessPassword}
                      onChangeText={setHeadlessPassword}
                      secureTextEntry
                      palette={palette}
                    />
                    <Field
                      placeholder="2FA code (if enabled)"
                      value={headlessMfa}
                      onChangeText={setHeadlessMfa}
                      keyboardType="number-pad"
                      palette={palette}
                    />
                    <TouchableBounce sensory onPress={headlessLogin}>
                      <View style={{
                        borderRadius: 12, paddingVertical: 13, alignItems: "center",
                        backgroundColor: palette.accent, opacity: headlessBusy ? 0.6 : 1,
                      }}>
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                          {headlessBusy ? "Logging in…" : "Sign in"}
                        </Text>
                      </View>
                    </TouchableBounce>
                  </>
                )}

                {headlessStep === "pick_vault" && (
                  <>
                    {headlessRemoteVaults.length > 0 ? (
                      <View style={{ gap: 6 }}>
                        <Text style={{ color: palette.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>
                          Your remote vaults
                        </Text>
                        {headlessRemoteVaults.map((v) => (
                          <TouchableBounce
                            key={v.id}
                            sensory
                            onPress={() => headlessSetupAndSync(v.name || v.id)}
                          >
                            <View style={{
                              backgroundColor: palette.surfaceAlt, borderRadius: 10,
                              paddingHorizontal: 14, paddingVertical: 10,
                              flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                            }}>
                              <Text style={{ color: palette.text, fontSize: 14, fontWeight: "600", flex: 1 }}>{v.name}</Text>
                              <Text style={{ color: palette.textSoft, fontSize: 11 }}>
                                {v.encryption === "e2ee" ? "E2E encrypted" : "Standard"}
                              </Text>
                            </View>
                          </TouchableBounce>
                        ))}
                      </View>
                    ) : (
                      <Text style={{ color: palette.textSoft, fontSize: 13, textAlign: "center" }}>
                        {headlessBusy ? "Loading vaults…" : "No remote vaults found. Create one in Obsidian first."}
                      </Text>
                    )}
                  </>
                )}

                {headlessStep === "syncing" && (
                  <View style={{
                    backgroundColor: palette.surfaceAlt, borderRadius: 12,
                    paddingHorizontal: 16, paddingVertical: 14, gap: 4,
                  }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.success }} />
                      <Text style={{ color: palette.text, fontSize: 14, fontWeight: "600" }}>
                        Obsidian Sync active
                      </Text>
                    </View>
                    <Text style={{ color: palette.textMuted, fontSize: 12 }} numberOfLines={1}>
                      {obsidianPath}
                    </Text>
                  </View>
                )}

                {headlessMessage && (
                  <Text style={{ color: headlessStep === "syncing" ? palette.success : palette.textSoft, fontSize: 13 }}>
                    {headlessMessage}
                  </Text>
                )}
              </View>
            ) : obsidianProvider === "backend" ? (
              <>
                {/* Show detected vaults as tappable pills */}
                {detectedVaults.length > 0 && !obsidianPath.trim() && (
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: palette.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>
                      Found on server
                    </Text>
                    {detectedVaults.map((v) => (
                      <TouchableBounce
                        key={v.path}
                        sensory
                        onPress={() => {
                          setObsidianPath(v.path);
                          setDetectedVaults([]);
                          // Auto-validate
                          setTimeout(() => validateObsidianBackend(v.path), 100);
                        }}
                      >
                        <View style={{
                          backgroundColor: palette.surfaceAlt,
                          borderRadius: 10,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: palette.text, fontSize: 14, fontWeight: "600" }}>{v.name}</Text>
                            <Text style={{ color: palette.textMuted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{v.path}</Text>
                          </View>
                          <Text style={{ color: palette.textSoft, fontSize: 12 }}>
                            {v.noteCount} note{v.noteCount === 1 ? "" : "s"}
                          </Text>
                        </View>
                      </TouchableBounce>
                    ))}
                  </View>
                )}
                {/* Show path field only if no vault is connected yet, or user wants to change */}
                {obsidianStatus !== "ok" && (
                  <Field
                    placeholder="Vault path on server (or tap Detect below)"
                    value={obsidianPath}
                    onChangeText={setObsidianPath}
                    palette={palette}
                  />
                )}
                {/* Connected vault display */}
                {obsidianStatus === "ok" && obsidianPath.trim() && (
                  <View style={{
                    backgroundColor: palette.surfaceAlt,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}>
                    <Text style={{ color: palette.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
                      Connected vault
                    </Text>
                    <Text style={{ color: palette.text, fontSize: 14, fontWeight: "500" }} numberOfLines={2}>
                      {obsidianPath}
                    </Text>
                  </View>
                )}
                {obsidianStatus !== "ok" && (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <GlassButton
                        onPress={detectVaultsOnBackend}
                        disabled={obsidianChecking}
                        tintColor={palette.accent}
                        style={{
                          borderRadius: 12,
                          paddingVertical: 14,
                          width: "100%",
                          opacity: obsidianChecking ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14, letterSpacing: 0.2 }}>
                          {obsidianChecking ? "Scanning…" : "Detect"}
                        </Text>
                      </GlassButton>
                    </View>
                    <View style={{ flex: 1 }}>
                      <GlassButton
                        onPress={createVaultOnBackend}
                        disabled={obsidianChecking}
                        tintColor={palette.text}
                        style={{
                          borderRadius: 12,
                          paddingVertical: 14,
                          width: "100%",
                          opacity: obsidianChecking ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: palette.bg, fontWeight: "600", fontSize: 14, letterSpacing: 0.2 }}>
                          {obsidianChecking ? "Creating…" : "Create vault"}
                        </Text>
                      </GlassButton>
                    </View>
                  </View>
                )}
                {obsidianStatus !== "ok" && obsidianPath.trim() && (
                  <TouchableBounce sensory onPress={() => validateObsidianBackend()}>
                    <View style={{
                      borderRadius: 12,
                      paddingVertical: 13,
                      alignItems: "center",
                      backgroundColor: palette.accent,
                      opacity: obsidianChecking ? 0.4 : 1,
                    }}>
                      <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14, letterSpacing: 0.2 }}>
                        Connect
                      </Text>
                    </View>
                  </TouchableBounce>
                )}
              </>
            ) : (
              <>
                {obsidianLocalDisplay ? (
                  <View style={{
                    backgroundColor: palette.surfaceAlt,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}>
                    <Text style={{ color: palette.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
                      Connected vault
                    </Text>
                    <Text style={{ color: palette.text, fontSize: 14, fontWeight: "500" }} numberOfLines={2}>
                      {obsidianLocalDisplay}
                    </Text>
                  </View>
                ) : null}
                <TouchableBounce sensory onPress={pickLocalVault}>
                  <View style={{
                    borderRadius: 12,
                    paddingVertical: 13,
                    alignItems: "center",
                    backgroundColor: obsidianLocalUri ? palette.surfaceAlt : palette.accent,
                    opacity: obsidianChecking ? 0.6 : 1,
                  }}>
                    <Text style={{
                      color: obsidianLocalUri ? palette.text : "#fff",
                      fontWeight: "600",
                      fontSize: 14,
                      letterSpacing: 0.2,
                    }}>
                      {obsidianChecking
                        ? "Checking…"
                        : obsidianLocalUri
                        ? "Pick different folder"
                        : "Pick vault folder"}
                    </Text>
                  </View>
                </TouchableBounce>
                {!obsidianLocalUri && (
                  <Text style={{ color: palette.textSoft, fontSize: 12, lineHeight: 17 }}>
                    Read-only: the agent sees your vault as context but can't
                    write back to this device. For memory write-back, use the
                    backend provider.
                  </Text>
                )}
              </>
            )}
            {obsidianMessage && (
              <Text style={{
                color: obsidianStatus === "ok" ? palette.success : palette.danger,
                fontSize: 13,
                marginTop: 2,
              }}>
                {obsidianMessage}
              </Text>
            )}
          </View>
          {/* Only show configuration options once a vault is connected */}
          {obsidianStatus === "ok" && (
            <>
              <Hairline palette={palette} inset={20} />
              <ToggleRow
                title="Enable Obsidian integration"
                description="Pause vault integration without disconnecting."
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
                  {obsidianProvider !== "local" && (
                    <>
                      <Hairline palette={palette} inset={20} />
                      <ToggleRow
                        title="Vault tools (MCP)"
                        description="Rich vault tools (search, frontmatter, tags). Adds ~60s startup time per message — enable only when needed."
                        value={obsidianUseMcpVault}
                        onValueChange={setObsidianUseMcpVault}
                        palette={palette}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
          {/* Disconnect button when vault is connected */}
          {obsidianStatus === "ok" && (
            <>
              <Hairline palette={palette} inset={20} />
              <TouchableBounce sensory onPress={() => {
                setObsidianPath("");
                setObsidianLocalUri("");
                setObsidianLocalDisplay("");
                setObsidianStatus("idle");
                setObsidianMessage(null);
                setObsidianEnabled(false);
              }}>
                <View style={{ paddingVertical: 14, alignItems: "center" }}>
                  <Text style={{ color: palette.danger, fontSize: 14, fontWeight: "500" }}>
                    Disconnect vault
                  </Text>
                </View>
              </TouchableBounce>
            </>
          )}
        </Card>
        <Caption palette={palette}>
          {obsidianProvider === "sync"
            ? "Uses Obsidian Sync to keep your vault in sync across all devices. Requires an Obsidian Sync subscription."
            : obsidianProvider === "backend"
            ? "Point to an existing vault folder on your server. Use git or Syncthing to sync with other devices."
            : "Vault lives on this device — read-only. Pick the folder Obsidian stores its vault in."}
        </Caption>

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
    </KeyboardAvoidingView>
  );
}
