# Init, Status & Config Commands

## Overview

Three supporting commands: `toby init` (interactive setup wizard), `toby status` (display spec/task state), and `toby config` (interactive editor + get/set CLI).

## Problem & Users

- **Init:** New users need to configure toby for their project — select CLI, set model preferences, create `.toby/` folder.
- **Status:** Users need to see where things stand — which specs are planned, building, done, and task progress within each.
- **Config:** Users need to modify settings without editing JSON manually.

---

## Init Command

### User Stories

- As a developer, I can run `toby init` in my project to set up toby with an interactive wizard
- As a developer, I can see which CLIs are available before choosing one

### UI/UX Flow

```
$ toby init

  toby v0.1.0

  Setting up toby in current directory...

  Detecting available CLIs...
  ✓ claude (v1.2.3) — authenticated
  ✗ codex — not installed
  ✗ opencode — not installed

  ? Select CLI for planning: (claude)
  ? Model for planning: (default)
  ? Select CLI for building: (claude)
  ? Model for building: (default)
  ? Specs directory: (specs)

  Creating .toby/ directory...
  ✓ .toby/config.json
  ✓ .toby/status.json
  ✓ specs/ (already exists)

  Toby is ready! Next steps:
    1. Add spec files to specs/ (e.g., specs/01-feature.md)
    2. Run `toby plan` to create a plan
    3. Run `toby build` to start building
```

### Business Rules

- **CLI detection:** Use spawner's `detectAll()` to check which CLIs are installed and authenticated.
- **Only show installed CLIs** as selectable options. If none installed, show error with install instructions.
- **Model selection:** Free text input. Default is "default" (meaning: don't pass model to CLI).
- **Specs directory:** Text input with default "specs". Creates directory if it doesn't exist.
- **Idempotent:** Running init twice overwrites config.json but preserves status.json if it exists.
- **Creates:** `.toby/config.json`, `.toby/status.json` (if missing), specs directory (if missing).
- **Default templateVars:** Init writes `templateVars: { PRD_PATH: ".toby/{{SPEC_NAME}}.prd.json" }` to config.json. This provides the shipped prompts' expected `{{PRD_PATH}}` variable out of the box.
- **Does NOT create** global `~/.toby/` — that's created on first plan/build run.

### Acceptance Criteria

- Given no CLI is installed, when running init, then error message with install instructions
- Given claude is installed, when running init, then claude is pre-selected
- Given init completes, then `.toby/config.json` exists with user's selections
- Given init completes, then `.toby/status.json` exists (empty default)
- Given specs directory doesn't exist, when init completes, then it's created
- Given init was already run, when running again, then config is overwritten, status preserved

---

## Status Command

### User Stories

- As a developer, I can run `toby status` to see all specs and their current state
- As a developer, I can run `toby status --spec=auth` to see detailed task progress for a specific spec

### UI/UX Flow

```
$ toby status

  toby v0.1.0

  Specs:
  ┌─────────────────┬──────────┬───────┬────────────┐
  │ Spec            │ Status   │ Tasks │ Iterations │
  ├─────────────────┼──────────┼───────┼────────────┤
  │ 01-auth         │ building │ 3/8   │ 5          │
  │ 02-payments     │ planned  │ 0/5   │ 2          │
  │ 03-notifications│ pending  │ —     │ 0          │
  └─────────────────┴──────────┴───────┴────────────┘

$ toby status --spec=auth

  toby v0.1.0

  Spec: 01-auth (building)

  Tasks:
  ┌──────────┬─────────────────────────────┬─────────────┐
  │ ID       │ Title                       │ Status      │
  ├──────────┼─────────────────────────────┼─────────────┤
  │ task-001 │ Add user schema             │ ✓ done      │
  │ task-002 │ Registration endpoint       │ ✓ done      │
  │ task-003 │ Login endpoint              │ ✓ done      │
  │ task-004 │ Session middleware          │ ● in_progress│
  │ task-005 │ Password reset flow         │ ○ pending   │
  │ task-006 │ Email verification          │ ○ pending   │
  │ task-007 │ Auth tests                  │ ○ blocked   │
  │ task-008 │ Auth UI components          │ ○ pending   │
  └──────────┴─────────────────────────────┴─────────────┘

  Iterations: 5
  Last session: abc-123 (2m ago)
  Total tokens: 180,000
```

### Business Rules

- **No arguments:** Show all specs in a summary table.
- **--spec flag:** Show detailed task-level view for one spec.
- **Task counts:** Read from prd.json. Show "—" if no prd.json exists.
- **Iteration count:** From status.json.
- **Total tokens:** Sum of all iterations' tokensUsed for that spec.

### Acceptance Criteria

- Given specs exist with various statuses, when running `toby status`, then a table shows all specs with status, task counts, iteration counts
- Given `--spec=auth`, when running, then detailed task list is shown
- Given a spec has no prd.json, when showing status, then tasks column shows "—"
- Given no .toby/ folder exists, when running status, then show "Toby not initialized. Run 'toby init' first."

---

## Config Command

### User Stories

- As a developer, I can run `toby config` to interactively edit my configuration
- As a developer, I can run `toby config get plan.cli` to see the current value
- As a developer, I can run `toby config set build.model opus` to change a value

### UI/UX Flow

```
$ toby config

  toby v0.1.0

  Current config (.toby/config.json):

  Plan:
    ? CLI: (claude)
    ? Model: (default)
    ? Iterations: (2)

  Build:
    ? CLI: (claude)
    ? Model: (default)
    ? Iterations: (10)

  General:
    ? Specs directory: (specs)
    ? Exclude specs: (README.md)
    ? Verbose: (false)

  ✓ Config saved to .toby/config.json

$ toby config get plan.cli
claude

$ toby config set build.iterations 20
✓ build.iterations set to 20
```

### Business Rules

- **No subcommand:** Interactive editor showing current values, user can modify inline.
- **`get <key>`:** Print the resolved value (after merge). Dot-notation for nested keys.
- **`set <key> <value>`:** Write to LOCAL config only (`.toby/config.json`). Create the file if missing.
- **Key format:** Dot-notation matching config structure (e.g., `plan.cli`, `build.model`, `specsDir`, `verbose`).
- **Valid keys whitelist:** Only keys in VALID_KEYS can be set via CLI: `plan.cli`, `plan.model`, `plan.iterations`, `build.cli`, `build.model`, `build.iterations`, `specsDir`, `verbose`, `transcript`. Other config fields (`templateVars`, `excludeSpecs`) must be edited in config.json directly.
- **Validation:** Values are validated against Zod schema before writing. Invalid values show error.

### Acceptance Criteria

- Given `toby config` with no args, when running, then interactive editor is shown with current values
- Given `toby config get plan.cli`, when running, then the resolved CLI name is printed
- Given `toby config set build.iterations 20`, when running, then `.toby/config.json` is updated
- Given `toby config set plan.cli invalid`, when running, then validation error is shown
- Given no `.toby/config.json` exists, when running `set`, then the file is created with just the set value

## Testing Strategy

- Unit test: Init creates correct directory structure
- Unit test: Init uses detectAll() results for CLI selection
- Unit test: Status renders table with correct data
- Unit test: Status --spec shows task details
- Unit test: Config get returns resolved values
- Unit test: Config set writes to local config
- Unit test: Config set validates values
