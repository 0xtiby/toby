# Spec Discovery & Management

## Overview

Find, filter, and order markdown spec files from a configurable specs directory. Specs are numbered with `NN-` filename prefixes for explicit ordering, with alphabetical fallback for unnumbered files.

## Problem & Users

Users write specs as markdown files. Toby needs to discover them, respect ordering for sequential execution (especially in `--all` mode), and filter out excluded files like README.md.

## Scope

### In Scope
- Discover `.md` files in the configured specs directory
- Parse `NN-` prefix for ordering
- Filter files based on `excludeSpecs` config
- Determine spec status (pending, planned, building, done) from status.json
- Support `--spec=<name>` selection by name (without prefix number or extension)

### Out of Scope
- Moving/archiving specs (prompt-driven)
- Creating specs

## Data Model

```typescript
/** Base file reference (defined in src/types.ts) */
interface SpecFile {
  /** Filename without extension, e.g. "01-auth" */
  name: string;
  /** Full path to the spec file */
  path: string;
  /** Raw markdown content (optional, loaded on demand) */
  content?: string;
}

/** Parsed order prefix */
interface SpecOrder {
  /** Numeric part of the prefix */
  num: number;
  /** Optional letter suffix, e.g. "a" in "15a-" */
  suffix: string | null;
}

/** Extended spec with ordering and status (defined in src/lib/specs.ts) */
interface Spec extends SpecFile {
  /** Parsed prefix for ordering, null if unnumbered */
  order: SpecOrder | null;
  /** Current status from status.json */
  status: SpecStatus;
}

type SpecStatus = 'pending' | 'planned' | 'building' | 'done';
```

## API / Interface

```typescript
// src/lib/specs.ts

/** Discover all specs in the configured directory */
export function discoverSpecs(cwd: string, config: Config): Spec[];

/** Filter specs by status */
export function filterByStatus(specs: Spec[], status: SpecStatus): Spec[];

/** Find a spec by name (with or without NN- prefix, with or without .md) */
export function findSpec(specs: Spec[], name: string): Spec | undefined;

/** Parse the numeric prefix from a filename (supports alphanumeric: "15a-") */
export function parseSpecOrder(filename: string): SpecOrder | null;

/** Sort specs by order (numbered first ascending, unnumbered last alphabetical) */
export function sortSpecs(specs: Spec[]): Spec[];
```

## Business Rules

- **Ordering:** Files with `NN-` prefix (e.g., `01-auth.md`, `02-payments.md`) sort by number. Unnumbered files sort alphabetically after numbered ones.
- **Exclusion:** Files matching any pattern in `excludeSpecs` config are excluded. Matching is by filename (not path).
- **Name matching:** `--spec=auth` matches `01-auth.md`. `--spec=01-auth` also matches. `--spec=01-auth.md` also matches. First match wins.
- **Status:** Determined by looking up the spec name in `status.json`. If not present, status is `pending`.
- **Specs dir:** Resolved relative to `cwd`. Defaults to `specs/`.

## Acceptance Criteria

- Given `specs/01-auth.md` and `specs/02-payments.md`, when discovering, then they are returned in order [01-auth, 02-payments]
- Given `specs/README.md` and `excludeSpecs: ["README.md"]`, when discovering, then README.md is excluded
- Given `specs/01-auth.md`, when finding with `--spec=auth`, then it matches
- Given `specs/feature.md` (no number prefix), when sorting with numbered specs, then it appears after all numbered specs
- Given `specsDir: "features"` in config, when discovering, then it looks in `features/` not `specs/`
- Given a spec not in status.json, when determining status, then it returns `pending`
- Given specs dir doesn't exist, when discovering, then it returns empty array with no error

## Edge Cases

- Specs directory missing: return empty array, no error
- No `.md` files in specs dir: return empty array
- Duplicate numeric prefixes (e.g., `01-a.md` and `01-b.md`): both included, secondary sort alphabetical
- Non-numeric prefix (e.g., `AA-auth.md`): treated as unnumbered
- Nested directories inside specs: not traversed (flat only)

## Testing Strategy

- Unit test: `parseSpecOrder("01-auth.md")` returns 1
- Unit test: `parseSpecOrder("feature.md")` returns null
- Unit test: `sortSpecs` orders numbered before unnumbered
- Unit test: `findSpec` matches by partial name
- Unit test: `discoverSpecs` excludes files in excludeSpecs
- Unit test: Empty/missing specs dir returns empty array
