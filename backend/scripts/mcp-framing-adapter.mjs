#!/usr/bin/env node
/**
 * MCP framing adapter: translates between Content-Length framing (LSP-style)
 * and newline-delimited JSON.
 *
 * The claw binary speaks Content-Length framed MCP, but the MCP JS SDK
 * (used by mcpvault and most Node.js MCP servers) uses newline-delimited
 * JSON. This adapter sits between them.
 *
 * Usage: mcp-framing-adapter.mjs <command> [args...]
 * The adapter spawns the given command and proxies stdio with framing translation.
 *
 *   claw → [Content-Length framed] → adapter → [newline JSON] → mcpvault
 *   claw ← [Content-Length framed] ← adapter ← [newline JSON] ← mcpvault
 */

import { spawn } from "node:child_process";
import process from "node:process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  process.stderr.write("Usage: mcp-framing-adapter.mjs <command> [args...]\n");
  process.exit(1);
}

const child = spawn(cmd, args, {
  stdio: ["pipe", "pipe", "inherit"],
});

// ── stdin: Content-Length framed → newline JSON ──────────────────────
// Read Content-Length headers from stdin, extract the JSON body,
// forward as newline-delimited JSON to the child's stdin.
let stdinBuf = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  stdinBuf = Buffer.concat([stdinBuf, chunk]);

  while (true) {
    // Look for Content-Length header
    const headerEnd = stdinBuf.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = stdinBuf.toString("utf8", 0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Not a valid header — skip past it
      stdinBuf = stdinBuf.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;

    if (stdinBuf.length < bodyEnd) break; // Wait for more data

    const body = stdinBuf.toString("utf8", bodyStart, bodyEnd);
    stdinBuf = stdinBuf.subarray(bodyEnd);

    // Forward as newline-delimited JSON
    child.stdin.write(body + "\n");
  }
});

process.stdin.on("end", () => {
  child.stdin.end();
});

// ── stdout: newline JSON → Content-Length framed ─────────────────────
// Read newline-delimited JSON from child stdout, wrap in Content-Length
// headers and write to our stdout.
let stdoutBuf = "";

child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk.toString();

  let idx;
  while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
    const line = stdoutBuf.slice(0, idx).replace(/\r$/, "");
    stdoutBuf = stdoutBuf.slice(idx + 1);

    if (!line.trim()) continue;

    // Wrap in Content-Length framing
    const bytes = Buffer.byteLength(line, "utf8");
    process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${line}`);
  }
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
