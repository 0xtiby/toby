# 52 — Config Command Migration

## Overview

Replace the Ink-based `ConfigEditor` component with @clack/prompts for interactive config editing, and use plain `console.log` for `config get`/`config set` subcommands.

## Problem

The current config command uses Ink SelectInput and TextInput for a step-by-step editor, which is unnecessarily coupled to React lifecycle and fails in non-TTY contexts.

## Scope

### In scope
- `toby config` (no args) → interactive editor via @clack/prompts
- `toby config get <key>` → print value to stdout
- `toby config set <key> <value>` → write value, print confirmation
- `toby config set <key1>=<val1> <key2>=<val2>` → batch set
- Non-TTY handling for interactive mode

### Out of scope
- Changing valid config keys
- Config file format changes

## User Stories

- As a user, I can run `toby config` to interactively edit all settings with a guided flow.
- As a user, I can run `toby config get plan.cli` to read a single config value.
- As a user, I can run `toby config set plan.iterations 3` to set a value.
- As a script, I can use `toby config get` and `toby config set` non-interactively.

## Business Rules

- Valid keys: `plan.cli`, `plan.model`, `plan.iterations`, `build.cli`, `build.model`, `build.iterations`, `specsDir`, `verbose`, `transcript`
- For CLI fields: validate against known CLI names (`claude`, `codex`, `opencode`)
- For model fields: list models dynamically from spawner
- For iterations: validate positive integer
- For boolean fields: accept `true`/`false` strings
- `get` with invalid key: error listing valid keys
- `set` with invalid key or value: error with valid options

## UI/UX Flow

### Interactive editor (`toby config`)
```
┌ toby config
│
◆ Which setting to edit?
│ ● plan.cli (claude)
│ ○ plan.model (default)
│ ○ plan.iterations (5)
│ ○ build.cli (claude)
│ ○ build.model (default)
│ ○ build.iterations (10)
│ ○ specsDir (specs)
│ ○ verbose (false)
│ ○ transcript (true)
│
◆ Select CLI for plan
│ ● claude
│ ○ codex
│
└ ✔ Updated plan.cli = claude
```

### Get/Set (non-interactive, works in any context)
```
$ toby config get plan.cli
claude

$ toby config set plan.iterations 3
✔ plan.iterations = 3
```

## API / Interface

```typescript
// src/commands/config.ts
export async function runConfig(ctx: CommandContext): Promise<void>;

// Routing based on positional args (ctx.args):
// []                           → interactive editor (TTY required)
// ["get"]                      → list all config values
// ["get", key]                 → print single value
// ["set", key, value]          → set single value
// ["set", "k1=v1", "k2=v2"]   → batch set (= notation, existing ConfigSetBatch behavior)

// Existing helper functions reused from current config.tsx:
//   getNestedValue(obj, key) — reads dot-notation path (e.g., "plan.cli")
//   setNestedValue(obj, key, value) — writes dot-notation path
//   parseValue(raw, type) — converts string to typed value (number, boolean, string)
//   readMergeWriteConfig(mutations) — atomic read-merge-write cycle
//   VALID_KEYS — list of valid config keys with their types
```

## Architecture

```
src/commands/config.ts  ← replaces config.tsx
```

No new lib files needed. Uses existing `loadConfig`, `writeConfig` from `src/lib/config.ts`.
Helper functions (`getNestedValue`, `setNestedValue`, `parseValue`, `VALID_KEYS`) currently live inside `config.tsx` — migrate them to `config.ts` as-is.

## Edge Cases

- `toby config` in non-TTY: error suggesting `config get`/`config set`.
- `toby config get` with no key: list all config values as `key = value` lines.
- `toby config set plan.cli foo`: error "Invalid CLI 'foo'. Valid: claude, codex, opencode".
- User cancels interactive editor (Ctrl+C): exit cleanly, no partial writes.

## Acceptance Criteria

- Given TTY, when user runs `toby config`, then clack select shows all settings with current values.
- Given `toby config get plan.cli` and config has `claude`, then stdout prints `claude`.
- Given `toby config set build.iterations 3`, then config file is updated and confirmation printed.
- Given `toby config set plan.cli invalid`, then error lists valid CLI names.
- Given non-TTY, when user runs `toby config` (no subcommand), then error suggests using `get`/`set`.
