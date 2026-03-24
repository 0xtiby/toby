# 25 — Init Verbose Option

Add the `verbose` preference to the `toby init` wizard (interactive and non-interactive modes), so users can set verbose output during project setup without needing a separate `toby config set verbose true` step.

## Overview

The `verbose` config option already exists in the schema and is editable via `toby config`, but `toby init` doesn't include it. This spec adds verbose as the final step in the init wizard and as a CLI flag for non-interactive mode.

## Scope

**In scope:**
- Interactive init wizard: add verbose toggle after `specs_dir` (last step before save)
- Non-interactive init: accept `--verbose` flag, default to `false`
- Write `verbose` into the generated `.toby/config.json`
- Update help text

**Out of scope:**
- Changes to the config command itself
- Changes to how verbose is resolved at runtime (already handled by `useCommandRunner`)

## User Stories

**As a user running `toby init` interactively,** I can set verbose mode during project setup so that I don't need a separate config step.

**As a user running `toby init` non-interactively,** I can pass `--verbose` to enable verbose output in the generated config.

## Business Rules

- Verbose defaults to `false` when omitted (both interactive and non-interactive)
- The toggle appears after `specs_dir` and before project creation
- In non-interactive mode, `--verbose` is optional — omitting it writes `verbose: false`
- `hasAllInitFlags()` must NOT require `--verbose` (it remains optional)

## UI/UX Flows

### Interactive Wizard

After the `specs_dir` step, show:

```
Verbose output:
  Show full CLI output including tool use and system events

  > false
    true
```

Use `SelectInput` with two items (`false`, `true`), defaulting to `false` (index 0). Include a description line above the selector explaining what verbose does.

After selection, proceed to project creation (same as current `specs_dir` submit flow).

### Non-Interactive Mode

```bash
toby init --plan-cli=claude --plan-model=default --build-cli=claude --build-model=default --specs-dir=specs --verbose
```

`--verbose` is a boolean flag. When present, writes `verbose: true` to config.

## Data Model

### InitFlags (update)

```typescript
export interface InitFlags {
  version: string;
  planCli?: string;
  planModel?: string;
  buildCli?: string;
  buildModel?: string;
  specsDir?: string;
  verbose?: boolean;  // NEW — optional, defaults to false
}
```

### InitSelections (update)

```typescript
export interface InitSelections {
  planCli: CliName;
  planModel: string;
  buildCli: CliName;
  buildModel: string;
  specsDir: string;
  verbose: boolean;  // NEW
}
```

### Phase type (update)

```typescript
type Phase =
  | "detecting"
  | "no_cli"
  | "plan_cli"
  | "plan_model"
  | "build_cli"
  | "build_model"
  | "specs_dir"
  | "verbose"    // NEW — after specs_dir, before done
  | "done";
```

## Architecture

### Files Modified

| File | Change |
|------|--------|
| `src/commands/init.tsx` | Add `verbose` phase, update `InitFlags`, `InitSelections`, `createProject`, `InteractiveInit`, `NonInteractiveInit` |
| `src/cli.tsx` | Pass `verbose={flags.verbose}` to `<Init>` in the init command entry; add `--verbose` to Init Options help text |
| `src/commands/init.test.tsx` | Add `verbose` to `DEFAULT_SELECTIONS`; add verbose-specific test cases |

### cli.tsx command entry

Pass `verbose` through to the Init component (currently not forwarded):

```typescript
init: {
  render: (flags, _input, version) => (
    <Init
      version={version}
      planCli={flags.planCli}
      planModel={flags.planModel}
      buildCli={flags.buildCli}
      buildModel={flags.buildModel}
      specsDir={flags.specsDir}
      verbose={flags.verbose}  // NEW
    />
  ),
  waitForExit: true,
},
```

### createProject changes

Add `verbose` to the config partial written to disk:

```typescript
const config: Partial<TobyConfig> = {
  plan: { ... },
  build: { ... },
  specsDir: selections.specsDir,
  verbose: selections.verbose,  // NEW
  templateVars: { ... },
};
```

