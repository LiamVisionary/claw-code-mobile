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
    if (!/\w/.test(inner)) return inner;
    if (inner.length > 60) return inner;
    if (/\*\*|__|#{1,6} /.test(inner)) return inner;
    return match;
  });
}

/** Run every safe preprocessor over an assistant message before it hits the markdown renderer. */
export function cleanModelMarkdown(content: string): string {
  return stripMalformedCodeSpans(fixupStuckHeaders(content));
}
