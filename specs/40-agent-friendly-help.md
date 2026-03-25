# 40 — Agent-Friendly Help & Error Hints

## Overview

Make Toby's CLI help system optimized for AI agents that discover and invoke commands programmatically. Implements two-level progressive help (global overview → per-command detail with examples) and enriches error messages with correct invocation examples.

Inspired by [Building CLIs for Agents](https://x.com/ericzakariasson/status/2036762680401223946) best practices.

## Users & Problem

**Primary user:** AI agents (Claude, Codex, OpenCode) that invoke Toby as a tool.

**Problem:** The current `--help` output dumps all flags for all commands in one block. An agent must parse the entire help text to understand a single command. There are no usage examples — agents pattern-match on examples faster than they parse flag descriptions. Error messages show what went wrong but don't show the correct invocation.

**Impact:** Agents waste tokens parsing irrelevant help text, guess at flag combinations, and retry blindly on errors instead of self-correcting.

## Scope

### In scope
- Two-level help: `toby --help` (lean overview) and `toby <command> --help` (detailed + examples)
- 2–3 realistic examples per command
- Actionable error messages with example invocations
- Exit code 0 for all `--help` invocations

### Out of scope
- `--json` structured output (future spec)
- `--dry-run` flag (future spec)
- `--yes`/`--force` for non-clean commands (future spec)
- Man pages or external documentation generation

## User Stories

1. **As an AI agent**, I can run `toby --help` to get a concise list of available commands with one-line descriptions, so I can decide which command to explore further.

2. **As an AI agent**, I can run `toby plan --help` to see all flags and 2–3 realistic usage examples for the plan command, so I can construct the correct invocation on the first try.

3. **As an AI agent**, when I pass an invalid flag value (e.g. `--cli=gpt`), I get an error message that includes the valid values AND a correct example invocation, so I can self-correct without consulting help.

4. **As an AI agent**, I can rely on `--help` always exiting with code 0, so I can distinguish help output from command failures.

## Business Rules

1. `--help` flag takes precedence over all other flags — if present, show help and exit immediately.
2. `toby --help` shows ONLY: version, command list with one-liners, global options (`--help`, `--version`). No per-command flags.
3. `toby <command> --help` shows: command summary, all flags with descriptions, and 2–3 examples.
4. All `--help` invocations exit with code 0.
5. Error messages for invalid flag values MUST include: (a) what was wrong, (b) valid values, (c) a correct example invocation.
6. Per-command help is available for: `plan`, `build`, `init`, `status`, `config`.
7. Examples must use realistic flag combinations, not minimal single-flag usage.

## UI/UX Flows

### Global help output (`toby --help`)

```
toby v<version> — AI-assisted development loop engine

Usage
  $ toby <command> [options]

Commands
  plan     Plan specs with AI loop engine
  build    Build tasks one-per-spawn with AI
  init     Initialize toby in current project
  status   Show project status
  config   Manage configuration
  clean    Delete session transcripts

Options
  --help       Show help (use with a command for details)
  --version    Show version

Run toby <command> --help for command-specific options and examples.
```

### Per-command help output (`toby plan --help`)

```
toby plan — Plan specs with AI loop engine

Usage
  $ toby plan [options]

Options
  --spec=<query>     Target spec(s) by name, slug, number, or comma-separated list
  --specs=<names>    Alias for --spec
  --all              Plan all pending specs
  --iterations=<n>   Override iteration count
  --verbose          Show full CLI output
  --transcript       Save session transcript to file
  --cli=<name>       Override AI CLI (claude, codex, opencode)
  --session=<name>   Name the session for branch/PR naming

Examples
  $ toby plan --spec=auth --cli=claude --session=auth-feature
    Plan the auth spec using Claude, naming the session "auth-feature"

  $ toby plan --spec=auth,payments --iterations=3 --verbose
    Plan auth and payments specs with 3 iterations, showing full output

  $ toby plan --all --transcript
    Plan all pending specs and save a transcript of the session
```

### Per-command help output (`toby build --help`)

```
toby build — Build tasks one-per-spawn with AI

Usage
  $ toby build [options]

Options
  --spec=<query>     Target spec(s) by name, slug, number, or comma-separated list
  --specs=<names>    Alias for --spec
  --all              Build all planned specs in order
  --iterations=<n>   Override max iteration count
  --verbose          Show full CLI output
  --transcript       Save session transcript to file
  --cli=<name>       Override AI CLI (claude, codex, opencode)
  --session=<name>   Name the session for branch/PR naming

Examples
  $ toby build --spec=auth --cli=claude --session=auth-feature
    Build the auth spec using Claude, resuming the "auth-feature" session

  $ toby build --all --iterations=5 --transcript
    Build all planned specs with up to 5 iterations each, saving transcripts

  $ toby build --spec=2 --verbose
    Build spec #2 with full CLI output visible
```

### Per-command help output (`toby init --help`)

```
toby init — Initialize toby in current project

Usage
  $ toby init [options]

Options
  --plan-cli=<name>    Set plan CLI (claude, codex, opencode)
  --plan-model=<id>    Set plan model
  --build-cli=<name>   Set build CLI (claude, codex, opencode)
  --build-model=<id>   Set build model
  --specs-dir=<path>   Set specs directory
  --verbose            Enable verbose output in config

Examples
  $ toby init
    Launch the interactive setup wizard

  $ toby init --plan-cli=claude --plan-model=default --build-cli=claude --build-model=default --specs-dir=specs
    Non-interactive init with all required flags (for CI/agents)

  $ toby init --plan-cli=codex --build-cli=codex --specs-dir=specs --verbose
    Initialize with Codex for both phases, verbose output enabled
```

### Per-command help output (`toby status --help`)

```
toby status — Show project status

Usage
  $ toby status [options]

Options
  --spec=<query>   Show status for a specific spec by name, slug, or number

Examples
  $ toby status
    Show status overview for all specs in the project

  $ toby status --spec=auth
    Show detailed status for the auth spec
```

### Per-command help output (`toby config --help`)

```
toby config — Manage configuration

Usage
  $ toby config                           Interactive config editor
  $ toby config get <key>                 Show a config value (dot-notation)
  $ toby config set <key> <value>         Set a config value
  $ toby config set <k>=<v> [<k>=<v>...]  Batch set values

Examples
  $ toby config
    Open the interactive config editor

  $ toby config get plan.cli
    Show the configured plan CLI

  $ toby config set plan.cli=claude build.iterations=5
    Batch set plan CLI to claude and build iterations to 5
```

### Per-command help output (`toby clean --help`)

```
toby clean — Delete session transcripts

Usage
  $ toby clean [options]

Options
  --force   Skip confirmation prompt (required in non-TTY)

Examples
  $ toby clean
    Delete all transcripts with confirmation prompt

  $ toby clean --force
    Delete all transcripts without confirmation (for CI/agents)
```

### Error with hint (`toby plan --cli=gpt`)

```
✗ Unknown CLI: gpt. Valid options: claude, codex, opencode

Example:
  $ toby plan --cli=claude --spec=auth
```

### Error with hint (`toby unknown`)

```
✗ Unknown command: unknown

Available commands: plan, build, init, status, config, clean

Run toby --help for details.
```

## Edge Cases

1. **`toby --help` in non-TTY** — Same output as TTY. Help must use `process.stdout.write` (not Ink `<Text>`) to avoid ANSI escape sequences in piped contexts. All help lines must fit within 80 columns.
2. **`toby plan --help --spec=auth`** — `--help` takes precedence, shows help and exits 0. Ignores `--spec`.
3. **`toby config --help`** — Shows config subcommand help, not the interactive editor.
4. **`toby config set --help`** — Treated same as `toby config --help` (no sub-subcommand help).
5. **Multiple invalid flags** — Show error for the first invalid flag encountered with its hint.
6. **`toby --help --version`** — `--help` takes precedence over `--version`.

## Data Model

```typescript
/** Per-command help definition */
interface CommandHelp {
  /** One-line description (same as in global help) */
  summary: string;
  /** Usage pattern(s), one per line */
  usage: string[];
  /** Flag definitions */
  flags: FlagHelp[];
  /** 2-3 realistic usage examples */
  examples: CommandExample[];
}

interface FlagHelp {
  /** Flag with placeholder, e.g. "--spec=<query>" */
  name: string;
  /** What this flag does */
  description: string;
}

interface CommandExample {
  /** Full command invocation */
  command: string;
  /** What this example does */
  description: string;
}
```

## API / Interface

```typescript
/** Registry of per-command help — keyed by command name */
const commandHelp: Record<string, CommandHelp>;

/** Render global help (lean overview) */
function GlobalHelp({ version }: { version: string }): React.ReactElement;

/** Render per-command help with examples */
function CommandHelpView({
  command,
  help,
}: {
  command: string;
  help: CommandHelp;
}): React.ReactElement;

/** Render error with valid values and example invocation */
function ErrorWithHint({
  message,
  validValues?: string[];
  example?: string;
}: {
  message: string;
  validValues?: string[];
  example?: string;
}): React.ReactElement;
```

## Architecture

### Module structure

Extract help logic into a dedicated module rather than inlining everything in `cli.tsx`.

- **`src/lib/help.ts`** — New module containing:
  - `commandHelp` registry (static data, keyed by command name)
  - `formatGlobalHelp(version: string): string` — returns plain text global help
  - `formatCommandHelp(command: string, help: CommandHelp): string` — returns plain text per-command help
  - `formatErrorWithHint(message: string, validValues?: string[], example?: string): string` — returns plain text error with hint
  - All output uses `process.stdout.write` — no Ink rendering — to ensure clean piped/non-TTY output
  - All output lines must fit within 80 columns

- **`src/cli.tsx`** — Main changes:
  - Import help functions from `src/lib/help.ts`
  - Set meow `{ autoHelp: false }` and add `help: { type: 'boolean' }` to meow's flags definition so `--help` is explicitly parsed
  - Intercept `--help` flag before command routing:
    1. If `--help` and no command → `process.stdout.write(formatGlobalHelp(version))`, exit 0
    2. If `--help` and valid command → `process.stdout.write(formatCommandHelp(...))`, exit 0
    3. If `--help` and invalid command → render `UnknownCommand` error with hint, exit 1
  - Update `UnknownCommand` to list available commands
  - The `commandHelp` registry includes all commands in the `commands` map: plan, build, init, status, config, clean

- **`src/commands/init.tsx`** — Enrich CLI validation errors with example invocations
- **`src/commands/config.tsx`** — Enrich validation errors with example invocations

### Data flow

```
User runs: toby plan --help
  ↓
cli.tsx: meow parses flags (autoHelp: false)
  ↓
cli.tsx: detect --help flag BEFORE command routing
  ↓
cli.tsx: look up "plan" in commandHelp registry
  ↓
cli.tsx: render <CommandHelpView command="plan" help={commandHelp.plan} />
  ↓
cli.tsx: process.exitCode = 0, unmount
```

### Dependencies

- No new dependencies required
- Requires meow `autoHelp: false` and explicit `help: { type: 'boolean' }` in meow flags to take control of help rendering
- The `commandHelp` registry must stay in sync with the `commands` map and flag definitions — enforced by regression tests (see Testing Strategy)

## Acceptance Criteria

### Global help

- **Given** a user runs `toby --help`
- **When** the output is rendered
- **Then** it shows version, command list with one-liners, global options, and "Run toby <command> --help for command-specific options and examples"
- **And** it does NOT show per-command flags
- **And** the process exits with code 0

### Per-command help

- **Given** a user runs `toby plan --help`
- **When** the output is rendered
- **Then** it shows the plan command summary, all plan flags, and 2–3 examples
- **And** examples use realistic flag combinations
- **And** the process exits with code 0

- **Given** a user runs `toby <command> --help` for any of: plan, build, init, status, config, clean
- **When** the output is rendered
- **Then** it shows command-specific help with examples
- **And** the process exits with code 0

### Help precedence

- **Given** a user runs `toby plan --help --spec=auth --verbose`
- **When** `--help` is detected
- **Then** only help is shown, no command execution occurs
- **And** the process exits with code 0

### Error hints — invalid CLI

- **Given** a user runs `toby plan --cli=gpt`
- **When** the error is rendered
- **Then** it shows "Unknown CLI: gpt", lists valid CLIs, and shows a correct example
- **And** the process exits with code 1

### Error hints — unknown command

- **Given** a user runs `toby deploy`
- **When** the error is rendered
- **Then** it shows "Unknown command: deploy", lists available commands, and suggests `toby --help`
- **And** the process exits with code 1

### Non-TTY behavior

- **Given** the process is running in a non-TTY (piped) environment
- **When** `toby --help` or `toby plan --help` is invoked
- **Then** the same help text is rendered (plain text, no interactive components)
- **And** the process exits with code 0

## Testing Strategy

- **Unit tests** for `formatGlobalHelp` and `formatCommandHelp` — snapshot tests for output format; verify all lines are ≤ 80 columns
- **Unit tests** for `formatErrorWithHint` — verify error message, valid values, and example are rendered
- **Integration test** verifying `--help` intercepts before command execution (mock command render, assert not called)
- **Integration test** verifying exit code 0 for all `--help` variants
- **Regression test** ensuring `commandHelp` registry has an entry for every key in `commands` map
- **Regression test** ensuring every flag name in `commandHelp[cmd].flags` matches a flag defined in meow's flags for that command — prevents help text from drifting out of sync with actual flag definitions
