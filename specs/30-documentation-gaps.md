# 30 — Documentation Gaps

Close the gap between implemented features and user-facing documentation. Update existing docs with missing flags, commands, and config options; create two new guides (sessions, spec authoring); fix stale references; update README with new doc links.

## Problem

Twelve features implemented across specs 11–29 are undocumented or partially documented. Users discovering toby through the docs miss multi-spec selection, transcripts, crash recovery, spec number shorthand, and alphanumeric ordering — all shipped and working.

## Prerequisites

- **Spec 31 (Transcript CLI Wiring)** must be implemented before documenting `--transcript` / `--no-transcript` flags in reference.md. Until then, those flags are defined in meow but not wired to commands.

## Scope

### In scope

- Update `docs/reference.md` with all missing CLI flags, commands, and config options
- Update `docs/prompts.md` to fix stale `PRD_PATH` reference
- Create `docs/sessions.md` (session naming, transcripts, crash recovery)
- Create `docs/specs.md` (spec file format, naming, ordering, referencing)
- Update `README.md` with links to new docs and feature list refresh

### Out of scope

- `specs/README.md` index updates
- New tutorials or getting-started guides
- Restructuring existing doc files
- API or developer documentation

## Deliverables

### 1. Update `docs/reference.md`

#### 1a. Welcome screen note

Add a note in the Usage section (after the `toby <command> [options]` block) explaining that running `toby` without arguments launches an interactive menu with plan, build, status, and config options.

#### 1b. `plan` command — missing flags

Update the `--spec` row description to mention comma-separated multi-spec support and matching modes (exact name, filename, slug, numeric prefix).

Add `--transcript` and `--no-transcript` flags to the table (prerequisite: spec 31 must be implemented first).

Add an example showing multi-spec usage:

```
toby plan --spec=15,16,auth --session=auth-batch
```

#### 1c. `build` command — missing flags

Same additions as plan: update `--spec` description for multi-spec. Add `--transcript` / `--no-transcript` after spec 31 is implemented.

Add example:

```
toby build --spec=15,16 --session=my-session
```

#### 1d. `init` command — missing flag

Add to the init flags table:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--verbose` | boolean | `false` | Enable verbose output in generated config |

#### 1e. Config options table — missing option

Add `transcript` to the config options table:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transcript` | boolean | `false` | Record session output to `.toby/transcripts/` |

Add `transcript: false` to the full example JSON.

### 2. Update `docs/prompts.md`

#### 2a. Fix PROMPT_PLAN key variables

Line 13 currently reads:

```
Key variables used: `SPECS_DIR`, `SPEC_NAME`, `PRD_PATH`, `ITERATION`.
```

Change to:

```
Key variables used: `SPECS_DIR`, `SPEC_NAME`, `ITERATION`. Also commonly used with the config var `PRD_PATH` (see Config Variables below).
```

This correctly reflects that `PRD_PATH` is a user-defined config var, not a CLI var.

#### 2b. No other changes

The rest of `docs/prompts.md` is accurate. The config vars section already shows `PRD_PATH` as an example of a config var referencing CLI vars, which is correct.

### 3. Create `docs/sessions.md`

New file. Concise, user-facing guide. Sections:

#### 3a. Session Naming

- When running `plan` or `build`, toby creates a **session** to group iterations
- Single-spec with no `--session` flag: session name = spec slug (e.g., `auth-middleware`)
- Multi-spec with no `--session` flag: auto-generated name (e.g., `bold-tiger-42`)
- With `--session=<name>`: uses provided value
- Session name is used for branch naming and worktree identification

#### 3b. Transcripts

- Enable via `transcript: true` in config or `--transcript` CLI flag
- `--no-transcript` disables even if config enables it
- Transcripts are written to `.toby/transcripts/` as markdown files
- File naming: `<session>-<command>-<YYYYMMDD-HHmmss-SSS>.md`
- Content: metadata header, per-iteration sections, streamed CLI output
- Verbose mode (`verbose: true`) includes tool use and system events; non-verbose mode records text output only
- Transcripts stream in real-time and survive crashes

#### 3c. Crash Recovery

- If a build is interrupted (process killed, terminal closed, OOM), toby detects it on next run
- Detection: the last iteration's state is recorded as `in_progress` in `.toby/status.json`
- Running `toby build --spec=<name>` again automatically resumes:
  - Reuses the same session name (same worktree/branch)
  - If using the same CLI, continues the AI conversation where it left off
  - If switching CLIs (e.g., `--cli=opencode` after a claude crash), starts a fresh AI session in the same worktree

#### 3d. Exhaustion Resume

- If a build hits max iterations without completing (no sentinel detected), toby records `stopReason: "max_iterations"`
- Running `toby build --spec=<name>` again resumes in the same worktree with a fresh AI session
- Increase iterations if needed: `toby build --spec=<name> --iterations=20`

