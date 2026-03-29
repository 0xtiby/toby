# 57 — Detailed Token & Cost Tracking

## Overview

Capture and display the full token breakdown (input, output, total) and cost from spawner results. Currently toby only extracts `totalTokens` from spawner's `TokenUsage` and discards `inputTokens`, `outputTokens`, and `cost`. This spec adds those fields to the data model and surfaces them across all display surfaces for cost monitoring.

## Users & Problem

**Primary user:** Developer running toby to orchestrate AI coding agents.

**Problem:** Without per-iteration cost and token breakdown, users cannot monitor spending or understand agent behavior (e.g., how much of the token budget is input context vs. output generation). The spawner already provides this data — toby just ignores it.

## Scope

### In scope
- Add `inputTokens`, `outputTokens`, and `cost` to the `Iteration` data model
- Pass these fields through from spawner results in the loop engine
- Display token breakdown (input, output, total) and cost in all existing display surfaces:
  - Overview table (`toby status`)
  - Detail table (`toby status --spec=X`)
  - Build/plan completion summaries
  - Banner / project stats
- Backwards-compatible with existing `status.json` files (new fields default to `null`)

### Out of scope
- Cost estimation or budgeting features
- Cost alerts or thresholds
- Per-model cost rate configuration
- Aggregated cost reporting across projects

## User Stories

1. **As a developer**, I can see per-iteration input/output token counts and cost in `toby status --spec=X` so that I understand how each iteration consumed tokens.
2. **As a developer**, I can see aggregated input/output tokens and total cost per spec in `toby status` so that I can compare spending across specs.
3. **As a developer**, I can see total cost in build/plan completion summaries so that I know what a run cost immediately.
4. **As a developer**, I can resume a project with old `status.json` data (missing new fields) without errors.

## Business Rules

