# Template Variable System

## Overview

Replace the current over-engineered template variable infrastructure (frontmatter declarations, per-command `templateVars`, `BUILTIN_VARS`) with a clean two-category model: **CLI vars** that toby always computes from runtime state, and **config vars** that users define once at the root level. Config var values can reference CLI vars, enabling dynamic paths without code changes. This makes the prompt system composable — different workflows just configure different vars and swap prompts.

## Problem Statement

**Who:** Users writing custom prompts and maintainers extending toby
**Problem:** The current variable system has accumulated complexity that doesn't serve users — frontmatter declarations that can never fail, per-command `templateVars` that duplicate config, built-in vars that are never supplied, and config vars that can't reference runtime values. The result: unresolved `{{VAR}}` placeholders in prompts, dead infrastructure in code, and unnecessary friction when adding workflows.
**Impact:** Adding a new workflow requires understanding multiple interacting systems (frontmatter, per-command vars, built-in vars). Simplifying to two categories removes this friction and makes toby workflow-agnostic.

## Scope

### Included

- Define 8 CLI vars: `SPEC_NAME`, `SPEC_SLUG`, `ITERATION`, `SPEC_INDEX`, `SPEC_COUNT`, `SESSION`, `SPECS`, `SPECS_DIR`
- Move `templateVars` from per-command config to root level
- Support CLI var interpolation inside config var values (multiple references per value allowed)
- Two-step variable resolution: resolve config vars first (substituting CLI vars into their values), then merge and substitute into prompt
- CLI vars take precedence over config vars on name conflicts (with verbose-mode warning)
- Remove frontmatter parsing infrastructure (declaration, validation, and related types)
- Remove per-command `templateVars` from config schema
- Remove `BUILTIN_VARS` constant and related dead code
- Add `--session` CLI flag for plan and build commands
- Update `toby init` to generate `templateVars` at root level
- Add `SPECS_DIR` as a CLI var so prompts can reference the specs directory path

### Excluded

- Config vars referencing other config vars (only CLI var interpolation)
- Transform expressions in config values (e.g., strip prefix, uppercase)
- Conditional logic in templates
- Changes to the loop engine or status tracking
- Changes to the 3-level prompt override chain (local > global > shipped)
- Prompt content changes (covered in `17-prompt-simplification.md`)

### Constraints

- All variable values are strings (template substitution operates on strings)
- Unresolved `{{VAR}}` patterns after substitution are left as literal text — no error, no warning

## User Stories

### Primary Flow

- [ ] As a user, I can define `templateVars` once at the root of my config and both plan and build prompts use them, instead of duplicating vars per command
- [ ] As a user writing a custom prompt, I can reference `{{SPEC_NAME}}` inside my config var values (e.g., `"PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json"`) and toby resolves them before substituting into the prompt
- [ ] As a user running `toby build --all --session=my-feature`, the prompt receives `SESSION=my-feature` for branch/PR naming
- [ ] As a user, I can reference multiple CLI vars in a single config var value (e.g., `"REPORT": "reports/{{SESSION}}/{{SPEC_NAME}}.md"`)

### Secondary Flows

- [ ] As a user running a single-spec build with no `--session` flag, `SESSION` defaults to the spec slug so I get a sensible branch name automatically
- [ ] As a user running `toby build --all` with no `--session` flag, `SESSION` is a generated random human-readable name, consistent across all specs in the session
- [ ] As a user swapping to a beads workflow, I override the prompts and set `templateVars: {}` — no code changes needed, only CLI vars are available

## Business Rules

### CLI Vars

Toby always computes these from runtime state:

| Var | Description | Example |
|-----|-------------|---------|
| `SPEC_NAME` | Full spec filename without extension | `12-decouple-prd-from-code` |
| `SPEC_SLUG` | Spec name with single leading `\d+-` prefix stripped | `decouple-prd-from-code` |
| `ITERATION` | Current iteration in the inner loop (1-based) | `3` |
| `SPEC_INDEX` | Position of current spec in session (1-based) | `2` |
| `SPEC_COUNT` | Total specs in this session | `5` |
| `SESSION` | Session name — from `--session` flag or auto-generated | `my-feature` |
| `SPECS` | All spec names in session, comma-separated | `12-foo,13-bar` |
| `SPECS_DIR` | The specs directory path from config | `specs` |

### SPEC_SLUG Computation

- Strip a single leading numeric-dash prefix using pattern `^\d+-`
- `12-decouple-prd-from-code` becomes `decouple-prd-from-code`
- `12-03-nested` becomes `03-nested` (only one prefix stripped)
- `no-number-prefix` stays `no-number-prefix`

### SESSION Defaults

- Single-spec run (`SPEC_COUNT=1`), no `--session` flag: `SESSION` defaults to `SPEC_SLUG`
- Multi-spec run (`SPEC_COUNT>1`), no `--session` flag: `SESSION` is a generated random human-readable name (e.g., `bold-tiger-42`), consistent across all specs in the session
- When `--session` is provided: that value is used regardless of spec count

### Config Vars

