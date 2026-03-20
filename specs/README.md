# Specifications

## Tech Stack
- **Language:** TypeScript (ESM)
- **CLI Framework:** Ink 5 (React 18)
- **AI CLI Spawning:** @0xtiby/spawner
- **Arg Parsing:** meow
- **Validation:** Zod
- **Build:** tsup
- **Test:** Vitest
- **Package:** @0xtiby/toby (npm)

## Specs

| Spec | Source Path | Description |
|------|------------|-------------|
| [Project Restructure](./01-project-restructure.md) | `package.json`, `tsup.config.ts` | Restructure package for new architecture with spawner |
| [Configuration System](./02-configuration-system.md) | `src/lib/config.ts`, `src/lib/paths.ts` | Global (~/.toby) and local (.toby/) config with JSON schema and prompt override chain |
| [Spec Discovery](./03-spec-discovery.md) | `src/lib/specs.ts` | Find, filter, number-sort, and order markdown spec files |
| [PRD & Status Data Model](./04-prd-status-model.md) | `src/lib/prd.ts`, `src/lib/status.ts`, `src/types.ts` | prd.json task tracking and status.json iteration/session tracking |
| [Prompt Template Engine](./05-prompt-template-engine.md) | `src/lib/template.ts` | Load prompts with global/local override and variable substitution |
| [Loop Engine](./06-loop-engine.md) | `src/lib/loop.ts` | Spawn AI CLI via spawner, detect sentinel, iterate one-task-per-spawn |
| [Plan Command](./07-plan-command.md) | `src/commands/plan.tsx` | TUI command to select specs and run planning iterations producing prd.json |
| [Build Command](./08-build-command.md) | `src/commands/build.tsx` | TUI command to iterate through tasks one-per-spawn with --all mode |
| [Init, Status & Config Commands](./09-init-status-config.md) | `src/commands/init.tsx`, `src/commands/status.tsx`, `src/commands/config.tsx` | Interactive setup wizard, status display, and config editing |
| [Default Prompt Files](./10-default-prompts.md) | `prompts/PROMPT_PLAN.md`, `prompts/PROMPT_BUILD.md`, `prompts/PROMPT_BUILD_ALL.md` | Shipped prompt templates for plan and build phases |
| [Non-Interactive CLI Mode](./11-non-interactive-cli-mode.md) | `src/commands/init.tsx`, `src/commands/config.tsx`, `src/cli.tsx` | Non-interactive init flags and batch config set for CI/scripting |
