# Claw Code Mobile

iPhone-first Expo app paired with a thin Node.js gateway for streaming chat with remote Claw sessions. The app mirrors ChatGPT/Claude UX with thread switching, streaming assistant bubbles, and an optional terminal drawer.

## What's Inside
- **Mobile:** Expo + TypeScript, Expo Router, Zustand state, bottom-sheet terminal, SSE-driven chat.
- **Gateway:** Express + TypeScript, SQLite persistence, SSE streaming, bearer-token auth, stubbed Claw runtime ready to swap for RunPod.

## Quick Start

### 1) Gateway
```bash
cd backend
yarn install
GATEWAY_AUTH_TOKEN=dev-token yarn dev
# defaults to http://localhost:4000
```

Configuration (env):
- `PORT` (default `4000`)
- `GATEWAY_AUTH_TOKEN` (default `dev-token`)
- `DATABASE_FILE` (optional sqlite file path)

### 2) Mobile
```bash
yarn install
EXPO_PUBLIC_GATEWAY_URL=http://localhost:4000 # optional helper
yarn start
```

In **Settings** (gear icon):
- Set **Server URL** (e.g. `http://localhost:4000`)
- Set **Bearer token** (match `GATEWAY_AUTH_TOKEN`)
- Tap **Test** to confirm `/health` responds.

## Product Notes
- Thread list shows status pill, repo, preview, and updated time.
- Chat screen streams assistant output into one bubble, shows run status, stop button, and opens a terminal bottom sheet.
- Terminal drawer streams live chunks and accepts manual commands.
- State is persisted client-side for server URL/token; everything else streams from the gateway.

## API Snapshot
- `GET /health`
- `GET /threads` / `POST /threads`
- `GET /threads/:id/messages` / `POST /threads/:id/messages`
- `GET /threads/:id/stream` (SSE: status | delta | terminal | done | error)
- `POST /threads/:id/stop`
- `GET /threads/:id/terminal` / `POST /threads/:id/terminal`

Auth: `Authorization: Bearer <token>` on all routes except `/health`.

## Runtime Adapter
The gateway ships with a stubbed `clawRuntime` that simulates deltas and terminal output. Swap it for a RunPod-backed adapter to connect to real Claw sessions while keeping the API surface unchanged.
