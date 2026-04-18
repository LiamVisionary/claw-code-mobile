import { memo, useMemo, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import type { Palette } from "@/constants/palette";
import type { TableSegment } from "@/utils/parseTableBlocks";

type Props = {
  segment: TableSegment;
  palette: Palette;
  /** Whether the stream is still producing content; disables entering
   * animations once the message is static so re-renders don't flash. */
  streaming?: boolean;
};

function StreamingTableBase({ segment, palette, streaming }: Props) {
  const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const columnCount = Math.max(
    segment.columnCount,
    segment.header?.length ?? 0
  );
  const weights = useMemo(
    () => computeColumnWeights(segment, columnCount),
    [segment, columnCount]
  );
  const headerMinWidths = useMemo(
    () => computeHeaderMinWidths(segment.header, columnCount),
    [segment.header, columnCount]
  );
  if (columnCount === 0) return null;

  const rowWrap = streaming ? Animated.View : View;

  return (
    <View style={styles.table}>
      {segment.header && (
        <View style={[styles.row, styles.headerRow]}>
          {Array.from({ length: columnCount }).map((_, ci) => (
            <View
              key={ci}
              style={[
                styles.cell,
                { flex: weights[ci], minWidth: headerMinWidths[ci] },
              ]}
            >
              {renderInlineMarkdown(
                segment.header![ci] ?? "",
                styles.headerText,
                styles.codeText,
                mono
              )}
            </View>
          ))}
        </View>
      )}
      {segment.rows.map((row, ri) => {
        const Row = rowWrap as typeof Animated.View;
        const entering = streaming ? FadeIn.duration(220) : undefined;
        return (
          <Row
            key={ri}
            entering={entering}
            style={[
              styles.row,
              ri < segment.rows.length - 1 && styles.rowDivider,
            ]}
          >
            {Array.from({ length: columnCount }).map((_, ci) => (
              <View
                key={ci}
                style={[
                  styles.cell,
                  { flex: weights[ci], minWidth: headerMinWidths[ci] },
                ]}
              >
                {renderInlineMarkdown(
                  row[ci] ?? "",
                  styles.bodyText,
                  styles.codeText,
                  mono
                )}
              </View>
            ))}
          </Row>
        );
      })}
    </View>
  );
}

/**
 * Per-column floor width sized so each header label can render on a
 * single line. Without this, flex alone shares width proportionally
 * and can squeeze a short header like "Branch" into a column too
 * narrow to hold it, forcing a mid-word wrap. Summary columns with
 * long content give up a little width to keep short headers intact.
 *
 * The per-character estimate (0.62 × fontSize) is calibrated for the
 * semibold sans used in headers; we add the cell's horizontal padding
 * so the floor applies to the content box, not the text alone. Raw
 * markdown like `**foo**` or `` `bar` `` is stripped before measuring
 * so the asterisks/backticks don't inflate the width.
 */
function computeHeaderMinWidths(
  header: string[] | null | undefined,
  columnCount: number
): number[] {
  if (!header) return Array(columnCount).fill(0);
  const HEADER_FONT_SIZE = 13;
  const AVG_CHAR_PX = HEADER_FONT_SIZE * 0.62;
  const CELL_HORIZONTAL_PADDING = 20;
  const widths: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    const text = (header[c] ?? "").replace(/[*`]/g, "");
    widths.push(Math.ceil(text.length * AVG_CHAR_PX) + CELL_HORIZONTAL_PADDING);
  }
  return widths;
}

/**
 * Give each column a flex weight proportional to the longest cell
 * text it holds. A short Commit column ends up narrow; a wide
 * Summary column absorbs the remaining width so its text wraps
 * there instead of overflowing the row. Floors and caps stop any
 * single column from collapsing or swallowing the whole table.
 */
function computeColumnWeights(
  segment: TableSegment,
  columnCount: number
): number[] {
  const all = segment.header
    ? [segment.header, ...segment.rows]
    : segment.rows;
  const weights: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    let maxLen = 4;
    for (const row of all) {
      const len = (row[c] ?? "").length;
      if (len > maxLen) maxLen = len;
    }
    weights.push(Math.min(40, maxLen));
  }
  return weights;
}

export const StreamingTable = memo(StreamingTableBase);

// ── Inline markdown (bold + inline code) ────────────────────────────
// Table cells render only inline formatting. Full block markdown
// inside a table cell isn't something tables express anyway, and a
// lightweight tokenizer avoids the weight and layout oddities of
// nesting react-native-markdown-display inside every cell.

type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineToken[] }
  | { type: "code"; text: string };

const INLINE_RE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIdx = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > lastIdx) {
      tokens.push({ type: "text", text: text.slice(lastIdx, start) });
    }
    if (m[1] !== undefined) {
      tokens.push({ type: "bold", children: tokenizeInline(m[1]) });
    } else {
      tokens.push({ type: "code", text: m[2] });
    }
    lastIdx = start + m[0].length;
  }
  if (lastIdx < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIdx) });
  }
  return tokens;
}

function renderTokens(
  tokens: InlineToken[],
  codeStyle: any,
  monoFont: string
): ReactNode[] {
  return tokens.map((t, i) => {
    if (t.type === "text") {
      return (
        <Text key={i}>
          {t.text}
        </Text>
      );
    }
    if (t.type === "bold") {
      return (
        <Text key={i} style={{ fontWeight: "700" }}>
          {renderTokens(t.children, codeStyle, monoFont)}
        </Text>
      );
    }
    return (
      <Text key={i} style={[codeStyle, { fontFamily: monoFont }]}>
        {t.text}
      </Text>
    );
  });
}

function renderInlineMarkdown(
  text: string,
  baseStyle: any,
  codeStyle: any,
  monoFont: string
): ReactNode {
  if (!text) return <Text style={baseStyle}> </Text>;
  const tokens = tokenizeInline(text);
  return <Text style={baseStyle}>{renderTokens(tokens, codeStyle, monoFont)}</Text>;
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    table: {
      marginVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.divider,
      borderRadius: 10,
      backgroundColor: palette.surface,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "stretch",
    },
    headerRow: {
      backgroundColor: palette.surfaceAlt,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.divider,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.divider,
    },
    cell: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      justifyContent: "flex-start",
    },
    headerText: {
      color: palette.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600" as const,
    },
    bodyText: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
    },
    codeText: {
      backgroundColor: palette.surfaceAlt,
      fontSize: 12.5,
      paddingHorizontal: 4,
      borderRadius: 3,
      color: palette.text,
    },
  });
}
