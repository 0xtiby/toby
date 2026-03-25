# Sessions

Sessions group iterations of a plan or build run under a single name, used for branch naming, worktree reuse, and transcript file naming.

## Session Naming

How sessions are named depends on the command and number of specs:

| Scenario | Session Name |
|----------|-------------|
| Single spec (`--spec=auth`) | Spec slug (e.g., `auth`) |
| Multiple specs (`--all`) | Random name (e.g., `bold-hawk-42`) |
| Explicit override (`--session=my-name`) | `my-name` |

The spec slug is derived by stripping the numeric prefix from the spec filename (e.g., `09-init-status-config` becomes `init-status-config`).

The `--session` flag overrides all automatic naming, including during resume.

## Transcripts

Transcripts capture CLI output to a file for later review.

**Enabling transcripts:**

| Method | Example |
|--------|---------|
| Config (persistent) | `toby config set transcript true` |
| Flag (one-off) | `toby build --transcript` |
| Disable override | `toby build --no-transcript` |

The `--transcript` flag overrides config when `false`, and `--no-transcript` overrides when `true`.

**File location:** `.toby/transcripts/`

**File naming pattern:** `{session}-{command}-{timestamp}.md`

- Example: `auth-build-20260325-143022-001.md`

**Content modes:**

| Mode | What is captured |
|------|-----------------|
| Normal | Text output only |
| Verbose (`--verbose`) | Text, tool use, tool results, errors, system events |

Transcripts stream in real time — each event is written as it arrives.

## Crash Recovery

If a build is interrupted (process killed, machine restart), toby detects this on the next run:

1. **Detection:** The last iteration's state is `in_progress` (it was never marked complete)
2. **Auto-resume:** toby reuses the same session name and worktree from the previous run
3. **Session continuity:** If the same CLI is used, toby passes the previous `sessionId` so the AI CLI can resume its conversation context
4. **CLI switching:** If a different CLI is used (e.g., switching from `claude` to `codex`), toby starts a fresh session but keeps the same session name for worktree continuity

Resume message example:
```
Resuming session "auth" (continuing session)
Resuming session "auth" (switching from claude to codex)
```

## Exhaustion Resume

When a build hits its maximum iteration count without completing:

1. **Detection:** The spec's `stopReason` is `max_iterations`
2. **Re-run to resume:** Simply run the same build command again — toby picks up where it left off
3. **Increase limit:** Use `--iterations=<n>` to allow more iterations

```bash
# Hit the limit? Just re-run:
toby build --spec=auth

# Or increase the limit:
toby build --spec=auth --iterations=20
```

The session name and worktree are reused automatically on resume.
