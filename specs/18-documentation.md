# Documentation

## Overview

Create user-facing documentation for toby: a polished README.md with badges, install instructions, and quick start; a CLI and configuration reference page; and a prompt authoring guide covering shipped prompts, the template variable system, and custom prompt creation. Documentation lives in README.md at the root and a docs/ folder for detailed guides.

## Problem Statement

**Who:** Developers who want to install and use toby
**Problem:** There is no meaningful user-facing documentation. The existing README is minimal and outdated relative to the current feature set. Users have no reference for CLI commands, configuration options, or how to write custom prompts.
**Impact:** Without docs, users can't discover or use toby's features without reading source code. A clear README and reference guides make toby usable out of the box and reduce support questions.

## Scope

### Included

- README.md rewrite with npm + license badges, tagline, install instructions, quick start walkthrough, "how it works" overview, and links to docs
- docs/reference.md — single-page CLI command reference (all commands, flags, examples) and complete config.json reference (every option with type, default, description)
- docs/prompts.md — prompt authoring guide covering shipped prompts (purpose + key vars), template variable system (full variable table), 3-level override chain, and a "writing your first custom prompt" walkthrough
- Ensure all docs reflect the current feature set including specs 16 and 17 changes (new variable system, no frontmatter, no PROMPT_BUILD_ALL)

### Excluded

- Workflow-specific guides (e.g., "how to set up a beads workflow", "using toby with Linear")
- Contributing guide or developer documentation
- API documentation or internal architecture docs
- Docs site tooling (e.g., Docusaurus, VitePress) — plain markdown files only
- Automated doc generation from code

### Constraints

- Documentation must be accurate against the codebase at time of writing — verify commands, flags, and config options against the actual implementation
- Markdown files only, no special tooling required to read them
- README should work well on both GitHub and npm

## User Stories

### README

- [ ] As a developer discovering toby on npm or GitHub, I can read the README and understand what toby does, how to install it, and how to run my first plan+build cycle in under 5 minutes
- [ ] As a developer evaluating toby, I can see the license and package version from badges at the top of the README

### CLI and Config Reference

- [ ] As a user, I can look up any toby command and see its synopsis, available flags, and a usage example
- [ ] As a user setting up config.json, I can reference a complete table of every config option with its type, default value, and description

### Prompt Authoring

- [ ] As a user who wants to customize prompts, I can read what the shipped prompts do and what variables they use
- [ ] As a user writing a custom prompt, I can follow a step-by-step walkthrough to create a local prompt override
- [ ] As a user writing a custom prompt, I can reference a comprehensive table of all available template variables (CLI vars and config vars)

## Business Rules

### README Structure

The README follows standard open-source conventions in this order:

1. **Title + tagline** — "toby — Turn markdown specs into working code with AI-powered plan and build loops"
2. **Badges** — npm version, MIT license
3. **What is toby** — one paragraph summary
4. **How it works** — brief explanation of the spec → plan → build loop, with a simple diagram or bullet list showing the flow
5. **Quick start** — step-by-step: install → toby init → write a spec → toby plan → toby build. Each step shows the command and a one-line explanation of what it does
6. **Documentation links** — links to docs/reference.md and docs/prompts.md
7. **License** — MIT

### CLI and Config Reference (docs/reference.md)

**CLI section** documents each command with:
- One-line description of what the command does
- Usage synopsis (e.g., `toby build [spec] [flags]`)
- Flags table with flag name, type, default, and description
- One usage example per command

Commands to document: `init`, `plan`, `build`, `status`, `config`

**Config section** documents every config.json option with:
- Option path (e.g., `plan.cli`, `templateVars`)
- Type
- Default value
- Description of what it controls

The config section shows a complete example config.json with all options at their defaults.

### Prompt Authoring Guide (docs/prompts.md)

**Shipped prompts section:**
- For each shipped prompt (PROMPT_PLAN, PROMPT_BUILD): one paragraph explaining its purpose and the key template variables it uses
- Note that shipped prompts no longer use frontmatter

**Template variables section:**
- Complete table of all CLI vars (SPEC_NAME, SPEC_SLUG, ITERATION, SPEC_INDEX, SPEC_COUNT, SESSION, SPECS, SPECS_DIR) with description and example values
- Explanation of config vars: how to define them in templateVars, how CLI var interpolation works in values, CLI var precedence on name conflicts
- Resolution order explanation (compute CLI vars → resolve config vars → merge → substitute into prompt)

**Override chain section:**
- Explain the 3-level prompt resolution: local (.toby/prompts/) > global (~/.toby/prompts/) > shipped
- How to create a local override

**Walkthrough section:**
- Step-by-step guide: create .toby/prompts/ directory, copy a shipped prompt, modify it, verify it loads
- Show how to use template variables in the custom prompt
- Show how to add a config var in templateVars and reference it

### Documentation Accuracy

- All documented commands, flags, and config options must be verified against the actual codebase
- If a feature is planned but not yet implemented (e.g., from specs 16-17), document the post-implementation state and note any pre-requisite specs
- No documentation for internal APIs, only user-facing behavior

### File Locations

| File | Purpose |
|------|---------|
| `README.md` | Project overview, install, quick start, links to docs |
| `docs/reference.md` | CLI command reference + complete config.json reference |
| `docs/prompts.md` | Prompt authoring guide: shipped prompts, variables, override chain, walkthrough |

## Edge Cases

| Condition | Expected Behavior |
|-----------|-------------------|
| Feature from specs 16-17 not yet implemented | Document the target state; note which spec it depends on |
| Config option that only applies with verbose mode | Document it with a note that it requires `verbose: true` |
| Command with no flags (e.g., status) | Show synopsis and example only, note "no additional flags" |
| Shipped prompt changes after docs are written | Docs may drift — acceptance criteria verify accuracy at time of writing |

## Acceptance Criteria

### README

- [ ] **Given** the README.md, **when** read on GitHub, **then** it displays npm version and MIT license badges
- [ ] **Given** the README.md, **when** a new user follows the quick start, **then** every command shown is valid and produces the described result
- [ ] **Given** the README.md, **when** read, **then** it contains a "how it works" section explaining the spec → plan → build flow
- [ ] **Given** the README.md, **when** read, **then** it links to docs/reference.md and docs/prompts.md

### CLI and Config Reference

- [ ] **Given** docs/reference.md, **when** read, **then** every toby CLI command (init, plan, build, status, config) has a synopsis, flags table, and usage example
- [ ] **Given** docs/reference.md, **when** compared to the actual CLI, **then** all documented flags and options exist and match their described behavior
- [ ] **Given** docs/reference.md, **when** read, **then** every config.json option is listed with type, default, and description
- [ ] **Given** docs/reference.md, **when** read, **then** a complete example config.json is shown with all options at defaults

### Prompt Authoring Guide

- [ ] **Given** docs/prompts.md, **when** read, **then** each shipped prompt (PROMPT_PLAN, PROMPT_BUILD) has a purpose description and list of key variables used
- [ ] **Given** docs/prompts.md, **when** read, **then** all 8 CLI template variables are documented with description and example
- [ ] **Given** docs/prompts.md, **when** read, **then** config vars are explained including CLI var interpolation in values and precedence rules
- [ ] **Given** docs/prompts.md, **when** read, **then** the 3-level override chain (local > global > shipped) is explained with file paths
- [ ] **Given** docs/prompts.md, **when** a user follows the "writing your first custom prompt" walkthrough, **then** each step produces the described result
