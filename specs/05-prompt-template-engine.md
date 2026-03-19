# Prompt Template Engine

## Overview

Load prompt files following the 3-level override chain (local > global > shipped) and substitute template variables like `{{SPEC_NAME}}`, `{{ITERATION}}`, etc. before passing to spawner.

## Problem & Users

Users need to customize prompts per-project (e.g., add monorepo structure, specific verification commands) while keeping sensible defaults. The template engine makes prompts project-aware through variable substitution.

## Scope

### In Scope
- 3-level prompt file resolution (local `.toby/` > global `~/.toby/` > shipped `prompts/`)
- Template variable substitution with `{{VAR_NAME}}` syntax
- All template variables from eniem: SPEC_NAME, ITERATION, BRANCH, WORKTREE, EPIC_NAME, IS_LAST_SPEC
- Additional variables: PRD_PATH, SPEC_CONTENT

### Out of Scope
- Conditional logic in templates (no if/else)
- Template includes or partials
- Writing prompt files (that's init or manual)

## Data Model

```typescript
interface TemplateVars {
  /** Spec filename without extension, e.g. "01-auth" */
  SPEC_NAME: string;
  /** Current iteration number (1-based) */
  ITERATION: string;
  /** Git branch name, e.g. "feat/01-auth" */
  BRANCH: string;
  /** Worktree path, e.g. ".worktrees/feat/01-auth" */
  WORKTREE: string;
  /** Epic/spec name for filtering, same as SPEC_NAME */
  EPIC_NAME: string;
  /** "true" or "false" — is this the last spec in --all mode */
  IS_LAST_SPEC: string;
  /** Path to the prd.json file for this spec */
  PRD_PATH: string;
  /** Full content of the spec markdown file, injected inline */
  SPEC_CONTENT: string;
}

type PromptName = 'PROMPT_PLAN' | 'PROMPT_BUILD' | 'PROMPT_BUILD_ALL';
```

## API / Interface

```typescript
// src/lib/template.ts

/** Resolve the prompt file path using the 3-level chain */
export function resolvePromptPath(name: PromptName, cwd?: string): string;

/** Load and substitute a prompt template */
export function loadPrompt(name: PromptName, vars: TemplateVars, cwd?: string): string;

/** Substitute {{VAR}} placeholders in a string */
export function substitute(template: string, vars: Record<string, string>): string;

/** Get the shipped prompt path (inside the npm package) */
export function getShippedPromptPath(name: PromptName): string;
```

## Business Rules

- **Resolution order:** local `.toby/<name>.md` → global `~/.toby/<name>.md` → shipped `prompts/<name>.md`
- **Exact filename match:** Override only works when the filename matches exactly (e.g., `PROMPT_PLAN.md`)
- **Unknown variables:** `{{UNKNOWN_VAR}}` is left as-is in the output (not an error)
- **Variable names:** Case-sensitive, uppercase with underscores
- **SPEC_CONTENT:** The full raw content of the spec markdown file, read from disk at substitution time
- **Build --all mode:** Uses `PROMPT_BUILD_ALL.md` instead of `PROMPT_BUILD.md`

## Acceptance Criteria

- Given `PROMPT_PLAN.md` exists only in shipped `prompts/`, when resolving, then shipped path is returned
- Given `PROMPT_PLAN.md` exists in both global and local `.toby/`, when resolving, then local path is returned
- Given a template with `{{SPEC_NAME}}`, when substituted with `{ SPEC_NAME: "01-auth" }`, then output contains "01-auth"
- Given a template with `{{UNKNOWN}}`, when substituted, then `{{UNKNOWN}}` remains in output
- Given `SPEC_CONTENT` var, when loading prompt, then the full spec file content is injected
- Given build --all mode, when loading prompt, then `PROMPT_BUILD_ALL.md` is resolved

## Edge Cases

- Prompt file not found at any level: throw error with clear message listing all checked paths
- Empty prompt file: valid but unusual — return empty string after substitution
- Template var contains `{{` characters: only exact `{{VAR_NAME}}` patterns are matched (greedy inner match of word chars)
- Binary file accidentally named PROMPT_PLAN.md: will be read as text — no special handling needed

## Testing Strategy

- Unit test: `resolvePromptPath` follows the 3-level chain correctly
- Unit test: `substitute` replaces all known variables
- Unit test: `substitute` leaves unknown `{{VAR}}` intact
- Unit test: `loadPrompt` reads file and substitutes variables
- Unit test: Resolution prioritizes local over global over shipped
