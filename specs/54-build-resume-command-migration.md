# 54 — Build & Resume Command Migration

## Overview

Replace the Ink `Build` and `Resume` components with imperative async functions. Both commands share `executeBuild`/`executeBuildAll` logic and follow the same pattern as the plan migration: @clack/prompts for spec selection, ora for progress, chalk for streaming output.

## Problem

The build and resume commands use the same `useCommandRunner` React hook with 8+ phases, multiple `useEffect` hooks, and Ink rendering. Resume is essentially "resolve session specs → call executeBuildAll", making it a thin wrapper. Both need the same migration treatment as plan.

## Scope

### In scope
- Replace `Build` component with `runBuild()` async function
- Replace `Resume` component with `runResume()` async function
- Multi-spec selection via @clack/multiselect
- Event streaming via stdout writes
- SIGINT handling with session state persistence
- Session lifecycle: create, track, interrupt, clear
- Non-TTY support with `--all` or `--spec` flags

### Out of scope
- Changes to `executeBuild()`, `executeBuildAll()`, `runSpecBuild()` pure logic
- Changes to session model or status tracking
- Changes to sentinel detection or loop engine

## User Stories

### Build
- As a user, I can run `toby build` to select specs and build them iteratively.
- As a user, I can run `toby build --all` to build all planned specs.
- As a user, I can run `toby build --spec 01-auth` to build a specific spec.
- As a user, I see real-time streaming events and iteration progress during build.
- As a user, I can Ctrl+C to interrupt and resume later.

### Resume
- As a user, I can run `toby resume` to pick up where an interrupted build left off.
- As a user, I see which specs were in the interrupted session and their status.
- As a user, I get a clear message if there's no session to resume.

## Business Rules

### Build
- Spec selection: `--all` builds all planned/building specs. `--spec` builds named spec(s). No flag → multiselect (TTY only).
- Specs must be planned before building (status "planned" or "building"). Error if "pending".
- Specs with status "done" are silently skipped in `--all` mode. Error if explicitly named.
- Session created on first iteration of multi-spec build.
- Session state set to "active" during build, "interrupted" on Ctrl+C.
- Session cleared on successful completion of all specs.
- Sentinel detection (`:::TOBY_DONE:::`) stops loop early for a spec.
- Per-spec: show iteration count, token usage on completion.
- Multi-spec: show overall progress `[N/M]`.

### Resume
- Requires a resumable session (active or interrupted state in status.json).
- Filters out specs that are already "done".
- Skips specs that no longer exist in specs/ (with warning).
- If all session specs are done: "All specs in this session are already done."
- If all session specs are missing: "All session specs are missing from specs/."
- Delegates to `executeBuildAll()` with session spec list.

## UI/UX Flow

### Build (TTY, multi-spec)
```
◆ Select specs to build
│ ■ 01-auth [planned]
│ ■ 02-database [planned]
│ □ 03-api [building]
└

◇ Building 01-auth (1/2)
  Iteration 1/10
  Reading spec file...
  ⚙ write_file src/auth/middleware.ts
  ↳ Created JWT middleware
  :::TOBY_DONE:::
✔ 01-auth done (1 iteration, 8,200 tokens) — sentinel

◇ Building 02-database (2/2)
  Iteration 1/10
  Setting up migrations...
  Iteration 2/10
  Running tests...
✔ 02-database done (2 iterations, 15,300 tokens)

✔ All specs built. Session cleared.
```

### Resume
```
$ toby resume
◇ Resuming session "bold-tiger-42"
  Specs: 01-auth (done), 02-database (building), 03-api (planned)
  Skipping 01-auth (already done)

◇ Building 02-database (1/2)
  ...
✔ All remaining specs built. Session cleared.
```

### Interrupt
```
◇ Building 02-database (2/3)
  Iteration 3/10
  Writing migration files...
^C
⚠ Interrupted: 02-database
  Completed 3/10 iterations
  Session saved. Resume with: toby resume
```

### Non-TTY
```
$ toby build --all
Building 01-auth [1/3]... done (1 iter, sentinel)
Building 02-database [2/3]... done (2 iter)
Building 03-api [3/3]... done (4 iter)
All specs built.
```

