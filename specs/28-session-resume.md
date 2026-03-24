# Session Resume

## Overview

Resume build sessions after crash or interruption. The key mechanism is **reusing the session name** persisted in status.json — since the session name is what the CLI uses to create/find worktrees and branches, passing the same name on resume ensures the CLI finds the existing worktree instead of creating a new one.

## Users & Problem

**Who has the problem:** Developers whose `toby build` sessions are interrupted (crash, context limit, kill).

**Why it matters:** Without resume, a crash mid-task creates a new worktree and branch, orphaning the previous work. This is exactly what happened when Claude hit its context limit during session "warm-lynx-52" — re-running with opencode generated a new session name and worktree instead of continuing in the existing one.

## Scope

### Inclusions
- Reuse `sessionName` from status.json instead of generating a new one
- Same-CLI resume: pass `sessionId` for AI context continuity
- Cross-CLI resume: same worktree (via session name), fresh AI session
- Update `lastCli` and `sessionName` in status.json after each build
- Log resume info to user

### Exclusions
- Manual resume flag not needed (auto-resume is based on crash detection)
- Mid-iteration checkpoint not in v1

## Business Rules

### Session Name Reuse (the critical fix)

The session name (e.g., "warm-lynx-52") is passed to the CLI which uses it for worktree and branch naming. Currently, `executeBuild` always computes a new session:

```typescript
// CURRENT (broken for resume):
const session = flags.session || computeSpecSlug(found.name);
```

With resume, it must check status.json first:

```typescript
// FIXED:
const session = flags.session || status.sessionName || computeSpecSlug(found.name);
```

This ensures that when a user re-runs `toby build` after a crash, the same session name is passed to the CLI, which finds the existing worktree and branch.

### Same CLI Resume (claude → claude)

When the CLI matches `status.lastCli`:
- Pass `sessionId` from the last iteration → CLI continues the AI conversation
- `continueSession: true` → agent has full context of prior work
- Same worktree via session name reuse

### Cross-CLI Resume (claude → opencode)

When the CLI differs from `status.lastCli`:
- Don't pass `sessionId` (not valid across CLIs)
- `continueSession: false` → fresh AI session
- **Same worktree** via session name reuse → agent sees all prior file changes
- Agent receives same SPEC_NAME, SESSION template vars → prompt context is preserved

### Resume Detection

In `executeBuild()`:

```typescript
const specEntry = status.specs[specName];
const lastIteration = specEntry?.iterations.at(-1);
const isCrashResume = lastIteration?.state === "in_progress";

// Reuse session name from status (critical for worktree reuse)
const session = flags.session || status.sessionName || computeSpecSlug(found.name);

// Same-CLI: pass sessionId for AI context continuity
// Cross-CLI or no crash: no sessionId, but same worktree via session name
const isSameCli = commandConfig.cli === status.lastCli;
const sessionId = (isSameCli && isCrashResume)
  ? lastIteration?.sessionId
  : undefined;

if (isCrashResume) {
  const resumeType = isSameCli ? "continuing session" : `switching from ${status.lastCli} to ${commandConfig.cli}`;
  callbacks.onOutput?.(`Resuming session "${session}" (${resumeType})`);
}
```

### Status Updates

After each iteration (in `onIterationStart`, spec 26):

```typescript
status = {
  ...status,
  sessionName: session,
  lastCli: commandConfig.cli,
};
writeStatus(status, cwd);
```

This ensures `sessionName` and `lastCli` are always current, even if the process crashes — because they're written at iteration start, not just at the end.

### `executeBuildAll` handling

For `--all` mode, the shared session name is already generated once:

```typescript
// CURRENT:
const session = flags.session || generateSessionName();

// FIXED:
const session = flags.session || status.sessionName || generateSessionName();
```

Each spec in the batch checks for crash resume independently.

## Data Model

