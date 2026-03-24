# Crash Detection

## Overview

Detect when a build was interrupted unexpectedly by checking if the last iteration has `state: "in_progress"`. This covers hard crashes (kill -9), context/token limit exits, and any scenario where `onIterationComplete` never fired.

## Users & Problem

**Who has the problem:** Developers whose `toby build` sessions are interrupted — by crashes, CLI context limits, OOM, or terminal closure.

**Why it matters:** Users need to know when their build was interrupted unexpectedly vs stopped intentionally. Crash detection enables the resume feature (spec 28) by distinguishing recoverable interruptions from clean exits.

## Scope

### Inclusions
- Detect crash on build startup by checking last iteration state
- Detect crash for both single-spec and `--all` mode
- Log crash warning to user (always, not just verbose)
- Pass crash context to resume logic (spec 28)

### Exclusions
- No new `stopReason` needed (crash is detected via state, not stopReason)
- No `detectCrash()` function (inline check in build.tsx)
- No `onCrashDetected` callback

## Business Rules

### Crash Detection Logic

In `executeBuild()`, before starting a new session:

```typescript
const specEntry = status.specs[specName];
const lastIteration = specEntry?.iterations.at(-1);
const isCrashResume = lastIteration?.state === "in_progress";

if (isCrashResume) {
  // Always warn — crash recovery is important enough to show without --verbose
  callbacks.onOutput?.(
    `⚠ Previous build interrupted (iteration ${lastIteration.iteration} was in progress). Resuming...`
  );
}
```

**Why always show the warning:** Unlike debug info, a crash recovery is a significant event that changes behavior (session reuse, iteration counting). The user should know this is happening.

### What counts as a crash

Any scenario where `onIterationStart` wrote an `in_progress` record but `onIterationComplete` never fired:

| Scenario | Last iteration state | Detected as crash? |
|----------|--------------------|--------------------|
| Process killed (kill -9) | `in_progress` | Yes |
| CLI hit context/token limit | `in_progress` | Yes |
| OOM kill | `in_progress` | Yes |
| Terminal closed | `in_progress` | Yes |
| User Ctrl+C (clean abort) | `failed` | No — clean exit |
| CLI error (non-zero exit) | `failed` | No — handled |
| Sentinel detected | `complete` | No — success |

### Stop Reasons vs Iteration State

| Stop Reason | Meaning | Iteration State |
|-------------|---------|-----------------|
| `sentinel` | Agent signaled done | `complete` |
| `max_iterations` | All iterations exhausted without sentinel | `failed` |
| `error` | Non-zero exit, not retryable | `failed` |
| `aborted` | User pressed Ctrl+C | `failed` |
| *(crash)* | Process died before callback | `in_progress` (unchanged) |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ executeBuild()                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Read status.json                                  │  │
│  │ Check last iteration state                       │  │
│  │ if state === "in_progress":                     │  │
│  │   → isCrashResume = true                        │  │
│  │   → Log warning to user (always)                │  │
│  │   → Pass isCrashResume to resume logic (spec 28)│  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### `executeBuildAll` handling

For `--all` mode, crash detection runs per-spec inside the loop:

```typescript
for (const spec of specsToRun) {
  const specEntry = status.specs[spec.name];
  const lastIteration = specEntry?.iterations.at(-1);
  const isCrashResume = lastIteration?.state === "in_progress";
  // ... pass to runSpecBuild
}
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No prior session | `specEntry` is undefined → `isCrashResume = false` |
| status.json corrupted | Error thrown by `readStatus()` (existing behavior) |
| Fresh spec (no iterations) | `lastIteration` undefined → `isCrashResume = false` |
| Multiple in_progress iterations | Only last matters — earlier ones are from previous crashes that were already resumed |
| Spec status is "done" but last iteration is in_progress | Shouldn't happen, but if it does, don't crash-resume a done spec |

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashed last time (last state = in_progress) | Next build starts | Warning logged, `isCrashResume = true` passed to resume logic |
| Build completed normally (last state = complete) | Next build starts | No warning, `isCrashResume = false` |
| User aborted cleanly (last state = failed) | Next build starts | No warning, `isCrashResume = false` |
| CLI hit context limit (last state = in_progress) | Next build starts | Warning logged, `isCrashResume = true` |
| Spec status is "done" | Next build starts | No crash detection (spec already complete) |

## Testing Strategy

1. **Unit tests:** `isCrashResume = true` when last iteration state is `"in_progress"`
2. **Unit tests:** `isCrashResume = false` when last iteration state is `"complete"` or `"failed"`
3. **Unit tests:** `isCrashResume = false` when no iterations exist
4. **Unit tests:** Warning message output when crash detected
5. **Unit tests:** `executeBuildAll` detects crash per-spec independently
6. **Integration tests:** Write `in_progress` to status.json, start build, verify warning
