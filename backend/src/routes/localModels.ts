import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../utils/errors";
import { logger } from "../utils/logger";

export const localModelsRouter = Router();

const discoverSchema = z.object({
  /**
   * Scan a specific URL instead of the backend's own loopback. Used by the
   * "Other" mode in the mobile UI when a model runner lives on a different
   * host from the backend.
   */
  baseUrl: z.string().url().optional(),
});

/**
 * Discover models installed on an OpenAI-compatible local runner.
 *
 * Two modes:
 * - **Same-host** (default, no `baseUrl`): probe the backend's own loopback
 *   on all known local-runner ports (Ollama, LM Studio, llama.cpp, vLLM)
 *   and return everything found. This is what the phone hits when the user
 *   picks "Current backend" in the Local Model form — the assumption is
 *   that the model runner lives on the same machine as the backend.
 * - **Custom URL** (`baseUrl` given): probe only that URL. Used by the
 *   "Other" mode for cross-host setups (e.g. VPS backend + Ollama on a
 *   different box).
 *
 * Response shape is always an array of runners, so the caller can show a
 * flat pill list even when multiple runners are active side-by-side.
 */
localModelsRouter.post("/local-models/discover", async (req, res, next) => {
  try {
    const body = discoverSchema.parse(req.body ?? {});
    const candidates = body.baseUrl ? [body.baseUrl] : SAME_HOST_CANDIDATES;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const runners: RunnerResult[] = [];
      // Probe candidates in parallel — most won't be listening, so this
      // finishes as fast as the slowest live runner (not the sum).
      const results = await Promise.all(
        candidates.map((url) => probeCandidate(url, controller.signal))
      );
      for (const result of results) {
        if (result) runners.push(result);
      }

      if (runners.length === 0) {
        if (body.baseUrl) {
          throw new HttpError(
            502,
            `No OpenAI-compatible runner answered at ${body.baseUrl}. Is Ollama / LM Studio running?`
          );
        }
        throw new HttpError(
          502,
          `No local model runner found on the backend host. Start Ollama / LM Studio / llama.cpp and try again.`
        );
      }

      return res.json({ runners });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return next(
        new HttpError(
          504,
          `Timed out trying to reach local runner${req.body?.baseUrl ? ` at ${req.body.baseUrl}` : "s on this host"}.`
        )
      );
    }
    next(err);
  }
});

type DiscoveredModel = {
  name: string;
  sizeBytes?: number;
  modifiedAt?: string;
  parameterSize?: string;
  quantization?: string;
};

type RunnerResult = {
  runner: "ollama" | "openai-compat";
  endpoint: string;
  models: DiscoveredModel[];
};

/**
 * Ports we'll try when the caller asks for a same-host scan. Ordered by
 * what users are most likely to have installed; each maps to that runner's
 * default port. The scan is parallel so order only matters for ties.
 */
const SAME_HOST_CANDIDATES = [
  "http://127.0.0.1:11434", // Ollama
  "http://127.0.0.1:1234",  // LM Studio
  "http://127.0.0.1:8080",  // llama.cpp server
  "http://127.0.0.1:8000",  // vLLM
];

async function probeCandidate(
  rawUrl: string,
  signal: AbortSignal
): Promise<RunnerResult | null> {
  const baseUrl = rawUrl.replace(/\/$/, "");

  const ollama = await tryOllama(baseUrl, signal);
  if (ollama) {
    return {
      runner: "ollama",
      endpoint: `${baseUrl}/v1`,
      models: ollama,
    };
  }

  const openai = await tryOpenAi(baseUrl, signal);
  if (openai) {
    return {
      runner: "openai-compat",
      endpoint: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      models: openai,
    };
  }

  return null;
}

async function tryOllama(baseUrl: string, signal: AbortSignal): Promise<DiscoveredModel[] | null> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      models?: Array<{
        name: string;
        size?: number;
        modified_at?: string;
        details?: { parameter_size?: string; quantization_level?: string };
      }>;
    };
    if (!data.models) return null;
    return data.models.map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      modifiedAt: m.modified_at,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
    }));
  } catch (err) {
    logger.debug({ err, baseUrl }, "Ollama discovery failed");
    return null;
  }
}

async function tryOpenAi(baseUrl: string, signal: AbortSignal): Promise<DiscoveredModel[] | null> {
  try {
    // LM Studio / llama.cpp serve `/v1/models`; some also serve `/models`.
    const candidates = baseUrl.endsWith("/v1") ? [baseUrl] : [`${baseUrl}/v1`, baseUrl];
    for (const root of candidates) {
      const response = await fetch(`${root}/models`, { signal });
      if (!response.ok) continue;
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      if (!data.data) continue;
      return data.data.map((m) => ({ name: m.id }));
    }
    return null;
  } catch (err) {
    logger.debug({ err, baseUrl }, "OpenAI-compat discovery failed");
    return null;
  }
}