```typescript
// src/types.ts — StatusSchema (extended in spec 26):
// - sessionName: string | null | optional  → reused for worktree/branch continuity
// - lastCli: string | null | optional      → determines same-cli vs cross-cli resume
```

## API Changes

### In executeBuild (`src/commands/build.tsx`)

```typescript
const session = flags.session || status.sessionName || computeSpecSlug(found.name);
const isCrashResume = lastIteration?.state === "in_progress";
const isSameCli = commandConfig.cli === status.lastCli;
const sessionId = (isSameCli && isCrashResume) ? lastIteration?.sessionId : undefined;

await runSpecBuild({
  spec: found,
  session,
  sessionId,                            // undefined for cross-cli or non-resume
  continueSession: sessionId != null,   // true only for same-cli resume
  // ...
});
```

### In runSpecBuild (`src/commands/build.tsx`)

Pass `sessionId` through to `runLoop`:

```typescript
await runLoop({
  // ...
  sessionId,                 // NEW: passed from executeBuild for resume
  continueSession: true,     // existing: always true within a session
  // ...
});
```

**Note:** `continueSession` in `runLoop` controls iteration-to-iteration continuity *within* a session. The `sessionId` param is what controls *cross-session* resume.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ executeBuild()                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 1. Read status.json                                    │ │
│  │ 2. Crash detection (spec 27): isCrashResume?           │ │
│  │ 3. Session name: flags.session || status.sessionName   │ │
│  │    || computeSpecSlug()                                │ │
│  │ 4. Same CLI? → pass sessionId for AI continuity        │ │
│  │    Diff CLI? → no sessionId, same worktree via session │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ runSpecBuild()                                         │ │
│  │ - session: reused from status.json (same worktree)     │ │
│  │ - sessionId: passed for same-cli resume                │ │
│  │ - onIterationStart: writes sessionName + lastCli       │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ runLoop()                                              │ │
│  │ - Same CLI resume: sessionId passed → AI continues     │ │
│  │ - Cross-CLI resume: no sessionId → fresh AI session    │ │
│  │ - Either way: same worktree because session name match │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ CLI (claude/opencode/codex)                            │ │
│  │ - Receives session name → finds existing worktree      │ │
│  │ - Same CLI: continues AI conversation via sessionId    │ │
│  │ - Diff CLI: starts fresh but sees all prior file edits │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No prior session (fresh build) | `status.sessionName` is null → falls through to `computeSpecSlug()` |
| User provides `--session` flag | Explicit flag takes priority over status.sessionName |
| Worktree was manually deleted | CLI will recreate it with the same name — work is lost but branch may still exist on remote |
| Multiple specs crashed in --all mode | Each spec checks independently; shared session name still reused |
| status.json has sessionName but spec status is "done" | Don't resume — spec is complete, session name is informational |

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashes with claude | Run `toby build` (same cli) | Same worktree reused via sessionName, AI session continued via sessionId |
| Build crashes with claude | Run `toby build --cli=opencode` | Same worktree reused via sessionName, fresh AI session |
| Build crashes | Resume happens | "Resuming session: {name}" logged |
| Build crashes | Resume with different CLI | Log shows "switching from claude to opencode" |
| Build completes | `sessionName` and `lastCli` updated | Next run can detect same/different CLI |
| No prior session | Fresh build | New session name generated as before |
| User passes `--session=foo` | Build starts | `--session` flag overrides status.sessionName |

## Testing Strategy

1. **Unit tests:** `session` reads from `status.sessionName` when available
2. **Unit tests:** `flags.session` overrides `status.sessionName`
3. **Unit tests:** Same-CLI resume passes `sessionId`, cross-CLI does not
4. **Unit tests:** `continueSession` is true only when `sessionId` is passed
5. **Unit tests:** Resume log message includes session name and CLI switch info
6. **Integration tests:** Write crash state + sessionName to status.json → build → verify same session name passed to CLI
7. **Manual test:** `toby build --cli=claude` → kill -9 → `toby build --cli=opencode` → verify same worktree
