import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

const isPublic = (path: string) => path === "/health" || path === "/";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (isPublic(req.path)) return next();
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("bearer ".length);
  if (token !== env.authToken) {
    return res.status(401).json({ error: "Invalid token" });
  }
  return next();
}
