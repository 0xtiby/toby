# 20 — Spec Number Shorthand

## Overview

Document and ensure that specs can be referenced by their numeric prefix alone in `--spec`/`--specs` flags and throughout the CLI. This capability already exists in `findSpec()` but is undocumented and needs to work seamlessly within the comma-separated multi-spec flow introduced in spec 19.

## Problem & Users

Users know their specs by number (e.g., spec 15, spec 16) and want to type `toby plan --spec=15` instead of `toby plan --spec=15-auth` or `toby plan --spec=auth`. This is especially valuable with comma-separated lists: `--specs=15,16,17` is far more ergonomic than `--specs=15-auth,16-api-endpoints,17-ui-dashboard`.

## Scope

### In scope
- Verify `findSpec()` number resolution works for bare numbers (`15` → `15-auth`)
- Verify it works for alphanumeric prefixes (`15a` → `15a-sub-feature`)
- Ensure number shorthand works within `findSpecs()` comma-separated parsing (spec 19)
- Document the matching priority in code comments
- Add help text documenting number shorthand in CLI `--help` output

### Out of scope
- Range syntax (`15-18` meaning specs 15 through 18) — ambiguous with spec names
- Partial name matching / fuzzy search

## Existing Implementation

`findSpec()` in `src/lib/specs.ts` already supports four match strategies in priority order:

```typescript
export function findSpec(specs: Spec[], query: string): Spec | undefined {
  return specs.find((s) => {
    if (s.name === query) return true;                        // 1. Exact name: "15-auth"
    if (`${s.name}.md` === query) return true;                // 2. Filename: "15-auth.md"
    const withoutPrefix = s.name.replace(/^\d+[a-z]?-/, "");
    if (withoutPrefix === query) return true;                 // 3. Slug: "auth"
    const prefixMatch = /^(\d+[a-z]?)-/.exec(s.name);
    if (prefixMatch && prefixMatch[1] === query) return true; // 4. Number: "15" or "15a"
    return false;
  });
}
```

Match strategy 4 already handles bare numbers. This spec ensures this works correctly within the multi-spec context and is properly documented.

## Business Rules

- Bare number `15` matches the first spec with prefix `15-` (e.g., `15-auth`).
- Alphanumeric prefix `15a` matches spec `15a-sub-feature`.
- If multiple specs share the same numeric prefix (e.g., `15-auth` and `15a-auth-sso`), bare `15` matches `15-auth` (first match wins via `Array.find`).
- Number matching is the lowest priority — exact name, filename, and slug matches take precedence.
- In comma-separated lists, each value is independently resolved: `--spec=15,auth,17-dashboard` mixes numbers, slugs, and exact names freely.

## UI/UX

### CLI help text update

Add a note to the `--spec` flag documentation:

```
Plan/Build Options
  --spec=<query>       Target spec(s) by name, slug, number, or comma-separated list
  --specs=<query>      Alias for --spec
```

### Error messages

When a bare number doesn't match:
```
Error: Spec '99' not found
```

Same error format as any other unresolved query — no special handling needed.

## Edge Cases

- **Number `0`:** Matches spec `00-setup` if it exists. No special case.
- **Leading zeros:** `09` matches `09-init-status-config`. The prefix regex captures the full numeric string.
- **Number that looks like a slug:** If a spec is named `15-42` (slug is `42`), then query `42` matches via slug before number. Query `15` matches via number.
- **Unnumbered specs:** Cannot be matched by number (no prefix to match against). Must use name or slug.

## Acceptance Criteria

1. **Given** spec `15-auth` exists, **when** I run `toby plan --spec=15`, **then** it resolves to `15-auth` and plans it.

2. **Given** spec `15a-auth-sso` exists, **when** I run `toby plan --spec=15a`, **then** it resolves to `15a-auth-sso`.

3. **Given** I run `toby plan --specs=15,16,17`, **when** specs resolve, **then** each number maps to its corresponding spec and all three are planned.

4. **Given** I run `toby plan --spec=09`, **when** spec `09-init-status-config` exists, **then** it resolves correctly (leading zeros preserved in match).

5. **Given** no spec has prefix `99`, **when** I run `toby plan --spec=99`, **then** it fails with "Spec '99' not found".

6. **Given** I run `toby --help`, **then** the `--spec` flag description mentions it accepts numbers and comma-separated values.

## Existing Test Coverage

`src/lib/__tests__/specs.test.ts` already covers number matching:
- Bare number `"01"` matches `"01-auth"` (line ~340)
- Alphanumeric prefix `"15a"` matches `"15a-baz"` (line ~350)
- First match wins for shared numeric prefix (line ~355)

These tests validate that the core `findSpec()` number resolution works correctly.

## Testing Strategy

- **Verify existing `findSpec()` number tests pass:** bare number, alphanumeric prefix, leading zeros, no-match
- **Add `findSpecs()` tests with mixed queries:** numbers + slugs + exact names in one comma-separated string (spec 19 scope, but exercises number shorthand)
- **CLI integration test:** `--spec=15` resolves and runs correctly end-to-end
- **Help text test:** verify `--help` output mentions number and comma-separated support
