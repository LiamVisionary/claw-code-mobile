/**
 * Tests for the markdown preprocessors. These are the second line of
 * defense: the real fix was in the backend stderr line buffer, but
 * these client-side helpers clean up any half-mangled markdown that
 * does slip through (e.g. model-side quirks unrelated to our pipeline).
 *
 * Run with: `npm test` from the project root.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  cleanModelMarkdown,
  fixupStuckHeaders,
  stripMalformedCodeSpans,
} from "./markdownCleanup";

describe("fixupStuckHeaders", () => {
  it("inserts a blank line before a bolded title stuck to a previous word", () => {
    const input = "DB**Design System:** Tokens in constants/theme.ts";
    const out = fixupStuckHeaders(input);
    assert.equal(out, "DB\n\n**Design System:** Tokens in constants/theme.ts");
  });

  it("does not touch mid-sentence bolded phrases preceded by whitespace", () => {
    const input = "see **Section:** below for details";
    const out = fixupStuckHeaders(input);
    assert.equal(out, "see **Section:** below for details");
  });

  it("only matches capitalized titles ending in a colon", () => {
    const input = "word**lowercase:** content and word**NoColon** content";
    const out = fixupStuckHeaders(input);
    // Neither should be split — first starts lowercase, second lacks a colon.
    assert.equal(out, "word**lowercase:** content and word**NoColon** content");
  });

  it("leaves well-formed headers with their own blank line untouched", () => {
    const input = "Summary.\n\n**Architecture:** Three layers.";
    const out = fixupStuckHeaders(input);
    assert.equal(out, "Summary.\n\n**Architecture:** Three layers.");
  });

  it("handles multiple stuck headers in a single pass", () => {
    const input = "intro**First:** a thing.DB**Second:** another thing.";
    const out = fixupStuckHeaders(input);
    assert.equal(
      out,
      "intro\n\n**First:** a thing.DB\n\n**Second:** another thing."
    );
  });

  it("returns empty input unchanged", () => {
    assert.equal(fixupStuckHeaders(""), "");
  });
});

describe("stripMalformedCodeSpans", () => {
  it("preserves legitimate short inline code", () => {
    const input = "paths like `app/`, `components/`, `constants/theme.ts`.";
    assert.equal(stripMalformedCodeSpans(input), input);
  });

  it("strips empty backticks", () => {
    const input = "foo `` bar";
    const out = stripMalformedCodeSpans(input);
    assert.equal(out, "foo  bar");
  });

  it("strips punctuation-only spans like `, `", () => {
    const input = "`app/`, `, `, `components/`";
    const out = stripMalformedCodeSpans(input);
    // The tiny `, ` span between two real ones gets its backticks removed.
    assert.equal(out, "`app/`, , , `components/`");
  });

  it("strips a huge runaway span produced by an unbalanced backtick", () => {
    const input =
      "intro `a long sentence that eats lots of content and keeps going well past 60 chars` tail";
    const out = stripMalformedCodeSpans(input);
    assert.equal(
      out,
      "intro a long sentence that eats lots of content and keeps going well past 60 chars tail"
    );
  });

  it("strips a span that contains markdown metasyntax", () => {
    const input = "runtime, `DB**Design System:** Tokens in ` (radius).";
    const out = stripMalformedCodeSpans(input);
    assert.equal(out, "runtime, DB**Design System:** Tokens in  (radius).");
  });

  it("does not touch code spans with alphanumeric content and no metasyntax", () => {
    const input = "call `someFunction()` and `x.y.z`.";
    assert.equal(stripMalformedCodeSpans(input), input);
  });

  it("does not cross newlines inside a code span", () => {
    const input = "`one\ntwo` — this is weird input but should not corrupt.";
    // The regex excludes \n inside a code span, so nothing is matched.
    assert.equal(stripMalformedCodeSpans(input), input);
  });
});

describe("cleanModelMarkdown (integration)", () => {
  it("repairs the canonical broken output from a real GLM run", () => {
    const input =
      "Maps out the full directory — `app/ (screens), `components/`, `constants/`, `/`, `backend/`routes, services, runtime, DB**Design System:** Tokens in `constants/theme.ts` (radius, spacing,, typography Colors from `@bacons/apple-colors` (semantic iOS adaptive colors).";
    const out = cleanModelMarkdown(input);
    // The section header split should fire.
    assert.ok(
      out.includes("DB\n\n**Design System:**"),
      "stuck header should be split"
    );
    // Legitimate inline code should still be present.
    assert.ok(out.includes("`constants/theme.ts`"), "valid inline code preserved");
    assert.ok(out.includes("`@bacons/apple-colors`"), "valid inline code preserved");
  });

  it("passes well-formed output through unchanged", () => {
    const input =
      "## Summary\n\n**Architecture:** three layers.\n\n- `app/`\n- `components/`\n- `backend/`\n";
    assert.equal(cleanModelMarkdown(input), input);
  });
});
