# Architecture Documentation

## Overview

**Claw Code** is an AI chat client — a React Native (Expo) mobile app paired with an Express.js backend that acts as a gateway to an AI coding agent called **Claw**. The mobile app provides a chat interface where users converse with an AI that can execute code, edit files, and manage projects on a remote VPS.

---

## Architecture: Two-Part System

### 1. Mobile Frontend (`/app`, `/components`, `/store`, `/constants`)

| Detail | Value |
|--------|-------|
| Framework | Expo SDK 54, React Native 0.81 |
| Navigation | Expo Router v6 (Stack-based) |
| State Management | Zustand with file-system persistence |
| UI System | `@bacons/apple-colors` (dynamic iOS semantic colors), custom design tokens |
| Key Libraries | `@gorhom/bottom-sheet`, `react-native-reanimated`, `expo-blur`, `expo-clipboard` |

### 2. Backend Server (`/backend`)

| Detail | Value |
|--------|-------|
| Framework | Express.js with SQLite (better-sqlite3) |
| Runtime | Spawns a **Claw binary** (Rust CLI) as child processes per AI run |
| Real-time | SSE (Server-Sent Events) for streaming AI responses, terminal output, status, and tool events |
| Auth | Bearer token middleware |

---

## Data Flow

```
Mobile App  ──HTTP──>  Express Backend  ──spawn──>  Claw Binary (Rust)
     │                       │                           │
     │  SSE stream           │  stdout/stderr            │
     │<──────────────────────│<──────────────────────────│
     │                       │                           │
     │  Zustand store        │  SQLite DB                │
     │  (messages, threads,  │  (threads, messages,      │
     │   toolSteps, perms)   │   runs, terminal_lines)   │
```

1. **User sends message** → POST `/threads/:id/messages` → backend spawns Claw process with the prompt
2. **Claw runs** → stdout parsed as JSON (response text, tool uses, cost) → streamed word-by-word via SSE `delta` events
3. **Mobile SSE client** (`openNativeSSE` in gatewayStore) receives events → Zustand updates → React re-renders
4. **Terminal output** piped from stderr → `terminal` SSE events → bottom-sheet terminal view
5. **Tool step events** (`tool_start`, `tool_end`, `permission_request`) → `ThinkingIndicator` component shows live activity

---

## Key Screens & Components

| File | Purpose |
|------|---------|
| `app/index.tsx` | Chat list — shows all threads sorted by recent activity |
| `app/thread/[id].tsx` | **Thread view** — main chat screen with message bubbles, `ThinkingIndicator`, slash command picker, terminal bottom-sheet, inline permission prompts |
| `app/settings.tsx` | VPS connection config + model queue management (Claude/OpenRouter/Local with fallback ordering) |
| `app/_layout.tsx` | Root layout with `GestureHandlerRootView`, `BottomSheetModalProvider`, `ThemeProvider` |
| `components/SlashCommandPicker.tsx` | Animated popover for `/compact`, `/ls`, `/git status`, `/diff`, `/pwd`, `/help` |
| `components/DirectoryBrowser.tsx` | Modal for browsing remote filesystem to select a working directory |
| `components/chat-toolbar.tsx` | Legacy AI SDK toolbar (not used in the gateway flow) |
| `components/chat-container.tsx` | Simple container component |
| `components/assistant-message.tsx` | Renders assistant message bubbles with markdown and copy support |

---

## Data Model

Shared between frontend & backend:

### Thread
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (prefixed `thr_`) |
| title | string | Display title (auto-generated from timestamp if not provided) |
| repoName | string | Repository name |
| status | `idle` \| `running` \| `waiting` \| `error` | Current thread status |
| workDir | string | Working directory on the remote VPS |
| lastMessagePreview | string | Truncated preview of the last message |
| remoteSessionId | string? | Linked remote session ID |
| createdAt | string | ISO timestamp |

### Message
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (prefixed `msg_`) |
| threadId | string | Parent thread |
| role | `user` \| `assistant` \| `system` | Message role |
| content | string | Message text content |
| createdAt | string | ISO timestamp |

### Run
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (prefixed `run_`) |
| threadId | string | Parent thread |
| status | `running` \| `done` \| `stopped` \| `error` | Run lifecycle status |
| timestamps | various | Start/end times |

### Frontend-Only Models

- **ToolStep**: id, tool, label, status, startedAt — tracks tool execution progress displayed in `ThinkingIndicator`
- **PermissionRequest**: id, tool, description, pending — inline permission prompts from the AI
- **FsEntry/FsListing**: for remote filesystem browsing in `DirectoryBrowser`

---

## API Routes

### Threads (`/api/threads`)
- `GET /threads` — List all threads (sorted by updatedAt DESC)
- `POST /threads` — Create a new thread (optional title, workDir)

### Messages (`/api/messages`)
- `GET /threads/:id/messages` — List messages for a thread
- `POST /threads/:id/messages` — Send a user message and trigger AI run

### Streaming (`/api/stream`)
- `GET /threads/:id/stream` — SSE endpoint for real-time events (response deltas, tool steps, terminal output, permission requests, status changes)

---

## Model Queue & Fallback System

The settings screen lets users configure an **ordered queue of AI models** (Claude, OpenRouter, Local). If a model fails (e.g., context overflow), the system automatically:

1. Tries the next model in the queue
2. Or auto-compacts the conversation context and retries

---

## Theme System

| File | Purpose |
|------|---------|
| `/constants/theme.ts` | Design tokens — `BORDER_RADIUS`, `SPACING`, `SHADOW`, `TYPOGRAPHY` |
| `/app/theme.ts` | Legacy duplicate — should consolidate to `/constants/theme.ts` |
| iOS SF Symbols | Via `expo-symbols` for consistent iconography |
| `@bacons/apple-colors` | Semantic colors for automatic dark/light mode |

---

## Key Design Patterns

- **SSE reconnection**: Custom XHR-based SSE client with automatic reconnect every 2s
- **Lazy assistant messages**: Created only on first content delta (prevents empty ghost bubbles)
- **File-system persistence**: Zustand state persisted to Expo FileSystem (JSON files)
- **Apple-native theming**: Semantic colors via `@bacons/apple-colors` for automatic dark/light mode
- **Message queuing**: Pending AI responses are queued and processed sequentially