# Claw Code Mobile

## Project Overview

iPhone-first Expo app paired with a thin Node.js gateway server for streaming chat with Claw Code (Rust CLI agent). The app mirrors ChatGPT/Claude UX with thread switching, streaming assistant bubbles, and a live terminal drawer.

## Architecture

- **Mobile Frontend:** Expo + React Native (TypeScript), Expo Router, Zustand state, NativeWind styling, XHR-based SSE streaming.
- **Gateway Backend:** Express 5 + TypeScript, SQLite persistence (better-sqlite3), SSE streaming, bearer-token auth, Claw Code subprocess runtime.
- **Claw Code:** Rust CLI (`ultraworkers/claw-code`) cloned to `claw-code/`, built to `claw-code/rust/target/debug/claw`.

## Project Structure

```
/
├── app/              # Expo Router pages (index, thread/[id], settings)
├── components/       # Reusable UI components
├── store/            # Zustand state (gatewayStore.ts) — XHR SSE, file-based persistence
├── assets/           # Static images and icons
├── backend/
│   ├── src/
│   │   ├── app.ts            # Express app setup
│   │   ├── server.ts         # Entry point
│   │   ├── config/env.ts     # Environment config (port: 5000)
│   │   ├── db/               # SQLite schema & migrations
│   │   ├── routes/           # health, threads, messages, stream, terminal
│   │   ├── middleware/auth.ts # Bearer token auth
│   │   ├── runtime/clawRuntime.ts  # Spawns claw binary, streams JSON response word-by-word
│   │   ├── services/         # Business logic
│   │   └── utils/            # logger, errors
│   └── data/
│       ├── gateway.db        # SQLite database
│       └── workspaces/       # Per-thread claw working directories (.claw/sessions/ inside each)
├── claw-code/        # ultraworkers/claw-code Rust source (cloned at first run)
│   └── rust/target/debug/claw  # Built binary
└── scripts/
    ├── setup-and-run.sh      # Expo tunnel workflow entry point
    ├── build-claw.sh         # Clone + build claw binary
    └── start-tunnel-share.mjs # ngrok + Telegram notification
```

## Running the Project

### Mobile Dev (Expo Tunnel workflow)
```bash
bash scripts/setup-and-run.sh
```
- Installs deps, patches ngrok token, builds claw if needed, starts Expo tunnel
- Sends Telegram notification with QR link when tunnel is ready

### Backend Gateway (Start application workflow)
```bash
cd backend && yarn dev
```
Gateway runs on port 5000.

### First-Time Claw Build
```bash
bash scripts/build-claw.sh
```
Clones `ultraworkers/claw-code` and runs `cargo build`. Takes ~5 min on first run.

## Environment Variables
- `PORT` (default: 5000)
- `GATEWAY_AUTH_TOKEN` (default: `dev-token`)
- `DATABASE_FILE` (optional sqlite path)
- `EXPO_TOKEN` — for Expo tunnel
- `NGROK_AUTHTOKEN` — personal ngrok hobbyist token

## Key Notes

### Claw Runtime
- Per thread: isolated workspace at `backend/data/workspaces/<threadId>/`
- First message: `claw --output-format json prompt "..."` (no session)
- Follow-up: `claw --output-format json --resume latest prompt "..."` (continues session)
- JSON response streamed word-by-word for visual streaming effect
- Stderr forwarded as terminal events in real-time
- Tool uses / tool results appended to terminal after run completes

### Model Config
- Configured in Settings screen (provider / model name / API key)
- Sent with each message to backend → forwarded to claw via env vars
- Claude: `ANTHROPIC_API_KEY`
- OpenRouter: `OPENAI_API_KEY` + `OPENAI_BASE_URL=https://openrouter.ai/api/v1`

### SSE Streaming
- Mobile uses XHR-based SSE (not `@microsoft/fetch-event-source` which requires `document`)
- Events: `status` | `delta` | `terminal` | `done` | `error`

### Persistence
- Settings persisted via `expo-file-system/legacy` (replaces broken AsyncStorage v3)
- Zustand persist — settings only (threads/messages always from backend)
