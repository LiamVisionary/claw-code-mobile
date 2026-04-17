import { Router } from "express";
import { z } from "zod";
import { validate } from "../services/vaultService";
import { detectVaults, initializeVault } from "../services/vault/filesystemVault";

export const obsidianRouter = Router();

const validateSchema = z.object({
  path: z.string().min(1),
});

obsidianRouter.post("/obsidian/validate", async (req, res, next) => {
  try {
    const body = validateSchema.parse(req.body);
    const result = await validate({ path: body.path });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Scan common locations for Obsidian vaults on the backend host. */
obsidianRouter.get("/obsidian/detect", async (_req, res, next) => {
  try {
    const vaults = await detectVaults();
    res.json({ vaults });
  } catch (err) {
    next(err);
  }
});

const initSchema = z.object({
  path: z.string().optional(),
});

/** Create and initialize a new Obsidian vault. Uses ~/Obsidian/claw-vault if no path given. */
obsidianRouter.post("/obsidian/init", async (req, res, next) => {
  try {
    const body = initSchema.parse(req.body);
    const vaultPath = body.path || "~/Obsidian/claw-vault";
    const result = await initializeVault(vaultPath);
    if (!result.ok) {
      res.status(400).json(result);
    } else {
      // Also validate so we return noteCount
      const validation = await validate({ path: result.path });
      res.json({ ...result, noteCount: validation.noteCount ?? 0 });
    }
  } catch (err) {
    next(err);
  }
});
