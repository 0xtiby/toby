# 24 — Session Transcript

## Overview

Add a `transcript` config option (and `--transcript` CLI flag) that streams the full text output of AI CLI sessions to a timestamped file in `.toby/transcripts/`. When `verbose` is true, all event types are included; otherwise only text events are written.

## Users & Problem

Users running plan/build sessions lose the AI's output once the terminal scrolls past or the session ends. The StreamOutput component only buffers the last 100 events in memory. There is no way to review what the AI said or did after the fact — making debugging, auditing, and knowledge capture difficult.

## Scope

### In scope
- Boolean `transcript` config key (default `false`)
- `--transcript` / `--no-transcript` CLI flag override
- Real-time streaming writes (append per event, survives crashes)
- Timestamped file naming (no overwrite on re-runs)
- Metadata headers per iteration (timestamp, spec, CLI, model, iteration N/max)
- One file per session; `--all` mode produces one combined file
- Verbose mode controls event filtering (text-only vs all events)
- `.toby/transcripts/` storage directory (auto-created)

### Out of scope
- Configurable output directory
- Custom transcript format/template
- Transcript viewer/search commands
- Transcript rotation or cleanup

## User Stories

- **As a developer**, I can enable `transcript: true` in config so that every plan/build session is automatically saved to disk.
- **As a developer**, I can pass `--transcript` to a single run to capture output without changing my config.
- **As a developer**, I can review `.toby/transcripts/<file>.md` after a session to see exactly what the AI produced.
- **As a developer**, I can re-run the same spec and get a new timestamped file without losing the previous transcript.
- **As a developer running `--all` mode**, I get one combined transcript file for the entire multi-spec session.

## Business Rules

1. **Transcript is opt-in.** Default is `false`. No files are written unless explicitly enabled.
2. **CLI flag wins over config.** `--transcript` enables even if config says `false`; `--no-transcript` disables even if config says `true`.
3. **Event filtering follows verbose.**
   - `verbose: false` → only `event.type === "text"` events are written
   - `verbose: true` → all event types are written (text, tool_use, tool_result, error, system)
   - `done` events are never written — they are internal control signals, not user-visible output
4. **One file per session.** A single `toby plan --spec=01-auth` run with 3 iterations produces one file with 3 iteration sections.
5. **`--all` mode → one combined file.** All specs are written to the same file, with spec/iteration headers as separators.
6. **Timestamped filenames.** Format: `<name>-<command>-<YYYYMMDD-HHmmss-SSS>.md` (millisecond precision to avoid collisions). No overwrite, no append to existing files.
7. **Streaming writes.** Events are appended as they arrive via `fs.appendFileSync` or a write stream. The file is always in a readable state.
8. **Directory auto-creation.** `.toby/transcripts/` is created on first write if it doesn't exist.

## Edge Cases

- **Aborted session:** File is kept as-is. Partial transcripts are still valuable. No cleanup on abort. The `close()` call must happen in a `finally` block so it executes even on abort/error (see Architecture).
- **Disk full / write error:** Log a warning to stderr, continue the session. Transcript failure must not break plan/build.
- **Empty session (0 events):** File is created with the metadata header only. Not deleted.
- **Re-run same spec same second:** Millisecond-precision timestamps (`HHmmss-SSS`) make collisions effectively impossible without needing a suffix strategy.
- **Config says verbose=false but user wants full event transcript:** They set `verbose: true` in config or rely on the coupling. No separate transcript verbosity control in v1 — adding a second verbosity axis increases config surface for marginal benefit. If demand appears, a `transcriptVerbose` key can be added later without breaking changes.

## Data Model

### Config addition

```typescript
// In ConfigSchema (src/types.ts)
export const ConfigSchema = z.object({
  plan: PlanConfigSchema.default({}),
  build: BuildConfigSchema.default({}),
  specsDir: z.string().default("specs"),
  excludeSpecs: z.array(z.string()).default(["README.md"]),
  verbose: z.boolean().default(false),
  transcript: z.boolean().default(false),  // ← new
  templateVars: z.record(z.string(), z.string()).default({}),
});
```

### CLI flag addition

```typescript
// In CommandFlags (src/hooks/useCommandRunner.ts) — add transcript field
export interface CommandFlags {
  spec?: string;
  all: boolean;
  iterations?: number;
  verbose: boolean;
  cli?: string;
  session?: string;
  transcript?: boolean;  // ← new
}

// Also update CommandFlags in src/lib/config.ts (used for resolveCommandConfig)
// to include transcript?: boolean
```

## API / Interface

### New module: `src/lib/transcript.ts`

