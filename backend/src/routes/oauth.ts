import { Router } from "express";
import crypto from "crypto";
import { logger } from "../utils/logger";

export const oauthRouter = Router();

// ── Anthropic OAuth PKCE constants ──────────────────────────────────
// These match the values used by the official Claude Code CLI.
// Client metadata: https://claude.ai/oauth/claude-code-client-metadata
const ANTHROPIC_AUTHORIZE_URL =
  "https://platform.claude.com/oauth/authorize";
const ANTHROPIC_TOKEN_URL =
  "https://platform.claude.com/v1/oauth/token";
const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_CALLBACK_URL =
  "https://platform.claude.com/oauth/code/callback";
const ANTHROPIC_SCOPES = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

// In-memory map of pending OAuth flows keyed by `state`.
// Each entry holds the PKCE verifier so we can exchange the code.
const pendingFlows = new Map<
  string,
  { verifier: string; createdAt: number }
>();

// Housekeeping: drop stale entries older than 10 minutes.
function pruneFlows() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, val] of pendingFlows) {
    if (val.createdAt < cutoff) pendingFlows.delete(key);
  }
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url").replace(/=+$/, "");
}

// ── POST /oauth/authorize ──────────────────────────────────────────
// Returns { url, state } for the mobile client to open in the browser.
oauthRouter.post("/oauth/authorize", (req, res, next) => {
  try {
    pruneFlows();

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(
      crypto.createHash("sha256").update(verifier).digest()
    );
    const state = base64url(crypto.randomBytes(32));

    pendingFlows.set(state, { verifier, createdAt: Date.now() });

    // Exactly match how Claude Code CLI builds the authorize URL:
    // use searchParams.append for each param (same order as CLI).
    // Then decode %3A → : since Anthropic requires raw colons in scopes.
    const authUrl = new URL(ANTHROPIC_AUTHORIZE_URL);
    authUrl.searchParams.append("code", "true");
    authUrl.searchParams.append("client_id", ANTHROPIC_CLIENT_ID);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("redirect_uri", ANTHROPIC_CALLBACK_URL);
    authUrl.searchParams.append("scope", ANTHROPIC_SCOPES.join(" "));
    authUrl.searchParams.append("code_challenge", challenge);
    authUrl.searchParams.append("code_challenge_method", "S256");
    authUrl.searchParams.append("state", state);
    // searchParams encodes : as %3A — decode them back for Anthropic.
    // This also decodes : in redirect_uri (https%3A → https:) which
    // is fine since the server handles both forms.
    const url = authUrl.toString().replace(/%3A/g, ":");
    res.json({ url, state });
  } catch (err) {
    next(err);
  }
});

// ── POST /oauth/token ──────────────────────────────────────────────
// Exchange an authorization code for tokens.
// Body: { code: string, state: string }
oauthRouter.post("/oauth/token", async (req, res, next) => {
  try {
    let { code, state } = req.body as { code?: string; state?: string };
    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }

    // If the user pasted a callback URL instead of just the code, extract it
    if (code.includes("code=")) {
      try {
        const url = new URL(code);
        code = url.searchParams.get("code") || code;
      } catch {
        // Try as query string fragment
        const match = code.match(/[?&]code=([^&]+)/);
        if (match) code = match[1];
      }
    }

    const flow = pendingFlows.get(state);
    if (!flow) {
      res.status(400).json({ error: "Unknown or expired OAuth state — try starting over" });
      return;
    }
    pendingFlows.delete(state);

    // Strip any whitespace/newlines the user may have accidentally included,
    // and remove URL fragment (#state) that the callback page may include.
    code = code.trim().replace(/\s+/g, "").split("#")[0];

    const exchangeBody = {
      grant_type: "authorization_code",
      code,
      redirect_uri: ANTHROPIC_CALLBACK_URL,
      client_id: ANTHROPIC_CLIENT_ID,
      code_verifier: flow.verifier,
      state,
    };

    logger.info(
      {
        codeLen: code.length,
        codePrefix: code.slice(0, 8),
        stateLen: state.length,
        verifierLen: flow.verifier.length,
        redirect_uri: ANTHROPIC_CALLBACK_URL,
      },
      "Exchanging OAuth code for tokens"
    );

    // Log full exchange for debugging
    const fs = await import("fs");
    const debugBody = { ...exchangeBody, code_length: code.length, state_length: state.length, code_equals_state: code === state, code_full: code, code_verifier: `${flow.verifier.slice(0, 8)}...` };
    fs.appendFileSync("/tmp/oauth-debug.log", `\n--- ${new Date().toISOString()} ---\nREQUEST: ${JSON.stringify(debugBody, null, 2)}\nTOKEN_URL: ${ANTHROPIC_TOKEN_URL}\n`);

    const tokenRes = await fetch(ANTHROPIC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exchangeBody),
    });

    const text = await tokenRes.text();
    fs.appendFileSync("/tmp/oauth-debug.log", `RESPONSE ${tokenRes.status}: ${text}\n`);

    if (!tokenRes.ok) {
      logger.error(
        { status: tokenRes.status, body: text },
        "OAuth token exchange failed"
      );
      // Parse the error detail so the client sees what went wrong
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error_description || parsed.error || text;
      } catch {}
      res.status(502).json({
        error: `Token exchange failed: ${detail}`,
      });
      return;
    }

    const data = JSON.parse(text) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    res.json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : null,
      scopes: data.scope ? data.scope.split(" ") : ANTHROPIC_SCOPES,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /oauth/refresh ────────────────────────────────────────────
// Refresh an expired access token.
// Body: { refreshToken: string }
oauthRouter.post("/oauth/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      res.status(400).json({ error: "Missing refreshToken" });
      return;
    }

    const tokenRes = await fetch(ANTHROPIC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: ANTHROPIC_CLIENT_ID,
        scope: ANTHROPIC_SCOPES.join(" "),
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      logger.error(
        { status: tokenRes.status, body: text },
        "OAuth token refresh failed"
      );
      res.status(502).json({
        error: `Token refresh failed (${tokenRes.status})`,
        detail: text,
      });
      return;
    }

    const data = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    res.json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : null,
      scopes: data.scope ? data.scope.split(" ") : ANTHROPIC_SCOPES,
    });
  } catch (err) {
    next(err);
  }
});
