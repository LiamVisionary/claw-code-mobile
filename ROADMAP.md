# Roadmap

Open backlog for Claw Code Mobile. Items are grouped by status, not priority — order within a group doesn't imply ordering of work.

Want to push one of these forward? Open an issue or PR — contributions are very welcome. See the [Foreword](README.md#foreword) for the why.

---

## In progress

_Nothing yet. Pick something below to start._

---

## Proposed

### Mobile-GPU inference: phone-as-inference-host

Run a small-to-medium model on the phone's GPU (Apple Neural Engine via MLX / Metal, Android NN-API on Snapdragon) and stream its responses **into the backend** as if it were any other OpenAI-compatible provider. Inverts the usual flow — instead of the backend reaching out to a model server, the phone exposes a model server the backend calls into over the existing tunnel.

**Why it matters:** modern phones have surprising amounts of compute (M-series-class Apple silicon, Snapdragon 8 Gen 3 NPUs). For lightweight code edits, summarisation, and routing decisions, on-device inference is free, private, and removes round-trips to a remote model — while keeping the backend's filesystem/tooling powers intact.

**Open questions:**
- Model runner: MLX-Swift on iOS? llama.cpp Metal via React Native bindings?
- Battery / thermal budget: streaming for 30+ seconds on a hot phone is brutal. Probably needs a "burst then back off" mode.
- Wire-up: the phone exposes `http://<lan-ip>:<port>/v1` and the backend hits it through a reverse tunnel, mirroring how we already let users reach Mac-side Ollama from a VPS backend (cloudflared / SSH).

**Status:** proposed. No prototype yet.

### Fully on-device claw code: backend-less local agent

Compile the claw harness to iOS / Android and run the entire agent loop on-device with a local model. No backend, no tunnel, no internet — code on a plane, in a tunnel, off-grid.

**Scope:**
- Claw harness (Rust) cross-compiled to iOS arm64 + Android arm64.
- On-device model: 3-7B class GGUF via llama.cpp Metal/Vulkan, or MLX for Apple silicon.
- Filesystem: scoped to a user-picked folder (iOS Files app via `expo-file-system`, Android via SAF), then claw treats that as its workspace.
- Tools: subset that makes sense on-device — file edit, search, terminal-via-shell-on-device (where allowed), git via libgit2.
- Memory: existing Obsidian-vault integration extends naturally — local vault becomes the agent's memory.

**Why it matters:** this is the "private dev environment in your pocket" play. Useful for sensitive codebases, air-gapped work, or when you just want to hack on something while flying without paying for in-flight wifi to ping a VPS.

**Open questions:**
- Apple's app review for shipping a GPL-licensed Rust agent + LLM in an app — needs care around how the binary is bundled and what entitlements are claimed.
- iOS sandboxing limits what tools claw can run (no `/bin/sh`, no spawning arbitrary processes). The tool surface needs a safe equivalent path.
- Cross-compile of `@bitbonsai/mcpvault` (a Node binary) won't fly on-device — need a Rust-native vault implementation or skip MCP-vault tools in this mode.

**Status:** proposed. No prototype yet. Significant scope — likely a multi-week effort.

---

## Shipped

- Per-backend model queue scoping ([8804cdd](../../commit/8804cdd))
- Tool-call format demuxer for Harmony + Hermes-XML + OpenAI-native, with integration tests across all dialects ([260914a](../../commit/260914a), [aa03a11](../../commit/aa03a11))
- One-tap local-model discovery (Current backend / Other modes) ([198b698](../../commit/198b698))
- Obsidian vault integration with backend / local providers, headless Sync, and in-app notes browser
- Bundled mcpvault MCP server so vault tools work without a separate global install ([b4340b8](../../commit/b4340b8))
- Interactive in-app terminal with cwd-aware prompt, history, and ANSI rendering
- Streaming SSE pipeline with chunk-aware buffering, retry-with-backoff, and per-turn telemetry
