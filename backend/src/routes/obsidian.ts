import { Router } from "express";
import { z } from "zod";
import { getProvider, validate } from "../services/vaultService";
import { detectVaults, initializeVault } from "../services/vault/filesystemVault";
import * as headless from "../services/vault/headlessSync";
import { saveVaultConfig, clearVaultConfig } from "../services/vault/headlessSync";

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

/**
 * List markdown notes in the vault. Returns vault-relative paths sorted
 * alphabetically so the mobile chat-list screen can show a "Notes" view.
 */
obsidianRouter.get("/obsidian/notes", async (req, res, next) => {
  try {
    const vaultPath = (req.query.path as string | undefined)?.trim();
    if (!vaultPath) {
      res.status(400).json({ error: "path query param required" });
      return;
    }
    const provider = getProvider({ path: vaultPath });
    const notes = await provider.listNotes();
    res.json({ notes });
  } catch (err) {
    next(err);
  }
});

/** Read a single note by vault-relative path. */
obsidianRouter.get("/obsidian/notes/read", async (req, res, next) => {
  try {
    const vaultPath = (req.query.path as string | undefined)?.trim();
    const notePath = (req.query.note as string | undefined)?.trim();
    if (!vaultPath || !notePath) {
      res.status(400).json({ error: "path and note query params required" });
      return;
    }
    const provider = getProvider({ path: vaultPath });
    const note = await provider.readNote(notePath);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
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
      const validation = await validate({ path: result.path });
      res.json({ ...result, noteCount: validation.noteCount ?? 0 });
    }
  } catch (err) {
    next(err);
  }
});

// ── Headless Sync (obsidian-headless / `ob` CLI) ────────────────────

/** Get headless sync status: installed, logged in, syncing, etc. */
obsidianRouter.get("/obsidian/headless/status", (_req, res) => {
  res.json(headless.getSyncStatus());
});

/** Install obsidian-headless globally via npm. */
obsidianRouter.post("/obsidian/headless/install", async (_req, res) => {
  const result = await headless.install();
  res.status(result.ok ? 200 : 500).json(result);
});

/** Log in to Obsidian account. */
obsidianRouter.post("/obsidian/headless/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    mfa: z.string().optional(),
  });
  try {
    const body = schema.parse(req.body);
    const result = await headless.login(body.email, body.password, body.mfa);
    res.status(result.ok ? 200 : 401).json(result);
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err?.message ?? "Invalid input" });
  }
});

/** Log out of Obsidian account. */
obsidianRouter.post("/obsidian/headless/logout", (_req, res) => {
  clearVaultConfig();
  res.json(headless.logout());
});

/** List remote vaults available to the logged-in account. */
obsidianRouter.get("/obsidian/headless/vaults", (_req, res) => {
  const vaults = headless.listRemoteVaults();
  res.json({ vaults });
});

/** Set up sync between a local path and a remote vault. */
obsidianRouter.post("/obsidian/headless/setup", async (req, res) => {
  const schema = z.object({
    vault: z.string().min(1),
    path: z.string().optional(),
    password: z.string().optional(),
  });
  try {
    const body = schema.parse(req.body);
    const localPath = body.path || "~/Obsidian/claw-vault";
    // Initialize the local vault folder if it doesn't exist
    const initResult = await initializeVault(localPath);
    if (!initResult.ok) {
      res.status(400).json(initResult);
      return;
    }
    const result = await headless.setupSync(
      body.vault,
      initResult.path,
      body.password,
      "claw-code-mobile"
    );
    if (result.ok) {
      saveVaultConfig(initResult.path);
    }
    res.status(result.ok ? 200 : 400).json({
      ...result,
      localPath: initResult.path,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err?.message ?? "Invalid input" });
  }
});

/** Run a one-time sync. */
obsidianRouter.post("/obsidian/headless/sync", async (req, res) => {
  const schema = z.object({ path: z.string().min(1) });
  try {
    const body = schema.parse(req.body);
    const result = await headless.syncOnce(body.path);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err?.message ?? "Invalid input" });
  }
});

/** Start continuous sync as a background daemon. */
obsidianRouter.post("/obsidian/headless/sync/start", async (req, res) => {
  const schema = z.object({ path: z.string().min(1) });
  try {
    const body = schema.parse(req.body);
    const result = headless.startContinuousSync(body.path);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ ok: false, message: err?.message ?? "Invalid input" });
  }
});

/** Stop continuous sync. */
obsidianRouter.post("/obsidian/headless/sync/stop", (_req, res) => {
  res.json(headless.stopContinuousSync());
});
