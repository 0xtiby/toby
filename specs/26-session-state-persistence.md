# Session State Persistence

## Overview

Track iteration completion state and session metadata so crash detection and resume work correctly. State is persisted to `.toby/status.json` after each iteration.

## Users & Problem

**Who has the problem:** Developers running long `toby build` sessions.

**Why it matters:** Without iteration state tracking, Toby can't detect when a crash mid-iteration left the last iteration incomplete.

## Scope

### Inclusions
- Add `state` field to each iteration: `in_progress | complete | failed`
- Track `sessionName` and `lastCli` at the status file root (not per-spec)
- Save state on every iteration completion

### Exclusions
- No `onIterationStart` callback (state is set in `onIterationComplete`)
- No separate session tracking file (use status.json)

## Business Rules

### State Marking
- On `onIterationComplete` callback: set state based on stop reason
  - `sentinel` or `max_iterations` → `complete`
  - `error` or `aborted` → `failed`
- Before persisting: set state to `in_progress` initially; if crash happens before callback fires, state remains `in_progress`

### Storage Location
- `.toby/status.json` — existing file
- Uses existing `writeStatus()` from `src/lib/status.ts`

## Data Model

```typescript
// src/types.ts

// New: IterationState enum
export const IterationStateSchema = z.enum(["in_progress", "complete", "failed"]);
export type IterationState = z.infer<typeof IterationStateSchema>;

// Extended: IterationSchema gets state field
export const IterationSchema = z.object({
  type: z.enum(["plan", "build"]),
  iteration: z.number().int().positive(),
  sessionId: z.string().nullable(),
  state: IterationStateSchema.default("in_progress"),  // NEW
  cli: z.string(),
  model: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
  taskCompleted: z.string().nullable(),
  tokensUsed: z.number().int().nullable(),
});

// Extended: StatusSchema gets session-level tracking
export const StatusSchema = z.object({
  specs: z.record(z.string(), SpecStatusEntrySchema),
  sessionName: z.string().nullable().optional(),  // NEW: current session name
  lastCli: z.string().nullable().optional(),       // NEW: last CLI used
});
```

## State Transitions

```
in_progress → complete (sentinel detected or max_iterations reached)
in_progress → failed (error exit or abort signal)
```

## API Changes

### IterationResult (`src/lib/loop.ts`)

```typescript
export interface IterationResult {
  iteration: number;
  sessionId: string | null;
  exitCode: number;
  tokensUsed: number | null;
  model: string | null;
  durationMs: number;
  sentinelDetected: boolean;
  state: IterationState;  // NEW
}
```

### State Setting Flow (`src/commands/build.tsx`)

```typescript
onIterationComplete: (iterResult: IterationResult) => {
  // Determine state based on iteration outcome
  let state: IterationState = "in_progress";
  if (iterResult.sentinelDetected) {
    state = "complete";
  } else if (iterResult.exitCode !== 0) {
    state = "failed";
  }
  // ... rest of iteration creation
};
```

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Iteration completes with sentinel | `onIterationComplete` fires | state = "complete" |
| Iteration completes with error | `onIterationComplete` fires | state = "failed" |
| Build is aborted | Process exits | state = "failed" |
| Build crashes (kill -9) | Next build starts | Last iteration state = "in_progress" |
| `toby build --verbose` | Iteration completes | Verbose output shows state |

## Testing Strategy

1. **Unit tests:** `writeStatus()` persists iteration with correct state
2. **Integration tests:** Kill process mid-iteration, verify status.json has "in_progress" state
3. **Manual test:** `toby build --spec=foo` → kill -9 → verify status.json