```typescript
import type { CliEvent } from "@0xtiby/spawner";

export interface TranscriptOptions {
  /** Spec name (e.g., "01-auth") — used in filename for single-spec mode. Omit for --all mode. */
  specName?: string;
  /** Command type — used in filename */
  command: "plan" | "build";
  /** Session name — used as filename prefix in --all mode. Falls back to "all" if not provided. */
  session?: string;
  /** Project root */
  cwd: string;
  /** When true, write all event types; when false, text only */
  verbose: boolean;
}

export interface TranscriptWriter {
  /** Append a CLI event (filtered by verbose setting) */
  writeEvent(event: CliEvent): void;
  /** Write iteration header with metadata */
  writeIterationHeader(meta: IterationMeta): void;
  /** Write spec header (for --all mode, separates specs) */
  writeSpecHeader(specName: string, index: number, total: number): void;
  /** Flush and close the file */
  close(): void;
  /** Absolute path to the transcript file */
  readonly filePath: string;
}

export interface IterationMeta {
  iteration: number;
  maxIterations: number;
  cli: string;
  model: string;
  startedAt: string;
}

/** Create a transcript writer. Creates directory and file. */
export function openTranscript(options: TranscriptOptions): TranscriptWriter;
```

### File naming

```
# Single-spec mode:
.toby/transcripts/<specName>-<command>-<YYYYMMDD-HHmmss-SSS>.md

# --all mode (session name provided):
.toby/transcripts/<session>-<command>-<YYYYMMDD-HHmmss-SSS>.md

# --all mode (no session name — e.g., plan --all):
.toby/transcripts/all-<command>-<YYYYMMDD-HHmmss-SSS>.md
```

The filename prefix is resolved as: `session ?? specName ?? "all"`.

Examples:
- `.toby/transcripts/01-auth-plan-20260324-143022-451.md`
- `.toby/transcripts/01-auth-build-20260324-150515-802.md`
- `.toby/transcripts/my-session-build-20260324-160000-123.md` (--all mode with session name)
- `.toby/transcripts/all-plan-20260324-161500-007.md` (--all mode, no session name)

### Transcript file format

```markdown
# Transcript: 01-auth — plan
Started: 2026-03-24T14:30:22Z

---

## Iteration 1/2 — claude (claude-sonnet-4-6)
Started: 2026-03-24T14:30:22Z

<text output here, each event on its own line>

---

## Iteration 2/2 — claude (claude-sonnet-4-6)
Started: 2026-03-24T14:32:05Z

<text output here>
```

When `verbose: true`, non-text events are formatted with type prefix. Formatting follows the same logic as `StreamOutput.tsx`'s `formatEvent()` function, adapted for plaintext:

```
[tool_use] read_file { "path": "src/index.ts" }
[tool_result] <truncated to first 200 chars>
[text] The file contains...
[error] Process exited with code 1
[system] Session started
```

Formatting per event type:
- `text` → `event.content` (no prefix in non-verbose; `[text]` prefix in verbose)
- `tool_use` → `[tool_use] ${event.tool.name} ${JSON.stringify(event.tool.input)}`
- `tool_result` → `[tool_result] ${(event.toolResult.output ?? event.toolResult.error).slice(0, 200)}`
- `error` → `[error] ${event.content}`
- `system` → `[system] ${event.content}`
- `done` → never written (see Business Rule 3)

For `--all` mode, spec headers are added:

```markdown
# Transcript: session-name — build
Started: 2026-03-24T16:00:00Z

---

## Spec 1/3: 01-auth

### Iteration 1/10 — claude (claude-sonnet-4-6)
...
```

## Architecture

### Module placement

New file `src/lib/transcript.ts` — a pure utility with no React/Ink dependencies.

### Integration in commands

Both `executePlan()` and `executeBuild()` (and their `*All` variants) gain the same pattern. Transcript wiring lives **inside** the execute functions (not exposed via callbacks) — the caller only controls whether transcript is enabled via flags/config.

```typescript
// Inside executePlan / executeBuild:
const transcriptEnabled = flags.transcript ?? config.transcript;
const writer = transcriptEnabled
  ? openTranscript({ specName, command: "plan", cwd, verbose: config.verbose })
  : null;

try {
  const result = await runLoop({
    // ...existing options...
    onEvent: (event) => {
      writer?.writeEvent(event);
      callbacks.onEvent?.(event);
    },
    onIterationComplete: (iterResult) => {
      writer?.writeIterationHeader({
        iteration: iterResult.iteration,
        maxIterations: iterResult.maxIterations,
        cli: iterResult.cli,
        model: iterResult.model,
        startedAt: iterResult.startedAt,
      });
      // ...existing status write and callback logic...
    },
  });
  return result;
} finally {
  writer?.close();
}
```

