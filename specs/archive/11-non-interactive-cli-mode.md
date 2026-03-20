# Non-Interactive CLI Mode for Init and Config

## Overview

Add non-interactive (headless) mode to `toby init` and batch support to `toby config set`, enabling both commands to work in CI/CD pipelines, scripted setups, and non-TTY environments.

## Problem & Users

- **Primary user:** Developers scripting project setup (CI pipelines, dotfiles, team onboarding scripts)
- **Current workaround:** Manually create `.toby/config.json` by hand or run the interactive wizard
- **Cost of not solving:** Can't automate toby setup; blocks CI/CD integration

## Scope

### In scope

- `toby init` with `--plan-cli`, `--plan-model`, `--build-cli`, `--build-model`, `--specs-dir` flags
- Non-interactive init that validates CLIs are installed, creates project files, exits with proper codes
- `toby config set` with multiple `key=value` pairs in a single call
- Backward compatibility with existing `toby config set <key> <value>` syntax

### Out of scope

- Non-interactive config editor (full `toby config` wizard) — existing `get`/`set` covers this
- Global config (`~/.toby/`) init — that's created on first plan/build run
- Non-interactive `toby plan` or `toby build` — already headless by nature

## User Stories

- As a developer, I can run `toby init --plan-cli=claude --plan-model=default --build-cli=claude --build-model=default --specs-dir=specs` to set up toby without any interactive prompts
- As a developer, I can run `toby config set plan.cli=claude build.iterations=5` to set multiple config values in one command
- As a CI pipeline, I can run `toby init` with flags and get exit code 0 on success, 1 on failure

## Business Rules

### Non-interactive init

- **All five flags required:** `--plan-cli`, `--plan-model`, `--build-cli`, `--build-model`, `--specs-dir` must all be present to trigger non-interactive mode. Missing any flag falls back to interactive wizard.
- **CLI validation:** Runs `detectAll()` and verifies the specified `--plan-cli` and `--build-cli` are installed. Exits with code 1 and error message if not.
- **CLI value validation:** Only accepts `claude`, `codex`, or `opencode` as CLI values. Rejects anything else.
- **Idempotent:** Same as interactive — overwrites `config.json`, preserves `status.json` if it exists.
- **Creates:** `.toby/config.json`, `.toby/status.json` (if missing), `.toby/prd/`, specs directory (if missing).
- **Exit codes:** 0 on success, 1 on any error (invalid CLI, CLI not installed, filesystem error).
- **Output:** Minimal text output (no Ink rendering needed) — success message with created paths, or error message.

### Batch config set

- **Equals syntax:** `toby config set plan.cli=claude build.iterations=5` — each arg is a `key=value` pair.
- **Single-pair backward compat:** `toby config set plan.cli claude` still works. Detection: if no arg contains `=`, treat as legacy `key value` syntax.
- **Validation:** Each key validated against `VALID_KEYS`. Each value parsed and validated per key type. All pairs validated before writing any.
- **Atomic write:** All pairs written in a single `writeConfig` call — no partial writes on validation failure.
- **Exit codes:** 0 on success, non-zero on validation error.

## Edge Cases

- `toby init --plan-cli=invalid` → error: "Unknown CLI: invalid. Must be one of: claude, codex, opencode"
- `toby init --plan-cli=codex` but codex not installed → error: "CLI not installed: codex"
- `toby init` with only some flags (e.g. `--plan-cli` only) → falls back to interactive wizard
- `toby config set plan.cli=invalid` → validation error, nothing written
- `toby config set plan.cli=claude build.iterations=abc` → validation error for iterations, nothing written (atomic)
- `toby config set` with no args → existing error message ("Missing value for config set")
- Non-TTY environment with no flags → interactive wizard may fail; this is expected (use flags in CI)

## Data Model

No new types. Extends existing `InitFlags` interface:

```typescript
// src/commands/init.tsx
export interface InitFlags {
  version: string;
  planCli?: string;
  planModel?: string;
  buildCli?: string;
  buildModel?: string;
  specsDir?: string;
}
```

Existing `InitSelections`, `InitResult`, `createProject()`, and `getInstalledClis()` are reused unchanged.

## API / Interface

### CLI flags (meow)

