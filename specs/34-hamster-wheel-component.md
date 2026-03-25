# 34 — HamsterWheel Component

## Overview

The main Ink component that composes the spinning wheel and animated hamster sprite into a terminal-rendered pixel-art animation. Manages the grid buffer, animation loop, half-block rendering, and frame timing.

## Users & Problem

The current ASCII robot mascot is static and generic. The animated hamster-in-a-wheel gives toby a distinctive, memorable visual identity that reinforces the "iterative loop" metaphor of the tool.

## Scope

### In scope
- Grid buffer management (allocate, clear, composite)
- Animation loop with two independent timers (hamster legs, wheel spokes)
- Half-block Unicode rendering for 2× vertical resolution
- Compositing: wheel pixels first, then hamster sprite on top
- Hamster positioning at bottom-center of wheel interior
- Configurable grid dimensions with adaptive sizing
- Cleanup on unmount

### Out of scope
- Speed lines, particles, ground glow (HTML-only effects, not replicated in terminal)
- Stats counters (SPD, DIST — these are replaced by real project stats in the info panel, spec 35)
- Star background (terminal background is sufficient)

## Business Rules

- The hamster **does not rotate** — it stays fixed at the bottom of the wheel
- Only the **spokes** rotate; the rim is circularly symmetric and appears static
- Two independent animation cycles:
  - **Hamster run**: alternate Frame A / Frame B every 140ms
  - **Wheel spin**: increment spoke angle by ~0.15 radians every 100ms
- **Speed multiplier**: `speed` prop scales interval timing. `speed=2` → twice as fast (half interval). `speed=0` is a special case: no intervals are started, renders a frozen frame. Intervals are clamped to a minimum of 16ms (60fps cap).
  - Formula: `interval = Math.max(16, Math.round(baseInterval / speed))` where speed > 0
- **Z-order**: wheel drawn first, hamster pixels overwrite wheel pixels in the buffer
- The component must clean up intervals on unmount

## Adaptive Sizing

The component adapts to available terminal width:

| Terminal width | Grid size | Label |
|---------------|-----------|-------|
| < 60 columns | Animation disabled, show static hamster text | `static` |
| 60–99 columns | 25×13 logical pixels (25×7 chars) | `compact` |
| ≥ 100 columns | 35×18 logical pixels (35×9 chars) | `full` |

The grid size can also be overridden via props.

## UI/UX

### Half-Block Rendering

Each character cell encodes **two vertical pixels** using Unicode half-block characters:

| Top pixel | Bottom pixel | Character | Styling |
|-----------|-------------|-----------|---------|
| Set | Set | `▀` | `color={topColor} backgroundColor={bottomColor}` |
| Set | Empty | `▀` | `color={topColor}` |
| Empty | Set | `▄` | `color={bottomColor}` |
| Empty | Empty | ` ` | (space) |

This doubles vertical resolution, making the hamster sprite look significantly better.

**Note on aspect ratio**: With half-block rendering, each character cell represents 1 horizontal × 2 vertical logical pixels, giving an effective aspect ratio of ~1:1. This means `generateWheelPixels` should be called with `aspectRatio=1.0` (no correction needed). See spec 33 for details.

### Row Batching for Performance

To avoid creating hundreds of individual `<Text>` elements per frame, each row is rendered by batching consecutive pixels with the same color pair into a single `<Text>` element:

```tsx
// Each row produces a series of <Text> spans, one per color-pair run
<Text key={y}>
  {colorRuns.map((run, i) => (
    <Text key={i} color={run.fg} backgroundColor={run.bg}>
      {run.char.repeat(run.length)}
    </Text>
  ))}
</Text>
```

This reduces the element count from `width × charHeight` to roughly `charHeight × (number of color transitions per row)`.

### Static Fallback

When the terminal is too narrow (< 60 columns), render a simple static text:

```
  🐹 toby
```

### Rendered Output Example (compact mode, conceptual)

The component outputs `ceil(logicalHeight / 2)` lines of `<Text>`, each containing `width` characters. The wheel appears as a circle of colored blocks with spokes, and the hamster sits at the bottom center.

## Data Model

```typescript
// src/components/hamster/HamsterWheel.tsx

interface HamsterWheelProps {
  /** Grid columns (logical pixels). Auto-computed from terminal width if omitted. */
  width?: number;
  /** Grid rows (logical pixels). Auto-computed if omitted. */
  height?: number;
  /** Animation speed multiplier. Default 1. Set to 0 to freeze. */
  speed?: number;
}

/** Internal grid buffer — 2D array of hex color strings or null */
type GridBuffer = (string | null)[][];
```

## API / Interface

```typescript
// src/components/hamster/HamsterWheel.tsx

/**
 * Animated pixel-art hamster running in a spinning wheel.
 * Renders as colored Unicode half-block characters.
 */
export default function HamsterWheel(props: HamsterWheelProps): React.ReactElement;
```

### Internal State

