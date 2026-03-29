# 53 — Plan Command Migration

## Overview

Replace the Ink `Plan` component and `useCommandRunner` hook with an imperative async function. Use @clack/prompts for spec selection, ora for progress spinners, and chalk + `process.stdout.write` for streaming event output.

## Problem

The current plan command uses a React component with an 8-phase state machine (`useCommandRunner`), multiple `useEffect` hooks for phase transitions, and Ink components for display. This complexity is unnecessary — planning is a linear workflow: select specs → run loop → show results. The React lifecycle adds no value and causes the non-TTY issues in #32.

## Scope

### In scope
- Replace `Plan` component with `runPlan()` async function
- Replace `useCommandRunner` state machine with procedural flow
- Replace `MultiSpecSelector` with @clack/multiselect
- Replace `LoadingSpinner` with ora
- Replace `StreamOutput` with direct stdout writes
- Preserve `executePlan()` and `executePlanAll()` pure logic functions
- SIGINT handling via AbortController + process signal listener
- Non-TTY support with `--all` or `--spec` flags

### Out of scope
- Changes to plan execution logic (`executePlan`, `executePlanAll`)
- Changes to status tracking or template resolution
- Changes to loop engine

## User Stories

- As a user, I can run `toby plan` and select specs from a multi-select prompt.
- As a user, I can run `toby plan --all` to plan all pending specs without prompts.
- As a user, I can run `toby plan --spec 01-auth` to plan a specific spec.
- As a user, I see real-time streaming events during planning.
- As a user, I can press Ctrl+C to interrupt and see a summary of what was completed.
- As a CI script, I can run `toby plan --all` in non-TTY with plain text output.

## Business Rules

