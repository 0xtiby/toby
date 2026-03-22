# Prompt Simplification

## Overview

Simplify the shipped prompts to use the new variable set from `16-template-variable-system.md`, removing frontmatter declarations, `SPEC_CONTENT` inlining, and the separate `PROMPT_BUILD_ALL.md`. The result is two clean prompts (`PROMPT_PLAN.md` and `PROMPT_BUILD.md`) that always receive the full variable set and instruct the agent to read spec files directly.

## Problem Statement

**Who:** Users customizing prompts and maintainers updating prompt behavior
**Problem:** Shipped prompts contain dead frontmatter that adds parsing overhead, inline `SPEC_CONTENT` that bloats the prompt unnecessarily (the agent can read files), a separate `PROMPT_BUILD_ALL.md` that exists only for `IS_LAST_SPEC` logic, and references to variables (`BRANCH`, `WORKTREE`, `EPIC_NAME`, `PRD_PATH`) that are never supplied — resulting in unresolved `{{VAR}}` placeholders in the final prompt.
**Impact:** Prompts are confusing to customize because they contain dead references and unnecessary indirection. Simplifying them makes the prompt system transparent and easy to extend.

## Scope

### Included

- Remove frontmatter blocks (`---\nrequired_vars:...\n---`) from all shipped prompts
- Remove `{{SPEC_CONTENT}}` from prompts — add instruction for agent to read the spec file using `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
- Delete `PROMPT_BUILD_ALL.md` entirely
- Remove `PROMPT_BUILD_ALL` from the `PromptName` type
- Update `PROMPT_BUILD.md` to use new vars: `SPEC_INDEX`, `SPEC_COUNT`, `SESSION`, `SPECS`, `SPECS_DIR`
- Update `PROMPT_PLAN.md` to use new vars and remove `{{SPEC_CONTENT}}`
- Remove references to `{{BRANCH}}`, `{{WORKTREE}}`, `{{EPIC_NAME}}`, `{{IS_LAST_SPEC}}`, `{{IS_EPIC}}` from prompts
- All vars are always present in the prompt (no conditional sections for single vs multi-spec)
- Update prompt test file to match new expectations

### Excluded

- Writing multi-spec coordination logic in the build prompt (user will add this later)
- Changes to the 3-level prompt override chain (local > global > shipped)
- Changes to the variable resolution system (covered in `16-template-variable-system.md`)

## User Stories

### Primary Flow

- [ ] As a user running `toby plan`, my prompt instructs the agent to read the spec file from `{{SPECS_DIR}}/{{SPEC_NAME}}.md` instead of receiving the spec content inlined
- [ ] As a user running `toby build`, a single `PROMPT_BUILD.md` is used regardless of whether I'm building one spec or many
- [ ] As a user running `toby build --all`, my prompt receives `SPEC_COUNT`, `SPEC_INDEX`, `SPECS`, and `SESSION` so the agent knows the full session context

### Secondary Flows

- [ ] As a user writing a custom prompt, I don't need to include frontmatter declarations — I just use `{{VAR}}` placeholders directly
- [ ] As a user reading the shipped prompts, I see no unresolved or dead variable references

## Business Rules

### Frontmatter Removal

- All `---` delimited frontmatter blocks at the top of shipped prompts are removed
- Prompt loading no longer parses or strips frontmatter — file content is used directly
- User-created prompts that happen to have frontmatter will have it treated as literal prompt content (not parsed)

### SPEC_CONTENT Replacement

- Prompts no longer receive the spec file contents inlined via `{{SPEC_CONTENT}}`
- Instead, prompts include an instruction telling the agent to read the spec file
- The spec file path is expressed using template vars: `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
- This relies on `SPECS_DIR` and `SPEC_NAME` being available as CLI vars (see `16-template-variable-system.md`)

### PROMPT_BUILD_ALL Deletion

- `PROMPT_BUILD_ALL.md` is deleted from the shipped prompts directory
- The "build all" prompt name is removed as a recognized prompt identifier
- Any code that conditionally selects `PROMPT_BUILD_ALL` vs `PROMPT_BUILD` now always uses `PROMPT_BUILD`
- The build prompt always receives all session-related vars (`SPEC_INDEX`, `SPEC_COUNT`, `SESSION`, `SPECS`)
- No conditional logic in the prompt for single vs multi-spec — when `SPEC_COUNT=1`, the vars are self-explanatory

### Dead Variable Cleanup

These variables are removed from all shipped prompts:
- `{{SPEC_CONTENT}}` — replaced by agent file read instruction
- `{{BRANCH}}` — agent handles git branching
- `{{WORKTREE}}` — agent handles worktree management
- `{{EPIC_NAME}}` — not a concept in the simplified model
- `{{IS_LAST_SPEC}}` — derivable from `SPEC_INDEX == SPEC_COUNT`
- `{{IS_EPIC}}` — derivable from `SPEC_COUNT > 1`

### Prompt Test Updates

- Remove tests for `PROMPT_BUILD_ALL`
- Update recognized variable lists to match the new CLI var set
- Verify shipped prompts contain no frontmatter
- Verify shipped prompts contain no references to removed variables

## Edge Cases

| Condition | Expected Behavior |
|-----------|-------------------|
| User prompt with `---` content (not frontmatter) | Treated as literal content — no frontmatter parsing exists anymore |
| User prompt still referencing `{{SPEC_CONTENT}}` | Left as literal `{{SPEC_CONTENT}}` text (unresolved var behavior) |
| User prompt referencing `{{IS_LAST_SPEC}}` | Left as literal text — user needs to update to use `SPEC_INDEX`/`SPEC_COUNT` |
| Code path that previously selected PROMPT_BUILD_ALL | Now selects PROMPT_BUILD — same prompt for all modes |

## Acceptance Criteria

### Frontmatter removal

- [ ] **Given** the shipped `PROMPT_BUILD.md`, **when** `loadPrompt` is called, **then** no frontmatter parsing occurs and the full file content is used as the prompt template
- [ ] **Given** the shipped `PROMPT_PLAN.md`, **when** `loadPrompt` is called, **then** no frontmatter parsing occurs

### SPEC_CONTENT removal

- [ ] **Given** the shipped `PROMPT_PLAN.md`, **when** read, **then** it does not contain `{{SPEC_CONTENT}}` and instead instructs the agent to read `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
- [ ] **Given** the shipped `PROMPT_BUILD.md`, **when** read, **then** it does not contain `{{SPEC_CONTENT}}`

### BUILD_ALL deletion

- [ ] **Given** `PROMPT_BUILD_ALL.md` is deleted, **when** running `toby build --all`, **then** `PROMPT_BUILD` is used and the prompt receives `SPEC_COUNT > 1`
- [ ] **Given** the set of recognized prompt names, **when** inspected, **then** it does not include a "build all" variant

### Dead variable cleanup

- [ ] **Given** all shipped prompts, **when** scanned, **then** none contain `{{BRANCH}}`, `{{WORKTREE}}`, `{{EPIC_NAME}}`, `{{IS_LAST_SPEC}}`, or `{{IS_EPIC}}`

### All vars always present

- [ ] **Given** a single-spec build, **when** the prompt is rendered, **then** it contains `SPEC_INDEX=1`, `SPEC_COUNT=1`, `SESSION`, and `SPECS` values
- [ ] **Given** a multi-spec build, **when** the prompt is rendered, **then** it contains all session vars for each spec

### Tests

- [ ] **Given** the updated prompt test file, **when** `pnpm test` runs, **then** all prompt-related tests pass
- [ ] **Given** all changes, **when** `pnpm build && pnpm test` runs, **then** compilation and all tests pass
