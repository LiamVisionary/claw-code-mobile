import { Router } from "express";
import fs from "fs";
import os from "os";
import path from "path";

export const fsRouter = Router();

fsRouter.get("/fs/browse", (req, res) => {
  const rawPath = (req.query.path as string) || os.homedir();
  const target = path.resolve(rawPath);

  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      res.status(400).json({ error: "Not a directory" });
      return;
    }

    const names = fs.readdirSync(target, { withFileTypes: true });
    const entries = names
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: path.join(target, e.name),
        isDir: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const parent = target !== path.parse(target).root
      ? path.dirname(target)
      : null;

    res.json({ path: target, parent, entries });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Cannot read directory" });
  }
});
