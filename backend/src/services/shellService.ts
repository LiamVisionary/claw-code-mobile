import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { resolveThreadCwd } from "../runtime/clawRuntime";
import { logger } from "../utils/logger";
import { streamService } from "./streamService";
import { terminalService } from "./terminalService";

type ShellSession = {
  child: ChildProcessWithoutNullStreams;
  threadId: string;
  cwd: string;
  startedAt: number;
  stdoutBuf: string;
  stderrBuf: string;
  outputLinesThisCommand: number;
  suppressingOutput: boolean;
  rateWindowStart: number;
  rateLinesInWindow: number;
  rateLimited: boolean;
  currentCommandOutput: string[];
  lastCommand?: string;
};

const MAX_LINES_PER_COMMAND = 2000;
const MAX_CURRENT_OUTPUT_KEEP = 4000;
const RATE_WINDOW_MS = 1000;
const MAX_LINES_PER_WINDOW = 200;
const MAX_SNAPSHOT_LINES = 500;

const sessions = new Map<string, ShellSession>();

function pickShell(): string {
  const preferred = process.env.SHELL ?? "";
  if (/\/(bash|zsh|sh)$/.test(preferred)) return preferred;
  return "/bin/bash";
}

function emit(session: ShellSession, line: string) {
  terminalService.appendChunk(session.threadId, line);
  streamService.publish(session.threadId, {
    type: "terminal",
    chunk: line + "\n",
  });
  session.currentCommandOutput.push(line);
  if (session.currentCommandOutput.length > MAX_CURRENT_OUTPUT_KEEP) {
    session.currentCommandOutput.splice(
      0,
      session.currentCommandOutput.length - MAX_CURRENT_OUTPUT_KEEP
    );
  }
}

function processLine(session: ShellSession, raw: string) {
  // Strip lone CRs inside a line (progress-bar style output) so we don't
  // feed control chars to the renderer. Embedded CRs would otherwise show
  // as garbled line endings.
  const line = raw.replace(/\r/g, "");
  if (line.length === 0) return;

  const now = Date.now();
  if (now - session.rateWindowStart > RATE_WINDOW_MS) {
    session.rateWindowStart = now;
    session.rateLinesInWindow = 0;
    session.rateLimited = false;
  }
  session.rateLinesInWindow++;
  if (session.rateLinesInWindow > MAX_LINES_PER_WINDOW) {
    if (!session.rateLimited) {
      session.rateLimited = true;
      emit(session, "[output rate-limited — hidden lines until next second]");
    }
    return;
  }

  session.outputLinesThisCommand++;
  if (session.outputLinesThisCommand > MAX_LINES_PER_COMMAND) {
    if (!session.suppressingOutput) {
      session.suppressingOutput = true;
      emit(session, "[...output truncated — exceeded 2000 lines per command]");
    }
    return;
  }

  emit(session, line);
}

function drain(session: ShellSession, which: "stdoutBuf" | "stderrBuf", data: Buffer) {
  const combined = session[which] + data.toString("utf8");
  const parts = combined.split(/\n/);
  session[which] = parts.pop() ?? "";
  for (const part of parts) processLine(session, part);
}

function spawnSession(threadId: string): ShellSession {
  const cwd = resolveThreadCwd(threadId);
  const shell = pickShell();
  const child = spawn(shell, [], {
    cwd,
    env: {
      ...process.env,
      // xterm-256color keeps ANSI colors when commands choose to emit them;
      // the client has a small parser for them. (Most commands still check
      // isatty() and won't colorize over a pipe — that's a PTY-only fix.)
      TERM: "xterm-256color",
      // Silence the prompt — we're not doing interactive REPL; the user
      // types commands and we echo a `$ ...` line ourselves.
      PS1: "",
      PS2: "",
      PROMPT_COMMAND: "",
      PAGER: "cat",
    },
    stdio: "pipe",
  });

  const session: ShellSession = {
    child,
    threadId,
    cwd,
    startedAt: Date.now(),
    stdoutBuf: "",
    stderrBuf: "",
    outputLinesThisCommand: 0,
    suppressingOutput: false,
    rateWindowStart: Date.now(),
    rateLinesInWindow: 0,
    rateLimited: false,
    currentCommandOutput: [],
  };

  child.stdout.on("data", (d: Buffer) => drain(session, "stdoutBuf", d));
  child.stderr.on("data", (d: Buffer) => drain(session, "stderrBuf", d));

  child.on("exit", (code, signal) => {
    // Flush any trailing buffered partial lines
    if (session.stdoutBuf) {
      processLine(session, session.stdoutBuf);
      session.stdoutBuf = "";
    }
    if (session.stderrBuf) {
      processLine(session, session.stderrBuf);
      session.stderrBuf = "";
    }
    emit(
      session,
      `[shell exited${code != null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}]`
    );
    sessions.delete(threadId);
  });

  child.on("error", (err) => {
    logger.warn({ err, threadId }, "Shell process error");
    emit(session, `[shell error: ${err.message}]`);
  });

  sessions.set(threadId, session);
  logger.info({ threadId, cwd, shell }, "Spawned user shell");
  return session;
}

export const shellService = {
  ensure(threadId: string): ShellSession {
    const existing = sessions.get(threadId);
    if (existing && !existing.child.killed) return existing;
    return spawnSession(threadId);
  },

  run(threadId: string, command: string) {
    const session = this.ensure(threadId);
    const prompt = `$ ${command}`;
    emit(session, prompt);
    session.outputLinesThisCommand = 0;
    session.suppressingOutput = false;
    session.rateWindowStart = Date.now();
    session.rateLinesInWindow = 0;
    session.rateLimited = false;
    session.currentCommandOutput = [];
    session.lastCommand = command;
    session.child.stdin.write(command + "\n");
  },

  sendStdin(threadId: string, data: string) {
    const session = this.ensure(threadId);
    session.child.stdin.write(data);
  },

  interrupt(threadId: string): boolean {
    const session = sessions.get(threadId);
    if (!session) return false;
    return session.child.kill("SIGINT");
  },

  kill(threadId: string): boolean {
    const session = sessions.get(threadId);
    if (!session) return false;
    const killed = session.child.kill("SIGTERM");
    sessions.delete(threadId);
    return killed;
  },

  snapshotSinceLastCommand(threadId: string): string[] {
    const session = sessions.get(threadId);
    if (!session) return [];
    const lines = session.currentCommandOutput.slice(-MAX_SNAPSHOT_LINES);
    return lines;
  },

  isActive(threadId: string): boolean {
    const session = sessions.get(threadId);
    return !!session && !session.child.killed;
  },

  shutdownAll() {
    for (const [, session] of sessions) {
      try {
        session.child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    }
    sessions.clear();
  },
};
