# 49 — CLI Entry Point & Arg Parsing

## Overview

Replace `meow` + Ink `render()` routing with `commander` for command registration, flag parsing, and help generation. The CLI entry point becomes a plain TypeScript file (`cli.ts`, no JSX) where each command is an async function — not a React component.

## Problem

The current `cli.tsx` uses meow for flag parsing then routes to Ink-rendered React components. This couples command dispatch to a React rendering lifecycle, causes non-TTY crashes (issue #32), and requires workarounds like `normalizeBooleanFlags` for meow v13 quirks.

## Scope

### In scope
- Replace meow with commander for arg parsing and help
- Convert `cli.tsx` → `cli.ts` (no JSX)
- Register all 7 commands as commander subcommands
- Wire each command to its `run()` async function
- Preserve all existing flags (names, types, defaults)
- Generate help text from commander (replace `src/lib/help.ts`)
- Handle `--version` via commander built-in
- Handle unknown commands with error + suggestion

### Out of scope
- Command implementation changes (separate specs)
- New flags or commands
- Global config changes

## User Stories

- As a user, I can run `toby <command> [flags]` with the same flags as today so that existing scripts don't break.
- As a user, I can run `toby --help` and `toby <command> --help` to see formatted help with usage, flags, and examples.
- As a user, I can run `toby` with no command to enter the welcome flow (spec 50).
- As a user, I see a clear error with valid command suggestions when I type an unknown command.

## Business Rules

- All current flags are preserved. Per-command flags from `MEOW_FLAGS`:
  - **Shared**: `--spec`, `--specs` (alias), `--all`, `--verbose`, `--transcript`, `--iterations`, `--cli`, `--session`, `--force`
  - **Init-only**: `--planCli`, `--planModel`, `--buildCli`, `--buildModel`, `--specsDir`
  - **Removed**: `--help` (commander built-in), `--detail` (never existed as a flag — status detail uses `--spec`)
- `--specs` remains an alias for `--spec` (resolved as: `specs ?? spec`)
- Boolean flags default to `undefined` (not `false`) so config hierarchy works — commander supports this natively, eliminating the `normalizeBooleanFlags` hack
- `--version` prints version from package.json
- Unknown flags produce an error (commander default)
- Flags are registered **per-command**, not globally — each command only exposes its relevant flags

## Data Model

```typescript
// Shared options type passed to all command run() functions.
// Maps 1:1 to the current MEOW_FLAGS in cli-meta.ts.
// Not all fields are used by every command — each command reads only what it needs.
interface CommandContext {
  // Shared flags (plan, build, resume)
  spec?: string;        // --spec / --specs (resolved alias)
  all?: boolean;        // --all
  verbose?: boolean;    // --verbose
  transcript?: boolean; // --transcript
  iterations?: number;  // --iterations
  cli?: string;         // --cli (runtime override)
  model?: string;       // --model (runtime override — not in current MEOW_FLAGS but used by config)
  session?: string;     // --session (build/resume session name)
  force?: boolean;      // --force (clean, init)

  // Init-specific flags
  planCli?: string;     // --planCli
  planModel?: string;   // --planModel
  buildCli?: string;    // --buildCli
  buildModel?: string;  // --buildModel
  specsDir?: string;    // --specsDir

  // Positional args (for config get/set subcommands)
  args: string[];
}
```

## API / Interface

```typescript
// src/cli.ts — new entry point
import { Command } from "commander";

const program = new Command()
  .name("toby")
  .description("AI-assisted development loop engine")
  .version(version)
  .action(() => runWelcome()); // no subcommand → welcome

program
  .command("plan")
  .description("Plan specs with AI loop engine")
  .option("--spec <name>", "Spec name or number")
  .option("--specs <name>", "Alias for --spec") // hidden or documented as alias
  .option("--all", "Plan all pending specs")
  .option("--verbose", "Show all events")
  .option("--cli <cli>", "Override CLI tool")
  .option("--iterations <n>", "Max iterations", parseInt)
  .option("--transcript", "Enable transcript recording")
  .action((opts) => runPlan({ ...opts, spec: opts.specs ?? opts.spec, args: [] }));

// build: same flags as plan + --session
// init: --planCli, --planModel, --buildCli, --buildModel, --specsDir, --verbose, --force
// config: positional args via .argument() for get/set subcommands
// status: --spec (for detail view)
// clean: --force
// resume: --verbose, --transcript

program
  .command("config")
  .description("Manage configuration")
  .argument("[subcommand]", "get or set")
  .argument("[args...]", "key and value(s)")
  .action((subcommand, args, opts) =>
    runConfig({ ...opts, args: subcommand ? [subcommand, ...args] : [] })
  );
```

## Architecture

```
src/cli.ts          ← new entry point (commander setup)
src/commands/*.ts   ← each exports run(ctx: CommandContext): Promise<void>
src/lib/help.ts     ← DELETE (commander generates help)
src/lib/cli-meta.ts ← SIMPLIFY: keep COMMAND_NAMES; remove MEOW_FLAGS, MEOW_FLAG_NAMES,
                       normalizeBooleanFlags (no longer needed — commander doesn't have
                       meow's boolean default issue)
```

### Migration steps
1. Create `src/cli.ts` with commander program definition
2. Register all commands with their per-command flags
3. Each `.action()` normalizes opts into `CommandContext` and calls `run()`
4. Config command uses `.argument()` for positional args (`get`/`set` subcommands)
5. Status uses `--spec` for detail view (not a separate `--detail` flag)
6. Remove meow dependency
7. Delete `src/lib/help.ts` (commander auto-generates help)
8. Simplify `cli-meta.ts` (remove meow-specific code)
9. Update `package.json` bin entry (still `./dist/cli.js`)

## Edge Cases

- `toby config get plan.cli` — positional args after subcommand. Commander handles this via `.argument()` on the config subcommand.
- `toby --spec foo plan` — flag before subcommand. Commander supports this when flags are on the parent program or with `enablePositionalOptions()`.
- `toby plan --specs a,b` — `--specs` alias for `--spec`. Use commander's `.option("--specs <name>")` as hidden alias.

## Acceptance Criteria

- Given the user runs `toby plan --spec 01-auth`, when commander parses, then `runPlan` receives `{ spec: "01-auth" }`.
- Given the user runs `toby --help`, then output lists all 7 commands with descriptions.
- Given the user runs `toby plan --help`, then output shows plan-specific flags with descriptions.
- Given the user runs `toby --version`, then output shows the version from package.json.
- Given the user runs `toby foo`, then output shows "unknown command 'foo'" with suggestion if similar.
- Given the user runs `toby` with no args in a TTY, then the welcome flow is triggered.
- Given the user runs `toby` with no args in a non-TTY, then help text is printed (no interactive prompt).
