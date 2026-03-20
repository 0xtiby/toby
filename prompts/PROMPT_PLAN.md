---
required_vars:
  - SPEC_NAME
  - ITERATION
  - SPEC_CONTENT
optional_vars:
  - BRANCH
  - WORKTREE
  - EPIC_NAME
---
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
