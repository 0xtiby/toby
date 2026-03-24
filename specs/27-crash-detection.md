# Crash & Exhaustion Detection

## Overview

Detect when a build needs resuming by checking two conditions: (1) the last iteration has `state: "in_progress"` (hard crash), or (2) the spec's `stopReason` is `"max_iterations"` (agent ran out of iterations without completing). Both cases mean work exists in the worktree that should be continued, not abandoned.

## Users & Problem

**Who has the problem:** Developers whose `toby build` sessions are interrupted — by crashes, CLI context limits, OOM, terminal closure, or iteration threshold exhaustion.

**Why it matters:** Users need to know when their build needs resuming. Both crashes and iteration exhaustion leave incomplete work in the worktree. Detection enables the resume feature (spec 28) by distinguishing resumable states from truly clean exits (sentinel) or user aborts.

## Scope

### Inclusions
- Detect crash on build startup by checking last iteration state (`in_progress`)
- Detect exhaustion on build startup by checking `stopReason === "max_iterations"`
- Detect both for single-spec and `--all` mode
- Log appropriate warning to user (always, not just verbose)
- Pass resume context to resume logic (spec 28)

### Exclusions
- No `detectCrash()` function (inline check in build.tsx)
- No `onCrashDetected` callback

## Business Rules

### Resume Detection Logic

In `executeBuild()`, before starting a new session:

```typescript
const specEntry = status.specs[specName];
const lastIteration = specEntry?.iterations.at(-1);
const isCrashResume = lastIteration?.state === "in_progress";
const isExhaustedResume = specEntry?.stopReason === "max_iterations";
const needsResume = isCrashResume || isExhaustedResume;

if (isCrashResume) {
  callbacks.onOutput?.(
    `⚠ Previous build interrupted (iteration ${lastIteration.iteration} was in progress). Resuming...`
  );
} else if (isExhaustedResume) {
  callbacks.onOutput?.(
    `⚠ Previous build exhausted iterations without completing. Resuming in same worktree...`
  );
}
```

**Why always show the warning:** Unlike debug info, resume is a significant event that changes behavior (worktree reuse, iteration counting). The user should know this is happening.

### What triggers resume

Two distinct scenarios trigger resume, each detected differently:

#### Crash Resume (hard interruption)
Any scenario where `onIterationStart` wrote an `in_progress` record but `onIterationComplete` never fired:

| Scenario | Last iteration state | Detected as crash? |
|----------|--------------------|--------------------|
| Process killed (kill -9) | `in_progress` | Yes |
| CLI hit context/token limit | `in_progress` | Yes |
| OOM kill | `in_progress` | Yes |
| Terminal closed | `in_progress` | Yes |

#### Exhaustion Resume (iteration threshold reached)
The loop completed all iterations without the agent signaling done:

| Scenario | stopReason | Detected as exhaustion? |
|----------|-----------|------------------------|
| Max iterations reached, no sentinel | `max_iterations` | Yes |

#### Not resumable

| Scenario | Why not resumable |
|----------|------------------|
| User Ctrl+C (clean abort) | Intentional stop — `stopReason: "aborted"` |
| CLI error (non-zero exit) | Error state — `stopReason: "error"` |
| Sentinel detected | Task complete — `stopReason: "sentinel"` |

### Stop Reasons vs Iteration State vs Resume

| Stop Reason | Meaning | Last Iteration State | Needs Resume? |
|-------------|---------|---------------------|---------------|
| `sentinel` | Agent signaled done | `complete` | No |
| `max_iterations` | Iterations exhausted without sentinel | `failed` | **Yes** |
| `error` | Non-zero exit, not retryable | `failed` | No |
| `aborted` | User pressed Ctrl+C | `failed` | No |
| *(crash)* | Process died before callback | `in_progress` (unchanged) | **Yes** |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ executeBuild()                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Read status.json                                        │  │
│  │ Check last iteration state + stopReason                │  │
│  │                                                         │  │
│  │ if state === "in_progress":                            │  │
│  │   → isCrashResume = true                               │  │
│  │   → Log: "Previous build interrupted..."               │  │
│  │                                                         │  │
│  │ else if stopReason === "max_iterations":               │  │
│  │   → isExhaustedResume = true                           │  │
│  │   → Log: "Previous build exhausted iterations..."      │  │
│  │                                                         │  │
│  │ needsResume = isCrashResume || isExhaustedResume       │  │
│  │ → Pass needsResume to resume logic (spec 28)           │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### `executeBuildAll` handling

For `--all` mode, resume detection runs per-spec inside the loop:

```typescript
for (const spec of specsToRun) {
  const specEntry = status.specs[spec.name];
  const lastIteration = specEntry?.iterations.at(-1);
  const isCrashResume = lastIteration?.state === "in_progress";
  const isExhaustedResume = specEntry?.stopReason === "max_iterations";
  const needsResume = isCrashResume || isExhaustedResume;
  // ... pass needsResume to runSpecBuild
}
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No prior session | `specEntry` is undefined → `needsResume = false` |
| status.json corrupted | Error thrown by `readStatus()` (existing behavior) |
| Fresh spec (no iterations) | `lastIteration` undefined → `needsResume = false` |
| Multiple in_progress iterations | Only last matters — earlier ones are from previous crashes that were already resumed |
| Spec status is "done" but last iteration is in_progress | Shouldn't happen, but if it does, don't resume a done spec |
| stopReason is max_iterations but spec is "done" | Don't resume — spec was marked done externally |
| Both crash and exhaustion true | Crash takes priority (in_progress means the exhaustion stopReason is stale from a prior run) |

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashed last time (last state = in_progress) | Next build starts | Warning logged, `needsResume = true` (crash) |
| Build exhausted iterations (stopReason = max_iterations) | Next build starts | Warning logged, `needsResume = true` (exhaustion) |
| Build completed normally (stopReason = sentinel) | Next build starts | No warning, `needsResume = false` |
| User aborted cleanly (stopReason = aborted) | Next build starts | No warning, `needsResume = false` |
| CLI hit context limit (last state = in_progress) | Next build starts | Warning logged, `needsResume = true` (crash) |
| Spec status is "done" | Next build starts | No resume detection (spec already complete) |

## Testing Strategy

1. **Unit tests:** `isCrashResume = true` when last iteration state is `"in_progress"`
2. **Unit tests:** `isExhaustedResume = true` when `stopReason === "max_iterations"`
3. **Unit tests:** `needsResume = false` when `stopReason` is `"sentinel"`, `"error"`, or `"aborted"`
4. **Unit tests:** `needsResume = false` when no iterations exist
5. **Unit tests:** Crash warning message when crash detected
6. **Unit tests:** Exhaustion warning message when max_iterations detected
7. **Unit tests:** `executeBuildAll` detects resume per-spec independently
8. **Integration tests:** Write `in_progress` to status.json, start build, verify warning
9. **Integration tests:** Write `stopReason: "max_iterations"` to status.json, start build, verify warning
