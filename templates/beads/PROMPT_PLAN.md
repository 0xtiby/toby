# Planning Mode: Spec -> Beads

You are in PLANNING mode. Translate a spec into beads issues using vertical slices.

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
**Iteration:** {{ITERATION}}

---

## Path Discovery

**NEVER guess file paths.** Use Glob/Grep to verify paths exist before referencing them. For new files, verify the parent directory exists.

---

## Iteration 1: Create Issues

### 1. Read the Spec

Read the spec file at `{{SPECS_DIR}}/{{SPEC_NAME}}.md`.

### 2. Explore the Codebase

Understand the current architecture, existing patterns, and integration layers before decomposing.

### 3. Check for Duplicates

```bash
bd list --label "toby/{{SPEC_SLUG}}" --json
```

Skip if issues already exist for this spec.

### 4. Create Epic

```bash
bd create "{{SPEC_SLUG}}: [One-line summary]" \
  --type epic \
  --description "Implements {{SPECS_DIR}}/{{SPEC_NAME}}.md" \
  --notes "Architectural decisions:
- Routes: ...
- Schema: ...
- Models: ..." \
  --label "toby/{{SPEC_SLUG}}" \
  --json
```

The `notes` field holds the durable architectural decisions.

### 5. Decompose into Vertical Slices

Break the spec into tracer bullet tasks. Each task is a thin vertical slice that cuts through ALL layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (data, logic, API, UI, tests)
- A completed slice is verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

**Tracer bullet phase:** First tasks form the minimum end-to-end path that proves the architecture works.

### 6. Create Issues

Create each task as a child of the epic:

```bash
bd create "[Action verb] [specific deliverable]" \
  --type task \
  --parent <epic-id> \
  --description "[End-to-end behavior, not layer-by-layer]" \
  --acceptance "[Criterion 1]
[Criterion 2]" \
  --notes "User stories: [N, M] from spec" \
  --label "toby/{{SPEC_SLUG}}" \
  --json
```

### 7. Wire Dependencies

Only where real data/API/infrastructure relationships exist. Do NOT serialize unrelated tasks.

```bash
bd dep add <child-id> <parent-id>
```

Tracer tasks should have no blockers. Non-tracer tasks depend on the last tracer task.

### 8. Output Summary

```
## Beads Created for: {{SPEC_NAME}}

Epic: [id]
Tasks: [count]
Tracer tasks: [count]

bd ready shows:
- [ready task ids and titles]
```

---

## Iteration 2+: Refine

### 1. Load Current State

```bash
bd list --label "toby/{{SPEC_SLUG}}" --json
bd ready --json
bd blocked --json
```

### 2. Refine

Review against the spec:
- All user stories have corresponding issues?
- Acceptance criteria captured?
- Dependencies accurate?

Update issues as needed:

```bash
bd update <id> --acceptance "..." --json
bd update <id> --description "..." --json
```

### 3. Done?

If no meaningful improvements remain, output `:::TOBY_DONE:::`

---

## Guardrails

1. **DO NOT implement** -- only create/update beads
2. **Vertical slices only** -- no horizontal decomposition
3. **Durable decisions in epic notes** -- before task breakdown
4. **NO branch/PR tasks** -- build prompt handles git workflow

## Command Reference

```bash
bd create "..." --type task --parent <id> --description "..." --acceptance "..." --label "..." --json
bd update <id> --description "..." --acceptance "..." --json
bd dep add <child> <parent>
bd list --label "..." --json
bd ready --json
bd blocked --json
bd show <id> --json
```
