# 19 — Multi-Spec Selection

## Overview

Replace the single-select spec picker with a multi-select interface and extend the `--spec` CLI flag to accept comma-separated values. This enables users to select and process multiple specs in a single command — both interactively and from the CLI.

## Problem & Users

Today, users who want to plan or build a subset of specs (not one, not all) must run the command multiple times or use `--all` and accept every applicable spec. There is no middle ground for "I want specs 15, 16, and 18 but not 17."

## Scope

### In scope
- Multi-select interactive `SpecSelector` with "Select All" toggle
- `--spec` / `--specs` flags accept comma-separated values (names or numbers)
- Sequential execution of selected specs (same behavior as `--all`)
- Shared generated session name across multi-spec runs (both plan and build use `generateSessionName()`)
- Refactor `executePlanAll`/`executeBuildAll` to accept an optional spec list, eliminating the need for separate `executeMulti` functions

### Out of scope
- Parallel execution of specs
- Persisting "last selection" for re-use
- Range syntax (`--spec=15-18`)

## User Stories

1. **As a user running `toby plan`** (no flags), I can see a multi-select list of specs, toggle individual specs with Space, toggle all with "Select All", and press Enter to plan them sequentially.

2. **As a user running `toby build`** (no flags), I can multi-select from planned/building specs and build them sequentially.

3. **As a user running `toby plan --spec=15,16,auth`**, all three specs resolve and plan sequentially without interactive prompts.

4. **As a user running `toby build --specs=15,16`**, the `--specs` alias works identically to `--spec`.

## Business Rules

- `--spec` and `--specs` are aliases. If both are provided, `--specs` takes precedence.
- Comma-separated values are trimmed of whitespace (e.g., `"15, 16"` → `["15", "16"]`).
- Duplicate specs in the list are deduplicated (first occurrence kept).
- Each value is resolved via the existing `findSpec()` — supports exact name, filename, slug, numeric prefix.
- If any spec in the list cannot be resolved, the command fails immediately with an error naming the unresolved spec.
- When a single spec is selected (interactive or CLI), behavior is identical to today's single-spec flow.
- When multiple specs are selected, they process sequentially in spec-order (by numeric prefix), sharing a single generated session name (via `generateSessionName()`).
- Both plan and build multi-spec modes use `generateSessionName()` for the shared session (consistent with how `executeBuildAll` already works; `executePlanAll` currently uses per-spec slugs but will adopt the shared pattern).

## UI/UX Flows

### Interactive Multi-Select (`SpecSelector`)

**Layout:**
```
Select specs to plan:  (Space: toggle, Enter: confirm)

  ◉ Select all
  ──────────────
  ○ 15-auth              [pending]
  ○ 16-api-endpoints     [pending]
  ◉ 17-ui-dashboard      [pending]
  ○ 18-notifications     [pending]
```

**Interactions:**
- **Arrow keys** — navigate up/down through the list
- **Space** — toggle selection on the highlighted item (◉ ↔ ○)
- **Enter** — confirm selection and start processing
- **"Select All" item** — always appears first, separated by a divider line. Toggling it selects/deselects all specs.

**Select All auto-sync:**
- If all specs are individually selected, "Select All" auto-checks to ◉.
- If any spec is deselected, "Select All" auto-unchecks to ○.
- Toggling "Select All" from ○ selects all. Toggling from ◉ deselects all.

**States:**
- **Empty selection + Enter:** Shows inline warning "Please select at least one spec" (yellow text). Selector stays open.
- **Single spec selected:** Behaves exactly like today's single-select flow (phase → `init`).
- **Multiple specs selected:** Phase → `multi`, processes sequentially.

### CLI Multi-Spec (`--spec` / `--specs`)

```bash
# All equivalent:
toby plan --spec=15,16,18
toby plan --specs=15,16,18
toby plan --spec="15, 16, 18"
toby plan --spec=15-auth,16-api-endpoints
toby plan --spec=auth,api-endpoints
```

Resolves each value via `findSpec()`, then executes sequentially.

## Edge Cases

