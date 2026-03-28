# Unify Prompts and Templates

## Overview

Merge the `prompts/` directory into `templates/`, making `templates/` the single source of shipped prompt files. Update the init wizard to let users choose a tracker (prd-json, github, beads), always copy prompt files to `.toby/`, and set `templateVars` per tracker. Add a transcript toggle to the init wizard.

## Problem

Two versions of prompts exist:
- `prompts/PROMPT_PLAN.md` and `PROMPT_BUILD.md` — stripped-down prd-json defaults used as shipped fallback
- `templates/prd-json/PROMPT_PLAN.md` and `PROMPT_BUILD.md` — richer versions with worktree setup, `patterns`/`tests`/`verify` fields, PR creation

The shipped prompts are weaker than the template versions. Users get the inferior prompts unless they manually copy from `templates/`. The init wizard doesn't mention templates at all, and hardcodes `templateVars` for prd-json without offering alternatives.

## Scope

### In scope
- Delete `prompts/` directory (PROMPT_PLAN.md, PROMPT_BUILD.md, prompts.test.ts)
- Update shipped fallback in `template.ts` to resolve from `templates/prd-json/` instead of `prompts/`
- Add tracker selection phase to interactive init wizard (prd-json, github, beads)
- Copy chosen tracker's PROMPT_PLAN.md + PROMPT_BUILD.md into `.toby/` during init
- Skip copying if `.toby/PROMPT_PLAN.md` or `.toby/PROMPT_BUILD.md` already exist (preserve user customizations)
- Set `templateVars` based on tracker choice (prd-json sets `PRD_PATH`, github/beads set empty `{}`)
- Add `--tracker` flag for non-interactive init (defaults to `prd-json`)
- Add transcript toggle to interactive init wizard
- Add `--transcript` flag for non-interactive init
- Update `getShippedPromptPath` to point to `templates/prd-json/` instead of `prompts/`
- Update tests

### Out of scope
- Adding a `tracker` field to ConfigSchema — the prompt files in `.toby/` ARE the tracker choice
- SETUP.md copying — documentation only, not copied to `.toby/`
- Creating new templates or modifying existing template content
- Changes to config merge logic (covered in spec 44)

## Affected Files

| File | Change |
|------|--------|
| `prompts/` | Delete entire directory |
| `src/lib/template.ts` | Update `getShippedPromptPath` to resolve from `templates/prd-json/` |
| `src/commands/init.tsx` | Add tracker selection phase, copy prompts, add transcript phase, add `--tracker` and `--transcript` flags |
| `src/lib/cli-meta.ts` | Add `--tracker` and `--transcript` flag definitions |
| `src/types.ts` | Add `TRACKER_NAMES` const if needed for validation |
| `src/lib/__tests__/template.test.ts` | Update shipped path expectations |
| Tests for init | Update to cover tracker selection and prompt copying |

## User Stories

### Interactive init
As a user running `toby init`, I can choose between prd-json, github, and beads trackers so that the right prompt files and config are set up for my preferred workflow.

### Non-interactive init
As a CI/scripting user running `toby init --planCli=claude ...`, I can pass `--tracker=github` so that the correct prompts are copied without interactive prompts.

### Prompt customization
As a user who has customized `.toby/PROMPT_PLAN.md`, I can re-run `toby init` without losing my changes because init skips copying when prompt files already exist.

## Init Wizard Flow (Updated)

### Interactive mode phases
```
detecting → plan_cli → plan_model → build_cli → build_model →
tracker → specs_dir → transcript → verbose → done
```

New phases:
1. **tracker** — Select tracker: prd-json (default), github, beads. Show one-line description for each.
2. **transcript** — Toggle: "Record session transcripts?" (default: false)

### Tracker selection UI
```
Select task tracker:
> prd-json — Local JSON files, no external tools required
  github   — GitHub Issues via gh CLI
  beads    — Local beads tracker via bd CLI
```

### What happens on tracker selection
1. Copy `templates/<tracker>/PROMPT_PLAN.md` → `.toby/PROMPT_PLAN.md` (skip if exists)
2. Copy `templates/<tracker>/PROMPT_BUILD.md` → `.toby/PROMPT_BUILD.md` (skip if exists)
3. Set `templateVars` in config:
   - prd-json: `{ "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json" }`
   - github: `{}`
   - beads: `{}`

