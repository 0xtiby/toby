# Alphanumeric Spec Ordering

## Overview

Extend the spec discovery ordering to support alphanumeric prefixes like `15a-`, `15b-` in addition to plain numeric `15-`. This allows sub-specs to be inserted between existing numbered specs without renumbering the entire sequence. Ordering is: `15 < 15a < 15b < 16`.

## Problem Statement

**Who:** Users organizing specs into logical groups
**Problem:** The current ordering system only parses numeric prefixes (`/^\d+-/`). When a feature needs to be split into sub-specs (e.g., 15a, 15b, 15c), the system treats them all as order `15` and falls back to alphabetical name sorting — which happens to work but is accidental. More importantly, the `order` field is typed as `number | null`, so a letter suffix cannot be represented, and `specSlug` (from spec 16) strips only `\d+-` prefixes, leaving `a-` artifacts in the slug.
**Impact:** Users must renumber all subsequent specs when inserting a new spec between two existing ones. Supporting letter suffixes gives a natural way to group related specs.

## Scope

### Included

- Update prefix parsing to recognize `NN-` and `NNx-` patterns (digits followed by optional lowercase letter, then hyphen)
- Change the `order` field from `number | null` to a type that captures both numeric and alphanumeric ordering
- Update sorting to order: bare number first, then letter suffixes alphabetically (`15 < 15a < 15b < 16`)
- Update `specSlug` (from spec 16) to strip alphanumeric prefixes (`15a-foo` → `foo`)
- Update existing tests for the new parsing and sorting behavior

### Excluded

- Uppercase letter suffixes (only lowercase `a-z`)
- Multi-letter suffixes (e.g., `15ab-`) — single letter only
- Nested numbering (e.g., `15.1-`, `15-1-`)
- Changes to spec discovery (file glob, exclusions, status reading)

### Constraints

- Backward compatible: existing `NN-` prefixed specs continue to work identically
- Sort order must be deterministic for any mix of bare, suffixed, and unprefixed specs

## User Stories

- [ ] As a user, I can name a spec `15a-template-variable-system.md` and it sorts after `15-something.md` but before `16-something.md`
- [ ] As a user running `toby build --all`, specs with alphanumeric prefixes are processed in the correct order: `15 < 15a < 15b < 16`
- [ ] As a user with a mix of bare-numbered and letter-suffixed specs, the ordering is predictable and matches what I see in the file listing

## Business Rules

### Prefix Pattern

The recognized prefix pattern is: one or more digits, optionally followed by a single lowercase letter, followed by a hyphen.

- `15-` — valid, order is `(15, none)`
- `15a-` — valid, order is `(15, a)`
- `15z-` — valid, order is `(15, z)`
- `3-` — valid, order is `(3, none)`
- `15A-` — not recognized as a prefixed spec (uppercase not supported)
- `15ab-` — only `15a` is recognized; the `b-` becomes part of the name
- `foo-` — not recognized (no leading digits)

### Sort Order

Ordering uses a two-part comparison: numeric part first, then letter suffix.

1. Compare numeric parts — lower number comes first
2. If numeric parts are equal, compare suffixes:
   - No suffix (bare number) comes before any letter suffix
   - Letter suffixes sort alphabetically (`a < b < ... < z`)
3. If both numeric and suffix are identical, sort alphabetically by full name (tiebreaker)
4. Numbered specs (with or without suffix) always come before unnumbered specs
5. Unnumbered specs sort alphabetically among themselves

**Examples:**
```
3-foo
15-bar
15a-baz
15b-qux
15c-quux
16-corge
auth (unnumbered)
readme (unnumbered)
```

### Order Representation

The `order` field changes from `number | null` to a structured representation that captures both the numeric and optional suffix parts. When no prefix is present, order is null (unchanged behavior for unnumbered specs).

### specSlug Update

The `specSlug` function (defined in spec 16) must strip the full alphanumeric prefix:
- `15a-template-variable-system` → `template-variable-system`
- `15-something` → `something` (existing behavior preserved)
- `no-prefix` → `no-prefix` (existing behavior preserved)

## Edge Cases

| Condition | Expected Behavior |
|-----------|-------------------|
| `15-` and `15a-` in same directory | `15-` sorts before `15a-` |
| Only letter-suffixed specs, no bare number (e.g., `15a-` and `15b-` but no `15-`) | Valid — sorts `15a` before `15b` |
| `0a-foo` | Valid — order is `(0, a)` |
| `999z-foo` | Valid — order is `(999, z)` |
| `15A-foo` (uppercase) | Treated as unnumbered (no match) |
| `15ab-foo` (multi-letter) | Parsed as `(15, a)` with `b-foo` as the rest of the name |
| Spec renamed from `15-` to `15a-` | Sorts in the same position unless a bare `15-` also exists |

## Acceptance Criteria

- [ ] **Given** spec files `15-bar.md`, `15a-baz.md`, `15b-qux.md`, `16-corge.md`, **when** sorted, **then** order is `15-bar`, `15a-baz`, `15b-qux`, `16-corge`
- [ ] **Given** spec files `15a-foo.md` and `15b-bar.md` with no bare `15-`, **when** sorted, **then** order is `15a-foo`, `15b-bar`
- [ ] **Given** spec file `15a-template-variable-system.md`, **when** `specSlug` is called, **then** result is `template-variable-system`
- [ ] **Given** spec file `15-something.md`, **when** parsed, **then** order is `(15, none)` — backward compatible with existing behavior
- [ ] **Given** a mix of numbered, letter-suffixed, and unnumbered specs, **when** sorted, **then** numbered come first (in order), then unnumbered (alphabetically)
- [ ] **Given** spec file `15A-foo.md` (uppercase), **when** parsed, **then** treated as unnumbered
- [ ] **Given** all changes, **when** `pnpm build && pnpm test` runs, **then** compilation and all tests pass
