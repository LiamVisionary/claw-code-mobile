import { useEffect, useState } from "react";
import type { ModelEntry } from "@/store/gatewayStore";

/**
 * Per-session cache of OpenRouter's `/api/v1/models` response. Keyed
 * by the slash-prefixed model id OpenRouter uses (e.g. `openai/gpt-4o`).
 * Populated lazily on first call and refreshed after an hour so newly
 * launched vision models don't stay dark for the whole session.
 */
type ModalitySet = {
  supportsImage: boolean;
};

let openRouterCache: {
  fetchedAt: number;
  map: Map<string, ModalitySet>;
} | null = null;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadOpenRouterCapabilities(): Promise<Map<string, ModalitySet>> {
  if (openRouterCache && Date.now() - openRouterCache.fetchedAt < CACHE_TTL_MS) {
    return openRouterCache.map;
  }
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{
      id?: string;
      architecture?: {
        input_modalities?: string[];
        modality?: string;
      };
    }>;
  };
  const map = new Map<string, ModalitySet>();
  for (const m of json.data ?? []) {
    if (!m.id) continue;
    const inputs = m.architecture?.input_modalities ?? [];
    // Some older entries use a combined `modality` string like
    // "text+image->text" instead of `input_modalities`. Handle both.
    const modalityString = m.architecture?.modality ?? "";
    const supportsImage =
      inputs.includes("image") || /image/i.test(modalityString);
    map.set(m.id, { supportsImage });
  }
  openRouterCache = { fetchedAt: Date.now(), map };
  return map;
}

/**
 * Known-vision-capable Anthropic models. All modern Claude models
 * accept images via the Messages API, so we short-circuit the
 * OpenRouter metadata lookup for direct-Claude entries.
 */
const ANTHROPIC_VISION_PATTERNS = [/claude-3/i, /claude-4/i, /claude-opus/i, /claude-sonnet/i, /claude-haiku/i];

function defaultCapabilitiesFor(model: ModelEntry | null): ModalitySet {
  if (!model) return { supportsImage: false };
  if (model.provider === "claude") {
    return {
      supportsImage: ANTHROPIC_VISION_PATTERNS.some((p) => p.test(model.name)),
    };
  }
  // Local providers: can't know, assume no vision until proven
  // otherwise. OpenRouter falls back to the async lookup below.
  if (model.provider === "local") return { supportsImage: false };
  return { supportsImage: false };
}

export function useModelCapabilities(model: ModelEntry | null): ModalitySet & {
  loading: boolean;
} {
  const [caps, setCaps] = useState<ModalitySet>(() => defaultCapabilitiesFor(model));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCaps(defaultCapabilitiesFor(model));
    if (!model || model.provider !== "openrouter") return;
    setLoading(true);
    loadOpenRouterCapabilities()
      .then((map) => {
        if (cancelled) return;
        const entry = map.get(model.name);
        if (entry) setCaps(entry);
      })
      .catch(() => {
        // Network or parse failure — leave defaults (no vision).
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [model?.provider, model?.name]);

  return { ...caps, loading };
}
