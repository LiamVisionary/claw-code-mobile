import { memo, useEffect, useRef } from "react";
import { Text, TextStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";

type Props = {
  content: string;
  style?: any;
  streaming?: boolean;
};

const AnimatedLetter = memo(function AnimatedLetter({
  char,
  delay,
  extraStyle,
}: {
  char: string;
  delay: number;
  extraStyle?: TextStyle;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      })
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.7, 1]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [8, 0]) },
    ],
  }));

  if (char === " " || char === "\n") {
    return <Text style={extraStyle}>{char}</Text>;
  }

  return (
    <Animated.Text style={[animStyle, extraStyle]}>{char}</Animated.Text>
  );
});

// ── Inline markdown parsing ─────────────────────────────────────────

type Segment = { text: string; style?: TextStyle };

const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_RE = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const CODE_RE = /`([^`\n]+)`/g;

/**
 * Parse basic inline markdown (bold, italic, inline code) into
 * styled segments. Handles nesting (bold inside text, etc.).
 */
function parseInlineMarkdown(text: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = text;

  // Process bold first, then italic, then code
  const patterns: [RegExp, TextStyle][] = [
    [/\*\*(.+?)\*\*/g, { fontWeight: "700" as const }],
    [/`([^`\n]+)`/g, {
      fontFamily: "Menlo",
      fontSize: 13,
      backgroundColor: "rgba(128,128,128,0.12)",
      borderRadius: 3,
    }],
    [/(?<!\*)\*([^*]+)\*(?!\*)/g, { fontStyle: "italic" as const }],
  ];

  // Simple approach: find the earliest match of any pattern
  while (remaining.length > 0) {
    let earliest: { index: number; length: number; inner: string; style: TextStyle } | null = null;

    for (const [re, style] of patterns) {
      re.lastIndex = 0;
      const m = re.exec(remaining);
      if (m && (!earliest || m.index < earliest.index)) {
        earliest = {
          index: m.index,
          length: m[0].length,
          inner: m[1],
          style,
        };
      }
    }

    if (!earliest) {
      // No more patterns — rest is plain text
      if (remaining) segments.push({ text: remaining });
      break;
    }

    // Text before the match
    if (earliest.index > 0) {
      segments.push({ text: remaining.slice(0, earliest.index) });
    }

    // The matched segment with style
    segments.push({ text: earliest.inner, style: earliest.style });

    remaining = remaining.slice(earliest.index + earliest.length);
  }

  return segments;
}

// ── Heading detection ───────────────────────────────────────────────

function getHeadingStyle(line: string): TextStyle | null {
  if (line.startsWith("### ")) return { fontWeight: "700", fontSize: 16 };
  if (line.startsWith("## ")) return { fontWeight: "700", fontSize: 18 };
  if (line.startsWith("# ")) return { fontWeight: "700", fontSize: 21 };
  return null;
}

function stripHeadingPrefix(line: string): string {
  return line.replace(/^#{1,3}\s+/, "");
}

// ── Main component ──────────────────────────────────────────────────

function StreamingTextBase({ content, style, streaming }: Props) {
  const prevWordCountRef = useRef(0);

  // Split preserving whitespace
  const tokens = content.split(/(\s+)/);
  const prevWordCount = prevWordCountRef.current;

  useEffect(() => {
    prevWordCountRef.current = tokens.length;
  }, [content]);

  if (!streaming) {
    return (
      <Text style={style} selectable>
        {content}
      </Text>
    );
  }

  // Track which line we're on for heading detection
  let charsSoFar = "";

  return (
    <Text style={style} selectable>
      {tokens.map((token, wordIdx) => {
        charsSoFar += token;

        // Get the current line for heading detection
        const lines = charsSoFar.split("\n");
        const currentLine = lines[lines.length - 1];
        const headingStyle = currentLine === token ? getHeadingStyle(currentLine) : null;

        // Display text — strip heading prefix if it's a heading
        const displayToken = headingStyle ? stripHeadingPrefix(token) : token;

        // Already-rendered words — render with formatting but no animation
        if (wordIdx < prevWordCount) {
          if (/^\s+$/.test(token)) return <Text key={wordIdx}>{token}</Text>;
          const segments = parseInlineMarkdown(displayToken);
          return (
            <Text key={wordIdx} style={headingStyle ?? undefined}>
              {segments.map((seg, si) => (
                <Text key={si} style={seg.style}>{seg.text}</Text>
              ))}
            </Text>
          );
        }

        // Whitespace
        if (/^\s+$/.test(token)) {
          return <Text key={wordIdx}>{token}</Text>;
        }

        // New word — animate letter by letter with formatting
        const charsInPriorNewWords = tokens
          .slice(prevWordCount, wordIdx)
          .join("")
          .replace(/\s/g, "").length;

        const segments = parseInlineMarkdown(displayToken);
        let charOffset = 0;

        return (
          <Text key={wordIdx} style={headingStyle ?? undefined}>
            {segments.map((seg, si) => (
              <Text key={si} style={seg.style}>
                {seg.text.split("").map((char, ci) => {
                  const delay = (charsInPriorNewWords + charOffset + ci) * 20;
                  if (ci === seg.text.length - 1) charOffset += seg.text.length;
                  return (
                    <AnimatedLetter
                      key={`${wordIdx}-${si}-${ci}`}
                      char={char}
                      delay={delay}
                      extraStyle={seg.style}
                    />
                  );
                })}
              </Text>
            ))}
          </Text>
        );
      })}
    </Text>
  );
}

export const StreamingText = memo(StreamingTextBase);
