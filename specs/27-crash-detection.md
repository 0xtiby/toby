# Crash Detection

## Overview

Detect when a build session crashed unexpectedly vs was intentionally stopped. Uses iteration state tracking to identify in-progress iterations that never completed.

## Users & Problem

**Who has the problem:** Developers running `toby build` sessions.

**Why it matters:** Without crash detection, Toby can't distinguish between "user aborted" and "agent crashed". This affects both the user experience (knowing what happened) and the resume logic (knowing if progress was lost).

## Scope

### Inclusions
- Track `state` field on each iteration: `in_progress | complete | failed`
- Detect crash when iteration has `state: "in_progress"` on next run
- Differentiate `stopReason` in LoopResult

### Exclusions
- No automatic recovery from crashes (just detection)
- No timeout-based crash detection
- No network failure detection

## Business Rules

### Crash Detection Logic

An iteration is considered **crashed** when:
1. On next `toby build` run, the last iteration for a spec has `state: "in_progress"`
2. This means the previous session exited without marking the iteration complete

### Stop Reasons (existing + new)

| Stop Reason | Meaning | Iteration State |
|-------------|---------|-----------------|
| `sentinel` | Agent signaled done | `complete` |
| `max_iterations` | All iterations exhausted | `complete` |
| `error` | Non-zero exit, not retryable | `failed` |
| `aborted` | User pressed Ctrl+C | `failed` |
| `crashed` | (NEW) Process died unexpectedly | N/A |

## Data Model

```typescript
// src/lib/loop.ts

export type StopReason = "sentinel" | "max_iterations" | "error" | "aborted" | "crashed";

export interface LoopResult {
  iterations: IterationResult[];
  stopReason: StopReason;
}
```

### State Transitions

```
┌─────────────┐     iteration starts     ┌──────────────┐
│   (none)    │ ─────────────────────────► │ in_progress  │
└─────────────┘                           └──────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
           ┌──────────────┐            ┌──────────────┐            ┌──────────────┐
           │   complete   │            │    failed    │            │    failed    │
           │ (sentinel or │            │   (error)    │            │   (abort)    │
           │ max_iter)    │            └──────────────┘            └──────────────┘
           └──────────────┘
```

## API / Interface

### Crash Detection (`src/lib/loop.ts`)

```typescript
export function detectCrash(lastIteration: Iteration | undefined): boolean {
  if (!lastIteration) return false;
  return lastIteration.state === "in_progress";
}
```

### Modified runLoop Signature

```typescript
export interface LoopOptions {
  maxIterations: number;
  getPrompt: (iteration: number) => string;
  cli: "claude" | "codex" | "opencode";
  model?: string;
  cwd: string;
  autoApprove?: boolean;
  sessionId?: string;
  continueSession?: boolean;
  onEvent?: (event: CliEvent) => void;
  onIterationComplete?: (result: IterationResult) => void;
  onCrashDetected?: () => void;  // NEW: callback when crash detected
  abortSignal?: AbortSignal;
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ executeBuild()                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Check existing iterations in status.json         │  │
│  │ If last iteration.state === "in_progress":       │  │
│  │   → crash detected                               │  │
│  │   → Log warning                                  │  │
│  │   → Proceed with resume logic                    │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ runLoop() executes                               │  │
│  │ - onIterationStart: mark "in_progress"           │  │
│  │ - onIterationComplete: mark "complete/failed"    │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Crash mid-write to status.json | Accept corrupted file, user must manually fix |
| Session from different project | Ignore, treat as no prior session |
| status.json missing | Return default empty status |

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashes mid-iteration | Next build starts | Crash warning logged |
| Build completes normally | Iteration finishes | State = "complete" |
| User presses Ctrl+C | Process receives signal | State = "failed", stopReason = "aborted" |
| Build exits with error code | CLI returns non-zero | State = "failed", stopReason = "error" |
| Crash detected | Resume logic triggers | User informed via verbose output |

## Testing Strategy

1. **Unit tests:** `detectCrash()` with various iteration states
2. **Integration tests:** Kill build process, check crash detection triggers
3. **Manual test:** Kill -9 during iteration, verify next run shows crash warning