### Non-interactive mode
- New flag: `--tracker=prd-json|github|beads` (default: `prd-json`)
- New flag: `--transcript` (boolean, default: false)
- Same copy + templateVars logic as interactive

## Architecture

### Shipped prompt resolution (updated)

```typescript
// Before: walks up to find prompts/ directory
export function getShippedPromptPath(name: PromptName): string {
  // find prompts/<name>.md
}

// After: walks up to find templates/prd-json/ directory
export function getShippedPromptPath(name: PromptName): string {
  // find templates/prd-json/<name>.md
}
```

### Prompt copy logic (new, in init.tsx or extracted)

```typescript
function copyTrackerPrompts(tracker: string, localDir: string): { copied: string[] } {
  const copied: string[] = [];
  for (const file of ["PROMPT_PLAN.md", "PROMPT_BUILD.md"]) {
    const dest = path.join(localDir, file);
    if (fs.existsSync(dest)) continue; // preserve existing
    const src = path.join(getTemplatesDir(), tracker, file);
    fs.copyFileSync(src, dest);
    copied.push(file);
  }
  return { copied };
}
```

### Template directory resolution

Similar to `getShippedPromptPath`, walk up from the current file to find the `templates/` directory in the package root.

## Data Model

No changes to `ConfigSchema`. The tracker choice is not persisted in config — the prompt files in `.toby/` are the source of truth.

### InitSelections (updated)
```typescript
export interface InitSelections {
  planCli: CliName;
  planModel: string;
  buildCli: CliName;
  buildModel: string;
  tracker: string;        // NEW: "prd-json" | "github" | "beads"
  specsDir: string;
  transcript: boolean;    // NEW
  verbose: boolean;
}
```

### InitFlags (updated)
```typescript
export interface InitFlags {
  version: string;
  planCli?: string;
  planModel?: string;
  buildCli?: string;
  buildModel?: string;
  specsDir?: string;
  verbose?: boolean;
  tracker?: string;       // NEW
  transcript?: boolean;   // NEW
}
```

## Edge Cases

- **Re-running init with existing prompts:** Skip copying, preserve user customizations. Config is still overwritten (existing behavior).
- **Template files missing from package:** Throw clear error: `Template "github/PROMPT_PLAN.md" not found. Package may be corrupted.`
- **Invalid --tracker value:** Error: `Unknown tracker: "foo". Must be one of: prd-json, github, beads`
- **github tracker without gh CLI:** Init doesn't validate tracker prerequisites — that's the prompt's job at runtime. Init just copies files.

## Acceptance Criteria

- Given `prompts/` directory exists in the package, when the change is applied, then it is deleted and no code references it
- Given `toby init` is run interactively, when the tracker phase is reached, then the user sees 3 options (prd-json, github, beads)
- Given the user selects "github" tracker, when init completes, then `.toby/PROMPT_PLAN.md` and `.toby/PROMPT_BUILD.md` contain the github template content
- Given the user selects "github" tracker, when init completes, then `templateVars` in config is `{}`
- Given the user selects "prd-json" tracker, when init completes, then `templateVars` in config is `{ "PRD_PATH": ".toby/{{SPEC_NAME}}.prd.json" }`
- Given `.toby/PROMPT_PLAN.md` already exists, when init runs, then the existing file is preserved (not overwritten)
- Given `toby init` is run with `--tracker=beads`, when init completes, then beads prompts are copied to `.toby/`
- Given `toby init` is run without `--tracker`, when init completes, then prd-json prompts are copied (default)
- Given no `.toby/PROMPT_PLAN.md` exists and no local override, when `resolvePromptPath` is called, then it falls back to `templates/prd-json/PROMPT_PLAN.md`
- Given the interactive wizard reaches the transcript phase, when the user selects true, then `transcript: true` is written to config
- Given `--transcript` flag is passed in non-interactive mode, when init completes, then `transcript: true` is in config

## Testing Strategy

- Unit test `copyTrackerPrompts`: verify copy for each tracker, verify skip-if-exists
- Unit test `getShippedPromptPath`: verify it resolves to `templates/prd-json/`
- Unit test `createProject`: verify prompt copying, templateVars per tracker, transcript flag
- Integration test: `resolvePromptPath` falls back to `templates/prd-json/` when no local prompt exists
- Snapshot or content test: verify the shipped `templates/prd-json/PROMPT_PLAN.md` exists (replaces old prompts.test.ts)
