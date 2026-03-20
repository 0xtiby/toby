# 12 — Decouple PRD from Code

## Overview

Remove all PRD-specific logic from toby's TypeScript codebase. Task tracking (PRD JSON, beads, or any other format) is entirely a prompt-level concern — the AI agent reads/writes whatever format the active prompts define. Toby's code is a pure orchestrator that tracks progress at the **spec level** only (via `status.json`).

## Problem

Toby currently hardcodes PRD JSON as its task tracking system:

- `src/lib/prd.ts` — `getPrdPath()`, `hasPrd()`, `readPrd()`, `getTaskSummary()`
- `src/commands/build.tsx` — calls `hasPrd()` as a build gate, reads PRD post-iteration for completion detection
- `src/commands/plan.tsx` — reads PRD for task count and refinement detection
- `src/commands/status.tsx` — reads PRDs to show task progress (3/5)
- `src/types.ts` — `PrdSchema`, `TaskSchema`, `TaskStatusSchema`, `PRDData`, `Task`, `TaskStatus`
- `src/lib/paths.ts` — `PRD_DIR` constant, `ensureLocalDir()` creates `prd/` subdirectory

This coupling makes it impossible to swap to a different task tracking backend (like beads) without rewriting core code. The prompts are the right place for this concern — not the orchestrator.

## Scope

### In scope

- Delete `src/lib/prd.ts` and `src/lib/prd.test.ts`
- Remove `PrdSchema`, `TaskSchema`, `TaskStatusSchema`, `PRDData`, `Task`, `TaskStatus` from `types.ts`
- Remove `PRD_DIR` from `paths.ts` and `prd/` mkdir from `ensureLocalDir()`
- Remove all PRD imports and calls from `build.tsx`, `plan.tsx`, `status.tsx`
- Replace PRD-based build readiness check with `status.json` check
- Replace PRD-based completion detection with sentinel-only + max iterations
- Replace PRD-based refinement detection with `status.json` check
- Simplify `BuildResult` and `PlanResult` interfaces
- Delete PRD-related test assertions in command tests

### Out of scope

- Changing the shipped prompt files (they still reference PRD — that's fine, it's a prompt concern)
- Changing `status.json` schema
- Adding new tracking backends

## User Stories

- As a user, I can swap my prompts in `.toby/` to use beads (or any tracker) without modifying toby's code, so that toby is a generic orchestrator.
- As a user, I can run `toby build` and it checks `status.json` for readiness instead of looking for a PRD file, so that the build gate works regardless of tracker format.
- As a user, I get a cleaner `BuildResult` that doesn't leak PRD internals (no `taskCount`, `prdPath`, `remainingTasks`).

## Business Rules

- **Build readiness:** `executeBuild()` checks `status.specs[specName].status === 'planned' || 'building'` instead of `hasPrd()`. Error message: "No plan found for X. Run 'toby plan --spec=X' first."
- **Completion detection:** Sentinel (`:::TOBY_DONE:::`) or max iterations. The post-loop PRD read (`readPrd()` → `getTaskSummary()` → `allTasksDone`) is removed entirely.
- **Refinement detection (plan):** `status.specs[specName].status === 'planned'` instead of `hasPrd()`.
- **No PRD-derived data in results:** `BuildResult` loses `taskCount`, `prdPath`, `remainingTasks`. `PlanResult` loses `taskCount`, `prdPath`.

## Data Model

### Deletions

```typescript
// DELETE from types.ts:
export const TaskStatusSchema = z.enum(["pending", "in_progress", "done", "blocked"]);
export const TaskSchema = z.object({ ... });
export const PrdSchema = z.object({ ... });
export type PRDData = z.infer<typeof PrdSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
```

### Simplified interfaces

```typescript
// build.tsx
export interface BuildResult {
  specName: string;
  totalIterations: number;
  totalTokens: number;
  specDone: boolean; // true if sentinel detected
  error?: string;
}

// plan.tsx
export interface PlanResult {
  specName: string;
}
```

### paths.ts changes

