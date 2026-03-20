# Project Restructure

## Overview

Restructure the toby package from a file-copying init tool into a full loop engine CLI that spawns AI coding CLIs via `@0xtiby/spawner`. Replace `execa` and `loop.sh` with spawner-based architecture.

## Problem & Users

Toby currently copies shell scripts (loop.sh) and prompt files into user projects. The new architecture makes toby the loop engine itself — users run `toby plan` and `toby build` directly, and toby spawns AI CLIs via spawner.

**Primary user:** Developers who want AI-assisted development with structured specs.

## Scope

### In Scope
- Replace `execa` dependency with `@0xtiby/spawner`
- Update package name to `@0xtiby/toby`
- Update bin entry, entry points, and build config
- Restructure `src/` directory for new architecture
- Remove old init-only code (steps/, old templates/)
- Add `prompts/` directory for shipped prompt files
- Update CLI entry point for new command routing

### Out of Scope
- Implementing any commands (separate specs)
- Writing prompt file content (separate spec)
- CI/CD changes

## Data Model

```typescript
// package.json changes
{
  "name": "@0xtiby/toby",
  "bin": { "toby": "./dist/cli.js" },
  "files": ["dist", "prompts"],
  "dependencies": {
    "@0xtiby/spawner": "latest",
    "ink": "^5.0.1",
    "ink-select-input": "^6.2.0",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "meow": "^13.2.0",
    "react": "^18.3.1",
    "zod": "^3.24.1"
  }
}
```

## Architecture

```
src/
├── cli.tsx              # Entry point, command routing
├── commands/
│   ├── plan.tsx
│   ├── build.tsx
│   ├── init.tsx
│   ├── status.tsx
│   └── config.tsx
├── lib/
│   ├── config.ts        # Config resolution
│   ├── specs.ts         # Spec discovery
│   ├── prd.ts           # PRD read/validate
│   ├── status.ts        # Status read/write
│   ├── template.ts      # Prompt template engine
│   ├── loop.ts          # Loop engine
│   └── paths.ts         # Path constants
├── components/
│   ├── StreamOutput.tsx  # CLI output streaming
│   ├── SpecSelector.tsx  # Spec selection UI
│   └── StatusBar.tsx     # Progress display
└── types.ts
prompts/
├── PROMPT_PLAN.md
├── PROMPT_BUILD.md
└── PROMPT_BUILD_ALL.md
```

## Acceptance Criteria

- Given the package.json, when installed globally, then the `toby` binary is available
- Given the restructured src/, when `pnpm build` runs, then `dist/cli.js` is produced
- Given `@0xtiby/spawner` is a dependency, when imported, then spawn/detect functions are available
- Given the `prompts/` directory, when the package is published, then prompt files are included in the tarball
- Given `toby --help`, when run, then it shows plan, build, init, status, config commands
- Given `toby --version`, when run, then it shows the package version

## Testing Strategy

- Unit test: CLI entry point renders without crashing
- Unit test: --help displays all commands
- Unit test: Unknown command shows error
- Build test: `pnpm build` succeeds and produces dist/cli.js with shebang
