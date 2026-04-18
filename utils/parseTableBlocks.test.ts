/**
 * Tests for the streaming table segmenter. Run with `npm test`.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseTableBlocks } from "./parseTableBlocks";
import { cleanModelMarkdown } from "./markdownCleanup";

describe("parseTableBlocks", () => {
  it("returns a single text segment for content without tables", () => {
    const segs = parseTableBlocks("just some prose\nand another line");
    assert.equal(segs.length, 1);
    assert.equal(segs[0].type, "text");
    assert.equal((segs[0] as any).content, "just some prose\nand another line");
  });

  it("parses a well-formed table with a separator row", () => {
    const input = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    const segs = parseTableBlocks(input);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].type, "table");
    const t = segs[0] as any;
    assert.deepEqual(t.header, ["a", "b"]);
    assert.deepEqual(t.rows, [
      ["1", "2"],
      ["3", "4"],
    ]);
    assert.equal(t.columnCount, 2);
  });

  it("renders a partial table (header only, no separator yet)", () => {
    const input = "| a | b |";
    const segs = parseTableBlocks(input);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].type, "table");
    const t = segs[0] as any;
    // Without a separator, the first row sits in rows and header is null —
    // the live renderer will show it as the first visible row until the
    // separator arrives and promotes it to a header.
    assert.equal(t.header, null);
    assert.deepEqual(t.rows, [["a", "b"]]);
  });

  it("interleaves text and table segments", () => {
    const input = "intro line\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\noutro";
    const segs = parseTableBlocks(input);
    assert.equal(segs.length, 3);
    assert.equal(segs[0].type, "text");
    assert.equal(segs[1].type, "table");
    assert.equal(segs[2].type, "text");
    assert.equal((segs[2] as any).content, "outro");
  });

  it("ignores single-pipe lines in prose", () => {
    const input = "use `|` as a separator\nand that's fine";
    const segs = parseTableBlocks(input);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].type, "text");
  });

  it("handles the user's messy real-world streamed table end-to-end", () => {
    const input =
      "Here's a snapshot of changes to Claw Code Mobile:| Commit | Branch | Summary ||--------|--------|---------|| **`8804cdd`** | `main` | Added Scope model queue. || **`7677543`** | `main` | Fixed the Cloudflare instructions. |Additionally, the working tree contains:- A few staged changes.- One deleted file.";
    const cleaned = cleanModelMarkdown(input);
    const segs = parseTableBlocks(cleaned);

    // We expect: intro paragraph, table, outro paragraph with bullets
    const types = segs.map((s) => s.type);
    assert.deepEqual(types, ["text", "table", "text"]);

    const table = segs[1] as any;
    assert.deepEqual(table.header, ["Commit", "Branch", "Summary"]);
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0][0], "**`8804cdd`**");
    assert.equal(table.rows[1][0], "**`7677543`**");

    const outro = (segs[2] as any).content;
    assert.ok(outro.includes("Additionally"), "outro retained");
    assert.ok(outro.includes("- A few staged changes"), "bullets split out");
    assert.ok(outro.includes("- One deleted file"), "all bullets split");
  });

  it("returns an empty array for empty input", () => {
    assert.deepEqual(parseTableBlocks(""), []);
  });
});
