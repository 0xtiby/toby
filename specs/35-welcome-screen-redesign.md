# 35 — Welcome Screen Redesign

## Overview

Redesign the welcome screen to use a two-column layout: animated hamster wheel on the left, info panel (version, project stats, token count) on the right. Replaces the current robot mascot entirely. The menu remains below the two-column header.

## Users & Problem

The current welcome screen uses a simple static ASCII robot. The redesign gives toby a distinctive animated identity while surfacing more project information at a glance in the info panel.

## Scope

### In scope
- Two-column layout: `<HamsterWheel />` left, info panel right
- Info panel displays: version, spec counts (total/planned/done), total token count
- Full replacement of `Mascot.tsx` — delete the file
- Update `Welcome.tsx` to use new layout
- Update spec 21 to mark it as superseded by this spec

### Out of scope
- Cost estimation in dollars (v1 shows raw token count only)
- Configurable mascot selection (full replacement, no toggle)
- Changes to MainMenu behavior or items
- Changes to `--help` output

## User Stories

1. **As a user**, I can run `toby` and see an animated hamster running in a wheel alongside project stats, so that I get an engaging and informative landing experience.
2. **As a user**, I can see my total specs, planned count, done count, and total tokens used at a glance, so that I understand project progress without running `toby status`.

## UI/UX Flow

### Two-Column Layout

```
┌──────────────────────────┬───────────────────────────┐
│                          │                           │
│    [animated hamster     │  toby v0.1.0              │
│     in spinning wheel]   │                           │
│                          │  Specs     5              │
│                          │  Planned   3              │
│                          │  Done      1              │
│                          │                           │
│                          │  Tokens    24,512         │
│                          │                           │
└──────────────────────────┴───────────────────────────┘

  ❯ plan     — Plan specs with AI loop engine
    build    — Build tasks one-per-spawn with AI
    status   — Show project status
    config   — Manage configuration
```

### Info Panel Details

| Field | Source | Format |
|-------|--------|--------|
| Version | `package.json` version (passed as prop) | `toby v{version}` |
| Specs | `ProjectStats.totalSpecs` | Integer |
| Planned | `ProjectStats.planned` | Integer |
| Done | `ProjectStats.done` | Integer |
| Tokens | Sum of all `tokensUsed` across all iterations | Formatted with thousands separator (e.g., `24,512`) |

### Info Panel Styling

