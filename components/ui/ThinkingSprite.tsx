import { Asset } from "expo-asset";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";

/**
 * Animated 4-frame pixel-art loader rendered from a 2×2 sprite sheet.
 *
 * Expects the source PNG at `assets/icons/thinking-sprite.png` — a single
 * image laid out as:
 *
 *   ┌──────┬──────┐
 *   │  0   │  1   │
 *   ├──────┼──────┤
 *   │  3   │  2   │
 *   └──────┴──────┘
 *
 * We clip a container to one-quadrant size and translate the underlying
 * 2× image on a timer so each frame is visible in sequence. Frame order
 * is 0 → 1 → 2 → 3 → 0 (clockwise around the grid) which reads as a
 * natural pulsing loop.
 */
const SPRITE = require("@/assets/icons/thinking-sprite.png");

// Kick off an asynchronous asset download at module load so the first
// mount doesn't flash an empty placeholder while React Native decodes
// the PNG. Calling this at module eval time means the asset is warm in
// Expo's cache long before the ThinkingIndicator ever renders.
Asset.fromModule(SPRITE).downloadAsync().catch(() => { /* asset missing — dev */ });

// Relative positions of each quadrant in units of `size` (one-frame width).
// { x: 0, y: 0 } shows the top-left quadrant; { x: -1, y: 0 } shows the top-right; etc.
const FRAMES: Array<{ x: number; y: number }> = [
  { x: 0, y: 0 },   // top-left
  { x: -1, y: 0 },  // top-right
  { x: -1, y: -1 }, // bottom-right
  { x: 0, y: -1 },  // bottom-left
];

export function ThinkingSprite({
  size = 16,
  intervalMs = 160,
}: {
  /** Display size in logical pixels — the rendered frame will be `size`×`size`. */
  size?: number;
  /** Time between frame flips. Lower = faster loop. */
  intervalMs?: number;
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const { x, y } = FRAMES[frame];
  return (
    <View
      style={{
        width: size,
        height: size,
        overflow: "hidden",
        // Centre inside any parent row — typography baselines don't line
        // up cleanly with pixel-art, so we nudge a hair via alignSelf.
        alignSelf: "center",
      }}
    >
      <Image
        source={SPRITE}
        // The source is twice the display size — translating by `size`
        // swaps between the two columns/rows.
        style={{
          width: size * 2,
          height: size * 2,
          transform: [
            { translateX: x * size },
            { translateY: y * size },
          ],
        }}
        resizeMode="cover"
      />
    </View>
  );
}
