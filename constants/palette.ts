/**
 * Shared colour palette and accent theme definitions.
 *
 * The settings screen, index screen, thread screen, and ThemeProvider all
 * import from this single source of truth so switching "Lavender" vs
 * "Terracotta" in Settings changes the accent colour everywhere at once.
 */

// ─── Base palettes (warm, low-contrast) ────────────────────────────────────

export const LIGHT = {
  bg: "#F6F2EA",
  surface: "#FBF8F1",
  surfaceAlt: "#F0EADE",
  text: "#2B2823",
  textMuted: "#78736A",
  textSoft: "#A9A397",
  divider: "#E6DFD1",
  accent: "#B85742", // overridden by ACCENTS below
  danger: "#A6463A",
  success: "#6B8F5E",
};

export const DARK = {
  bg: "#1B1917",
  surface: "#242120",
  surfaceAlt: "#2E2A27",
  text: "#EDE7DA",
  textMuted: "#9E978A",
  textSoft: "#6E685E",
  divider: "#332F2B",
  accent: "#D97A63", // overridden by ACCENTS below
  danger: "#D97A63",
  success: "#9EBB90",
};

export type Palette = typeof LIGHT;

// ─── Accent themes ──────────────────────────────────────────────────────────

export const ACCENTS = {
  claude: { light: "#B85742", dark: "#D97A63" },
  lavender: { light: "#7B6CA8", dark: "#B9A6DB" },
} as const;

export type AccentTheme = keyof typeof ACCENTS;

export const ACCENT_OPTIONS: { key: AccentTheme; label: string }[] = [
  { key: "lavender", label: "Lavender" },
  { key: "claude", label: "Terracotta" },
];

/**
 * Build a resolved palette for the given dark-mode state + accent theme.
 */
export function buildPalette(
  isDark: boolean,
  accentTheme: AccentTheme
): Palette {
  const base = isDark ? DARK : LIGHT;
  const accent = ACCENTS[accentTheme][isDark ? "dark" : "light"];
  return { ...base, accent };
}
