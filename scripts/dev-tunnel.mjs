#!/usr/bin/env node
// Remote-server mode: start backend + expo + two tunnels, then print
// (and optionally Telegram-DM) the exact values to paste into Expo Go
// and the app's Settings.
//
// Supports two tunnel providers:
//   cloudflared (default) — no account needed
//   ngrok                 — requires NGROK_AUTHTOKEN
//
// Reads repo-root .env automatically (see .env.example).

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

// ── load .env ─────────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

const BACKEND_PORT = Number(process.env.PORT || 5000);
const EXPO_PORT = 8081;
const BEARER_TOKEN = process.env.GATEWAY_AUTH_TOKEN || "dev-token";
const PROVIDER = (process.env.TUNNEL_PROVIDER || "cloudflared").toLowerCase();

const children = [];
let shuttingDown = false;

const log = (m) => process.stdout.write(`[dev-tunnel] ${m}\n`);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down...");
  for (const c of children) {
    if (!c.killed) try { c.kill("SIGINT"); } catch {}
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── provider checks ───────────────────────────────────────────────────────
function requireBinary(bin, installHint) {
  const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
  if (r.status !== 0) {
    console.error(`\n[dev-tunnel] ERROR: '${bin}' not found on PATH.\n\n${installHint}\n`);
    process.exit(1);
  }
}

if (PROVIDER === "cloudflared") {
  requireBinary("cloudflared", `Install it:
  macOS:   brew install cloudflared
  Linux:   curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared
  Windows: winget install --id Cloudflare.cloudflared`);
} else if (PROVIDER === "ngrok") {
  requireBinary("ngrok", `Install it:
  macOS:   brew install ngrok
  Linux:   https://ngrok.com/download
  Windows: winget install --id Ngrok.Ngrok`);
  if (!process.env.NGROK_AUTHTOKEN) {
    console.error(`\n[dev-tunnel] ERROR: TUNNEL_PROVIDER=ngrok but NGROK_AUTHTOKEN is not set.
Get a free authtoken at https://dashboard.ngrok.com/get-started/your-authtoken
and add it to .env as NGROK_AUTHTOKEN=...\n`);
    process.exit(1);
  }
} else {
  console.error(`[dev-tunnel] Unknown TUNNEL_PROVIDER: ${PROVIDER} (expected 'cloudflared' or 'ngrok')`);
  process.exit(1);
}

// ── process helpers ───────────────────────────────────────────────────────
function spawnTagged(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env, ...env },
  });
  children.push(child);
  const tag = `[${name}] `;
  const pipe = (stream, sink) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        sink.write(tag + buf.slice(0, i + 1));
        buf = buf.slice(i + 1);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      log(`${name} exited (${code}); stopping all.`);
      shutdown();
    }
  });
  return child;
}

// ── cloudflared quick tunnel ──────────────────────────────────────────────
function startCloudflared(name, localPort) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://localhost:${localPort}`, "--no-autoupdate"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    children.push(child);
    let resolved = false;
    const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
    const onData = (d) => {
      const text = d.toString();
      for (const line of text.split("\n")) {
        if (line.trim() && (line.includes("trycloudflare") || /ERR|WRN/.test(line))) {
          process.stdout.write(`[${name}] ${line}\n`);
        }
      }
      const m = text.match(urlRe);
      if (m && !resolved) { resolved = true; resolve(m[0]); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!resolved) reject(new Error(`${name} cloudflared exited before URL (code ${code})`));
      if (!shuttingDown) { log(`${name} exited (${code})`); shutdown(); }
    });
  });
}

// ── ngrok v3 tunnel (standalone binary) ───────────────────────────────────
// Note: ngrok's local API only exposes ONE default :4040 port, so when we run
// two tunnels we run two ngrok processes with two different web-addrs.
function startNgrok(name, localPort, webPort) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ngrok",
      [
        "http",
        String(localPort),
        "--authtoken", process.env.NGROK_AUTHTOKEN,
        "--log", "stdout",
        "--log-format", "logfmt",
        "--web-addr", `127.0.0.1:${webPort}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    children.push(child);
    let resolved = false;
    const urlRe = /url=(https:\/\/[a-z0-9-]+\.ngrok[^\s"]*)/i;
    const onData = (d) => {
      const text = d.toString();
      for (const line of text.split("\n")) {
        if (line.includes("error") || line.includes("url=http")) {
          process.stdout.write(`[${name}] ${line}\n`);
        }
      }
      const m = text.match(urlRe);
      if (m && !resolved) { resolved = true; resolve(m[1]); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!resolved) reject(new Error(`${name} ngrok exited before URL (code ${code})`));
      if (!shuttingDown) { log(`${name} exited (${code})`); shutdown(); }
    });
  });
}

const openTunnel = (name, port, web) =>
  PROVIDER === "ngrok" ? startNgrok(name, port, web) : startCloudflared(name, port);

// ── telegram notify ───────────────────────────────────────────────────────
async function sendTelegram(text, entities) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const body = new URLSearchParams({
      chat_id: chatId,
      text,
      disable_web_page_preview: "true",
    });
    if (entities && entities.length > 0) {
      body.set("entities", JSON.stringify(entities));
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (res.ok) log("telegram notification sent");
    else log(`telegram failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    log(`telegram error: ${err.message}`);
  }
}

