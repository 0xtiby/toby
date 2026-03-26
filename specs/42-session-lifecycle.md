# Session Lifecycle

## Overview

Manage the full lifecycle of a session: creation on build start, cleanup on successful completion, and interruption on error/abort/max_iterations. Stop the entire session when any spec fails instead of continuing to the next spec. Guard against rebuilding already-done specs.

## Users & Problem

**Primary user:** Any toby user running builds, especially multi-spec batches.

**Problems:**
1. When a spec hits an error (e.g. Claude rate limit), the build loop continues to the next spec — which also fails immediately because the underlying problem (rate limit) affects all specs. Wasted iterations.
2. Already-completed specs can be accidentally re-run, demoting their status from "done" back to "building". This happened when specs 41-43 completed with sentinel but a later retry overwrote their status.
3. After a successful session, `sessionName` persists in status.json, causing the next unrelated build to reuse the old branch/worktree.

## Scope

**In scope:**
- Create session object when `executeBuild`/`executeBuildAll` starts
- Clear session when all specs complete successfully
- Set `session.state = "interrupted"` on error/abort/max_iterations
- Stop multi-spec loop on ANY non-sentinel stop reason (error, abort, max_iterations)
- Guard: refuse to build a spec that is already "done"
- Summary output on interruption with `toby resume` hint

**Out of scope:**
- The `toby resume` command itself (spec 43)
- Selective retry of errored specs (user re-runs manually)
- Plan session lifecycle (build only)

## Business Rules

### Session Creation

- When `executeBuild` (single spec) starts: create session with `specs: [specName]`
- When `executeBuildAll` (multi spec) starts: create session with `specs: [all spec names in order]`
- Session name follows existing logic: `--session` flag > generated name (multi) / spec slug (single)
- Session is written to status.json immediately before the first iteration

### Session Completion (Clean Exit)

- After each spec completes with `stopReason === "sentinel"`, check if ALL `session.specs` are now "done"
- If all done → clear session from status.json (`clearSession()`)
- This prevents stale session names from persisting

### Session Interruption (Stop on Error)

- When any spec in a multi-spec session hits a non-sentinel stop reason (`error`, `aborted`, `max_iterations`):
  - Set `session.state = "interrupted"`
  - **Stop the loop** — do NOT continue to the next spec
  - Write status.json
- Display summary:
  ```
  Session "dark-mare-32" interrupted at spec 44-init-tracker-mode (error).
  Completed: 41-prd-prompts, 42-beads-prompts, 43-github-issues-prompts (3/5)
  Remaining: 44-init-tracker-mode, 45-usage-guide (2/5)
  Run 'toby resume' to continue.
  ```

### Done Guard

- `executeBuild` must refuse to build a spec with `status === "done"`
- Error message: `Spec '44-init-tracker-mode' is already done. Reset its status in .toby/status.json to rebuild.`
- In `executeBuildAll`, done specs are filtered out before the loop starts (not an error, just skipped silently)

### `detectResume` Changes

The existing `detectResume()` function (build.tsx lines 71-85) is **partially superseded** by the session object:

- **Session name reuse** is now handled by the session object, not by `detectResume().needsResume`
- **Per-spec `sessionId` resolution** is still needed for conversation continuity

`detectResume` should be simplified to only resolve `sessionId` for a given spec:

```typescript
/**
 * Resolve the sessionId for conversation continuity when resuming a spec.
 * Returns the last iteration's sessionId if the CLI matches, undefined otherwise.
 */
function resolveResumeSessionId(
  specEntry: SpecStatusEntry | undefined,
  currentCli: string,
  sessionCli: string,
): string | undefined {
  if (currentCli !== sessionCli) return undefined;
  const lastIteration = specEntry?.iterations.at(-1);
  return lastIteration?.sessionId ?? undefined;
}
```

The old `isCrashResume`/`isExhaustedResume`/`needsResume` flags are removed — session-level state replaces them.

## UI/UX Flow

### Multi-Spec Build Session

```
$ toby build --spec=41,42,43,44,45

Building 5 specs in session "dark-mare-32"...

[1/5] 41-prd-prompts
  Building... iteration 1/10
  Building... iteration 2/10
  ✓ Done (sentinel detected)

[2/5] 42-beads-prompts
  Building... iteration 1/10
  ✓ Done (sentinel detected)

[3/5] 43-github-issues-prompts
  Building... iteration 1/10
  ✓ Done (sentinel detected)

[4/5] 44-init-tracker-mode
  Building... iteration 1/10
  ✗ Error (exit code 1)

Session "dark-mare-32" interrupted at 44-init-tracker-mode (error).
Completed: 41-prd-prompts, 42-beads-prompts, 43-github-issues-prompts (3/5)
Remaining: 44-init-tracker-mode, 45-usage-guide (2/5)
Run 'toby resume' to continue.
```

### Single-Spec Build (Done Guard)

