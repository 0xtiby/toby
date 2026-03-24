# Fix Skipped Display in --all Mode

## Overview

The `--all` mode summary in both `plan` and `build` commands incorrectly labels specs as "skipped" when they are simply in a different lifecycle state (e.g., "done"). "Skipped" should only refer to specs the user explicitly chose not to select during an interactive run — it should never appear in `--all` mode.

## Problem

When running `toby plan --all` or `toby build --all`, the completion summary shows a "Skipped" line listing all specs whose status doesn't match the command's target. For example, running `toby build --all` when all specs are "done" shows all 22 specs as "skipped". This is misleading — those specs are finished, not skipped.

**Root cause:**
- `plan.tsx:174` — treats any non-"pending" spec as skipped
- `build.tsx:232` — treats any non-"planned"/non-"building" spec as skipped

## Scope

### In scope
- Remove the `skipped` field from `PlanAllResult` and `BuildAllResult`
- Remove the "Skipped:" display line from `--all` mode completion output
- Remove `skipped` computation from `executePlanAll()` and `executeBuildAll()`
- Update the summary line to not mention skipped count (e.g., `✓ All specs planned (3 planned)` instead of `✓ All specs planned (3 planned, 19 skipped)`)
- Update affected tests

### Out of scope
- Multi-select / interactive mode skipping (future feature if needed)
- Changes to spec selector component
- Changes to status tracking

## User Stories

**As a user running `toby plan --all`**, I see only the specs that were planned, without a misleading "Skipped" list of done specs.

**As a user running `toby build --all`**, I see only the specs that were built, without a misleading "Skipped" list of pending/done specs.

## Business Rules

1. `executePlanAll()` processes all "pending" specs — no skipped concept exists
2. `executeBuildAll()` processes all "planned"/"building" specs — no skipped concept exists
3. The `--all` completion summary shows only the count and names of processed specs

## Data Model

### Remove from interfaces

```typescript
// plan.tsx — remove skipped field
export interface PlanAllResult {
  planned: PlanResult[];
  // skipped: string[];  ← REMOVE
}

// build.tsx — remove skipped field
export interface BuildAllResult {
  built: BuildResult[];
  // skipped: string[];  ← REMOVE
}
```

## Changes

### `src/commands/plan.tsx`

1. Remove `skipped` from `PlanAllResult` interface (line 150)
2. Update JSDoc comment to remove "are skipped" wording (line 155)
3. Remove `const skipped = specs.filter(...)` (line 174)
4. Change return from `{ planned, skipped }` to `{ planned }` (line 197)
5. Update summary line to remove skipped count (line 258): `✓ All specs planned (${allResult.planned.length} planned)`
6. Remove the conditional skipped display block (lines 262-264)

### `src/commands/build.tsx`

1. Remove `skipped` from `BuildAllResult` interface (line 204)
2. Remove `const skipped = specs.filter(...)` (line 232)
3. Change return from `{ built, skipped }` to `{ built }` (line 272)
4. Update summary line to remove skipped count (line 340): `✓ All specs built (${allResult.built.length} built)`
5. Remove the conditional skipped display block (lines 345-347)

### `src/commands/plan.test.tsx`

- Line 418: Remove `expect(result.skipped).toHaveLength(0)` assertion
- Lines 424-439: Test "skips already-planned specs" — remove `expect(result.skipped).toEqual(["01-auth"])` (line 438). Rename test to reflect it only plans pending specs.
- Lines 459-473: Test "returns empty planned array when all specs are already planned" — remove `expect(result.skipped).toEqual(["01-auth", "02-api"])` (line 471)

### `src/commands/build.test.tsx`

- Lines 946-959: Test "returns per-spec results and skipped list" — remove `expect(result.skipped).toEqual(["02-api"])` (line 958). Rename test to "returns per-spec results".

## Acceptance Criteria

- **Given** all specs are "done", **when** I run `toby build --all`, **then** I see "No planned specs found" error — no skipped list
- **Given** 3 specs are "pending" and 19 are "done", **when** I run `toby plan --all`, **then** I see `✓ All specs planned (3 planned)` with no "Skipped" line
- **Given** 5 specs are "planned" and 17 are in other states, **when** I run `toby build --all`, **then** I see `✓ All specs built (5 built)` with no "Skipped" line
- **Given** the `PlanAllResult` and `BuildAllResult` types, **then** they do not have a `skipped` field
- **Given** existing tests reference `skipped`, **then** those assertions are removed or updated

## Testing Strategy

- Unit tests for `executePlanAll` verifying no `skipped` property on result
- Unit tests for `executeBuildAll` verifying no `skipped` property on result
- Verify summary output strings don't contain "skipped"
