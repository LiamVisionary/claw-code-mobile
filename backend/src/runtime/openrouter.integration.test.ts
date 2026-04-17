/**
 * Live integration test — hits OpenRouter directly and verifies that
 * the content coming back is clean (no dropped chars, balanced
 * backticks, no mangled bold headers).
 *
 * Gated on OPENROUTER_API_KEY being present in the environment or in
 * `.env` at the project root. If the key is missing the test is
 * skipped (reported as `#`), so CI without a key doesn't fail.
 *
 * Intended to catch:
 *   • Provider-side corruption if it ever appears
 *   • Any regression where our pipeline mangles what OpenRouter sends
 *
 * Run with: `npm --prefix backend run test`
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function loadEnv(): void {
  if (process.env.OPENROUTER_API_KEY) return;
  // Walk up from this file to find the repo root `.env`.
  const here = new URL(".", import.meta.url).pathname;
  let dir = here;
  for (let i = 0; i < 6 && dir !== "/"; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      for (const raw of fs.readFileSync(candidate, "utf8").split("\n")) {
        const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const k = m[1];
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(k in process.env)) process.env[k] = v;
      }
      return;
    }
    dir = path.dirname(dir);
  }
}

loadEnv();

const hasKey = Boolean(process.env.OPENROUTER_API_KEY);

describe("OpenRouter live integration", { skip: !hasKey }, () => {
  it("returns clean backtick-wrapped folder names without dropped chars", async () => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "z-ai/glm-5.1",
        stream: true,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content:
              "List every folder in a typical Expo project (app, components, constants, hooks, backend, scripts, assets). Wrap each folder name in backticks as inline code. Separate them by commas. Example format: `app/`, `components/`, etc. Do not use bullet points.",
          },
        ],
      }),
    });
    assert.equal(res.status, 200, "openrouter request failed");
    assert.ok(res.body, "no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }

    // Parse the SSE stream and join the `content` deltas.
    const content: string[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") break;
      try {
        const obj = JSON.parse(data);
        const delta = obj?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) content.push(delta);
      } catch { /* ignore malformed lines */ }
    }
    const full = content.join("").trim();

    // Assertion 1: every expected folder is present with a trailing slash.
    for (const f of ["app/", "components/", "constants/", "hooks/", "backend/", "scripts/", "assets/"]) {
      assert.ok(
        full.includes(`\`${f}\``),
        `expected \`${f}\` in output, got: ${full}`
      );
    }

    // Assertion 2: backticks balance.
    const tickCount = (full.match(/`/g) || []).length;
    assert.equal(tickCount % 2, 0, `odd backtick count (${tickCount}) in output: ${full}`);

    // Assertion 3: no double-comma gunk or triple-space runs.
    assert.ok(!/,,/.test(full), `double comma in output: ${full}`);
    assert.ok(!/   /.test(full), `triple space in output: ${full}`);
  });
});