- Cost is reported in USD, 2 decimal places (e.g., `$0.42`).
- When cost is `null` (adapter doesn't provide it, e.g., Codex), display `—`.
- When token fields are `null`, display `—`.
- Cost and token fields are nullable at every level — never assume they exist.
- `totalTokens` (existing `tokensUsed`) remains the canonical "total" — it is **not** recomputed from `inputTokens + outputTokens` since the spawner already provides it.
- Aggregation (sums across iterations) treats `null` as `0`.

## Data Model

### IterationSchema (`src/types.ts`)

Add three new nullable fields to `IterationSchema`:

```typescript
export const IterationSchema = z.object({
  type: z.enum(["plan", "build"]),
  iteration: z.number().int().positive(),
  sessionId: z.string().nullable(),
  state: IterationStateSchema.default("in_progress"),
  cli: z.string(),
  model: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
  taskCompleted: z.string().nullable(),
  tokensUsed: z.number().int().nullable(),
  inputTokens: z.number().int().nullable().default(null),   // NEW
  outputTokens: z.number().int().nullable().default(null),  // NEW
  cost: z.number().nullable().default(null),                 // NEW (USD)
});
```

Use `.default(null)` so existing `status.json` files missing these fields parse without error.

### IterationResult (`src/lib/loop.ts`)

```typescript
export interface IterationResult {
  iteration: number;
  sessionId: string | null;
  exitCode: number;
  tokensUsed: number | null;
  inputTokens: number | null;    // NEW
  outputTokens: number | null;   // NEW
  cost: number | null;           // NEW
  model: string | null;
  durationMs: number;
  sentinelDetected: boolean;
}
```

Extraction from spawner result:

```typescript
const iterResult: IterationResult = {
  // ... existing fields ...
  tokensUsed: cliResult.usage?.totalTokens ?? null,
  inputTokens: cliResult.usage?.inputTokens ?? null,    // NEW
  outputTokens: cliResult.usage?.outputTokens ?? null,  // NEW
  cost: cliResult.usage?.cost ?? null,                   // NEW
  // ...
};
```

### ProjectStats (`src/lib/stats.ts`)

```typescript
export interface ProjectStats {
  totalSpecs: number;
  pending: number;
  planned: number;
  building: number;
  done: number;
  totalIterations: number;
  totalTokens: number;
  totalInputTokens: number;   // NEW
  totalOutputTokens: number;  // NEW
  totalCost: number;          // NEW
}
```

Aggregation logic:

```typescript
for (const iter of entry.iterations) {
  totalTokens += iter.tokensUsed ?? 0;
  totalInputTokens += iter.inputTokens ?? 0;     // NEW
  totalOutputTokens += iter.outputTokens ?? 0;   // NEW
  totalCost += iter.cost ?? 0;                    // NEW
}
```

### BuildResult (`src/commands/build.ts`)

```typescript
export interface BuildResult {
  specName: string;
  totalIterations: number;
  maxIterations: number;
  totalTokens: number;
  totalCost: number;      // NEW
  specDone: boolean;
  stopReason: StopReason;
  error?: string;
}
```

Aggregation:

```typescript
const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
const totalCost = loopResult.iterations.reduce((sum, r) => sum + (r.cost ?? 0), 0);  // NEW
```

## Display Changes

### Formatting utilities (`src/ui/format.ts`)

Add cost formatter:

```typescript
export function formatCost(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}
```

All token columns (Input, Output, Tokens) must use the existing `formatTokens()` helper (which uses `Intl.NumberFormat` for comma-separated display). This applies to both overview and detail tables.

### Overview table — `formatStatusTable`

Add `inputTokens`, `outputTokens`, and `cost` columns:

```
 Spec     │ Status  │ Iter │ Input  │ Output │ Tokens │ Cost
 01-auth  │ done    │ 3    │ 8,200  │ 4,100  │ 12,300 │ $0.42
 02-api   │ building│ 1    │ 2,000  │ 800    │ 2,800  │ —
```

Row type becomes:

```typescript
{ name: string; status: string; iterations: number; inputTokens: number; outputTokens: number; tokens: number; cost: number | null }
```

### Detail table — `formatDetailTable`

Add `inputTokens`, `outputTokens`, and `cost` columns per iteration:

```
 # │ Type  │ CLI    │ Input │ Output │ Tokens │ Cost  │ Duration │ Exit
 1 │ build │ claude │ 2,800 │ 1,200  │ 4,000  │ $0.15 │ 2m 30s   │ 0
 2 │ build │ claude │ 3,100 │ 1,400  │ 4,500  │ $0.18 │ 3m 10s   │ 0
```

Summary at bottom:

```
Iterations: 2
Input tokens: 5,900
Output tokens: 2,600
Tokens used: 8,500
Cost: $0.33
```

### Banner (`src/ui/format.ts` — `banner()`)

Add cost to the stats line:

```
Specs: 5 · Planned: 3 · Done: 2 · Tokens: 45,000 · Cost: $1.84
```

Only show cost segment when `totalCost > 0`.

### Welcome command (`src/commands/welcome.ts`)

The welcome screen calls `computeProjectStats()` and passes the result to `banner()`. No code changes needed in `welcome.ts` itself — the banner change propagates automatically. However, `welcome.test.ts` mocks `ProjectStats` and must be updated to include the new fields (`totalInputTokens`, `totalOutputTokens`, `totalCost`).

### Status command totals (`src/commands/status.ts`)

```
Total: 5 specs · 12 iterations · 45,000 tokens · $1.84
```

Only include cost when `totalCost > 0`.

### Build summaries (`src/commands/build.ts`)

Single spec:
```
✔ Build complete for 01-auth
  Iterations: 3, Tokens: 12,345, Cost: $0.42
```

Build-all per-spec line:
```
  01-auth: 3 iterations, 12,345 tokens, $0.42 [done]
```

Build-all total:
```
  Total: 8 iterations, 45,000 tokens, $1.84
```

Only include cost when > 0.

### Resume summaries (`src/commands/resume.ts`)

Same pattern as build summaries — add cost to per-spec and total lines.

### Plan summaries (`src/commands/plan.ts`)

Extend `PlanResult` with token/cost fields:

```typescript
export interface PlanResult {
  specName: string;
  totalIterations: number;
  maxIterations: number;
  totalTokens: number;    // NEW
  totalCost: number;      // NEW
  stopReason: StopReason;
}
```

Aggregate from loop iterations (same pattern as build):

```typescript
const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
const totalCost = loopResult.iterations.reduce((sum, r) => sum + (r.cost ?? 0), 0);
```

Single plan summary:
```
✔ Plan complete for 01-auth (2 iterations, 8,500 tokens, $0.33)
```

Plan-all per-spec line:
```
  ✔ 01-auth planned (2 iterations, 8,500 tokens, $0.33)
```

Plan-all total (add to `printAllSummary`):
```
  Total: 6 iterations, 25,000 tokens, $1.10
```

Only include cost when > 0.

## Iteration record wiring

### `build.ts` — `onIterationStart` callback

The initial in-progress iteration record sets all new fields to `null`:

```typescript
const iterationRecord: Iteration = {
  // ... existing fields ...
  tokensUsed: null,
  inputTokens: null,      // NEW
  outputTokens: null,     // NEW
  cost: null,             // NEW
};
```

### `build.ts` — `onIterationComplete` callback

Spread from `IterationResult`:

```typescript
iters[iters.length - 1] = {
  ...iters[iters.length - 1],
  // ... existing fields ...
  tokensUsed: iterResult.tokensUsed,
  inputTokens: iterResult.inputTokens,      // NEW
  outputTokens: iterResult.outputTokens,    // NEW
  cost: iterResult.cost,                     // NEW
};
```

### `plan.ts` — `onIterationComplete` callback

Note: Unlike `build.ts`, `plan.ts` creates the full `Iteration` record in a single step inside `onIterationComplete` (there is no separate `onIterationStart` that writes a preliminary record). Add the three new fields to this creation:

```typescript
const iteration: Iteration = {
  type: "plan",
  iteration: iterResult.iteration,
  sessionId: iterResult.sessionId,
  cli: commandConfig.cli,
  model: iterResult.model ?? commandConfig.model,
  startedAt: iterationStartTime,
  completedAt,
  exitCode: iterResult.exitCode,
  taskCompleted: null,
  tokensUsed: iterResult.tokensUsed,
  inputTokens: iterResult.inputTokens,      // NEW
  outputTokens: iterResult.outputTokens,    // NEW
  cost: iterResult.cost,                     // NEW
};
```

## Backwards Compatibility

- New `IterationSchema` fields use `.default(null)` — Zod fills them in when parsing old data.
- Display functions treat `null` as `—` for individual values and `0` for aggregation sums.
- No migration step needed. Old `status.json` files "just work."

## Edge Cases

1. **Adapter provides no cost** (e.g., Codex): `cost` is `null`, displayed as `—`, excluded from sums when all iterations have `null` cost.
2. **Adapter provides no token breakdown** (unlikely but possible): `inputTokens` and `outputTokens` are `null`, display `—`.
3. **Mixed adapters in one session** (e.g., plan with claude, build with codex): Some iterations have cost, others don't. Aggregated cost reflects only iterations that reported it.
4. **All costs are null**: Cost column still appears but shows `—` for every row; total line omits cost segment.
5. **Very small costs**: Displayed as `$0.00` (2 decimal places). This is acceptable for cost monitoring — users care about order of magnitude.

## Acceptance Criteria

1. **Given** a build iteration completes with spawner returning `usage: { inputTokens: 5000, outputTokens: 2000, totalTokens: 7000, cost: 0.25 }`, **when** the iteration is saved to `status.json`, **then** all four fields are persisted.

2. **Given** an old `status.json` with iterations missing `inputTokens`/`outputTokens`/`cost`, **when** toby reads the file, **then** parsing succeeds and missing fields default to `null`.

3. **Given** iterations with token/cost data, **when** running `toby status`, **then** the overview table shows Input, Output, Tokens, and Cost columns with aggregated values per spec.

4. **Given** iterations with token/cost data, **when** running `toby status --spec=X`, **then** the detail table shows per-iteration Input, Output, Tokens, and Cost columns.

5. **Given** a completed build, **when** the summary prints, **then** it includes total cost (e.g., `Iterations: 3, Tokens: 12,345, Cost: $0.42`).

6. **Given** all iterations have `null` cost, **when** displaying summaries and totals, **then** cost shows `—` per row and the total line omits the cost segment.

7. **Given** a build-all with multiple specs, **when** the summary prints, **then** each spec line and the total line include cost.

8. **Given** a completed plan run, **when** the summary prints, **then** it includes total tokens and cost (e.g., `✔ Plan complete for 01-auth (2 iterations, 8,500 tokens, $0.33)`).

## Testing Strategy

- **Unit tests for `formatCost`**: null → `—`, 0 → `$0.00`, 0.4231 → `$0.42`, 1.5 → `$1.50`.
- **Unit tests for `formatStatusTable`** and `formatDetailTable`**: Verify new columns render correctly with both populated and null values.
- **Unit tests for `computeProjectStats`**: Verify aggregation of `totalInputTokens`, `totalOutputTokens`, `totalCost` from iteration data.
- **Unit tests for `IterationSchema`**: Verify `.parse()` succeeds for old data (no new fields) and new data (with new fields).
- **Integration tests for `runLoop`**: Verify `IterationResult` contains `inputTokens`, `outputTokens`, `cost` from mocked spawner results.
- **Snapshot/output tests for build summaries**: Verify cost appears in single-spec and build-all summary output.
- **Snapshot/output tests for plan summaries**: Verify tokens and cost appear in single-spec and plan-all summary output.

### Existing test files requiring updates

These test files mock `tokensUsed`, `totalTokens`, or `ProjectStats` and must be updated with the new fields:

| Test file | What to update |
|-----------|---------------|
| `src/lib/__tests__/loop.test.ts` | `makeCliResult()` already has full usage — add `inputTokens`, `outputTokens`, `cost` assertions on `IterationResult` |
| `src/lib/__tests__/stats.test.ts` | `makeIteration()` factory, all `totalTokens` assertions → add `totalInputTokens`, `totalOutputTokens`, `totalCost` |
| `src/commands/build.test.ts` | `mockRunLoop` `iterResult` objects → add new fields; `BuildResult` assertions → add `totalCost` |
| `src/commands/plan.test.ts` | Iteration creation mocks → add new fields; add `PlanResult` token/cost assertions |
| `src/commands/resume.test.ts` | `BuildResult` mocks → add `totalCost`; summary output assertions → include cost |
| `src/commands/status.test.ts` | Iteration mocks → add `inputTokens`, `outputTokens`, `cost`; table output assertions → verify new columns |
| `src/commands/welcome.test.ts` | `computeProjectStats` mock → add `totalInputTokens`, `totalOutputTokens`, `totalCost` |
| `src/ui/format.test.ts` | `formatStatusTable` and `formatDetailTable` row mocks → add new columns; `banner` mock → add new stats fields |
