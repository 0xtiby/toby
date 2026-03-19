# PRD & Status Data Model

## Overview

Define the data structures for `prd.json` (per-spec task tracking) and `status.json` (spec-level iteration/session tracking). The AI agent writes `prd.json` during planning; toby reads and updates `status.json` during both plan and build.

## Problem & Users

The plan phase produces tasks; the build phase works through them. Toby needs a structured format for tasks (prd.json) and a way to track which iterations have run, with session IDs for potential future session resumption.

## Scope

### In Scope
- prd.json schema (per-spec, written by AI agent during plan)
- status.json schema (project-wide, managed by toby)
- Zod validation for both schemas
- Read/write utilities for both files
- File locations: `.toby/prd/<spec-name>.json` and `.toby/status.json`

### Out of Scope
- Creating prd.json (AI agent does this via prompt instructions)
- Modifying task status in prd.json (AI agent does this during build)
- Session resumption commands (not in MVP)

## Data Model

### prd.json (per spec)

```typescript
const TaskStatusSchema = z.enum(['pending', 'in_progress', 'done', 'blocked']);

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  files: z.array(z.string()),
  dependencies: z.array(z.string()),
  status: TaskStatusSchema.default('pending'),
  priority: z.number().int().positive(),
});

const PrdSchema = z.object({
  spec: z.string(),
  createdAt: z.string().datetime(),
  tasks: z.array(TaskSchema),
});

type Prd = z.infer<typeof PrdSchema>;
type Task = z.infer<typeof TaskSchema>;
type TaskStatus = z.infer<typeof TaskStatusSchema>;
```

#### Example: `.toby/prd/01-auth.json`

```json
{
  "spec": "01-auth.md",
  "createdAt": "2026-03-19T10:00:00Z",
  "tasks": [
    {
      "id": "task-001",
      "title": "Add user schema and migration",
      "description": "Create the user table with email, hashed password, and timestamps",
      "acceptanceCriteria": [
        "User table exists with email, password_hash, created_at, updated_at",
        "Migration runs cleanly on empty database"
      ],
      "files": [
        "src/db/schema.ts (modify)",
        "src/db/migrations/001_users.ts (create)"
      ],
      "dependencies": [],
      "status": "pending",
      "priority": 1
    },
    {
      "id": "task-002",
      "title": "Implement registration endpoint",
      "description": "POST /auth/register with email/password validation",
      "acceptanceCriteria": [
        "Returns 201 with user object on success",
        "Returns 400 on invalid email format",
        "Returns 409 on duplicate email"
      ],
      "files": [
        "src/routes/auth.ts (create)",
        "src/routes/auth.test.ts (create)"
      ],
      "dependencies": ["task-001"],
      "status": "pending",
      "priority": 2
    }
  ]
}
```

### status.json (project-wide)

```typescript
const IterationSchema = z.object({
  type: z.enum(['plan', 'build']),
  iteration: z.number().int().positive(),
  sessionId: z.string().nullable(),
  cli: z.string(),
  model: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
  taskCompleted: z.string().nullable(),
  tokensUsed: z.number().int().nullable(),
});

const SpecStatusEntrySchema = z.object({
  status: z.enum(['pending', 'planned', 'building', 'done']),
  plannedAt: z.string().datetime().nullable(),
  iterations: z.array(IterationSchema),
});

const StatusSchema = z.object({
  specs: z.record(z.string(), SpecStatusEntrySchema),
});

type Status = z.infer<typeof StatusSchema>;
type Iteration = z.infer<typeof IterationSchema>;
type SpecStatusEntry = z.infer<typeof SpecStatusEntrySchema>;
```

#### Example: `.toby/status.json`

