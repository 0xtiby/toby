# Default Prompt Files

> **Note:** `PROMPT_BUILD_ALL.md` was **removed by spec 17 (Prompt Simplification)**. Toby now ships only two prompts: `PROMPT_PLAN.md` and `PROMPT_BUILD.md`. The build prompt handles both single-spec and multi-spec modes using `SPEC_INDEX`, `SPEC_COUNT`, and `SPECS` variables.

## Overview

The three prompt files shipped with toby: `PROMPT_PLAN.md`, `PROMPT_BUILD.md`, and `PROMPT_BUILD_ALL.md`. These are generic, opinionated prompts that work for any project. Users can override them at global (`~/.toby/`) or local (`.toby/`) level.

## Problem & Users

The prompts are the instructions given to the AI agent. They must be clear, structured, and produce consistent results (prd.json for plan, one-task-per-iteration for build). Unlike eniem's prompts which are specific to a Next.js monorepo, toby's prompts must be project-agnostic.

## Scope

### In Scope
- `PROMPT_PLAN.md` — planning prompt (spec → prd.json)
- `PROMPT_BUILD.md` — single-spec build prompt (one task per iteration)
- `PROMPT_BUILD_ALL.md` — multi-spec build prompt (shared branch, IS_LAST_SPEC gating)

### Out of Scope
- Template engine implementation (spec 05)
- User-specific prompt customization guidance

---

## PROMPT_PLAN.md

### Purpose
Instruct the AI to read a spec, explore the codebase, and create/refine a `prd.json` file with ordered, dependent tasks.

### Template Variables Used
- `{{SPEC_NAME}}` — spec filename without extension
- `{{SPEC_CONTENT}}` — full spec markdown content
- `{{ITERATION}}` — current iteration number
- `{{PRD_PATH}}` — path to the prd.json file (`.toby/prd/<spec-name>.json`)

### Prompt Structure

```markdown
# Planning Mode: Spec → PRD

You are in PLANNING mode. Translate a spec into a structured PRD (Product Requirements Document) with actionable tasks.

**Spec:** `specs/{{SPEC_NAME}}.md`
**PRD output:** `{{PRD_PATH}}`
**Iteration:** {{ITERATION}}

---

## The Spec

{{SPEC_CONTENT}}

---

## Path Discovery Rules (CRITICAL)

**NEVER guess or invent file paths.** Always verify paths exist before referencing them.

Before referencing ANY file path:
1. Use Glob to find files matching a pattern
2. Use Grep to search for specific code
3. Verify the file exists before adding it to a task's files list

For new files (create): verify the parent directory exists first.

---

## If PRD exists: Refinement Mode

If `{{PRD_PATH}}` already exists, read it and refine:
- Check all spec requirements have corresponding tasks
- Verify file paths are accurate (re-run Glob/Grep)
- Split tasks that are too large (~2 min per task)
- Add missing dependencies
- Improve acceptance criteria specificity
- If no improvements needed, output: :::TOBY_DONE:::

## If PRD does not exist: Creation Mode

### Step 1: Read & Understand the Spec

Extract from the spec content above:
- Problem statement (WHY)
- User stories (WHAT users can do)
- Data model (entities, relationships)
- UI/UX flows (screens, interactions)
- Acceptance criteria (verification)

### Step 2: Explore Codebase

Before creating tasks, validate assumptions against actual code:
- **Find files to modify:** Search for existing files related to the spec
- **Identify patterns:** Look at similar features for structure to follow
- **Check reusable code:** Find existing utilities, helpers, components
- **Verify data model:** Check current database schema or data structures

### Step 3: Create PRD

Write the PRD to `{{PRD_PATH}}` as a JSON file with this exact structure:

```json
{
  "spec": "{{SPEC_NAME}}.md",
  "createdAt": "<ISO 8601 timestamp>",
  "tasks": [
    {
      "id": "task-001",
      "title": "[Action verb] [specific deliverable]",
      "description": "[What to implement and why]",
      "acceptanceCriteria": [
        "[Specific, testable criterion 1]",
        "[Specific, testable criterion 2]"
      ],
      "files": [
        "path/to/file.ts (modify) — verified via Glob",
        "path/to/new-file.ts (create) — parent dir verified"
      ],
      "dependencies": [],
      "status": "pending",
      "priority": 1
    }
  ]
}
```

### Task Design Rules

**Granularity:** Each task should take ~2 minutes. If longer, break it down.

**Tracer bullet approach:** The first tasks should form a minimal end-to-end vertical slice:
- ❌ Wrong: Schema → all queries → all actions → all UI
- ✅ Right: Schema + one query + one action + one UI = tracer bullet, then expand

**Task structure:**
1. **Tracer phase** (1+ tasks) — minimal e2e slice
2. Remaining tasks expand from the tracer, ordered by dependencies
3. Each task lists specific files with (modify) or (create) and verification method

**Dependencies:** Use task IDs. A task cannot start until all dependencies are `done`.

**Priority:** Lower number = higher priority. Tracer tasks get priority 1.

### Step 4: Verify & Output

After writing the PRD:
1. Re-read the file to confirm it's valid JSON
2. Verify task count covers all spec requirements
3. Output a summary:

```
## PRD Created for: {{SPEC_NAME}}

