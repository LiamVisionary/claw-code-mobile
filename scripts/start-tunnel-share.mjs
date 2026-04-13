#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const ansiRegex = /\x1B\[[0-9;]*m/g;
const urlRegex = /(exp(?:s)?:\/\/[^\s"'`]+)/i;
const maxTunnelStartRetries = 3;
const devPort = Number(process.env.EXPO_DEV_PORT || 8081);
const expoPorts = [devPort, 19000, 19001, 19002];

let sent = false;
const require = createRequire(import.meta.url);

function stripAnsi(input) {
  return input.replace(ansiRegex, "");
}

function buildOpenLink(expoUrl) {
  return `https://expo.dev/--/open?url=${encodeURIComponent(expoUrl)}`;
}

async function postForm(url, fields, basicAuth) {
  const body = new URLSearchParams(fields);
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (basicAuth) {
    const token = Buffer.from(`${basicAuth.username}:${basicAuth.password}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
}

async function sendTelegram(html) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { skipped: true, reason: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  console.log(`[share] Sending Telegram message to chat ${chatId}...`);
  await postForm(url, {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: "true",
  });
  return { skipped: false };
}

async function sendTwilioSms(text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.TWILIO_TO_NUMBER;

  if (!sid || !authToken || !from || !to) {
    return {
      skipped: true,
      reason: "Missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER/TWILIO_TO_NUMBER",
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  await postForm(
    url,
    {
      From: from,
      To: to,
      Body: text,
    },
    {
      username: sid,
      password: authToken,
    }
  );

  return { skipped: false };
}

async function registerWithBackend(expoUrl) {
  try {
    const res = await fetch("http://localhost:5000/open-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: expoUrl }),
    });
    if (!res.ok) {
      console.log(`[share] Backend register failed (${res.status})`);
    }
  } catch {
    console.log("[share] Backend not reachable, skipping /open-app registration");
  }
}

async function notify(expoUrl) {
  await registerWithBackend(expoUrl);

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  const redirectUrl = devDomain ? `https://${devDomain}/open-app` : null;

  const linkLine = redirectUrl
    ? `<a href="${redirectUrl}">Open in Expo Go</a>`
    : `<a href="${expoUrl}">Open in Expo Go</a>`;

  const html = `🚀 <b>Expo dev server ready</b>\n\n${linkLine}\n\n<code>${expoUrl}</code>`;

  console.log(`\n[share] Expo URL: ${expoUrl}`);
  if (redirectUrl) console.log(`[share] Redirect: ${redirectUrl}\n`);

  const results = await Promise.allSettled([sendTelegram(html), sendTwilioSms(expoUrl)]);

  const labels = ["telegram", "twilio"];
  results.forEach((result, index) => {
    const label = labels[index];
    if (result.status === "rejected") {
      console.error(`[share] ${label} failed: ${result.reason.message}`);
      return;
    }
    if (result.value.skipped) {
      console.log(`[share] ${label} skipped: ${result.value.reason}`);
      return;
    }
    console.log(`[share] ${label} sent`);
  });
}

function getExpoArgs(forceClear = false) {
  const args = ["expo", "start", "--tunnel", "--port", String(devPort)];
  const clearByDefault = process.env.EXPO_TUNNEL_CLEAR !== "0";
  if (clearByDefault || process.argv.includes("--clear") || forceClear) {
    args.push("--clear");
  }
  return args;
}

function hasNgrokInstalled() {
  try {
    require.resolve("@expo/ngrok/package.json", { paths: [process.cwd()] });
    return true;
  } catch {
    return false;
  }
}

function getInstallCommand() {
  const userAgent = process.env.npm_config_user_agent || "";

  if (userAgent.includes("yarn/")) {
    return {
      cmd: "yarn",
      args: ["add", "-D", "@expo/ngrok@latest"],
      label: "yarn add -D @expo/ngrok@latest",
    };
  }

  if (userAgent.includes("pnpm/")) {
    return {
      cmd: "pnpm",
      args: ["add", "-D", "@expo/ngrok@latest"],
      label: "pnpm add -D @expo/ngrok@latest",
    };
  }

  return {
    cmd: "npm",
    args: ["install", "--save-dev", "@expo/ngrok@latest"],
    label: "npm install --save-dev @expo/ngrok@latest",
  };
}

function ensureNgrokInstalled() {
  if (hasNgrokInstalled()) {
    return;
  }

  const install = getInstallCommand();
  console.log(`[share] Installing required dependency: ${install.label}`);

  const result = spawnSync(install.cmd, install.args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Could not install @expo/ngrok automatically. Run: ${install.label}`);
  }
}

function freeExpoPorts() {
  // Use fuser (available on most Linux) to kill processes on Expo ports
  for (const port of expoPorts) {
    const result = spawnSync("fuser", ["-k", `${port}/tcp`], {
      env: process.env,
      encoding: "utf8",
    });
    if (result.status === 0) {
      console.log(`[share] Freed port ${port}`);
    }
  }
}

function hasTelegramConfig() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function tryResolveTelegramChatId() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const existing = process.env.TELEGRAM_CHAT_ID;

  if (!token || existing) {
    return;
  }

  const meUrl = `https://api.telegram.org/bot${token}/getMe`;
  const meResponse = await fetch(meUrl);
  if (!meResponse.ok) {
    throw new Error(`Unable to verify Telegram bot token (${meResponse.status}).`);
  }

  const mePayload = await meResponse.json();
  if (!mePayload.ok || !mePayload.result?.username) {
    throw new Error(`Telegram getMe failed: ${mePayload.description || "unknown error"}`);
  }

  const botUsername = mePayload.result.username;
  console.log(`[share] Using Telegram bot @${botUsername}`);

  const updatesUrl = `https://api.telegram.org/bot${token}/getUpdates`;
  const response = await fetch(updatesUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch Telegram updates (${response.status}).`);
  }

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram API error: ${payload.description || "unknown error"}`);
  }

  const updates = Array.isArray(payload.result) ? payload.result : [];
  const chatCandidates = [];

  for (const update of updates) {
    const message =
      update.message ||
      update.edited_message ||
      update.channel_post ||
      update.edited_channel_post;
    const chat = message?.chat;
    const chatId = chat?.id;
    if (chatId != null) {
      chatCandidates.push({
        id: String(chatId),
        type: String(chat?.type || "unknown"),
        updateId: Number(update.update_id || 0),
      });
    }
  }

  if (chatCandidates.length === 0) {
    throw new Error(
      [
        "No Telegram chat found yet.",
        `Open https://t.me/${botUsername}?start=1 on your iPhone, tap Start, then send any message to the bot.`,
        "After that, run yarn start:tunnel:share again.",
      ].join(" ")
    );
  }

  chatCandidates.sort((a, b) => b.updateId - a.updateId);
  const privateCandidate = chatCandidates.find((candidate) => candidate.type === "private");
  const resolved = (privateCandidate || chatCandidates[0]).id;
  process.env.TELEGRAM_CHAT_ID = resolved;
  console.log(`[share] Auto-detected TELEGRAM_CHAT_ID=${resolved}`);
}

function hasTwilioConfig() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER &&
      process.env.TWILIO_TO_NUMBER
  );
}

function ensureMessagingConfigured() {
  if (hasTelegramConfig() || hasTwilioConfig()) {
    return true;
  }

  console.log(
    "[share] No messaging provider fully configured. Starting tunnel anyway; link will be printed in terminal."
  );
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readExpoUrlFromStateFiles() {
  const files = [
    ".expo/packager-info.json",
    ".expo/settings.json",
    ".expo/devices.json",
  ];

  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      const match = content.match(urlRegex);
      if (match) {
        return match[1];
      }
    } catch {
      // Ignore missing files while Expo is booting.
    }
  }

  return null;
}

async function pollNgrokForTunnelUrl(signal) {
  while (!signal.aborted) {
    try {
      const res = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (res.ok) {
        const data = await res.json();
        const tunnel = data.tunnels?.find(
          (t) => t.proto === "https" || t.proto === "http"
        );
        if (tunnel?.public_url) {
          const host = new URL(tunnel.public_url).host;
          return `exp://${host}`;
        }
      }
    } catch {
      // ngrok not ready yet
    }
    await sleep(2000);
  }
  return null;
}

function runExpoAttempt(useClear) {
  return new Promise((resolve) => {
    const expo = spawn("npx", getExpoArgs(useClear), {
      stdio: "inherit",
      env: process.env,
    });

    let sentForRun = false;
    const abort = new AbortController();

    // Poll ngrok API for the tunnel URL instead of scraping stdout
    pollNgrokForTunnelUrl(abort.signal).then(async (expoUrl) => {
      if (!expoUrl || sentForRun) return;
      sentForRun = true;
      sent = true;
      await notify(expoUrl).catch((error) => {
        console.error(`[share] notify failed: ${error.message}`);
      });
    });

    expo.on("exit", (code, signal) => {
      abort.abort();

      if (signal) {
        resolve({ code: 1, hadUrl: sentForRun || sent });
        return;
      }

      resolve({ code: code ?? 0, hadUrl: sentForRun || sent });
    });

    function forwardSignal(sig) {
      if (!expo.killed) expo.kill(sig);
    }

    process.once("SIGINT", () => forwardSignal("SIGINT"));
    process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  });
}

async function runExpoWithRetries() {
  let attempt = 1;
  let useClear = true;

  while (attempt <= maxTunnelStartRetries) {
    const result = await runExpoAttempt(useClear);
    if (result.code === 0 || result.hadUrl) {
      return 0;
    }

    attempt += 1;
    if (attempt <= maxTunnelStartRetries) {
      const delayMs = 2000 * (attempt - 1);
      console.log(`[share] Tunnel failed to start. Retrying (${attempt}/${maxTunnelStartRetries})...`);
      await sleep(delayMs);
    }
  }

  throw new Error("Tunnel failed to start after multiple attempts.");
}

async function main() {
  try {
    await tryResolveTelegramChatId();
  } catch (error) {
    console.log(`[share] Telegram auto-detect skipped: ${error.message}`);
  }

  ensureMessagingConfigured();
  ensureNgrokInstalled();
  freeExpoPorts();
  const code = await runExpoWithRetries();
  process.exit(code);
}

main().catch((error) => {
  console.error(`[share] ${error.message}`);
  process.exit(1);
});
