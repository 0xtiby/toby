# CLI Command Reference

## Usage

```
toby <command> [options]
```

Running `toby` without arguments shows an interactive menu to select a command.

## Global Options

| Flag | Description |
|------|-------------|
| `--help` | Show help |
| `--version` | Show version |

---

### `plan`

Plan specs with AI loop engine.

```
toby plan [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--spec=<name>` | string | — | Plan a specific spec. Supports comma-separated values and matching by exact name, filename, slug, or numeric prefix |
| `--all` | boolean | `false` | Plan all pending specs |
| `--iterations=<n>` | number | — | Override iteration count |
| `--verbose` | boolean | `false` | Show full CLI output |
| `--cli=<name>` | string | — | Override AI CLI (`claude`, `codex`, `opencode`) |
| `--session=<name>` | string | — | Name the session for branch/PR naming |

**Examples:**

```
toby plan --spec=auth --iterations=3 --verbose
toby plan --spec=auth,dashboard,15a
```

---

### `build`

Build tasks one-per-spawn with AI.

```
toby build [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--spec=<name>` | string | — | Build a specific planned spec. Supports comma-separated values and matching by exact name, filename, slug, or numeric prefix |
| `--all` | boolean | `false` | Build all planned specs in order |
| `--iterations=<n>` | number | — | Override max iteration count |
| `--verbose` | boolean | `false` | Show full CLI output |
| `--cli=<name>` | string | — | Override AI CLI (`claude`, `codex`, `opencode`) |
| `--session=<name>` | string | — | Name the session for branch/PR naming |

**Examples:**

```
toby build --spec=auth --all --cli=codex
toby build --spec=01,02,03
```

---

### `init`

Initialize toby in current project. Creates a `.toby/config.json` file with project defaults.

```
toby init [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plan-cli=<name>` | string | — | Set plan CLI (`claude`, `codex`, `opencode`) |
| `--plan-model=<id>` | string | — | Set plan model |
| `--build-cli=<name>` | string | — | Set build CLI (`claude`, `codex`, `opencode`) |
| `--build-model=<id>` | string | — | Set build model |
| `--specs-dir=<path>` | string | — | Set specs directory |
| `--verbose` | boolean | `false` | Show full CLI output |

**Example:**

```
toby init --plan-cli=claude --build-cli=codex --specs-dir=specs
```

---

### `status`

Show project status — lists all specs with their current state, iteration count, and token usage.

```
toby status [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--spec=<name>` | string | — | Show detailed status for a specific spec |

**Example:**

```
toby status --spec=auth
```

---

### `config`

Manage configuration. Runs an interactive editor when invoked without arguments.

```
toby config [subcommand] [args]
```

No additional flags — config uses positional subcommands:

| Subcommand | Description |
|------------|-------------|
| *(none)* | Open interactive config editor |
| `get <key>` | Show a config value (dot-notation) |
| `set <key> <value>` | Set a config value |
| `set <k>=<v> [<k>=<v> ...]` | Batch set config values |

**Examples:**

```
toby config                          # interactive editor
toby config get plan.cli             # show a value
toby config set plan.cli claude      # set a value
toby config set plan.cli=claude build.cli=codex  # batch set
```

---

## Configuration

### Config File Locations

| Location | Path | Purpose |
|----------|------|---------|
| Local | `<project>/.toby/config.json` | Per-project settings |
| Global | `~/.toby/config.json` | User-wide defaults |

**Resolution order:** local > global > built-in defaults. Local values override global values. For nested objects (`plan`, `build`), keys are shallow-merged — local keys override matching global keys while preserving unset ones.

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `plan.cli` | `"claude"` \| `"codex"` \| `"opencode"` | `"claude"` | AI CLI used for planning |
| `plan.model` | string | `"default"` | Model identifier passed to the CLI |
| `plan.iterations` | number | `2` | Max planning iterations per spec |
| `build.cli` | `"claude"` \| `"codex"` \| `"opencode"` | `"claude"` | AI CLI used for building |
| `build.model` | string | `"default"` | Model identifier passed to the CLI |
| `build.iterations` | number | `10` | Max build iterations per spec |
| `specsDir` | string | `"specs"` | Directory containing spec markdown files |
| `excludeSpecs` | string[] | `["README.md"]` | Filenames to skip during spec discovery |
| `verbose` | boolean | `false` | Show full CLI output during runs |
| `transcript` | boolean | `false` | Record session output to `.toby/transcripts/` |
| `templateVars` | Record\<string, string\> | `{}` | Custom variables injected into prompt templates |

### Full Example

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
  "verbose": false,
  "transcript": false,
  "templateVars": {}
}
```