```typescript
const [frame, setFrame] = useState(0);           // 0 or 1 — hamster leg frame
const [spokeAngle, setSpokeAngle] = useState(0); // radians — wheel spoke rotation
```

### Rendering Pipeline (per tick)

1. **Allocate grid** — `width × height` buffer filled with `null`
2. **Draw wheel** — call `generateWheelPixels(cx, cy, R, Ri, spokeAngle)`, stamp each pixel onto buffer
3. **Draw hamster** — compute hamster origin (centered horizontally, feet at bottom inner rim), stamp current frame's sprite pixels using `PALETTE[colorToken]` for actual hex colors
4. **Render half-blocks** — iterate grid in pairs of rows, output `<Text>` elements with appropriate `color`/`backgroundColor` props

### Hamster Positioning

The hamster origin is placed so that:
- **Horizontally**: centered in the wheel (`cx + hamsterOffsetX` where offset adjusts for the sprite not being symmetric — the hamster faces left so center of mass is slightly right of sprite center)
- **Vertically**: feet (row 4-5 of sprite) align with the bottom inner rim of the wheel

```typescript
const hamsterOriginX = cx - 2;  // slight left offset (facing left)
const hamsterOriginY = cy + innerRadius - 5;  // feet near bottom rim
```

## Architecture

### File Structure

```
src/components/hamster/
  HamsterWheel.tsx  — main component (grid buffer + animation + render)
  palette.ts        — color constants (spec 32)
  sprites.ts        — sprite frame data (spec 32)
  wheel.ts          — wheel geometry (spec 33)
```

No barrel `index.ts` — consistent with the rest of the codebase where components are imported directly by path (e.g., `import HamsterWheel from "./hamster/HamsterWheel.js"`).

### Animation Lifecycle

```
Mount
  ├─ useEffect: start hamster timer (140ms × 1/speed)
  │   └─ setFrame(f => (f + 1) % 2)
  ├─ useEffect: start wheel timer (100ms × 1/speed)
  │   └─ setSpokeAngle(a => a + 0.15)
  └─ useStdout: read terminal columns for adaptive sizing

Each state change triggers re-render:
  1. Build grid buffer
  2. Stamp wheel pixels
  3. Stamp hamster pixels
  4. Convert to half-block text lines
  5. Output <Text> elements

Unmount
  └─ Cleanup: clear both intervals
```

### Dependencies

- `react` — useState, useEffect, useMemo
- `ink` — Box, Text, useStdout (for terminal width detection)
- `./palette.js` — PALETTE constant
- `./sprites.js` — HAMSTER_FRAMES
- `./wheel.js` — generateWheelPixels

## Edge Cases

- **Terminal resize during animation**: `useStdout().columns` updates on resize. The component should re-compute grid dimensions. Use the `columns` value in the render path (not cached in state).
- **speed=0**: Special case — no intervals are started. The component renders a frozen frame (frame 0, spokeAngle 0). The `speed` value is checked before computing interval duration to avoid division by zero.
- **Very fast speed** (speed > 8): Intervals are clamped to a minimum of 16ms (60fps cap) to avoid excessive re-renders.
- **Non-truecolor terminal**: Ink's `<Text color="#hex">` automatically degrades to 256-color. Colors will be approximate but functional.
- **Unmount during animation**: `useEffect` cleanup clears intervals — no memory leaks.

## Acceptance Criteria

- **Given** the component mounts, **when** 140ms passes, **then** the hamster sprite alternates between Frame A and Frame B.
- **Given** the component mounts, **when** 100ms passes, **then** the wheel spokes shift position.
- **Given** a terminal width of 80 columns, **when** the component renders, **then** it uses compact grid dimensions (25×13).
- **Given** a terminal width of 120 columns, **when** the component renders, **then** it uses full grid dimensions (35×18).
- **Given** a terminal width of 50 columns, **when** the component renders, **then** it shows the static fallback text.
- **Given** `speed={0}`, **when** the component renders, **then** it shows a static frame with no animation.
- **Given** the component unmounts, **when** checked, **then** no intervals remain active.
- **Given** the rendered output, **when** inspecting characters, **then** only `▀`, `▄`, and space characters are used (half-block rendering).

## Testing Strategy

- **Unit test**: Render with `ink-testing-library` using explicit `width`/`height` props (bypassing adaptive sizing), verify output contains half-block characters (`▀` or `▄`).
- **Unit test**: Render with `speed={0}` and fixed dimensions, verify output is deterministic (same output on consecutive `lastFrame()` calls).
- **Unit test**: Render with explicit `width`/`height` props at compact and full sizes, verify output row/column counts match expected character dimensions.
- **Unit test**: Render at narrow width (e.g., `width={5}`), verify static fallback text appears.

Note: adaptive sizing via `useStdout` is not directly testable with ink-testing-library (virtual terminal has no real columns). Test adaptive logic by passing explicit `width`/`height` props instead. The adaptive branch is integration-tested via Welcome component tests.
