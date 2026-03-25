# Clean Transcripts Command

## Overview

Add a `toby clean` command that deletes all transcript files from `.toby/transcripts/`. Transcripts accumulate over time and users need a simple way to reclaim disk space and declutter. The command shows a confirmation prompt before deletion (skippable with `--force`).

## Users & Problem

**Primary user:** Any toby user who has accumulated transcript files from plan/build sessions.

**Problem:** Transcript files in `.toby/transcripts/` grow over time with no built-in way to clean them up. Users must manually navigate to the directory and delete files.

## Scope

**In scope:**
- `toby clean` CLI command
- List all files in `.toby/transcripts/`
- Interactive Ink confirmation before deletion
- `--force` flag to skip confirmation
- Non-TTY support (require `--force` or exit with error)
- Summary output after deletion

**Out of scope:**
- Selective deletion by age, spec name, or pattern
- Cleaning other artifacts (status, config, logs)
- Welcome screen menu integration (CLI-only for now)
- `useCommandRunner` hook — this command doesn't involve spec selection, loop execution, or streaming, so it uses a simpler component pattern (similar to `status.tsx`)

## User Stories

- **As a user**, I can run `toby clean` so that all transcript files are deleted after I confirm
- **As a user**, I can run `toby clean --force` so that transcripts are deleted without confirmation (useful for scripts/CI)
- **As a user**, I see "No transcripts to clean." when the transcripts directory is empty or doesn't exist

## Business Rules

- Deletion targets only files inside `.toby/transcripts/` — never recurse into subdirectories or touch files outside this directory
- The transcripts directory itself is preserved (only its contents are deleted)
- If the directory doesn't exist or is empty, display "No transcripts to clean." and exit with code 0
- In non-TTY mode without `--force`, print an error message and exit with code 1
- Confirmation prompt shows the count of files that will be deleted

## UI/UX Flow

### States

1. **Scanning** — Read the transcripts directory, count files
2. **Empty** — No files found → display "No transcripts to clean." → exit via `useApp().exit()`
3. **Confirming** — Display file count, wait for Y/n keypress via `useInput` from ink (skip if `--force`)
4. **Deleting** — Remove all transcript files
5. **Done** — Display "Deleted N transcript files." → exit via `useApp().exit()`
6. **Cancelled** — User declined → display "Clean cancelled." → exit via `useApp().exit()`

### Confirmation Interaction

Use `useInput` from ink (same pattern as `MultiSpecSelector`):
- `y` or `Enter` → confirm deletion
- `n` or `Escape` → cancel

### Output Examples

```
# No transcripts
No transcripts to clean.

# Confirmation prompt (rendered as Ink Text components)
Found 12 transcript files. Delete all? [Y/n]

# After deletion
Deleted 12 transcript files.

# Cancelled
Clean cancelled.

# Non-TTY without --force
Error: Use --force to clean transcripts in non-interactive mode.
```

## Edge Cases

- `.toby/transcripts/` doesn't exist → "No transcripts to clean.", exit 0
- `.toby/transcripts/` exists but is empty → "No transcripts to clean.", exit 0
- File deletion fails (permissions) → report error, continue deleting remaining files, report count of failures
- Non-TTY without `--force` → error message, exit 1

## Data Model

No new types or schemas. The `TRANSCRIPTS_DIR` constant (`"transcripts"`) is currently a private constant in `src/lib/transcript.ts`. Export it from `src/lib/paths.ts` as `TRANSCRIPTS_DIR` so both `transcript.ts` and `clean.ts` share the same source of truth.

## API / Interface

### Constants (`src/lib/paths.ts`)

```typescript
/** Transcripts subdirectory name inside .toby/ */
export const TRANSCRIPTS_DIR = "transcripts";
```

Update `src/lib/transcript.ts` to import `TRANSCRIPTS_DIR` from `paths.ts` instead of declaring its own.

### Library (`src/lib/clean.ts`)

```typescript
import path from "node:path";
import fs from "node:fs";
import { getLocalDir, TRANSCRIPTS_DIR } from "./paths.js";

/**
 * List all transcript files in .toby/transcripts/.
 * Returns absolute paths. Returns empty array if directory doesn't exist.
 */
export function listTranscripts(cwd?: string): string[]

/**
 * Delete the given transcript files.
 * Returns the number of successfully deleted files.
 * Continues on individual file errors.
 */
export function deleteTranscripts(files: string[]): number
```

### Execute Function (`src/commands/clean.tsx`)