```
$ toby build --spec=41
Error: Spec '41-prd-prompts' is already done. Reset its status in .toby/status.json to rebuild.
```

## API / Interface

### Changes to `executeBuild` (`src/commands/build.tsx`)

```typescript
export async function executeBuild(
  flags: BuildFlags,
  callbacks: BuildCallbacks,
  cwd: string,
  abortSignal?: AbortSignal,
  externalWriter?: TranscriptWriter | null,
): Promise<BuildResult> {
  // ... existing setup ...

  // NEW: Done guard
  if (specEntry.status === "done") {
    throw new Error(`Spec '${found.name}' is already done. Reset its status in .toby/status.json to rebuild.`);
  }

  // NEW: Create session
  let status = readStatus(cwd);
  const sessionObj = createSession(sessionName, commandConfig.cli, [found.name]);
  status = { ...status, session: sessionObj };
  writeStatus(status, cwd);

  // NEW: Resolve per-spec sessionId for conversation continuity
  const resumeSessionId = resolveResumeSessionId(specEntry, commandConfig.cli, sessionObj.cli);

  // ... build logic (pass resumeSessionId to runSpecBuild) ...

  // NEW: Clear session on success
  if (result.specDone) {
    status = clearSession(status);
    writeStatus(status, cwd);
  } else {
    // Error or max_iterations — mark session interrupted
    status = updateSessionState(status, "interrupted");
    writeStatus(status, cwd);
  }
}
```

### Changes to `executeBuildAll` (`src/commands/build.tsx`)

```typescript
export async function executeBuildAll(
  flags: BuildFlags,
  callbacks: BuildAllCallbacks,
  cwd: string,
  abortSignal?: AbortSignal,
  specs?: Spec[],
): Promise<BuildAllResult> {
  // ... existing setup ...

  // NEW: Filter out done specs (silent skip)
  const buildable = planned.filter(spec => {
    const entry = status.specs[spec.name];
    return entry?.status !== "done";
  });

  // NEW: Session management — only create if no existing session (resume path reuses existing)
  const existingSession = status.session;
  if (!existingSession) {
    const sessionObj = createSession(sessionName, commandConfig.cli, planned.map(s => s.name));
    status = { ...status, session: sessionObj };
    writeStatus(status, cwd);
  } else {
    // Resume path: session already exists, just update state to active
    status = updateSessionState(status, "active");
    writeStatus(status, cwd);
  }
  const sessionObj = status.session!;

  // Wrap spec loop in try/catch to handle AbortError (Ctrl+C)
  try {
    for (let i = 0; i < buildable.length; i++) {
      const spec = buildable[i];
      // ... existing per-spec setup ...

      // Per-spec sessionId resolution for conversation continuity
      const specEntry = status.specs[spec.name];
      const resumeSessionId = resolveResumeSessionId(specEntry, commandConfig.cli, sessionObj.cli);

      // existingIterations: count previous iterations so numbering continues
      const existingIterations = specEntry?.iterations.length ?? 0;

      const { result } = await runSpecBuild({
        // ... existing options ...
        sessionId: resumeSessionId,
        existingIterations,
        // specIndex/specCount: use ORIGINAL planned list for consistent numbering,
        // not the filtered buildable list. This keeps template vars stable across resume.
        specIndex: planned.indexOf(spec) + 1,
        specCount: planned.length,
      });
      built.push(result);

      // NEW: On non-sentinel stop, interrupt session and break
      if (!result.specDone) {
        status = readStatus(cwd);  // Re-read: runSpecBuild may have written updates
        status = updateSessionState(status, "interrupted");
        writeStatus(status, cwd);

        // Report summary using session.specs for the full picture
        const allSpecNames = sessionObj.specs;
        const doneSpecs = allSpecNames.filter(name => {
          const entry = readStatus(cwd).specs[name];
          return entry?.status === "done";
        });
        const remainingSpecs = allSpecNames.filter(name => !doneSpecs.includes(name));

        callbacks.onOutput?.(
          `Session "${sessionObj.name}" interrupted at ${spec.name} (${result.error ? "error" : "incomplete"}).`
        );
        callbacks.onOutput?.(
          `Completed: ${doneSpecs.join(", ")} (${doneSpecs.length}/${allSpecNames.length})`
        );
        callbacks.onOutput?.(
          `Remaining: ${remainingSpecs.join(", ")} (${remainingSpecs.length}/${allSpecNames.length})`
        );
        callbacks.onOutput?.("Run 'toby resume' to continue.");
        break;
      }
    }
  } catch (err) {
    // Handle AbortError (Ctrl+C): set session state before re-throwing
    if (err instanceof AbortError) {
      const currentStatus = readStatus(cwd);
      writeStatus(updateSessionState(currentStatus, "interrupted"), cwd);
    }
    throw err;
  }

  // If all session specs are done, clear session
  const finalStatus = readStatus(cwd);
  const allDone = sessionObj.specs.every(name => finalStatus.specs[name]?.status === "done");
  if (allDone) {
    writeStatus(clearSession(finalStatus), cwd);
  }

  return { built };
}
```

