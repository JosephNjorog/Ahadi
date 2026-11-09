# Ahadi brand

## The mark

An open ring with a dot settling inside it.

- **The ring** is the payment held in trust: authorized with PayPal, not yet taken.
- **The dot** is the verified work, landing where it belongs.
- **The opening** at about 1:30 keeps the ring from reading as a closed loop or a power symbol. It also gives motion a natural start and end point.

## Files

| File | Use |
|---|---|
| `ahadi-logo.svg` / `ahadi-logo-white.svg` | Mark and wordmark, for light and dark backgrounds |
| `ahadi-mark.svg` / `ahadi-mark-white.svg` | Mark only (avatars, small spaces) |
| `ahadi-app-icon.svg` | App icon and favicon source (white mark on a black rounded square) |
| `ahadi-mark-animated.svg` | Looping intro for motion work and previews (3.2s) |

Ready-to-upload PNGs are in [`png/`](png/): the logo in black and white on transparent backgrounds (2000 × 600), the logo on solid white and black (1600 × 800), the mark in black and white (1024 × 1024), the app icon (1024, 512 and 180), and a 3:2 thumbnail for submission sites (1500 × 1000).

In the web app, use `AhadiMark` and `AhadiLogo` from `apps/web/components/brand/ahadi-mark.tsx`. They draw in `currentColor`, and `animated` plays the intro once.

## Construction

All values are on a 32 × 32 grid.

| Part | Value |
|---|---|
| Ring | Circle centred at 16,16, radius 11, stroke 4, round caps |
| Opening | 16% of the circumference (stroke-dasharray `84 16` with `pathLength=100`), rotated −9° |
| Dot | Radius 4.25, centred |
| Wordmark | "ahadi" in lowercase, Geist SemiBold, tracking −0.04em, outlined in the SVG files |
| Lock-up | The wordmark starts 8 units after the mark, centred on the mark's height |
| Clear space | At least the dot's diameter on every side |

## Colour

The brand is monochrome: `#0a0a0a` on light backgrounds and `#ffffff` (or `#ededed`) on dark. Colour is used for meaning, not decoration: green for verified or secured, red for failed or blocked.

## Motion

| Beat | Time | Easing |
|---|---|---|
| Ring draws clockwise from the opening | 0 – 0.9s | `cubic-bezier(.65, 0, .35, 1)` |
| Dot drops in from above, overshoots slightly and settles | 0.6 – 1.4s | `cubic-bezier(.34, 1.3, .64, 1)` |
| Hold | — | — |

Keep motion short and do it once on page load. Respect `prefers-reduced-motion`: the component and the animated SVG show the final frame instead.

## Don't

- Close the ring, move the opening, or change the stroke-to-dot ratio.
- Add gradients, shadows or outlines to the mark.
- Set the wordmark in capitals or in another typeface.
