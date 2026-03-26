# Session Object Model

## Overview

Replace the flat `sessionName`/`lastCli` fields in `status.json` with a structured session object that tracks which specs belong to a session, the session's state, and the CLI used. This gives `toby resume` a deterministic view of what was running and what needs to continue.

## Users & Problem

**Primary user:** Any toby user running multi-spec builds.

**Problem:** `status.json` currently stores only `sessionName` and `lastCli` as flat fields. There's no record of which specs belong to that session. When a session is interrupted, the user has no way to resume it without manually reconstructing the spec list. Worse, the stale session name persists after completion, causing subsequent builds to accidentally reuse the old branch/worktree.

## Scope

**In scope:**
- New `SessionSchema` type in `src/types.ts`
- Replace `sessionName`/`lastCli` with `session` object in `StatusSchema`
- Update all code that reads/writes `sessionName` and `lastCli`
- Backwards compatibility: ignore old `sessionName`/`lastCli` fields if present

**Out of scope:**
- Migration of old status.json data (old sessions can't be resumed anyway)
- Concurrent session support (single session per project)
- Storing iterations/model config in session (use config defaults)

## Data Model

### New Types (`src/types.ts`)

```typescript
export const SessionStateSchema = z.enum([
  "active",       // session currently in progress
  "interrupted",  // stopped by error, abort, or max_iterations
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionSchema = z.object({
  /** Session name, used for branch/worktree identity (e.g. "dark-mare-32") */
  name: z.string(),
  /** CLI used to start this session */
  cli: z.string(),
  /** Ordered list of spec names in this session */
  specs: z.array(z.string()),
  /** Current session state */
  state: SessionStateSchema,
  /** When the session was created */
  startedAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;
```

### Updated StatusSchema

```typescript
export const StatusSchema = z.object({
  specs: z.record(z.string(), SpecStatusEntrySchema),
  session: SessionSchema.optional(),
  // REMOVED: sessionName, lastCli (replaced by session object)
});
```

### Example status.json

```json
{
  "specs": {
    "41-prd-prompts": { "status": "done", ... },
    "42-beads-prompts": { "status": "done", ... },
    "43-github-issues-prompts": { "status": "done", ... },
    "44-init-tracker-mode": { "status": "building", "stopReason": "error", ... },
    "45-usage-guide": { "status": "planned", ... }
  },
  "session": {
    "name": "dark-mare-32",
    "cli": "claude",
    "specs": ["41-prd-prompts", "42-beads-prompts", "43-github-issues-prompts", "44-init-tracker-mode", "45-usage-guide"],
    "state": "interrupted",
    "startedAt": "2026-03-26T12:28:35.526Z"
  }
}
```

## API / Interface

### Session helpers (`src/lib/status.ts`)

```typescript
/**
 * Create a new session object.
 * `startedAt` is auto-generated as the current ISO timestamp.
 */
export function createSession(name: string, cli: string, specs: string[]): Session

/** Update session state */
export function updateSessionState(status: StatusData, state: SessionState): StatusData

/** Clear the session (on successful completion) */
export function clearSession(status: StatusData): StatusData

/**
 * Check if a resumable session exists.
 * Returns true when session.state is "interrupted" OR "active"
 * (an "active" session that persisted means the process crashed
 * without updating state — treat it as resumable).
 */
export function hasResumableSession(status: StatusData): boolean
```

### Updated code paths

All references to `status.sessionName` and `status.lastCli` must be updated:

- `src/commands/build.tsx` — session creation, session name reuse, `lastCli` comparison, `detectResume` (see spec 42 for details)
- `src/lib/status.ts` — `StatusSchema` definition, any helpers

Note: `src/commands/plan.tsx` does NOT write `sessionName` or `lastCli` — only `runSpecBuild` in build.tsx does. No plan changes needed.

## Business Rules

- **One session per project.** Starting a new build while a session exists overwrites the previous session. No concurrent session support.
- **Session is optional.** `status.json` without a `session` field is valid (no active session).
- **Backwards compatibility:** If old `sessionName`/`lastCli` fields are present in status.json, they are silently dropped on read. Use `StatusSchema.strip()` (not `.passthrough()`) so that `writeStatus()` produces clean JSON without stale fields.
- **Session name is worktree identity.** The `session.name` is passed to the AI CLI and determines which git branch/worktree is used. Same name = same branch.
- **Session.cli determines conversation continuity.** Resume with same CLI can pass `sessionId` for conversation continuity. Different CLI starts fresh.

## Edge Cases

- `status.json` with both old `sessionName` and new `session` fields → use `session`, ignore `sessionName`
- `session.specs` references a spec name that no longer exists in `specs/` → skip it during resume, log a warning
- `session.specs` is empty → treat as no session

## Acceptance Criteria

- **Given** a fresh project, **when** `readStatus()` is called, **then** `status.session` is `undefined`
- **Given** a build starts with specs `[a, b, c]`, **when** `createSession()` is called, **then** `status.session` contains `{ name, cli, specs: ["a","b","c"], state: "active" }`
- **Given** a session exists with old `sessionName`/`lastCli` format, **when** `readStatus()` is called, **then** parsing succeeds and `session` is `undefined` (old fields ignored)
- **Given** `hasResumableSession()` is called with `session.state === "interrupted"`, **then** it returns `true`
- **Given** `hasResumableSession()` is called with `session.state === "active"`, **then** it returns `true` (crashed process)
- **Given** `hasResumableSession()` is called with no session, **then** it returns `false`
- **Given** `clearSession()` is called, **then** `status.session` is `undefined`

## Testing Strategy

### Unit tests (`src/lib/__tests__/status.test.ts`)

Extend existing status tests:

- `createSession` returns correct shape with all fields
- `updateSessionState` transitions state correctly
- `clearSession` removes session from status
- `hasResumableSession` returns true for interrupted AND active, false for undefined
- `StatusSchema` parsing tolerates old `sessionName`/`lastCli` fields
- `StatusSchema` parsing works with new `session` object
- `StatusSchema` parsing works with no session at all
