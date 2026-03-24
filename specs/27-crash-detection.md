# Crash Detection

## Overview

Detect when a build crashed unexpectedly by checking if the last iteration has `state: "in_progress"`. This allows Toby to know when progress was lost and needs recovery.

## Users & Problem

**Who has the problem:** Developers whose `toby build` sessions crash mid-iteration.

**Why it matters:** Users need to know when their build was interrupted unexpectedly vs stopped intentionally. Crash detection enables the resume feature.

## Scope

### Inclusions
- Detect crash on build startup by checking last iteration state
- Log crash warning to user
- Trigger resume logic after crash detection

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

if (lastIteration && lastIteration.state === "in_progress") {
  // Crash detected — iteration was in progress when session ended
  if (config.verbose) {
    console.log(`Warning: previous build crashed. Last iteration (${lastIteration.iteration}) was in progress.`);
  }
}
```

### Stop Reasons (unchanged)

| Stop Reason | Meaning | Iteration State |
|-------------|---------|-----------------|
| `sentinel` | Agent signaled done | `complete` |
| `max_iterations` | All iterations exhausted | `complete` |
| `error` | Non-zero exit, not retryable | `failed` |
| `aborted` | User pressed Ctrl+C | `failed` |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ executeBuild()                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Read status.json                                  │  │
│  │ Check last iteration state                       │  │
│  │ if state === "in_progress":                     │  │
│  │   → Log crash warning (verbose)                 │  │
│  │   → Proceed with resume logic                   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No prior session | `specEntry` is undefined, no crash check |
| status.json corrupted | Error thrown by `readStatus()` |
| Fresh spec (no iterations) | `lastIteration` undefined, no crash |

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashed last time | Next build starts | Warning logged (if verbose) |
| Build completed normally | Next build starts | No warning |
| User aborted | Next build starts | No warning (state = "failed", not "in_progress") |

## Testing Strategy

1. **Unit tests:** Crash detection logic with various status states
2. **Integration tests:** Kill build, check crash detection on restart
3. **Manual test:** `toby build` → kill -9 → run again → see warning
