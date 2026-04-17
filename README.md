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
- **Model queue with fallback + retry** — Configure multiple AI models (Claude, OpenRouter, local) that retry transient errors with backoff before falling through to the next model
- **Auto-compact** — Automatically summarizes conversation context when the window fills up
- **Directory browser** — Browse your remote filesystem and pick a working directory per thread
- **Dark & light mode** — Full native iOS theming with semantic colors
- **Swipe actions** — Swipe to delete or duplicate conversations
- **Message queuing** — Queue a message while the AI is busy; it sends automatically when the run finishes
- **Local diagnostic telemetry** — Every SSE emission, tool call, token count, and client render is logged to a local `events` table so you can diff backend-emitted events against what the UI rendered and find token-consumption hot spots. **All telemetry lives on your own machine** — events are written to the same local SQLite database the rest of the app uses, never transmitted off-device. The goal is to enable stronger local data analysis and UX improvements without any data leaving your setup. Toggle it off any time under Settings → Behaviour → "Diagnostic telemetry".

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
| `GET` | `/threads/:id/terminal` | Get terminal output |
| `POST` | `/threads/:id/terminal` | Send a terminal command |
| `GET` | `/fs/browse` | Browse remote filesystem |

### SSE Event Types

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `{ status }` | Thread status change (`idle`/`running`/`waiting`/`error`) |
| `delta` | `{ messageId, chunk }` | Streaming text chunk |
| `message_error` | `{ messageId, text }` | Error in assistant message |
| `tool_start` | `{ id, tool, label, messageId }` | Agent started a tool |
| `tool_end` | `{ id, error? }` | Tool finished (or errored) |
| `permission_request` | `{ id, tool, description }` | Agent needs user approval |
| `terminal` | `{ chunk }` | Terminal output chunk |
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
│       │   └── terminalService.ts
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