```typescript
// src/cli.tsx — new flags added to meow config
flags: {
  // ... existing flags ...
  planCli:    { type: "string" },
  planModel:  { type: "string" },
  buildCli:   { type: "string" },
  buildModel: { type: "string" },
  specsDir:   { type: "string" },
}
```

meow auto-converts `--plan-cli` to `planCli` camelCase.

### Init component routing

```typescript
// src/commands/init.tsx

/** Check if all 5 flags are present for non-interactive mode */
function hasAllInitFlags(flags: InitFlags): boolean

/** Non-interactive init — validates, creates project, exits */
function NonInteractiveInit(props: Required<InitFlags>): React.ReactElement
```

The existing `Init` default export checks `hasAllInitFlags()` first — if true, renders `NonInteractiveInit`; otherwise renders the existing interactive wizard unchanged.

### Config batch set

```typescript
// src/commands/config.tsx

/** Parse and validate key=value pairs, write atomically */
function ConfigSetBatch({ pairs }: { pairs: string[] }): React.ReactElement
```

### Config routing update

```typescript
// src/cli.tsx — config command updated
config: {
  render: (_flags, input, version) => {
    const [, subcommand, ...rest] = input;
    if (subcommand === "set" && rest.some(arg => arg.includes("="))) {
      return <ConfigSetBatch pairs={rest} />;
    }
    // ... existing routing for get, set key value, editor ...
  }
}
```

## Architecture

### Module changes

- **`src/commands/init.tsx`** — Add `hasAllInitFlags()`, `NonInteractiveInit` component. Existing `Init` delegates based on flag check.
- **`src/commands/config.tsx`** — Add `ConfigSetBatch` component. Export it for use in `cli.tsx`.
- **`src/cli.tsx`** — Add 5 new meow flags. Pass them to `Init`. Update config routing to detect batch `=` syntax.

### Data flow (non-interactive init)

```
CLI args → meow parses flags → Init checks hasAllInitFlags()
  → true:  NonInteractiveInit → detectAll() → validate CLIs installed
           → createProject(selections) → print result → process.exit(0|1)
  → false: existing interactive wizard (unchanged)
```

### Data flow (batch config set)

```
CLI args → meow parses input → config routing detects "=" in args
  → ConfigSetBatch → parse each "key=value" → validate all keys/values
  → read existing config → merge all pairs → writeConfig() → print result
```

## Acceptance Criteria

- Given all 5 init flags are provided with valid values, when running `toby init`, then `.toby/config.json`, `.toby/status.json`, and specs dir are created without any interactive prompts
- Given all 5 init flags but `--plan-cli` is not installed, when running `toby init`, then exit code is 1 and error message names the missing CLI
- Given all 5 init flags but `--build-cli=invalid`, when running `toby init`, then exit code is 1 and error says "Unknown CLI"
- Given only 3 of 5 init flags, when running `toby init`, then the interactive wizard starts (falls back)
- Given no init flags, when running `toby init`, then the interactive wizard starts (existing behavior unchanged)
- Given `toby config set plan.cli=claude build.iterations=5`, when running, then both values are written to `.toby/config.json`
- Given `toby config set plan.cli=claude build.iterations=abc`, when running, then nothing is written and error message mentions iterations
- Given `toby config set plan.cli claude` (no `=`), when running, then existing single-pair behavior works unchanged
- Given non-TTY environment with all init flags, when running `toby init`, then it completes successfully without requiring TTY

## Testing Strategy

- Unit test: `hasAllInitFlags()` returns true only when all 5 flags present
- Unit test: `NonInteractiveInit` with valid flags calls `createProject` and renders success
- Unit test: `NonInteractiveInit` with unknown CLI value renders error
- Unit test: `NonInteractiveInit` with uninstalled CLI renders error (mock `detectAll`)
- Unit test: `ConfigSetBatch` parses `key=value` pairs correctly
- Unit test: `ConfigSetBatch` rejects invalid keys
- Unit test: `ConfigSetBatch` rejects invalid values (type mismatch)
- Unit test: `ConfigSetBatch` writes all pairs atomically (mock `writeConfig`)
- Unit test: existing `config set key value` still works (regression)
- Integration test: `toby init --plan-cli=claude --plan-model=default --build-cli=claude --build-model=default --specs-dir=specs` in temp dir creates expected files
