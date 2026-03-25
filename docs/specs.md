# Spec Files

Specs are markdown files that describe features for toby to plan and build. Any `.md` file in the specs directory is automatically discovered.

## File Format

- Specs live in the configured `specsDir` (default: `specs/`)
- Any `.md` file in that directory is treated as a spec
- Content is freeform markdown — there is no required structure
- Files listed in `excludeSpecs` config are skipped (default: `["README.md"]`)

## Naming & Ordering

Spec filenames use a numeric prefix to control sort order:

| Pattern | Example | Sort Key |
|---------|---------|----------|
| `NN-slug.md` | `03-auth.md` | 3 |
| `NNx-slug.md` | `15a-api-keys.md` | 15a |

**Sort rules:**

- Numbered specs sort ascending: `15` < `15a` < `15b` < `16`
- Specs with the same number and suffix sort alphabetically by name
- Unnumbered specs sort alphabetically after all numbered specs

**Examples in order:**

```
01-project-setup.md
02-data-model.md
15-auth.md
15a-auth-api.md
15b-auth-ui.md
16-dashboard.md
api-extras.md        ← unnumbered, sorted alphabetically at end
utils.md
```

## Referencing Specs

Use `--spec=<query>` to target a specific spec. Matching uses the following priority (first match wins):

| Priority | Match Type | Example Query | Matches |
|----------|------------|---------------|---------|
| 1 | Exact name | `09-init-status-config` | `09-init-status-config.md` |
| 2 | Filename | `09-init-status-config.md` | `09-init-status-config.md` |
| 3 | Slug (prefix stripped) | `init-status-config` | `09-init-status-config.md` |
| 4 | Number prefix | `09` | `09-init-status-config.md` |

**Multi-spec syntax:** pass comma-separated queries to target multiple specs:

```
toby plan --spec=auth,dashboard,15a
toby build --spec=01,02,03
```

Results are deduplicated and sorted by spec order.

## Discovery & Exclusion

Spec discovery scans the `specsDir` directory for `.md` files:

- The directory is set via `specsDir` in config (default: `specs/`)
- Files matching `excludeSpecs` are excluded (default: `["README.md"]`)
- Spec **status** (pending, planned, building, done) is tracked in `.toby/status.json`, not in the spec file itself

Configure exclusions in `.toby/config.json`:

```json
{
  "specsDir": "specs",
  "excludeSpecs": ["README.md", "drafts.md"]
}
```
