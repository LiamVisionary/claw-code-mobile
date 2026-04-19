# Security Policy

## Reporting a vulnerability

Email **liamvisionary@gmail.com** with details. Please don't open a public issue for anything that looks exploitable — I'll acknowledge within a few days and coordinate a fix + disclosure timeline.

If you want to encrypt, ask for a PGP key in the first email.

## Scope

In scope:

- The Express gateway (`backend/`) — auth, SSE, SQLite persistence, analytics, OAuth flow.
- The mobile app (`app/`, `components/`, `store/`) — credential handling, local storage, deep links.
- The `dev:tunnel` scripts that auto-inject bearer tokens into the Metro bundle.

Out of scope (report upstream):

- [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) — the Rust agent binary.
- Expo / React Native / Express itself — report to those projects.

## Known trust boundaries

These are design choices, not bugs — please don't report them as vulnerabilities:

- **Bearer token = shell access.** The gateway exposes terminal and tool-use endpoints to anyone with the token. Rotate it if it leaks, and don't share tunnels.
- **Public tunnels are public.** `cloudflared` / `ngrok` URLs are unguessable but not authenticated at the tunnel layer — auth is the bearer token. Kill the tunnel when you're done.
- **Local SQLite telemetry is unencrypted.** Events, prompts, and tool output live in plaintext in the local DB. This is intentional (local-only, debuggable). Don't commit the DB file.

## What counts as a vulnerability

Things I care about: auth bypass, token leakage (into logs, Metro bundle output, crash reports, third-party services), SQL injection, path traversal in file-browsing endpoints, SSRF via the OAuth redirect or model-provider config, any way to execute code on the gateway host *without* the bearer token, any way for the mobile app to leak the token to a non-configured origin.
