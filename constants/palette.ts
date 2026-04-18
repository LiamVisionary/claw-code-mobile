/**
 * Shared colour palette and accent theme definitions.
 *
 * The settings screen, index screen, thread screen, and ThemeProvider all
 * import from this single source of truth so switching the accent theme
 * in Settings retints the whole app at once.
 *
 * Each theme ships a full light and dark palette (not just an accent
 * colour) so changing the theme meaningfully shifts bg/surface/text as
 * well — e.g. lavender backgrounds for the lavender theme, warm cream
 * backgrounds for the terracotta theme.
 */

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textSoft: string;
  divider: string;
  accent: string;
  danger: string;
  success: string;
};

// ─── Theme palettes ──────────────────────────────────────────────────────────

const TERRACOTTA_LIGHT: Palette = {
  bg: "#F6F2EA",
  surface: "#FBF8F1",
  surfaceAlt: "#F0EADE",
  text: "#2B2823",
  textMuted: "#78736A",
  textSoft: "#A9A397",
  divider: "#E6DFD1",
  accent: "#B85742",
  danger: "#A6463A",
  success: "#6B8F5E",
};

const TERRACOTTA_DARK: Palette = {
  bg: "#1B1917",
  surface: "#242120",
  surfaceAlt: "#2E2A27",
  text: "#EDE7DA",
  textMuted: "#9E978A",
  textSoft: "#6E685E",
  divider: "#332F2B",
  accent: "#D97A63",
  danger: "#D97A63",
  success: "#9EBB90",
};

const LAVENDER_LIGHT: Palette = {
  bg: "#F3EFF9",        // very light lavender
  surface: "#F8F5FC",   // near-white with purple hint
  surfaceAlt: "#E9E1F2", // pressed/hovered, light lavender
  text: "#2A2436",      // dark purple-gray
  textMuted: "#746B85",
  textSoft: "#A79FB6",
  divider: "#E0D6EE",
  accent: "#5B4890",    // dark lavender
  danger: "#9E4A5C",
  success: "#6B8F5E",
};

const LAVENDER_DARK: Palette = {
  bg: "#18151F",        // dark with purple tint
  surface: "#211C2A",
  surfaceAlt: "#2B2535",
  text: "#EDE7F7",
  textMuted: "#9C93AE",
  textSoft: "#6C6478",
  divider: "#332C3E",
  accent: "#B9A6DB",    // lighter lavender for contrast
  danger: "#D78CA0",
  success: "#9EBB90",
};

// Matrix / CRT phosphor — always dark, neon green on near-black.
// Both "light" and "dark" variants stay dark to preserve the aesthetic.
const NEO_DARK: Palette = {
  bg: "#050807",         // near-black with a green undertone
  surface: "#0B110C",    // cards, inset surfaces
  surfaceAlt: "#141E16", // pressed / hovered
  text: "#39FF14",       // neon phosphor green
  textMuted: "#2FBF10",
  textSoft: "#1E7A0C",
  divider: "#12301A",
  accent: "#39FF14",
  danger: "#FF4A4A",
  success: "#39FF14",
};

// Legacy exports kept for anything still importing LIGHT/DARK directly.
export const LIGHT = TERRACOTTA_LIGHT;
export const DARK = TERRACOTTA_DARK;

// ─── Accent themes ──────────────────────────────────────────────────────────

const THEMES = {
  lavender: { light: LAVENDER_LIGHT, dark: LAVENDER_DARK },
  claude: { light: TERRACOTTA_LIGHT, dark: TERRACOTTA_DARK },
  neo: { light: NEO_DARK, dark: NEO_DARK },
} as const;

export type AccentTheme = keyof typeof THEMES;

export const ACCENTS = {
  claude: { light: TERRACOTTA_LIGHT.accent, dark: TERRACOTTA_DARK.accent },
  lavender: { light: LAVENDER_LIGHT.accent, dark: LAVENDER_DARK.accent },
  neo: { light: NEO_DARK.accent, dark: NEO_DARK.accent },
} as const;

export const ACCENT_OPTIONS: { key: AccentTheme; label: string }[] = [
  { key: "lavender", label: "Lavender" },
  { key: "claude", label: "Terracotta" },
  { key: "neo", label: "Neo" },
];

/**
 * Build a resolved palette for the given dark-mode state + accent theme.
 * Each theme provides its own full palette — bg, text, divider, and
 * accent all shift together when the user switches themes.
 */
export function buildPalette(
  isDark: boolean,
  accentTheme: AccentTheme
): Palette {
  const theme = THEMES[accentTheme] ?? THEMES.lavender;
  return isDark ? theme.dark : theme.light;
}
