# 50 — Status, Clean & Welcome Migration

## Overview

Migrate three non-interactive or lightly-interactive commands from Ink to plain chalk output: `status` (table rendering), `clean` (confirmation prompt), and the welcome screen (banner + command selector). Remove the HamsterWheel animation entirely.

## Problem

These commands use Ink `<Box>` and `<Text>` for what amounts to `console.log` with formatting. The welcome screen's HamsterWheel (221 lines of pixel animation math) adds startup latency and complexity for a decorative feature. The clean command's Y/N confirmation is a single prompt that doesn't need React.

## Scope

### In scope
- **Status**: Replace Ink Box/Text table rendering with chalk-formatted stdout
- **Clean**: Replace Ink useInput Y/N with @clack/confirm
- **Welcome**: Replace Ink Welcome/MainMenu/HamsterWheel/InfoPanel with chalk banner + @clack/select
- Delete `src/components/Welcome.tsx`, `MainMenu.tsx`, `InfoPanel.tsx`
- Delete `src/components/hamster/` entirely (HamsterWheel, palette, sprites, wheel)

### Out of scope
- Changes to status data model or computation
- Changes to clean logic (listTranscripts, deleteTranscripts)
- Adding new status display features

## User Stories

### Status
- As a user, I can run `toby status` to see an overview table of all specs.
- As a user, I can run `toby status --spec 01-auth` to see full iteration history for a spec.
- As a user in non-TTY, I see the same output (no interactive elements needed).

### Clean
- As a user, I can run `toby clean` and confirm deletion of transcripts.
- As a user, I can run `toby clean --force` to skip confirmation.
- As a CI script, I need `--force` in non-TTY (no prompt available).

### Welcome
- As a user, I run `toby` with no command and see a styled banner with project stats, then select a command from a menu.
- As a non-TTY user, I run `toby` and see help text (no interactive menu).

## UI/UX Flow

### Status overview
```
$ toby status

  toby status

  Spec                Status     Iterations   Tokens
  ─────────────────────────────────────────────────────
  01-auth             done       3            12,450
  02-database         building   2            8,200
  03-api              planned    1            4,100
  04-frontend         pending    0            0

  Total: 4 specs · 6 iterations · 24,750 tokens
```

### Status detail
```
$ toby status --spec 01-auth

  01-auth — done

  #   Type    CLI      Tokens    Duration   Exit
  ───────────────────────────────────────────────
  1   plan    claude   4,100     45s        0
  2   build   claude   5,200     1m 12s     0
  3   build   claude   3,150     38s        0

  Total: 3 iterations · 12,450 tokens
```

### Clean
```
$ toby clean
  Found 5 transcripts in .toby/transcripts/

◆ Delete all transcripts?
│ ● Yes / ○ No
└

✔ Deleted 5 transcripts

$ toby clean --force
✔ Deleted 5 transcripts
```

### Welcome (TTY)
```
$ toby

  toby v1.8.0
  4 specs · 2 planned · 1 done · 24,750 tokens

◆ What would you like to do?
│ ● plan    — Plan specs with AI loop engine
│ ○ build   — Build tasks with AI
│ ○ resume  — Resume an interrupted build session
│ ○ status  — Show project status
│ ○ config  — Manage configuration
└
```

### Welcome (non-TTY)
```
$ toby
toby v1.8.0 — AI-assisted development loop engine

Commands:
  plan     Plan specs with AI loop engine
  build    Build tasks with AI
  resume   Resume an interrupted build session
  status   Show project status
  config   Manage configuration
  init     Initialize a new project
  clean    Delete transcript files

Run toby <command> --help for usage details.
```

## Data Model

No changes. Uses existing `computeProjectStats()`, `readStatus()`, `listTranscripts()`.

## API / Interface

```typescript
// src/commands/status.ts
export async function runStatus(ctx: CommandContext): Promise<void>;

// src/commands/clean.ts
export async function runClean(ctx: CommandContext): Promise<void>;

// src/commands/welcome.ts (or inline in cli.ts)
export async function runWelcome(): Promise<void>;
```

### Status table formatting (ui/format.ts)
```typescript
export function formatStatusTable(
  specs: SpecStatusEntry[],
): string;

export function formatDetailTable(
  specName: string,
  entry: SpecStatusEntry,
): string;

export function formatProjectStats(
  stats: ProjectStats,
): string;
```

## Architecture

### Files to create/modify
```
src/commands/status.ts   ← replaces status.tsx (simpler, just format + print)
src/commands/clean.ts    ← replaces clean.tsx
src/commands/welcome.ts  ← new file (or inline in cli.ts action handler)
src/ui/format.ts         ← chalk table formatting helpers
```

### Files to DELETE
File deletions are tracked in spec 48 (canonical delete list). This spec is responsible for
replacing the **behavior** of the following components — spec 48 handles the physical file deletion:
- `src/components/Welcome.tsx` → `src/commands/welcome.ts`
- `src/components/MainMenu.tsx` → @clack/select in welcome.ts
- `src/components/InfoPanel.tsx` → `formatProjectStats()` in ui/format.ts
- `src/components/hamster/*` → deleted entirely, no replacement

## Edge Cases

- Status with no `.toby/` directory: "Not a toby project. Run `toby init` first."
- Status with corrupt status.json: warn and show defaults (existing behavior preserved).
- Status with 0 specs: show empty table with "No specs found." message.
- Clean with 0 transcripts: "No transcripts to clean." (exit 0).
- Clean in non-TTY without `--force`: error "Use --force to delete transcripts in non-interactive mode."
- Welcome when not initialized: skip stats line, still show menu.
- Welcome menu selection dispatches to the selected command's `run()` function (e.g., selecting "plan" calls `runPlan()`).
- User cancels welcome menu (Ctrl+C): clack returns cancel symbol. Check with `clack.isCancel()` and exit cleanly.
- Terminal width < 40: truncate spec names in status table.

## Acceptance Criteria

### Status
- Given specs exist, when user runs `toby status`, then a formatted table shows all specs with status, iterations, tokens.
- Given `--spec 01-auth`, when user runs `toby status --spec 01-auth`, then full iteration history is displayed.
- Given no `.toby/` dir, when user runs `toby status`, then error suggests `toby init`.

### Clean
- Given transcripts exist, when user runs `toby clean` in TTY, then @clack/confirm asks before deleting.
- Given `--force`, when user runs `toby clean --force`, then transcripts are deleted without prompt.
- Given non-TTY and no `--force`, then error says to use `--force`.
- Given 0 transcripts, then "No transcripts to clean." is printed.

### Welcome
- Given TTY, when user runs `toby`, then banner with stats + @clack/select menu appears.
- Given user selects "plan" from menu, then `runPlan` is invoked.
- Given non-TTY, when user runs `toby`, then help text is printed (no prompt).
- Given HamsterWheel code, it is completely deleted with no replacement animation.
