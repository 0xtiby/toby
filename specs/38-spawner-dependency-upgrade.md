# 38 — Spawner Dependency Upgrade

> Bump `@0xtiby/spawner` from v1.0.2 to v1.1.0 and adapt to breaking type changes.

## Overview

Upgrade the `@0xtiby/spawner` dependency to v1.1.0, pin the version with a semver range (`^1.1.0`), and ensure all existing code compiles against the updated types. The v1.1.0 release includes type changes (`KnownModel` without `cli` field, wider `provider` type) and new exports (`listModels`, `refreshModels`, `CLI_PROVIDER_MAP`, `ModelsFetchError`).

## Dependencies

- **Spec 36** (Async Models API Migration) — provides the `useModels` hook that replaces `getKnownModels` and defines error handling via `fallback: true`

**Implementation order:** Spec 38 should be done FIRST (bump the dependency), then spec 36 (create hook + migrate UI). The dependency must be available before code can import `listModels`.

## Scope

### In scope

- Update `package.json` dependency from `"latest"` to `"^1.1.0"`
- Run `pnpm update @0xtiby/spawner` to update lockfile
- Remove `getKnownModels` import from `init.tsx` and `config.tsx` (replaced by `useModels` hook per spec 36)
- Verify TypeScript compilation passes with updated types
- Update test mocks to match new API surface

### Out of scope

- Functional changes beyond API migration (covered by spec 36)
- Importing new exports not needed by current features (`CLI_PROVIDER_MAP`, `ModelsFetchError`, `refreshModels`)

## Business Rules

1. **Version pinning:** Use `^1.1.0` semver range — allows patch updates (1.1.x) but not minor/major bumps without explicit action.
2. **Full removal of `getKnownModels`:** No usage should remain after migration. The `useModels` hook (spec 36) uses `listModels` exclusively.
3. **No new spawner exports used beyond `listModels`:** Only import what's needed — `spawn`, `detectAll`, `listModels`, and types (`CliEvent`, `SpawnOptions`).

## Architecture

### File changes

| File | Change |
|------|--------|
| `package.json` | `"@0xtiby/spawner": "latest"` → `"@0xtiby/spawner": "^1.1.0"` |
| `pnpm-lock.yaml` | Updated by `pnpm update` |
| `src/commands/init.tsx` | Remove `getKnownModels` from import, add `useModels` hook import |
| `src/commands/config.tsx` | Remove `getKnownModels` from import, add `useModels` hook import |
| `src/hooks/useModels.ts` | New file — imports `listModels` from spawner (per spec 36) |
| `src/commands/init.test.tsx` | Update mock: `getKnownModels` → `listModels` (async) |

**Note:** `config.test.tsx` and `config.test.ts` do NOT need mock updates — they test `ConfigGet`/`ConfigSet`/`ConfigSetBatch` and pure functions (`configToEditorValues`, `editorValuesToConfig`), none of which use `getKnownModels`.

### Import changes

**Before (init.tsx / config.tsx):**
```typescript
import { detectAll, getKnownModels } from "@0xtiby/spawner";
```

**After (init.tsx / config.tsx):**
```typescript
import { detectAll } from "@0xtiby/spawner";
import { useModels } from "../hooks/useModels.js";
```

### Type compatibility

| Type change in v1.1.0 | Impact on Toby |
|----------------------|----------------|
| `KnownModel.cli` field removed | No impact — Toby only accesses `m.name` and `m.id` |
| `KnownModel.provider` widened to `string` | No impact — Toby doesn't access `provider` |
| `listModels()` is async (returns `Promise`) | Handled by `useModels` hook (spec 36) |
| `ListModelsOptions` has `fallback` field | Used in `useModels` hook (spec 36) |

### Complete spawner import map (post-migration)

| File | Imports |
|------|---------|
| `src/lib/loop.ts` | `spawn`, `type CliEvent, SpawnOptions` |
| `src/lib/transcript.ts` | `type CliEvent` |
| `src/components/StreamOutput.tsx` | `type CliEvent` |
| `src/commands/init.tsx` | `detectAll` |
| `src/commands/config.tsx` | `detectAll` |
| `src/commands/build.tsx` | `type CliEvent` |
| `src/commands/plan.tsx` | `type CliEvent` |
| `src/hooks/useCommandRunner.ts` | `type CliEvent` |
| `src/hooks/useModels.ts` | `listModels` |

### Test mock updates

**Before (`init.test.tsx`):**
```typescript
vi.mock("@0xtiby/spawner", () => ({
  detectAll: vi.fn(),
  getKnownModels: vi.fn(() => [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
  ]),
}));
```

**After (`init.test.tsx`):**
```typescript
vi.mock("@0xtiby/spawner", () => ({
  detectAll: vi.fn(),
  listModels: vi.fn(async () => [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic" },
  ]),
}));
```

## Acceptance Criteria

- **Given** the dependency is updated, **when** `pnpm install` runs, **then** `@0xtiby/spawner@1.1.0` (or later 1.1.x) is resolved.
- **Given** all code changes are applied, **when** `pnpm build` runs, **then** TypeScript compilation succeeds with zero errors.
- **Given** test mocks are updated, **when** `pnpm test` runs, **then** all existing tests pass.
- **Given** the codebase is searched for `getKnownModels`, **when** the migration is complete, **then** zero references remain.
- **Given** `package.json`, **when** inspecting the spawner dependency, **then** it reads `"^1.1.0"` (not `"latest"`).

## Testing Strategy

- **Build verification:** `pnpm build` must pass — confirms type compatibility.
- **Existing tests:** All tests in `src/commands/init.test.tsx`, `src/commands/plan.test.tsx`, `src/lib/__tests__/loop.test.ts` must pass with updated mocks.
- **Grep check:** `grep -r "getKnownModels" src/` returns zero results.
