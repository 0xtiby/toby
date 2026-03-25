# 22 — Project Status Summary

> **Note:** The `StatusSummary` component in this spec was **superseded by spec 35 (Welcome Screen Redesign)**. Stats are now displayed in `InfoPanel`. The `computeProjectStats` function in `stats.ts` is retained and extended with `totalTokens`.

## Overview

A data aggregation module and presentational component that computes and displays project-level statistics (spec counts by status, total iterations) in a compact inline format. Used by the Welcome Screen (spec 21) but designed as a reusable building block for any command that needs project stats.

## Users & Problem

Users have no at-a-glance view of their project's state when launching the CLI. The `status` command shows per-spec detail, but there's no aggregate summary. This spec provides the data layer and display component for that summary.

## Scope

### In scope
- `computeProjectStats()` function that reads status.json + discovers specs to produce aggregate counts
- `ProjectStats` type definition
- `StatusSummary` Ink component rendering stats as a compact inline row
- Graceful handling of missing `.toby/` dir, empty projects, and corrupted data

### Out of scope
- Cost estimation (token pricing) — deferred to future iteration
- Per-spec breakdown in the summary (that's the `status` command's job)
- Historical trend data or graphs

## Data Model

```typescript
// src/lib/stats.ts

export interface ProjectStats {
  /** Total number of discovered spec files */
  totalSpecs: number;
  /** Specs with status "pending" or no status entry */
  pending: number;
  /** Specs with status "planned" */
  planned: number;
  /** Specs with status "building" */
  building: number;
  /** Specs with status "done" */
  done: number;
  /** Sum of all iterations across all specs */
  totalIterations: number;
}
```

## API / Interface

```typescript
// src/lib/stats.ts

/**
 * Compute aggregate project statistics from spec discovery and status.json.
 *
 * Returns null if no .toby/ directory exists (project not initialized).
 * Returns stats with totalSpecs: 0 if initialized but no specs found.
 * Returns null on any error (corrupted status.json, invalid config, etc.)
 * for graceful degradation — the welcome screen simply hides the stats row.
 *
 * Algorithm:
 * 1. Check if .toby/ dir exists (fs.existsSync(getLocalDir(cwd))) → null if not
 * 2. Load config via loadConfig(cwd) to get specsDir
 * 3. Discover spec files via discoverSpecs(cwd, config) — requires both args
 * 4. Read status.json via readStatus(cwd) — wrapped in try-catch because
 *    readStatus() THROWS on corrupted JSON (it does not return null)
 * 5. For each discovered spec:
 *    - The spec already has a .status field populated by discoverSpecs()
 *    - Count by status bucket (pending, planned, building, done)
 * 6. For totalIterations: sum iterations.length across ALL entries in
 *    status.specs (not just discovered specs — includes deleted spec history)
 * 7. Return ProjectStats
 *
 * Error handling pattern (matches status.tsx convention):
 *   try {
 *     statusData = readStatus(cwd);
 *   } catch {
 *     return null; // graceful degradation
 *   }
 */
export function computeProjectStats(cwd?: string): ProjectStats | null;
```

```typescript
// src/components/StatusSummary.tsx

interface StatusSummaryProps {
  stats: ProjectStats | null;
}

/**
 * Renders project stats as a compact inline row.
 * Returns null (renders nothing) when stats is null.
 *
 * Output format:
 *   Specs: 5 · Planned: 3 · Built: 1 | Iterations: 12
 *
 * Color: dimmed text for labels, default for values.
 * Uses "·" (middle dot) as separator within spec counts,
 * "|" (pipe) to separate spec counts from iteration count.
 */
```

## Architecture

### Dependencies

```
src/lib/stats.ts
  ├── src/lib/paths.ts      → getLocalDir() to check .toby/ exists
  ├── src/lib/config.ts     → loadConfig() to get specsDir
  ├── src/lib/specs.ts      → discoverSpecs() to find spec files
  └── src/lib/status.ts     → readStatus(), getSpecStatus()

src/components/StatusSummary.tsx
  └── src/lib/stats.ts      → ProjectStats type (display only)
```

### Data Flow

```
.toby/config.json ─► loadConfig(cwd) ─► config ─┐
                                                  ├─► discoverSpecs(cwd, config) ─► Spec[] (with .status)
specs/*.md ──────────────────────────────────────┘         │
                                                            ├─► computeProjectStats() ─► ProjectStats
.toby/status.json ─► readStatus(cwd) [try-catch] ─────────┘         │
                                                                      ▼
                                                            <StatusSummary stats={...} />
                                                                      │
                                                                      ▼
                                                 "Specs: 5 · Planned: 3 · Built: 1 | Iterations: 12"
```

**Note:** `discoverSpecs()` already populates each `Spec.status` field by reading status.json internally. However, `computeProjectStats()` also needs to call `readStatus()` separately to access `status.specs` entries for deleted specs (to count their iterations toward `totalIterations`).

## Business Rules

- A spec is counted as "pending" if it has no entry in status.json OR its status is "pending"
- `totalIterations` is the sum of `iterations.length` across all spec entries in status.json (not limited to discovered specs — includes historical data for deleted specs)
- If status.json contains entries for specs that no longer exist as files, those iterations still count toward `totalIterations` but the specs are NOT counted in `totalSpecs`
- `totalSpecs` reflects only currently discovered spec files

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No `.toby/` directory | `computeProjectStats()` returns `null` → `StatusSummary` renders nothing |
| `.toby/` exists, no status.json | Returns stats with all zeros (readStatus returns `{ specs: {} }`) |
| `.toby/` exists, corrupted status.json | Returns `null` (catches error, graceful degradation) |
| Specs exist but none tracked in status | `totalSpecs` reflects file count, all counted as "pending", iterations = 0 |
| Status entries for deleted specs | Iterations count toward total, but spec not counted in totalSpecs |
| Zero specs discovered | `totalSpecs: 0`, all counts zero, but still renders the row (not hidden) |

## Acceptance Criteria

- **Given** a project with 5 specs (3 planned, 1 done, 1 pending) and 12 total iterations, **when** `computeProjectStats()` is called, **then** it returns `{ totalSpecs: 5, pending: 1, planned: 3, building: 0, done: 1, totalIterations: 12 }`.
- **Given** `computeProjectStats()` returns valid stats, **when** `StatusSummary` renders, **then** it displays `Specs: 5 · Planned: 3 · Built: 1 | Iterations: 12`.
- **Given** `computeProjectStats()` returns `null`, **when** `StatusSummary` renders, **then** nothing is rendered (component returns null).
- **Given** status.json is corrupted, **when** `computeProjectStats()` is called, **then** it returns `null` without throwing.
- **Given** status.json has entries for a spec that no longer exists as a file, **when** stats are computed, **then** `totalIterations` includes those iterations but `totalSpecs` does not count the deleted spec.

## Testing Strategy

- **Unit tests for `computeProjectStats()`**:
  - No `.toby/` dir → returns null
  - Empty status.json → all zeros with correct totalSpecs
  - Mixed statuses → correct bucket counts
  - Corrupted JSON → returns null
  - Deleted spec with iterations → totalIterations includes them, totalSpecs excludes
- **Component test for `StatusSummary`**:
  - Null stats → renders empty
  - Valid stats → renders formatted inline row with correct numbers
  - Zero stats → renders row with zeros
