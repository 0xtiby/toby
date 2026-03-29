# 51 — Init Command Migration

## Overview

Replace the Ink-based interactive setup wizard (`init.tsx`) with a sequential @clack/prompts flow. The init command walks users through CLI selection, model selection, specs directory, and verbose preference — then writes `.toby/config.json` and creates the specs directory.

## Problem

The current init command is a React component with multiple `useState`/`useEffect` hooks managing a multi-step wizard via `SelectInput` and `TextInput`. This crashes in non-TTY environments and adds unnecessary React complexity to what is fundamentally a linear prompt sequence.

## Scope

### In scope
- Replace Ink SelectInput/TextInput with @clack/prompts (select, text)
- Preserve non-interactive mode (all flags provided → skip prompts)
- Detect installed CLIs via `@0xtiby/spawner`
- Write `.toby/config.json`, create `.toby/status.json`, create specs directory
- Handle non-TTY gracefully (require flags or error with guidance)

### Out of scope
- Changing what init configures (same fields as today)
- Adding new init options
- Global config changes

## User Stories

- As a user, I can run `toby init` in a terminal and be guided through project setup with clear prompts.
- As a user, I can run `toby init --planCli claude --buildCli claude --planModel default --buildModel default --specsDir specs` to skip interactive prompts.
- As a CI script, I can provide all 5 init flags for fully non-interactive setup.
- As a user, I see only CLIs that are actually installed on my system in the selection.

## Business Rules

- CLI detection: scan for `claude`, `codex`, `opencode` binaries via spawner's `detectAll()`. Only show installed ones.
- If no CLIs detected: error with installation guidance.
- If only one CLI detected: auto-select it (skip prompt), inform user.
- Model listing: call `listModels({ cli, fallback: true })` from `@0xtiby/spawner`. Prepend "default" option.
- Interactive mode prompts for: plan CLI, plan model, build CLI, build model, specs directory, verbose.
- Config written to `.toby/config.json` with separate `plan` and `build` sections (each with cli, model, iterations defaults).
- Non-interactive mode requires all 5 flags: `--planCli`, `--planModel`, `--buildCli`, `--buildModel`, `--specsDir`. Detected via existing `hasAllInitFlags()` function.
- Non-interactive validates CLI names against `CLI_NAMES` and verifies CLIs are installed.
- `.toby/status.json` created with `{ specs: {} }` if not exists.
- Specs directory created if not exists.
- If `.toby/config.json` already exists: warn and ask to overwrite (or `--force` flag).

## UI/UX Flow

### Interactive (TTY)
```
┌ toby init
│
◆ Select CLI for planning
│ ● claude
│ ○ codex
│ ○ opencode
│
◆ Select model for planning
│ ● default
│ ○ claude-sonnet-4-20250514
│ ○ claude-opus-4-20250514
│
◆ Select CLI for building
│ ● claude  (same as plan)
│ ○ codex
│
◆ Select model for building
│ ● default
│
◆ Specs directory
│ specs
│
◆ Enable verbose output?
│ No
│
└ ✔ Project initialized
    Config: .toby/config.json
    Specs:  specs/
```

### Non-interactive (all 5 flags provided)
```
$ toby init --planCli claude --planModel default --buildCli claude --buildModel default --specsDir specs
✔ Project initialized
  Config: .toby/config.json
  Specs:  specs/
```

### Non-TTY without required flags
```
$ echo | toby init
✖ toby init requires an interactive terminal.
  Provide all flags: --planCli, --planModel, --buildCli, --buildModel, --specsDir
  Example: toby init --planCli claude --planModel default --buildCli claude --buildModel default --specsDir specs
```

## Data Model

No changes to `TobyConfig` or config schemas. Same shape written to disk.

## API / Interface

```typescript
// src/commands/init.ts
export async function runInit(ctx: CommandContext): Promise<void>;

// Reuse existing InitFlags interface and hasAllInitFlags() from current init.tsx.
// InitFlags maps to: { planCli, planModel, buildCli, buildModel, specsDir, verbose }
// hasAllInitFlags() returns true when all 5 required flags are present.

// Internal flow:
// 1. Build InitFlags from ctx (planCli, planModel, buildCli, buildModel, specsDir, verbose)
// 2. If hasAllInitFlags(flags) → non-interactive path (validate + write)
// 3. Else if !isTTY() → error with required flags hint
// 4. Else → interactive prompts for each missing value
// 5. Write config, create dirs, print summary
```

## Architecture

```
src/commands/init.ts    ← replaces init.tsx
src/hooks/useModels.ts  ← DELETE (inline listModels call in init.ts)
```

The `useModels` hook becomes a plain async call: `const models = await listModels({ cli, fallback: true })`.

## Edge Cases

- User cancels a prompt (Ctrl+C during clack prompt): clack returns a cancel symbol. Check with `clack.isCancel()` and exit cleanly.
- `listModels` fails or times out: fall back to `["default"]` (current behavior via `fallback: true`).
- `.toby/config.json` exists and no `--force`: prompt "Overwrite existing config?" or error in non-TTY.
- Specs directory already exists with files: skip creation, no error.

## Acceptance Criteria

- Given TTY and no flags, when user runs `toby init`, then clack prompts appear for cli, model, specsDir, verbose.
- Given all 5 flags provided, when user runs `toby init --planCli claude --planModel default --buildCli claude --buildModel default --specsDir specs`, then no prompts are shown and config is written.
- Given non-TTY and missing flags, when user runs `toby init`, then error message explains required flags.
- Given user presses Ctrl+C during a prompt, then process exits cleanly with no stack trace.
- Given only `claude` is installed, when user runs `toby init`, then `claude` is auto-selected and user is informed.
- Given `.toby/config.json` exists and no `--force`, when user runs `toby init`, then user is asked to confirm overwrite.
