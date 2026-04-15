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
  if (!url || !(url.startsWith("exp://") || url.startsWith("exp+https://"))) {
    return res.status(400).json({ error: "Invalid exp:// or exp+https:// URL" });
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
  // Render a landing page with a single big tappable button. A user-gesture
  // click on an <a href="exp+https://..."> is the most reliable way to hand
  // off a custom scheme on iOS; auto-redirects from <head> or HTTP 302s do
  // not reliably launch the target app.
  return res.type("html").send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Open in Expo Go</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:#0d0d0f;color:#e5e7eb;font-family:-apple-system,sans-serif;}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box;}
.card{background:#18181b;border:1px solid #27272a;border-radius:16px;padding:36px 28px;text-align:center;max-width:420px;width:100%;}
h2{margin:0 0 8px;font-size:22px;}
p{color:#a1a1aa;line-height:1.5;margin:0 0 24px;font-size:14px;}
a.btn{display:block;padding:18px 24px;border-radius:14px;background:#6366f1;color:#fff;text-decoration:none;font-weight:700;font-size:17px;}
a.btn:active{background:#4f46e5;}</style></head>
<body><div class="card"><h2>Claw Code Mobile</h2>
<p>Tap below to launch the dev client in Expo Go.</p>
<a class="btn" href="${currentExpUrl}">Open in Expo Go</a></div></body></html>`);
});
