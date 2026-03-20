# Configuration System

## Overview

Toby uses a layered configuration system with global defaults (`~/.toby/`) and local project overrides (`.toby/`). Configuration is JSON-based and covers CLI selection, model selection, iteration counts, spec folder location, and output verbosity.

## Problem & Users

Users need sensible defaults that work out of the box, but also the ability to customize per-project (e.g., use opus for planning, sonnet for building, different spec folder paths).

## Scope

### In Scope
- Global config at `~/.toby/config.json`
- Local config at `.toby/config.json` (overrides global)
- Deep merge: local values override global, unset values fall through
- Zod schema validation for config
- Path resolution for `~/.toby/` and `.toby/`
- Prompt file override chain: local `.toby/PROMPT_*.md` > global `~/.toby/PROMPT_*.md` > shipped `prompts/`
- Global `.toby/` directory creation on first CLI run (if missing)
- Local `.toby/` directory always has at least `status.json`

### Out of Scope
- Interactive config editing (spec 09)
- Init command (spec 09)

## Data Model

```typescript
import { z } from 'zod';

const CommandConfigSchema = z.object({
  cli: z.enum(['claude', 'codex', 'opencode']).default('claude'),
  model: z.string().default('default'),
  iterations: z.number().int().positive(),
});

const ConfigSchema = z.object({
  plan: CommandConfigSchema.extend({
    iterations: z.number().int().positive().default(2),
  }),
  build: CommandConfigSchema.extend({
    iterations: z.number().int().positive().default(10),
  }),
  specsDir: z.string().default('specs'),
  excludeSpecs: z.array(z.string()).default(['README.md']),
  verbose: z.boolean().default(false),
});

type Config = z.infer<typeof ConfigSchema>;
type CommandConfig = z.infer<typeof CommandConfigSchema>;
```

### Default config.json

```json
{
  "plan": {
    "cli": "claude",
    "model": "default",
    "iterations": 2
  },
  "build": {
    "cli": "claude",
    "model": "default",
    "iterations": 10
  },
  "specsDir": "specs",
  "excludeSpecs": ["README.md"],
  "verbose": false
}
```

## API / Interface

```typescript
// src/lib/paths.ts
export const GLOBAL_TOBY_DIR: string;    // ~/.toby
export const LOCAL_TOBY_DIR: string;     // .toby (relative to cwd)
export function getGlobalDir(): string;
export function getLocalDir(cwd?: string): string;
export function getPromptPath(name: string, cwd?: string): string;

// src/lib/config.ts
export function loadConfig(cwd?: string): Config;
export function loadGlobalConfig(): Partial<Config>;
export function loadLocalConfig(cwd?: string): Partial<Config>;
export function mergeConfigs(global: Partial<Config>, local: Partial<Config>): Config;
export function writeConfig(config: Partial<Config>, path: string): void;
export function resolveCommandConfig(
  config: Config,
  command: 'plan' | 'build',
  flags: { cli?: string; model?: string; iterations?: number }
): CommandConfig;
```

### Resolution Priority

For any config value:
1. CLI flag (`--cli`, `--model`, `--iterations`) — highest priority
2. Local `.toby/config.json`
3. Global `~/.toby/config.json`
4. Schema defaults — lowest priority

### Prompt File Resolution

For a prompt file like `PROMPT_PLAN.md`:
1. `.toby/PROMPT_PLAN.md` (local override)
2. `~/.toby/PROMPT_PLAN.md` (global override)
3. `<package>/prompts/PROMPT_PLAN.md` (shipped default)

Files must match by **exact filename** to override.

## Architecture

```
~/.toby/                          # Global (created on first run)
├── config.json                   # Global defaults
├── PROMPT_PLAN.md                # Optional global prompt overrides
├── PROMPT_BUILD.md
└── PROMPT_BUILD_ALL.md

<project>/.toby/                  # Local (created by init or first plan/build)
├── config.json                   # Project-specific overrides
├── status.json                   # Spec iteration tracking
├── prd/                          # Per-spec task files
│   ├── 01-auth.json
│   └── 02-payments.json
├── PROMPT_PLAN.md                # Optional local prompt overrides
├── PROMPT_BUILD.md
└── PROMPT_BUILD_ALL.md
```

## Business Rules

- `model: "default"` means the model flag is NOT passed to spawner — the CLI uses its own default
- Config files are optional — missing files produce empty partials, schema defaults fill the rest
- Invalid config values trigger a Zod validation error with clear message
- Global `.toby/` is created with default `config.json` on first CLI invocation if missing
- Local `.toby/` is created with `status.json` on first `plan` or `build` if missing

## Acceptance Criteria

- Given no config files exist, when loading config, then schema defaults are returned
- Given a global config with `plan.cli: "codex"`, when loading config with no local override, then plan.cli is "codex"
- Given a global config with `plan.cli: "codex"` and local config with `plan.cli: "claude"`, when loading config, then plan.cli is "claude"
- Given a local config with only `{ "verbose": true }`, when loading config, then all other values use global or defaults
- Given `--cli codex` flag, when resolving command config, then cli is "codex" regardless of config files
- Given `model: "default"` in config, when spawning, then no model flag is passed to spawner
- Given `PROMPT_PLAN.md` exists in local `.toby/`, when resolving prompt path, then local file is returned
- Given `PROMPT_PLAN.md` only exists in global `~/.toby/`, when resolving prompt path, then global file is returned
- Given no prompt overrides exist, when resolving prompt path, then shipped prompt from package is returned

## Edge Cases

- Corrupted JSON in config file: show parse error with file path, use defaults
- Config file is empty object `{}`: valid — all defaults apply
- Unknown keys in config: ignored (Zod `.passthrough()` or `.strip()`)
- `~/.toby/` not writable: warn and continue with defaults
- `model` set to empty string: treat as "default"

## Testing Strategy

- Unit test: `mergeConfigs` correctly deep-merges partial configs
- Unit test: `resolveCommandConfig` applies flag overrides
- Unit test: `loadConfig` returns defaults when no files exist
- Unit test: Prompt path resolution follows the 3-level chain
- Unit test: Zod validation rejects invalid values (negative iterations, unknown CLI name)
- Unit test: `model: "default"` is handled correctly
