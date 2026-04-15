# Sync: GitHub Issues -> Spec Files

Fetch GitHub Issues and write them as spec markdown files into the `{{SPECS_DIR}}/` directory.

## Instructions

1. Use the `gh` CLI to list open issues from the current repository that have the label **`spec`**.
2. For each issue, create a markdown file in `{{SPECS_DIR}}/` with:
   - **Filename:** `<issue-number>-<slug>.md` where `<slug>` is the issue title lowercased, spaces replaced with hyphens, non-alphanumeric characters removed (e.g., issue #42 "Add user auth" -> `42-add-user-auth.md`).
   - **Content:** Source metadata line, then the issue title as H1 heading, then the full issue body.

```markdown
Source: github-issue#<number>

# <Issue Title>

<Issue body as markdown>
```

## Conflict Handling

When the target filename (e.g., `15-add-credits.md`) already exists in `{{SPECS_DIR}}/`:

1. **Read the existing file.** Check if it has a `Source: github-issue#<number>` line matching this issue number.
2. **Same source** (same issue number in Source line): **overwrite** -- this is an update of the same spec.
3. **No source line, or different source**: compare the existing file's title/topic with the incoming issue title. If they describe the same intent, **overwrite**. If they are about different topics, **use the next available index** (e.g., if `15-*.md` is taken, write as `16-add-credits.md`).

Scan existing files to find the next available number: take the highest numeric prefix in `{{SPECS_DIR}}/` and add 1.

- If a file exists in `{{SPECS_DIR}}/` that does not correspond to any open issue with the `spec` label, **leave it alone** -- it may be a locally-authored spec.

## Commands

```bash
gh issue list --label spec --state open --json number,title,body --limit 100
```

## Output

After syncing, print a summary:

```
Synced N specs from GitHub Issues:
  - 42-add-user-auth.md (created)
  - 15-api-rate-limiting.md (updated)
```

When complete, output: `:::TOBY_DONE:::`