The `--all` variants open one transcript before the spec loop and pass it through. For `executePlanAll`, which has no session concept, the filename prefix defaults to `"all"`. For `executeBuildAll`, the existing `generateSessionName()` result is used.

### Dependencies

- `src/lib/transcript.ts` depends on: `node:fs`, `node:path`, `src/lib/paths.ts` (for `getLocalDir`)
- No dependency on loop.ts — transcript is the caller's concern
- Commands import `openTranscript` and wire it into existing callbacks

### Data flow

```
executePlan / executeBuild
  ├─ openTranscript() → TranscriptWriter (file created)
  ├─ try:
  │   └─ runLoop()
  │       ├─ onEvent → writer.writeEvent(event)    ← streaming write
  │       └─ onIterationComplete → writer.writeIterationHeader()
  └─ finally: writer.close()                        ← always runs, even on abort

executePlanAll / executeBuildAll (--all mode)
  ├─ openTranscript({ session }) → single TranscriptWriter
  ├─ try:
  │   └─ for each spec:
  │       ├─ writer.writeSpecHeader(specName, index, total)
  │       └─ executePlan/executeBuild (writer passed in, not opened again)
  └─ finally: writer.close()
```

### meow flag registration

```typescript
// In src/cli.tsx meow config
transcript: { type: "boolean" }
```

## Acceptance Criteria

### Config & flag

- **Given** `transcript: true` in `.toby/config.json`, **when** I run `toby plan --spec=01-auth`, **then** a file is created at `.toby/transcripts/01-auth-plan-<timestamp>.md`.
- **Given** `transcript: false` in config, **when** I run `toby plan --spec=01-auth --transcript`, **then** a transcript file is created (flag overrides config).
- **Given** `transcript: true` in config, **when** I run `toby plan --spec=01-auth --no-transcript`, **then** no transcript file is created.
- **Given** no `transcript` key in config, **when** I run `toby plan --spec=01-auth`, **then** no transcript file is created (default false).

### File content

- **Given** transcript enabled and `verbose: false`, **when** the session produces text and tool_use events, **then** only text events appear in the transcript.
- **Given** transcript enabled and `verbose: true`, **when** the session produces all event types, **then** all events appear with `[type]` prefixes.
- **Given** transcript enabled, **when** a 3-iteration session runs, **then** the file contains 3 iteration headers with metadata and the text between them.

### File naming & location

- **Given** transcript enabled, **when** I run plan for `01-auth`, **then** the file is at `.toby/transcripts/01-auth-plan-<YYYYMMDD-HHmmss>.md`.
- **Given** transcript enabled, **when** I re-run the same spec, **then** a new file with a different timestamp is created (old file untouched).
- **Given** `.toby/transcripts/` does not exist, **when** first transcript is written, **then** the directory is created automatically.

### --all mode

- **Given** transcript enabled and `--all` flag, **when** I run `toby build --all`, **then** one combined transcript file is created with spec headers separating each spec's output.
- **Given** transcript enabled and `--all` flag with 3 specs, **when** the session runs, **then** the file contains 3 spec headers (`## Spec 1/3: ...`, `## Spec 2/3: ...`, `## Spec 3/3: ...`) via `writeSpecHeader()`.
- **Given** transcript enabled and `toby plan --all` (no session name), **when** the session runs, **then** the filename uses `all` as prefix: `.toby/transcripts/all-plan-<timestamp>.md`.

### Streaming & resilience

- **Given** transcript enabled, **when** the session is aborted mid-iteration, **then** the transcript file contains all events up to the abort point.
- **Given** transcript write fails (disk error), **when** the session continues, **then** a warning is logged to stderr and plan/build is not interrupted.
- **Given** transcript enabled, **when** the session is aborted, **then** `close()` is still called (via `finally` block) and the file is left intact.

## Testing Strategy

- **Unit tests for `transcript.ts`:** Test `openTranscript`, `writeEvent` (text-only and verbose modes), `writeIterationHeader`, `writeSpecHeader`, `close`. Verify file content and format.
- **Unit tests for event filtering:** Confirm only text events are written when `verbose: false`, all events when `verbose: true`. Confirm `done` events are never written regardless of verbose setting.
- **Unit tests for `writeSpecHeader`:** Verify correct `## Spec N/M: specName` headers are written with proper formatting.
- **Unit tests for filename generation:** Verify single-spec, session, and fallback `"all"` prefix modes produce correct filenames with millisecond timestamps.
- **Integration test:** Run `executePlan` with `transcript: true` in a temp directory, verify transcript file exists with expected structure.
- **Flag override test:** Verify `--transcript` overrides `false` config and `--no-transcript` overrides `true` config.
