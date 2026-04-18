/**
 * Segment streamed assistant text into runs of plain markdown and
 * runs of table rows, so the caller can hand tables to a custom
 * renderer while leaving everything else to markdown-display.
 *
 * Lenient on purpose: a table starts as soon as a single line that
 * starts with `|` and has two or more pipes shows up. That lets the
 * caller render a partial table in real time while more rows are
 * still streaming in — matching how users expect tables to appear
 * cell-by-cell rather than popping in at the end.
 *
 * Kept free of React Native imports so it can be unit tested with
 * plain `node --test`.
 */

export type MarkdownSegment = { type: "text"; content: string };
export type TableSegment = {
  type: "table";
  /** Header cells, when a separator row has been seen. */
  header: string[] | null;
  /** Data rows (separator row is stripped). */
  rows: string[][];
  /** Column count derived from the widest row seen so far. */
  columnCount: number;
};
export type Segment = MarkdownSegment | TableSegment;

const SEPARATOR_CELL_RE = /^\s*:?-{2,}:?\s*$/;

function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  let pipes = 0;
  for (const c of trimmed) if (c === "|") pipes++;
  return pipes >= 2;
}

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => SEPARATOR_CELL_RE.test(c));
}

export function parseTableBlocks(content: string): Segment[] {
  if (!content) return [];

  const lines = content.split("\n");
  const segments: Segment[] = [];
  let textBuf: string[] = [];
  let table: TableSegment | null = null;
  // A pending row whose closing pipe may still be streaming in.
  // Stored as the raw line so we can re-parse once it completes.

  const flushText = () => {
    if (textBuf.length === 0) return;
    // Drop leading/trailing blanks: they'd render as empty paragraphs
    // and open visible gaps between a table and the surrounding prose.
    while (textBuf.length && textBuf[textBuf.length - 1] === "") textBuf.pop();
    while (textBuf.length && textBuf[0] === "") textBuf.shift();
    if (textBuf.length === 0) return;
    segments.push({ type: "text", content: textBuf.join("\n") });
    textBuf = [];
  };

  const flushTable = () => {
    if (!table) return;
    segments.push(table);
    table = null;
  };

  for (const line of lines) {
    if (isTableRowLine(line)) {
      if (!table) {
        flushText();
        table = { type: "table", header: null, rows: [], columnCount: 0 };
      }
      const cells = splitCells(line);
      if (isSeparatorRow(cells)) {
        // Promote the most recent data row to header, if we have one
        // and we haven't already promoted.
        if (table.header === null && table.rows.length > 0) {
          table.header = table.rows.shift()!;
        }
        continue;
      }
      table.rows.push(cells);
      if (cells.length > table.columnCount) table.columnCount = cells.length;
    } else {
      flushTable();
      textBuf.push(line);
    }
  }

  flushText();
  flushTable();
  return segments;
}
