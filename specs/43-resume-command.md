# Resume Command

## Overview

Add a `toby resume` command that reads the session object from status.json and rebuilds all incomplete specs using the same session name (branch/worktree). When using the same CLI, it passes the last `sessionId` to continue the AI conversation. This is the single entry point for recovering from any interrupted build session.

## Users & Problem

**Primary user:** Any toby user whose build session was interrupted by error, abort, or max iterations.

**Problem:** When a multi-spec build is interrupted, the user has to manually figure out which specs are incomplete, reconstruct the command with the right `--spec` and `--session` flags, and hope they get the branch right. There's no simple "pick up where I left off" command.

## Scope

**In scope:**
- `toby resume` as a dedicated command (meow + Ink, same pattern as other commands)
- `--iterations`, `--verbose`, and `--transcript` flags
- Read session from status.json, filter to incomplete specs
- Preview of what will be resumed before starting
- Delegates to `executeBuildAll` with resolved spec list and session name
- Session ID continuity handled by `executeBuildAll` via `resolveResumeSessionId` (spec 42)
- Welcome screen menu integration
- Help text and `Help` component update

**Out of scope:**
- `--cli` flag to switch CLI on resume (use `toby build` for that)
- `--spec` flag to selectively resume (resume is all-or-nothing for the session)
- Plan session resume (build only)
- Interactive spec selection during resume

## User Stories

- **As a user**, I can run `toby resume` after an interrupted build so that all incomplete specs are rebuilt on the same branch
- **As a user**, I see a preview of what will be resumed (skipped/remaining specs) before building starts
- **As a user**, I can run `toby resume --iterations=20` to increase the iteration limit for specs that hit max_iterations
- **As a user**, I see a clear error message when there's nothing to resume

## Business Rules

- `toby resume` works when `status.session` exists and `session.state` is `"interrupted"` or `"active"` (an "active" session means the process crashed without updating state)
- Resume rebuilds specs from `session.specs` that are NOT "done"
- Specs with `status === "done"` are always skipped, regardless of how they got there
- Resume reuses `session.name` as the session name → same branch/worktree
- Conversation continuity is handled by `executeBuildAll` via `resolveResumeSessionId` (spec 42) — resume does not need to resolve sessionIds itself
- Resume passes the existing session name via `flags.session` so `executeBuildAll` detects the existing session and reuses it (does not create a new one)
- If resume completes all specs → session is cleared (same as normal build completion)
- If resume is interrupted again → session stays/returns to `"interrupted"`
- Concurrent sessions are not supported. Only one session per project.

## UI/UX Flow

### Successful Resume

```
$ toby resume

Resuming session "dark-mare-32"...
  Skipping: 41-prd-prompts (done), 42-beads-prompts (done), 43-github-issues-prompts (done)
  Resuming: 44-init-tracker-mode, 45-usage-guide
  Building 2 specs...

[1/2] 44-init-tracker-mode
  Resuming session "dark-mare-32" (continuing session)
  Building... iteration 1/10
  ✓ Done

[2/2] 45-usage-guide
  Building... iteration 1/10
  Building... iteration 2/10
  ✓ Done

All specs complete. Session cleared.
```

### No Session to Resume

```
$ toby resume
Error: No active session to resume. Use 'toby build --spec=<name>' to start a new build.
```

### Resume with Increased Iterations

```
$ toby resume --iterations=20

Resuming session "dark-mare-32"...
  Skipping: 41-prd-prompts (done), 42-beads-prompts (done), 43-github-issues-prompts (done)
  Resuming: 44-init-tracker-mode, 45-usage-guide
  Building 2 specs (max 20 iterations each)...
```

## Data Model

No new types. Uses existing `Session`, `StatusData`, `BuildFlags`, and `BuildAllResult` from spec 41.

## API / Interface

### Execute Function (`src/commands/resume.tsx`)

