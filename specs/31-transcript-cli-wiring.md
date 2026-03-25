# 31 — Transcript CLI Wiring

Wire the `--transcript` / `--no-transcript` CLI flags through to plan and build commands, and add `transcript` to the config command's VALID_KEYS whitelist.

## Problem

The `transcript` flag is defined in meow (cli.tsx) and appears in `--help` output, but is **not passed** to Plan or Build components. Users who run `toby build --transcript` see no effect. Additionally, `toby config set transcript true` fails because `transcript` is not in config.tsx's VALID_KEYS map.

## Scope

### In scope

- Pass `transcript` flag from cli.tsx to Plan and Build components
- Use the flag in plan.tsx and build.tsx to control transcript recording (override config value)
- Add `transcript` to VALID_KEYS in config.tsx so `toby config set transcript true` works
- Respect precedence: `--transcript` flag > config `transcript` value > default (false)
- `--no-transcript` explicitly disables even if config enables it

### Out of scope

- New transcript features (format, location, filtering already work per spec 24)
- Adding other missing VALID_KEYS (e.g., `templateVars`, `excludeSpecs`)

## Data Model

No schema changes needed. `transcript` already exists in ConfigSchema as `z.boolean().default(false)`.

### Flag type in cli.tsx

Already defined:
```typescript
transcript: { type: "boolean" }
```

### CommandFlags extension

The `transcript` flag needs to be included in the flags object passed to command components. Currently it's defined in meow but not forwarded.

## Implementation

### 1. cli.tsx — Forward transcript flag

The `flags` object passed to `entry.render(flags, ...)` already contains all meow-parsed flags. The issue is that Plan and Build components' prop types don't accept `transcript`. Update the component prop types.

### 2. plan.tsx / build.tsx — Accept and use transcript flag

Add `transcript?: boolean` to `PlanFlags` and `BuildFlags` type aliases.

In `executePlan` and `executeBuild`, resolve the transcript setting:

```typescript
const transcriptEnabled = flags.transcript ?? config.transcript ?? false;
```

This value should be passed to `withTranscript()` to control whether transcript recording is active.

### 3. config.tsx — Add transcript to VALID_KEYS

Add entry to the VALID_KEYS map:

```typescript
const VALID_KEYS: Record<string, string> = {
  // ... existing keys ...
  "transcript": "boolean",
};
```

## Business Rules

- `--transcript` (true) enables transcript recording for the session
- `--no-transcript` (false) disables transcript recording even if config has `transcript: true`
- If neither flag is passed, fall back to config value, then to default (false)
- `toby config set transcript true` must succeed and persist `transcript: true` in config.json
- `toby config set transcript false` must succeed and persist `transcript: false`
- `toby config get transcript` must return the current value

## Acceptance Criteria

- Given `transcript: false` in config and `--transcript` flag, when running `toby build --spec=X`, then a transcript file is created in `.toby/transcripts/`
- Given `transcript: true` in config and `--no-transcript` flag, when running `toby build --spec=X`, then no transcript file is created
- Given `transcript: true` in config and no flag, when running `toby build --spec=X`, then a transcript file is created
- Given no config and no flag, when running `toby build --spec=X`, then no transcript file is created (default false)
- Given `toby config set transcript true`, when running, then config.json has `"transcript": true`
- Given `toby config get transcript`, when running, then current value is displayed
- Same criteria apply to `toby plan` command

## Testing Strategy

- Unit test: verify `transcript` flag is forwarded from cli.tsx to Plan/Build components
- Unit test: verify transcript resolution precedence (flag > config > default)
- Unit test: verify `transcript` is in VALID_KEYS and `toby config set transcript true` validates
- Integration test: `toby build --transcript --spec=X` creates transcript file
- Integration test: `toby build --no-transcript --spec=X` with config `transcript: true` creates no file
