# Sync: GitHub Issues → Spec Files

Fetch GitHub Issues and write them as spec markdown files into the `{{SPECS_DIR}}/` directory.

## Instructions

1. Use the `gh` CLI to list open issues from the current repository that have the label **`spec`**.
2. For each issue, create a markdown file in `{{SPECS_DIR}}/` with:
   - **Filename:** `<issue-number>-<slug>.md` where `<slug>` is the issue title lowercased, spaces replaced with hyphens, non-alphanumeric characters removed (e.g., issue #42 "Add user auth" → `42-add-user-auth.md`).
   - **Content:** The full issue body as markdown. Include the issue title as an H1 heading at the top.

## Conflict Handling

- If a file already exists for an issue, **overwrite it** — the GitHub Issue is the source of truth.
- If a file exists in `{{SPECS_DIR}}/` that does not correspond to any open issue with the `spec` label, **leave it alone** — it may be a locally-authored spec.

## Commands

```bash
# List issues with the spec label
gh issue list --label spec --state open --json number,title,body --limit 100

# Write a spec file
# Use the issue body as content, with the title as H1 heading
```

## Output

After syncing, print a summary of what was created or updated:

```
Synced 3 specs from GitHub Issues:
  - 42-add-user-auth.md (created)
  - 15-api-rate-limiting.md (updated)
  - 58-sync-command.md (updated)
```

When complete, output: `:::TOBY_DONE:::`
