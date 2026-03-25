# 29 — Filter Plan Interactive Selector

## Overview

When running `toby plan` without `--spec` (interactive mode), the `MultiSpecSelector` displays **all** specs regardless of status. Users see specs that are already "planned" or "done", creating noise and confusion. The selector should only show specs with status `"pending"`.

**GitHub Issue:** [#19 — Filter specs done on plan](https://github.com/0xtiby/toby/issues/19)

## Problem

- Interactive `toby plan` shows the full spec list including already-planned and done specs
- The `--all` path already filters to pending-only via `filterByStatus(discovered, "pending")`, but the interactive selector path does not
- Users must mentally skip completed specs, which is error-prone with large spec lists

## Scope

### In scope
- Filter the `Plan` component's interactive selector to only show `"pending"` specs
- Show a clear message when no pending specs remain

### Out of scope
- Build command filtering (separate concern)
- Showing planned specs for refinement in the selector (users can use `--spec` flag for that)

## User Stories

**As a user running `toby plan` interactively**, I see only specs that haven't been planned yet, so I can focus on what needs work.

**As a user who has planned all specs**, I see a clear message that no pending specs remain, rather than an empty or confusing selector.

## Business Rules

1. Interactive selector shows only specs with `status === "pending"`
2. If no pending specs exist, display an informative error message (e.g., "No pending specs to plan. All specs have been planned.")
3. The `--spec` flag bypasses this filter entirely — users can still plan/refine any spec by name
4. The `--all` flag behavior is unchanged (already filters to pending)

## Technical Shape

### Changes to `src/commands/plan.tsx`

Pass `filterSpecs` and `emptyMessage` to `useCommandRunner`, following the same pattern already used by the Build component (`build.tsx:409-417`):

```typescript
const runner = useCommandRunner({
  flags,
  runPhase: "planning",
  filterSpecs: (specs) => specs.filter((s) => s.status === "pending"),
  emptyMessage: "No pending specs to plan. All specs have been planned.",
});
```

**Existing precedent** — Build already does this:
```typescript
// build.tsx:409-417
const runner = useCommandRunner({
  flags,
  runPhase: "building",
  filterSpecs: (specs) => {
    const buildable = [...filterByStatus(specs, "planned"), ...filterByStatus(specs, "building")];
    return buildable;
  },
  emptyMessage: "No planned specs found. Run 'toby plan' first.",
});
```

### No new types or interfaces needed

The `useCommandRunner` hook already supports `filterSpecs` (line 26) and `emptyMessage` (line 27). The filtering logic in `useCommandRunner` (line 69: `const filtered = filterSpecs ? filterSpecs(discovered) : discovered`) handles the empty case by showing the error message and setting phase to `"error"`.

## Acceptance Criteria

- **Given** specs with statuses [pending, planned, done], **when** running `toby plan` interactively, **then** only "pending" specs appear in the selector
- **Given** all specs are "planned" or "done", **when** running `toby plan` interactively, **then** an error message "No pending specs to plan" is shown
- **Given** a "planned" spec, **when** running `toby plan --spec=<name>`, **then** it still works (refinement mode, bypasses filter)
- **Given** the `--all` flag, **when** running `toby plan --all`, **then** behavior is unchanged (already filters pending)

## Testing Strategy

- Unit test: verify `useCommandRunner` applies `filterSpecs` when in `"selecting"` phase
- Integration test: `Plan` component in interactive mode only shows pending specs
- Integration test: `Plan` component shows error when no pending specs exist
