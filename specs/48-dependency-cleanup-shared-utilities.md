# 48 — Dependency Cleanup & Shared Utilities

## Overview

Remove all Ink/React dependencies, add commander + @clack/prompts + ora + chalk, create shared UI utility modules, and update build configuration. This is the foundational spec that other migration specs depend on.

## Problem

The current dependency tree includes 18 MB of node_modules (ink, react, react-reconciler, yoga-layout, etc.) for rendering that is being replaced by lightweight alternatives. The TSX/JSX build pipeline is no longer needed. Shared UI patterns (spinners, prompts, event formatting, TTY detection) should be extracted to avoid duplication across commands.

## Scope

### In scope
- Remove dependencies: `ink`, `ink-select-input`, `ink-spinner`, `ink-text-input`, `react`, `meow`
- Add dependencies: `commander`, `@clack/prompts`, `ora`, `chalk`
- Create `src/ui/` module with shared utilities
- Update `tsconfig.json` (remove `jsx` option)
- Update `package.json` (deps, scripts if needed)
- Delete all React component files, hook files, and hamster directory
- Ensure `@0xtiby/spawner` and `zod` remain unchanged

### Out of scope
- Command implementation (separate specs 49-54)
- Test migration (tests should be updated alongside their respective command specs)

## Business Rules

- Zero React/Ink code remains after migration.
- All `.tsx` files become `.ts` files.
- `chalk` auto-detects color support (respects `NO_COLOR`, `FORCE_COLOR` env vars).
- `ora` auto-detects TTY (no spinner in non-TTY, just text).
- `@clack/prompts` returns a cancel `Symbol` on Ctrl+C (does NOT throw). All callers must check with `clack.isCancel(value)` before using the return value.

## Data Model

```typescript
// src/ui/tty.ts
export function isTTY(): boolean;
export function requireTTY(command: string, suggestion: string): void;

// src/ui/stream.ts
// CliEvent is imported from @0xtiby/spawner — the event type emitted by the loop engine.
// Known event.type values: "text", "tool_use", "tool_result", "error", "system"
// Fields vary by type: .content (text/tool_result), .name (tool_use), .message (error/system)
import type { CliEvent } from "@0xtiby/spawner";
export function writeEvent(event: CliEvent, verbose: boolean): void;
export function writeEventPlain(event: CliEvent, verbose: boolean): void;

// src/ui/spinner.ts
export function createSpinner(text: string): OraInstance;
export function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T>;

// src/ui/prompt.ts
export async function selectSpec(specs: SpecFile[], status: Record<string, SpecStatusEntry>): Promise<SpecFile>;
export async function selectSpecs(specs: SpecFile[], status: Record<string, SpecStatusEntry>): Promise<SpecFile[]>;
export async function confirmAction(message: string): Promise<boolean>;
export function handleCancel(value: unknown): void; // exits on clack cancel symbol

// src/ui/format.ts
export function banner(version: string, stats?: ProjectStats): string;
export function formatStatusTable(entries: SpecStatusEntry[]): string;
export function formatDetailTable(specName: string, entry: SpecStatusEntry): string;
export function formatTokens(n: number): string;
export function formatDuration(ms: number): string;
export function specBadge(status: string): string;
```

## API / Interface

### ui/tty.ts
```typescript
import chalk from "chalk";

export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function requireTTY(command: string, suggestion: string): void {
  if (!isTTY()) {
    console.error(
      `${chalk.red("✖")} toby ${command} requires an interactive terminal.\n  ${suggestion}`
    );
    process.exit(1);
  }
}
```

### ui/stream.ts
```typescript
import chalk from "chalk";
import type { CliEvent } from "@0xtiby/spawner";

// CliEvent is the event type emitted by @0xtiby/spawner during loop execution.
// Known event.type values used by the current StreamOutput component:
//   "text"        → event.content (string)
//   "tool_use"    → event.name (string)
//   "tool_result" → event.content (string)
//   "error"       → event.message (string)
//   "system"      → event.message (string)
// The exact CliEvent shape is defined in @0xtiby/spawner — do not redeclare it here.

export function writeEvent(event: CliEvent, verbose: boolean): void {
  if (!verbose && event.type !== "text") return;
  const line = formatEvent(event);
  process.stdout.write(line + "\n");
}

function formatEvent(event: CliEvent): string {
  switch (event.type) {
    case "text":
      return `  ${event.content}`;
    case "tool_use":
      return chalk.cyan(`  ⚙ ${event.name}`);
    case "tool_result":
      return chalk.gray(`  ↳ ${event.content?.slice(0, 120) ?? ""}`);
    case "error":
      return chalk.red(`  ✗ ${event.message}`);
    case "system":
      return chalk.yellow(`  [system] ${event.message}`);
    default:
      return "";
  }
}

// Non-TTY variant: chalk auto-disables colors when NO_COLOR=1 or stdout is not a TTY,
// so writeEvent can be used in both contexts. writeEventPlain is an explicit fallback
// if needed for machine-readable output.
export function writeEventPlain(event: CliEvent, verbose: boolean): void {
  if (!verbose && event.type !== "text") return;
  const content = event.content ?? event.message ?? event.name ?? "";
  process.stdout.write(`  ${content}\n`);
}
```

