# Planning Mode: Spec -> PRD JSON

You are in PLANNING mode. Translate a spec into a structured PRD JSON file with vertical slice tasks.

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
**PRD output:** `{{PRD_PATH}}`
**Iteration:** {{ITERATION}}

---

## Path Discovery

**NEVER guess file paths.** Use Glob/Grep to verify paths exist before referencing them. For new files, verify the parent directory exists.

---

## If PRD exists: Refinement Mode

Read `{{PRD_PATH}}` and refine:
- Check all spec requirements have corresponding tasks
- Verify dependencies are accurate
- Improve acceptance criteria specificity
- If no improvements needed, output `:::TOBY_DONE:::`

## If PRD does not exist: Creation Mode

### 1. Read the Spec

Read the spec file at `{{SPECS_DIR}}/{{SPEC_NAME}}.md`.

### 2. Explore the Codebase

Understand the current architecture, existing patterns, and integration layers before decomposing.

### 3. Architectural Decisions

Identify durable decisions that apply across all tasks:
- Route structures, URL patterns
- Schema shapes, key data models
- Auth approach, third-party boundaries

**Durability:** include route paths, schema shapes, model names. Exclude file names, function signatures -- those emerge during build.

### 4. Decompose into Vertical Slices

Break the spec into tracer bullet tasks. Each task is a thin vertical slice that cuts through ALL layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each task delivers a narrow but COMPLETE path through every layer (data, logic, API, UI, tests)
- A completed task is verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

**Tracer bullet phase:** First tasks form the minimum end-to-end path that proves the architecture works.

**Dependencies:** Only where real data/API/infrastructure relationships exist. Do NOT serialize unrelated tasks.

### 5. Create PRD

Write the PRD to `{{PRD_PATH}}`:

```json
{
  "spec": "{{SPEC_NAME}}.md",
  "createdAt": "<ISO 8601 timestamp>",
  "architecturalDecisions": [
    "Routes: ...",
    "Schema: ...",
    "Auth: ..."
  ],
  "tasks": [
    {
      "id": "task-001",
      "title": "[Action verb] [specific deliverable]",
      "description": "[End-to-end behavior, not layer-by-layer]",
      "acceptanceCriteria": [
        "[Specific, testable criterion]"
      ],
      "dependencies": [],
      "userStories": [1, 3],
      "status": "pending"
    }
  ]
}
```

**Status values:** `pending`, `in_progress`, `done`, `blocked`

### 6. Output Summary

```
## PRD Created for: {{SPEC_NAME}}

Tasks: [count]
Tracer tasks: [count]
Ready to start: [tasks with no dependencies]
```

---

## Guardrails

1. **DO NOT implement** -- only create the PRD
2. **Vertical slices only** -- no horizontal decomposition
3. **Durable decisions first** -- before task breakdown
4. **Valid JSON** -- the PRD must be parseable
