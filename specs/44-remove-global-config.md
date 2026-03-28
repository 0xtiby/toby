# Remove Global Config (~/.toby/)

## Overview

Remove the global config layer (`~/.toby/`) from toby. Config and prompt resolution become project-only: `.toby/config.json` + Zod defaults for config, `.toby/PROMPT_*.md` + shipped `templates/` fallback for prompts.

## Problem

The global config at `~/.toby/` adds a 3-level merge chain (global + local + defaults) for config and a 3-level resolution chain for prompts — complexity that provides no practical value:

- `templateVars` are project-specific (PRD_PATH, tracker choice)
- CLI/model preferences are project-specific
- The global config is typically empty `templateVars: {}` with everything else matching Zod defaults
- `toby init` already writes a complete local config, making the global one redundant
- The merge logic in `loadConfig` adds code and test surface for a feature nobody uses

## Scope

### In scope
- Remove `getGlobalDir()` usage from config loading
- Remove `loadGlobalConfig()` and `mergeConfigs()` from `src/lib/config.ts`
- Simplify `loadConfig()` to read only `.toby/config.json` + Zod defaults
- Remove global path from prompt resolution chain in `src/lib/template.ts` (2-level: `.toby/` → shipped fallback)
- Remove `getGlobalDir()` from `src/lib/paths.ts` (or keep but unexport if used nowhere)
- Update tests to reflect simplified resolution

### Out of scope
- Auto-deleting existing `~/.toby/` directories on user machines
- Migration tooling for global → local config
- Changes to the init wizard (covered in spec 45)

## Affected Files

| File | Change |
|------|--------|
| `src/lib/config.ts` | Remove `loadGlobalConfig`, `mergeConfigs`, simplify `loadConfig` to local-only |
| `src/lib/paths.ts` | Remove or unexport `getGlobalDir` |
| `src/lib/template.ts` | Remove global dir from `resolvePromptPath` candidates (line 46) |
| `src/lib/__tests__/config.test.ts` | Remove global config merge tests, update remaining tests |
| `src/lib/__tests__/template.test.ts` | Remove global prompt override tests |
| `src/lib/__tests__/paths.test.ts` | Remove global dir tests if any |

## Data Model

No schema changes. `ConfigSchema` in `src/types.ts` is unchanged.

## Architecture

### Before (3-level config)
```
loadConfig(cwd)
  → loadGlobalConfig()    // ~/.toby/config.json
  → loadLocalConfig(cwd)  // .toby/config.json
  → mergeConfigs(global, local)
  → ConfigSchema.parse(merged)
```

### After (project-only)
```
loadConfig(cwd)
  → read .toby/config.json (or {} if missing)
  → ConfigSchema.parse(raw)   // Zod defaults fill gaps
```

### Before (3-level prompt resolution)
```
resolvePromptPath(name, cwd)
  1. .toby/<name>.md          (project override)
  2. ~/.toby/<name>.md        (global override)  ← REMOVE
  3. prompts/<name>.md        (shipped default)
```

### After (2-level prompt resolution)
```
resolvePromptPath(name, cwd)
  1. .toby/<name>.md          (project override)
  2. templates/prd-json/<name>.md  (shipped fallback — updated in spec 45)
```

Note: The shipped fallback path changes from `prompts/` to `templates/prd-json/` in spec 45. This spec only removes the global middle layer.

## Acceptance Criteria

- Given a project with `.toby/config.json`, when `loadConfig` is called, then only the local config is read and merged with Zod defaults
- Given no `.toby/config.json` exists, when `loadConfig` is called, then Zod defaults are returned (no global fallback)
- Given a prompt file exists at `.toby/PROMPT_PLAN.md`, when `resolvePromptPath` is called, then it returns the local path
- Given no local prompt override exists, when `resolvePromptPath` is called, then it falls back to the shipped prompt (no global check)
- Given `getGlobalDir` is removed/unexported, when building the project, then no compile errors exist
- Given existing tests for global config merging, when tests are run after removal, then all tests pass (global-specific tests removed, remaining tests updated)