- **`--spec` with single value:** Works exactly as today. No behavior change.
- **`--spec` with `--all`:** `--all` takes precedence (existing behavior preserved).
- **All specs filtered out:** Shows "No specs found" error (e.g., build mode with no planned specs).
- **Duplicate in comma list:** `--spec=15,15,auth` where `auth` is spec 15 → deduplicated to one spec.
- **Invalid spec in list:** `--spec=15,999` → Error: `Spec '999' not found`. Fails before processing any spec.

## Data Model

No new persistent data. Status tracking uses existing `status.json` structure — each spec gets its own status entry as before.

### New types

```typescript
// In specs.ts — new function
export function findSpecs(specs: Spec[], query: string): Spec[] {
  const queries = query.split(",").map(q => q.trim()).filter(Boolean);
  const results: Spec[] = [];
  for (const q of queries) {
    const found = findSpec(specs, q);
    if (!found) throw new Error(`Spec '${q}' not found`);
    if (!results.some(r => r.name === found.name)) results.push(found);
  }
  return sortSpecs(results);
}
```

### Updated `CommandFlags`

```typescript
export interface CommandFlags {
  spec?: string;       // accepts comma-separated values
  specs?: string;      // alias for spec
  all: boolean;
  iterations?: number;
  verbose: boolean;
  cli?: string;
  session?: string;
}
```

### Updated `Phase`

```typescript
export type Phase = "init" | "all" | "multi" | "selecting" | "running" | "done" | "interrupted" | "error";
```

## API / Interface

### `MultiSpecSelector` component (replaces `SpecSelector`)

```typescript
import { useInput } from "ink";

interface MultiSpecSelectorProps {
  specs: Spec[];
  onConfirm: (selected: Spec[]) => void;
  title?: string;
}

export default function MultiSpecSelector(props: MultiSpecSelectorProps): React.ReactElement;
```

- Uses ink's `useInput` hook for keyboard handling (arrow keys, space, enter)
- Renders multi-select list with "Select All" at top
- Manages internal selection state via `Map<string, boolean>` and cursor position via `useState<number>`
- Shows warning on empty confirmation
- Replaces `ink-select-input` dependency — remove `ink-select-input` from `package.json` after migration

### `useCommandRunner` additions

```typescript
// Updated initial phase resolution — detect comma in --spec
const [phase, setPhase] = useState<Phase>(() => {
  if (flags.all) return "all";
  if (flags.spec?.includes(",")) return "multi";  // NEW: comma → multi phase
  if (flags.spec) return "init";
  return "selecting";
});

// New state for multi-spec
const [selectedSpecs, setSelectedSpecs] = useState<Spec[]>([]);

// Updated handler — replaces handleSpecSelect
function handleMultiSpecConfirm(specs: Spec[]) {
  if (specs.length === 1) {
    setActiveFlags({ ...flags, spec: specs[0].name });
    setPhase("init");
  } else {
    setSelectedSpecs(specs);
    setPhase("multi");
  }
}
```

### Refactored `executePlanAll` / `executeBuildAll`

Instead of creating new `executeMulti` functions, refactor the existing `All` functions to accept an optional pre-resolved spec list:

```typescript
// In plan.tsx — add optional specs parameter
export async function executePlanAll(
  flags: PlanFlags,
  callbacks: PlanAllCallbacks,
  cwd?: string,
  abortSignal?: AbortSignal,
  specs?: Spec[],          // NEW: if provided, skip internal discovery/filtering
): Promise<PlanAllResult>;

// In build.tsx — same pattern
export async function executeBuildAll(
  flags: BuildFlags,
  callbacks: BuildAllCallbacks,
  cwd?: string,
  abortSignal?: AbortSignal,
  specs?: Spec[],          // NEW: if provided, skip internal discovery/filtering
): Promise<BuildAllResult>;
```

When `specs` is provided:
- Skip `discoverSpecs()` and status filtering
- Use the provided list directly (already resolved and sorted by caller)
- Generate a shared session name via `generateSessionName()` (same as current `executeBuildAll` behavior)

When `specs` is omitted:
- Behavior is identical to today (discover, filter by status, process all)

### CLI flag registration (`cli.tsx`)