```typescript
export interface ResumeFlags {
  iterations?: number;
  verbose?: boolean;
  transcript?: boolean;
}

/**
 * Core resume logic, separated from Ink rendering for testability.
 *
 * 1. Read status.json, validate session exists and is resumable
 * 2. Filter session.specs to incomplete specs
 * 3. Resolve Spec objects from discovered specs
 * 4. Print preview (skipping/resuming)
 * 5. Delegate to executeBuildAll with resolved specs and session name
 *
 * Note: session ID resolution and conversation continuity are handled
 * by executeBuildAll via resolveResumeSessionId (spec 42).
 * Resume only needs to pass the session name via flags.session.
 */
export async function executeResume(
  flags: ResumeFlags,
  callbacks: BuildAllCallbacks & { onOutput?: (message: string) => void },
  cwd?: string,
  abortSignal?: AbortSignal,
): Promise<BuildAllResult>
```

### CLI Integration (`src/cli.tsx`)

New meow flags (add to existing flags object):
```typescript
// No new flags needed — iterations, verbose, transcript already exist
```

New command entry in the commands map:
```typescript
resume: {
  render: (flags) => (
    <Resume
      iterations={flags.iterations}
      verbose={flags.verbose}
      transcript={flags.transcript}
    />
  ),
  waitForExit: true,
}
```

Update the meow help string AND the `Help` component (`src/lib/help.ts`) to include `resume`:
```
Commands
  plan     Plan specs with AI loop engine
  build    Build tasks one-per-spawn with AI
  resume   Resume an interrupted build session
  init     Initialize toby in current project
  status   Show project status
  config   Manage configuration
  clean    Delete all transcript files

Resume Options
  --iterations  Override max iterations per spec
  --verbose     Show full CLI output
  --transcript  Save session transcript
```

### Welcome Screen Integration (`src/components/Welcome.tsx`)

Add "resume" to the `MainMenu` items:
```typescript
const MENU_ITEMS = [
  { label: "plan", value: "plan", ... },
  { label: "build", value: "build", ... },
  { label: "resume", value: "resume", ... },  // NEW
  { label: "status", value: "status", ... },
  { label: "config", value: "config", ... },
];
```

Add rendering case in Welcome:
```typescript
if (selectedCommand === "resume") return <Resume />;
```

Optionally: if there's an active/interrupted session, highlight the "resume" menu item or show the session name next to it.

### Command Component (`src/commands/resume.tsx`)

```typescript
import React from "react";
import { Text, Box } from "ink";

interface ResumeProps {
  iterations?: number;
  verbose?: boolean;
  transcript?: boolean;
}

export default function Resume(props: ResumeProps) {
  // Simple useEffect + useState pattern (similar to clean.tsx)
  // Does NOT use useCommandRunner — specs come from session, not selection
  // Calls executeResume internally
}
```

## Architecture

```
src/commands/resume.tsx        ← executeResume() + Ink component
src/commands/build.tsx         ← executeBuildAll (called by resume with resolved specs)
src/lib/status.ts              ← session helpers (from spec 41)
src/lib/help.ts                ← Help component update (resume in command list)
src/components/Welcome.tsx     ← MainMenu item + render case
src/components/MainMenu.tsx    ← "resume" menu entry
src/cli.tsx                    ← command registry entry + help text
```

### Flow

```
toby resume --iterations=20
  │
  ├─ readStatus() → get session
  ├─ validate: session exists, state === "interrupted"
  ├─ filter session.specs → incomplete specs only
  ├─ resolve Spec objects from specs/ directory
  ├─ print preview (skipping/resuming)
  ├─ updateSessionState("active")
  │
  ├─ executeBuildAll({
  │     session: session.name,
  │     iterations: flags.iterations ?? config.build.iterations,
  │     cli: config.build.cli,
  │   }, callbacks, cwd, abortSignal, resolvedSpecs)
  │
  ├─ on success (all done) → clearSession()
  └─ on interrupt → session stays "interrupted"
```

### Integration with executeBuildAll

`executeResume` prepares the spec list and session name, then calls `executeBuildAll` with pre-resolved specs. `executeBuildAll` already accepts a `specs` parameter (line 316 of current build.tsx) for pre-resolved specs.

