# 13 — Dynamic Template Variables

> **Note:** This spec was **superseded by spec 16 (Template Variable System)**. The `Record<string, string>` change was implemented, but the frontmatter parsing, `BUILTIN_VARS` constant, `PromptFrontmatter` interface, and per-command `templateVars` were NOT implemented. Spec 16 replaced this approach with a simpler model: root-level `templateVars` in config (not per-command), no frontmatter, and 8 well-defined CLI variables. See spec 16 for the current implementation.

## Overview

Replace the fixed `TemplateVars` interface with a dynamic `Record<string, string>` system. Prompts can declare required/optional variables via YAML frontmatter. Users can define extra variables per-command in `config.json`. This makes prompts self-describing and allows custom tracker integrations without code changes.

## Problem

`TemplateVars` in `types.ts` is a hardcoded interface with 8 fields. Adding or removing a variable requires changing the TypeScript type, updating every call site that constructs the vars object, and recompiling. The `PRD_PATH` variable is PRD-specific and shouldn't exist in a generic orchestrator. Custom prompts (e.g., beads-based) may need variables toby doesn't know about.

## Scope

### In scope

- Replace `TemplateVars` interface with `Record<string, string>`
- Define `BUILTIN_VARS` constant listing vars the code always provides
- Remove `PRD_PATH` from built-in vars (PRD decoupling — spec 12)
- Add YAML frontmatter parsing to prompt files (`required_vars`, `optional_vars`)
- Add `templateVars` field to `CommandConfigSchema` (per plan/build)
- Merge order: built-in vars → config templateVars → substitute into prompt
- Warn (not error) when required vars from frontmatter are missing
- Strip frontmatter from prompt content before substitution
- Update shipped prompts with frontmatter declarations

### Out of scope

- Global-level templateVars (only per-command)
- Runtime variable injection from CLI flags
- Prompt pack/bundle system

## User Stories

- As a user, I can define custom template variables in my config.json per command, so that my custom prompts receive project-specific values.
- As a prompt author, I can declare required and optional variables in YAML frontmatter, so that toby warns when expected vars are missing.
- As a user swapping prompts for beads, I can add `templateVars: { "TRACKER_CMD": "bd", "TRACKER_PATH": ".beads/" }` to my build config and reference `{{TRACKER_CMD}}` in my custom prompt.

## Business Rules

- **Built-in vars** are always injected by the code: `SPEC_NAME`, `ITERATION`, `SPEC_CONTENT`, `BRANCH`, `WORKTREE`, `EPIC_NAME`, `IS_LAST_SPEC`
- **Config vars** are per-command: `plan.templateVars` and `build.templateVars` in config.json
- **Merge order:** built-in vars take precedence over config vars (prevents overriding SPEC_NAME etc.)
- **Frontmatter parsing:** if a prompt starts with `---\n`, parse YAML until closing `---\n`. Extract `required_vars` and `optional_vars` arrays.
- **Validation:** after merging built-in + config vars, check against `required_vars`. If any required var is missing, log a warning to stderr but proceed with substitution.
- **Frontmatter stripping:** the final prompt sent to the AI must not include the YAML frontmatter block.
- **Backward compatibility:** prompts without frontmatter work exactly as before — no frontmatter = no validation.
- **Unknown `{{VAR}}`** patterns in the prompt that don't match any available var are left as literal text (existing behavior, unchanged).

## Data Model

### types.ts changes

```typescript
// BEFORE:
export interface TemplateVars {
  SPEC_NAME: string;
  ITERATION: string;
  BRANCH: string;
  WORKTREE: string;
  EPIC_NAME: string;
  IS_LAST_SPEC: string;
  PRD_PATH: string;
  SPEC_CONTENT: string;
}

// AFTER:
export type TemplateVars = Record<string, string>;

export const BUILTIN_VARS = [
  'SPEC_NAME',
  'ITERATION',
  'SPEC_CONTENT',
  'BRANCH',
  'WORKTREE',
  'EPIC_NAME',
  'IS_LAST_SPEC',
] as const;
```

### Config schema addition

```typescript
export const CommandConfigSchema = z.object({
  cli: z.enum(CLI_NAMES).default("claude"),
  model: z.string().default("default"),
  iterations: z.number().int().positive(),
  templateVars: z.record(z.string(), z.string()).default({}),
});
```

### Prompt frontmatter interface

```typescript
export interface PromptFrontmatter {
  required_vars?: string[];
  optional_vars?: string[];
}
```

## API / Interface

### template.ts — new and changed functions

```typescript
/**
 * Parse YAML frontmatter from prompt content.
 * Returns the frontmatter data and the content without frontmatter.
 * If no frontmatter, returns null frontmatter and original content.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: PromptFrontmatter | null;
  content: string;
};

/**
 * Validate that all required vars from frontmatter are present in the vars map.
 * Logs warnings to stderr for missing required vars.
 * Returns the list of missing var names (empty if all satisfied).
 */
export function validateRequiredVars(
  frontmatter: PromptFrontmatter | null,
  vars: TemplateVars,
  promptName: string,
): string[];

/**
 * Load a prompt: resolve path, read file, parse frontmatter, validate vars, substitute.
 * Now accepts command name to look up config templateVars.
 */
export function loadPrompt(
  name: PromptName,
  vars: TemplateVars,
  cwd?: string,
  configVars?: Record<string, string>,
): string;
```