**Key changes from current code:**
- Session created only if none exists (resume path reuses existing session)
- `AbortError` caught to set `session.state = "interrupted"` before propagating
- Per-spec `sessionId` resolved via `resolveResumeSessionId` (not old `detectResume`)
- `existingIterations` counted from spec entry for correct iteration numbering on resume
- `specIndex`/`specCount` use the full `planned` list (not filtered `buildable`) so template vars remain stable across builds and resumes

### Changes to `runSpecBuild`

The existing `runSpecBuild` writes `sessionName` and `lastCli` on each iteration start (line 136). Remove this — session is managed by `executeBuild`/`executeBuildAll`:

```typescript
// BEFORE (line 136):
status = { ...status, sessionName: options.session, lastCli: cli };

// AFTER:
// Session is already created by executeBuild/executeBuildAll.
// Remove this line entirely — session fields are no longer per-iteration.
```

Also remove the `sessionName` and `lastCli` references from the `RunSpecBuildOptions` interface if they were only used for this purpose.

## Edge Cases

- **Abort (Ctrl+C) during multi-spec:** `AbortError` is thrown by `runSpecBuild`. The try/catch in `executeBuildAll` sets `session.state = "interrupted"` before re-throwing. The error then propagates to `useCommandRunner.handleError` which renders the interrupt UI.
- **All specs already done in batch:** `buildable` array is empty. Clear session immediately, report "All specs already done."
- **Single spec in session completes:** Clear session. Next `toby build` starts fresh.
- **Error on first spec:** Session interrupted with 0 completed. Summary still shows the full picture.
- **`max_iterations` on one spec:** Treated the same as error — session interrupted, loop stops.
- **Resume calls `executeBuildAll`:** The existing session is detected and reused (not overwritten). Session state transitions from "interrupted" → "active" → "interrupted" or cleared.
- **`existingIterations` on resume:** When a spec already has 5 iterations, the next iteration is numbered 6. `existingIterations` is read from `specEntry.iterations.length` (already computed by `runSpecBuild` line 100/124).
- **`specIndex`/`specCount` stability:** These template vars use the full `planned` list, not the filtered `buildable` list. So if session has specs [a,b,c,d,e] and a,b,c are done, spec d gets `SPEC_INDEX=4, SPEC_COUNT=5` — matching the original build.

## Acceptance Criteria

- **Given** a multi-spec build `[a, b, c]`, **when** all complete with sentinel, **then** session is cleared from status.json
- **Given** a multi-spec build `[a, b, c]`, **when** spec `b` errors, **then** session.state is "interrupted" AND spec `c` is never started
- **Given** a multi-spec build `[a, b, c]`, **when** spec `b` hits max_iterations, **then** session.state is "interrupted" AND spec `c` is never started
- **Given** a multi-spec build is interrupted, **then** output shows completed/remaining counts and `toby resume` hint
- **Given** spec `a` is "done", **when** user runs `toby build --spec=a`, **then** error is thrown with message about resetting status
- **Given** a batch `[a, b, c]` where `a` is "done", **when** `executeBuildAll` runs, **then** `a` is silently skipped and `[b, c]` are built
- **Given** a session exists and all its specs become done, **then** session is removed from status.json
- **Given** Ctrl+C during build, **then** session.state is set to "interrupted" before the process exits

## Testing Strategy

### Unit tests (`src/commands/build.test.tsx`)

Extend existing build tests:

**Session creation:**
- `executeBuild` creates session with single spec
- `executeBuildAll` creates session with all spec names

**Session cleanup:**
- Session is cleared when all specs complete with sentinel
- Session is NOT cleared when some specs are incomplete

**Error stops session:**
- Multi-spec build stops at first error (remaining specs not started)
- Multi-spec build stops at first max_iterations
- `session.state` is "interrupted" after error

**Done guard:**
- `executeBuild` throws for done specs
- `executeBuildAll` silently skips done specs
- Done specs in session.specs are tracked but not rebuilt

**detectResume removal:**
- Old `detectResume()` replaced by `resolveResumeSessionId()`
- Session name comes from session object, not resume detection
- `isCrashResume`/`isExhaustedResume`/`needsResume` flags removed

**Abort handling:**
- Ctrl+C sets session.state to "interrupted" via try/catch in executeBuildAll
- AbortError still propagates to useCommandRunner for UI rendering

**Resume path (session already exists):**
- `executeBuildAll` detects existing session and skips creation
- Updates session.state to "active"
- Per-spec sessionId resolved for conversation continuity
- existingIterations computed from spec entry for correct numbering

**Summary output:**
- Interruption shows completed/remaining spec names and counts
- Interruption shows `toby resume` hint

**specIndex/specCount stability:**
- Template vars use original planned list, not filtered buildable list
- Consistent across initial build and resume
