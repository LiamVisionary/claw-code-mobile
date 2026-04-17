import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../utils/errors";
import { logger } from "../utils/logger";

export const localModelsRouter = Router();

const discoverSchema = z.object({
  baseUrl: z.string().url().optional(),
});

/**
 * Discover models installed on a local OpenAI-compatible runner. We try the
 * Ollama `/api/tags` shape first (richest metadata) and fall back to the
 * OpenAI `/v1/models` shape for LM Studio / llama.cpp / vLLM so the picker
 * works against anything that speaks either dialect.
 *
 * The URL the user eventually stores in their model queue is the
 * OpenAI-compatible /v1 variant — that's what claw's openai-compat client
 * targets — so we normalize that here regardless of which discovery endpoint
 * answered.
 */
localModelsRouter.post("/local-models/discover", async (req, res, next) => {
  try {
    const body = discoverSchema.parse(req.body ?? {});
    const baseUrl = (body.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const ollama = await tryOllama(baseUrl, controller.signal);
      if (ollama) {
        clearTimeout(timer);
        return res.json({
          runner: "ollama",
          endpoint: `${baseUrl}/v1`,
          models: ollama,
        });
      }

      const openai = await tryOpenAi(baseUrl, controller.signal);
      if (openai) {
        clearTimeout(timer);
        return res.json({
          runner: "openai-compat",
          endpoint: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
          models: openai,
        });
      }

      throw new HttpError(
        502,
        `No OpenAI-compatible runner answered at ${baseUrl}. Is Ollama / LM Studio running?`
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return next(
        new HttpError(504, `Timed out trying to reach local runner at ${req.body?.baseUrl ?? "127.0.0.1"}.`)
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