### Call site changes (build.tsx, plan.tsx)

```typescript
// Before:
loadPrompt("PROMPT_BUILD", {
  SPEC_NAME: found.name,
  ITERATION: String(iteration),
  SPEC_CONTENT: specWithContent.content ?? "",
  PRD_PATH: prdPath,        // REMOVED
  BRANCH: "",
  WORKTREE: "",
  EPIC_NAME: "",
  IS_LAST_SPEC: "false",
}, cwd);

// After:
loadPrompt("PROMPT_BUILD", {
  SPEC_NAME: found.name,
  ITERATION: String(iteration),
  SPEC_CONTENT: specWithContent.content ?? "",
  BRANCH: "",
  WORKTREE: "",
  EPIC_NAME: "",
  IS_LAST_SPEC: "false",
}, cwd, commandConfig.templateVars);
```

## Architecture

### Files to modify

| File | Change |
|------|--------|
| `src/types.ts` | Replace `TemplateVars` interface, add `BUILTIN_VARS`, add `PromptFrontmatter`, add `templateVars` to `CommandConfigSchema` |
| `src/lib/template.ts` | Add `parseFrontmatter()`, `validateRequiredVars()`, update `loadPrompt()` |
| `src/commands/build.tsx` | Remove `PRD_PATH` from vars, pass `commandConfig.templateVars` to `loadPrompt()` |
| `src/commands/plan.tsx` | Remove `PRD_PATH` from vars, pass `commandConfig.templateVars` to `loadPrompt()` |
| `prompts/PROMPT_PLAN.md` | Add YAML frontmatter declaring required/optional vars |
| `prompts/PROMPT_BUILD.md` | Add YAML frontmatter declaring required/optional vars |
| `prompts/PROMPT_BUILD_ALL.md` | Add YAML frontmatter declaring required/optional vars |

### Data flow

```
loadPrompt(name, builtinVars, cwd, configVars)
  │
  ├─ resolvePromptPath(name)  → file path
  ├─ read file
  ├─ parseFrontmatter(raw)    → { frontmatter, content }
  ├─ merge: { ...configVars, ...builtinVars }  (builtins win)
  ├─ validateRequiredVars(frontmatter, mergedVars)  → warnings
  └─ substitute(content, mergedVars)  → final prompt string
```

### YAML parsing dependency

Use a lightweight YAML parser. Options:
- Parse manually (frontmatter is simple key: [array] format — no deep nesting)
- Or add `yaml` npm package

Recommendation: manual parsing since the frontmatter schema is minimal (two optional string arrays). Avoids adding a dependency.

### Shipped prompt frontmatter example

```yaml
---
required_vars:
  - SPEC_NAME
  - ITERATION
  - SPEC_CONTENT
optional_vars:
  - BRANCH
  - WORKTREE
  - EPIC_NAME
---
# Planning Mode: Spec → PRD
...
```

## Acceptance Criteria

- Given a prompt file with YAML frontmatter, when `loadPrompt()` is called, then the frontmatter is parsed and stripped from the output
- Given a prompt file without frontmatter, when `loadPrompt()` is called, then it works exactly as before (backward compatible)
- Given `required_vars: [SPEC_NAME, CUSTOM_VAR]` in frontmatter and `CUSTOM_VAR` not in built-in or config vars, when `loadPrompt()` runs, then a warning is logged to stderr but substitution proceeds
- Given `templateVars: { "CUSTOM_VAR": "myvalue" }` in plan config, when `loadPrompt("PROMPT_PLAN", ...)` runs, then `{{CUSTOM_VAR}}` in the prompt is replaced with `myvalue`
- Given a built-in var `SPEC_NAME` and a config var `SPEC_NAME`, when merging, then the built-in value wins
- Given `{{UNKNOWN}}` in a prompt with no matching var, when substituted, then `{{UNKNOWN}}` remains as literal text
- Given the shipped prompts updated with frontmatter, when `pnpm build` runs, then compilation succeeds
- Given `config.json` with `plan.templateVars.TRACKER_PATH: ".beads/"`, when running `toby plan`, then `{{TRACKER_PATH}}` in the plan prompt resolves to `.beads/`

## Testing Strategy

- Unit tests for `parseFrontmatter()`: with frontmatter, without frontmatter, malformed frontmatter
- Unit tests for `validateRequiredVars()`: all satisfied, some missing, no frontmatter
- Unit tests for `loadPrompt()`: verify frontmatter stripped, config vars merged, built-in precedence
- Unit tests for `CommandConfigSchema`: verify `templateVars` field accepts and defaults correctly
- Integration: shipped prompts with frontmatter pass through `loadPrompt()` without warnings
