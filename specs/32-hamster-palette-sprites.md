# 32 — Hamster Palette & Sprites

## Overview

Define the color palette and pixel-art sprite data for the animated hamster mascot. This is the foundational data layer used by the wheel renderer and HamsterWheel component.

## Scope

### In scope
- Color palette as named hex constants
- Hamster sprite Frame A and Frame B as typed 2D arrays of `[col, row, colorToken]` tuples
- Color tokens for wheel elements (rim, spokes, hub)

### Out of scope
- Rendering logic (spec 33)
- Animation timing (spec 34)
- Layout/positioning within the welcome screen (spec 35)

## Color Palette

All colors as hex strings, consumed via Ink's `color` and `backgroundColor` props.

### Hamster Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `body` | `#d4883c` | Main hamster fur |
| `bodyLight` | `#e8a85c` | Lighter fur highlights |
| `bodyDark` | `#b06828` | Shading / dark side |
| `belly` | `#f0d8b0` | Belly / chest |
| `ear` | `#ff8899` | Ear outer |
| `earInner` | `#ff6680` | Ear inner + nose |
| `eye` | `#1a1a2e` | Eye (very dark) |
| `eyeShine` | `#ffffff` | Eye highlight dot |
| `cheek` | `#ff9977` | Rosy cheek |
| `feet` | `#c47830` | Paws |
| `tail` | `#b06828` | Tail |

### Wheel Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `wheelBright` | `#8888aa` | Wheel rim highlights (every 3rd pixel) |
| `wheelDim` | `#555577` | Wheel rim base |
| `wheelInner` | `#444466` | Inner rim accents |
| `wheelSpoke` | `#3a3a55` | Spokes |
| `wheelHub` | `#7777aa` | Center hub |

## Sprite Data

The hamster faces **left** in side profile. Coordinates are `[col, row]` offsets from the hamster origin point (bottom-center of the wheel interior). Negative columns extend left (nose, whiskers), negative rows extend up (ears, head).

### Frame A — Front legs extended forward, back legs tucked

```
Row -5:          [ER]
Row -4:     [ER] [EI] [ER]
Row -3: [B]  [B]  [B]  [B]  [B]
Row -2: [B] [BL] [BL] [BL] [BL] [B] [BD]
Row -1: [B] [BL] [EY] [BL] [BL]  [B] [B] [BD]
Row  0: [NS][BL] [CK] [BL] [BE] [BE] [B] [B] [BD]
Row  1:      [B] [BE] [BE] [BE]  [B]  [B] [BD][BD]
Row  2:      [B] [BE] [BE] [BE]  [B]  [B] [BD][BD][TL]
Row  3:      [B] [BE] [BE]  [B]  [B] [BD] [BD]    [TL][TL]
Row  4: [FT][FT]                 [FT][FT]          [BD]
Row  5:                               [FT]
```

#### Frame A pixel data (col, row, colorToken)

```typescript
// Head
[3, -5, 'ear'],
[2, -4, 'ear'], [3, -4, 'earInner'], [4, -4, 'ear'],
[1, -3, 'body'], [2, -3, 'body'], [3, -3, 'body'], [4, -3, 'body'], [5, -3, 'body'],
[0, -2, 'body'], [1, -2, 'bodyLight'], [2, -2, 'bodyLight'], [3, -2, 'bodyLight'], [4, -2, 'bodyLight'], [5, -2, 'body'], [6, -2, 'bodyDark'],
[-1, -1, 'body'], [0, -1, 'bodyLight'], [1, -1, 'eye'], [2, -1, 'bodyLight'], [3, -1, 'bodyLight'], [4, -1, 'body'], [5, -1, 'body'], [6, -1, 'bodyDark'],

// Face
[-2, 0, 'earInner'], [-1, 0, 'bodyLight'], [0, 0, 'cheek'], [1, 0, 'bodyLight'], [2, 0, 'belly'], [3, 0, 'belly'], [4, 0, 'body'], [5, 0, 'body'], [6, 0, 'bodyDark'],

// Body
[0, 1, 'body'], [1, 1, 'belly'], [2, 1, 'belly'], [3, 1, 'belly'], [4, 1, 'body'], [5, 1, 'body'], [6, 1, 'bodyDark'], [7, 1, 'bodyDark'],
[0, 2, 'body'], [1, 2, 'belly'], [2, 2, 'belly'], [3, 2, 'belly'], [4, 2, 'body'], [5, 2, 'body'], [6, 2, 'bodyDark'], [7, 2, 'bodyDark'], [8, 2, 'tail'],
[1, 3, 'body'], [2, 3, 'belly'], [3, 3, 'belly'], [4, 3, 'body'], [5, 3, 'body'], [6, 3, 'bodyDark'], [7, 3, 'bodyDark'],

// Tail
[8, 3, 'tail'], [9, 3, 'tail'], [9, 2, 'tail'],

// Legs — Frame A: front extended, back tucked
[0, 4, 'feet'], [-1, 4, 'feet'],     // front legs forward
[5, 4, 'feet'], [6, 4, 'feet'],      // back legs
[6, 5, 'feet'],                       // back foot down
[7, 4, 'bodyDark'],                   // butt fluff
```

