# Session Resume

## Overview

Resume build sessions after crash or iteration exhaustion. The key mechanism is **reusing the session name** persisted in status.json — since the session name is what the CLI uses to create/find worktrees and branches, passing the same name on resume ensures the CLI finds the existing worktree instead of creating a new one.

## Users & Problem

**Who has the problem:** Developers whose `toby build` sessions are interrupted (crash, context limit, kill) or exhausted (max iterations reached without completing).

**Why it matters:** Without resume, a crash or exhaustion creates a new worktree and branch, orphaning the previous work. This is exactly what happened when Claude hit its context limit during session "warm-lynx-52" — re-running with opencode generated a new session name and worktree instead of continuing in the existing one.

## Scope

### Inclusions
- Reuse `sessionName` from status.json instead of generating a new one
- Crash resume (same-CLI): pass `sessionId` for AI context continuity
- Crash resume (cross-CLI): same worktree, fresh AI session
- Exhaustion resume: same worktree, always fresh AI session (no sessionId — the previous session ended cleanly)
- Update `lastCli` and `sessionName` in status.json after each build
- Log resume info to user

### Exclusions
- Manual resume flag not needed (auto-resume is based on crash/exhaustion detection)
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
const isExhaustedResume = specEntry?.stopReason === "max_iterations";
const needsResume = isCrashResume || isExhaustedResume;

// Reuse session name from status (critical for worktree reuse)
const session = flags.session || (needsResume ? status.sessionName : null) || computeSpecSlug(found.name);

// Session ID reuse: ONLY for crash resume with same CLI
// - Crash + same CLI: pass sessionId → AI continues mid-conversation
// - Crash + cross CLI: no sessionId → fresh AI session, same worktree
// - Exhaustion: no sessionId → previous session ended cleanly, start fresh
const isSameCli = commandConfig.cli === status.lastCli;
const sessionId = (isSameCli && isCrashResume)
  ? lastIteration?.sessionId
  : undefined;

if (isCrashResume) {
  const resumeType = isSameCli ? "continuing session" : `switching from ${status.lastCli} to ${commandConfig.cli}`;
  callbacks.onOutput?.(`Resuming session "${session}" (${resumeType})`);
} else if (isExhaustedResume) {
  callbacks.onOutput?.(`⚠ Previous build exhausted iterations without completing. Resuming in worktree "${session}"...`);
}
```

### Why Exhaustion Resume Never Passes sessionId

When `max_iterations` is reached, the CLI process exited cleanly (exit code 0). The AI session is properly closed — there is no interrupted conversation to continue. The value is in the **worktree** (the code changes), not the AI session. So exhaustion resume always starts a fresh AI session in the same worktree, regardless of whether the CLI is the same or different.

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

// FIXED (check if any spec needs resume):
const anyNeedsResume = specsToRun.some(spec => {
  const entry = status.specs[spec.name];
  const last = entry?.iterations.at(-1);
  return last?.state === "in_progress" || entry?.stopReason === "max_iterations";
});
const session = flags.session || (anyNeedsResume ? status.sessionName : null) || generateSessionName();
```

Each spec in the batch checks for crash/exhaustion resume independently.

## Data Model

```typescript
// src/types.ts — StatusSchema (extended in spec 26):
// - sessionName: string | null | optional  → reused for worktree/branch continuity
// - lastCli: string | null | optional      → determines same-cli vs cross-cli resume
```

## API Changes

### In executeBuild (`src/commands/build.tsx`)

```typescript
const isCrashResume = lastIteration?.state === "in_progress";
const isExhaustedResume = specEntry?.stopReason === "max_iterations";
const needsResume = isCrashResume || isExhaustedResume;
const session = flags.session || (needsResume ? status.sessionName : null) || computeSpecSlug(found.name);
const isSameCli = commandConfig.cli === status.lastCli;
// Only pass sessionId for crash + same CLI (exhaustion = clean exit, no session to continue)
const sessionId = (isSameCli && isCrashResume) ? lastIteration?.sessionId : undefined;

await runSpecBuild({
  spec: found,
  session,
  sessionId,                            // undefined for exhaustion, cross-cli, or non-resume
  continueSession: sessionId != null,   // true only for crash + same-cli resume
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
│  │ 2. Resume detection (spec 27):                          │ │
│  │    isCrashResume? isExhaustedResume? needsResume?      │ │
│  │ 3. Session name: flags.session ||                      │ │
│  │    (needsResume ? status.sessionName : null)           │ │
│  │    || computeSpecSlug()                                │ │
│  │ 4. Crash + same CLI? → pass sessionId for AI continuity│ │
│  │    Exhaustion or diff CLI? → no sessionId, fresh AI    │ │
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
│  │ - Crash + same CLI: sessionId passed → AI continues     │ │
│  │ - Crash + cross CLI: no sessionId → fresh AI session   │ │
│  │ - Exhaustion: no sessionId → fresh AI session          │ │
│  │ - All resume types: same worktree via session name     │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ CLI (claude/opencode/codex)                            │ │
│  │ - Receives session name → finds existing worktree      │ │
│  │ - Crash + same CLI: continues AI conversation          │ │
│  │ - Exhaustion or diff CLI: fresh AI, sees prior edits   │ │
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
| Exhaustion + same CLI | Same worktree, fresh AI session (no sessionId — session ended cleanly) |
| Exhaustion + different CLI | Same worktree, fresh AI session (same behavior as same CLI) |
| Crash after a previous exhaustion | Crash takes priority — `isCrashResume` is checked first; stale `stopReason` from prior run is irrelevant |

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashes with claude | Run `toby build` (same cli) | Same worktree reused via sessionName, AI session continued via sessionId |
| Build crashes with claude | Run `toby build --cli=opencode` | Same worktree reused via sessionName, fresh AI session |
| Build exhausts iterations | Run `toby build` (same cli) | Same worktree reused via sessionName, **fresh AI session** (no sessionId) |
| Build exhausts iterations | Run `toby build --cli=opencode` | Same worktree reused via sessionName, fresh AI session |
| Build crashes | Resume happens | "Resuming session: {name}" logged |
| Build exhausts iterations | Resume happens | "Previous build exhausted iterations..." logged |
| Build crashes | Resume with different CLI | Log shows "switching from claude to opencode" |
| Build completes (sentinel) | Next run | No resume, new session name generated |
| No prior session | Fresh build | New session name generated as before |
| User passes `--session=foo` | Build starts | `--session` flag overrides status.sessionName |

## Testing Strategy

1. **Unit tests:** `session` reads from `status.sessionName` when `needsResume` is true
2. **Unit tests:** `flags.session` overrides `status.sessionName`
3. **Unit tests:** Crash + same-CLI resume passes `sessionId`
4. **Unit tests:** Crash + cross-CLI resume does not pass `sessionId`
5. **Unit tests:** Exhaustion resume never passes `sessionId` (regardless of CLI match)
6. **Unit tests:** `continueSession` is true only when `sessionId` is passed
7. **Unit tests:** Crash resume log message includes session name and CLI switch info
8. **Unit tests:** Exhaustion resume log message mentions exhausted iterations
9. **Integration tests:** Write crash state + sessionName to status.json → build → verify same session name passed to CLI
10. **Integration tests:** Write `stopReason: "max_iterations"` + sessionName → build → verify same session name, no sessionId
11. **Manual test:** `toby build --cli=claude` → kill -9 → `toby build --cli=opencode` → verify same worktree
12. **Manual test:** `toby build` with low `--iterations=1` → re-run → verify same worktree, fresh AI session