```typescript
// DELETE:
export const PRD_DIR = "prd";

// ensureLocalDir() — remove prd/ mkdir:
export function ensureLocalDir(cwd?: string): string {
  const dir = getLocalDir(cwd);
  const statusPath = path.join(dir, STATUS_FILE);

  fs.mkdirSync(dir, { recursive: true });
  // REMOVED: fs.mkdirSync(prdPath, { recursive: true });

  if (!fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, JSON.stringify({ specs: {} }, null, 2) + "\n");
  }

  return dir;
}
```

## Architecture

### Files to delete

| File | Reason |
|------|--------|
| `src/lib/prd.ts` | PRD-specific logic, no longer needed |
| `src/lib/prd.test.ts` | Tests for deleted module |

### Files to modify

| File | Change |
|------|--------|
| `src/types.ts` | Remove PRD/Task types and schemas |
| `src/lib/paths.ts` | Remove `PRD_DIR`, simplify `ensureLocalDir()` |
| `src/commands/build.tsx` | Remove PRD imports, use status.json for gates and completion |
| `src/commands/plan.tsx` | Remove PRD imports, use status.json for refinement detection |
| `src/commands/status.tsx` | Remove PRD imports (detailed view changes in spec 14) |

### build.tsx — key changes

**Build gate (before):**
```typescript
if (!hasPrd(found.name, cwd)) {
  throw new Error(`No plan found for ${found.name}...`);
}
```

**Build gate (after):**
```typescript
const status = readStatus(cwd);
const specEntry = status.specs[found.name];
if (!specEntry || (specEntry.status !== 'planned' && specEntry.status !== 'building')) {
  throw new Error(`No plan found for ${found.name}. Run 'toby plan --spec=${flags.spec}' first.`);
}
```

**Post-loop completion (before):**
```typescript
const prd = readPrd(found.name, cwd);
let allTasksDone = false;
if (prd) {
  const taskSummary = getTaskSummary(prd);
  allTasksDone = taskSummary.done === taskCount && taskCount > 0;
}
const specDone = loopResult.stopReason === "sentinel" || allTasksDone;
```

**Post-loop completion (after):**
```typescript
const specDone = loopResult.stopReason === "sentinel";
```

### plan.tsx — key changes

**Refinement detection (before):**
```typescript
const isRefinement = hasPrd(found.name, cwd);
if (isRefinement) {
  const existingPrd = readPrd(found.name, cwd);
  const taskCount = existingPrd ? ... : 0;
  callbacks.onRefinement?.(found.name, taskCount);
}
```

**Refinement detection (after):**
```typescript
const specEntry = status.specs[found.name];
const isRefinement = specEntry?.status === 'planned';
if (isRefinement) {
  callbacks.onRefinement?.(found.name);
}
```

Note: `onRefinement` callback signature changes — no `taskCount` param.

## Acceptance Criteria

- Given prd.ts is deleted, when I search for `prd` imports across `src/`, then zero results are found
- Given a spec with status `planned` in status.json, when I run `toby build --spec=X`, then it proceeds without checking for a PRD file
- Given a spec with status `pending` in status.json, when I run `toby build --spec=X`, then it errors with "No plan found"
- Given a build loop where the AI outputs `:::TOBY_DONE:::`, when the loop finishes, then `specDone` is `true` without reading any PRD file
- Given a build loop that reaches max iterations without sentinel, when the loop finishes, then `specDone` is `false`
- Given an existing plan (status = `planned`), when I run `toby plan --spec=X`, then refinement mode activates based on status.json, not PRD existence
- Given `PrdSchema`, `TaskSchema`, `TaskStatusSchema` are removed from types.ts, when the project compiles, then there are no type errors
- Given prd.test.ts is deleted, when tests run, then all remaining tests pass

## Testing Strategy

- Unit tests for `executeBuild()`: mock `readStatus()` to return planned/pending status, verify build gate behavior
- Unit tests for `executePlan()`: mock `readStatus()` to return planned status, verify refinement detection
- Integration: `pnpm build` compiles without errors after all PRD references removed
- Verify no `import.*prd` patterns exist in `src/` after changes
