# Design Guidelines

These are the visual and interaction principles for Claw Code's mobile UI.
New screens and redesigns should conform to this document. When in doubt,
lean toward *less*.

## Overall feel

- Very clean and quiet.
- Warm, neutral palette.
- Lots of breathing room.
- Reads first, chrome second. The product is the text on the page.

## Visual style

- Soft off-white or cream background.
- Dark gray text instead of pure black.
- Subtle dividers, very low-contrast borders.
- Rounded corners everywhere, but not overly playful.
- Almost no heavy shadows or glossy effects.
- Sparse use of accent color.

## Layout

- Single-column conversation layout.
- Strong focus on readable text blocks.
- Generous horizontal padding.
- Comfortable vertical spacing between messages and sections.
- Minimal top bar with simple title and a few understated icons.
- Bottom input area anchored cleanly, with rounded text field.

## Typography

- Elegant, highly readable sans-serif with a neo-grotesk feel.
- Editorial tone — confident, unhurried.
- Clear hierarchy through size and weight, not color overload.
- Body text is spacious and easy to scan.
- Headers are restrained, not oversized.

## Chat / message design

- Assistant responses often feel like clean text on background rather than
  loud chat bubbles.
- User messages are subtle and unobtrusive.
- Message containers are lightweight, with soft rounding and low contrast.
- Emphasis is on content, not decorative UI chrome.

## Input composer

- Rounded pill or soft rectangle.
- Very minimal icons.
- Clean send/action button treatment.
- Looks lightweight and modern, not dense with controls.

## Navigation

- Minimal menu structure.
- Conversation history presented simply.
- No cluttered side panels on mobile.
- Focus stays on one task: reading and chatting.

## Interaction design

- Smooth, understated animations.
- Nothing flashy.
- Feels polished through restraint.
- Touch targets are roomy and comfortable.

## Keywords

minimalist · warm neutral · editorial · premium · calm · airy · rounded ·
understated · text-first · low-contrast · elegant · modern

## Reference palette

Light mode:

| Token        | Value     | Use                                    |
| ------------ | --------- | -------------------------------------- |
| `bg`         | `#F6F2EA` | App background (warm cream)            |
| `surface`    | `#FBF8F1` | Cards, inset surfaces                  |
| `surfaceAlt` | `#F0EADE` | Hover / pressed / subtle fills         |
| `text`       | `#2B2823` | Primary text (dark warm gray)          |
| `textMuted`  | `#78736A` | Secondary text, labels                 |
| `textSoft`   | `#A9A397` | Tertiary text, placeholders            |
| `divider`    | `#E6DFD1` | Hairlines and low-contrast borders     |
| `accent`     | `#B85742` | Single warm accent, used sparingly     |
| `danger`     | `#A6463A` | Destructive, muted, used sparingly     |
| `success`    | `#6B8F5E` | Positive state, muted sage             |

Dark mode:

| Token        | Value     |
| ------------ | --------- |
| `bg`         | `#1B1917` |
| `surface`    | `#242120` |
| `surfaceAlt` | `#2E2A27` |
| `text`       | `#EDE7DA` |
| `textMuted`  | `#9E978A` |
| `textSoft`   | `#6E685E` |
| `divider`    | `#332F2B` |
| `accent`     | `#D97A63` |
| `danger`     | `#D97A63` |
| `success`    | `#9EBB90` |

## Spacing & radius

- Section vertical rhythm: 28–36pt between sections.
- Card padding: 20pt horizontal, 18pt vertical.
- Row vertical padding: 14pt.
- Corner radius: 14pt for cards, 12pt for inputs/buttons, 999 for pills.
- Hairlines: 1px `divider`, never heavier.
- Shadows: avoid. Prefer hairlines or a one-step tonal shift.

## Do / don't

- Do use weight and size for hierarchy; don't use saturated colors.
- Do let text breathe; don't pack rows tightly to save pixels.
- Do use the accent once per screen at most; don't paint buttons in it.
- Do prefer plain text labels; don't use emoji as icons in chrome.
- Do round consistently; don't mix sharp and rounded corners.
