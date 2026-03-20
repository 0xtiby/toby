# Build Mode

You are in BUILD mode. Implement one task from the PRD, validate, and commit.

**Spec:** `specs/{{SPEC_NAME}}.md`
**PRD:** `{{PRD_PATH}}`
**Iteration:** {{ITERATION}}
**Branch:** `{{BRANCH}}`
**Worktree:** `{{WORKTREE}}`

---

## The Spec

{{SPEC_CONTENT}}

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