### Frame B — Front legs tucked, back legs extended

Same head and body as Frame A. Only rows 4–5 differ:

```typescript
// Legs — Frame B: front tucked, back extended
[1, 4, 'feet'], [2, 4, 'feet'],      // front legs tucked
[5, 4, 'feet'], [6, 4, 'feet'], [7, 4, 'feet'],  // back legs extended
[7, 5, 'feet'],                       // back foot down
[-1, 5, 'feet'],                      // front foot touching down
[8, 4, 'bodyDark'],                   // butt fluff
```

## Data Model

```typescript
// src/components/hamster/palette.ts

/** Color token name */
export type ColorToken =
  | 'body' | 'bodyLight' | 'bodyDark' | 'belly'
  | 'ear' | 'earInner' | 'eye'
  | 'cheek' | 'feet' | 'tail'
  | 'wheelBright' | 'wheelDim' | 'wheelInner' | 'wheelSpoke' | 'wheelHub';

/** Map from token to hex color string */
export const PALETTE: Record<ColorToken, string>;

/** A single pixel: [column offset, row offset, color token] */
export type SpritePixel = [col: number, row: number, color: ColorToken];

/** Complete sprite frame */
export type SpriteFrame = SpritePixel[];
```

```typescript
// src/components/hamster/sprites.ts

import type { SpritePixel, SpriteFrame } from './palette.js';

/** Shared head + body pixels (used by both frames) */
export const HAMSTER_BODY: SpriteFrame;

/** Frame A leg pixels */
export const FRAME_A_LEGS: SpriteFrame;

/** Frame B leg pixels */
export const FRAME_B_LEGS: SpriteFrame;

/** Complete frame A = body + legs A */
export const FRAME_A: SpriteFrame;

/** Complete frame B = body + legs B */
export const FRAME_B: SpriteFrame;

/** Array of both frames, indexed by frame number (0 or 1) */
export const HAMSTER_FRAMES: [SpriteFrame, SpriteFrame];
```

## Architecture

### File Structure

```
src/components/hamster/
  palette.ts    — PALETTE constant + ColorToken type
  sprites.ts    — HAMSTER_FRAMES, FRAME_A, FRAME_B sprite data
```

### Dependencies

- No external dependencies — pure data constants
- Consumed by: spec 33 (wheel renderer), spec 34 (HamsterWheel component)

## Acceptance Criteria

- **Given** `palette.ts` is imported, **when** accessing `PALETTE.body`, **then** it returns `'#d4883c'`.
- **Given** `sprites.ts` is imported, **when** accessing `HAMSTER_FRAMES[0]`, **then** it returns Frame A pixel data as an array of `[col, row, colorToken]` tuples.
- **Given** `HAMSTER_FRAMES[1]`, **when** compared to `HAMSTER_FRAMES[0]`, **then** only leg pixels (rows 4–5) differ.
- **Given** any `SpritePixel` in `HAMSTER_FRAMES`, **when** accessing `pixel[2]`, **then** it is a valid key in `PALETTE`.

## Testing Strategy

- Unit test: verify all color tokens in sprite data exist in `PALETTE`
- Unit test: verify Frame A and Frame B share the same body pixels (rows -5 to 3)
- Unit test: verify Frame A and Frame B have different leg pixels (rows 4-5)
