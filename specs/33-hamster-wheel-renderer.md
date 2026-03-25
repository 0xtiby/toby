# 33 — Wheel Renderer

## Overview

Generate the spinning wheel geometry (rim, inner ring, spokes, hub) as pixel data on a 2D grid buffer. The wheel rotates by advancing a spoke angle offset each animation tick.

## Scope

### In scope
- Outer rim circle (64 angle steps, alternating bright/dim every 3rd pixel)
- Inner rim circle (50 angle steps, every 3rd plotted)
- 8 radial spokes from center to rim, rotated by a variable angle offset
- Center hub (plus shape)
- Functions to stamp wheel geometry onto a grid buffer

### Out of scope
- Hamster sprite rendering (spec 32 data, spec 34 compositing)
- Animation loop / timing (spec 34)
- Half-block terminal rendering (spec 34)

## Business Rules

- The **rim** is a static circle — rotation doesn't change its appearance (it's circularly symmetric)
- The **spokes** rotate: the starting angle offset is incremented each tick by ~0.15 radians
- The **hub** is static (small plus shape at center)
- All geometry is plotted by rounding `(cx + cos(a) * r, cy + sin(a) * r)` to integer grid positions
- Wheel pixels are drawn **before** hamster pixels (hamster overwrites wheel in Z-order)

## Aspect Ratio Correction

Terminal characters are approximately 2:1 (height:width). A circle drawn with equal radii in x and y will appear as a vertical ellipse. To correct this, the wheel renderer applies an **aspect ratio multiplier** of ~2.0 on the x-axis when plotting points:

```
x = round(cx + cos(angle) * radius * ASPECT_RATIO)
y = round(cy + sin(angle) * radius)
```

Where `ASPECT_RATIO = 2.0`. This stretches the x-coordinates so the wheel appears circular in the terminal.

When using half-block rendering (spec 34), the effective character aspect ratio is closer to 1:1 (since each character encodes 2 vertical pixels). In that mode, `ASPECT_RATIO = 1.0` (no correction needed). The aspect ratio should be a parameter to `generateWheelPixels` so the caller can set it based on rendering mode.

## Data Model

```typescript
// src/components/hamster/wheel.ts

/** A single colored pixel on the grid buffer */
export interface GridPixel {
  x: number;
  y: number;
  color: string;  // hex color from PALETTE
}

/**
 * Generate all wheel pixels for a given grid size and spoke angle.
 *
 * @param cx - Center column in the grid
 * @param cy - Center row in the grid
 * @param outerRadius - Outer rim radius in grid cells
 * @param innerRadius - Inner rim radius in grid cells
 * @param spokeAngle - Current spoke rotation angle in radians
 * @param aspectRatio - X-axis stretch factor to correct for terminal character proportions (default 1.0 for half-block mode)
 * @returns Array of GridPixel to stamp onto the buffer
 */
export function generateWheelPixels(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  spokeAngle: number,
  aspectRatio?: number,  // default 1.0
): GridPixel[];
```

## API / Interface

### `generateWheelPixels`

Computes all wheel geometry for a single frame. Called on every animation tick with an updated `spokeAngle`.

The number of angle steps for rim circles **scales with radius** to avoid excessive rounding collisions at small sizes. Use `steps = max(16, radius * 8)` as a baseline.

**Outer rim** — scaled angle steps:
```
steps = max(16, outerRadius * 8)
for i in 0..steps-1:
  angle = (i / steps) * 2π
  x = round(cx + cos(angle) * outerRadius * aspectRatio)
  y = round(cy + sin(angle) * outerRadius)
  color = (i % 3 === 0) ? PALETTE.wheelBright : PALETTE.wheelDim
```

**Inner rim** — scaled angle steps, every 3rd plotted:
```
steps = max(12, innerRadius * 6)
for i in 0..steps-1:
  if i % 3 === 0:
    angle = (i / steps) * 2π
    x = round(cx + cos(angle) * innerRadius * aspectRatio)
    y = round(cy + sin(angle) * innerRadius)
    color = PALETTE.wheelInner
```

**Spokes** — 8 radial lines, step scales with radius:
```
spokeStep = max(1, outerRadius / 8)
for s in 0..7:
  angle = spokeAngle + (s / 8) * 2π
  for r from (outerRadius * 0.25) to outerRadius, step spokeStep:
    x = round(cx + cos(angle) * r * aspectRatio)
    y = round(cy + sin(angle) * r)
    color = PALETTE.wheelSpoke
```

**Hub** — plus shape at center:
```
for dx in [-1, 0, 1]:
  for dy in [-1, 0, 1]:
    if |dx| + |dy| <= 1:
      color = PALETTE.wheelHub
```

### Scaling

The wheel geometry scales with the grid dimensions. The radius is derived from **height** (the constrained axis), not `min(width, height)`, because the aspect ratio correction stretches x-coordinates:

```typescript
export function computeWheelGeometry(width: number, height: number) {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const outerRadius = Math.floor(height / 2) - 1;
  const innerRadius = Math.floor(outerRadius * 0.85);
  return { cx, cy, outerRadius, innerRadius };
}
```

## Architecture

### File Structure

```
src/components/hamster/
  wheel.ts    — generateWheelPixels() + scaling helpers
```

### Dependencies

- Imports: `PALETTE` from `./palette.js`
- Consumed by: spec 34 (HamsterWheel component)

## Edge Cases

- **Very small grids** (height < 10): spokes may overlap heavily. Minimum recommended height is 13 (compact mode).
- **Rounding collisions**: Multiple angle steps may round to the same grid cell. Last-write-wins is fine (later pixels overwrite earlier ones in the buffer).
- **Aspect ratio at edges**: with `aspectRatio > 1`, x-coordinates may exceed grid bounds. Callers must clamp or the function should skip out-of-bounds pixels (`x < 0 || x >= width`).

## Acceptance Criteria

- **Given** `generateWheelPixels(15, 7, 6, 5, 0)`, **when** the result is inspected, **then** it contains pixels forming a circular rim, inner ring, 8 spokes, and a center hub.
- **Given** two calls with `spokeAngle=0` and `spokeAngle=0.15`, **when** comparing results, **then** rim and hub pixels are identical, but spoke pixels have shifted positions.
- **Given** any pixel in the result, **when** accessing its color, **then** it is a valid hex color from `PALETTE`.
- **Given** all pixels in the result, **when** checked against grid bounds, **then** all `x` values are in `[0, width)` and all `y` values are in `[0, height)`.
- **Given** `computeWheelGeometry(25, 13)`, **when** the result is inspected, **then** `outerRadius` is 5 and `innerRadius` is 4.

## Testing Strategy

- Unit test: verify `generateWheelPixels` returns non-empty array
- Unit test: verify spoke rotation changes spoke pixel positions but not rim/hub
- Unit test: verify all returned pixel coordinates are within bounds `[0, width) × [0, height)`
- Unit test: verify scaling function produces correct radii for various grid sizes
