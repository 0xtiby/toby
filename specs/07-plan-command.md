# Plan Command

## Overview

The `toby plan` command selects specs, runs planning iterations via the loop engine, and produces `prd.json` files containing tasks for the build phase. It supports single-spec and `--all` modes.

## Problem & Users

Users have written spec markdown files and need to break them into actionable tasks. The plan command spawns an AI CLI that reads the spec, explores the codebase, and creates a structured `prd.json` with ordered, dependent tasks.

## Scope

### In Scope
- `toby plan` — interactive spec selection, then plan
- `toby plan --spec=<name>` — plan a specific spec
- `toby plan --all` — plan all pending specs in order
- `--iterations=<n>` — override iteration count
- `--verbose` — show full CLI output
- `--cli=<name>` — override CLI selection
- Auto-detect existing prd.json and switch to refinement mode
- Update status.json after each iteration
- TUI with spec selection and streaming output

### Out of Scope
- Writing the prompt content (spec 10)
- The prd.json schema itself (spec 04)
- Loop engine internals (spec 06)

## User Stories

- As a developer, I can run `toby plan` and select a spec from a list so that I don't have to remember filenames
- As a developer, I can run `toby plan --spec=auth` to plan a specific spec without interactive selection
- As a developer, I can run `toby plan --all` to plan all pending specs sequentially
- As a developer, I can re-run `toby plan --spec=auth` on an already-planned spec to refine the prd.json

## UI/UX Flows

### Interactive Selection Flow

```
$ toby plan

  toby v0.1.0

  Select a spec to plan:
  > 01-auth.md          (pending)
    02-payments.md      (pending)
    03-notifications.md (planned)

  Planning: 01-auth.md (iteration 1/2)
  ─────────────────────────────────────
  [streaming CLI output...]

  Planning: 01-auth.md (iteration 2/2)
  ─────────────────────────────────────
  [streaming CLI output...]

  ✓ Plan complete for 01-auth
    Tasks created: 8
    PRD: .toby/prd/01-auth.json
```

### Refinement Detection

```
$ toby plan --spec=auth

  toby v0.1.0

  Existing plan found for 01-auth (8 tasks)
  Running in refinement mode...

  Planning: 01-auth.md (iteration 1/2, refinement)
  ─────────────────────────────────────
  [streaming CLI output...]
```

## Business Rules

- **Spec selection:** In interactive mode, show all discovered specs with their status. User picks one.
- **Refinement mode:** If `prd.json` already exists for the spec, the prompt template receives `{{ITERATION}}` starting from the next number (e.g., if 2 plan iterations exist in status, start at 3). The prompt itself should instruct the AI to refine rather than recreate.
- **Status updates:** After each iteration, add an iteration entry to status.json. After all iterations complete, update spec status to `planned`.
- **--all mode:** Process specs in filename order (NN- prefix). Skip specs that are already `planned` or later status. Stop if any spec's planning fails.
- **Verbose mode:** When verbose is false (default), only show text events. When verbose is true, show all events including tool calls.
- **Template variables:** Pass all template vars to the prompt (SPEC_NAME, ITERATION, SPEC_CONTENT, PRD_PATH, etc.). BRANCH, WORKTREE, IS_LAST_SPEC are empty strings for plan (they're build-specific).

## Architecture

```
toby plan --spec=auth
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  plan.tsx    │────▶│  loop engine  │
│  (command)   │     │  runLoop()    │
└──────────────┘     └──────────────┘
       │                    │
       │ reads              │ spawns
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│  config.ts   │     │   spawner    │
│  specs.ts    │     └──────────────┘
│  template.ts │            │
│  status.ts   │            │ AI writes
└──────────────┘            ▼
                     ┌──────────────┐
                     │  prd.json    │
                     │  (on disk)   │
                     └──────────────┘
```

## Acceptance Criteria

- Given no specs exist, when running `toby plan`, then an error message is shown: "No specs found in specs/"
- Given 3 specs exist, when running `toby plan`, then an interactive selector is shown with all 3
- Given `--spec=auth`, when running, then the spec is found and planning starts without selection UI
- Given `--spec=nonexistent`, when running, then an error is shown: "Spec 'nonexistent' not found"
- Given planning completes successfully, when checking `.toby/prd/01-auth.json`, then the file exists
- Given planning completes, when checking `.toby/status.json`, then the spec has plan iterations recorded
- Given planning completes, when checking status, then spec status is `planned`
- Given `--all` flag, when running, then all pending specs are planned in NN- order
- Given a spec already has prd.json, when re-running plan, then refinement mode is indicated in output
- Given `--iterations=5`, when running, then up to 5 iterations are executed (overriding config default)
- Given the AI outputs `:::TOBY_DONE:::`, when detected, then planning stops early

## Edge Cases

- No specs in directory: show error, exit 1
- Spec file is empty: still pass to AI — the prompt includes SPEC_CONTENT which will be empty
- AI doesn't create prd.json: planning "succeeds" (iterations complete) but status shows planned with no prd file — `toby status` can show this
- AI creates invalid prd.json: toby validates on read during build phase, not during plan
- User cancels during planning (Ctrl+C): current process is interrupted, partial status is saved

## Testing Strategy

- Unit test: Plan command renders spec selector when no --spec flag
- Unit test: Plan command skips selector with --spec flag
- Unit test: Refinement mode detected when prd.json exists
- Unit test: Status updated after planning completes
- Integration test: Full plan flow with mocked spawner
