# Session Resume

## Overview

Automatically resume build sessions after any interruption (crash, abort, error). If the same CLI is used, resume from the last session. If a different CLI is used, preserve the worktree context so the new CLI can understand where to continue.

## Users & Problem

**Who has the problem:** Developers running long `toby build` sessions that may be interrupted.

**Why it matters:** Without resume, a crash mid-task forces the user to restart from the beginning of that task, losing work and wasting time.

## Scope

### Inclusions
- Auto-resume from last session when same CLI is used
- Preserve worktree context (session name) for different CLI resume
- Resume triggers on any non-sentinel stop reason

### Exclusions
- Manual resume flag not required (auto-resume only)
- Cross-machine resume not supported
- Mid-iteration checkpoint/resume not in v1 (resume from last complete iteration)

## User Stories

| As a | I can | So that |
|------|-------|---------|
| Developer | Have my build auto-resume after crash | I don't lose progress |
| Developer | Switch between CLIs | I can continue work with a different agent |
| Developer | See resume info in verbose mode | I know what's happening |

## Business Rules

### Resume Triggers

Resume is triggered when:
1. `toby build` starts
2. Prior session exists in `status.json` with `sessionName` and `sessionId`
3. `stopReason` of prior session was NOT `sentinel`

### Resume Behavior

**Same CLI (claude → claude, codex → codex, opencode → opencode):**
- Pass `sessionId` and `continueSession: true` to `runLoop()`
- Agent continues from where it left off

**Different CLI (claude → opencode):**
- Pass `sessionName` as worktree context
- Do NOT pass `sessionId` (not valid across CLIs)
- Agent receives context about the worktree to understand prior progress

### Resume Detection

```typescript
function cliMatches(lastCli: string | null | undefined, currentCli: CliName): boolean {
  if (!lastCli) return false;
  return lastCli === currentCli;
}

function shouldResume(status: StatusData, cli: CliName): ResumeDecision {
  if (!status.sessionName || !status.sessionId) {
    return { shouldResume: false };
  }
  
  const lastSpecEntry = getLastSpecEntry(status);
  const lastIteration = lastSpecEntry?.iterations.at(-1);
  
  if (!lastIteration || lastIteration.state === "complete") {
    return { shouldResume: false };
  }
  
  // Same CLI: full resume with sessionId
  // Different CLI: worktree context only
  return {
    shouldResume: true,
    sessionName: status.sessionName,
    sessionId: cliMatches(status.lastCli, cli) ? status.sessionId : null,
  };
}
```

## Data Model

```typescript
// src/types.ts

export interface ResumeDecision {
  shouldResume: boolean;
  sessionName: string | null;
  sessionId: string | null;
}

// Extend StatusData with last session info
export const StatusSchema = z.object({
  specs: z.record(z.string(), SpecStatusEntrySchema),
  sessionName: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  lastCli: z.string().nullable().optional(),  // NEW: track last CLI used
});
```

## API / Interface

### Resume Logic (`src/lib/loop.ts`)

```typescript
export interface LoopOptions {
  // ... existing fields ...
  continueSession?: boolean;
  resumeSessionId?: string;  // NEW: explicit resume session
}

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const {
    // ...
    continueSession = false,
    resumeSessionId,  // NEW
  } = options;
  
  // When resuming:
  // - If resumeSessionId provided: use it directly
  // - If continueSession=true and lastSessionId exists: continue from last
}
```

### Build Integration (`src/commands/build.tsx`)

```typescript
async function executeBuild(flags: BuildFlags, ...) {
  const status = readStatus(cwd);
  const resumeDecision = shouldResume(status, commandConfig.cli);
  
  if (resumeDecision.shouldResume) {
    // Log resume info if verbose
    if (config.verbose) {
      console.log(`Resuming session: ${resumeDecision.sessionName}`);
    }
  }
  
  const session = resumeDecision.sessionName || flags.session || generateSessionName();
  
  await runSpecBuild({
    // ...
    session,
    sessionId: resumeDecision.sessionId,  // may be null for cross-CLI
    continueSession: resumeDecision.sessionId !== null,
  });
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ executeBuild()                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Check status.json for prior session               │  │
│  │ shouldResume() → ResumeDecision                   │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ runSpecBuild()                                    │  │
│  │ - session = resumeDecision.sessionName            │  │
│  │ - sessionId = resumeDecision.sessionId (or null) │  │
│  │ - continueSession = resumeDecision.sessionId !==  │  │
│  │   null                                           │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ runLoop()                                        │  │
│  │ - Same CLI: sessionId passed, agent continues     │  │
│  │ - Different CLI: only sessionName, agent has      │  │
│  │   worktree context to figure out where to resume  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Session exists but worktree deleted | Error and exit (shouldn't happen) |
| status.json corrupted | Error thrown, user must fix |
| No prior session | Start fresh with new session |
| Sentinel reached (completed) | No resume needed |

## Acceptance Criteria

| Given | When | Then |
|-------|------|------|
| Build crashes | Run `toby build` again | Auto-resume from last session |
| Build aborted with Ctrl+C | Run `toby build` again | Auto-resume from last session |
| Build completes with sentinel | Run `toby build` again | Fresh session, no resume |
| Session with claude, resume with opencode | `toby build --cli=opencode` | Resume with worktree context only |
| Resume happens | `--verbose` enabled | "Resuming session: {name}" output |

## Testing Strategy

1. **Unit tests:** `shouldResume()` with various status states
2. **Integration tests:** 
   - Crash same CLI → verify resume with sessionId
   - Crash different CLI → verify resume with sessionName only
3. **Manual test:**
   - `toby build --spec=foo --cli=claude` → kill → `toby build --cli=opencode` → verify worktree context preserved
