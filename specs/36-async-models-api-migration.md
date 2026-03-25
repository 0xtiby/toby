# 36 — Async Models API Migration

> Replace synchronous `getKnownModels()` with the async `listModels()` API from spawner v1.1.0 in init and config commands.

## Overview

Spawner v1.1.0 introduces `listModels()`, an async function that fetches models dynamically from the models.dev catalog instead of returning a hardcoded list. This spec covers migrating Toby's model selection UI in `init.tsx` and `config.tsx` to use this new API via a shared `useModels` React hook, including cache behavior and error handling.

## Scope

### In scope

- Create a `useModels(cli)` React hook in `src/hooks/useModels.ts`
- Replace `getKnownModels()` calls in `init.tsx` and `config.tsx` with the hook
- Remove the local `modelItems()` helper from both files
- Add a loading spinner (`ink-spinner`, already a dependency at `^5.0.0` but currently unused) while models are being fetched
- Keep the "default" option as the first item in the model list
- Use `fallback: true` for silent fallback on fetch failure
- Handle empty model lists gracefully

### Out of scope

- Changes to `loop.ts` (no model listing there)
- Changes to non-interactive init mode (flags bypass model selection)
- Model validation logic
- Exposing `refreshModels()` as a CLI subcommand (24h TTL cache is sufficient)
- Custom caching on Toby's side (spawner handles caching internally)
- Surfacing `ModelsFetchError` details to the user

## User Stories

- **As a user running `toby init`**, I can see up-to-date models from models.dev so that I always have the latest model options available.
- **As a user running `toby config` (editor mode)**, I can see the same dynamic model list when editing plan/build model settings.

## Business Rules

1. **Silent fallback:** When `listModels({ cli, fallback: true })` fails to fetch from models.dev, spawner automatically returns built-in hardcoded models. Toby does NOT show any error or warning.
2. **Cache TTL:** Spawner maintains a 24-hour in-memory cache. Within a single Toby process lifetime, repeated calls to `listModels()` will not re-fetch if the cache is fresh.
3. **Stale cache:** If the cache has expired but the fetch fails, spawner returns stale cached data. This is transparent to Toby.
4. **Empty result:** If both fetch and fallback return zero models, the hook returns only `[{ label: "default", value: "default" }]`. The user can always proceed.
5. **Re-fetch on CLI change:** When the selected CLI changes (e.g., plan uses codex, build uses claude), the hook re-fetches. Spawner's internal cache deduplicates concurrent requests.

## Data Model

```typescript
// src/hooks/useModels.ts

interface ModelItem {
  label: string; // e.g. "Claude Opus 4 (claude-opus-4-20250514)"
  value: string; // e.g. "claude-opus-4-20250514"
}

interface UseModelsResult {
  items: ModelItem[]; // "default" prepended as first item
  loading: boolean;
}

const DEFAULT_ITEM: ModelItem = { label: "default", value: "default" };
```

## API / Interface

```typescript
// src/hooks/useModels.ts
import { listModels } from "@0xtiby/spawner";
import type { CliName } from "../types.js";

/**
 * React hook that fetches models for a given CLI asynchronously.
 * Re-fetches when `cli` changes. Spawner's internal cache handles dedup.
 *
 * @param cli - The CLI to fetch models for
 * @returns { items, loading } - model items for SelectInput, loading state
 */
export function useModels(cli: CliName): UseModelsResult;
```

### Internal behavior

1. `useState` for `items: ModelItem[]` (initially `[DEFAULT_ITEM]`) and `loading: boolean` (initially `true`)
2. `useEffect` triggers on `cli` change with `cancelled` flag for unmount safety:
   - Sets `loading = true`
   - Calls `await listModels({ cli, fallback: true })`
   - Maps results to `ModelItem[]` with `DEFAULT_ITEM` prepended
   - On catch (defensive — `fallback: true` should prevent throws): sets items to `[DEFAULT_ITEM]`
   - Sets `loading = false`
   - Cleanup function sets `cancelled = true` to prevent state updates on unmounted components
3. No UI-level timeout — spawner's internal 10s fetch timeout + stale cache fallback is sufficient

```typescript
// Reference implementation
useEffect(() => {
  let cancelled = false;
  setLoading(true);

  listModels({ cli, fallback: true })
    .then((models) => {
      if (!cancelled) {
        const mapped = models.map((m) => ({
          label: `${m.name} (${m.id})`,
          value: m.id,
        }));
        setItems([DEFAULT_ITEM, ...mapped]);
      }
    })
    .catch(() => {
      // Defensive: fallback: true should prevent this,
      // but handle gracefully regardless
      if (!cancelled) {
        setItems([DEFAULT_ITEM]);
      }
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });

  return () => { cancelled = true; };
}, [cli]);
```

### Data flow

```
User selects CLI
  → useModels(cli) hook
    → listModels({ cli, fallback: true })
      → spawner checks in-memory cache (24h TTL)
        → cache hit: return cached models
        → cache miss: fetch from models.dev
          → success: cache + return models
          → failure: return stale cache or built-in fallback
    → map to ModelItem[] + prepend "default"
  → render SelectInput
```

## Architecture

### File changes

