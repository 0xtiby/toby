# Build Mode: Beads

Implement one task from beads per iteration.

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
bd ready --label "toby/{{SPEC_SLUG}}" --json
```

`bd ready` returns only tasks with no open blockers -- no manual dependency checking needed.

If no ready tasks:
- Check if all tasks are done: `bd list --label "toby/{{SPEC_SLUG}}" --status open --json`
- If nothing open -> go to **Phase 5: Create PR**
- If some blocked -> `bd blocked --json`, report blockers, output `:::TOBY_DONE:::`

Pick the first ready task.

## Phase 2: Gather Context

1. Read the task: `bd show <id> --json`
2. Read the parent epic for architectural decisions: `bd show <epic-id> --json`
3. Read the spec at `{{SPECS_DIR}}/{{SPEC_NAME}}.md` for full context
4. Read `AGENTS.md` for project conventions
5. Explore the codebase: understand existing patterns, verify functionality doesn't already exist

Claim the task:

```bash
bd update <id> --claim --json
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
   bd create "Blocked: [error description]" --type bug --deps discovered-from:<id> --json
   ```
   Do NOT commit broken code. Output `:::TOBY_DONE:::`

## Phase 5: Commit & Close

When validation passes:

1. Close the task:
   ```bash
   bd close <id> --reason "Implemented and tested" --json
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
   EOF
   )"
   git push -u origin HEAD
   ```

**STOP.** Do not pick up another task.

## Phase 6: Create PR

When no open tasks remain for `toby/{{SPEC_SLUG}}`:

- If `{{SPEC_COUNT}}` > 1 and `{{SPEC_INDEX}}` < `{{SPEC_COUNT}}`: output `:::TOBY_DONE:::` (not the last spec)

Otherwise:

**Single spec:**
```bash
gh pr create --title "feat: {{SPEC_SLUG}}" --body "$(cat <<'EOF'
## Summary
Implements {{SPECS_DIR}}/{{SPEC_NAME}}.md

### Completed Tasks
[List from bd list --label "toby/{{SPEC_SLUG}}" --status closed --json]

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
[List all closed tasks across specs]

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
3. **Gather context first** -- read epic, spec, AGENTS.md before coding
4. **Worktree first** -- all work in the worktree
5. **Use --claim** -- atomic claim prevents race conditions
6. **Use --json** -- always use --json flag for programmatic output

## Command Reference

```bash
bd ready --label "toby/slug" --json
bd show <id> --json
bd update <id> --claim --json
bd close <id> --reason "..." --json
bd blocked --json
bd list --label "toby/slug" --status open --json
bd list --label "toby/slug" --status closed --json
bd create "..." --type bug --deps discovered-from:<id> --json
```
