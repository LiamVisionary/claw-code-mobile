#!/usr/bin/env node
// Run the backend gateway and Expo dev server side-by-side.
// Zero dependencies — just Node. Forwards SIGINT/SIGTERM to both children.

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

// Build the claw binary synchronously on first run. build-claw.sh is
// idempotent — no-op if the binary already exists.
{
  const r = spawnSync("bash", ["scripts/build-claw.sh"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  if (r.status !== 0) {
    console.error("\n[dev] failed to build claw binary — check cargo/rust is installed.\n");
    process.exit(1);
  }
}

const children = [];
let shuttingDown = false;

const colors = {
  backend: "\x1b[36m", // cyan
  expo: "\x1b[35m",    // magenta
  reset: "\x1b[0m",
};

function prefix(name) {
  return `${colors[name] || ""}[${name}]${colors.reset} `;
}

function run(name, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: process.env,
  });
  children.push(child);

  const pipeLine = (stream, sink) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        sink.write(prefix(name) + buf.slice(0, i + 1));
        buf = buf.slice(i + 1);
      }
    });
    stream.on("end", () => {
      if (buf) sink.write(prefix(name) + buf + "\n");
    });
  };

  pipeLine(child.stdout, process.stdout);
  pipeLine(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.log(`${prefix(name)}exited (${code ?? signal}); stopping all.`);
      shutdown();
    }
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) {
      try {
        c.kill("SIGINT");
      } catch {}
    }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("backend", "npm", ["--prefix", "backend", "run", "dev"]);
run("expo", "npx", ["expo", "start"]);
