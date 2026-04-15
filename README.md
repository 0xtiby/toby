# toby

> Turn markdown specs into working code with AI-powered plan and build loops

[![npm version](https://img.shields.io/npm/v/@0xtiby/toby)](https://www.npmjs.com/package/@0xtiby/toby)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What It Does

You write a markdown spec describing what you want built. Toby sends it to an AI CLI that plans the implementation, then iteratively builds it - generating code, running validation, and committing results until the spec is complete. You get working code from a plain-English description, with full visibility into every step.

## Quick Start

```bash
npm install -g @0xtiby/toby
```

Create a spec file at `specs/01-add-auth.md`:

```markdown
# Add Authentication

## Requirements
- Add JWT-based login and signup endpoints
- Hash passwords with bcrypt
- Protect all /api routes with auth middleware

## Acceptance Criteria
- POST /auth/signup creates a user and returns a token
- POST /auth/login returns a token for valid credentials
- Unauthenticated requests to /api/* return 401
```

Run toby:

```bash
toby init
toby plan --spec=add-auth
toby build --spec=add-auth
toby status
```

## How It Works

Toby follows a three-phase loop:

```
  Spec (you write)       Plan (AI reads)        Build (AI iterates)
 ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐
 │  Markdown     │───>│  Analyze codebase│───>│  Implement tasks  │
 │  description  │    │  Produce PRD     │    │  Validate & commit│
 └──────────────┘    └──────────────────┘    │  Loop until done  │
                                              └───────────────────┘
```

1. **Spec** - You write a markdown file describing what you want built (features, acceptance criteria, constraints).
2. **Plan** - Toby sends your spec to an AI CLI, which analyzes the codebase and produces a structured implementation plan.
3. **Build** - Toby iteratively executes each task through the AI CLI, running validation between iterations.

During build, the AI signals completion by emitting a sentinel value (`:::TOBY_DONE:::`) and toby stops the loop. Other stop reasons: `max_iterations` (hit the limit), `error` (non-retryable failure), or `aborted` (user interrupted).

## Writing Specs

Specs are freeform markdown files in your `specsDir` (default: `specs/`). There is no required structure - write whatever helps the AI understand the feature.

Use a numeric prefix to control execution order: `NN-slug.md` (e.g., `01-setup.md`, `02-data-model.md`, `15a-auth-api.md`). Unnumbered specs sort alphabetically after numbered ones.

Target multiple specs with comma-separated queries (`--spec=auth,dashboard`) or build everything with `--all`. See [docs/specs.md](docs/specs.md) for naming rules, match priority, and discovery details.

## Configuration

`toby init` creates a `.toby/config.json` with sensible defaults:

```json
{
  "plan": { "cli": "claude", "model": "default", "iterations": 2 },
  "build": { "cli": "claude", "model": "default", "iterations": 10 },
  "specsDir": "specs",
  "verbose": false,
  "transcript": false,
  "templateVars": {}
}
```

**Resolution order:** local `.toby/config.json` > global `~/.toby/config.json` > built-in defaults. Local values override global values; nested objects are shallow-merged.

Manage settings interactively with `toby config` or directly with `toby config set plan.cli codex`. See [docs/reference.md](docs/reference.md) for all config options.

## Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `toby init` | Initialize toby in your project | `--plan-cli`, `--build-cli`, `--specs-dir` |
| `toby plan` | Generate an implementation plan from a spec | `--spec`, `--all`, `--iterations`, `--cli` |
| `toby build` | Iteratively build a planned spec with AI | `--spec`, `--all`, `--iterations`, `--cli` |
| `toby status` | Show progress across all specs | `--spec` |
| `toby config` | Manage CLI, model, and project settings | `get <key>`, `set <key> <value>` |
| `toby clean` | Delete transcript files | `--force` |

Both `plan` and `build` accept `--session=<name>` for explicit session naming and `--verbose` for full CLI output. See [docs/reference.md](docs/reference.md) for the complete flag reference.

## Advanced Features

### Custom Prompts

Toby resolves prompts through a three-level chain: project `.toby/` > user `~/.toby/` > shipped defaults. Override any prompt by placing a file like `PROMPT_PLAN.md` or `PROMPT_BUILD.md` in your `.toby/` directory. See [docs/prompts.md](docs/prompts.md) for the override chain and a step-by-step walkthrough.

### Template Variables

Define custom `{{VAR}}` placeholders in your config under `templateVars`. Config vars can reference CLI-computed vars like `SPEC_NAME` and `ITERATION`, enabling dynamic paths such as `"PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json"`. See [docs/prompts.md](docs/prompts.md) for the full variable reference.

### Transcripts

Enable transcript recording with `--transcript` or `toby config set transcript true`. Toby writes CLI output to `.toby/transcripts/` in real time, capturing every event in verbose mode. See [docs/sessions.md](docs/sessions.md) for file naming and content modes.

### Crash Recovery

If a build is interrupted, toby detects the incomplete iteration on the next run and automatically resumes - reusing the session name, worktree, and conversation context. If you hit the iteration limit, just re-run the same command or increase it with `--iterations`. See [docs/sessions.md](docs/sessions.md) for details on resume behavior and CLI switching.

## Development

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Link globally for local testing
pnpm link --global

# Unlink when done
pnpm unlink --global @0xtiby/toby
```

## Documentation

- [CLI & Config Reference](docs/reference.md) - all commands, flags, and config options
- [Prompt Authoring Guide](docs/prompts.md) - prompt templates, variables, and custom overrides
- [Tracker Templates](docs/trackers.md) - choose between prd-json, GitHub Issues, or beads for task tracking
- [Writing Specs](docs/specs.md) - spec format, naming conventions, and ordering
- [Sessions & Transcripts](docs/sessions.md) - session naming, crash recovery, and transcript recording

## License

MIT
