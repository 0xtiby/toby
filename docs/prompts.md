# Prompt Authoring Guide

Toby uses Markdown prompt templates to drive its plan and build commands. Each prompt is a `.md` file containing instructions and `{{VARIABLE}}` placeholders that get substituted at runtime.

## Shipped Prompts

Toby ships two prompt templates.

### PROMPT_PLAN

The planning prompt translates a spec into a structured PRD (Product Requirements Document) with actionable tasks. It reads the spec file, explores the codebase to validate assumptions, then outputs a JSON PRD with granular tasks, dependencies, and acceptance criteria.

Key variables used: `SPECS_DIR`, `SPEC_NAME`, `PRD_PATH`, `ITERATION`.

### PROMPT_BUILD

The build prompt implements one task from a spec's PRD per iteration. It finds the next ready task, implements it following the acceptance criteria, validates with build/lint/test, commits, and stops. The loop engine calls it repeatedly until all tasks are done.

Key variables used: `SPECS_DIR`, `SPEC_NAME`, `ITERATION`, `SESSION`, `SPEC_INDEX`, `SPEC_COUNT`, `SPECS`.

## Template Variables

Variables use `{{VAR_NAME}}` syntax in prompt files. Toby provides two categories of variables: **CLI vars** computed automatically at runtime, and **config vars** defined in your project config.

### CLI Variables

These are computed by Toby from runtime state. You cannot override their names in config.

| Variable | Description | Example |
|---|---|---|
| `SPEC_NAME` | Full spec filename without extension | `12-auth-middleware` |
| `SPEC_SLUG` | Spec name with leading numeric prefix stripped | `auth-middleware` |
| `ITERATION` | Current loop iteration number | `3` |
| `SPEC_INDEX` | 1-based index of current spec in the batch | `2` |
| `SPEC_COUNT` | Total number of specs in the batch | `5` |
| `SESSION` | Random human-readable session name | `bold-wolf-42` |
| `SPECS` | Comma-separated list of all spec names in the batch | `12-auth, 13-api` |
| `SPECS_DIR` | Path to the specs directory | `specs` |

### Config Variables

Define custom variables under `templateVars` in your project config (`.toby/config.json`):

```json
{
  "plan": {
    "templateVars": {
      "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json"
    }
  },
  "build": {
    "templateVars": {
      "BRANCH": "feat/{{SPEC_SLUG}}"
    }
  }
}
```

Config var values can reference CLI variables using `{{VAR}}` syntax — they are resolved before substitution into the prompt. In the example above, `PRD_PATH` would resolve to `.toby/12-auth-middleware.prd.json` when building spec `12-auth-middleware`.

### Resolution Order

Template variables are resolved in two steps:

1. **Config vars resolve first** — CLI variable references inside config var values are substituted
2. **Merge with CLI vars** — the resolved config vars and CLI vars are merged, with CLI vars taking precedence on name conflicts

This means if you define a config var named `SPEC_NAME`, the CLI-computed value will always win. Config vars are best used for project-specific paths and settings that build on top of CLI vars.

## Custom Prompts

You can override any shipped prompt by placing a file with the same name in your project's `.toby/` directory or your global `~/.toby/` directory. Toby resolves prompts in this order:

1. **Local** — `.toby/PROMPT_PLAN.md` (project override)
2. **Global** — `~/.toby/PROMPT_PLAN.md` (user override)
3. **Shipped** — built-in default

The first file found wins. Custom prompts have access to all the same template variables.