```typescript
// Add to meow flags:
specs: { type: "string" },  // alias for --spec

// Flag resolution (before passing to command):
const resolvedSpec = cli.flags.specs ?? cli.flags.spec;
```

## Architecture

### Module changes

| File | Change |
|------|--------|
| `src/cli.tsx` | Add `specs` flag, resolve alias, pass to commands. Update help text. |
| `src/components/SpecSelector.tsx` | Replace with `MultiSpecSelector` using `useInput` from ink. Remove `ink-select-input` dependency. |
| `src/hooks/useCommandRunner.ts` | Add `"multi"` phase, `selectedSpecs` state, `handleMultiSpecConfirm`. Detect comma in `--spec` to route to `"multi"` phase. |
| `src/commands/plan.tsx` | Refactor `executePlanAll` to accept optional `specs` param. Handle `"multi"` phase in render. |
| `src/commands/build.tsx` | Refactor `executeBuildAll` to accept optional `specs` param. Handle `"multi"` phase in render. |
| `src/lib/specs.ts` | Add `findSpecs()` function |
| `package.json` | Remove `ink-select-input` from dependencies |

### Data flow

```
CLI args (--spec=15,16)
  → resolvedSpec = "15,16"
  → CommandFlags.spec = "15,16"
  → useCommandRunner detects comma in spec → phase "multi"
  → findSpecs() resolves "15,16" → [spec15, spec16]
  → executePlanAll(flags, callbacks, cwd, signal, resolvedSpecs)

CLI args (--spec=15)  [single value, no comma]
  → CommandFlags.spec = "15"
  → useCommandRunner → phase "init" (existing single-spec path, unchanged)

Interactive (no flags)
  → phase "selecting"
  → MultiSpecSelector renders (useInput for keyboard)
  → user toggles specs, presses Enter
  → onConfirm([spec15, spec16])
  → handleMultiSpecConfirm:
      single → phase "init" (existing path)
      multi  → phase "multi" (new path)
  → "multi" phase triggers executePlanAll/executeBuildAll with pre-resolved specs
```

### Backward compatibility

- Single `--spec=auth` works exactly as before
- Interactive mode defaults to multi-select but pressing Space+Enter on one spec behaves identically to today's single-select
- `--all` continues to work unchanged and takes precedence over `--spec`

## Acceptance Criteria

1. **Given** I run `toby plan` with no flags, **when** the spec selector appears, **then** I see a multi-select list with ◉/○ checkboxes and "Select All" at the top.

2. **Given** I am in the multi-select list, **when** I press Space on a spec, **then** it toggles between ◉ and ○.

3. **Given** I select "Select All", **when** all specs become selected, **then** "Select All" shows ◉. **When** I deselect one spec, **then** "Select All" shows ○.

4. **Given** I press Enter with no specs selected, **when** the selector validates, **then** it shows "Please select at least one spec" and stays open.

5. **Given** I select 3 specs and press Enter, **when** planning starts, **then** all 3 specs are planned sequentially in numeric-prefix order.

6. **Given** I run `toby plan --spec=15,16,auth`, **when** specs resolve, **then** all three are found and planned sequentially.

7. **Given** I run `toby build --specs=15,16`, **when** the command runs, **then** `--specs` behaves identically to `--spec`.

8. **Given** I run `toby plan --spec=15,999`, **when** spec resolution runs, **then** it fails with "Spec '999' not found" before processing any spec.

9. **Given** I run `toby plan --spec="15, 16, 18"`, **when** values are parsed, **then** whitespace around commas is trimmed and all three specs resolve correctly.

10. **Given** I run `toby plan --spec=15 --all`, **when** flags are processed, **then** `--all` takes precedence.

## Testing Strategy

- **Unit tests for `findSpecs()`:** comma parsing, trimming, dedup, error on missing spec
- **Component tests for `MultiSpecSelector`:** render checkboxes, space toggles, enter confirms, select-all sync, empty-selection warning
- **Integration tests for refactored `executePlanAll`/`executeBuildAll` with specs param:** sequential processing, session sharing, abort handling
- **CLI flag tests:** `--spec` and `--specs` alias resolution, comma-separated values, interaction with `--all`
