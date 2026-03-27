# Planning Mode: Spec -> GitHub Issues

You are in PLANNING mode. Translate a spec into GitHub Issues (parent issue with sub-issues).

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
**Iteration:** {{ITERATION}}

---

## Path Discovery Rules (CRITICAL)

**NEVER guess or invent file paths.** Always verify paths exist before referencing them.

Before referencing ANY file path:
1. Use Glob to find files matching a pattern
2. Use Grep to search for specific code
3. Verify the file exists before adding it to an issue's Files section

For new files (create): verify the parent directory exists first.

---

## Iteration 1: Create Issues

If this is iteration 1, create the parent issue and all sub-issues.

### Step 1: Read the Spec

Read `{{SPECS_DIR}}/{{SPEC_NAME}}.md` and extract:
- Problem statement (WHY)
- User stories (WHAT users can do)
- Data model (entities, relationships)
- UI/UX flows (screens, interactions)
- Acceptance criteria (verification)

### Step 2: Explore Codebase

Before creating issues, validate assumptions against actual code:
- **Find files to modify:** Search for existing files related to the spec's entities and flows
- **Identify patterns:** Look at similar features already implemented for structure to follow
- **Check reusable code:** Find existing utilities, helpers, or components that can be reused
- **Verify data model:** Compare spec entities against current database schema or data structures

This ensures the Files and Patterns sections in issue bodies are accurate, not guessed.

### Step 3: Check for Duplicates

```bash
gh issue list --label "toby/{{SPEC_SLUG}}" --state open --json number,title
```

Skip if issues already exist for this spec.

### Step 4: Create Sub-Issues

Create each task as a GitHub issue. The issue body must include all 6 sections:

```bash
gh issue create --title "[Action verb] [specific deliverable]" --body "$(cat <<'EOF'
## Context
[Why this task exists, what it enables]

## Acceptance Criteria
- [ ] [Specific deliverable 1]
- [ ] [Specific deliverable 2]

## Files
- `path/to/file.ts` (modify) — verified via Glob
- `path/to/new-file.ts` (create) — parent dir verified

## Patterns
- See `path/to/example/` for reference

## Tests
- Test that X returns Y when given Z
- Test error case when input is invalid

## Verify
`pnpm test -- --grep 'feature'`
EOF
)"
```

Save the issue number returned for each sub-issue.

**Task granularity:** Each task should take ~2 minutes. If longer, break it down.

### Step 5: Create Parent Issue

After all sub-issues are created, create the parent issue with a tasklist referencing them.

The **order of the tasklist IS the build order** — list tasks in dependency order (prerequisites first).

```bash
gh issue create \
  --title "{{SPEC_SLUG}}: [One-line summary]" \
  --label "toby/{{SPEC_SLUG}}" \
  --body "$(cat <<'EOF'
## Spec
Implements `{{SPECS_DIR}}/{{SPEC_NAME}}.md`

## Tasks
- [ ] #[number] [task title]
- [ ] #[number] [task title]
- [ ] #[number] [task title]

## Notes
- Tracer tasks: first [N] items form the minimal vertical slice
- Remaining tasks expand horizontally from the tracer
EOF
)"
```

### Tracer Bullet Phase

The **first tasks** in the tasklist form a tracer bullet phase: one or more tasks that together build a minimal end-to-end slice touching all layers.

From _The Pragmatic Programmer_: Don't build horizontal layers in isolation. Build one vertical slice first, test it, get feedback, then expand.

**Example:** For a "credits system" feature:
- Wrong: Schema -> all queries -> all actions -> all UI
- Right: Schema + one query + one action + one UI = tracer bullet, then expand

**How many tracer tasks?** Use the ~2 min granularity rule and your judgment:
- If the vertical slice fits in one task (~2 min), create one tracer task.
- If distinct layers each need meaningful work, split into multiple tracer tasks.

List all tracer tasks first in the parent's tasklist, then expansion tasks.

### Step 6: Output Summary

```markdown
## GitHub Issues Created for: {{SPEC_NAME}}

**Parent:** #[number] - [title]

### Sub-Issues ([count])

| # | Title | Tracer? |
|---|-------|---------|
| ... | ... | ... |

### Task Order (from parent tasklist)

1. #[n]: [title] (tracer)
2. #[n]: [title] (tracer)
3. #[n]: [title]

### Ready to Start

First unchecked item in parent tasklist:
- #[n]: [title]
```

---

## Iteration 2+: Refine Issues

If iteration > 1, review and improve existing issues.

### Step 1: Load Current State

```bash
gh issue view $(gh issue list --label "toby/{{SPEC_SLUG}}" --state open --json number -q '.[0].number') --json body,title,number
gh issue list --label "toby/{{SPEC_SLUG}}" --state open --json number,title
```

### Step 2: Refinement Checklist

Review each issue against the spec:

- [ ] All user stories have corresponding issues?
- [ ] Acceptance criteria captured in issue bodies?
- [ ] Tasklist order in parent reflects correct build order?
- [ ] Tasks are atomic (~2 min each)?
- [ ] Issue bodies have ALL 6 sections (Context, Acceptance Criteria, Files, Patterns, Tests, Verify)?
- [ ] Verification commands are testable?

### Step 3: Update Issues

For issues needing improvement:

```bash
gh issue edit <number> --body "$(cat <<'EOF'
[improved body content]
EOF
)"
```

For new tasks, create sub-issues and add them to the parent's tasklist:
```bash
# Create the sub-issue
gh issue create --title "[subtask]" --body "..."
# Edit parent body to include new issue in tasklist
```

### Step 4: Output Changes

```markdown
## Refinement Pass {{ITERATION}}

### Updated Issues
- #[n]: [what changed]

### Added Issues
- #[n]: [why added]

### Remaining Concerns
- [any issues that still need work]
```

### Step 5: Check if Done

If no meaningful improvements can be made, output:

```
:::TOBY_DONE:::
```

---

## Guardrails

1. **DO NOT implement** — only create/update GitHub Issues
2. **~2 minute tasks** — break down larger work
3. **Check duplicates** — search issues before creating
4. **Tasklist order = build order** — prerequisites first in parent tasklist
5. **NO branch/PR tasks** — build prompt handles git workflow
6. **Verify paths** — use Glob/Grep before referencing files in issue bodies

## Command Reference

```bash
# Create
gh issue create --title "..." --body "..." --label "toby/slug"

# Update
gh issue edit <number> --body "..."

# View
gh issue list --label "toby/slug" --state open --json number,title
gh issue view <number> --json body,title,state

# Close
gh issue close <number>
```
