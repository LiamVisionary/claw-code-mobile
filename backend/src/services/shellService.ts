import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { resolveThreadCwd } from "../runtime/clawRuntime";
import { logger } from "../utils/logger";
import { streamService } from "./streamService";
import { terminalService } from "./terminalService";

/**
 * A 0x01-framed sentinel printed after every user command via an injected
 * `printf`. Lets us (a) update the tracked cwd so the client can show a
 * prompt like `~/scripts $`, and (b) know when a command has finished so
 * we can emit a `busy: false` state update.
 */
const CWD_SENTINEL_RE = /\x01CLAWCWD:(.*?)\x01$/;

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
  busy: boolean;
  /** Lines buffered for the next SSE publish — flushed on a 30 ms timer
   *  or eagerly when a CWD sentinel arrives. Keeps `ls` of a directory
   *  from becoming 50 separate SSE events. */
  pendingLines: string[];
  flushTimer: NodeJS.Timeout | null;
};

const MAX_LINES_PER_COMMAND = 5000;
const MAX_CURRENT_OUTPUT_KEEP = 4000;
const FLUSH_INTERVAL_MS = 30;
const MAX_SNAPSHOT_LINES = 1000;

const sessions = new Map<string, ShellSession>();

function pickShell(): string {
  const preferred = process.env.SHELL ?? "";
  if (/\/(bash|zsh|sh)$/.test(preferred)) return preferred;
  return "/bin/bash";
}

function scheduleFlush(session: ShellSession) {
  if (session.flushTimer) return;
  session.flushTimer = setTimeout(() => flushPending(session), FLUSH_INTERVAL_MS);
}

function flushPending(session: ShellSession, extra?: { cwd?: string; busy?: boolean }) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  const lines = session.pendingLines;
  session.pendingLines = [];

  if (lines.length > 0) {
    // Batch-insert into SQLite as a single transaction.
    terminalService.appendChunk(session.threadId, lines.join("\n"));
    session.currentCommandOutput.push(...lines);
    if (session.currentCommandOutput.length > MAX_CURRENT_OUTPUT_KEEP) {
      session.currentCommandOutput.splice(
        0,
        session.currentCommandOutput.length - MAX_CURRENT_OUTPUT_KEEP
      );
    }
  }

  // Only publish if there's actually something to say — avoids empty
  // events when flush is forced by a sentinel with no prior output.
  if (lines.length > 0 || extra) {
    streamService.publish(session.threadId, {
      type: "terminal",
      chunk: lines.length > 0 ? lines.join("\n") + "\n" : "",
      cwd: extra?.cwd ?? session.cwd,
      busy: extra?.busy ?? session.busy,
    });
  }
}

function processLine(session: ShellSession, raw: string) {
  // Strip lone CRs inside a line (progress-bar style output) so we don't
  // feed control chars to the renderer.
  const line = raw.replace(/\r/g, "");
  if (line.length === 0) return;

  // CWD sentinel: captures the PWD after every command. Update tracked
  // cwd, mark the shell idle, and force a flush so the client sees the
  // new prompt immediately instead of waiting for the 30 ms timer.
  const cwdMatch = line.match(CWD_SENTINEL_RE);
  if (cwdMatch) {
    const newCwd = cwdMatch[1];
    session.cwd = newCwd;
    session.busy = false;
    flushPending(session, { cwd: newCwd, busy: false });
    return;
  }

  session.outputLinesThisCommand++;
  if (session.outputLinesThisCommand > MAX_LINES_PER_COMMAND) {
    if (!session.suppressingOutput) {
      session.suppressingOutput = true;
      session.pendingLines.push("[...output truncated — exceeded 5000 lines per command]");
      scheduleFlush(session);
    }
    return;
  }

  session.pendingLines.push(line);
  scheduleFlush(session);
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
      TERM: "xterm-256color",
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
    busy: false,
    pendingLines: [],
    flushTimer: null,
  };

  child.stdout.on("data", (d: Buffer) => drain(session, "stdoutBuf", d));
  child.stderr.on("data", (d: Buffer) => drain(session, "stderrBuf", d));

  child.on("exit", (code, signal) => {
    if (session.stdoutBuf) {
      processLine(session, session.stdoutBuf);
      session.stdoutBuf = "";
    }
    if (session.stderrBuf) {
      processLine(session, session.stderrBuf);
      session.stderrBuf = "";
    }
    session.pendingLines.push(
      `[shell exited${code != null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}]`
    );
    session.busy = false;
    flushPending(session, { cwd: session.cwd, busy: false });
    sessions.delete(threadId);
  });

  child.on("error", (err) => {
    logger.warn({ err, threadId }, "Shell process error");
    session.pendingLines.push(`[shell error: ${err.message}]`);
    scheduleFlush(session);
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
    // Echo the command as a history line so the user sees what they typed
    // without depending on bash's own command echo. Include the cwd so
    // output stays visually anchored to where it was run.
    session.pendingLines.push(`$ ${command}`);
    session.outputLinesThisCommand = 0;
    session.suppressingOutput = false;
    session.currentCommandOutput = [];
    session.lastCommand = command;
    session.busy = true;
    // Flush immediately so the user sees their prompt echo even if the
    // command itself produces no output.
    flushPending(session, { cwd: session.cwd, busy: true });
    // Execute the command, then print the CWD sentinel so we can track
    // directory changes and detect command completion. The two statements
    // are separated by a newline — bash runs them sequentially regardless
    // of whether the first one succeeds.
    session.child.stdin.write(command + "\n");
    session.child.stdin.write(`printf '\\001CLAWCWD:%s\\001\\n' "$PWD"\n`);
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
    return session.currentCommandOutput.slice(-MAX_SNAPSHOT_LINES);
  },

  getCwd(threadId: string): string | undefined {
    return sessions.get(threadId)?.cwd;
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