```json
{
  "specs": {
    "01-auth": {
      "status": "building",
      "plannedAt": "2026-03-19T10:00:00Z",
      "iterations": [
        {
          "type": "plan",
          "iteration": 1,
          "sessionId": "abc-123",
          "cli": "claude",
          "model": "claude-sonnet-4-6",
          "startedAt": "2026-03-19T10:00:00Z",
          "completedAt": "2026-03-19T10:02:30Z",
          "exitCode": 0,
          "taskCompleted": null,
          "tokensUsed": 15000
        },
        {
          "type": "build",
          "iteration": 1,
          "sessionId": "def-456",
          "cli": "claude",
          "model": "claude-opus-4-6",
          "startedAt": "2026-03-19T10:05:00Z",
          "completedAt": "2026-03-19T10:08:00Z",
          "exitCode": 0,
          "taskCompleted": "task-001",
          "tokensUsed": 42000
        }
      ]
    }
  }
}
```

## API / Interface

```typescript
// src/lib/prd.ts

/** Read and validate a prd.json file for a spec */
export function readPrd(specName: string, cwd?: string): Prd | null;

/** Check if a prd.json exists for a spec */
export function hasPrd(specName: string, cwd?: string): boolean;

/** Get the file path for a spec's prd.json */
export function getPrdPath(specName: string, cwd?: string): string;

/** Get task counts by status */
export function getTaskSummary(prd: Prd): Record<TaskStatus, number>;

// src/lib/status.ts

/** Read status.json, creating default if missing */
export function readStatus(cwd?: string): Status;

/** Write status.json */
export function writeStatus(status: Status, cwd?: string): void;

/** Get or create a spec's status entry */
export function getSpecStatus(status: Status, specName: string): SpecStatusEntry;

/** Add an iteration to a spec's history */
export function addIteration(status: Status, specName: string, iteration: Iteration): Status;

/** Update a spec's overall status */
export function updateSpecStatus(status: Status, specName: string, newStatus: SpecStatusEntry['status']): Status;
```

## Business Rules

- **prd.json is written by the AI agent**, not toby. Toby only reads and validates it.
- **status.json is managed by toby.** It's updated after each spawner iteration completes.
- **Task IDs** must be unique within a prd.json file.
- **Dependencies** reference task IDs within the same prd.json.
- **sessionId** comes from spawner's `CliResult.sessionId`. Can be null if the CLI doesn't return one.
- **tokensUsed** comes from spawner's `CliResult.usage.totalTokens`. Can be null.
- **model** in iteration: the actual model used (from spawner result), not the config value.
- **status transitions:**
  - Spec: `pending` → `planned` (after plan completes) → `building` (when build starts) → `done` (all tasks done)
  - Tasks: `pending` → `in_progress` → `done` (or `blocked`)

## Acceptance Criteria

- Given a valid prd.json file, when reading, then it parses and validates without error
- Given a prd.json with invalid schema, when reading, then a clear validation error is returned
- Given no status.json exists, when reading status, then an empty default `{ specs: {} }` is returned
- Given a completed plan iteration, when adding to status, then the iteration is appended to the spec's iterations array
- Given a spec with 3 build iterations, when reading status, then all 3 are present with their session IDs
- Given `getTaskSummary`, when called with a prd containing 2 pending and 1 done task, then returns `{ pending: 2, in_progress: 0, done: 1, blocked: 0 }`

## Edge Cases

- prd.json missing: `readPrd` returns null (not an error — means planning hasn't run yet)
- status.json corrupted: show error with file path, offer to reset
- Empty tasks array in prd.json: valid but unusual — plan prompt produced no tasks
- Duplicate task IDs: validation error on read
- Circular dependencies in tasks: not validated by toby (AI agent's responsibility)

## Testing Strategy

- Unit test: PrdSchema validates correct prd.json
- Unit test: PrdSchema rejects invalid structures
- Unit test: StatusSchema validates correct status.json
- Unit test: `addIteration` appends to existing iterations
- Unit test: `getSpecStatus` returns default for unknown spec
- Unit test: `getTaskSummary` correctly counts by status
- Unit test: `readPrd` returns null for missing file
- Unit test: `readStatus` returns default for missing file