Tasks: [count]
Tracer tasks: [count]
Dependencies: [count] relationships

Ready to build: task-001, task-002 (no dependencies)
```

---

## Guardrails

1. **DO NOT implement** — only create the PRD
2. **~2 minute tasks** — break down larger work
3. **Verify file paths** — use Glob/Grep before referencing
4. **Valid JSON** — the PRD must be parseable
5. **All spec requirements covered** — every user story needs tasks
```

---

## PROMPT_BUILD.md

### Purpose
Instruct the AI to read prd.json, find the next ready task, implement it, validate, commit, and stop.

### Template Variables Used
- `{{SPEC_NAME}}`, `{{ITERATION}}`, `{{PRD_PATH}}`, `{{SPEC_CONTENT}}`
- `{{BRANCH}}`, `{{WORKTREE}}`, `{{EPIC_NAME}}`

### Prompt Structure

```markdown
# Build Mode

You are in BUILD mode. Implement one task from the PRD, validate, and commit.

**Spec:** `specs/{{SPEC_NAME}}.md`
**PRD:** `{{PRD_PATH}}`
**Iteration:** {{ITERATION}}

---

## Path Discovery Rules (CRITICAL)

**NEVER guess or invent file paths.** Always verify paths exist before referencing them.

Before editing ANY file:
1. Use Glob to find files matching a pattern
2. Use Grep to search for specific code
3. Verify the file exists before editing it

For new files: verify the parent directory exists first.

---

## Phase 1: Find Ready Task

Read `{{PRD_PATH}}` and find the first task where:
- `status` is `"pending"`
- All tasks listed in `dependencies` have `status: "done"`

If no ready task exists:
1. Check if all tasks are `"done"` → output `:::TOBY_DONE:::`
2. Check if tasks are `"blocked"` → report blockers and output `:::TOBY_DONE:::`
3. Otherwise → output `:::TOBY_DONE:::`

## Phase 2: Implement Task

1. Read the task's description, acceptance criteria, and files list
2. Before making changes, search the codebase to:
   - Verify functionality doesn't already exist
   - Understand existing patterns
   - Identify the actual files to modify
3. Implement the task following the acceptance criteria
4. Build small, validate early — tracer bullet mindset

## Phase 3: Validate

Run project validation commands. Common patterns:
- Build: check the project compiles
- Type check: verify no type errors
- Lint: ensure code style
- Test: run relevant tests

If validation fails:
1. First attempt: targeted fix based on error
2. Second attempt: alternative approach
3. Third attempt: revert changes, mark task as `"blocked"` in PRD, and exit

## Phase 4: Commit & Update PRD

When validation passes:

1. Stage and commit changes:
   ```bash
   git add -A
   git commit -m "$(cat <<'EOF'
   feat({{EPIC_NAME}}): [task title]

   Progress: [what was completed]
   Next: [remaining tasks, or "none" if last]
   EOF
   )"
   ```

2. Update `{{PRD_PATH}}`: set the completed task's status to `"done"`

3. Push:
   ```bash
   git push -u origin HEAD
   ```

**STOP HERE.** Do not pick up another task. The loop engine handles continuation.
Do NOT output `:::TOBY_DONE:::` after completing a task — just stop.

---

## Guardrails

1. **Single task** — implement ONE task, then STOP
2. **Validate before commit** — never commit failing code
3. **Update PRD** — mark task as done after committing
4. **Verify paths** — use Glob/Grep before editing files
5. **Tracer bullet** — build small, test immediately
```

