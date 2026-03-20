# Loop Engine

## Overview

The loop engine spawns AI CLI sessions via `@0xtiby/spawner`, streams output to the TUI, detects the `:::TOBY_DONE:::` sentinel for early termination, and iterates one-task-per-spawn up to the configured iteration limit.

## Problem & Users

The core of the Ralph loop: spawn an AI CLI, let it do one unit of work (plan or build one task), detect completion, and repeat. The loop engine abstracts this pattern for both the plan and build commands.

## Scope

### In Scope
- Spawn AI CLI via `@0xtiby/spawner`'s `spawn()` function
- Stream events to a callback (for TUI rendering)
- Detect `:::TOBY_DONE:::` sentinel in text events
- Iterate up to N iterations (configurable)
- Stop on sentinel detection (early termination)
- Record each iteration result in status.json
- Always pass `autoApprove: true` to spawner
- Handle `model: "default"` (don't pass model to spawner)
- Support `sessionId` for session continuity between iterations within the same command run

### Out of Scope
- TUI rendering (components spec)
- Prompt loading (template engine spec)
- Command-specific logic (plan/build specs)

## Data Model

```typescript
interface LoopOptions {
  /** Which CLI to spawn */
  cli: CliName;
  /** Model to use, or "default" to omit */
  model: string;
  /** Working directory */
  cwd: string;
  /** Maximum iterations */
  maxIterations: number;
  /** Function that returns the prompt for a given iteration */
  getPrompt: (iteration: number) => string;
  /** Callback for streaming events */
  onEvent: (event: CliEvent) => void;
  /** Callback when an iteration completes */
  onIterationComplete: (result: IterationResult) => void;
  /** Whether to continue session from previous iteration */
  continueSession: boolean;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Verbose mode */
  verbose: boolean;
}

interface IterationResult {
  iteration: number;
  sessionId: string | null;
  exitCode: number;
  tokensUsed: number | null;
  model: string | null;
  durationMs: number;
  /** Whether the sentinel was detected */
  sentinelDetected: boolean;
}

interface LoopResult {
  /** All iteration results */
  iterations: IterationResult[];
  /** Why the loop stopped */
  stopReason: 'sentinel' | 'max_iterations' | 'error' | 'aborted';
  /** Total iterations completed */
  totalIterations: number;
}
```

## API / Interface

```typescript
// src/lib/loop.ts

/** Run the iteration loop */
export function runLoop(options: LoopOptions): Promise<LoopResult>;

/** Check if a text event contains the sentinel */
export function containsSentinel(text: string): boolean;

/** The sentinel string */
export const SENTINEL = ':::TOBY_DONE:::';
```

## Architecture

```
┌──────────────┐
│  Plan/Build  │  (commands)
│   Command    │
└──────┬───────┘
       │ LoopOptions
       ▼
┌──────────────┐     ┌──────────────┐
│  Loop Engine │────▶│   Spawner    │
│  (loop.ts)   │     │  spawn()     │
└──────┬───────┘     └──────┬───────┘
       │                    │
       │ onEvent            │ CliEvent stream
       ▼                    │
┌──────────────┐            │
│  TUI Layer   │◀───────────┘
│  (Ink)       │
└──────────────┘
```

### Loop Flow

```
for iteration = 1 to maxIterations:
  1. Get prompt via getPrompt(iteration)
  2. Spawn CLI with spawner:
     - cli, prompt, cwd, model (if not "default")
     - autoApprove: true
     - sessionId from previous iteration (if continueSession)
  3. Stream events:
     - Forward each event to onEvent callback
     - Scan text events for SENTINEL
  4. Await proc.done
  5. Build IterationResult from CliResult
  6. Call onIterationComplete
  7. If sentinel detected → stop loop (stopReason: 'sentinel')
  8. If error → stop loop (stopReason: 'error')
  9. Continue to next iteration
```

## Business Rules

- **One task per spawn:** The loop spawns one CLI session per iteration. The prompt instructs the AI to do one task and stop.
- **Sentinel detection:** When `:::TOBY_DONE:::` appears anywhere in a text event, the loop stops after that iteration completes. The sentinel means "no more work to do."
- **Auto-approve:** Always `autoApprove: true` — toby is non-interactive by design.
- **Model handling:** If `model` is `"default"`, the `model` field is NOT passed to spawner's `SpawnOptions`. The CLI uses its own default.
- **Session continuity:** When `continueSession` is true, the `sessionId` from iteration N's result is passed to iteration N+1's spawn. This allows the AI to maintain context.
- **Error handling:** If spawner returns a non-zero exit code, check `CliResult.error.retryable`. If retryable (rate limit), wait `retryAfterMs` and retry the same iteration. If not retryable, stop the loop.
- **Cancellation:** If `abortSignal` is aborted, call `proc.interrupt()` and stop the loop.

## Acceptance Criteria

- Given a loop with maxIterations=3, when all 3 complete without sentinel, then stopReason is "max_iterations"
- Given a loop, when iteration 2 outputs `:::TOBY_DONE:::`, then the loop stops after iteration 2 with stopReason "sentinel"
- Given a loop, when the CLI returns a rate limit error, then the loop waits and retries the same iteration
- Given a loop, when the CLI returns a fatal error, then the loop stops with stopReason "error"
- Given `model: "default"`, when spawning, then the model option is omitted from SpawnOptions
- Given `model: "claude-opus-4-6"`, when spawning, then model is passed to SpawnOptions
- Given `continueSession: true`, when iteration 1 returns sessionId "abc", then iteration 2 spawns with sessionId "abc"
- Given each iteration completes, when onIterationComplete is called, then it receives sessionId, exitCode, tokensUsed, and durationMs
- Given `abortSignal` is aborted mid-iteration, then the current process is interrupted and loop stops

## Edge Cases

- Sentinel appears in a tool_result or tool_use event (not text): ignored — only scan text events
- Sentinel appears mid-word (e.g., "abc:::TOBY_DONE:::def"): still detected
- CLI crashes immediately (exit code non-zero, no events): treated as error, loop stops
- `getPrompt` throws: error propagates, loop stops
- Zero iterations configured: loop returns immediately with empty results
- Session continuity with null sessionId: spawn without sessionId (fresh session)

## Testing Strategy

- Unit test: `containsSentinel` detects sentinel in various positions
- Unit test: `containsSentinel` returns false for non-matching text
- Integration test: `runLoop` stops on sentinel
- Integration test: `runLoop` stops at max iterations
- Integration test: `runLoop` handles error stop
- Unit test: Model "default" is omitted from spawn options
- Unit test: Session continuity passes sessionId between iterations
