# Build Mode: PRD JSON

Implement one task from the PRD per iteration.

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
**PRD:** `{{PRD_PATH}}`
**Iteration:** {{ITERATION}}
**Session:** {{SESSION}}
**Progress:** spec {{SPEC_INDEX}} of {{SPEC_COUNT}}
**All specs:** {{SPECS}}

---

## Path Discovery

**NEVER guess file paths.** Use Glob/Grep to verify paths exist before editing. For new files, verify the parent directory exists.

---

## Phase 0: Worktree Setup

```bash
if [ "{{SPEC_COUNT}}" = "1" ]; then
  BRANCH="feat/{{SPEC_SLUG}}"
else
  BRANCH="{{SESSION}}"
fi
WORKTREE=".worktrees/$BRANCH"

if [ ! -d "$WORKTREE" ]; then
  git worktree add "$WORKTREE" -b "$BRANCH" 2>/dev/null || git worktree add "$WORKTREE" "$BRANCH"
  cd "$WORKTREE"
  pnpm install
else
  cd "$WORKTREE"
fi
```

All work happens inside `$WORKTREE`.

## Phase 1: Find Ready Task

Read `{{PRD_PATH}}`. A task is **ready** when:
- `status` is `"pending"`
- All task IDs in `dependencies` have `status: "done"`

If no ready tasks:
- All tasks `"done"` -> go to **Phase 5: Create PR**
- Some tasks `"blocked"` -> report blockers, output `:::TOBY_DONE:::`

Pick the first ready task.

## Phase 2: Gather Context

1. Read the task's description and acceptance criteria
2. Read the spec at `{{SPECS_DIR}}/{{SPEC_NAME}}.md` for full context
3. Read `architecturalDecisions` from the PRD for durable decisions
4. Read `AGENTS.md` for project conventions
5. Explore the codebase: understand existing patterns, verify functionality doesn't already exist

Update the PRD: set the task's status to `"in_progress"`.

## Phase 3: Implement

Follow the project's testing and coding standards. If a TDD skill or `CODING_STANDARDS.md` exists, follow it.

Default approach when no project standards exist:
- Write tests alongside implementation
- Test through public interfaces, not internals
- Mock only at system boundaries

## Phase 4: Validate

1. Project build
2. Linter
3. Full test suite

All must pass. If validation fails:
1. First attempt: targeted fix
2. Second attempt: alternative approach
3. Third attempt: update PRD, set task status to `"blocked"` with `"blockedReason": "[error]"`. Do NOT commit broken code. Output `:::TOBY_DONE:::`

## Phase 5: Commit

When validation passes:

1. Update the PRD: set the task's status to `"done"`
2. Commit:
   ```bash
   git add -A
   git commit -m "$(cat <<'EOF'
   feat({{SPEC_SLUG}}): [task title]

   [What was implemented and why]

   Key decisions:
   - [Decision and rationale]

   Progress: [current task] done
   Next: [what remains, or "none"]
   EOF
   )"
   git push -u origin HEAD
   ```

**STOP.** Do not pick up another task.

## Phase 6: Create PR

When all tasks in `{{PRD_PATH}}` have status `"done"`:

- If `{{SPEC_COUNT}}` > 1 and `{{SPEC_INDEX}}` < `{{SPEC_COUNT}}`: output `:::TOBY_DONE:::` (not the last spec)

Otherwise:

**Single spec:**
```bash
gh pr create --title "feat: {{SPEC_SLUG}}" --body "$(cat <<'EOF'
## Summary
Implements {{SPECS_DIR}}/{{SPEC_NAME}}.md

### Completed Tasks
[List tasks from PRD with status "done"]

### Testing
- Build, lint, test passing
EOF
)"
```

**Multiple specs (last spec):**
```bash
gh pr create --title "feat: {{SESSION}}" --body "$(cat <<'EOF'
## Summary
Multi-spec build session covering: {{SPECS}}

### Completed Specs
[List all specs built in this session]

### Completed Tasks
[List all done tasks across PRDs]

### Testing
- Build, lint, test passing
EOF
)"
```

Output `:::TOBY_DONE:::`

---

## Guardrails

1. **Single task** -- one per iteration, then stop
2. **Validate before commit** -- never commit failing code
3. **Gather context first** -- read spec, PRD architectural decisions, AGENTS.md before coding
4. **Worktree first** -- all work in the worktree
