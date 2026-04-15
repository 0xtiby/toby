# Planning Mode: Spec -> GitHub Issues

You are in PLANNING mode. Translate a spec into GitHub Issues using vertical slices.

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

### 3. Architectural Decisions

Identify durable decisions that apply across all tasks:
- Route structures, URL patterns
- Schema shapes, key data models
- Auth approach, third-party boundaries

**Durability:** include route paths, schema shapes, model names. Exclude file names, function signatures -- those emerge during build.

### 4. Check for Duplicates

```bash
gh issue list --label "toby/{{SPEC_SLUG}}" --state open --json number,title
```

Skip if issues already exist for this spec.

### 5. Decompose into Vertical Slices

Break the spec into tracer bullet tasks. Each task is a thin vertical slice that cuts through ALL layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (data, logic, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

**Tracer bullet phase:** First slices form the minimum end-to-end path that proves the architecture works.

**Dependencies:** Only where real data/API/infrastructure relationships exist. Do NOT serialize unrelated slices.

### 6. Create Parent Issue

Create the parent issue first. It holds the architectural decisions and references the spec.

```bash
gh issue create \
  --title "{{SPEC_SLUG}}: [One-line summary]" \
  --label "toby/{{SPEC_SLUG}}" \
  --body "$(cat <<'EOF'
## Spec

Implements `{{SPECS_DIR}}/{{SPEC_NAME}}.md`

## Architectural Decisions

- **Routes**: ...
- **Schema**: ...
- **Models**: ...
EOF
)"
```

### 7. Create Sub-Issues

Create each slice as a GitHub issue in dependency order (blockers first). Add the `toby/{{SPEC_SLUG}}` label to each.

```bash
gh issue create \
  --title "[Action verb] [specific deliverable]" \
  --label "toby/{{SPEC_SLUG}}" \
  --body "$(cat <<'EOF'
## Parent

#[parent-issue-number]

## What to build

[Concise description of this vertical slice. Describe end-to-end behavior.]

## Acceptance criteria

- [ ] [Criterion 1]
- [ ] [Criterion 2]

## Blocked by

- #[number] (if any)
- Or: None - can start immediately

## User stories addressed

- User story [N] from spec
EOF
)"
```

### 8. Output Summary

```
## Issues Created for: {{SPEC_NAME}}

Parent: #[number]
Sub-issues: [count]
Tracer slices: [count]
Ready to start: [issues with no blockers]
```

---

## Iteration 2+: Refine Issues

### 1. Load Current State

```bash
gh issue list --label "toby/{{SPEC_SLUG}}" --state open --json number,title,body
```

### 2. Refine

Review against the spec:
- All user stories have corresponding issues?
- Acceptance criteria captured?
- Dependencies accurate?

Update issues as needed.

### 3. Done?

If no meaningful improvements remain, output `:::TOBY_DONE:::`

---

## Guardrails

1. **DO NOT implement** -- only create/update issues
2. **Vertical slices only** -- no horizontal decomposition
3. **Durable decisions first** -- in parent issue
4. **NO branch/PR tasks** -- build prompt handles git workflow

## Command Reference

```bash
gh issue create --title "..." --body "..." --label "toby/slug"
gh issue edit <number> --body "..."
gh issue list --label "toby/slug" --state open --json number,title,body
gh issue view <number> --json body,title,state
gh issue close <number>
```
