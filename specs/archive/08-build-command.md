# Build Command

## Overview

The `toby build` command iterates through prd.json tasks one-per-spawn, letting the AI implement each task, validate, and commit. It supports single-spec and `--all` modes with ordered spec processing.

## Problem & Users

After planning produces a prd.json, users need to execute the tasks. The build command runs the loop engine, spawning the AI CLI once per task. The AI reads prd.json, picks the next ready task, implements it, and stops. The loop then re-spawns for the next task.

## Scope

### In Scope
- `toby build` — interactive spec selection from planned specs, then build
- `toby build --spec=<name>` — build a specific planned spec
- `toby build --all` — build all planned specs in order
- `--iterations=<n>` — override max iteration count
- `--verbose` — show full CLI output
- `--cli=<name>` — override CLI selection
- One task per spawn (AI implements one task, commits, stops)
- Status tracking per iteration with session IDs
- TUI with progress display

### Out of Scope
- Writing the prompt content (spec 10)
- Task selection logic (AI reads prd.json and picks)
- Git worktree management (prompt-driven)
- PR creation (prompt-driven)

## User Stories

- As a developer, I can run `toby build` and select a planned spec to start building
- As a developer, I can run `toby build --spec=auth` to build a specific spec
- As a developer, I can run `toby build --all` to build all planned specs sequentially
- As a developer, I can see which task was completed after each iteration

## UI/UX Flows

### Build Flow

```
$ toby build --spec=auth

  toby v0.1.0

  Building: 01-auth (iteration 1/10)
  Tasks: 0/8 done
  ─────────────────────────────────────
  [streaming CLI output...]

  ✓ Iteration 1 complete
    Task: task-001 "Add user schema"
    Session: abc-123
    Tokens: 42,000

  Building: 01-auth (iteration 2/10)
  Tasks: 1/8 done
  ─────────────────────────────────────
  [streaming CLI output...]

  ...

  ✓ Build complete for 01-auth
    All 8 tasks done
    Total iterations: 8
    Total tokens: 280,000
```

### Build --all Flow

```
$ toby build --all

  toby v0.1.0

  Building all planned specs:
    1. 01-auth (8 tasks)
    2. 02-payments (5 tasks)

  Building: 01-auth (iteration 1/10)
  ─────────────────────────────────────
  [streaming CLI output...]

  ...

  ✓ Build complete for 01-auth (8/8 tasks)

  Building: 02-payments (iteration 1/10)
  ─────────────────────────────────────
  [streaming CLI output...]

  ...

  ✓ Build complete for 02-payments (5/5 tasks)

  All specs built successfully!
```

## Business Rules

- **One task per spawn:** Each iteration spawns a fresh CLI session. The prompt instructs the AI to read prd.json, find the next ready task (no blocking dependencies, status=pending), implement it, update prd.json status to done, commit, and stop.
- **Session continuity:** Within a single spec's build, sessions are NOT continued between iterations (each gets a fresh context). The AI reads prd.json each time to understand current state.
- **Iteration counting:** Iterations count up from 1 for each spec. Status.json tracks the actual iteration number.
- **Sentinel detection:** `:::TOBY_DONE:::` means the AI has determined there are no more ready tasks. This stops the loop.
- **Normal completion:** When the AI completes a task and stops without sentinel, the loop spawns the next iteration.
- **--all mode:**
  - Process specs in NN- filename order
  - Each spec gets its own iteration counter (resets to 1)
  - When a spec completes (sentinel or all tasks done), move to the next spec
  - Use `PROMPT_BUILD_ALL.md` instead of `PROMPT_BUILD.md`
  - `IS_LAST_SPEC` is "true" for the final spec, "false" for others
- **Spec must be planned:** Build requires prd.json to exist. If no prd.json, show error suggesting `toby plan` first.
- **Status updates:** After each iteration, record in status.json. When all tasks are done, update spec status to `done`.
- **Template variables:** SPEC_NAME, ITERATION, PRD_PATH, SPEC_CONTENT, BRANCH, WORKTREE, EPIC_NAME, IS_LAST_SPEC all populated.

## Architecture

```
toby build --spec=auth
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  build.tsx   │────▶│  loop engine  │
│  (command)   │     │  runLoop()    │
└──────────────┘     └──────────────┘
       │                    │
       │ reads              │ spawns
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│  config.ts   │     │   spawner    │
│  specs.ts    │     └──────────────┘
│  template.ts │            │
│  prd.ts      │            │ AI reads & updates
│  status.ts   │            ▼
└──────────────┘     ┌──────────────┐
                     │  prd.json    │
                     │  (on disk)   │
                     └──────────────┘
```

## Acceptance Criteria

- Given a spec without prd.json, when running build, then error: "No plan found for 01-auth. Run 'toby plan --spec=auth' first."
- Given a planned spec with 3 tasks, when building, then up to 3 iterations run (one per task)
- Given the AI outputs `:::TOBY_DONE:::` after completing all tasks, then the build stops early
- Given max iterations reached before all tasks complete, then the build stops with a message showing remaining tasks
- Given `--all` flag with 2 planned specs, then they are built in NN- order
- Given `--all` mode, when the first spec completes, then the second spec starts immediately
- Given `--all` mode on the last spec, when building, then IS_LAST_SPEC is "true"
- Given each iteration completes, when checking status.json, then iteration with sessionId, tokens, and taskCompleted is recorded
- Given all tasks done for a spec, when checking status, then spec status is `done`
- Given `--iterations=3`, when running, then max 3 iterations execute (overriding config default of 10)
- Given `--verbose`, when running, then all events (including tool calls) are displayed

## Edge Cases

- No planned specs exist: show error "No planned specs found. Run 'toby plan' first."
- prd.json exists but has 0 tasks: AI will output sentinel immediately (nothing to do)
- All tasks already done in prd.json: AI will output sentinel immediately
- AI fails to update prd.json task status: toby doesn't validate this — next iteration the AI will re-read and handle it
- Network error during iteration: loop engine handles retry for rate limits, stops for fatal errors
- User runs build on a spec already being built (status=building): allowed — continues where left off

## Testing Strategy

- Unit test: Build command shows error when prd.json missing
- Unit test: Build command shows spec selector for planned specs only
- Unit test: Build --all processes specs in order
- Unit test: IS_LAST_SPEC set correctly in --all mode
- Unit test: Status updated after each iteration
- Integration test: Full build flow with mocked spawner