### 4. Create `docs/specs.md`

New file. Quick reference format (under 100 lines). Sections:

#### 4a. File Format

- Specs are markdown files in the specs directory (default: `specs/`)
- Any `.md` file in the directory is discovered as a spec
- Content is freeform — toby reads the file and passes it to the AI agent
- `excludeSpecs` in config filters filenames from discovery (default: `["README.md"]`)

#### 4b. Naming & Ordering

- **Numbered prefix**: `NN-name.md` (e.g., `01-project-setup.md`, `12-auth.md`)
- **Alphanumeric prefix**: `NNx-name.md` for inserting between numbers (e.g., `15a-validation.md`)
- Sort order: `15 < 15a < 15b < 16`; numbered specs before unnumbered
- Unnumbered specs sort alphabetically after all numbered ones
- Order determines processing sequence for `--all` mode

#### 4c. Referencing Specs

The `--spec` flag accepts multiple formats. Matching priority:

1. **Exact name**: `auth-middleware` matches `auth-middleware.md`
2. **Filename**: `auth-middleware.md`
3. **Slug**: `auth` matches `12-auth.md` (prefix stripped)
4. **Number**: `12` matches `12-auth.md`

Comma-separated for multi-spec: `--spec=15,16,auth`

#### 4d. Discovery & Exclusion

- Toby scans `specsDir` for `.md` files on every command
- Files listed in `excludeSpecs` config are skipped
- Default exclusion: `README.md`
- Spec status (pending/planned/building/done) comes from `.toby/status.json`, not the file itself

### 5. Update `README.md`

#### 5a. Documentation section

Add links to new docs after existing entries:

```markdown
## Documentation

- [CLI & Config Reference](docs/reference.md) — all commands, flags, and config.json options
- [Prompt Authoring Guide](docs/prompts.md) — how to write and customize prompt templates
- [Sessions & Transcripts](docs/sessions.md) — session naming, crash recovery, and transcript recording
- [Writing Specs](docs/specs.md) — spec file format, naming conventions, and ordering
```

#### 5b. Feature list

No other README changes needed — the current description and quick start accurately reflect the core workflow. The new docs cover the advanced features.

## Acceptance Criteria

### docs/reference.md

- Given the Usage section, when a user reads it, then there is a note explaining that `toby` with no arguments shows an interactive menu
- Given the `plan` flags table, when a user reads `--spec`, then the description mentions comma-separated values and matching modes (exact, slug, number)
- Given the `build` flags table, when a user reads `--spec`, then the description mentions comma-separated values and matching modes
- Given spec 31 is implemented, when a user reads plan/build flags tables, then `--transcript` and `--no-transcript` flags are listed
- Given the `init` flags table, when a user reads it, then `--verbose` flag is listed
- Given the config options table, when a user reads it, then `transcript` (boolean, default false) is listed
- Given the full config example JSON, when a user reads it, then `transcript: false` is present

### docs/prompts.md

- Given the PROMPT_PLAN section, when a user reads key variables, then `PRD_PATH` is described as a config var (not listed alongside CLI vars)

### docs/sessions.md

- Given a new user, when they read docs/sessions.md, then they understand how session names are generated (single-spec slug, multi-spec random, --session override)
- Given a user who wants transcripts, when they read the Transcripts section, then they know how to enable (`transcript: true` or `--transcript`), where files go (`.toby/transcripts/`), and what verbose mode affects
- Given a user whose build crashed, when they read Crash Recovery, then they know that re-running `toby build --spec=X` auto-resumes in the same worktree
- Given a user whose build ran out of iterations, when they read Exhaustion Resume, then they know to re-run with higher `--iterations`

### docs/specs.md

- Given a user creating their first spec, when they read File Format, then they know specs are markdown files in the specs directory
- Given a user organizing specs, when they read Naming & Ordering, then they understand `NN-` and `NNx-` prefixes and sort order
- Given a user running `--spec`, when they read Referencing Specs, then they know all matching modes (exact, filename, slug, number) and comma syntax
- Given a user wanting to exclude files, when they read Discovery & Exclusion, then they know about `excludeSpecs` config

### README.md

- Given the Documentation section, when a user reads it, then links to `docs/sessions.md` and `docs/specs.md` are present with descriptions

## Testing Strategy

Documentation specs are validated by inspection:

1. **Accuracy check**: Every flag, config option, and behavior described matches the current implementation (cross-reference with source code in `src/types.ts`, `src/cli.tsx`, `src/lib/template.ts`, `src/lib/specs.ts`, `src/lib/transcript.ts`, `src/commands/build.tsx`)
2. **Completeness check**: Every gap identified in this spec is addressed in the deliverable
3. **Link check**: All internal doc links resolve to existing files
4. **Example check**: All code examples use valid syntax and realistic values
