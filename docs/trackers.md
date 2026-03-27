# Tracker Templates

Toby is tracker-agnostic — it doesn't care how you manage tasks, only that the prompts know how to create and query them. Out of the box, toby ships three tracker templates you can choose during `toby init`:

| Tracker | Storage | External tools | Best for |
|---|---|---|---|
| **prd-json** (default) | Local `.toby/*.prd.json` files | None | Solo projects, quick setup, no external dependencies |
| **github** | GitHub Issues (parent + sub-issues) | `gh` CLI | Teams, open source, projects already on GitHub |
| **beads** | Local `.beads/` directory | `bd` CLI | Advanced dependency graphs, offline-first workflows |

## How trackers work

Each tracker provides two prompt templates that replace toby's shipped defaults:

- **PROMPT_PLAN.md** — how the AI creates tasks from a spec
- **PROMPT_BUILD.md** — how the AI finds, claims, implements, and closes tasks

The tracker choice only affects these prompts. Everything else — spec discovery, session management, worktree setup, validation, commit format, PR creation — works identically regardless of tracker.

## Choosing a tracker

During `toby init`, select your tracker. This copies the corresponding prompt templates into your `.toby/` directory as project overrides.

You can also set up a tracker manually:

```bash
# Copy the template prompts to your project
cp templates/github/PROMPT_PLAN.md .toby/PROMPT_PLAN.md
cp templates/github/PROMPT_BUILD.md .toby/PROMPT_BUILD.md
```

See each tracker's `SETUP.md` for requirements and config variables.

## prd-json

The simplest tracker. Tasks live in a JSON file alongside your toby config — no external tools needed.

### How it works

- **Plan** reads the spec and writes a `.prd.json` file with structured tasks
- **Build** parses the JSON to find the next ready task, implements it, and updates the status in the file
- Dependencies are tracked as task ID references within the JSON

### Task lifecycle

```
pending → in_progress → done
                      → blocked (with reason)
```

### Ready detection

A task is ready when its status is `"pending"` and all tasks listed in its `dependencies` array have status `"done"`.

### Config

Add to `.toby/config.json`:

```json
{
  "templateVars": {
    "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json"
  }
}
```

### PRD structure

```json
{
  "spec": "add-auth.md",
  "createdAt": "2025-01-15T10:00:00Z",
  "tasks": [
    {
      "id": "task-001",
      "title": "Add session table to schema",
      "description": "Why this task exists",
      "acceptanceCriteria": ["Sessions are persisted to DB"],
      "files": ["prisma/schema.prisma (modify)"],
      "patterns": ["See prisma/migrations/ for reference"],
      "tests": ["Test that session is created on login"],
      "verify": "pnpm test -- --grep 'session'",
      "dependencies": [],
      "status": "pending",
      "priority": 1
    }
  ]
}
```

## github

Uses GitHub Issues for task tracking. The plan creates a parent issue with a tasklist of sub-issues. The build works through the tasklist in order.

### Requirements

- [`gh` CLI](https://cli.github.com) installed and authenticated (`gh auth login`)
- Repository pushed to GitHub

### How it works

- **Plan** creates sub-issues first, then a parent issue with a tasklist referencing them. The tasklist order defines the build sequence.
- **Build** reads the parent issue, finds the first unchecked `- [ ]` item, implements it, closes the sub-issue, and checks the box in the parent.

### Task lifecycle

```
open → in-progress (label) → closed
                             → blocked (label + comment)
```

### Ready detection

The first unchecked `- [ ] #N` entry in the parent issue's tasklist is the next ready task. No dependency parsing needed — the list order IS the build order.

### Labels

Created automatically on first use:

| Label | Purpose |
|---|---|
| `toby/<spec-slug>` | Applied to the parent issue, used to find it during build |
| `in-progress` | Applied to the sub-issue currently being worked on |
| `blocked` | Applied when a task fails after 3 attempts |

### Parent issue structure

```markdown
## Spec
Implements specs/add-auth.md

## Tasks
- [x] #12 Add session table to schema
- [ ] #13 Create login API endpoint        ← next ready task
- [ ] #14 Add login form component
```

### Config

No config variables needed. The `gh` CLI uses the current repo context.

## beads

Uses the beads CLI (`bd`) for task tracking with native dependency resolution.

### Requirements

- `bd` CLI installed
- Run `bd init` in your project root (creates `.beads/` directory)

### How it works

- **Plan** creates an epic and task issues using `bd create`, then wires dependencies with `bd dep add`
- **Build** uses `bd ready` to find unblocked tasks, claims them with `bd update --status=in_progress`, and closes with `bd close`

### Task lifecycle

```
open → in_progress → closed
                   → bug created (on failure)
```

### Ready detection

`bd ready` handles all dependency resolution natively — it only returns tasks whose blockers are all closed.

### Dependency model

Beads supports explicit dependency graphs:

```bash
bd dep add task-003 task-001   # task-003 depends on task-001
bd dep add task-003 task-002   # task-003 depends on task-002
```

This is more expressive than prd-json (which also supports explicit deps) or github (which uses ordered lists). Use beads when your tasks have complex, non-linear dependency graphs.

### Config

No config variables needed. The `bd` CLI operates on the local `.beads/` directory.

## Switching trackers

To switch trackers on an existing project, replace the prompt files in `.toby/`:

```bash
# Switch from prd-json to github
cp templates/github/PROMPT_PLAN.md .toby/PROMPT_PLAN.md
cp templates/github/PROMPT_BUILD.md .toby/PROMPT_BUILD.md
```

Existing task state from the old tracker won't carry over — you'll need to re-plan any in-progress specs.

## Writing a custom tracker

The template system is designed to be extended. To add your own tracker:

1. Create a directory under `templates/` with your tracker name
2. Add `PROMPT_PLAN.md`, `PROMPT_BUILD.md`, and `SETUP.md`
3. Implement the 10 tracker operations in your prompts:

**Planning operations:**
- Check if tasks already exist for the spec
- Create a grouping (epic, parent issue, or equivalent)
- Create individual tasks with metadata
- Define task ordering or dependencies
- Update/refine existing tasks

**Building operations:**
- Find the next ready task
- Show full task details
- Claim the task (mark as in-progress)
- Close the task (mark as done)
- List all completed tasks (for PR body)

Everything else — worktree setup, path discovery, tracer bullet philosophy, validation, commit format, error recovery, PR gating — is identical across all trackers and should be copied from an existing template.