The key integration points:
1. Resume passes `flags.session = session.name` → `executeBuildAll` uses this for worktree identity
2. The session object already exists in status.json → `executeBuildAll` detects it (spec 42) and reuses it instead of creating a new one
3. `executeBuildAll` handles per-spec `sessionId` resolution via `resolveResumeSessionId` (spec 42)
4. `existingIterations` is computed per-spec inside `executeBuildAll` from `specEntry.iterations.length`

Resume does NOT need to resolve sessionIds or manage iteration counting — that's all in `executeBuildAll`.

## Edge Cases

- **Session exists but all specs are done:** Error: "All specs in session are already done. No session to resume."
- **Session spec not found in specs/ directory:** Skip with warning: "Spec 'X' from session not found in specs/ — skipping." If ALL specs are missing, error out.
- **Resume interrupted again:** Session stays "interrupted" (set by `executeBuildAll`'s try/catch). User can `toby resume` again.
- **Config CLI differs from session CLI:** Use config CLI for the new run. `resolveResumeSessionId` in `executeBuildAll` handles conversation continuity based on CLI match.
- **No session in status.json:** Error with guidance message.
- **Session state is "active":** Treat as resumable — the previous build likely crashed without updating state. `hasResumableSession` returns true for both "active" and "interrupted" (spec 41).
- **existingIterations accumulation:** When a spec already has 5 iterations from the original build, resume continues numbering from 6. Handled by `executeBuildAll` reading `specEntry.iterations.length`.

## Acceptance Criteria

- **Given** an interrupted session with specs `[a(done), b(error), c(planned)]`, **when** `toby resume` is run, **then** specs `b` and `c` are built, `a` is skipped
- **Given** an interrupted session, **when** `toby resume` is run, **then** the same session name is used (same branch/worktree)
- **Given** an interrupted session with `cli: "claude"` and current config also "claude", **when** resume runs, **then** `executeBuildAll` passes `sessionId` for conversation continuity (via `resolveResumeSessionId`)
- **Given** an interrupted session with `cli: "claude"` and current config is "opencode", **when** resume runs, **then** `executeBuildAll` uses `sessionId = undefined` (fresh conversation)
- **Given** no session in status.json, **when** `toby resume` is run, **then** error message is shown with guidance
- **Given** `toby resume --iterations=20`, **when** resume runs, **then** max iterations is 20 for all specs
- **Given** resume completes all remaining specs, **then** session is cleared from status.json
- **Given** resume is interrupted (Ctrl+C), **then** session.state remains "interrupted"
- **Given** an interrupted session, **when** resume starts, **then** preview shows skipped (done) and resuming (incomplete) specs before building

## Testing Strategy

### Unit tests (`src/commands/resume.test.tsx`)

Follow the same mock pattern as `build.test.tsx`:

```typescript
vi.mock("../lib/config.js", () => ({ loadConfig: vi.fn(), resolveCommandConfig: vi.fn() }));
vi.mock("../lib/specs.js", () => ({ discoverSpecs: vi.fn() }));
vi.mock("../lib/status.js", () => ({
  readStatus: vi.fn(), writeStatus: vi.fn(),
  hasResumableSession: vi.fn(), clearSession: vi.fn(), updateSessionState: vi.fn(),
}));
vi.mock("./build.js", () => ({ executeBuildAll: vi.fn() }));
```

**Core resume flow:**
- `executeResume` calls `executeBuildAll` with only incomplete specs from session
- `executeResume` passes `flags.session = session.name` to `executeBuildAll`
- `executeResume` skips done specs in the preview output

**Error cases:**
- No session → throws with guidance message
- All specs done → throws with "all done" message
- Session spec not in specs/ → skipped with warning
- `hasResumableSession` returns false → throws

**Flags:**
- `--iterations` overrides max iterations in executeBuildAll call
- `--verbose` and `--transcript` passed through

**Preview output:**
- `onOutput` callback receives skipping/resuming messages

### Component tests (`src/commands/resume.test.tsx`)

```typescript
import { render } from "ink-testing-library";
import Resume from "./resume.js";
```

- Renders preview (skipping/resuming) before building starts
- Renders error when no session exists
- Renders summary on completion
- Renders interrupt info on Ctrl+C
