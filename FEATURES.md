# Features wishlist

Running list of features we want to build. Add new entries at the bottom; move shipped items to the bottom under "Shipped".

## Planned

### Interactive remote terminal
A real shell session on the backend machine, reachable from the thread screen.

- Backend: spawn a PTY per thread (`node-pty`) scoped to the thread's working directory, bridge stdin/stdout over a WebSocket (SSE is one-way, no good for keystrokes). Lifecycle tied to the thread; reap on thread close.
- Mobile: xterm.js inside a `react-native-webview` is the pragmatic path — there's no solid native RN terminal widget. Pipe keystrokes out, write bytes in, resize on layout.
- Auth: reuse the existing bearer token. Socket upgrade must validate it.
- Not to be confused with the current "terminal" stream, which is just claw's stdout telemetry (now surfaced as a per-turn "Worked for X" row under the assistant bubble).

## Shipped

_(none yet)_
