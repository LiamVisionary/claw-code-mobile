import express, { Router } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { threadService } from "../services/threadService";
import { resolveThreadCwd } from "../runtime/clawRuntime";
import { HttpError } from "../utils/errors";
import { logger } from "../utils/logger";
import { createId } from "../utils/ids";

export const uploadsRouter = Router();

// Raise the JSON body limit on this router only — images can easily
// exceed Express's 100 KB default once base64-encoded.
uploadsRouter.use(express.json({ limit: "40mb" }));

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB hard cap per upload

function classifyKind(filename: string, mime: string): "image" | "file" {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${createId("up").slice(0, 10)}-${base || "file"}`;
}

const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  dataBase64: z.string().min(1),
});

const attachServerFileSchema = z.object({
  path: z.string().min(1),
});

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "application/xml",
};

function mimeFromExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

uploadsRouter.post("/threads/:threadId/attach-server-file", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) throw new HttpError(404, "Thread not found");

    const body = attachServerFileSchema.parse(req.body);
    const fullPath = path.resolve(body.path);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      throw new HttpError(404, "File not found");
    }
    if (!stat.isFile()) throw new HttpError(400, "Not a file");
    if (stat.size > MAX_BYTES) {
      throw new HttpError(413, `file exceeds ${MAX_BYTES} bytes`);
    }

    const fileName = path.basename(fullPath);
    const mime = mimeFromExt(fileName);
    const kind = classifyKind(fileName, mime);

    const cwd = resolveThreadCwd(thread.id);
    // If the file is inside cwd, use a clean relative path; otherwise
    // keep the absolute path so the agent's prompt note doesn't end up
    // with ugly `../../` traversal that's harder to read.
    const rel = path.relative(cwd, fullPath);
    const relativePath = rel.startsWith("..") || path.isAbsolute(rel) ? fullPath : rel;

    logger.info(
      { threadId: thread.id, path: fullPath, bytes: stat.size, kind },
      "server file attached"
    );

    res.json({
      ok: true,
      path: fullPath,
      relativePath,
      fileName,
      mimeType: mime,
      size: stat.size,
      kind,
    });
  } catch (err) {
    next(err);
  }
});

uploadsRouter.post("/threads/:threadId/upload", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) throw new HttpError(404, "Thread not found");

    const body = uploadBodySchema.parse(req.body);
    const bytes = Buffer.from(body.dataBase64, "base64");
    if (bytes.length > MAX_BYTES) {
      throw new HttpError(413, `upload exceeded ${MAX_BYTES} bytes`);
    }

    const cwd = resolveThreadCwd(thread.id);
    const uploadsDir = path.join(cwd, ".uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });

    const stored = safeFilename(body.fileName);
    const fullPath = path.join(uploadsDir, stored);
    fs.writeFileSync(fullPath, bytes);

    const mime = body.mimeType || "application/octet-stream";
    const kind = classifyKind(body.fileName, mime);
    const relativePath = path.relative(cwd, fullPath);

    logger.info(
      {
        threadId: thread.id,
        fileName: body.fileName,
        bytes: bytes.length,
        kind,
      },
      "upload saved"
    );

    res.json({
      ok: true,
      path: fullPath,
      relativePath,
      fileName: body.fileName,
      mimeType: mime,
      size: bytes.length,
      kind,
    });
  } catch (err) {
    next(err);
  }
});
