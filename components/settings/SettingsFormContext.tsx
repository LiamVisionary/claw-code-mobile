import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  modelEntryMatchesBackend,
  normalizeServerUrlForMatch,
  type ModelEntry,
  useGatewayStore,
} from "@/store/gatewayStore";
import { type AccentTheme } from "@/constants/palette";
import { pickVaultDirectory, validateLocalVault } from "@/util/vault/localVault";
import { makeId } from "./_shared";

type ObsidianProvider = "sync" | "backend" | "local";
type ConnStatus = "idle" | "ok" | "error";
type ObsidianStatus = "idle" | "ok" | "error";
type HeadlessStep =
  | "checking"
  | "not_installed"
  | "not_logged_in"
  | "pick_vault"
  | "syncing"
  | "done";

type DetectedVault = { path: string; name: string; noteCount: number };
type RemoteVault = { id: string; name: string; encryption: string };

type SettingsFormValue = {
  // Connection
  serverUrl: string;
  setServerUrl: (s: string) => void;
  bearerToken: string;
  setBearerToken: (s: string) => void;
  connStatus: ConnStatus;
  connMessage: string | null;
  connTesting: boolean;
  testConnection: () => Promise<void>;
  handleServerUrlBlur: () => void;
  handleBearerTokenBlur: () => void;

  // Queue (shared across tabs — Models tab is the primary consumer)
  queue: ModelEntry[];
  visibleQueue: ModelEntry[];
  enabledCount: number;
  activeServerUrl: string;
  moveUpById: (id: string) => void;
  moveDownById: (id: string) => void;
  toggleEntryById: (id: string) => void;
  deleteEntryById: (id: string) => void;
  addEntry: (entry: ModelEntry) => void;
  addModelExpanded: boolean;
  setAddModelExpanded: (v: boolean) => void;

  // Behaviour
  autoCompact: boolean;
  setAutoCompact: (v: boolean) => void;
  autoCompactThreshold: number;
  setAutoCompactThreshold: (v: number) => void;
  streamingEnabled: boolean;
  setStreamingEnabled: (v: boolean) => void;
  autoContinueEnabled: boolean;
  setAutoContinueEnabled: (v: boolean) => void;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (v: boolean) => void;

  // Obsidian
  obsidianEnabled: boolean;
  setObsidianEnabled: (v: boolean) => void;
  obsidianProvider: ObsidianProvider;
  setObsidianProvider: (v: ObsidianProvider) => void;
  obsidianPath: string;
  setObsidianPath: (v: string) => void;
  obsidianLocalUri: string;
  setObsidianLocalUri: (v: string) => void;
  obsidianLocalDisplay: string;
  setObsidianLocalDisplay: (v: string) => void;
  obsidianUseForMemory: boolean;
  setObsidianUseForMemory: (v: boolean) => void;
  obsidianUseForReference: boolean;
  setObsidianUseForReference: (v: boolean) => void;
  obsidianUseMcpVault: boolean;
  setObsidianUseMcpVault: (v: boolean) => void;
  obsidianStatus: ObsidianStatus;
  setObsidianStatus: (v: ObsidianStatus) => void;
  obsidianMessage: string | null;
  setObsidianMessage: (v: string | null) => void;
  obsidianChecking: boolean;
  detectedVaults: DetectedVault[];
  setDetectedVaults: (v: DetectedVault[]) => void;
  validateObsidianBackend: (pathOverride?: string) => Promise<void>;
  detectVaultsOnBackend: () => Promise<void>;
  createVaultOnBackend: () => Promise<void>;
  pickLocalVault: () => Promise<void>;

  // Headless (Obsidian Sync)
  headlessStep: HeadlessStep;
  setHeadlessStep: (v: HeadlessStep) => void;
  headlessEmail: string;
  setHeadlessEmail: (v: string) => void;
  headlessPassword: string;
  setHeadlessPassword: (v: string) => void;
  headlessMfa: string;
  setHeadlessMfa: (v: string) => void;
  headlessRemoteVaults: RemoteVault[];
  headlessMessage: string | null;
  setHeadlessMessage: (v: string | null) => void;
  headlessBusy: boolean;
  checkHeadlessStatus: () => Promise<void>;
  installHeadless: () => Promise<void>;
  headlessLogin: () => Promise<void>;
  headlessSetupAndSync: (vaultIdOrName: string) => Promise<void>;

  // Revert
  hasChanges: boolean;
  revert: () => void;
};