---

## PROMPT_BUILD_ALL.md

### Purpose
Same as PROMPT_BUILD.md but for `--all` mode. Differences:
- Uses `IS_LAST_SPEC` to gate PR creation
- Specs share a branch/worktree

### Prompt Structure

```markdown
# Build Mode (All Specs)

You are in BUILD mode for a multi-spec session. Implement one task from the PRD, validate, and commit.

**Spec:** `specs/{{SPEC_NAME}}.md`
**PRD:** `{{PRD_PATH}}`
**Iteration:** {{ITERATION}}
**Is last spec:** {{IS_LAST_SPEC}}

---

## Path Discovery Rules (CRITICAL)

**NEVER guess or invent file paths.** Always verify paths exist.

Before editing ANY file:
1. Use Glob to find files matching a pattern
2. Use Grep to search for specific code
3. Verify the file exists before editing it

---

## Phase 1: Find Ready Task

Read `{{PRD_PATH}}` and find the first task where:
- `status` is `"pending"`
- All tasks listed in `dependencies` have `status: "done"`

If no ready task exists:
- If `{{IS_LAST_SPEC}}` is `true` → go to **Phase 5: Create PR**
- Otherwise → output `:::TOBY_DONE:::` and exit

## Phase 2: Implement Task

Same as single-spec build: read task, implement, follow acceptance criteria.

## Phase 3: Validate

Same as single-spec build: build, typecheck, lint, test.

## Phase 4: Commit & Update PRD

Same as single-spec build: commit, update prd.json, push. Then STOP.

## Phase 5: Create PR (Last Spec Only)

> **Only execute when `{{IS_LAST_SPEC}}` is `true` and no ready tasks remain.**

1. Create a pull request:
   ```bash
   gh pr create --title "feat: {{EPIC_NAME}}" --body "$(cat <<'EOF'
   ## Summary
   Built from specs.

   ### Testing
   - Build, typecheck, lint passing
   EOF
   )"
   ```

2. Output: `:::TOBY_DONE:::`

---

## Guardrails

1. **Single task** — ONE task per iteration, then STOP
2. **Validate before commit** — never commit failing code
3. **Update PRD** — mark task as done
4. **PR gated** — only create PR when IS_LAST_SPEC is true
```

---

## Acceptance Criteria

- Given the shipped PROMPT_PLAN.md, when used with a spec, then the AI creates a valid prd.json at the PRD_PATH
- Given the shipped PROMPT_BUILD.md, when used with a prd.json, then the AI implements one task and stops
- Given the shipped PROMPT_BUILD_ALL.md with IS_LAST_SPEC=false, when all tasks done, then the AI outputs :::TOBY_DONE::: without creating a PR
- Given the shipped PROMPT_BUILD_ALL.md with IS_LAST_SPEC=true, when all tasks done, then the AI creates a PR before outputting :::TOBY_DONE:::
- Given a plan re-run (PRD exists), when using PROMPT_PLAN.md, then the AI refines instead of recreating
- Given all prompts, when checking for template variables, then they all use {{SPEC_NAME}}, {{ITERATION}}, {{PRD_PATH}} correctly

## Edge Cases

- User overrides only PROMPT_BUILD.md locally: PROMPT_PLAN.md and PROMPT_BUILD_ALL.md still use shipped versions
- Prompt file references a tool (Glob, Grep) that doesn't exist in the spawned CLI: the AI adapts — these are instructions, not hard dependencies

## Testing Strategy

- Smoke test: All three prompt files are valid markdown
- Smoke test: All template variables in prompts are recognized by the template engine
- Manual test: Run `toby plan` with shipped prompt on a sample spec and verify prd.json is created
- Manual test: Run `toby build` with shipped prompt and verify one task is implemented per iteration