### ui/prompt.ts
```typescript
import * as clack from "@clack/prompts";

export async function selectSpecs(
  specs: SpecFile[],
  statusMap: Record<string, SpecStatusEntry>,
): Promise<SpecFile[]> {
  const result = await clack.multiselect({
    message: "Select specs",
    options: specs.map((s) => ({
      label: `${s.name} [${statusMap[s.name]?.status ?? "pending"}]`,
      value: s,
    })),
  });
  handleCancel(result);
  return result as SpecFile[];
}

export function handleCancel(value: unknown): void {
  if (clack.isCancel(value)) {
    clack.cancel("Operation cancelled.");
    process.exit(0);
  }
}
```

### ui/spinner.ts
```typescript
import ora from "ora";

export function createSpinner(text: string) {
  return ora({ text, isSilent: !process.stdout.isTTY });
}
```

## Architecture

### New directory structure
```
src/
├── cli.ts                   ← entry point (was .tsx)
├── types.ts                 ← unchanged
├── commands/
│   ├── plan.ts              ← was .tsx
│   ├── build.ts             ← was .tsx
│   ├── init.ts              ← was .tsx
│   ├── config.ts            ← was .tsx
│   ├── clean.ts             ← was .tsx
│   ├── resume.ts            ← was .tsx
│   ├── status.ts            ← was .tsx
│   └── welcome.ts           ← new (extracted from Welcome component)
├── ui/                      ← NEW shared UI utilities
│   ├── stream.ts
│   ├── spinner.ts
│   ├── prompt.ts
│   ├── format.ts
│   └── tty.ts
└── lib/                     ← unchanged
    ├── paths.ts
    ├── config.ts
    ├── specs.ts
    ├── status.ts
    ├── template.ts
    ├── loop.ts
    ├── errors.ts
    ├── format.ts
    ├── cli-meta.ts           ← simplified (remove meow-specific code)
    ├── clean.ts
    ├── stats.ts
    └── transcript.ts
```

### Files to DELETE
```
src/components/Welcome.tsx
src/components/MainMenu.tsx
src/components/InfoPanel.tsx
src/components/StreamOutput.tsx
src/components/LoadingSpinner.tsx
src/components/MultiSpecSelector.tsx
src/components/hamster/HamsterWheel.tsx
src/components/hamster/palette.ts
src/components/hamster/sprites.ts
src/components/hamster/wheel.ts
src/hooks/useCommandRunner.ts
src/hooks/useModels.ts
```

### Type migration
`CommandFlags` is currently defined in `src/hooks/useCommandRunner.ts`. Before deleting that file,
move `CommandFlags` to `src/types.ts` — it is used by `executePlan()`, `executeBuild()`, and all
command `run()` functions. The type itself is unchanged:
```typescript
export interface CommandFlags {
  spec?: string;
  all: boolean;
  iterations?: number;
  verbose: boolean;
  transcript?: boolean;
  cli?: string;
  session?: string;
}
```

### tsconfig.json changes
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    // REMOVE: "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

### package.json dependency changes
```jsonc
{
  "dependencies": {
    "@0xtiby/spawner": "^1.1.0",
    // ADD:
    "@clack/prompts": "^1.1.0",
    "chalk": "^5.4.0",
    "commander": "^13.0.0",
    "ora": "^8.2.0",
    // KEEP:
    "zod": "^3.24.1",
    // REMOVE:
    // "ink": "^5.0.1",
    // "ink-select-input": "^6.2.0",
    // "ink-spinner": "^5.0.0",
    // "ink-text-input": "^6.0.0",
    // "meow": "^13.2.0",
    // "react": "^18.3.1",
  }
}
```

## Edge Cases

- `chalk` in non-color terminal: chalk auto-detects via `supports-color`. Respects `NO_COLOR=1`.
- `ora` in non-TTY: silent by default (no spinner animation, no output). Use `isSilent` flag.
- `@clack/prompts` cancel: returns a special `Symbol`. Must check with `clack.isCancel()` before using value.
- Build tools: if using tsx/tsup, ensure JSX transform is removed from build config.
- `src/lib/format.ts` vs `src/ui/format.ts`: existing `format.ts` in lib has `formatMaxIterationsWarning`. Keep it there (it's logic, not UI). New `ui/format.ts` is for visual formatting (tables, badges, banners).

## Acceptance Criteria

- Given the migration is complete, then `npm ls ink react meow ink-select-input ink-spinner ink-text-input` shows none of these packages.
- Given the migration is complete, then `grep -r "from 'react'" src/` returns zero results.
- Given the migration is complete, then `grep -r "from 'ink'" src/` returns zero results.
- Given the migration is complete, then no `.tsx` files exist in `src/`.
- Given the migration is complete, then `tsconfig.json` has no `jsx` field.
- Given `NO_COLOR=1`, then all output has no ANSI color codes.
- Given non-TTY, then `ora` produces no spinner animation.
- Given non-TTY, then `@clack/prompts` is never called (commands use flag fallbacks or error).
- Given `src/ui/` utilities, then all commands import shared helpers (no duplicated formatting logic).
- Given the new deps, then total `node_modules` size is under 5 MB (down from 18 MB).

## Planning Order

This spec should be **planned and built first** — it establishes the `src/ui/` utilities and dependency changes that all other migration specs (48-53) depend on. The recommended build order is:

1. **48** — Dependencies + shared utilities
2. **49** — CLI entry point (commander)
3. **50** — Status, Clean, Welcome (simplest commands)
4. **51** — Init command
5. **52** — Config command
6. **53** — Plan command
7. **54** — Build & Resume commands
