/**
 * Tests for the chunk-aware line buffer. These are the *real* tests
 * for the bug we shipped: chunks that split lines mid-way used to
 * silently drop the partial fragment on both sides, which corrupted
 * streamed assistant text. Each case here is one regression guard.
 *
 * Run with: `npm --prefix backend run test`
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createLineBuffer } from "./lineBuffer";

function collect(): { lines: string[]; lb: ReturnType<typeof createLineBuffer> } {
  const lines: string[] = [];
  const lb = createLineBuffer((l) => lines.push(l));
  return { lines, lb };
}

describe("createLineBuffer", () => {
  it("emits a single complete line terminated by \\n", () => {
    const { lines, lb } = collect();
    lb.push("hello world\n");
    assert.deepEqual(lines, ["hello world"]);
    assert.equal(lb.pending, "");
  });

  it("emits multiple complete lines in one chunk", () => {
    const { lines, lb } = collect();
    lb.push("one\ntwo\nthree\n");
    assert.deepEqual(lines, ["one", "two", "three"]);
    assert.equal(lb.pending, "");
  });

  it("holds an unterminated line as pending and emits nothing", () => {
    const { lines, lb } = collect();
    lb.push("partial");
    assert.deepEqual(lines, []);
    assert.equal(lb.pending, "partial");
  });

  it("joins pending fragments across multiple chunks before emitting", () => {
    const { lines, lb } = collect();
    lb.push("he");
    lb.push("llo ");
    lb.push("world\n");
    assert.deepEqual(lines, ["hello world"]);
    assert.equal(lb.pending, "");
  });

  it("emits complete lines and keeps the trailing partial for next chunk", () => {
    const { lines, lb } = collect();
    lb.push("first\nsec");
    assert.deepEqual(lines, ["first"]);
    assert.equal(lb.pending, "sec");
    lb.push("ond\nthird\n");
    assert.deepEqual(lines, ["first", "second", "third"]);
    assert.equal(lb.pending, "");
  });

  it("reassembles a long JSON event that was split mid-value", () => {
    // This is the exact failure mode that corrupted assistant text:
    // a `[stream]{"type":"text_delta","text":" with"}` line arrives
    // in two chunks with the split landing inside the JSON value.
    // Pre-fix, the stderr handler would have split the first chunk
    // by "\n", produced a partial string as "last line", and tried
    // to JSON.parse it — which failed, dropping the event.
    const { lines, lb } = collect();
    lb.push('[stream]{"type":"text_delta","text":" wi');
    assert.deepEqual(lines, []); // nothing emitted yet
    lb.push('th"}\n');
    assert.deepEqual(lines, ['[stream]{"type":"text_delta","text":" with"}']);
  });

  it("never drops bytes across arbitrary chunk boundaries in a synthetic stream", () => {
    // Strong property: feed a known stream split at every possible
    // byte boundary and verify the reassembly is exact.
    const payload = [
      '[stream]{"type":"text_delta","text":"Hello"}',
      '[stream]{"type":"text_delta","text":" world"}',
      '[stream]{"type":"text_delta","text":", this is"}',
      '[stream]{"type":"text_delta","text":" a long"}',
      '[stream]{"type":"text_delta","text":" message with many chunk boundaries"}',
      '[stream]{"type":"tool_start","name":"read","input":{"path":"/tmp/x"}}',
      "[hook PreToolUse] bash: ls -la",
      '[stream]{"type":"text_delta","text":"."}',
    ].join("\n") + "\n";

    for (let split = 1; split < payload.length; split++) {
      const { lines, lb } = collect();
      lb.push(payload.slice(0, split));
      lb.push(payload.slice(split));
      lb.flush();
      assert.equal(
        lines.join("\n") + "\n",
        payload,
        `failed at split offset ${split}`
      );
    }
  });

  it("reassembles across three- and four-way splits", () => {
    const payload =
      '[stream]{"type":"text_delta","text":"first chunk"}\n' +
      '[stream]{"type":"text_delta","text":"second chunk here"}\n';
    for (const a of [5, 20, 50, 90]) {
      for (const b of [a + 3, a + 30]) {
        if (b >= payload.length) continue;
        const { lines, lb } = collect();
        lb.push(payload.slice(0, a));
        lb.push(payload.slice(a, b));
        lb.push(payload.slice(b));
        lb.flush();
        assert.deepEqual(lines, [
          '[stream]{"type":"text_delta","text":"first chunk"}',
          '[stream]{"type":"text_delta","text":"second chunk here"}',
        ]);
      }
    }
  });

  it("handles \\r\\n line endings by leaving the \\r intact (consumer trims)", () => {
    // Some platforms emit CRLF. We split on "\n" only and let the
    // caller `trim()` as they already do in clawRuntime.
    const { lines, lb } = collect();
    lb.push("hello\r\nworld\r\n");
    assert.deepEqual(lines, ["hello\r", "world\r"]);
  });

  it("handles empty chunks without emitting or losing state", () => {
    const { lines, lb } = collect();
    lb.push("part");
    lb.push("");
    lb.push("ial\n");
    assert.deepEqual(lines, ["partial"]);
  });

  it("flush() drains a final unterminated line", () => {
    const { lines, lb } = collect();
    lb.push("final line with no newline");
    assert.deepEqual(lines, []);
    lb.flush();
    assert.deepEqual(lines, ["final line with no newline"]);
    assert.equal(lb.pending, "");
  });

  it("flush() is a no-op when there is no pending tail", () => {
    const { lines, lb } = collect();
    lb.push("complete\n");
    lb.flush();
    assert.deepEqual(lines, ["complete"]);
  });

  it("handles a realistic long claw text-delta burst preserving every word", () => {
    const words = [
      "Here's", "what", "the", "README", "covers", "for", "Claw", "Code", "Mobile:",
      "an", "iPhone", "app", "that", "lets", "you", "chat", "with", "an", "AI",
      "that", "can", "execute", "code,", "edit", "files,", "and", "manage",
      "projects", "on", "a", "remote", "VPS.",
    ];
    const deltas = words.map((w) => `[stream]{"type":"text_delta","text":" ${w}"}`);
    const payload = deltas.join("\n") + "\n";

    const { lines, lb } = collect();
    // Simulate the child process delivering this payload in random
    // small chunks — the stress case for the bug.
    let i = 0;
    while (i < payload.length) {
      const take = Math.min(1 + ((i * 7) % 29), payload.length - i);
      lb.push(payload.slice(i, i + take));
      i += take;
    }
    lb.flush();

    // Extract the `text` fields and concatenate. Every word should be present.
    const reassembled = lines
      .map((l) => {
        const m = l.match(/"text":"([^"]*)"/);
        return m ? m[1] : "";
      })
      .join("");
    assert.equal(
      reassembled.trim(),
      words.join(" "),
      "word-drop bug regression — reassembled text missing words"
    );
  });
});
