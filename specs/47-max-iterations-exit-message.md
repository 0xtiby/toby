# 47 — Clear Exit Message When Loop Hits Max Iterations

Surface an explicit user-facing warning when a plan or build loop exits because the maximum iteration limit was reached.

## Problem

When a spec build loop exits with `stopReason: "max_iterations"`, the TUI shows misleading or vague messages:

- **Single build:** shows `✓ Build paused for {specName}` — a green checkmark for what's actually a warning. The user sees a success indicator even though the loop exhausted its iteration budget without the sentinel being detected.
- **Multi-spec build (--all):** shows `Session "{name}" interrupted at {specName} (incomplete).` — doesn't mention *why* it stopped (max iterations vs error vs other).
- **Plan commands:** no special handling at all — the user gets a green `✓ Plan complete` even though the plan loop hit its iteration cap.

The user should immediately know the loop was halted by the iteration limit, not that it succeeded or encountered an unknown failure.

**Reference:** [GitHub Issue #34](https://github.com/0xtiby/toby/issues/34)

## Scope

### In scope

- Show a `⚠️` warning message when `stopReason === "max_iterations"` in:
  - Single build mode (`toby build --spec=X`)
  - Multi-spec build mode (`toby build --all` / multi-select)
  - Single plan mode (`toby plan --spec=X`)
  - Multi-spec plan mode (`toby plan --all` / multi-select)
  - Resume command (`toby resume`) — delegates to `executeBuildAll`, so the multi-spec warning applies; the resume "done" summary should also reflect max_iterations per-spec
- Include spec name, iteration count (current/max), and last iteration state in the message
- Replace the misleading green checkmark with a yellow warning for the max_iterations case
- Thread `stopReason` and `maxIterations` through `BuildResult` and `PlanResult` so the TUI can dispatch on it
- Multi-spec --all mode keeps current behavior: stop building remaining specs when max_iterations is hit

### Out of scope

- Changing the loop engine itself (`src/lib/loop.ts`) — it already returns the correct `stopReason`
- Changing `status.json` persistence — `stopReason` is already saved on the spec entry
- Adding retry or auto-increase of iteration limits
- Changing the `onOutput` callback function signature (the message content will change but the `(message: string) => void` contract stays the same)

## Current Behavior

### Single build (`build.tsx:554-568`)

When `max_iterations` is hit: `result.specDone = false`, `result.error = undefined`.

The TUI renders:
```
✓ Build paused for 03-auth-adapter
  Iterations: 10, Tokens: 250000
```

This is the same rendering path as any non-error, non-done build — there's no way to distinguish "max iterations" from other incomplete states.

### Multi-spec build (`build.tsx:424-446`)

When `!result.specDone`, the session is marked interrupted and the message is:
```
Session "auth-build" interrupted at 03-auth-adapter (incomplete).
```

No mention of max iterations.

### Plan commands (`plan.tsx`)

`executePlan` always returns `{ specName }` regardless of `stopReason`. The TUI always renders:
```
✓ Plan complete for 03-auth-adapter
```

Even when the plan loop exhausted all iterations without sentinel detection.

### Resume command (`resume.tsx:143-157`)

Resume delegates to `executeBuildAll`, so the multi-spec `onOutput` message applies. But the resume "done" summary has its own rendering:
```
✓ Resume complete (2 spec(s) built)
  03-auth-adapter: 10 iterations, 250000 tokens
  04-dashboard: 5 iterations, 120000 tokens [done]
```

When a spec hits max_iterations, it shows `specName: N iterations, N tokens` with no `[done]` tag — but also no warning. The user can't tell if the spec ran out of iterations or stopped for another reason.

## Implementation

### 1. Thread `stopReason` and `maxIterations` through result types

`types.ts` already exports `StopReason` via `StopReasonSchema = z.enum(["sentinel", "max_iterations", "error", "aborted"])`. The result types should reuse this. Since `"aborted"` throws `AbortError` before returning a result, only three values reach the result — but use the full `StopReason` type for consistency and let the abort guard upstream enforce the constraint.

**`BuildResult`** (build.tsx) — add `stopReason` and `maxIterations` fields:

```typescript
import type { StopReason } from "../types.js";

export interface BuildResult {
  specName: string;
  totalIterations: number;
  maxIterations: number;
  totalTokens: number;
  specDone: boolean;
  stopReason: StopReason;
  error?: string;
}
```

In `runSpecBuild`, populate from `loopResult.stopReason` and the `iterations` option. The `maxIterations` field comes from the configured iteration count (not `loopResult.iterations.length`, which may exceed the limit if retryable errors caused extra attempts).

**`PlanResult`** (plan.tsx) — add `stopReason` and iteration metadata:

```typescript
import type { StopReason } from "../types.js";

export interface PlanResult {
  specName: string;
  totalIterations: number;
  maxIterations: number;
  stopReason: StopReason;
}
```

In `executePlan`, populate from `loopResult`.

### 2. Build TUI — single mode

Replace the current "done" rendering block for the non-error, non-done case.

**Current** (`build.tsx:554-568`):
```tsx
if (runner.phase === "done" && result) {
  if (result.error) {
    return <Text color="red">{`✗ ${result.error}`}</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text color="green">{`✓ Build ${result.specDone ? "complete" : "paused"} for ${result.specName}`}</Text>
      <Text>{`  Iterations: ${result.totalIterations}, Tokens: ${result.totalTokens}`}</Text>
    </Box>
  );
}
```

**New:**
```tsx
if (runner.phase === "done" && result) {
  if (result.error) {
    return <Text color="red">{`✗ ${result.error}`}</Text>;
  }
  if (result.stopReason === "max_iterations") {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          {`⚠️ Spec "${result.specName}" stopped: maximum iteration limit reached (${result.totalIterations}/${result.maxIterations} iterations). Last build state: failed.`}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color="green">{`✓ Build complete for ${result.specName}`}</Text>
      <Text>{`  Iterations: ${result.totalIterations}, Tokens: ${result.totalTokens}`}</Text>
    </Box>
  );
}
```

Note: `totalIterations` and `maxIterations` are typically equal when `stopReason === "max_iterations"`. However, if retryable errors occurred during the loop, `totalIterations` (from `loopResult.iterations.length`) may exceed `maxIterations` because retries push extra entries without incrementing the iteration counter. Using `maxIterations` as the denominator keeps the message accurate.

### 3. Build TUI — multi-spec mode

In `executeBuildAll`, when `!result.specDone`, improve the `onOutput` messages to include `stopReason`.

**Current** (`build.tsx:436-437`):
```typescript
callbacks.onOutput?.(
  `Session "${sessionObj.name}" interrupted at ${spec.name} (${result.error ? "error" : "incomplete"}).`,
);
```

**New:**
```typescript
const reason = result.stopReason === "max_iterations"
  ? `maximum iteration limit reached (${result.totalIterations} iterations)`
  : result.error ?? "incomplete";
callbacks.onOutput?.(
  `⚠️ Spec "${spec.name}" stopped: ${reason}.`,
);
```

### 4. Plan TUI — single mode

Add a max_iterations branch to the "done" rendering.

**Current** (`plan.tsx:311-316`):
```tsx
if (runner.phase === "done" && result) {
  return (
    <Box flexDirection="column">
      <Text color="green">{`✓ Plan complete for ${result.specName}`}</Text>
    </Box>
  );
}
```

**New:**
```tsx
if (runner.phase === "done" && result) {
  if (result.stopReason === "max_iterations") {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          {`⚠️ Spec "${result.specName}": maximum plan iteration limit reached (${result.totalIterations}/${result.maxIterations} iterations).`}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color="green">{`✓ Plan complete for ${result.specName}`}</Text>
    </Box>
  );
}
```

### 5. Plan — thread metadata through `executePlan`

Update `executePlan` to return iteration metadata:

```typescript
// After the loop completes (after abort check):
const totalIterations = loopResult.iterations.length;

status = updateSpecStatus(status, found.name, "planned");
writeStatus(status, cwd);

return {
  specName: found.name,
  totalIterations,
  maxIterations: commandConfig.iterations,
  stopReason: loopResult.stopReason === "aborted" ? "error" : loopResult.stopReason,
};
```

Note: the "aborted" case throws `AbortError` before reaching the return, so `stopReason` will only be "sentinel", "max_iterations", or "error".

### 6. Plan TUI — multi-spec (--all) mode

`plan.tsx:300-308` renders a summary after all plans complete. Add per-spec warning markers.

**Current:**
```tsx
if (runner.phase === "done" && allResult) {
  return (
    <Box flexDirection="column">
      <Text color="green">{`✓ All specs planned (${allResult.planned.length} planned)`}</Text>
      {allResult.planned.map((r) => (
        <Text key={r.specName}>{`  ${r.specName}`}</Text>
      ))}
    </Box>
  );
}
```

**New:**
```tsx
if (runner.phase === "done" && allResult) {
  const hasWarnings = allResult.planned.some((r) => r.stopReason === "max_iterations");
  return (
    <Box flexDirection="column">
      <Text color={hasWarnings ? "yellow" : "green"}>
        {`${hasWarnings ? "⚠️" : "✓"} All specs planned (${allResult.planned.length} planned)`}
      </Text>
      {allResult.planned.map((r) => (
        <Text key={r.specName} color={r.stopReason === "max_iterations" ? "yellow" : undefined}>
          {r.stopReason === "max_iterations"
            ? `  ⚠️ ${r.specName}: max iteration limit reached (${r.totalIterations}/${r.maxIterations})`
            : `  ${r.specName}`}
        </Text>
      ))}
    </Box>
  );
}
```

### 7. Resume TUI — done summary

`resume.tsx:143-157` renders a per-spec summary after resume completes. Add a warning marker for specs that hit max_iterations.

**Current:**
```tsx
{result.built.map((r) => (
  <Text key={r.specName}>{`  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`}</Text>
))}
```

**New:**
```tsx
{result.built.map((r) => (
  <Text key={r.specName} color={r.stopReason === "max_iterations" ? "yellow" : undefined}>
    {r.stopReason === "max_iterations"
      ? `  ⚠️ ${r.specName}: max iteration limit reached (${r.totalIterations}/${r.maxIterations})`
      : `  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`}
  </Text>
))}
```

## Message Formats

### Build — max iterations
```
⚠️ Spec "03-auth-adapter" stopped: maximum iteration limit reached (12/12 iterations). Last build state: failed.
```

### Build — multi-spec max iterations
```
⚠️ Spec "03-auth-adapter" stopped: maximum iteration limit reached (10 iterations).
Completed: 01-config, 02-models (2/5)
Remaining: 03-auth-adapter, 04-dashboard, 05-api (3/5)
Run 'toby resume' to continue.
```

### Plan — max iterations (single)
```
⚠️ Spec "03-auth-adapter": maximum plan iteration limit reached (2/2 iterations).
```

### Plan — max iterations (--all summary)
```
⚠️ All specs planned (3 planned)
  01-config
  ⚠️ 02-models: max iteration limit reached (2/2)
  03-auth
```

### Resume — max iterations (done summary)
```
✓ Resume complete (2 spec(s) built)
  ⚠️ 03-auth-adapter: max iteration limit reached (10/10)
  04-dashboard: 5 iterations, 120000 tokens [done]
  Total: 15 iterations, 370000 tokens
```

### Existing messages (unchanged)
```
✓ Build complete for 03-auth-adapter          # sentinel detected
✗ Build failed after 5 iteration(s)...        # error
⚠ Building interrupted for 03-auth-adapter    # Ctrl+C abort
```

## Edge Cases

- **Max iterations = 1:** Message shows `(1/1 iterations)` — still clear
- **Resume after max_iterations:** User runs `toby resume` — spec is still in "building" status, so it picks up where it left off with a fresh iteration budget. The resume TUI should show the max_iterations warning for the spec that triggered the interruption.
- **Retryable errors inflate `totalIterations`:** If a retryable error causes extra loop iterations (same iteration number retried), `loopResult.iterations.length` exceeds `maxIterations`. The message correctly shows e.g. `(12/10 iterations)`, which signals retries occurred.
- **All iterations succeed (exit code 0) but no sentinel:** This is the most common max_iterations scenario. The last iteration state is "failed" (because sentinel was not detected), which is correct.
- **Last iteration has non-zero exit code:** Covered by the "error" stopReason path, not max_iterations.
- **Plan with 0 iterations configured:** `runLoop` returns `max_iterations` immediately with 0 iterations. Message shows `(0/0 iterations)`.

## Acceptance Criteria

- Given a build that exhausts all iterations without sentinel detection, when the TUI renders the final state, then it shows `⚠️ Spec "{name}" stopped: maximum iteration limit reached ({n}/{max} iterations). Last build state: failed.` in yellow text
- Given the same scenario, then the green `✓` checkmark is NOT shown
- Given a multi-spec build where one spec hits max_iterations, when the session is interrupted, then the output message includes "maximum iteration limit reached" instead of just "incomplete"
- Given a plan that exhausts all iterations without sentinel detection, when the TUI renders the final state, then it shows `⚠️ Spec "{name}": maximum plan iteration limit reached ({n}/{max} iterations).` in yellow text
- Given the same scenario, then the green `✓ Plan complete` is NOT shown
- Given a plan --all where one spec hits max_iterations, when the summary renders, then that spec's line shows `⚠️ {name}: max iteration limit reached` in yellow and the header uses `⚠️` instead of `✓`
- Given a resume where one spec hits max_iterations, when the done summary renders, then that spec's line shows `⚠️ {name}: max iteration limit reached` in yellow
- Given a build that completes with sentinel detection, then the existing `✓ Build complete` message is shown unchanged
- Given a build that fails with a non-zero exit code, then the existing `✗ Build failed` message is shown unchanged
- Given a Ctrl+C abort, then the existing `⚠ Building interrupted` message is shown unchanged

## Testing Strategy

### Existing tests that need updating

The following existing tests use `stopReason: "max_iterations"` and will break because the rendered output changes:

- `src/commands/build.test.tsx` — "completion summary shows iterations and tokens" (line ~569): currently asserts `expect(output).toContain("Iterations: 1")` with `stopReason: "max_iterations"`. Must update to assert the new `⚠️` warning message instead, and `BuildResult` mock must include the new `maxIterations` field.
- `src/commands/plan.test.tsx` — tests using `stopReason: "max_iterations"` that assert `✓ Plan complete` will need updating to assert the `⚠️` warning.

### New unit tests

TUI rendering tests (in `src/commands/build.test.tsx`, `src/commands/plan.test.tsx`, `src/commands/resume.test.tsx`):

- Mock `executeBuild` to return `{ stopReason: "max_iterations", totalIterations: 10, maxIterations: 10, specDone: false }` and verify the rendered output contains `⚠️` and "maximum iteration limit reached" in yellow
- Mock with `stopReason: "sentinel"` and verify the green checkmark is shown
- Mock with `stopReason: "error"` and verify the red error message is shown
- For plan --all: mock `executePlanAll` to return results where one spec has `stopReason: "max_iterations"` and verify per-spec warning in summary
- For resume: mock `executeResume` to return results where one spec has `stopReason: "max_iterations"` and verify per-spec warning in done summary

### Integration tests

For `runSpecBuild` / `executePlan` (in existing test files):

- Given `maxIterations: 1` and a spawner mock that never emits sentinel, verify `result.stopReason === "max_iterations"`
- Verify `result.maxIterations` equals the configured iteration count
- Verify `result.totalIterations` equals `loopResult.iterations.length`
- Verify `result.specDone === false` when stopReason is max_iterations
