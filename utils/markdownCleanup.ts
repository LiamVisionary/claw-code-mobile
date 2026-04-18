/**
 * Pure text preprocessors that run over assistant message content
 * before it's handed to react-native-markdown-display. Kept free of
 * React Native imports so they can be unit tested with plain
 * `node --test`.
 *
 * These are safety nets for model-side quirks — not a substitute for
 * fixing the upstream source of corruption. Each function is
 * narrowly scoped so it doesn't touch well-formed Claude output.
 */

/**
 * Model output sometimes runs consecutive bolded section headers
 * together with no delimiter ("DB**Design System:** Tokens in…") —
 * markdown parses that as one paragraph and the section break is
 * lost. We insert a blank line before the bold only when the
 * pattern is `<wordChar>**Capitalized Title:**` — a mid-sentence
 * bold like "see **Section:** below" has a space before it and is
 * untouched.
 */
export function fixupStuckHeaders(content: string): string {
  if (!content) return content;
  return content.replace(
    /(\w)(\*\*[A-Z][A-Za-z0-9 _]*:\*\*)/g,
    "$1\n\n$2"
  );
}

/**
 * Strip inline code spans that are clearly malformed. GLM-via-OpenRouter
 * (and other models) sometimes emit unbalanced backticks — e.g. a list
 * of filenames where one opening backtick is missing, which makes
 * markdown pair the remaining backticks greedily into garbage code
 * spans that eat entire sentences.
 *
 * We strip a span's surrounding backticks when any of these are true:
 *   • content is empty or contains no word characters (pure punctuation)
 *   • content is longer than 60 chars (real inline code is short)
 *   • content contains markdown metasyntax (**, __, #headings)
 *
 * Legitimate short code spans like `app/`, `components/`, or
 * `constants/theme.ts` are preserved.
 */
export function stripMalformedCodeSpans(content: string): string {
  if (!content) return content;
  return content.replace(/`([^`\n]*)`/g, (match: string, inner: string) => {
    // Never touch backticks that are part of a fenced code block
    if (inner === "" || inner.startsWith("`")) return match;
    if (!/\w/.test(inner)) return inner;
    if (inner.length > 60) return inner;
    if (/\*\*|__|#{1,6} /.test(inner)) return inner;
    return match;
  });
}

/**
 * Model output sometimes emits markdown tables with no newlines
 * between rows — "| h | h ||---|---|| d | d |..." — which
 * markdown-display renders as raw pipe text instead of a table.
 * Real markdown never uses `||` (an empty cell is `| |` with a
 * space), so two adjacent pipes unambiguously mark a row boundary.
 */
export function splitRunOnTableRows(content: string): string {
  if (!content) return content;
  return content.replace(/\|\|/g, "|\n|");
}

/**
 * Model output sometimes glues a bullet list onto the tail of the
 * preceding sentence: "contains:- A thing.- Another thing." Without
 * the newline the dash is parsed as a hyphen and the list never
 * forms. We split when punctuation that normally ends a clause
 * (`.`, `:`, `)`) is followed by `- <Capital>`, which is a strong
 * signal the dash was meant to open a new list item.
 */
export function splitStuckListItems(content: string): string {
  if (!content) return content;
  return content.replace(/([.:)])\s*-\s+([A-Z])/g, "$1\n\n- $2");
}

/**
 * A table header row glued to the end of a prose line:
 * "Here are the changes:| Commit | Branch | Summary |". Once the
 * line contains three or more pipes and a pipe-delimited suffix
 * that reaches end-of-line, the suffix is a table header and the
 * preceding text should be pushed onto its own paragraph.
 */
export function isolateTableHeader(content: string): string {
  if (!content) return content;
  return content
    .split("\n")
    .map((line) => {
      const m = /^([^|\n]+?\S)\s*(\|(?:[^|\n]+\|){2,})\s*$/.exec(line);
      if (!m) return line;
      return `${m[1]}\n\n${m[2]}`;
    })
    .join("\n");
}

/**
 * A paragraph glued onto the tail of a table row's closing pipe:
 * "| a | b | c |Additionally the working tree…". We split on the
 * last `|` of a table-looking line when text follows it. A regex
 * that tries to match cells + tail backtracks and treats the final
 * cell as prose, so we scan explicitly instead.
 */
export function isolateTableTail(content: string): string {
  if (!content) return content;
  return content
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) return line;
      let pipeCount = 0;
      for (const c of line) if (c === "|") pipeCount++;
      // Need at least 2 cells (3 pipes) to be worth treating as a
      // table row.
      if (pipeCount < 3) return line;
      const lastPipe = line.lastIndexOf("|");
      const tail = line.slice(lastPipe + 1);
      if (!tail.trim()) return line;
      const rowPart = line.slice(0, lastPipe + 1);
      return `${rowPart}\n\n${tail.replace(/^\s+/, "")}`;
    })
    .join("\n");
}

export function cleanModelMarkdown(content: string): string {
  return stripMalformedCodeSpans(
    splitStuckListItems(
      isolateTableTail(
        isolateTableHeader(splitRunOnTableRows(fixupStuckHeaders(content)))
      )
    )
  );
}
