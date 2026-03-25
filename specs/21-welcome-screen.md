# 21 — Welcome Screen & Menu

> **Note:** The mascot and layout portions of this spec were **superseded by spec 35 (Welcome Screen Redesign)**. The two-column layout (HamsterWheel + InfoPanel) replaces the ASCII robot mascot. Menu behavior is unchanged.

## Overview

When the user runs bare `toby` (no command), render an interactive welcome screen with an ASCII robot mascot, version string, project status summary, and a navigable menu. Selecting a menu item transitions inline to that command's UI within the same Ink app. `toby --help` retains the existing static text help for scripting/piping.

## Users & Problem

The CLI currently shows a plain text help message when run without arguments. This misses an opportunity to provide a friendly entry point that surfaces project state and enables quick command access — especially for new users discovering available commands.

## Scope

### In scope
- ASCII robot mascot with cyan accent color
- Version string display
- Inline project status summary (spec counts + total iterations) — hidden when no `.toby/` dir
- Interactive menu with 4 items (plan, build, status, config) using ink-select-input
- State-based navigation: selecting a menu item renders the command component in-place
- `toby --help` continues to render static text help (unchanged)

### Out of scope
- Cost estimation (deferred to future iteration)
- Random tips/greetings
- Persistent header during command execution (welcome screen clears on navigation)
- Changes to `toby <command>` behavior — only bare `toby` is affected

## User Stories

1. **As a user**, I can run `toby` with no arguments so that I see a friendly welcome screen with project overview.
2. **As a user**, I can select a command from the menu so that I navigate to it without retyping.
3. **As a user**, I can run `toby --help` so that I get the full static help text (unchanged from today).
4. **As a user**, I see the project status summary only when a `.toby/` directory exists, so that the screen is clean for uninitialized projects.

## UI/UX Flow

### Welcome Screen Layout

```
  ┌─────┐
  │ ● ● │
  │  ▬  │  toby v0.1.0
  └─┬─┬─┘
    │ │

  Specs: 5 · Planned: 3 · Built: 1 | Iterations: 12

  ❯ plan     — Plan specs with AI loop engine
    build    — Build tasks one-per-spawn with AI
    status   — Show project status
    config   — Manage configuration
```

### States

| State | What renders |
|-------|-------------|
| No `.toby/` dir | Mascot + version + menu (no status line) |
| Initialized, no iterations | Mascot + version + `Specs: 5 · Planned: 0 · Built: 0 | Iterations: 0` + menu |
| Initialized, with data | Full layout as shown above |
| After menu selection | Welcome unmounts from view, selected command renders in its place |

### Color

- **Cyan** accent for the mascot box-drawing characters and version string
- Default terminal colors for menu items
- **Dim/gray** for menu descriptions

### Menu Interaction

- Arrow keys (↑/↓) to navigate
- Enter to select
- On select: the Welcome component transitions to rendering the selected command's component via internal state

## Components

### `Welcome` (src/components/Welcome.tsx)

Root component for the welcome screen. Manages state to transition between the welcome view and a selected command.

```typescript
interface WelcomeProps {
  version: string;
}
```

**Behavior:**
- Initial state: `selectedCommand = null` → renders Mascot + StatusSummary + MainMenu
- On menu select: `selectedCommand = "plan"` → renders `<Plan />` (or Build, Status, Config)
- Command components are rendered with default props (no flags passed — the user selected from the menu, so there are no CLI flags to forward). For example, selecting "plan" renders `<Plan />` which enters the spec-selection phase, and selecting "config" renders `<ConfigEditor version={version} />`.
- Uses Ink's `useApp()` hook to access `exit()`. When no further interaction is needed (e.g., a non-waitForExit command like `status` finishes rendering), the component calls `exit()` to terminate the Ink app.
- For commands that use `waitForExit` (plan, build, init, config), the Ink app stays alive until the command component itself triggers exit via process completion or SIGINT.

### `Mascot` (src/components/Mascot.tsx)

Pure presentational component rendering the ASCII robot and version.

```typescript
interface MascotProps {
  version: string;
}
```

### `StatusSummary` (src/components/StatusSummary.tsx)

Renders aggregate project stats as a compact inline row.

```typescript
interface StatusSummaryProps {
  stats: ProjectStats | null;
}
```

When `stats` is `null`, renders nothing (component returns `null`).

### `MainMenu` (src/components/MainMenu.tsx)

Interactive menu using `ink-select-input`.

```typescript
interface MainMenuProps {
  onSelect: (command: string) => void;
}
```

