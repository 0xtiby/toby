# 46 — Fix Meow Boolean Flag Defaults

Fix boolean CLI flags without an explicit `default` being silently set to `false` by meow, preventing config values from taking effect.

## Problem

Meow v13 sets all boolean flags to `false` when the user doesn't pass them, even when no `default` is specified in the flag definition. The codebase uses nullish coalescing (`??`) to fall through from flag → config → default, but `false` is not nullish — so `flags.transcript ?? config.transcript` evaluates to `false` instead of the config's `true`.

**Impact:** `transcript: true` in `.toby/config.json` has no effect unless the user also passes `--transcript` on every invocation. Spec 31 defined the correct precedence (flag > config > default) but the implementation doesn't achieve it due to this meow behavior.

**Affected flags today:** `transcript` (the only boolean flag without an explicit `default`).

**Why fix the general pattern:** Any future boolean flag added without `default` will silently break config fallback in the same way.

**Current state:** A transcript-specific prototype fix exists in `cli.tsx` (lines 42-49) that hardcodes `--transcript` / `--no-transcript` detection. This spec replaces it with a generic solution.

## Scope

### In scope

- Detect which boolean flags the user explicitly passed vs meow auto-defaulted
- Normalize auto-defaulted boolean flags to `undefined` so `??` fallthrough works
- Apply the fix generically to all boolean flags in `MEOW_FLAGS` that lack an explicit `default`
- Replace the existing transcript-specific prototype in cli.tsx with the generic version
- Handle all meow-accepted boolean syntaxes (`--flag`, `--no-flag`, `--flag=true`, `--flag=false`)
- Respect the `--` arguments separator (args after `--` are not flags)
- Extract normalization as a testable pure function
- Verify `--transcript` / `--no-transcript` still work as explicit overrides
- Verify `--verbose` (which has `default: false`) is unaffected

### Out of scope

- Changing meow or switching arg parsers
- Changing the `??` precedence logic in `withTranscript` or other consumers
- Adding new flags

## Root Cause

In `src/lib/cli-meta.ts`:

```typescript
export const MEOW_FLAGS = {
  verbose: { type: "boolean", default: false },  // explicit default → always false
  transcript: { type: "boolean" },                // no default → meow still returns false
  // ...
};
```

Meow v13 internally defaults all boolean flags to `false` regardless of whether `default` is specified. The distinction matters because downstream code treats `undefined` as "not set by user, fall through to config" via `??`.

## Implementation

### 1. cli-meta.ts — Export normalization helper

Extract a pure, testable function that normalizes meow's flag output. This avoids testing side-effectful cli.tsx directly.

```typescript
/**
 * Meow v13 sets boolean flags to false even when the user doesn't pass them.
 * This breaks ?? fallthrough to config values. Normalize flags without an
 * explicit default back to undefined when the user didn't pass them.
 */
export function normalizeBooleanFlags(
  flags: Record<string, unknown>,
  rawArgs: string[],
): Record<string, unknown> {
  const result = { ...flags };

  // Only scan args before a bare -- separator
  const separatorIndex = rawArgs.indexOf("--");
  const flagArgs = separatorIndex === -1 ? rawArgs : rawArgs.slice(0, separatorIndex);

  const autoDefaultedBooleans = Object.entries(MEOW_FLAGS)
    .filter(([, def]) => def.type === "boolean" && !("default" in def))
    .map(([name]) => name);

  for (const name of autoDefaultedBooleans) {
    const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const wasExplicit = flagArgs.some(
      (a) =>
        a === `--${kebab}` ||
        a === `--no-${kebab}` ||
        a.startsWith(`--${kebab}=`),
    );
    if (!wasExplicit) {
      result[name] = undefined;
    }
  }

  return result;
}
```

### 2. cli.tsx — Replace prototype with generic call

Remove the existing transcript-specific fix (lines 42-49) and replace with a call to `normalizeBooleanFlags`.

