#!/usr/bin/env node
// Unified dev server: backend + expo, with optional tunneling.
//
// TUNNEL=true (default) — opens cloudflared/ngrok tunnels for remote access
// TUNNEL=false          — LAN-only mode (phone must be on same Wi-Fi)
//
// Set TUNNEL=false in .env or pass it inline:
//   TUNNEL=false npm run dev

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

const TUNNEL = (process.env.TUNNEL ?? "true").toLowerCase() !== "false";
const BACKEND_PORT = Number(process.env.PORT || 5000);
const EXPO_PORT = 8081;
const BEARER_TOKEN = process.env.GATEWAY_AUTH_TOKEN || "dev-token";
const PROVIDER = (process.env.TUNNEL_PROVIDER || "cloudflared").toLowerCase();

const children = [];
let shuttingDown = false;

const log = (m) => process.stdout.write(`[dev] ${m}\n`);

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

function spawnTagged(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
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

// ── claw binary preflight ────────────────────────────────────────────────
function buildClawBinary() {
  log("checking claw binary (building on first run; takes a few minutes)...");
  const r = spawnSync("bash", ["scripts/build-claw.sh"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  if (r.status !== 0) {
    console.error("\n[dev] ERROR: failed to build claw binary — check cargo/rust is installed.\n");
    process.exit(1);
  }
}

// ── tunnel providers ─────────────────────────────────────────────────────
function requireBinary(bin, installHint) {
  const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
  if (r.status !== 0) {
    console.error(`\n[dev] ERROR: '${bin}' not found on PATH.\n\n${installHint}\n`);
    process.exit(1);
  }
}

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

function startNgrok(name, localPort, webPort) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ngrok",
      [
        "http", String(localPort),
        "--authtoken", process.env.NGROK_AUTHTOKEN,
        "--log", "stdout", "--log-format", "logfmt",
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

// ── telegram notify ──────────────────────────────────────────────────────
async function sendTelegram(text, entities) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const body = new URLSearchParams({
      chat_id: chatId, text, disable_web_page_preview: "true",
    });
    if (entities?.length) body.set("entities", JSON.stringify(entities));
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (res.ok) log("telegram notification sent");
    else log(`telegram failed: ${res.status}`);
  } catch (err) {
    log(`telegram error: ${err.message}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  buildClawBinary();

  if (!TUNNEL) {
    // ── LAN mode ──
    log("starting in LAN mode (TUNNEL=false)");
    spawnTagged("backend", "npm", ["--prefix", "backend", "run", "dev"], {
      GATEWAY_AUTH_TOKEN: BEARER_TOKEN,
      PORT: String(BACKEND_PORT),
    });
    spawnTagged("expo", "npx", ["expo", "start"]);
    return;
  }

  // ── Tunnel mode ──
  log(`tunnel mode (${PROVIDER})`);

  if (PROVIDER === "cloudflared") {
    requireBinary("cloudflared", "Install: brew install cloudflared (macOS) or see https://github.com/cloudflare/cloudflared/releases");
  } else if (PROVIDER === "ngrok") {
    requireBinary("ngrok", "Install: brew install ngrok or see https://ngrok.com/download");
    if (!process.env.NGROK_AUTHTOKEN) {
      console.error("[dev] ERROR: TUNNEL_PROVIDER=ngrok but NGROK_AUTHTOKEN is not set.");
      process.exit(1);
    }
  }

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

  const useOffline = !process.env.EXPO_TOKEN;
  const expoArgs = ["expo", "start", "--port", String(EXPO_PORT)];
  if (useOffline) expoArgs.push("--offline");

  log("starting expo...");
  spawnTagged("expo", "npx", expoArgs, {
    EXPO_PACKAGER_PROXY_URL: expoUrl,
    EXPO_PUBLIC_GATEWAY_URL: backendUrl,
    EXPO_PUBLIC_GATEWAY_TOKEN: BEARER_TOKEN,
  });

  setTimeout(async () => {
    const expoHost = new URL(expoUrl).host;
    const expGoUrl = `exp://${expoHost}`;
    const openAppUrl = `${backendUrl.replace(/\/+$/, "")}/open-app`;

    try {
      await fetch("http://localhost:5000/open-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: expGoUrl }),
      });
    } catch {}

    const box = [
      "",
      "━".repeat(78),
      "  🚀  Claw Code Mobile",
      "━".repeat(78),
      "",
      "  1. Open Expo Go on your phone",
      "  2. Tap 'Enter URL manually' and paste:",
      "",
      `       ${expGoUrl}`,
      "",
      "  3. Server URL and Bearer Token are auto-configured.",
      "",
      "  Ctrl+C to stop everything.",
      "━".repeat(78),
      "",
    ].join("\n");
    process.stdout.write(box);

    const header = `🚀 Expo dev server ready\n\n`;
    const linkLabel = `Open in Expo Go`;
    const tail =
      `\n\n${expGoUrl}\n\n` +
      `Server URL: ${backendUrl}\n` +
      `Bearer: ${BEARER_TOKEN}`;
    await sendTelegram(header + linkLabel + tail, [{
      type: "text_link",
      offset: header.length,
      length: linkLabel.length,
      url: openAppUrl,
    }]);
  }, 4000);
}

main().catch((err) => {
  console.error("[dev] fatal:", err.message);
  shutdown();
});
