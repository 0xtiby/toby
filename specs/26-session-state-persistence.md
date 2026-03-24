# Session State Persistence

## Overview

Track iteration completion state and session metadata so crash detection and resume work correctly. State is persisted to `.toby/status.json` before and after each iteration.

## Users & Problem

**Who has the problem:** Developers running long `toby build` sessions.

**Why it matters:** Without iteration state tracking, Toby can't detect when a crash mid-iteration left the last iteration incomplete. This is critical for resume: if the CLI hits a context limit or the process is killed, the `in_progress` marker tells the next run that recovery is needed.

## Scope

### Inclusions
- Add `state` field to each iteration: `in_progress | complete | failed`
- Write `in_progress` record **before** spawning the CLI via `onIterationStart` callback
- Update state to `complete` or `failed` in `onIterationComplete`
- Track `sessionName` and `lastCli` at the status file root (not per-spec)
- Save state on every iteration start and completion

### Exclusions
- No separate session tracking file (use status.json)

## Business Rules

### Two-Phase State Persistence

Iteration state is written **twice** per iteration to guarantee crash detection:

1. **Before CLI spawn** (`onIterationStart`): Write iteration record with `state: "in_progress"`, `completedAt: null`, `exitCode: null`, `tokensUsed: null`. If the process crashes before `onIterationComplete` fires, this record survives in status.json.

2. **After CLI completes** (`onIterationComplete`): Update the same iteration record with final state, completedAt, exitCode, tokensUsed.

### State Marking
- On `onIterationStart`: set `state: "in_progress"`
- On `onIterationComplete`: set state based on outcome:
  - `sentinelDetected` → `complete`
  - `exitCode === 0` (max_iterations reached, no sentinel) → `failed` (agent didn't finish the task)
  - `exitCode !== 0` (error, context limit, abort) → `failed`

**Note:** `max_iterations` without sentinel means the agent exhausted its retries without signaling completion — this is a failure, not success.

### Session-Level Tracking
- `sessionName`: The session identifier (e.g., "warm-lynx-52") used by the CLI to name worktrees and branches. Persisted so resume can reuse the same worktree.
- `lastCli`: The CLI used in the most recent build (e.g., "claude", "opencode"). Persisted so resume knows whether to continue the session or start a new one in the same worktree.

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
(new iteration) → in_progress  (onIterationStart — written before CLI spawn)
in_progress → complete          (sentinel detected)
in_progress → failed            (error exit, abort, context limit, or max_iterations exhausted)
```

## API Changes

### New: `onIterationStart` callback in `runLoop` (`src/lib/loop.ts`)

```typescript
interface LoopOptions {
  // ... existing fields ...
  onIterationStart?: (iteration: number, sessionId: string | null) => void;  // NEW
  onIterationComplete?: (result: IterationResult) => void;
}
```

Called **before** spawning the CLI process for each iteration. This is where the `in_progress` record is written to status.json.

### IterationResult (`src/lib/loop.ts`)

No change needed — `state` is determined by the caller based on `sentinelDetected` and `exitCode`.

### Start Flow (`src/commands/build.tsx`)

```typescript
onIterationStart: (iteration: number, sessionId: string | null) => {
  const iterationRecord: Iteration = {
    type: "build",
    iteration: existingIterations + iteration,
    sessionId,
    state: "in_progress",
    cli: commandConfig.cli,
    model: commandConfig.model ?? "default",
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    taskCompleted: null,
    tokensUsed: null,
  };
  status = addIteration(status, spec.name, iterationRecord);
  status = { ...status, sessionName: session, lastCli: commandConfig.cli };
  writeStatus(status, cwd);
},
```

### Complete Flow (`src/commands/build.tsx`)

```typescript
onIterationComplete: (iterResult: IterationResult) => {
  // Determine final state
  let state: IterationState;
  if (iterResult.sentinelDetected) {
    state = "complete";
  } else {
    state = "failed";
  }

  // Update the last iteration record (written by onIterationStart)
  const specEntry = status.specs[spec.name];
  const iterations = [...specEntry.iterations];
  iterations[iterations.length - 1] = {
    ...iterations[iterations.length - 1],
    state,
    sessionId: iterResult.sessionId,
    completedAt: new Date().toISOString(),
    exitCode: iterResult.exitCode,
    tokensUsed: iterResult.tokensUsed,
  };
  status = {
    ...status,
    specs: {
      ...status.specs,
      [spec.name]: { ...specEntry, iterations },
    },
  };
  writeStatus(status, cwd);
},
```

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Iteration is about to start | `onIterationStart` fires | status.json has iteration with `state: "in_progress"`, null completedAt/exitCode |
| Iteration completes with sentinel | `onIterationComplete` fires | state updated to `"complete"` |
| Iteration completes with error | `onIterationComplete` fires | state updated to `"failed"` |
| Iteration exhausts max_iterations | `onIterationComplete` fires | state = `"failed"` (agent didn't finish) |
| Build is aborted (Ctrl+C) | Process exits | state updated to `"failed"` |
| Build crashes (kill -9, context limit) | Next build starts | Last iteration state = `"in_progress"` (onIterationComplete never fired) |
| Build runs | After any iteration | `sessionName` and `lastCli` persisted in status.json |

## Testing Strategy

1. **Unit tests:** `onIterationStart` writes `in_progress` record with null completedAt/exitCode/tokensUsed
2. **Unit tests:** `onIterationComplete` updates last iteration with final state, completedAt, exitCode
3. **Unit tests:** `max_iterations` without sentinel → state = `"failed"`
4. **Unit tests:** `sessionName` and `lastCli` persisted after iteration
5. **Integration tests:** Kill process mid-iteration, verify status.json has `"in_progress"` state
6. **Manual test:** `toby build --spec=foo` → kill -9 → verify status.json