```typescript
import { COMMAND_NAMES, MEOW_FLAGS, normalizeBooleanFlags } from "./lib/cli-meta.js";

// ...after meow parses...

const resolvedSpec = cli.flags.specs ?? cli.flags.spec;
const normalized = normalizeBooleanFlags(
  cli.flags as Record<string, unknown>,
  process.argv.slice(2),
);
const flags = { ...normalized, spec: resolvedSpec };
```

This replaces:
```typescript
// REMOVE: transcript-specific prototype
const rawArgs = process.argv.slice(2);
const explicitTranscript = rawArgs.some(a => a === "--transcript" || a === "--no-transcript")
  ? cli.flags.transcript
  : undefined;
const flags = { ...cli.flags, spec: resolvedSpec, transcript: explicitTranscript };
```

### 3. No changes to withTranscript or downstream consumers

The `??` logic is already correct per spec 31. The fix is entirely in the CLI layer, normalizing meow's output before it reaches commands.

## Edge Cases

- `--transcript` → `true` (explicit enable)
- `--no-transcript` → `false` (explicit disable)
- `--transcript=true` → `true` (explicit enable, alternate syntax)
- `--transcript=false` → `false` (explicit disable, alternate syntax)
- Neither passed → `undefined` (config fallback)
- `-- --transcript` → `undefined` (after separator, not a flag)
- `--spec=foo --transcript --verbose` → transcript `true`, verbose `false` (verbose has explicit default, unaffected)

## Business Rules

- `--transcript` → `flags.transcript = true` → overrides config
- `--no-transcript` → `flags.transcript = false` → overrides config
- `--transcript=true` / `--transcript=false` → same as above (explicit)
- Neither passed → `flags.transcript = undefined` → falls through to `config.transcript` via `??`
- Flags with explicit `default` in `MEOW_FLAGS` (e.g., `verbose`, `all`, `force`) are never normalized — their default is intentional
- Arguments after a bare `--` are positional, not flags — they must not trigger "explicit" detection

## Acceptance Criteria

- Given `transcript: true` in config and no CLI flag, when running `toby plan --spec=X`, then a transcript file is created in `.toby/transcripts/`
- Given `transcript: true` in config and `--no-transcript` flag, when running `toby plan --spec=X`, then no transcript file is created
- Given `transcript: true` in config and `--transcript=false`, when running `toby plan --spec=X`, then no transcript file is created
- Given `transcript: false` in config and `--transcript` flag, when running `toby plan --spec=X`, then a transcript file is created
- Given no config transcript and no flag, when running `toby plan --spec=X`, then no transcript file is created (Zod default is false)
- Given `verbose: false` in MEOW_FLAGS default, when running any command without `--verbose`, then `flags.verbose` is `false` (not `undefined`) — explicit defaults are preserved
- Given `-- --transcript` in argv, then `flags.transcript` is `undefined` (separator respected)
- Same criteria apply to `build` and `resume` commands

## Testing Strategy

Unit tests for `normalizeBooleanFlags` (in `src/lib/__tests__/cli-meta.test.ts`):

- Given rawArgs `["plan", "--spec=foo"]`, then `transcript` is `undefined` in output
- Given rawArgs `["plan", "--transcript"]`, then `transcript` is `true` in output
- Given rawArgs `["plan", "--no-transcript"]`, then `transcript` is `false` in output
- Given rawArgs `["plan", "--transcript=true"]`, then `transcript` is `true` in output
- Given rawArgs `["plan", "--transcript=false"]`, then `transcript` is `false` in output
- Given rawArgs `["plan", "--", "--transcript"]`, then `transcript` is `undefined` (after separator)
- Given rawArgs `["plan", "--verbose"]`, then `verbose` is unchanged (has explicit default)
- Given no auto-defaulted booleans in MEOW_FLAGS, then output equals input (no-op)

Integration tests (existing transcript test suites in plan.test.tsx / build.test.tsx):
- Verify `toby config set transcript true` + `toby build --spec=X` creates transcript file
- Verify `toby config set transcript true` + `toby build --no-transcript --spec=X` creates no transcript file
