# GitHub Issues Setup

## Requirements

| Tool | Install | Purpose |
|---|---|---|
| `gh` | [cli.github.com](https://cli.github.com) | GitHub CLI for issue management |

### Authentication

```bash
gh auth login
```

The repository must be pushed to GitHub before running plan/build.

## Config Variables

No config variables required. The `gh` CLI uses the current repo context automatically.

## How It Works

- **Plan** creates a parent issue (epic) with a tasklist of sub-issues. Each sub-issue contains full task details in its body.
- **Build** reads the parent issue's tasklist to find the next unchecked item, implements it, closes the sub-issue, and checks the box in the parent.
- Task ordering is defined by the tasklist order in the parent issue.
- Labels `in-progress` are used to track claiming.

## Label Convention

Labels are created automatically by `gh` on first use:
- `toby/<spec-slug>` — applied to the parent issue, used to find it during build
- `in-progress` — applied to the sub-issue currently being worked on

## Issue Structure

```
Parent Issue: "credits: Add user credits system"     [toby/credits]
  ├── #12 Add credits column to schema                - [ ] in parent
  ├── #13 Create getCredits API query                  - [ ] in parent
  └── #14 Add credits badge to profile                 - [ ] in parent
```