### hasAllInitFlags

`hasAllInitFlags` remains unchanged — it checks the 5 required flags for non-interactive mode. `--verbose` is optional with a default of `false`, so it doesn't gate non-interactive mode.

### NonInteractiveInit

Read `flags.verbose ?? false` and pass to `createProject`:

```typescript
const selections: InitSelections = {
  planCli: planCli as CliName,
  planModel: flags.planModel!,
  buildCli: buildCli as CliName,
  buildModel: flags.buildModel!,
  specsDir: flags.specsDir!,
  verbose: flags.verbose ?? false,  // NEW
};
```

### InteractiveInit

Add `verbose` phase between `specs_dir` and `done`. On submit of `specs_dir`, transition to `verbose` instead of calling `createProject`. On verbose selection, call `createProject` and transition to `done`.

Update the initial `useState<InitSelections>` to include the new field:

```typescript
const [selections, setSelections] = useState<InitSelections>({
  planCli: "claude",
  planModel: "default",
  buildCli: "claude",
  buildModel: "default",
  specsDir: DEFAULT_SPECS_DIR,
  verbose: false,  // NEW
});
```

**Re-init behavior:** When running `toby init` in a project that already has a config, the wizard always defaults verbose to `false`. It does not read the existing config value. This is consistent with how all other wizard fields behave (they default to hardcoded values, not existing config).

## Acceptance Criteria

- **Given** a user runs `toby init` interactively, **when** they reach the verbose step, **then** they see a true/false toggle with a description of what verbose does
- **Given** a user selects `true` for verbose in the init wizard, **when** project files are created, **then** `.toby/config.json` contains `"verbose": true`
- **Given** a user selects `false` (or accepts the default), **when** project files are created, **then** `.toby/config.json` contains `"verbose": false`
- **Given** a user runs `toby init --plan-cli=claude --plan-model=default --build-cli=claude --build-model=default --specs-dir=specs --verbose`, **when** init completes, **then** `.toby/config.json` contains `"verbose": true`
- **Given** a user runs non-interactive init without `--verbose`, **when** init completes, **then** `.toby/config.json` contains `"verbose": false`
- **Given** a user runs `toby init --help`, **then** `--verbose` appears under Init Options

## Testing Strategy

All tests go in `src/commands/init.test.tsx`. Update the existing `DEFAULT_SELECTIONS` constant:

```typescript
const DEFAULT_SELECTIONS: InitSelections = {
  planCli: "claude",
  planModel: "default",
  buildCli: "claude",
  buildModel: "default",
  specsDir: "specs",
  verbose: false,  // NEW
};
```

### createProject tests

- `createProject` with `verbose: false` — verify `config.verbose` is `false` in written JSON
- `createProject` with `verbose: true` — verify `config.verbose` is `true` in written JSON
- Existing tests continue to pass with the updated `DEFAULT_SELECTIONS`

### hasAllInitFlags tests

- Existing test: returns `true` with all 5 flags — still passes (verbose not required)
- New test: returns `true` with all 5 flags plus `verbose: true` — confirms verbose doesn't interfere
- Existing test: returns `false` with any of the 5 required flags missing — still passes

### NonInteractiveInit component tests

- Render `<Init {...flags} />` with `verbose: true` — verify "Project initialized" and check written config contains `"verbose": true`
- Render `<Init {...flags} />` without `verbose` — verify written config contains `"verbose": false`

### InteractiveInit component tests

Note: The existing tests don't drive the wizard past the first phase (they only verify detection and CLI selection rendering). Testing the verbose phase in isolation requires either:
- Testing the `handleSpecsDirSubmit` → phase transition logic by simulating keyboard input through the full wizard flow, or
- Extracting the phase logic into a testable hook (out of scope for this spec)

At minimum, verify the `createProject` unit tests cover the verbose field end-to-end, since the interactive wizard delegates to the same function.