| File | Change |
|------|--------|
| `src/hooks/useModels.ts` | **New** — shared hook |
| `src/commands/init.tsx` | Remove `getKnownModels` import, remove `modelItems()`, use `useModels` hook, add loading spinner in model phases |
| `src/commands/config.tsx` | Same changes as init.tsx, preserve `initialIndex` pattern |

### init.tsx changes

- Remove import: `getKnownModels` from `@0xtiby/spawner`
- Add import: `useModels` from `../hooks/useModels.js`
- Add import: `Spinner` from `ink-spinner`
- Remove function: `modelItems()` (lines 172-178)
- In `InteractiveInit`: call `const planModels = useModels(selections.planCli)` and `const buildModels = useModels(selections.buildCli)`
- In `plan_model` and `build_model` phases: show `<Spinner />` when `loading` is true, render `<SelectInput>` when ready

### config.tsx changes

- Remove import: `getKnownModels` from `@0xtiby/spawner`
- Add import: `useModels` from `../hooks/useModels.js`
- Add import: `Spinner` from `ink-spinner`
- Remove function: `modelItems()` (lines 177-183)
- In `ConfigEditor`: call `const planModels = useModels(values.planCli)` and `const buildModels = useModels(values.buildCli)`
- In `plan_model` and `build_model` phases: show `<Spinner />` when loading, render `<SelectInput>` when ready
- **Preserve `initialIndex` pattern:** ConfigEditor pre-selects the current model value. Use `initialIndex(planModels.items, values.planModel)` on the SelectInput — this works because `items` includes the same `{ value }` shape as before.

### Loading state UI

```tsx
// init.tsx pattern
{phase === "plan_model" && planModels.loading && (
  <Box>
    <Spinner type="dots" />
    <Text> Loading models...</Text>
  </Box>
)}

{phase === "plan_model" && !planModels.loading && (
  <Box flexDirection="column">
    <Text bold>Select model for planning ({selections.planCli}):</Text>
    <SelectInput items={planModels.items} onSelect={handlePlanModelSelect} />
  </Box>
)}
```

```tsx
// config.tsx pattern — note initialIndex for pre-selection
{phase === "plan_model" && planModels.loading && (
  <Box>
    <Spinner type="dots" />
    <Text> Loading models...</Text>
  </Box>
)}

{phase === "plan_model" && !planModels.loading && (
  <Box flexDirection="column">
    <Text>  model:</Text>
    <SelectInput
      items={planModels.items}
      initialIndex={initialIndex(planModels.items, values.planModel)}
      onSelect={(item) => {
        setValues((v) => ({ ...v, planModel: item.value }));
        setIterInput(String(values.planIterations));
        setPhase("plan_iterations");
      }}
    />
  </Box>
)}
```

## Edge Cases

- **Empty model list:** If `listModels` returns `[]` despite `fallback: true`, the hook returns `[{ label: "default", value: "default" }]` — user can always proceed.
- **CLI change during fetch:** When user picks a different CLI for build vs plan, the hook re-fetches. Spawner's internal cache deduplicates concurrent requests for the same CLI.
- **Component unmount during fetch:** The `useEffect` cleanup sets `cancelled = true` to prevent state updates on unmounted components.
- **Offline / network failure:** `fallback: true` ensures spawner returns built-in models silently. No error UI needed.
- **models.dev 500 error:** Same as offline — silent fallback.
- **initialIndex with missing model:** If the current config model isn't in the fetched list, `initialIndex` returns 0 (the "default" option) — existing behavior preserved.

## Acceptance Criteria

- **Given** a user runs `toby init` and selects a CLI, **when** the model selection phase loads, **then** a spinner is shown while models are fetched, followed by the model list from models.dev.
- **Given** a user runs `toby config` (editor), **when** they reach the model selection phase, **then** the same spinner + dynamic model list behavior applies, with the current model pre-selected.
- **Given** the models.dev fetch fails or user is offline, **when** the user reaches model selection, **then** the fallback built-in models are shown (no error displayed).
- **Given** the model list is empty, **when** the hook resolves, **then** only the "default" option is shown.
- **Given** the user selects different CLIs for plan and build, **when** each model phase loads, **then** models are fetched for the correct CLI.
- **Given** models were fetched successfully earlier in the same process, **when** the user reaches a second model selection phase for the same CLI, **then** cached models are returned without a network request.

## Testing Strategy

- **`useModels` hook:** Unit test with mocked `listModels`:
  - Verify loading state transitions (`loading: true` → items populated → `loading: false`)
  - Verify item mapping (`m.name (m.id)` format)
  - Verify "default" prepending as first item
  - Verify empty list handling → returns `[DEFAULT_ITEM]`
  - Verify re-fetch on CLI change
  - Mock `listModels` to reject → verify returns `[DEFAULT_ITEM]` and `loading: false`
- **`init.tsx`:** Update existing test mocks from `getKnownModels` to `listModels`.
- **`config.tsx`:** No mock updates needed — existing `config.test.tsx` tests `ConfigGet`/`ConfigSet`/`ConfigSetBatch` (not `ConfigEditor`), and `config.test.ts` tests pure functions. Neither uses `getKnownModels`.
