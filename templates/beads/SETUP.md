# Beads Setup

## Requirements

| Tool | Install | Purpose |
|---|---|---|
| `bd` | See [beads documentation](https://github.com/beads-project/beads) | Local task tracker CLI |

### Initialize

```bash
bd init
```

This creates a `.beads/` directory in the project root. Add `.beads/` to `.gitignore`.

## Config Variables

No config variables required. The `bd` CLI operates on the local `.beads/` directory automatically.

## How It Works

- **Plan** creates an epic and task issues using `bd create`, then wires dependencies with `bd dep add`.
- **Build** uses `bd ready` to find unblocked tasks, claims them with `bd update --status=in_progress`, and closes with `bd close`.
- Beads handles dependency resolution natively — `bd ready` only returns tasks whose blockers are all closed.

## File Structure

```
.beads/
  (managed internally by the bd CLI)
```