- **"toby v0.1.0"**: bold, color `#f0a030` (warm amber, matching the hamster's body palette)
- **Labels** (Specs, Planned, Done, Tokens): dim/gray
- **Values**: default terminal color (white/light)
- **Spacing**: labels right-aligned, values left-aligned with consistent padding

### States

| State | Info panel shows |
|-------|-----------------|
| No `.toby/` dir | Version only (no stats, no tokens) |
| Initialized, no iterations | Version + stats (all zeros) + Tokens: 0 |
| Initialized, with data | Full info panel |
| Terminal < 60 cols | Static fallback: `🐹 toby v0.1.0` + stats as single line (like current StatusSummary) |

### Narrow Fallback (< 60 columns)

When the terminal is too narrow for the two-column layout, collapse to a single-column view:

```
  🐹 toby v0.1.0
  Specs: 5 · Planned: 3 · Done: 1 · Tokens: 24,512

  ❯ plan     — Plan specs with AI loop engine
    ...
```

The hamster animation is replaced by the emoji, and stats appear as a compact inline row (similar to the old StatusSummary format).

### Token Formatting

Use `Intl.NumberFormat` for thousands separators:

```typescript
new Intl.NumberFormat().format(totalTokens)
// 24512 → "24,512"
```

### Navigation (unchanged)

- Arrow keys (↑/↓) to navigate menu
- Enter to select → welcome view replaced by command component
- Ctrl+C to exit

## Business Rules

- Token count is computed by summing `tokensUsed` from all iterations across all specs in `status.json`. Null values are treated as 0.
- When `.toby/` doesn't exist, the info panel shows only the version line (no stats section).
- The hamster animation runs continuously while the welcome screen is displayed and stops on navigation.

## Data Model

### Extended ProjectStats

```typescript
// src/lib/stats.ts — add totalTokens field

interface ProjectStats {
  totalSpecs: number;
  pending: number;
  planned: number;
  building: number;
  done: number;
  totalIterations: number;
  totalTokens: number;  // NEW: sum of tokensUsed across all iterations
}
```

### InfoPanel Props

```typescript
// src/components/InfoPanel.tsx

interface InfoPanelProps {
  version: string;
  stats: ProjectStats | null;
}
```

## API / Interface

### Updated `computeProjectStats`

Add `totalTokens` to the return value:

```typescript
// In the existing iteration loop, also sum tokensUsed:
let totalTokens = 0;
for (const entry of Object.values(statusData.specs)) {
  for (const iter of entry.iterations) {
    totalTokens += iter.tokensUsed ?? 0;
  }
  totalIterations += entry.iterations.length;
}
// Add totalTokens to returned object
```

### New `InfoPanel` Component

```typescript
export default function InfoPanel({ version, stats }: InfoPanelProps): React.ReactElement;
```

Renders a vertical stack of labeled values. Returns only the version line when `stats` is null.

### Updated `Welcome` Component

```typescript
// src/components/Welcome.tsx

export default function Welcome({ version }: WelcomeProps): React.ReactElement;
```

Stats are computed once on mount:

```typescript
import { computeProjectStats } from "../lib/stats.js";

// Inside Welcome component:
const stats = useMemo(() => computeProjectStats(), []);
```

Layout changes:
```tsx
<Box flexDirection="column" gap={1}>
  <Box flexDirection="row" gap={2}>
    <HamsterWheel />
    <InfoPanel version={version} stats={stats} />
  </Box>
  <MainMenu onSelect={setSelectedCommand} />
</Box>
```

## Architecture

### File Changes

| Action | File | Description |
|--------|------|-------------|
| **Delete** | `src/components/Mascot.tsx` | Robot mascot removed entirely |
| **Delete** | `src/components/Mascot.test.tsx` | Associated tests removed |
| **Create** | `src/components/InfoPanel.tsx` | New info panel component |
| **Modify** | `src/components/Welcome.tsx` | Two-column layout with HamsterWheel + InfoPanel; import `computeProjectStats` |
| **Modify** | `src/components/Welcome.test.tsx` | Update assertions: remove `"● ●"` robot checks, add hamster/info panel checks |
| **Modify** | `src/lib/stats.ts` | Add `totalTokens` to `ProjectStats` |
| **Modify** | `src/lib/__tests__/stats.test.ts` | Add `totalTokens` assertions to existing tests |
| **Delete** | `src/components/StatusSummary.tsx` | Replaced by InfoPanel (stats are now in the panel) |
| **Delete** | `src/components/StatusSummary.test.tsx` | Associated tests removed |

### Component Tree (updated)

```
Welcome
  ├─ Box (row)
  │   ├─ HamsterWheel          ← animated mascot (spec 34)
  │   └─ InfoPanel              ← version + stats + tokens
  └─ MainMenu                  ← command selection (unchanged)
```

### Dependencies

- `HamsterWheel` from spec 34
- `computeProjectStats` from `src/lib/stats.ts` (modified)
- `MainMenu` from existing `src/components/MainMenu.tsx` (unchanged)

### Cross-References

- **Supersedes spec 21** (Welcome Screen & Menu) for the mascot and layout portions. Menu behavior is unchanged.
- **Supersedes spec 22** (Project Status Summary) — `StatusSummary` component is replaced by `InfoPanel`. The `computeProjectStats` function in `stats.ts` is retained and extended.
- **Depends on spec 34** (HamsterWheel Component)

## Edge Cases

- **No `.toby/` directory**: Info panel shows version only. HamsterWheel still animates.
- **Corrupted `status.json`**: `computeProjectStats` returns null (existing behavior). Info panel shows version only.
- **All `tokensUsed` are null**: Total tokens displays as `0`.
- **Very large token counts**: Formatted with thousands separator (`1,234,567`).
- **Terminal < 60 columns**: Falls back to single-column static layout (hamster static fallback + inline stats).
- **Ctrl+C during animation**: Ink handles SIGINT, intervals are cleaned up via useEffect.

## Acceptance Criteria

- **Given** the user runs `toby` with no arguments, **when** the terminal is interactive, **then** a two-column layout shows with animated hamster on the left and info panel on the right.
- **Given** a `.toby/` directory with status data, **when** the welcome screen renders, **then** the info panel shows spec counts and total tokens.
- **Given** no `.toby/` directory, **when** the welcome screen renders, **then** the info panel shows only the version.
- **Given** iterations with `tokensUsed` values of `[100, null, 250]`, **when** total tokens is computed, **then** it displays `350`.
- **Given** the user selects "plan" from the menu, **when** they press Enter, **then** the welcome screen (including animation) is replaced by the Plan command UI.
- **Given** `Mascot.tsx` exists in the codebase, **when** this spec is implemented, **then** `Mascot.tsx` is deleted and no imports reference it.
- **Given** a terminal width of 50 columns, **when** the welcome screen renders, **then** it shows a static single-column fallback.

## Testing Strategy

- **Component test** (`InfoPanel.test.tsx`): Render `InfoPanel` with mock stats, verify version, spec counts, and formatted token count appear.
- **Component test** (`InfoPanel.test.tsx`): Render `InfoPanel` with `stats=null`, verify only version appears.
- **Component test** (`Welcome.test.tsx`): Update existing tests — remove assertions checking for `"● ●"` (robot eyes), add assertions checking for `"toby v"` in info panel output and half-block characters from HamsterWheel.
- **Unit test** (`src/lib/__tests__/stats.test.ts`): Add assertions to existing tests verifying `totalTokens` is the sum of all `tokensUsed` values (including null → 0 handling).
- **Verify**: No file in `src/` imports from `Mascot.js` or `StatusSummary.js` after implementation.
