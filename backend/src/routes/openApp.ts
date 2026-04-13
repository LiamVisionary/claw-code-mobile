import { Router } from "express";

export const openAppRouter = Router();

let currentExpUrl: string | null = null;

openAppRouter.post("/open-app", (req, res) => {
  const ip = req.socket.remoteAddress ?? "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLocal) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { url } = req.body as { url?: string };
  if (!url || !url.startsWith("exp://")) {
    return res.status(400).json({ error: "Invalid exp:// URL" });
  }
  currentExpUrl = url;
  return res.json({ ok: true });
});

openAppRouter.get("/open-app", (req, res) => {
  if (!currentExpUrl) {
    return res.type("html").send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Expo not started</title>
<style>body{font-family:-apple-system,sans-serif;background:#0d0d0f;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{background:#18181b;border:1px solid #27272a;border-radius:16px;padding:40px;text-align:center;}</style></head>
<body><div class="card"><h2>Expo tunnel not running</h2><p style="color:#71717a;margin-top:12px">Start the Expo Tunnel workflow first.</p></div></body></html>`);
  }
  return res.redirect(302, currentExpUrl);
});