- Defined at root level in config: `templateVars: Record<string, string>`
- Config var values can contain any number of `{{CLI_VAR}}` references
- Config vars cannot reference other config vars — only CLI vars
- If a config var has the same name as a CLI var, the CLI var wins and a warning is logged when `verbose: true`

### Resolution Order

1. Compute CLI vars from runtime state
2. For each config var value, substitute CLI var references into it — producing resolved config vars
3. Merge: `{ ...resolved_config_vars, ...cli_vars }` (CLI wins on name conflict)
4. Substitute merged vars into prompt template
5. Any remaining `{{VAR}}` patterns are left as literal text

### Config Schema Changes

- `templateVars` is removed from per-command config (no longer nested under `plan` or `build`)
- `templateVars` is added at the root level of the config
- Default value is `{}`

### Default Init Config

When `toby init` generates a config, `templateVars` appears at root level:
```
templateVars: { "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json" }
```

### Session Flag

- `--session <name>` is accepted by `plan` and `build` commands
- Value is accepted as-is (user's responsibility to use sensible names)
- No validation on characters or length

### Removed Capabilities

- Frontmatter parsing in prompts (the `required_vars` / `optional_vars` declaration system) — no longer needed
- Frontmatter validation that checked whether required vars were present — no longer needed
- The hardcoded list of built-in variable names — replaced by runtime computation
- Per-command `templateVars` in config — moved to root level
- The separate "build all" prompt name — unified into the single build prompt
- The `loadPrompt` caller no longer passes config vars separately — it passes pre-merged vars

## Edge Cases

| Condition | Expected Behavior |
|-----------|-------------------|
| Config var value with no `{{}}` references | Treated as static string, passed through as-is |
| Config var referencing non-existent CLI var (e.g., `{{NOPE}}`) | Left as `{{NOPE}}` in the resolved value |
| Empty `templateVars: {}` in config | Valid — only CLI vars available for substitution |
| Config var shadows a CLI var | CLI var wins; warning logged if `verbose: true` |
| Spec name with no number prefix (e.g., `auth`) | `SPEC_SLUG` equals `SPEC_NAME` |
| Single spec run | `SPEC_INDEX=1`, `SPEC_COUNT=1`, `SPECS` contains just one name |
| `--session` with spaces or special characters | Accepted as-is |
| Multiple CLI var references in one config value | All are resolved (e.g., `{{SESSION}}/{{SPEC_NAME}}` both substituted) |

## Acceptance Criteria

### CLI var computation

- [ ] **Given** `SPEC_NAME: "12-decouple-prd-from-code"`, **when** computing CLI vars, **then** `SPEC_SLUG` is `"decouple-prd-from-code"`
- [ ] **Given** `SPEC_NAME: "no-number-prefix"`, **when** computing CLI vars, **then** `SPEC_SLUG` equals `SPEC_NAME`
- [ ] **Given** `SPEC_NAME: "12-03-nested"`, **when** computing CLI vars, **then** `SPEC_SLUG` is `"03-nested"` (only one prefix stripped)
- [ ] **Given** 3 specs in a session and the second spec is being processed, **then** `SPEC_INDEX` is `"2"`, `SPEC_COUNT` is `"3"`, and `SPECS` contains all 3 spec names comma-separated
- [ ] **Given** config with `specsDir: "my-specs"`, **when** computing CLI vars, **then** `SPECS_DIR` is `"my-specs"`

### Config var resolution

- [ ] **Given** config `templateVars: { "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json" }` and CLI var `SPEC_NAME: "12-foo"`, **when** resolving vars, **then** `PRD_PATH` is `".toby/12-foo.prd.json"`
- [ ] **Given** config `templateVars: { "REPORT": "reports/{{SESSION}}/{{SPEC_NAME}}.md" }`, **when** resolving vars, **then** both `SESSION` and `SPEC_NAME` are substituted
- [ ] **Given** a config var with the same name as a CLI var, **when** resolving vars, **then** the CLI var value wins
- [ ] **Given** `verbose: true` and a config var that shadows a CLI var, **when** resolving vars, **then** a warning is logged

### Session defaults

- [ ] **Given** a single-spec run with no `--session` flag, **when** computing CLI vars, **then** `SESSION` equals `SPEC_SLUG`
- [ ] **Given** a multi-spec run with `--session=my-feature`, **when** computing CLI vars, **then** `SESSION` is `"my-feature"` for all specs
- [ ] **Given** a multi-spec run with no `--session` flag, **when** computing CLI vars, **then** `SESSION` is a generated random human-readable name, consistent across all specs in the session

### Unresolved variables

- [ ] **Given** `{{UNKNOWN}}` in a prompt with no matching var, **when** substituted, **then** `{{UNKNOWN}}` remains as literal text

### Init

- [ ] **Given** running `toby init`, **when** config is generated, **then** `templateVars` appears at root level with `PRD_PATH` default

### Schema

- [ ] **Given** the new config schema, **when** parsing a config with per-command `templateVars`, **then** those per-command vars are ignored (not an error, just not used)
- [ ] **Given** the new config schema, **when** parsing a config with root-level `templateVars`, **then** vars are available for resolution

### Compilation

- [ ] **Given** all removed types and functions, **when** `pnpm build` runs, **then** compilation succeeds with no errors
