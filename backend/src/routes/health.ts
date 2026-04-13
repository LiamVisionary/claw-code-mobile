import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claw Code Mobile – Gateway</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d0d0f; color: #e5e7eb; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 40px 48px; max-width: 540px; width: 100%; text-align: center; }
    .badge { display: inline-flex; align-items: center; gap: 8px; background: #052e16; color: #4ade80; border: 1px solid #166534; border-radius: 999px; padding: 4px 14px; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    p { color: #71717a; font-size: 15px; line-height: 1.6; margin-bottom: 28px; }
    .endpoints { text-align: left; background: #0d0d0f; border-radius: 10px; padding: 20px; font-size: 13px; }
    .endpoints h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #52525b; margin-bottom: 12px; }
    .endpoint { display: flex; align-items: baseline; gap: 10px; padding: 5px 0; border-bottom: 1px solid #1f1f23; }
    .endpoint:last-child { border-bottom: none; }
    .method { color: #818cf8; font-weight: 700; width: 40px; flex-shrink: 0; }
    .path { color: #e2e8f0; font-family: monospace; }
    .footer { margin-top: 20px; font-size: 12px; color: #3f3f46; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="dot"></span>Gateway Online</div>
    <h1>Claw Code Mobile</h1>
    <p>The Claw gateway server is running. Connect the iOS app via Settings and set the server URL to this address.</p>
    <div class="endpoints">
      <h2>API Endpoints</h2>
      <div class="endpoint"><span class="method">GET</span><span class="path">/health</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/threads</span></div>
      <div class="endpoint"><span class="method">POST</span><span class="path">/threads</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/threads/:id/messages</span></div>
      <div class="endpoint"><span class="method">POST</span><span class="path">/threads/:id/messages</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/threads/:id/stream</span></div>
      <div class="endpoint"><span class="method">POST</span><span class="path">/threads/:id/stop</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/threads/:id/terminal</span></div>
      <div class="endpoint"><span class="method">POST</span><span class="path">/threads/:id/terminal</span></div>
    </div>
    <div class="footer">Auth: Authorization: Bearer &lt;token&gt; on all routes except /health</div>
  </div>
</body>
</html>`);
});

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "claw-mobile-gateway" });
});
