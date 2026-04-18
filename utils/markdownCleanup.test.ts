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
  isolateTableHeader,
  isolateTableTail,
  splitRunOnTableRows,
  splitStuckListItems,
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

describe("splitRunOnTableRows", () => {
  it("splits adjacent pipes onto separate lines", () => {
    const input = "| h1 | h2 ||---|---|| d1 | d2 |";
    const out = splitRunOnTableRows(input);
    assert.equal(out, "| h1 | h2 |\n|---|---|\n| d1 | d2 |");
  });

  it("leaves single pipes and spaced empty cells alone", () => {
    const input = "| a | | b |\nnext line";
    assert.equal(splitRunOnTableRows(input), input);
  });

  it("returns empty input unchanged", () => {
    assert.equal(splitRunOnTableRows(""), "");
  });
});

describe("splitStuckListItems", () => {
  it("splits a bullet stuck to a colon-terminated intro", () => {
    const input = "contains:- A thing";
    const out = splitStuckListItems(input);
    assert.equal(out, "contains:\n\n- A thing");
  });

  it("splits bullets stuck to a previous item's terminator", () => {
    const input = "- One file.- Another file.- Third file.";
    const out = splitStuckListItems(input);
    assert.equal(out, "- One file.\n\n- Another file.\n\n- Third file.");
  });

  it("splits after a closing parenthesis", () => {
    const input = "updates (a, b).- Next item";
    const out = splitStuckListItems(input);
    assert.equal(out, "updates (a, b).\n\n- Next item");
  });

  it("leaves mid-sentence dashes in prose alone", () => {
    const input = "window hours midnight - 6 AM";
    assert.equal(splitStuckListItems(input), input);
  });

  it("leaves well-formed lists untouched", () => {
    const input = "intro:\n\n- one\n- two\n";
    assert.equal(splitStuckListItems(input), input);
  });

  it("returns empty input unchanged", () => {
    assert.equal(splitStuckListItems(""), "");
  });
});

describe("isolateTableHeader", () => {
  it("splits prose glued to a table header row", () => {
    const input = "Here are the changes:| Commit | Branch | Summary |";
    const out = isolateTableHeader(input);
    assert.equal(
      out,
      "Here are the changes:\n\n| Commit | Branch | Summary |"
    );
  });

  it("ignores a line that's already a pure table row", () => {
    const input = "| Commit | Branch | Summary |";
    assert.equal(isolateTableHeader(input), input);
  });

  it("ignores prose with a single incidental pipe", () => {
    const input = "use `|` as a delimiter";
    assert.equal(isolateTableHeader(input), input);
  });
});

describe("isolateTableTail", () => {
  it("splits a table row glued to a following paragraph", () => {
    const input = "| a | b | c |Additionally, more prose here.";
    const out = isolateTableTail(input);
    assert.equal(
      out,
      "| a | b | c |\n\nAdditionally, more prose here."
    );
  });

  it("leaves a clean trailing row alone", () => {
    const input = "| a | b | c |";
    assert.equal(isolateTableTail(input), input);
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

  it("repairs a run-on table and stuck list items together", () => {
    const input =
      "Recent changes:| Commit | Summary ||--------|---------|| a1 | first || b2 | second |Working tree:- First change.- Second change.";
    const out = cleanModelMarkdown(input);
    assert.ok(out.includes("| Commit | Summary |\n"), "header row isolated");
    assert.ok(out.includes("|--------|---------|\n"), "separator row isolated");
    assert.ok(out.includes("\n| a1 | first |"), "data row isolated");
    assert.ok(out.includes("\n\n- First change."), "first bullet split");
    assert.ok(out.includes("\n\n- Second change."), "second bullet split");
  });
});
