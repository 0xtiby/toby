# Build Mode: GitHub Issues

Implement one task from GitHub Issues per iteration.

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
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

```bash
gh issue list --label "toby/{{SPEC_SLUG}}" --state open --json number,title,body
```

A task is **ready** when all issues listed in its "Blocked by" section are closed. Check each open issue's blockers:

```bash
gh issue view <blocker-number> --json state -q '.state'
```

If no ready tasks:
- All issues closed -> go to **Phase 5: Create PR**
- Some blocked -> report blockers, output `:::TOBY_DONE:::`

Pick the first ready task.

## Phase 2: Gather Context

1. Read the task: `gh issue view <number> --json title,body`
2. If the task references a parent PRD, fetch it: `gh issue view <prd-number> --json title,body`
3. Read `AGENTS.md` for project conventions
4. Explore the codebase: understand existing patterns, verify functionality doesn't already exist

Add `in-progress` label:

```bash
gh issue edit <number> --add-label "in-progress"
```

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
3. Third attempt:
   ```bash
   gh issue comment <number> --body "Blocked: [error description]"
   gh issue edit <number> --add-label "blocked" --remove-label "in-progress"
   ```
   Do NOT commit broken code. Output `:::TOBY_DONE:::`

## Phase 5: Commit & Close

When validation passes:

1. Close the issue:
   ```bash
   gh issue close <number>
   gh issue edit <number> --remove-label "in-progress"
   ```

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
   Closes #<number>
   EOF
   )"
   git push -u origin HEAD
   ```

**STOP.** Do not pick up another task.

## Phase 6: Create PR

When all issues with label `toby/{{SPEC_SLUG}}` are closed:

- If `{{SPEC_COUNT}}` > 1 and `{{SPEC_INDEX}}` < `{{SPEC_COUNT}}`: output `:::TOBY_DONE:::` (not the last spec)

Otherwise, create PR:

**Single spec:**
```bash
gh pr create --title "feat: {{SPEC_SLUG}}" --body "$(cat <<'EOF'
## Summary
Implements {{SPECS_DIR}}/{{SPEC_NAME}}.md

### Completed Tasks
[List closed issues from gh issue list --label "toby/{{SPEC_SLUG}}" --state closed]

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
[List all closed issues across specs]

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
3. **Gather context first** -- read parent PRD, AGENTS.md before coding
4. **Worktree first** -- all work in the worktree

## Command Reference

```bash
gh issue list --label "toby/slug" --state open --json number,title,body
gh issue view <number> --json title,body,state
gh issue edit <number> --add-label "in-progress"
gh issue close <number>
gh issue comment <number> --body "..."
gh pr create --title "..." --body "..."
```
