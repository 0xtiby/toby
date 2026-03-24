# Session State Persistence

## Overview

Save build session state to `.toby/status.json` so it survives process crashes. When a session is interrupted (crash, abort, error), the progress is persisted so it can be resumed later.

## Users & Problem

**Who has the problem:** Developers running long `toby build` sessions.

**Why it matters:** Without session persistence, a crash mid-iteration loses all progress for that iteration. The user must restart from the beginning of the task, wasting time and potentially money.

## Scope

### Inclusions
- Save `sessionName` and `sessionId` to status.json on every iteration completion
- Save session state on normal iteration completion
- Save session state on error/abort before process exits
- Verbose CLI output about session saves

### Exclusions
- No manual save command (automatic only)
- No cross-machine resume (local only)
- No cloud sync
- Keep only the last session (no history)

### Constraints
- Must work with existing Zod schemas in `src/types.ts`
- Must be backwards compatible with existing status.json format
- Atomic writes not required — accept potential corruption, user fixes manually

## User Stories

| As a | I can | So that |
|------|-------|---------|
| Developer | Have my build session automatically saved | I don't lose progress if the process crashes |
| Developer | Resume a build from where it left off | I don't redo completed work |
| Developer | See session save info with --verbose | I know what's being persisted |

## Business Rules

### Save Triggers
1. **On iteration complete:** After each iteration finishes successfully (sentinel detected or max iterations reached), save session state
2. **On error/abort:** Before the process exits with non-sentinel stop reason, save session state

### Storage Location
- Session state stored in `.toby/status.json` (existing file)
- Data persisted using `writeStatus()` from `src/lib/status.ts`

### Session Identification
- `sessionName`: Worktree name, used for cross-CLI resume context (e.g., "feature-auth")
- `sessionId`: CLI-specific session identifier (not shared across claude/codex/opencode)

## Data Model

```typescript
// src/types.ts

// Add to IterationSchema
export const IterationStateSchema = z.enum(["in_progress", "complete", "failed"]);
export type IterationState = z.infer<typeof IterationStateSchema>;

// Extend IterationSchema
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

// Add session tracking to StatusData
export const StatusSchema = z.object({
  specs: z.record(z.string(), SpecStatusEntrySchema),
  sessionName: z.string().nullable().optional(),  // NEW: current session name
  sessionId: z.string().nullable().optional(),    // NEW: current session id
});
```

### State Transitions

```
Iteration States:
  in_progress → complete (sentinel detected or max_iterations)
  in_progress → failed (error exit or abort)
```

## API / Interface

### Status Read/Write (`src/lib/status.ts`)

```typescript
// Existing functions modified:
export function readStatus(cwd?: string): StatusData
export function writeStatus(status: StatusData, cwd?: string): void

// New function:
export function updateSessionInfo(
  status: StatusData,
  sessionName: string,
  sessionId: string
): StatusData
```

### Loop Integration (`src/lib/loop.ts`)

```typescript
// NEW callback for iteration start
export type OnIterationStart = (iteration: number) => void;

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

export interface LoopOptions {
  // ... existing fields ...
  onIterationStart?: OnIterationStart;  // NEW
  onIterationComplete?: (result: IterationResult) => void;
}
```

**State marking flow:**
1. Before spawning CLI for iteration: `onIterationStart?.(iteration)` → caller sets state to "in_progress"
2. After iteration completes: `onIterationComplete?.(result)` with state "complete" or "failed"

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ runLoop()                                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Iteration starts                                 │  │
│  │ - Mark iteration state = "in_progress"           │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Iteration completes (onIterationComplete callback)│  │
│  │ - Mark iteration state = "complete" or "failed"   │  │
│  │ - writeStatus() persists to .toby/status.json    │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Security Considerations

- Session data is local file only, no transmission
- No secrets stored in session state
- Input validation via Zod schemas

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Iteration starts | `onIterationStart` called | Iteration state marked "in_progress" in status.json |
| Build is running | Iteration completes | Session state saved with "complete" state |
| Build crashes mid-iteration | Process exits | Iteration remains "in_progress" (crash detection) |
| Build is aborted (Ctrl+C) | Process exits | Iteration state saved with "failed" state |
| `toby build --verbose` | Session saved | "Session saved: {sessionName}" output |
| Build crashes | Next build with same session | Resume from last saved position |

## Testing Strategy

1. **Unit tests:** `writeStatus()` correctly persists session fields
2. **Integration tests:** Kill process mid-iteration, verify status.json has partial iteration with "in_progress" state
3. **Manual test:** `toby build --spec=foo` → kill -9 → run again → verify resume
