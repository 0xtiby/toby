# Prompt Authoring Guide

Toby uses Markdown prompt templates to drive its plan and build commands. Each prompt is a `.md` file containing instructions and `{{VARIABLE}}` placeholders that get substituted at runtime.

## Shipped Prompts

Toby ships two prompt templates that use the **prd-json** tracker by default. These can be replaced with tracker-specific prompts — see [Tracker Templates](trackers.md) for details on the three built-in tracker options (prd-json, GitHub Issues, beads).

### PROMPT_PLAN

The planning prompt translates a spec into a structured PRD (Product Requirements Document) with actionable tasks. It reads the spec file, explores the codebase to validate assumptions, then outputs a JSON PRD with granular tasks, dependencies, and acceptance criteria.

Key variables used: `SPECS_DIR`, `SPEC_NAME`, `ITERATION`. Also commonly used with the config var `PRD_PATH` (see Config Variables below).

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
  "templateVars": {
    "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json",
    "BRANCH": "feat/{{SPEC_SLUG}}"
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

You can override any shipped prompt by placing a file with the same name in your project's `.toby/` directory or your global `~/.toby/` directory.

### Override Chain

Toby resolves prompts through a 3-level chain. The first file found wins:

| Priority | Location | Scope | Example path |
|---|---|---|---|
| 1 (highest) | `.toby/` | Project override | `.toby/PROMPT_PLAN.md` |
| 2 | `~/.toby/` | User override (all projects) | `~/.toby/PROMPT_PLAN.md` |
| 3 (lowest) | Shipped | Built-in default | _(bundled with toby)_ |

This means you can set a personal default in `~/.toby/` and still override it per-project in `.toby/`. Custom prompts have access to all the same template variables as shipped prompts.

### Walkthrough: Creating a Custom Prompt

Follow these steps to create a project-local override for the plan prompt.

1. **Initialize your project** (if you haven't already):

   ```bash
   toby init
   ```

   This creates the `.toby/` directory with a default `config.json` and `status.json`.

2. **Copy the shipped prompt** as a starting point:

   ```bash
   cp node_modules/@0xtiby/toby/prompts/PROMPT_PLAN.md .toby/PROMPT_PLAN.md
   ```

   Or create `.toby/PROMPT_PLAN.md` from scratch — any valid Markdown works.

3. **Edit the prompt** to fit your workflow. You can use any `{{VAR_NAME}}` template variable:

   ```markdown
   # Planning for {{SPEC_NAME}}

   Read the spec at {{SPECS_DIR}}/{{SPEC_NAME}}.md and create a plan.
   Output the PRD to {{PRD_PATH}}.
   ```

4. **Define config vars** referenced in your prompt. Add them to `.toby/config.json`:

   ```json
   {
     "templateVars": {
       "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json"
     }
   }
   ```

   Here `PRD_PATH` is a config var whose value references the CLI var `SPEC_NAME`. At runtime, if the spec is `12-auth-middleware`, `{{PRD_PATH}}` resolves to `.toby/12-auth-middleware.prd.json`.

5. **Verify your override loads** by running a plan command:

   ```bash
   toby plan --spec=12-auth-middleware
   ```

   Toby will pick up `.toby/PROMPT_PLAN.md` instead of the shipped default. Your custom text should appear in the agent's instructions.
