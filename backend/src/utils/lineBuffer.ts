/**
 * Chunk-aware line buffer for child-process streams.
 *
 * Node's `child.stderr.on("data", ...)` and `child.stdout.on("data", ...)`
 * events arrive as arbitrary-sized chunks with no regard for newline
 * boundaries. A single logical line (e.g. a `[stream]{"type":...}` event)
 * can span two or more chunks, which means a naive `chunk.split("\n")`
 * produces a partial fragment at the tail of every chunk and at the head
 * of the next. If the consumer then tries to `JSON.parse` those
 * fragments they silently drop — one dropped event per chunk boundary —
 * which is how we ended up with "chat an AI" instead of "chat with an AI"
 * in assistant responses.
 *
 * This helper holds any trailing unterminated fragment across chunks so
 * the consumer only ever sees complete newline-terminated lines. On
 * process close, the caller should call `flush()` to drain whatever
 * partial tail remains (the child may exit without a final newline).
 *
 * Usage:
 *   const lb = createLineBuffer((line) => handleLine(line));
 *   child.stderr.on("data", (c) => lb.push(c.toString()));
 *   child.on("close", () => lb.flush());
 */
export type LineBuffer = {
  /** Feed a new chunk of input. Emits any complete lines it contains. */
  push(chunk: string): void;
  /** Flush any unterminated trailing fragment. Call once on stream close. */
  flush(): void;
  /** Expose the pending fragment for tests / diagnostics. */
  readonly pending: string;
};

export function createLineBuffer(onLine: (line: string) => void): LineBuffer {
  let pending = "";
  return {
    push(chunk: string) {
      const combined = pending + chunk;
      const lines = combined.split("\n");
      // The last element is either empty (chunk ended with "\n") or an
      // unterminated partial that continues in the next chunk.
      pending = lines.pop() ?? "";
      for (const line of lines) {
        onLine(line);
      }
    },
    flush() {
      if (pending) {
        const tail = pending;
        pending = "";
        onLine(tail);
      }
    },
    get pending() {
      return pending;
    },
  };
}
