# Claw Code Mobile

<div align="center">

**AI coding agent in your pocket.**

Chat with an AI that can execute code, edit files, and manage projects on your remote VPS — all from your iPhone.

</div>

---

## Features

- **Streaming chat** — Watch AI responses appear word-by-word in real-time
- **Live tool tracking** — See every action the agent takes as it works (file edits, terminal commands, searches)
- **Permission prompts** — Approve or deny dangerous operations inline before the agent proceeds
- **Turn telemetry** — Expandable "Worked for X" row after each turn showing cost, tokens, tool steps, and savings vs Anthropic pricing
- **Image & file attachments** — Send images/files to multimodal models via the `+` button; vision-capability gated per model
- **Interactive terminal** — Pull-up bottom sheet with a persistent shell on the backend host. Type commands with a real prompt that shows the current working directory; ANSI colors render inline, output is rate-limited and batched so `ls` feels instant. A keyboard accessory row adds the keys iOS buries (`|`, `~`, `/`, `\`, etc.), history ↑/↓, tab, esc, and sticky `ctrl`/`⌘` modifiers. **Send last output to Claw** pastes the results of the most recent command into the chat composer for easy follow-up. See [Interactive terminal](#interactive-terminal) for more.
- **Model queue with fallback + retry** — Configure multiple AI models (Claude, OpenRouter, or any local OpenAI-compatible server — Ollama/LM Studio/llama.cpp) that retry transient errors with backoff before falling through to the next model. See [Local models](#local-models-ollama--lm-studio--llamacpp) for setup.
- **Auto-compact** — Automatically summarizes conversation context when the window fills up
- **Directory browser** — Browse your remote filesystem and pick a working directory per thread
- **Dark & light mode** — Full native iOS theming with semantic colors
- **Swipe actions** — Swipe to delete or duplicate conversations
- **Message queuing** — Queue a message while the AI is busy; it sends automatically when the run finishes
- **Local diagnostic telemetry** — Every SSE emission, tool call, token count, and client render is logged to a local `events` table so you can diff backend-emitted events against what the UI rendered and find token-consumption hot spots. **All telemetry lives on your own machine** — events are written to the same local SQLite database the rest of the app uses, never transmitted off-device. The goal is to enable stronger local data analysis and UX improvements without any data leaving your setup. Toggle it off any time under Settings → Behaviour → "Diagnostic telemetry".
- **Obsidian vault integration** — Point the agent at an Obsidian vault on your backend host or on the phone itself. Notes in `claw-code/memory/` are injected as persistent context on every turn, and (when the vault lives on the backend) the agent can write new memories back to the vault. Great for preserving project conventions, user preferences, and cross-session context. See [Obsidian vault integration](#obsidian-vault-integration) for setup.

---

## Architecture

Claw Code is a two-part system:

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

The gateway spawns a Claw process for each AI run, pipes its output back to the mobile app via Server-Sent Events, and persists everything in SQLite.

---

## Quick Start

### Prerequisites

- **Node.js 20+** and **npm**
- **Rust toolchain** (`cargo`, `rustc`, and a C compiler) — required to build the `claw` CLI binary that powers the backend. If you don't have it:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # Linux only: also ensure a C compiler is installed
  sudo apt-get install -y build-essential     # Debian/Ubuntu
  ```
- **cloudflared** (only for remote mode) — `brew install cloudflared` or see [releases](https://github.com/cloudflare/cloudflared/releases)

The first `npm run dev` / `npm run dev:tunnel` will clone and compile the Rust `claw` CLI into `~/.cache/claw-code-mobile/target/` (~3–5 min). Subsequent runs are instant.

### iOS Configuration (optional)

If you plan to build for iOS (not required for Expo Go development):

1. Update `app.json` with your own Apple Team ID and bundle identifier:
   ```json
   "ios": {
     "appleTeamId": "YOUR_TEAM_ID",
     "bundleIdentifier": "com.yourorg.clawcodemobile"
   }
   ```
2. For Claude OAuth sign-in, you'll also need the [Claude CLI](https://github.com/anthropics/claude-code) installed and on your `$PATH` (or set `CLAUDE_CLI=/path/to/claude`).

### Local (phone + dev machine on the same Wi-Fi) — 1 command

```bash
npm install --legacy-peer-deps
npm --prefix backend install
npm run dev
```

That's it. A Metro QR code appears in the terminal — **scan it with the Expo Go app** on your phone (iOS Camera also works). The app auto-discovers the backend at `http://<your-lan-ip>:5000` with the default `dev-token`, so **Settings needs no changes**.

If the auto-detect doesn't resolve for some reason, open **Settings** in the app and the values are already pre-filled — just tap **Test**.

### Remote (dev machine is a VPS, or phone on cellular) — 1 command

```bash
cp .env.example .env         # optional — edit to taste
npm install --legacy-peer-deps
npm --prefix backend install
npm run dev:tunnel
```

This starts the backend + Expo **and** opens two public cloudflared tunnels. It also **auto-injects** the backend tunnel URL + bearer token into the Metro bundle as `EXPO_PUBLIC_GATEWAY_URL` / `EXPO_PUBLIC_GATEWAY_TOKEN`, so **the app auto-configures its Server URL on launch** — no manual paste into Settings.

The terminal prints:

```
  1. Open Expo Go on your phone
  2. Tap 'Enter URL manually' and paste:
       exp://<random>.trycloudflare.com
  3. Server URL / Bearer are already wired up.
```

**Telegram integration** (optional but strongly recommended if you're on mobile): set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`. Each startup DMs you a message with a tappable **Open in Expo Go** link that goes through the backend's `/open-app` landing page and hands off directly to Expo Go. No copy-paste. (Telegram refuses to make `exp://` URLs tappable in any form, so the message routes through an https redirect hop — worth knowing if you're wondering why the link lands on a tiny landing page with a button.)

**Tunnel providers** (choose in `.env` → `TUNNEL_PROVIDER=`):

| Provider      | Account? | Install |
|---------------|----------|---------|
| `cloudflared` (default) | no   | `brew install cloudflared` · [releases](https://github.com/cloudflare/cloudflared/releases) |
| `ngrok`       | yes (free) — add `NGROK_AUTHTOKEN` to `.env` | `brew install ngrok` · [download](https://ngrok.com/download) |

> ⚠️ Use ngrok's **standalone v3 binary**, not `npx expo start --tunnel`. Expo bundles a legacy ngrok v2 client that no longer works against current ngrok servers.

**`EXPO_TOKEN` (recommended for remote mode):** Without it, `dev:tunnel` falls back to `--offline` which skips EAS manifest signing and works fine for most cases. For the full experience (EAS Update metadata, etc.), generate a personal token at [expo.dev access tokens](https://expo.dev/accounts/[username]/settings/access-tokens) and put it in `.env` as `EXPO_TOKEN=...`. Each developer needs their own — **don't share**.

### Install on iPhone (no App Store needed)

The app is distributed via **ad-hoc builds** — you install directly from a link, no TestFlight or App Store review. Three steps:

#### 1. Register your device (one-time, ~2 min)

```bash
eas device:create
```

This gives you a URL — **open it in Safari on your iPhone**. It installs a tiny configuration profile that registers your device's UDID. You'll need to approve it in Settings → General → VPN & Device Management.

> **Find My iPhone caveat:** If Find My is enabled, Apple enforces a 1-hour security delay before the device can be added to a provisioning profile. Start this step first and grab coffee.

#### 2. Build the app (~5 min)

```bash
eas build --profile development --platform ios
```

EAS compiles in the cloud and gives you a download link + QR code when done. No Xcode or Mac needed.

#### 3. Install

Open the build link on your iPhone (or scan the QR code). Tap **Install** when prompted. The app appears on your home screen.

> **"Unable to Install" / "Integrity could not be verified"?** Your device UDID isn't in the provisioning profile. Go back to step 1, re-register, then rebuild. Each new device needs one rebuild.

#### Adding more testers

Each tester runs step 1 (register their device), then you rebuild once. The new build includes all registered devices. Share the build link — anyone registered can install it.

---

### Gateway environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `GATEWAY_AUTH_TOKEN` | `dev-token` | Bearer token for API auth |
| `DATABASE_FILE` | — | SQLite file path (optional) |

### Local models (Ollama / LM Studio / llama.cpp)

Claw talks to any OpenAI-compatible endpoint, so anything that serves `/v1/chat/completions` works — no API key required. Ollama is the easiest.

1. **Install and run Ollama.**
   ```bash
   brew install ollama
   brew services start ollama            # or: ollama serve
   ```

2. **Pull a model.** For coding, `qwen2.5-coder:7b` is a solid default (~4.7 GB, fits comfortably on 16 GB+ machines). Drop to `:3b` for tighter memory, go up to `:14b`/`:32b` if you have the RAM.
   ```bash
   ollama pull qwen2.5-coder:7b
   ```

3. **Add the model in the app.** Settings → Models → *Add a model* → **Local**, then:
   - **Model name** — the Ollama tag, e.g. `qwen2.5-coder:7b`
   - **Endpoint** — `http://127.0.0.1:11434/v1` (prefilled)

That's it — send a message and Claw will route through Ollama.

**Networking note:** the endpoint is reached by the **backend**, not your phone. If the backend runs on the same Mac as Ollama, `127.0.0.1` is correct. If the backend runs on a different host (VPS, other laptop), use that host's reachable address and make sure Ollama is listening on it:

```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

**Model quality caveat:** small local models (≤3B) usually handle plain Q&A fine but can stumble on tool-heavy loops (multi-step edits, bash chains). If runs end abruptly or the model "gives up" mid-turn, move up to 7B+ before blaming the integration.

**LM Studio / llama.cpp / vLLM / etc.** work the same way — start their OpenAI-compatible server, paste its base URL (including `/v1`) into the Endpoint field, and use whatever model identifier that server expects.

---

### Obsidian vault integration

Give the agent persistent memory and let it ground answers in your own notes. Two providers, pick whichever fits your setup:

| Provider          | Where the vault lives                  | Reads | Writes | Obsidian Sync required? |
|-------------------|----------------------------------------|:-----:|:------:|:-----------------------:|
| **Backend (VPS)** | Directory on the backend host          | ✅    | ✅     | no                      |
| **This device**   | Folder picked on the phone via the OS  | ✅    | ❌     | no                      |

Writes only work with the backend provider — the backend can't reach back into the phone's sandboxed filesystem. If you have Obsidian Sync, point the backend at a synced vault and your phone/desktop Obsidian clients will see the agent's memory edits show up automatically; free users get full functionality without Sync.

**Memory convention:** memories live in `<vault>/claw-code/memory/*.md`. Each file is one memory with YAML frontmatter (`name`, `description`, `type`) and markdown body. The agent is told where the folder is on each turn and can create/update files there directly (backend provider only).

**Setup — Backend (VPS) provider**

1. Create a vault directory on the backend host, e.g. `/home/<you>/Obsidian/MyVault`. If you want Obsidian Sync to pick it up on your other devices, place it inside a vault that Sync already watches.
2. In the app: **Settings → Obsidian Vault → Backend (VPS)**, paste the absolute path, tap **Connect vault**.
3. A successful connect auto-enables integration and reports the note count. Toggle **Use for memory** / **Use for reference** independently.

**Setup — This device provider**

1. Run `npx expo install expo-file-system expo-document-picker`, then rebuild the native app (`npx expo run:ios` or `npx expo run:android`). Both packages add native modules, so a JS-only reload isn't enough.
2. On Android, the picker uses the **Storage Access Framework** — grant persistent folder access once and the app remembers it.
3. On iOS, the picker goes through the **Files app** — your vault must be accessible there (iCloud Drive or "On My iPhone"). Pick the vault folder; iOS security-scoped URLs handle the rest.
4. In the app: **Settings → Obsidian Vault → This device → Pick vault folder**. On success the integration auto-enables in read-only mode.

**How context gets injected:** on every message, memory notes are prepended to the prompt the agent sees, so the model always starts with up-to-date project/user context. The message in your chat bubble stays exactly as you typed it — the preamble is invisible in the UI.

---

### Interactive terminal

Tap the terminal icon in the thread header to open a full-height bottom sheet with a real shell running on the backend host — one persistent `bash` per thread, spawned lazily on the first command and killed when the thread is deleted. The shell starts in the thread's `workDir`, so `cd`, environment variables, and shell state persist across commands the way they would in a real terminal.

**Why it exists:** sometimes the agent asks you to run something it can't run itself — an interactive installer, a command that needs your credentials, or a one-off you'd rather verify by hand. Before this, you'd switch to your laptop, SSH in, run it, and paste the result back. The terminal drawer does all of that from your phone.

**What's in the UI:**

- **Prompt line** with the live cwd (`~/scripts $ █`) — updated after every command via a sentinel capture, so `cd foo` gives you instant visual feedback even though it produces no output.
- **ANSI rendering** — 8/16 + 256-color + truecolor, bold/dim/italic/underline. OSC and non-SGR escape sequences are stripped.
- **Accessory key row** above the keyboard: sticky `ctrl` and `⌘` modifiers, history ↑/↓ with draft preservation, `⎋` clear, `⇥` tab, `⌄` dismiss keyboard, and the shell punctuation iOS hides behind long-press (`|`, `~`, `/`, `\`, `*`, `&`, `>`, `<`, `$`, `` ` ``).
- **Sticky modifiers** — tap `ctrl` then `c` (from either the system keyboard or the accessory bar) to send SIGINT. Also: `ctrl+d` runs `exit`, `ctrl+l` clears the view, `ctrl+<a–z>` sends the matching control byte. `⌘+k` clears the view, `⌘+c` copies the last output to your clipboard, `⌘+v` pastes.
- **Send last output to Claw** — grabs the output from the most recent command, wraps it in a fenced code block, and drops it into the chat composer so you can ask the agent to interpret/fix/continue.
- **Swipe-down to dismiss** on the grabber; tap the backdrop to close.

**Caveats:**

- No PTY — full-screen TUI apps (`vim`, `less`, `top`, anything that checks `isatty`) won't render correctly. Swap in `node-pty` later if this becomes a pain point.
- The shell shares auth with the rest of the gateway. Anyone with your bearer token has a shell on the backend host — no broader than the existing agent tool-use exposure, but worth knowing.
- Rate-limited to 2000 lines per command and 200 lines/sec to keep the stream snappy; anything past that gets truncated with a notice.

---

## Screens

### Chat List (`app/index.tsx`)
Sorted by recent activity. Each row shows the thread title, working directory, message preview, and a live status indicator. Swipe left for delete/duplicate.

### Thread View (`app/thread/[id].tsx`)
The main chat screen — message bubbles with markdown rendering, a **ThinkingIndicator** showing live tool steps, inline permission prompts, a terminal bottom-sheet, model picker in the header, and a directory badge.

### Settings (`app/settings.tsx`)
VPS connection config and model queue management. Add models (Claude, OpenRouter, local), reorder them for fallback priority, toggle auto-compact and streaming.

---

## API Reference

All routes require `Authorization: Bearer <token>` (except `/health`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/threads` | List all threads |
| `POST` | `/threads` | Create a new thread |
| `DELETE` | `/threads/:id` | Delete a thread |
| `POST` | `/threads/:id/duplicate` | Duplicate a thread |
| `PATCH` | `/threads/:id` | Update thread (e.g. workDir) |
| `GET` | `/threads/:id/messages` | List messages |
| `POST` | `/threads/:id/messages` | Send a message & trigger AI run |
| `GET` | `/threads/:id/stream` | SSE stream (deltas, tool steps, terminal, status) |
| `POST` | `/threads/:id/stop` | Stop a running AI run |
| `POST` | `/threads/:id/permissions/:pid` | Approve/deny a permission request |
| `GET` | `/threads/:id/terminal` | Get terminal output + active-shell flag + cwd |
| `POST` | `/threads/:id/terminal` | Run a command in the thread's shell |
| `POST` | `/threads/:id/terminal/stdin` | Write raw bytes to shell stdin |
| `POST` | `/threads/:id/terminal/interrupt` | Send SIGINT to the running command |
| `POST` | `/threads/:id/terminal/kill` | SIGTERM the shell (next command lazy-respawns) |
| `GET` | `/threads/:id/terminal/snapshot` | Output lines since the most recent command |
| `GET` | `/fs/browse` | Browse remote filesystem |
| `POST` | `/obsidian/validate` | Check a backend-side vault path exists and count its `.md` files |

### SSE Event Types

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `{ status }` | Thread status change (`idle`/`running`/`waiting`/`error`) |
| `delta` | `{ messageId, chunk }` | Streaming text chunk |
| `message_error` | `{ messageId, text }` | Error in assistant message |
| `tool_start` | `{ id, tool, label, messageId }` | Agent started a tool |
| `tool_end` | `{ id, error? }` | Tool finished (or errored) |
| `permission_request` | `{ id, tool, description }` | Agent needs user approval |
| `terminal` | `{ chunk, cwd?, busy? }` | Terminal output chunk (lines, often batched); `cwd`/`busy` are metadata-only when `chunk` is empty |
| `done` | — | Run completed |
| `error` | — | Run errored out |

---

## Project Structure

```
├── app/                        # Expo Router screens
│   ├── _layout.tsx             # Root layout (providers, theme)
│   ├── index.tsx               # Chat list
│   ├── settings.tsx            # VPS connection + model queue
│   ├── thread/[id].tsx         # Thread/chat view
│   └── theme.ts                # (legacy — prefer constants/theme.ts)
├── components/
│   ├── SlashCommandPicker.tsx  # /compact, /ls, /diff, etc.
│   ├── DirectoryBrowser.tsx    # Remote filesystem browser
│   ├── animated-logo.tsx       # Animated app logo
│   ├── chat-container.tsx      # Chat wrapper
│   ├── chat-toolbar.tsx        # Legacy toolbar
│   ├── assistant-message.tsx   # Assistant bubble renderer
│   ├── user-message.tsx        # User bubble renderer
│   └── ui/                     # Shared UI primitives
├── constants/
│   └── theme.ts                # Design tokens (radius, spacing, shadow, typography)
├── store/
│   └── gatewayStore.ts         # Zustand store (state, SSE client, all actions)
├── backend/
│   └── src/
│       ├── app.ts              # Express app setup
│       ├── server.ts           # HTTP server entry
│       ├── db/
│       │   ├── schema.ts       # SQLite migrations
│       │   └── sqlite.ts       # DB connection
│       ├── routes/             # Express routers
│       │   ├── threads.ts
│       │   ├── messages.ts
│       │   ├── stream.ts
│       │   ├── terminal.ts
│       │   ├── fs.ts
│       │   ├── openApp.ts
│       │   └── health.ts
│       ├── services/           # Business logic
│       │   ├── threadService.ts
│       │   ├── messageService.ts
│       │   ├── runService.ts
│       │   ├── streamService.ts
│       │   ├── terminalService.ts
│       │   └── shellService.ts   # Persistent per-thread bash + batching + cwd capture
│       ├── runtime/
│       │   └── clawRuntime.ts  # Claw binary adapter (swap for RunPod)
│       ├── middleware/
│       │   └── auth.ts         # Bearer token auth
│       ├── config/
│       │   └── env.ts          # Environment config
│       └── types/
│           └── domain.ts       # Shared domain types
└── assets/                     # Icons, images, splash
```

---

## Design System

All UI tokens live in `constants/theme.ts`:

| Token | Values |
|-------|--------|
| `BORDER_RADIUS` | `xs` 4 · `sm` 8 · `md` 12 · `lg` 18 · `xl` 24 · `full` 9999 |
| `SPACING` | `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 |
| `SHADOW` | `sm` · `md` · `lg` (iOS shadow props + elevation) |
| `TYPOGRAPHY` | Font sizes 12–20, line heights 16–30 |

Colors come from `constants/palette.ts` — a custom theme system with lavender (default) and Claude accent palettes, full light/dark variants.

---

## Runtime Adapter

The gateway uses `clawRuntime.ts` to spawn the Claw Rust binary per turn. The runtime handles model queue fallback with retry, session snapshotting, proactive context compaction, auto-continue on truncated responses, and real-time streaming via stderr parsing. Model metadata (context windows, pricing) is fetched dynamically from OpenRouter and cached hourly.

---

## License

0BSD