Following the project convention of separating pure logic from React rendering (like `executePlan` in `plan.tsx`):

```typescript
export interface CleanResult {
  deleted: number;
  failed: number;
  total: number;
}

/**
 * Core clean logic, separated from Ink rendering for testability.
 */
export function executeClean(cwd?: string): CleanResult
```

### Command Component (`src/commands/clean.tsx`)

```typescript
import React, { useState, useEffect } from "react";
import { Text, Box, useApp, useInput } from "ink";
import { listTranscripts, deleteTranscripts } from "../lib/clean.js";

interface CleanProps {
  force?: boolean;
}

type CleanPhase = "scanning" | "empty" | "confirming" | "deleting" | "done" | "cancelled";
```

The component uses `useApp().exit()` to exit cleanly after terminal states (empty, done, cancelled).

### CLI Integration (`src/cli.tsx`)

New meow flag:
```typescript
force: { type: "boolean", default: false }
```

New command entry in the `commands` registry:
```typescript
clean: {
  render: (flags) => <Clean force={flags.force} />,
  waitForExit: true,
}
```

Update both the meow help string AND the `<Help>` component to include `clean`:
```
Commands
  plan     Plan specs with AI loop engine
  build    Build tasks one-per-spawn with AI
  init     Initialize toby in current project
  status   Show project status
  config   Manage configuration
  clean    Delete all transcript files

Clean Options
  --force    Skip confirmation prompt
```

## Architecture

```
src/lib/paths.ts          ← export TRANSCRIPTS_DIR constant (shared)
src/lib/transcript.ts     ← import TRANSCRIPTS_DIR from paths.ts (update existing)
src/lib/clean.ts          ← pure functions (list + delete)
src/commands/clean.tsx     ← executeClean() + Ink component (UI states + confirmation)
src/cli.tsx                ← command registry entry + --force flag + help text
```

**Dependencies:**
- `src/lib/paths.ts` — `getLocalDir()` and `TRANSCRIPTS_DIR` for locating `.toby/transcripts/`
- `node:fs` — `readdirSync`, `unlinkSync`
- `node:path` — path joining
- `ink` — `Text`, `Box`, `useApp`, `useInput` for rendering and keyboard input

## Acceptance Criteria

- **Given** transcript files exist in `.toby/transcripts/`, **when** user runs `toby clean` and confirms, **then** all transcript files are deleted and a summary is displayed
- **Given** transcript files exist, **when** user runs `toby clean --force`, **then** all transcript files are deleted without prompting
- **Given** transcript files exist, **when** user runs `toby clean` and declines, **then** no files are deleted and "Clean cancelled." is shown
- **Given** no transcript files exist, **when** user runs `toby clean`, **then** "No transcripts to clean." is displayed
- **Given** `.toby/transcripts/` doesn't exist, **when** user runs `toby clean`, **then** "No transcripts to clean." is displayed
- **Given** non-TTY mode without `--force`, **when** user runs `toby clean`, **then** an error message is shown and process exits with code 1
- **Given** non-TTY mode with `--force`, **when** user runs `toby clean --force`, **then** transcripts are deleted and summary is displayed
- **Given** a file fails to delete, **when** cleaning, **then** remaining files are still deleted and a failure count is reported

## Testing Strategy

### Unit tests (`src/lib/__tests__/clean.test.ts`)

Follow the same pattern as `transcript.test.ts`: temp directory with `mkdtempSync`, `vi.spyOn(process, "cwd")`, cleanup in `afterEach`.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listTranscripts, deleteTranscripts } from "../clean.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-clean-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

**Test cases for `listTranscripts`:**
- Returns empty array when `.toby/transcripts/` doesn't exist
- Returns empty array when directory is empty
- Returns absolute paths of all files in directory
- Does not include subdirectories in results

**Test cases for `deleteTranscripts`:**
- Deletes all provided files, returns count
- Returns 0 for empty array
- Continues on individual file errors, returns partial count

### Component tests (`src/commands/clean.test.tsx`)

Follow the same pattern as `status.test.tsx`: create temp directory with `.toby/transcripts/`, mock `process.cwd()`.

```typescript
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import Clean from "./clean.js";
```

**Test cases:**
- Renders "No transcripts to clean." when directory is empty
- Renders "No transcripts to clean." when directory doesn't exist
- Renders file count and confirmation prompt when files exist
- Renders "Deleted N transcript files." when `--force` is passed
- Renders "Clean cancelled." when user presses `n`
- Renders deletion summary when user presses `y` or `Enter`
