# Claw Code Mobile

<div align="center">

**AI coding agent on the go.**

Chat with any agent that can execute code, edit files, and manage projects on your remote VPS — all from your phone with clean, intuitive UI and UX. Anthropic via API or Oauth, Openrouter, and even local models supported.

</div>

---

## Foreword

I built this for three reasons.

First, I burned through $5,000 worth of Claude Code tokens in a single month while building my AI companion app, [Ami](https://withami.ai).

Second, I got smacked by the Claude Code Pro and Max token-burn problem that I know I'm far from alone in dealing with. We're all feeling the pain.

Third, I had to send my MacBook in for repairs, but I just couldn't stop myself from building. So I tried working from mobile via GitHub Codespaces, vscode.dev, and other options. Absolutely no way — worst UX I've ever experienced.

So I decided to build a better way to code on the go. Something intuitive, mobile-friendly, and actually enjoyable to use. It's powered by the Claw Code harness and supports remote sessions, OpenRouter, local LLMs, and Anthropic through either API access or OAuth via subscription.

This project is open source because I want people to be able to benefit from it, improve it, and shape it with me. Open source gives builders more freedom, more transparency, and more control — especially at a time when costs are high and a lot of people are trying to do more with less. Affordable remote agents, local agents, and flexible coding workflows should be accessible to everyone, not exclusive to the wealthy or well-off.

Building this from my phone in just a few days was a fun challenge, and I genuinely enjoyed it. I hope you have just as much fun using it.

Contributions are very welcome. The bigger goal is to give people an intuitive mobile UI and UX for building from anywhere, with affordable OpenRouter options, strong local-model support, and an open foundation the community can keep pushing forward. See [ROADMAP.md](ROADMAP.md) for what's coming next and what's open to grab.

This project wouldn't be possible without:

- **[ultraworkers/claw-code](https://github.com/ultraworkers/claw-code)** — the Rust agent harness that does all the actual coding work. The mobile app is a UI in front of it.
- **[EvanBacon/expo-ai](https://github.com/EvanBacon/expo-ai)** — the Expo Router AI-chat starter the mobile shell descended from.

I merely worked on integrations, UX, and design direction.

**Support ongoing development:** if you find this project useful, you can help support future improvements here: [Buy Me a Coffee](https://buymeacoffee.com/liamvisionary)

---

## Features

- **Streaming chat** with live tool tracking (file edits, terminal commands, searches) and a per-turn "Worked for X" row showing cost, tokens, and savings vs Anthropic pricing.
- **Image & file attachments** for multimodal models (vision-capability gated per model).
- **Interactive terminal** — persistent bash per thread via a bottom sheet with ANSI rendering, cwd prompt, history, sticky modifiers, and a **Send last output to Claw** shortcut. See [Interactive terminal](#interactive-terminal).
- **Model queue with fallback + retry** across Claude, OpenRouter, and any OpenAI-compatible local server (Ollama / LM Studio / llama.cpp / vLLM). See [Local models](#local-models).
- **Auto-compact** of context when the window fills up, plus message queuing while a run is busy.
- **Directory browser** for picking a per-thread working directory, dark/light theming, swipe-to-delete/duplicate.
- **Local diagnostic telemetry** — every SSE emission, tool call, token count, and client render is logged to the local SQLite DB so you can diff backend vs UI and find token hot spots. Nothing leaves your machine. Toggle under Settings → Behaviour.
- **Obsidian integration** — point the agent at a vault (backend-hosted or on-device). Notes under `claw-code/memory/` get injected on every turn; the agent can write memories back when the vault is backend-hosted. See [Obsidian vault integration](#obsidian-vault-integration).

---

## Architecture

```
┌──────────────┐         ┌──────────────────┐         ┌──────────────┐
│  Mobile App  │──HTTP──>│  Express Gateway │──spawn─>│  Claw Binary │
│  (Expo/RN)   │<─SSE────│  + SQLite        │<─stdout─│  (Rust CLI)  │
└──────────────┘         └──────────────────┘         └──────────────┘
```

| Layer | Stack |
|-------|-------|
| **Mobile** | Expo SDK 54 · React Native 0.81 · Expo Router v6 · Zustand · Reanimated |
| **Gateway** | Express.js · SQLite (better-sqlite3) · SSE streaming · Bearer token auth |
| **Agent** | Claw binary (Rust) — spawned per run, stdout/stderr parsed as JSON |

The gateway spawns a Claw process per AI run, streams its output back via SSE, and persists everything in SQLite.

---

## Quick Start

### Prerequisites

- **Node.js 20+** and **npm**
- **Rust toolchain** — needed to build the `claw` CLI the backend spawns:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # Linux only: also ensure a C compiler (e.g. `sudo apt-get install -y build-essential`)
  ```
- **cloudflared** (remote mode only) — `brew install cloudflared`

The first `npm run dev` / `npm run dev:tunnel` clones and compiles the `claw` CLI into `~/.cache/claw-code-mobile/target/` (~3–5 min). Subsequent runs are instant.

### iOS configuration (optional)

Only needed if you're doing native builds (not Expo Go). Edit `app.json`:

```json
"ios": {
  "appleTeamId": "YOUR_TEAM_ID",
  "bundleIdentifier": "com.yourorg.clawcodemobile"
}
```

For Claude OAuth sign-in, install the [Claude CLI](https://github.com/anthropics/claude-code) and put it on `$PATH` (or set `CLAUDE_CLI=/path/to/claude`).

### Local (phone + dev machine on the same Wi-Fi)

```bash
npm install
npm --prefix backend install
npm run dev
```

Scan the Metro QR code with Expo Go. The app auto-discovers the backend at `http://<lan-ip>:5000` with `dev-token` — **Settings needs no changes**.

### Remote (VPS or cellular)

```bash
cp .env.example .env         # optional — edit to taste
npm install --legacy-peer-deps
npm --prefix backend install
npm run dev:tunnel
```

This starts the backend + Expo and opens two public cloudflared tunnels. It auto-injects the backend URL and bearer token into the Metro bundle, so the app auto-configures on launch.

**Telegram integration** (optional, recommended): set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`. Each startup DMs you a tappable link that hands off to Expo Go through the backend's `/open-app` redirect (Telegram refuses to make `exp://` URLs tappable directly).

**Tunnel providers** (choose via `TUNNEL_PROVIDER` in `.env`):

| Provider | Account? | Install |
|----------|----------|---------|
| `cloudflared` (default) | no | `brew install cloudflared` |
| `ngrok` | yes (free, add `NGROK_AUTHTOKEN`) | `brew install ngrok` |

> Use ngrok's **standalone v3 binary**, not `npx expo start --tunnel` — Expo bundles a legacy ngrok v2 client that no longer works against current servers.

**`EXPO_TOKEN` (recommended for remote mode):** without it, `dev:tunnel` falls back to `--offline`. For the full experience, generate a token at [expo.dev access tokens](https://expo.dev/accounts/[username]/settings/access-tokens) and add `EXPO_TOKEN=...` to `.env`. Each developer needs their own.

### Install on iPhone (no App Store)

Distributed via ad-hoc EAS builds:

1. **Register device:** `eas device:create` → open the URL in Safari on iPhone → approve the config profile under Settings → General → VPN & Device Management. If Find My is on, Apple enforces a 1-hour delay before the UDID propagates.
2. **Build:** `eas build --profile development --platform ios` (~5 min, cloud-built).
3. **Install:** open the resulting link on your iPhone and tap Install.

> **"Unable to install" / "Integrity could not be verified"?** Your device's UDID isn't in the provisioning profile yet. Re-register, rebuild, reinstall. Each new tester needs one rebuild.

---

### Gateway environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `GATEWAY_AUTH_TOKEN` | `dev-token` | Bearer token for API auth |
| `DATABASE_FILE` | — | SQLite file path (optional) |

### Local models

Claw talks to any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM). No API key required.

**Same host as the backend:** in the app go to **Settings → Models → Add a model → Local → Current backend → Scan for models**. The backend probes its own loopback for known runner ports (Ollama 11434, LM Studio 1234, llama.cpp 8080, vLLM 8000) and lists whatever it finds.

**Backend on a VPS, model on your Mac:** the VPS can't reach your Mac's loopback. Pick one:

- **cloudflared quick tunnel (public URL):**
  ```bash
  ollama serve
  cloudflared tunnel --url http://localhost:11434 --http-host-header localhost
  ```
  Paste the printed `https://<random>.trycloudflare.com` into **Local → Other → Scan**. `--http-host-header localhost` is required — Ollama rejects non-localhost Host headers. Treat the URL like a password.

- **SSH reverse tunnel (private):**
  ```bash
  ssh -N -R 11434:localhost:11434 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes <user>@<vps>
  ```
  Then use **Current backend → Scan** (it's loopback from the VPS's side). Wrap with `autossh` for auto-reconnect.

#### Tool-calling compatibility

Claw demuxes three tool-call dialects so they all flow through the same agent loop:

| Model family | Format | Status |
|---|---|:---:|
| Anthropic Claude · OpenAI (GPT-4/4o/5/o-series) · xAI Grok · anything via OpenRouter | OpenAI-native `tool_calls` | ✅ |
| OpenAI `gpt-oss` | Harmony channels (`<\|channel\|>`…) | ✅ |
| Qwen Coder / Qwen 2.5 & 3 instruct / Nous Hermes | Hermes XML (`<tool_call>{…}</tool_call>`) | ✅ |
| Chat-only models (no `tools` capability) | n/a | ⚠️ chat works, no tools |
| Unknown dialect | n/a | ❌ — file an issue with a sample |

Format detection is by model name (`gpt-oss*` → Harmony, `qwen*coder*` / `hermes*` / `nous-*` → Hermes XML, everything else → OpenAI-native). The chunk-stream demuxer handles partial markers across SSE boundaries. Coverage is locked in by integration tests in [`crates/api/src/providers/openai_compat.rs`](claw-code/rust/crates/api/src/providers/openai_compat.rs) — `cargo test -p api pipeline_` to run them.

---

### Obsidian vault integration

Give the agent persistent memory and let it ground answers in your own notes.

| Provider | Vault lives on | Reads | Writes | Obsidian Sync required? |
|----------|----------------|:-----:|:------:|:-----------------------:|
| **Backend (VPS)** | Backend host filesystem | ✅ | ✅ | no |
| **This device** | Folder picked on the phone | ✅ | ❌ | no |

Writes only work with the backend provider (the backend can't reach into the phone's sandbox). If you use Obsidian Sync, point the backend at a synced vault and your other Obsidian clients see the agent's edits automatically.

**Memory convention:** memories live at `<vault>/claw-code/memory/*.md`, each file one memory with YAML frontmatter (`name`, `description`, `type`) + markdown body. The agent is told where the folder is on every turn and can create/update files there directly (backend provider only).

**Backend setup:** create a vault directory on the host (e.g. `/home/<you>/Obsidian/MyVault`), then in the app go to **Settings → Obsidian Vault → Backend (VPS)**, paste the absolute path, tap **Connect vault**. Toggle **Use for memory** / **Use for reference** independently.

**On-device setup:** run `npx expo install expo-file-system expo-document-picker`, rebuild the native app (these add native modules). Then **Settings → Obsidian Vault → This device → Pick vault folder**. On iOS the vault must be reachable via the Files app (iCloud Drive or On My iPhone); on Android it uses the Storage Access Framework with persistent folder access.

**How context injection works:** on every message, memory notes are prepended to the model's prompt. The message in your chat bubble stays exactly as you typed it — the preamble is invisible in the UI.

---

### Interactive terminal

Tap the terminal icon in the thread header to open a bottom sheet with a real shell running on the backend host — one persistent `bash` per thread, spawned lazily on the first command and killed when the thread is deleted. The shell starts in the thread's `workDir`, so `cd`, env vars, and shell state persist across commands.

**Why it exists:** sometimes the agent asks you to run something it can't run itself (interactive installer, credentials-requiring command, manual verification). Before, you'd switch to your laptop, SSH in, and paste back. Now you do it in-app.

**Highlights:**

- Live `cwd` prompt, updated via a sentinel after each command so `cd foo` gives instant visual feedback.
- ANSI 8/16 + 256 + truecolor, bold/dim/italic/underline. Non-SGR escapes stripped.
- Accessory key row: sticky `ctrl`/`⌘` modifiers, history ↑/↓ with draft preservation, `⎋`, `⇥`, plus the shell punctuation iOS hides (`|`, `~`, `/`, `\`, `*`, `&`, `>`, `<`, `$`, `` ` ``).
- `ctrl+c/d/l`, `ctrl+<a–z>` control bytes, `⌘+k` clear, `⌘+c` copy last output, `⌘+v` paste.
- **Send last output to Claw** wraps the most recent command's output in a fenced code block and drops it into the composer.

**Caveats:**

- No PTY — full-screen TUI apps (`vim`, `less`, `top`) won't render. Swap in `node-pty` if this becomes painful.
- The shell shares auth with the rest of the gateway; anyone with your bearer token has a shell on the backend host (no broader than existing agent tool-use exposure, but worth knowing).
- Rate-limited to 2000 lines/command and 200 lines/sec; overflow is truncated with a notice.

---

## Screens

- **Chat list** ([app/index.tsx](app/index.tsx)) — threads sorted by recent activity with swipe-to-delete/duplicate.
- **Thread view** ([app/thread/[id].tsx](app/thread/[id].tsx)) — message bubbles with markdown, live tool-step indicator, model picker, directory badge, terminal sheet.
- **Settings** ([app/settings.tsx](app/settings.tsx)) — tabbed: Connection, Models, Appearance, Behaviour, Notes (vault), Budgeting, Logs.

---

## API Reference

All routes require `Authorization: Bearer <token>` except `/health`, `/`, and `/open-app`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` · `POST` | `/threads` | List / create threads |
| `PATCH` · `DELETE` | `/threads/:id` | Update (title, workDir) / delete |
| `POST` | `/threads/:id/duplicate` | Duplicate a thread |
| `GET` · `POST` | `/threads/:id/messages` | List messages / send & trigger a run |
| `GET` | `/threads/:id/stream` | SSE stream (status, delta, tool, terminal, …) |
| `GET` | `/threads/:id/run-state` | Current status, phase, active run id |
| `POST` | `/threads/:id/stop` | Stop a running AI run |
| `GET` · `POST` | `/threads/:id/terminal` | Get snapshot / run a command |
| `POST` | `/threads/:id/terminal/stdin` | Write raw bytes to shell stdin |
| `POST` | `/threads/:id/terminal/interrupt` | SIGINT the running command |
| `POST` | `/threads/:id/terminal/kill` | SIGTERM the shell (next command re-spawns) |
| `GET` | `/threads/:id/terminal/snapshot` | Output lines since the most recent command |
| `POST` | `/threads/:id/upload` | Upload a file attachment |
| `POST` | `/threads/:id/attach-server-file` | Attach a file already on the backend |
| `GET` | `/fs/browse` | Browse remote filesystem |
| `POST` | `/obsidian/validate`, `/init`, `/headless/*` | Validate / init / manage headless sync |
| `GET` · `PUT` · `DELETE` | `/obsidian/notes*` | List / read / write / delete vault notes |
| `POST` | `/oauth/authorize`, `/token`, `/refresh` | Claude OAuth flow |
| `POST` | `/local-models/discover` | Probe localhost runner ports |
| `GET` · `POST` | `/events`, `/events/client` | Diagnostic telemetry stream / client-side event ingest |
| `GET` | `/analytics/stats` | Aggregated cost/token stats |

### SSE event types

| Event | Payload |
|-------|---------|
| `status` | `{ status }` — `idle` / `running` / `waiting` / `error` |
| `delta` | `{ messageId, chunk }` |
| `message_error` | `{ messageId, text }` |
| `tool_start` | `{ id, messageId, tool, label, detail? }` |
| `tool_end` | `{ id, messageId, error? }` |
| `thinking_content` | `{ messageId, content }` |
| `permission_request` | `{ id, tool, description, message? }` |
| `terminal` | `{ chunk, cwd?, busy? }` |
| `run_phase` | `{ phase }` |
| `compact_start` · `compact_end` | context-window compaction lifecycle |
| `title_updated` | `{ title }` |
| `done` · `error` | Run lifecycle |

---

## Project structure

```
app/                   Expo Router screens (index, settings, thread/[id], _layout, ...)
components/            UI — chat, terminal sheet, markdown, settings tabs, shared primitives in ui/
constants/             theme.ts (spacing/radius/typography) + palette.ts (light/dark + accent palettes)
hooks/                 usePalette, useModelCapabilities, ...
store/                 gatewayStore.ts (Zustand — state, SSE client, all actions)
utils/ · util/         Helpers (markdown cleanup, id generation, ...)
backend/src/
  app.ts · server.ts   Express app + HTTP entry
  db/                  SQLite connection + migrations
  routes/              threads · messages · stream · terminal · fs · uploads ·
                       obsidian · oauth · localModels · events · analytics · openApp · health
  services/            threadService · messageService · runService · streamService ·
                       terminalService · shellService · vaultService · eventsService · vault/
  runtime/clawRuntime  Claw binary adapter (model queue, fallback, compaction, streaming)
  middleware/auth.ts   Bearer token auth
claw-code/             Vendored Rust agent harness
assets/                Icons, images, splash
```

---

## Runtime adapter

The gateway uses [`clawRuntime.ts`](backend/src/runtime/clawRuntime.ts) to spawn the Claw Rust binary per turn. It handles the model-queue fallback with retry/backoff, session snapshotting, proactive context compaction, auto-continue on truncated responses, and real-time streaming via stderr parsing. Model metadata (context windows, pricing) is fetched from OpenRouter and cached hourly.

---

## License

Code original to this repository is licensed under **0BSD** (see [LICENSE](LICENSE)).

The [`claw-code/`](claw-code/) directory is vendored from [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code), which currently ships without a license file. License status of that subdirectory is pending clarification upstream — it is **not** covered by the 0BSD grant above.
