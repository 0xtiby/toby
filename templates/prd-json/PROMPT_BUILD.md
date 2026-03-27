# Build Mode

You are in BUILD mode. Implement one task from the PRD, validate, and commit.

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
**PRD:** `{{PRD_PATH}}`
**Iteration:** {{ITERATION}}
**Session:** {{SESSION}}
**Progress:** spec {{SPEC_INDEX}} of {{SPEC_COUNT}}
**All specs:** {{SPECS}}

## Path Discovery Rules (CRITICAL)

**NEVER guess or invent file paths.** Always verify paths exist before referencing them.

Before editing ANY file:
1. Use Glob to find files matching a pattern
2. Use Grep to search for specific code
3. Verify the file exists before editing it

For new files: verify the parent directory exists first.

## Phase 0: Worktree Setup

Before any work, create or enter a git worktree for isolation.

**Branch and worktree naming:**
- **Single spec** (`{{SPEC_COUNT}}` = 1): branch and worktree = `feat/{{SPEC_SLUG}}`
- **Multiple specs** (`{{SPEC_COUNT}}` > 1): branch and worktree = `{{SESSION}}`

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

**IMPORTANT:** All work happens inside the worktree directory. Stay in `$WORKTREE` for the entire build session.

## Phase 0.5: Ready Task Pre-Check

Read `{{PRD_PATH}}` and check if any task is ready (status `"pending"` with all dependencies `"done"`).

If no ready tasks:
- If ALL tasks are `"done"` -> go to **Phase 5: Create PR**
- If some tasks are `"blocked"` -> report blockers and output `:::TOBY_DONE:::`
- Otherwise -> output `:::TOBY_DONE:::`

## Phase 1: Find Ready Task

Parse the PRD JSON. A task is **ready** when:
- `status` is `"pending"`
- All task IDs in `dependencies` have `status: "done"` in the PRD

Pick the ready task with the lowest `priority` value (highest priority).

If no ready tasks exist:
1. Check if all tasks are `"done"` -> go to **Phase 5: Create PR**
2. Otherwise, output `:::TOBY_DONE:::` and exit

## Phase 2: Claim Task

Update the PRD file: set the selected task's status to `"in_progress"`.

Read the task's `description`, `acceptanceCriteria`, `files`, `patterns`, and `tests` fields.

Before making changes, search the codebase to:
- Verify functionality doesn't already exist
- Understand existing patterns
- Identify the actual files to modify

## Phase 3: Implement & Validate

### Tracer Bullet Mindset

Don't outrun your headlights. Build small, validate early, expand from working code.

- Build the **minimum** that satisfies acceptance criteria
- Test **immediately** after each small piece
- Get feedback before expanding

### Implementation

Follow:
- The task's `acceptanceCriteria` and `patterns` fields
- Patterns in `AGENTS.md`
- Existing code conventions

**Test requirement:** Each implementation must include colocated `.test.ts` files.
- Exception: config/schema/static-data-only changes can skip test creation
- `pnpm test` always runs regardless of exception

After implementing, validate:
1. Run the task's `verify` command — must pass
2. Run `pnpm build` — must pass
3. Run `pnpm lint` — must pass
4. Run `pnpm test` — must pass

If validation fails, fix and re-validate. Do NOT proceed until passing.

## Phase 4: Commit & Close

When validation passes:

1. Update the PRD: set the task's status to `"done"`
2. Stage and commit:

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat({{SPEC_SLUG}}): [task title]

Progress: [what was completed this commit]
Next: [what remains for this spec, or "none" if last task]
EOF
)"
git push -u origin HEAD
```

**Commit message format is REQUIRED:**
- Line 1: `feat(spec-slug): short description`
- Line 3: `Progress:` what this commit achieved
- Line 4: `Next:` remaining work (enables context recovery)

**STOP HERE.** Do not pick up another task. Do not look for the next ready task.
Do NOT output `:::TOBY_DONE:::` — the loop engine handles continuation.
Your job for this iteration is done.

## Phase 5: Create PR

**When to create a PR:**
- **Single spec** (`{{SPEC_COUNT}}` = 1): Create PR when all tasks are `"done"`.
- **Multiple specs** (`{{SPEC_COUNT}}` > 1): Create PR only when this is the last spec (`{{SPEC_INDEX}}` = `{{SPEC_COUNT}}`). If `{{SPEC_INDEX}}` < `{{SPEC_COUNT}}`, output `:::TOBY_DONE:::` instead.

When all tasks are done and it's time to create a PR:

1. Read the PRD to get completed task titles

2. Create pull request:

   **Single spec:**
   ```bash
   gh pr create --title "feat: {{SPEC_SLUG}}" --body "$(cat <<'EOF'
   ## Summary
   Implements {{SPECS_DIR}}/{{SPEC_NAME}}.md

   ### Completed Tasks
   [List tasks from PRD with status "done"]

   ### Testing
   - `pnpm build && pnpm lint && pnpm test` passing
   - Manual: [describe what was manually tested]
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
   [List all tasks from all PRDs with status "done"]

   ### Testing
   - `pnpm build && pnpm lint && pnpm test` passing
   - Manual: [describe what was manually tested]
   EOF
   )"
   ```

3. Output completion signal:
   ```
   :::TOBY_DONE:::
   ```

## Error Recovery

If validation fails:
1. First attempt: Targeted fix based on error
2. Second attempt: Alternative approach
3. Third attempt:
   - Update the PRD: set task status to `"blocked"`, add `"blockedReason": "[error description]"`
   - Do NOT commit broken code
   - Exit with `:::TOBY_DONE:::`

## Guardrails

1. **Tracer bullets** — build small, test immediately, expand from working code
2. **Worktree first** — ensure correct worktree before any work
3. **Single task** — implement ONE task per iteration, then STOP
4. **Validate before commit** — never commit failing code
5. **Update PRD** — set status to `"done"` after committing
6. **Tests required** — create colocated `.test.ts` files for implementation code
7. **Verify paths** — use Glob/Grep before editing files
8. **Commit format** — use Progress/Next annotation for context recovery
9. **PR gating** — single spec: PR at end; multi-spec: PR only on last spec