## Data Model

Existing types reused as-is:
- `CommandFlags`: `{ spec?, all, iterations?, verbose, transcript?, cli?, session? }`
- `BuildCallbacks`: `{ onPhase?, onIteration?, onEvent?, onOutput? }`
- `BuildAllCallbacks`: `{ onSpecStart?, onSpecComplete?, onPhase?, onIteration?, onEvent?, onOutput? }`
- `BuildResult`: `{ specName, totalIterations, maxIterations, totalTokens, specDone, stopReason, error? }`
- `BuildAllResult`: `{ built: BuildResult[] }`

## API / Interface

```typescript
// src/commands/build.ts
export async function runBuild(ctx: CommandContext): Promise<void>;

// src/commands/resume.ts
export async function runResume(ctx: CommandContext): Promise<void>;

// The existing executeBuild() and executeBuildAll() signatures are PRESERVED:
//   executeBuild(flags, callbacks, cwd, abortSignal, externalWriter) → BuildResult
//   executeBuildAll(flags, callbacks, cwd, abortSignal, specs?) → BuildAllResult
//   runSpecBuild(options) → { result, status }
//   resolveResumeSessionId(specEntry, currentCli, sessionCli) → string | undefined
//
// runBuild() follows the same pattern as runPlan():
// 1. Build CommandFlags from ctx
// 2. Resolve specs (--all, --spec, or multiselect prompt)
// 3. Wire BuildAllCallbacks to ui/ helpers
// 4. Call executeBuildAll()
// 5. Print results

// runResume() is thin:
async function runResume(ctx: CommandContext): Promise<void> {
  const cwd = process.cwd();
  const status = readStatus(cwd);
  if (!hasResumableSession(status)) {
    console.log("No active session to resume.");
    return;
  }
  const session = status.session!;
  console.log(chalk.dim(`◇ Resuming session "${session.name}"`));
  // Filter done/missing specs, build CommandFlags, delegate to executeBuildAll
}
```

## Architecture

```
src/commands/build.ts   ← replaces build.tsx
                           executeBuild(), executeBuildAll(), runSpecBuild() stay (pure logic)
src/commands/resume.ts  ← replaces resume.tsx
```
File deletions tracked in spec 48. Component replacements (ui/) defined in spec 48.

### SIGINT handling
Same pattern as spec 53 (plan): `process.on("SIGINT")` → `abortController.abort()`, cleanup in `finally`.
Status is already saved per-iteration by `executeBuild` internals — SIGINT just triggers the abort signal.

## Edge Cases

- Build with no planned specs: "No specs ready to build. Run `toby plan` first."
- Build spec that is "pending": "Spec '01-auth' has not been planned yet. Run `toby plan --spec 01-auth` first."
- Resume with no session: "No active session to resume." (exit 0)
- Resume where all specs done: "All specs in this session are already done." (exit 0, clear session)
- Resume where specs deleted from disk: skip with warning "⚠ Spec '05-deleted' no longer exists, skipping."
- Ctrl+C during multiselect: clean exit.
- Ctrl+C during build iteration: abort signal propagated, iteration finishes current step, status saved as interrupted.
- Double Ctrl+C (force kill): process exits, status.json reflects last saved state.
- Rate limit during build: `runLoop` retry logic handles this (unchanged).

## Acceptance Criteria

- Given `--all`, when user runs `toby build --all`, then all planned specs are built sequentially.
- Given TTY and no flags, when user runs `toby build`, then multiselect prompt shows planned/building specs.
- Given Ctrl+C during build, then status is saved as interrupted and session persists for resume.
- Given interrupted session, when user runs `toby resume`, then build continues from where it stopped.
- Given sentinel detected in output, then spec is marked done and loop stops for that spec.
- Given all session specs complete, then session is cleared from status.json.
- Given non-TTY and no flags, when user runs `toby build`, then error suggests `--all` or `--spec`.
- Given spec is "pending", when user runs `toby build --spec pending-one`, then error says to plan first.

## Testing Strategy

- Unit test `runResume` with mock status containing various session states.
- Integration test build flow with mock spawner (existing pattern).
- Test SIGINT by sending signal and verifying status.json state.
