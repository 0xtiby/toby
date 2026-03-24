# Session Resume

## Overview

Resume build sessions after crash or abort. If the same CLI is used, continue the session. If a different CLI is used, preserve the worktree context so the new CLI can understand where to continue.

**Note:** Resume is automatic. The existing `continueSession: true` in `runSpecBuild` already handles same-CLI session continuation.

## Users & Problem

**Who has the problem:** Developers running `toby build` sessions that may be interrupted.

**Why it matters:** Without resume, a crash mid-task forces restart from the beginning.

## Scope

### Inclusions
- Auto-resume on same CLI via existing `continueSession: true`
- Cross-CLI resume: pass session name so agent knows worktree context
- Update `lastCli` in status.json after each build

### Exclusions
- Manual resume flag not needed (auto-resume)
- Mid-iteration checkpoint not in v1

## Business Rules

### Resume Behavior

**Same CLI (claude → claude):**
- `continueSession: true` already passed in `runSpecBuild`
- `sessionId` from previous iteration continues automatically

**Different CLI (claude → opencode):**
- `continueSession: false` (sessionId not valid across CLIs)
- Same `session` name passed (worktree context)
- Agent receives same SPEC_NAME, SESSION template vars

### Resume Detection

In `executeBuild()`:

```typescript
const specEntry = status.specs[specName];
const lastIteration = specEntry?.iterations.at(-1);
const hadInProgressIteration = lastIteration?.state === "in_progress";

// same-cli resume: pass sessionId to continue
// cross-cli resume: use same session name but don't pass sessionId
const sessionId = (commandConfig.cli === status.lastCli && hadInProgressIteration)
  ? lastIteration?.sessionId
  : undefined;
```

### Status Updates

After build completes (in `runSpecBuild`):

```typescript
status = {
  ...status,
  sessionName: session,
  lastCli: cli,
};
writeStatus(status, cwd);
```

## Data Model

```typescript
// src/types.ts — StatusSchema already extended with:
// - sessionName: string | null | optional
// - lastCli: string | null | optional
```

## API Changes

### In executeBuild (`src/commands/build.tsx`)

```typescript
const session = flags.session || computeSpecSlug(found.name);
const sessionId = /* inline logic above */;

await runSpecBuild({
  spec: found,
  session,
  sessionId,  // may be undefined for cross-cli
  continueSession: sessionId !== undefined,
  // ...
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ executeBuild()                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Check status.lastCli vs current cli               │  │
│  │ Check if last iteration state === "in_progress"   │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ runSpecBuild()                                    │  │
│  │ - session: same as before                         │  │
│  │ - sessionId: passed if same cli, undefined if    │  │
│  │   different cli                                   │  │
│  │ - continueSession: true if sessionId passed      │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ runLoop()                                        │  │
│  │ - Same CLI: sessionId passed, agent continues     │  │
│  │ - Different CLI: worktree context only           │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashes with claude | Run `toby build --cli=claude` | Session continues |
| Build crashes with claude | Run `toby build --cli=opencode` | Same worktree, new session |
| Resume happens | `--verbose` | "Resuming session: {name}" output |
| Build completes | `lastCli` updated | Next resume uses correct CLI |

## Testing Strategy

1. **Integration tests:** 
   - Build with claude → kill → resume with claude
   - Build with claude → kill → resume with opencode
2. **Manual test:** Full crash/resume cycle
