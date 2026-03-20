# 14 — Status Command Adaptation

## Overview

Adapt the `toby status` command to work without PRD coupling. The overview table replaces the Tasks column with a Tokens column. The detailed view (`--spec=X`) replaces the task table with an iteration history table. All data comes from `status.json` — no external file reads.

## Problem

`status.tsx` currently imports `readPrd` and `getTaskSummary` to display task progress (e.g., "3/5") in the overview table and a full task table (ID | Title | Status) in the detailed view. After spec 12 removes PRD coupling, these imports no longer exist and the status command needs a new display model.

## Scope

### In scope

- Replace Tasks column with Tokens column in overview table
- Replace task table in detailed view with iteration history table
- Remove all PRD imports from `status.tsx`
- Update `SpecRow` interface
- Add `IterationRow` interface and `IterationTable` component
- Update tests

### Out of scope

- Changes to `status.json` schema
- Adding new status columns or fields
- Interactive status features

### Dependencies

- Spec 12 (decouple PRD from code) must be completed first — this spec removes the PRD imports that status.tsx currently relies on

## User Stories

- As a user, I can run `toby status` and see a table with Spec | Status | Iterations | Tokens, so I know how much work has been done per spec.
- As a user, I can run `toby status --spec=X` and see a history of all iterations (plan and build), so I can understand the timeline and resource usage.

## Business Rules

- **Overview table:** Columns are `Spec | Status | Iter | Tokens`. Tokens is the sum of `tokensUsed` across all iterations for that spec.
- **Detailed view:** Shows spec name, status, then an iteration history table with columns: `# | Type | CLI | Tokens | Duration | Exit`.
- **Duration:** Computed from `startedAt` and `completedAt` in each iteration record. Display as human-readable (e.g., "2m 30s"). Show "—" if `completedAt` is null.
- **Tokens formatting:** Show raw numbers (no abbreviation). Show "—" if `tokensUsed` is null.
- **Exit code:** Show the integer exit code. Show "—" if null.

## UI/UX Flows

### Overview table

```
toby v0.x.x

 Spec                        │ Status   │ Iter │ Tokens
──────────────────────────────┼──────────┼──────┼────────
 01-project-restructure       │ done     │ 5    │ 42000
 02-configuration-system      │ building │ 3    │ 28500
 03-spec-discovery            │ planned  │ 2    │ 15000
 04-prd-status-model          │ pending  │ 0    │ 0
```

### Detailed view (`--spec=02`)

```
02-configuration-system
Status: building

 #  │ Type  │ CLI    │ Tokens │ Duration │ Exit
────┼───────┼────────┼────────┼──────────┼──────
 1  │ plan  │ claude │ 8000   │ 1m 12s   │ 0
 2  │ plan  │ claude │ 7000   │ 0m 58s   │ 0
 3  │ build │ claude │ 13500  │ 2m 30s   │ 0

Iterations: 3
Tokens used: 28500
```

## Data Model

```typescript
// Overview row — replaces current SpecRow
interface SpecRow {
  name: string;
  status: string;
  iterations: number;
  tokens: number;
}

// Detailed view row — new
interface IterationRow {
  index: number;
  type: "plan" | "build";
  cli: string;
  tokens: string;    // formatted number or "—"
  duration: string;  // formatted duration or "—"
  exitCode: string;  // formatted number or "—"
}
```

## Architecture

### Files to modify

| File | Change |
|------|--------|
| `src/commands/status.tsx` | Remove PRD imports, update `SpecRow`, add `IterationRow` / `IterationTable`, update `buildRows()`, rewrite `DetailedView` |

### buildRows() changes

**Before:**
```typescript
const prd = readPrd(spec.name, cwd);
if (prd) {
  const summary = getTaskSummary(prd);
  tasks = `${summary.done}/${prd.tasks.length}`;
}
```

**After:**
```typescript
const tokens = entry.iterations.reduce(
  (sum, iter) => sum + (iter.tokensUsed ?? 0), 0
);
```

### DetailedView changes

**Before:** Reads PRD, shows `TaskTable` with task ID/title/status.

**After:** Reads iteration records from `status.json`, shows `IterationTable` with iteration index/type/CLI/tokens/duration/exit code.

### Duration formatting

```typescript
function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
```

## Acceptance Criteria

- Given specs with iterations in status.json, when I run `toby status`, then the table shows Spec | Status | Iter | Tokens columns
- Given a spec with 3 iterations totaling 28500 tokens, when I run `toby status`, then the Tokens column shows `28500`
- Given a spec with no iterations, when I run `toby status`, then Iter shows `0` and Tokens shows `0`
- Given `toby status --spec=X`, when X has 3 iterations, then an iteration history table is shown with all 3 rows
- Given an iteration with `completedAt: null`, when displayed, then Duration shows "—"
- Given an iteration with `tokensUsed: null`, when displayed, then Tokens shows "—"
- Given PRD imports are removed from status.tsx, when `pnpm build` runs, then compilation succeeds
- Given no `.toby/` directory exists, when I run `toby status`, then the "not initialized" message appears (unchanged behavior)

## Testing Strategy

- Unit tests for `buildRows()`: verify tokens summation from iteration records
- Unit tests for `formatDuration()`: null completedAt, normal duration, zero duration
- Unit tests for `DetailedView`: verify iteration table rendering with mock status data
- Snapshot or assertion tests for table layout (column alignment, headers)
- Integration: `toby status` works end-to-end against a test `.toby/status.json`
