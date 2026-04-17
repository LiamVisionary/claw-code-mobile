import { Router } from "express";
import { z } from "zod";
import { validate } from "../services/vaultService";
import { detectVaults } from "../services/vault/filesystemVault";

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