const Ctx = createContext<SettingsFormValue | null>(null);

export function useSettingsForm(): SettingsFormValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useSettingsForm must be used inside <SettingsFormProvider>");
  }
  return v;
}

function buildQueue(settings: ReturnType<typeof useGatewayStore.getState>["settings"]): ModelEntry[] {
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
}

function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

export function SettingsFormProvider({ children }: { children: ReactNode }) {
  const settings = useGatewayStore((s) => s.settings);
  const _hasHydrated = useGatewayStore((s) => s._hasHydrated);
  const actions = useGatewayStore((s) => s.actions);

  // ── Draft state ──────────────────────────────────────────────────────────
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [bearerToken, setBearerToken] = useState(settings.bearerToken);
  const [connStatus, setConnStatus] = useState<ConnStatus>("idle");
  const [connMessage, setConnMessage] = useState<string | null>(null);

  const [queue, setQueue] = useState<ModelEntry[]>(() => buildQueue(settings));
  const [addModelExpanded, setAddModelExpanded] = useState(false);

  const [autoCompact, setAutoCompact] = useState(settings.autoCompact ?? true);
  const [streamingEnabled, setStreamingEnabled] = useState(settings.streamingEnabled ?? true);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState<number>(
    settings.autoCompactThreshold ?? 70
  );
  const [telemetryEnabled, setTelemetryEnabled] = useState(settings.telemetryEnabled ?? true);
  const [autoContinueEnabled, setAutoContinueEnabled] = useState(
    settings.autoContinueEnabled ?? true
  );

  const [obsidianEnabled, setObsidianEnabled] = useState(
    settings.obsidianVault?.enabled ?? false
  );
  const [obsidianProvider, setObsidianProvider] = useState<ObsidianProvider>(
    settings.obsidianVault?.provider ?? "sync"
  );
  const [obsidianPath, setObsidianPath] = useState(settings.obsidianVault?.path ?? "");
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
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianStatus>(
    settings.obsidianVault?.enabled &&
      (settings.obsidianVault?.path || settings.obsidianVault?.localDirectoryUri)
      ? "ok"
      : "idle"
  );
  const [obsidianMessage, setObsidianMessage] = useState<string | null>(null);
  const [obsidianChecking, setObsidianChecking] = useState(false);
  const [detectedVaults, setDetectedVaults] = useState<DetectedVault[]>([]);

  const [headlessStep, setHeadlessStep] = useState<HeadlessStep>("checking");
  const [headlessEmail, setHeadlessEmail] = useState("");
  const [headlessPassword, setHeadlessPassword] = useState("");
  const [headlessMfa, setHeadlessMfa] = useState("");
  const [headlessRemoteVaults, setHeadlessRemoteVaults] = useState<RemoteVault[]>([]);
  const [headlessMessage, setHeadlessMessage] = useState<string | null>(null);
  const [headlessBusy, setHeadlessBusy] = useState(false);

  // Theme lives in the store (commits immediately). We only snapshot it here
  // so revert can restore the pre-edit values.
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
    obsidianProvider: (settings.obsidianVault?.provider ?? "sync") as ObsidianProvider,
    obsidianPath: settings.obsidianVault?.path ?? "",
    obsidianLocalUri: settings.obsidianVault?.localDirectoryUri ?? "",
    obsidianLocalDisplay: settings.obsidianVault?.localDisplayPath ?? "",
    obsidianUseForMemory: settings.obsidianVault?.useForMemory ?? true,
    obsidianUseForReference: settings.obsidianVault?.useForReference ?? true,
    obsidianUseMcpVault: settings.obsidianVault?.useMcpVault ?? false,
  });

  // Re-hydrate draft values once persist finishes rehydrating from disk.
  useEffect(() => {
    if (!_hasHydrated) return;
    setServerUrl(settings.serverUrl);
    setBearerToken(settings.bearerToken);
    setAutoCompact(settings.autoCompact ?? true);
    setStreamingEnabled(settings.streamingEnabled ?? true);
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
    initialRef.current = {
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
      obsidianProvider: (settings.obsidianVault?.provider ?? "sync") as ObsidianProvider,
      obsidianPath: settings.obsidianVault?.path ?? "",
      obsidianLocalUri: settings.obsidianVault?.localDirectoryUri ?? "",
      obsidianLocalDisplay: settings.obsidianVault?.localDisplayPath ?? "",
      obsidianUseForMemory: settings.obsidianVault?.useForMemory ?? true,
      obsidianUseForReference: settings.obsidianVault?.useForReference ?? true,
      obsidianUseMcpVault: settings.obsidianVault?.useMcpVault ?? false,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_hasHydrated]);

  // Persist draft to store on every change via a ref so the save never causes
  // a re-render cycle. The ref is flushed on unmount (modal close).
  const pendingRef = useRef({
    serverUrl, bearerToken, queue, autoCompact, streamingEnabled,
    autoCompactThreshold, telemetryEnabled, autoContinueEnabled,
    obsidianEnabled, obsidianProvider, obsidianPath, obsidianLocalUri,
    obsidianLocalDisplay, obsidianUseForMemory, obsidianUseForReference,
    obsidianUseMcpVault,
  });
  pendingRef.current = {
    serverUrl, bearerToken, queue, autoCompact, streamingEnabled,
    autoCompactThreshold, telemetryEnabled, autoContinueEnabled,
    obsidianEnabled, obsidianProvider, obsidianPath, obsidianLocalUri,
    obsidianLocalDisplay, obsidianUseForMemory, obsidianUseForReference,
    obsidianUseMcpVault,
  };

  useEffect(() => {
    return () => {
      const s = pendingRef.current;
      actions.setSettings({
        serverUrl: s.serverUrl,
        bearerToken: s.bearerToken,
        modelQueue: s.queue,
        autoCompact: s.autoCompact,
        streamingEnabled: s.streamingEnabled,
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

  // ── Connection ───────────────────────────────────────────────────────────

  const commitConnectionToStore = (next: { serverUrl: string; bearerToken: string }) => {
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
    commitConnectionToStore({
      serverUrl: normalizeServerUrl(serverUrl),
      bearerToken,
    });
  };

  const [connTesting, setConnTesting] = useState(false);
  const testConnection = async () => {
    const url = normalizeServerUrl(serverUrl);
    if (!url || !bearerToken) {
      setConnMessage("Set server URL and token first.");
      setConnStatus("error");
      return;
    }
    if (url !== serverUrl) setServerUrl(url);
    setConnTesting(true);
    setConnStatus("idle");
    setConnMessage(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${url}/health`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      commitConnectionToStore({ serverUrl: url, bearerToken });
      setConnMessage(`Connected — ${data.service ?? "ok"}`);
      setConnStatus("ok");
    } catch (err: any) {
      setConnMessage(
        err?.name === "AbortError" ? "Connection timed out" : (err.message ?? "Connection failed")
      );
      setConnStatus("error");
    } finally {
      setConnTesting(false);
    }
  };

  // ── Queue ────────────────────────────────────────────────────────────────

  const activeServerUrl = useMemo(
    () => normalizeServerUrlForMatch(serverUrl),
    [serverUrl]
  );
  const visibleQueue = useMemo(
    () => queue.filter((e) => modelEntryMatchesBackend(e, activeServerUrl)),
    [queue, activeServerUrl]
  );
  const enabledCount = visibleQueue.filter((e) => e.enabled).length;

  const moveUpById = (id: string) =>
    setQueue((q) => {
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
    setQueue((q) => [...q, { ...entry, serverUrl: activeServerUrl || undefined }]);

  // ── Obsidian ─────────────────────────────────────────────────────────────

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
        setObsidianMessage(
          data.reason ?? data.error ?? `Server returned ${res.status}`
        );
        setObsidianStatus("error");
      } else {
        const n = data.noteCount ?? 0;
        setObsidianMessage(`Connected — ${n} note${n === 1 ? "" : "s"} found`);
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
        setObsidianMessage('No vaults found — tap "Create vault" to set one up.');
      } else if (data.vaults.length === 1) {
        const v = data.vaults[0];
        setObsidianPath(v.path);
        await validateObsidianBackend(v.path);
        return;
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
          "Vault created and connected. To sync with Obsidian on your devices, set up git sync — see the Welcome note inside the vault for instructions."
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

  // ── Headless (Obsidian Sync) ─────────────────────────────────────────────

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

  const loadRemoteVaults = async () => {
    try {
      const data = await headlessApi("/vaults");
      setHeadlessRemoteVaults(data.vaults ?? []);
    } catch {
      // ignore
    }
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

      setHeadlessMessage("Running initial sync…");
      await headlessApi("/sync", "POST", { path: localPath });

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

  // Kick off headless status check on mount if sync provider is selected.
  useEffect(() => {
    if (obsidianProvider === "sync" && serverUrl && bearerToken) {
      checkHeadlessStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Revert ───────────────────────────────────────────────────────────────

  const hasChanges =
    serverUrl !== initialRef.current.serverUrl ||
    bearerToken !== initialRef.current.bearerToken ||
    autoCompact !== initialRef.current.autoCompact ||
    streamingEnabled !== initialRef.current.streamingEnabled ||
    (settings.darkMode ?? "system") !== initialRef.current.darkMode ||
    (settings.accentTheme ?? "lavender") !== initialRef.current.accentTheme ||
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
    commitConnectionToStore({
      serverUrl: s.serverUrl,
      bearerToken: s.bearerToken,
    });
    // Theme commits immediately to the store, so revert must also push it back.
    actions.setSettings({
      serverUrl: s.serverUrl,
      bearerToken: s.bearerToken,
      darkMode: s.darkMode,
      accentTheme: s.accentTheme,
    });
    setQueue(s.queue);
    setAutoCompact(s.autoCompact);
    setStreamingEnabled(s.streamingEnabled);
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
      s.obsidianEnabled && (s.obsidianPath || s.obsidianLocalUri) ? "ok" : "idle"
    );
    setObsidianMessage(null);
    setDetectedVaults([]);
    setHeadlessMessage(null);
    setHeadlessStep("checking");
  };

  // ── Context value ────────────────────────────────────────────────────────

  const value: SettingsFormValue = {
    serverUrl,
    setServerUrl,
    bearerToken,
    setBearerToken,
    connStatus,
    connMessage,
    connTesting,
    testConnection,
    handleServerUrlBlur,
    handleBearerTokenBlur,

    queue,
    visibleQueue,
    enabledCount,
    activeServerUrl,
    moveUpById,
    moveDownById,
    toggleEntryById,
    deleteEntryById,
    addEntry,
    addModelExpanded,
    setAddModelExpanded,

    autoCompact,
    setAutoCompact,
    autoCompactThreshold,
    setAutoCompactThreshold,
    streamingEnabled,
    setStreamingEnabled,
    autoContinueEnabled,
    setAutoContinueEnabled,
    telemetryEnabled,
    setTelemetryEnabled,

    obsidianEnabled,
    setObsidianEnabled,
    obsidianProvider,
    setObsidianProvider,
    obsidianPath,
    setObsidianPath,
    obsidianLocalUri,
    setObsidianLocalUri,
    obsidianLocalDisplay,
    setObsidianLocalDisplay,
    obsidianUseForMemory,
    setObsidianUseForMemory,
    obsidianUseForReference,
    setObsidianUseForReference,
    obsidianUseMcpVault,
    setObsidianUseMcpVault,
    obsidianStatus,
    setObsidianStatus,
    obsidianMessage,
    setObsidianMessage,
    obsidianChecking,
    detectedVaults,
    setDetectedVaults,
    validateObsidianBackend,
    detectVaultsOnBackend,
    createVaultOnBackend,
    pickLocalVault,

    headlessStep,
    setHeadlessStep,
    headlessEmail,
    setHeadlessEmail,
    headlessPassword,
    setHeadlessPassword,
    headlessMfa,
    setHeadlessMfa,
    headlessRemoteVaults,
    headlessMessage,
    setHeadlessMessage,
    headlessBusy,
    checkHeadlessStatus,
    installHeadless,
    headlessLogin,
    headlessSetupAndSync,

    hasChanges,
    revert,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
