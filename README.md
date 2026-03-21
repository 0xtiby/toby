# toby

> Turn markdown specs into working code with AI-powered plan and build loops

[![npm version](https://img.shields.io/npm/v/@0xtiby/toby)](https://www.npmjs.com/package/@0xtiby/toby)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What is toby?

Toby is a CLI tool that turns markdown specifications into working code through AI-driven plan and build loops. You write specs describing what you want, and toby orchestrates an AI agent to plan the implementation, then iteratively builds it — discovering files, generating code, and running validation until the spec is complete.

## How it works

Toby follows a three-phase loop:

1. **Spec** — You write a markdown file describing what you want built (features, acceptance criteria, constraints)
2. **Plan** — Toby sends your spec to an AI CLI, which analyzes the codebase and produces an implementation plan with concrete tasks
3. **Build** — Toby iteratively executes each task through the AI CLI, running your validation command between iterations until the spec is complete

Each phase feeds into the next: specs drive plans, plans drive builds, and build results update the project status so you always know where things stand.

## Quick start

```bash
# Install toby globally
npm install -g @0xtiby/toby

# Initialize toby in your project
toby init

# Write a spec in your specs directory (default: specs/)
# e.g. specs/add-auth.md describing the feature you want

# Generate an implementation plan from your spec
toby plan --spec=add-auth

# Build the planned spec with AI
toby build --spec=add-auth
```

- `toby init` — sets up configuration and specs directory in your project
- `toby plan` — sends a spec to the AI CLI to produce an implementation plan
- `toby build` — iteratively executes the plan, running validation between iterations
- `toby status` — shows progress across all specs
- `toby config` — manage CLI, model, and project settings
