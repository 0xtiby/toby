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
| [Decouple PRD from Code](./12-decouple-prd-from-code.md) | `src/lib/prd.ts`, `src/types.ts`, `src/commands/` | Remove hardcoded PRD tracking — task management lives in prompts, not code |
| [Dynamic Template Variables](./13-dynamic-template-variables.md) | `src/lib/template.ts`, `src/types.ts` | Replace fixed TemplateVars with dynamic Record, YAML frontmatter, per-command config vars |
| [Status Command Adaptation](./14-status-command-adaptation.md) | `src/commands/status.tsx` | Replace PRD-derived task display with iteration history from status.json |
| [Alphanumeric Spec Ordering](./15-alphanumeric-spec-ordering.md) | `src/lib/specs.ts` | Support `15a-`, `15b-` alphanumeric prefixes for sub-spec ordering |
| [Template Variable System](./16-template-variable-system.md) | `src/lib/template.ts`, `src/lib/config.ts` | Two-category variable model: CLI vars from runtime + user config vars with interpolation |
| [Prompt Simplification](./17-prompt-simplification.md) | `prompts/PROMPT_PLAN.md`, `prompts/PROMPT_BUILD.md` | Simplify shipped prompts to use new variable set, remove frontmatter and PROMPT_BUILD_ALL |
| [Documentation](./18-documentation.md) | `README.md`, `docs/` | User-facing README, CLI/config reference, and prompt authoring guide |
| [Multi-Spec Selection](./19-multi-spec-selection.md) | `src/components/SpecSelector.tsx`, `src/hooks/useCommandRunner.ts`, `src/lib/specs.ts`, `src/cli.tsx` | Interactive multi-select with Select All, --spec/--specs comma-separated CLI flag |
| [Spec Number Shorthand](./20-spec-number-shorthand.md) | `src/lib/specs.ts`, `src/cli.tsx` | Document and verify bare number resolution in --spec/--specs flags |
| [Welcome Screen & Menu](./21-welcome-screen.md) | `src/components/Welcome.tsx`, `src/components/Mascot.tsx`, `src/components/MainMenu.tsx`, `src/cli.tsx` | Interactive welcome screen with ASCII mascot, version, status summary, and command menu |
| [Project Status Summary](./22-project-status-summary.md) | `src/lib/stats.ts`, `src/components/StatusSummary.tsx` | Aggregate project stats (spec counts, iterations) as reusable data layer and display component |
| [Fix Skipped Display](./23-fix-skipped-display.md) | `src/commands/plan.tsx`, `src/commands/build.tsx` | Remove misleading "Skipped" list from --all mode summary output |
| [Session Transcript](./24-session-transcript.md) | `src/lib/transcript.ts`, `src/types.ts`, `src/commands/plan.tsx`, `src/commands/build.tsx` | Stream session output to timestamped transcript files in .toby/transcripts/ |
| [Init Verbose Option](./25-init-verbose-option.md) | `src/commands/init.tsx`, `src/cli.tsx` | Add verbose preference to init wizard and non-interactive flags |
| [Session State Persistence](./26-session-state-persistence.md) | `src/lib/status.ts`, `src/types.ts` | Save sessionName and sessionId to status.json on iteration complete or error/abort |
| [Crash Detection](./27-crash-detection.md) | `src/lib/loop.ts`, `src/types.ts` | Detect when build crashed vs stopped intentionally via iteration state tracking |
| [Session Resume](./28-session-resume.md) | `src/commands/build.tsx`, `src/lib/loop.ts` | Auto-resume from last session; cross-CLI resume preserves worktree context |
| [Filter Plan Selector](./29-filter-plan-selector.md) | `src/commands/plan.tsx` | Filter interactive plan selector to only show pending specs |
| [Documentation Gaps](./30-documentation-gaps.md) | `docs/`, `README.md` | Close gaps between implemented features and user-facing documentation |
| [Transcript CLI Wiring](./31-transcript-cli-wiring.md) | `src/cli.tsx`, `src/commands/plan.tsx`, `src/commands/build.tsx`, `src/commands/config.tsx` | Wire --transcript flag to commands and add transcript to config VALID_KEYS |
| [Hamster Palette & Sprites](./32-hamster-palette-sprites.md) | `src/components/hamster/palette.ts`, `src/components/hamster/sprites.ts` | Color palette and pixel-art sprite data for the animated hamster mascot |
| [Wheel Renderer](./33-hamster-wheel-renderer.md) | `src/components/hamster/wheel.ts` | Circle geometry, spoke generation, and rotation math for the spinning wheel |
| [HamsterWheel Component](./34-hamster-wheel-component.md) | `src/components/hamster/HamsterWheel.tsx` | Main Ink component: grid buffer, animation loop, half-block Unicode rendering |
| [Welcome Screen Redesign](./35-welcome-screen-redesign.md) | `src/components/Welcome.tsx`, `src/components/InfoPanel.tsx`, `src/lib/stats.ts` | Two-column layout with animated hamster + info panel, replacing robot mascot |
| [Async Models API Migration](./36-async-models-api-migration.md) | `src/hooks/useModels.ts`, `src/commands/init.tsx`, `src/commands/config.tsx` | Replace sync `getKnownModels()` with async `listModels()` via shared React hook with cache & fallback |
| [Spawner Dependency Upgrade](./38-spawner-dependency-upgrade.md) | `package.json`, `pnpm-lock.yaml` | Bump @0xtiby/spawner to ^1.1.0, pin version, adapt to type changes |
| [Clean Transcripts Command](./39-clean-transcripts-command.md) | `src/lib/clean.ts`, `src/commands/clean.tsx`, `src/cli.tsx` | Delete all transcript files from .toby/transcripts/ with confirmation prompt |
| [Agent-Friendly Help](./40-agent-friendly-help.md) | `src/lib/help.ts`, `src/cli.tsx`, `src/commands/init.tsx`, `src/commands/config.tsx` | Two-level progressive help with examples and actionable error hints for AI agents |