- Spec selection: `--all` plans all pending specs in NN- order. `--spec` plans named spec(s). No flag → prompt multiselect (TTY only).
- Refinement mode: if spec is already "planned", loop runs as refinement (existing behavior in `executePlan`).
- "No pending specs": print friendly message and exit 0 (not an error — fixes part of #32).
- Events are written to stdout as they arrive, one line per event.
- Verbose mode shows all event types; non-verbose shows only text events.
- Transcript recording unchanged (uses `withTranscript` from lib).

## UI/UX Flow

### Multi-spec selection (TTY, no flags)
```
◆ Select specs to plan
│ ■ 01-auth [pending]
│ □ 02-database [planned]
│ ■ 03-api [pending]
└

◇ Planning 01-auth (1/2)
  Setting up authentication module
  ⚙ read_file src/auth.ts
  ↳ Found existing scaffolding
  Creating JWT middleware...
✔ 01-auth planned (3 iterations, 12,450 tokens)

◇ Planning 03-api (2/2)
  Designing REST endpoints...
✔ 03-api planned (2 iterations, 8,200 tokens)

✔ All specs planned
```

### Single spec
```
$ toby plan --spec 01-auth
◇ Planning 01-auth...
  Setting up authentication module
  ...
✔ 01-auth planned (3 iterations, 12,450 tokens)
```

### Non-TTY
```
$ toby plan --all
Planning 01-auth... done (3 iterations)
Planning 03-api... done (2 iterations)
All specs planned.
```

### Interrupt
```
$ toby plan --all
◇ Planning 01-auth (1/3)
  Setting up authentication...
^C
⚠ Interrupted: 01-auth
  Completed 2/5 iterations
```

## Data Model

No changes to types. The `useCommandRunner` hook's phase state machine is replaced by sequential control flow.

Existing types reused as-is:
- `CommandFlags` (from useCommandRunner.ts → move to types.ts or inline): `{ spec?, all, iterations?, verbose, transcript?, cli?, session? }`
- `PlanCallbacks`: `{ onPhase?, onIteration?, onEvent?, onRefinement? }`
- `PlanAllCallbacks`: `{ onSpecStart?, onSpecComplete?, onPhase?, onIteration?, onEvent?, onRefinement? }`
- `PlanResult`: `{ specName, totalIterations, maxIterations, stopReason }`
- `PlanAllResult`: `{ planned: PlanResult[] }`

## API / Interface

```typescript
// src/commands/plan.ts
export async function runPlan(ctx: CommandContext): Promise<void>;

// The existing executePlan() and executePlanAll() signatures are PRESERVED:
//   executePlan(flags, callbacks, cwd, abortSignal, externalWriter) → PlanResult
//   executePlanAll(flags, callbacks, cwd, abortSignal, specs?) → PlanAllResult
//
// runPlan() is a thin CLI wrapper that:
// 1. Builds CommandFlags from ctx
// 2. Resolves specs (from flags or @clack/multiselect prompt)
// 3. Wires callbacks to ui/ helpers (writeEvent, spinner, etc.)
// 4. Calls executePlan/executePlanAll
// 5. Prints results

async function runPlan(ctx: CommandContext): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const allSpecs = discoverSpecs(cwd, config);
  const flags: CommandFlags = {
    spec: ctx.spec,
    all: ctx.all ?? false,
    iterations: ctx.iterations,
    verbose: ctx.verbose ?? config.verbose,
    transcript: ctx.transcript,
    cli: ctx.cli,
  };

  // --all or --spec → use executePlanAll/executePlan directly
  // No flag + TTY → prompt with selectSpecs() from ui/prompt.ts
  // No flag + non-TTY → error via requireTTY()

  const callbacks: PlanAllCallbacks = {
    onEvent: (event) => writeEvent(event, flags.verbose),
    onSpecStart: (name, i, total) => console.log(chalk.dim(`◇ Planning ${name} (${i+1}/${total})`)),
    onSpecComplete: (result) => console.log(chalk.green(`✔ ${result.specName} planned (${result.totalIterations} iterations)`)),
    onIteration: (current, max) => { /* update spinner text */ },
  };

  const result = await executePlanAll(flags, callbacks, cwd, abortController.signal, selected);
  printSummary(result);
}
```

## Architecture

```
src/commands/plan.ts            ← replaces plan.tsx
                                   executePlan() and executePlanAll() stay in this file (pure logic, no Ink)
src/hooks/useCommandRunner.ts   ← DELETE (logic inlined as async flow)
                                   CommandFlags type moves to src/types.ts
```
File deletions for components (MultiSpecSelector, StreamOutput, LoadingSpinner) are tracked in spec 48.
Their replacements (ui/stream.ts, ui/prompt.ts, ui/spinner.ts) are defined in spec 48.

### Event streaming
Uses `writeEvent()` from `src/ui/stream.ts` (spec 48). The `CliEvent` type comes from `@0xtiby/spawner`.

### Spec resolution
Uses `selectSpecs()` from `src/ui/prompt.ts` (spec 48). Calls `requireTTY()` before prompting.

### SIGINT handling
```typescript
const abortController = new AbortController();
const onSigint = () => abortController.abort();
process.on("SIGINT", onSigint);
try {
  const result = await executePlanAll(flags, callbacks, cwd, abortController.signal, selected);
} finally {
  process.off("SIGINT", onSigint);
}
```

## Edge Cases

- No specs found in specs directory: print "No specs found." and exit 0.
- No pending specs (all planned/done): print "All specs have been planned." and exit 0 (not an error).
- `--spec` with unknown name: error with "Spec 'X' not found. Available: ..." and list specs.
- `--spec` with comma-separated names: plan multiple specific specs (existing `findSpecs` behavior).
- Ctrl+C during planning: abort current loop iteration, save status as interrupted, print summary.
- Ctrl+C during multiselect prompt: clack cancel, exit cleanly.
- Rate limit error during loop: retry logic in `runLoop` handles this (unchanged).

## Acceptance Criteria

- Given TTY and no flags, when user runs `toby plan`, then @clack/multiselect shows specs with status badges.
- Given `--all`, when user runs `toby plan --all`, then all pending specs are planned sequentially with no prompts.
- Given `--spec 01-auth`, when user runs `toby plan --spec 01-auth`, then only that spec is planned.
- Given planning is in progress, when events arrive, then each event is printed to stdout immediately (no buffering/redrawing).
- Given `--verbose`, when user runs `toby plan --verbose --all`, then tool_use, tool_result, and system events are also shown.
- Given non-TTY and no flags, when user runs `toby plan`, then error suggests `--all` or `--spec`.
- Given Ctrl+C during execution, when signal fires, then current iteration is aborted, status saved, summary printed.
- Given no pending specs, when user runs `toby plan --all`, then "All specs have been planned." is printed (no stack trace).
