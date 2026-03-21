# CLI Command Reference

## Usage

```
toby <command> [options]
```

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
| `--spec=<name>` | string | — | Plan a specific spec |
| `--all` | boolean | `false` | Plan all pending specs |
| `--iterations=<n>` | number | — | Override iteration count |
| `--verbose` | boolean | `false` | Show full CLI output |
| `--cli=<name>` | string | — | Override AI CLI (`claude`, `codex`, `opencode`) |
| `--session=<name>` | string | — | Name the session for branch/PR naming |

**Example:**

```
toby plan --spec=auth --iterations=3 --verbose
```

---

### `build`

Build tasks one-per-spawn with AI.

```
toby build [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--spec=<name>` | string | — | Build a specific planned spec |
| `--all` | boolean | `false` | Build all planned specs in order |
| `--iterations=<n>` | number | — | Override max iteration count |
| `--verbose` | boolean | `false` | Show full CLI output |
| `--cli=<name>` | string | — | Override AI CLI (`claude`, `codex`, `opencode`) |
| `--session=<name>` | string | — | Name the session for branch/PR naming |

**Example:**

```
toby build --spec=auth --all --cli=codex
```

---

### `init`

Initialize toby in current project. Creates a `toby.config.json` file with project defaults.

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
