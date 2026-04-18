/**
 * Per-backend model-queue scoping helpers — pure functions only, no
 * runtime/expo deps so they're trivially unit-testable.
 *
 * Each model entry in the queue carries the gateway URL it was added
 * under. The Settings UI shows only entries matching the active gateway,
 * dispatch in `sendMessage` only fires entries matching the active
 * gateway, and dedupe is relaxed within a backend so the same model name
 * can be registered against multiple endpoints.
 */

/** Subset of ModelEntry the helpers actually inspect. */
export type ScopedEntry = {
  serverUrl?: string;
  enabled?: boolean;
};

/**
 * Normalize a server URL for comparison: trim whitespace, default the
 * scheme to `http://`, drop trailing slashes. Both sides of any
 * entry/server-url match must be normalized the same way or strings that
 * mean the same thing (`192.168.1.9:5000` vs `http://192.168.1.9:5000/`)
 * will be treated as different backends.
 */
export function normalizeServerUrlForMatch(
  raw: string | undefined | null
): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * Whether a model entry belongs to the given normalized backend URL.
 * Entries without a `serverUrl` stamp are treated as universal so
 * existing setups don't lose their queue on the first load after this
 * scoping landed. Migration (in onRehydrateStorage) stamps them on
 * next save.
 */
export function modelEntryMatchesBackend(
  entry: ScopedEntry,
  normalizedActiveUrl: string
): boolean {
  if (!entry.serverUrl) return true;
  return normalizeServerUrlForMatch(entry.serverUrl) === normalizedActiveUrl;
}

/**
 * Migrate a model queue: any entry without a `serverUrl` stamp gets the
 * given active URL applied. Returns `null` when nothing needs to change
 * so callers can avoid unnecessary state writes.
 */
export function stampUnstampedEntries<T extends ScopedEntry>(
  queue: readonly T[],
  activeServerUrl: string
): T[] | null {
  if (!activeServerUrl) return null;
  if (!queue.some((e) => !e.serverUrl)) return null;
  return queue.map((e) => (e.serverUrl ? e : { ...e, serverUrl: activeServerUrl }));
}

/**
 * The slice of the queue that should actually fire on this run: enabled,
 * and either matching the active backend or universal (legacy unstamped).
 * Order is preserved.
 */
export function selectQueueForBackend<T extends ScopedEntry>(
  queue: readonly T[],
  normalizedActiveUrl: string
): T[] {
  return queue.filter(
    (e) => (e.enabled ?? false) && modelEntryMatchesBackend(e, normalizedActiveUrl)
  );
}