Menu items:
| Value | Label | Description |
|-------|-------|-------------|
| `plan` | plan | Plan specs with AI loop engine |
| `build` | build | Build tasks one-per-spawn with AI |
| `status` | status | Show project status |
| `config` | config | Manage configuration |

## Data Model

```typescript
// src/lib/stats.ts

interface ProjectStats {
  totalSpecs: number;
  pending: number;
  planned: number;
  building: number;
  done: number;
  totalIterations: number;
}
```

## API / Interface

```typescript
// src/lib/stats.ts

/**
 * Compute aggregate project statistics.
 * Returns null if no .toby/ directory exists (project not initialized).
 * Reads status.json and discovers specs from the configured specsDir.
 */
function computeProjectStats(cwd?: string): ProjectStats | null;
```

## Architecture

### File Structure

```
src/
  components/
    Welcome.tsx        # Root welcome screen with state-based navigation
    Mascot.tsx         # ASCII robot + version
    StatusSummary.tsx  # Inline stats row
    MainMenu.tsx       # Interactive command menu
  lib/
    stats.ts           # computeProjectStats()
  cli.tsx              # Modified: bare `toby` renders <Welcome>, --help renders <Help>
```

### Navigation Flow

```
cli.tsx
  └─ no command? ──► <Welcome version>
                        ├─ <Mascot version />
                        ├─ <StatusSummary stats />
                        └─ <MainMenu onSelect />
                              │
                              ▼ (state change)
                        <Plan /> | <Build /> | <Status /> | <ConfigEditor />
```

### CLI Entry Point Changes

In `src/cli.tsx`, the `if (!command)` block changes from:
```typescript
render(<Help version={version} />).unmount();
```
to:
```typescript
const app = render(<Welcome version={version} />);
await app.waitUntilExit();
```

The existing `Help` component remains for `--help` flag handling (already handled by meow).

### App Lifecycle

The Welcome component uses Ink's `useApp()` hook to manage the app lifecycle:

1. **Welcome phase**: Mascot + StatusSummary + MainMenu render. Ink app stays alive waiting for input.
2. **Menu selection**: User selects a command → `selectedCommand` state updates → Welcome view unmounts, command component mounts.
3. **Command execution**: The selected command component runs normally. Commands that use `waitForExit` (plan, build, config) keep the Ink app alive until they complete. The `status` command renders and then Welcome calls `useApp().exit()` after a short tick to allow the final frame to paint.
4. **Exit**: The Ink app exits when the command finishes or the user presses Ctrl+C.

### Cross-References

- **Spec 22 (Project Status Summary)**: Provides the `computeProjectStats()` function and `StatusSummary` component used by this screen.
- **Existing commands**: Plan (src/commands/plan.tsx), Build (src/commands/build.tsx), Status (src/commands/status.tsx), Config (src/commands/config.tsx) — rendered as children when selected from the menu.

## Edge Cases

- **No specs directory**: `computeProjectStats` returns stats with `totalSpecs: 0` (not null — null is reserved for no `.toby/` dir)
- **Corrupted status.json**: `computeProjectStats` catches errors and returns null (graceful degradation — show welcome without stats)
- **Terminal too narrow**: The ASCII art and stats row should degrade gracefully. The mascot is only ~9 chars wide, so this is unlikely to be an issue.
- **Ctrl+C during menu**: Ink handles SIGINT — the app exits cleanly.

## Acceptance Criteria

- **Given** the user runs `toby` with no arguments, **when** the terminal is interactive, **then** an ASCII robot mascot, version, and interactive menu are displayed.
- **Given** a `.toby/` directory exists with status data, **when** the welcome screen renders, **then** an inline stats row shows spec counts and total iterations.
- **Given** no `.toby/` directory exists, **when** the welcome screen renders, **then** no status summary line is shown.
- **Given** the user selects "plan" from the menu, **when** they press Enter, **then** the welcome screen is replaced by the Plan command's UI.
- **Given** the user runs `toby --help`, **then** the static text help is displayed (unchanged from current behavior).
- **Given** the user selects "config" from the menu, **when** the Config editor renders, **then** it behaves identically to running `toby config` directly.

## Testing Strategy

- **Unit test `computeProjectStats`**: Mock filesystem with various `.toby/status.json` states (missing dir, empty specs, mixed statuses, corrupted JSON).
- **Component tests**: Render `Mascot`, `StatusSummary`, `MainMenu` with ink-testing-library to verify output text and interaction.
- **Integration test**: Render `Welcome`, simulate menu selection, verify the command component mounts.
