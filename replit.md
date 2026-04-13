# Claw Code Mobile

## Project Overview

iPhone-first Expo app paired with a thin Node.js gateway server for streaming chat with remote Claw sessions. The app mirrors ChatGPT/Claude UX with thread switching, streaming assistant bubbles, and an optional terminal drawer.

## Architecture

- **Mobile Frontend:** Expo + React Native (TypeScript), Expo Router, Zustand state, NativeWind styling, SSE-driven chat.
- **Gateway Backend:** Express 5 + TypeScript, SQLite persistence (better-sqlite3), SSE streaming, bearer-token auth, stubbed Claw runtime.

## Project Structure

```
/
├── app/              # Expo Router pages (index, thread/[id], settings)
├── components/       # Reusable UI components (chat, terminal, maps, movies)
├── store/            # Zustand state (gatewayStore.ts)
├── assets/           # Static images and icons
├── fixtures/         # Mock JSON data (locations, movies, weather)
├── backend/
│   ├── src/
│   │   ├── app.ts            # Express app setup
│   │   ├── server.ts         # Entry point
│   │   ├── config/env.ts     # Environment config (port: 5000)
│   │   ├── db/               # SQLite schema & migrations
│   │   ├── routes/           # health, threads, messages, stream, terminal
│   │   ├── middleware/auth.ts # Bearer token auth
│   │   ├── runtime/clawRuntime.ts  # Stubbed Claw runtime (swap for RunPod)
│   │   ├── services/         # Business logic
│   │   └── utils/            # logger, errors
│   └── data/         # SQLite database file (gateway.db)
```

## Running the Project

### Development
The workflow `Start application` runs the backend gateway:
```bash
cd backend && yarn dev
```
Gateway runs on port 5000.

### Environment Variables
- `PORT` (default: 5000)
- `GATEWAY_AUTH_TOKEN` (default: `dev-token`)
- `DATABASE_FILE` (optional sqlite path)
- `DATA_DIR` (optional data directory)

### Auth
All routes except `GET /` and `GET /health` require `Authorization: Bearer <token>`.

## API Endpoints

- `GET /health` — Health check (public)
- `GET /threads` / `POST /threads`
- `GET /threads/:id/messages` / `POST /threads/:id/messages`
- `GET /threads/:id/stream` — SSE streaming
- `POST /threads/:id/stop`
- `GET /threads/:id/terminal` / `POST /threads/:id/terminal`

## Key Notes

- This is primarily a mobile app (iOS); the Replit preview shows the backend gateway status page.
- The `clawRuntime` is stubbed with simulated responses — swap for a RunPod adapter for real sessions.
- `pino-pretty` is installed as a dev logging dependency.
- The `GET /` route serves an HTML status page (no auth required).