// ── claw binary preflight ────────────────────────────────────────────────
// scripts/build-claw.sh is idempotent — it exits immediately when the binary
// already exists, and builds it (cloning if needed) otherwise. Running it
// synchronously here guarantees the backend can serve its first request
// without a "claw binary not found" error.
function buildClawBinary() {
  log("checking claw binary (building on first run; takes a few minutes)...");
  const r = spawnSync("bash", ["scripts/build-claw.sh"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  if (r.status !== 0) {
    console.error("\n[dev-tunnel] ERROR: failed to build claw binary.");
    console.error("[dev-tunnel] Check that cargo/rust is installed and retry.\n");
    process.exit(1);
  }
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  log(`provider: ${PROVIDER}`);

  buildClawBinary();

  log("starting backend gateway...");
  spawnTagged("backend", "npm", ["--prefix", "backend", "run", "dev"], {
    GATEWAY_AUTH_TOKEN: BEARER_TOKEN,
    PORT: String(BACKEND_PORT),
  });

  log("opening tunnels (5–10s)...");
  const [backendUrl, expoUrl] = await Promise.all([
    openTunnel("tunnel:backend", BACKEND_PORT, 4040),
    openTunnel("tunnel:expo", EXPO_PORT, 4041),
  ]);

  // Prefer EXPO_TOKEN (proper fix) over --offline (workaround)
  const useOffline = !process.env.EXPO_TOKEN;
  const expoArgs = ["expo", "start", "--port", String(EXPO_PORT)];
  if (useOffline) expoArgs.push("--offline");

  log(`starting expo${useOffline ? " (offline mode — set EXPO_TOKEN for full mode)" : ""}...`);
  spawnTagged("expo", "npx", expoArgs, {
    EXPO_PACKAGER_PROXY_URL: expoUrl,
    // Bake the tunnel's public backend URL + bearer into the JS bundle so
    // the app auto-configures its Server URL / Bearer Token on launch. The
    // store's rehydration logic always prefers these env vars when set.
    EXPO_PUBLIC_GATEWAY_URL: backendUrl,
    EXPO_PUBLIC_GATEWAY_TOKEN: BEARER_TOKEN,
  });

  setTimeout(async () => {
    const expoHost = new URL(expoUrl).host;
    const expGoUrl = `exp://${expoHost}`;
    const openAppUrl = `${backendUrl.replace(/\/+$/, "")}/open-app`;

    // Register the exp URL with the backend. GET /open-app will serve an HTML
    // landing page with a visible "Open in Expo Go" button whose href is the
    // exp:// URL. Telegram rejects exp:// in any clickable form (parse_mode
    // anchors, text_link entities, auto-link), so we MUST hop through this
    // https landing page — Telegram accepts https in text_link just fine.
    try {
      const r = await fetch("http://localhost:5000/open-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: expGoUrl }),
      });
      if (!r.ok) log(`open-app register failed: ${r.status}`);
    } catch (err) {
      log(`open-app register error: ${err.message}`);
    }
    const box = [
      "",
      "━".repeat(78),
      "  🚀  Claw Code Mobile — Remote Tunnel Mode",
      "━".repeat(78),
      "",
      "  1. Open Expo Go on your phone",
      "  2. Tap 'Enter URL manually' and paste:",
      "",
      `       ${expGoUrl}`,
      "",
      "  3. Once the app loads, go to Settings and set:",
      "",
      `       Server URL:    ${backendUrl}`,
      `       Bearer Token:  ${BEARER_TOKEN}`,
      "",
      "  Ctrl+C to stop everything.",
      "━".repeat(78),
      "",
    ].join("\n");
    process.stdout.write(box);

    // Telegram refuses to make exp:// URLs tappable in ANY form (parse_mode
    // anchors, MarkdownV2 links, text_link entities, and plain-text
    // auto-linking all fail). The workaround: use a text_link entity whose
    // URL is an https link to the backend's /open-app landing page; the
    // landing page then has the exp:// button the user taps through to.
    const header = `🚀 Expo dev server ready\n\n`;
    const linkLabel = `Open in Expo Go`;
    const tail =
      `\n\n${expGoUrl}\n\n` +
      `Server URL: ${backendUrl}\n` +
      `Bearer: ${BEARER_TOKEN}`;
    const text = header + linkLabel + tail;
    const entities = [
      {
        type: "text_link",
        offset: header.length,
        length: linkLabel.length,
        url: openAppUrl,
      },
    ];
    await sendTelegram(text, entities);
  }, 4000);
}

main().catch((err) => {
  console.error("[dev-tunnel] fatal:", err.message);
  shutdown();
});
