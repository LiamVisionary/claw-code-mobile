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
- **Terminal drawer** — Pull-up bottom sheet with live terminal output and command input
- **Model queue with fallback** — Configure multiple AI models (Claude, OpenRouter, local) that auto-fallback if one fails
- **Auto-compact** — Automatically summarizes conversation context when the window fills up
- **Directory browser** — Browse your remote filesystem and pick a working directory per thread
- **Dark & light mode** — Full native iOS theming with semantic colors
- **Swipe actions** — Swipe to delete or duplicate conversations
- **Message queuing** — Queue a message while the AI is busy; it sends automatically when the run finishes

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

### 1. Gateway

```bash
cd backend
yarn install
GATEWAY_AUTH_TOKEN=dev-token yarn dev
# → http://localhost:4000
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `GATEWAY_AUTH_TOKEN` | `dev-token` | Bearer token for API auth |
| `DATABASE_FILE` | — | SQLite file path (optional) |

### 2. Mobile

```bash
yarn install
yarn start
```

Then in **Settings** (gear icon):

1. Set **Server URL** — e.g. `http://localhost:4000`
2. Set **Bearer token** — match `GATEWAY_AUTH_TOKEN`
3. Tap **Test** to confirm `/health` responds

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

Colors come from `@bacons/apple-colors` — semantic iOS colors that automatically adapt to dark/light mode.

---

## Runtime Adapter

The gateway ships with a stubbed `clawRuntime` that simulates AI deltas and terminal output. Swap it for a real Claw binary or RunPod-backed adapter while keeping the API surface unchanged.

---

## License

0BSD
