# Templates

Use these as starting points, not rigid schemas. Remove sections that do not carry real project signal.

## Project Root AGENTS.md

```md
# Project Context

## Purpose

- Describe what the project does and the primary domain problem it solves.

## Architecture

- `<path>/`: Describe the ownership boundary or responsibility.
- `<path>/`: Describe the ownership boundary or responsibility.

## Tech Stack

- Runtime/package manager:
- Languages/frameworks:
- Data/storage:
- Testing/build tools:

## Commands

- Install: `<command>`
- Dev: `<command>`
- Test: `<command>`
- Typecheck: `<command>`
- Lint/format: `<command>`
- Build: `<command>`

## Working Rules

- Add only rules that apply to most tasks in this repository.
- Reference project files instead of copying code or schemas.
- Keep generated files, vendored dependencies, and build outputs out of manual edits.

## Reference Loading

- If this file contains a line that starts with `@`, read that referenced file before applying the related rule.

## Additional Docs

- `agent_docs/testing.md`: Read when changing tests or test infrastructure.
- `agent_docs/architecture.md`: Read before cross-module changes.
```

## Module AGENTS.md

```md
# Module Context

## Ownership

- This module owns `<capability>` and depends on `<dependency>`.

## Local Architecture

- `<path>/`: Describe the component or boundary.
- `<path>/`: Describe the component or boundary.

## Commands

- Test this module: `<command>`
- Build this module: `<command>`

## Conventions

- Add only conventions that differ from the project root or matter in this subtree.

## Edge Cases

- Document module-specific risks that agents commonly miss.
```

## agent_docs Entry

```md
# <Topic>

## When To Read

Read this document when changing `<area>` or when the task mentions `<trigger>`.

## Key Facts

- Fact with reference to source files or commands.
- Fact with reference to source files or commands.

## Workflow

1. Step with command or file reference.
2. Step with command or file reference.

## Validation

- `<command>` verifies `<behavior>`.
```

## Shared Global AGENTS.md

```md
# Agent Rules

These are shared personal rules for all coding agents. Project-level `AGENTS.md` / `CLAUDE.md`, current user instructions, and higher-priority system/developer instructions take precedence.

## Scope And Priority

- Record only stable cross-project preferences, workflows, and safety defaults.
- Keep project-specific architecture, commands, and temporary workarounds in project files.

## Communication

- Record personal communication preferences that apply across agent runtimes.

## Safety And Git

- Never push without explicit authorization for that specific push.
- Do not amend commits or revert user changes unless explicitly requested.

## Technical Defaults

- Record cross-project defaults only.

## Code Changes

- Preserve existing architecture unless the user asks for redesign.
- Run validation appropriate to the project risk and available tooling.

## Additional Shared Rules

- `~/.agents/rules/security.md`
- `~/.agents/rules/execution.md`
```

## Shared Global Rule

```md
# <Rule Topic>

## When To Read

Read this when the task touches `<area>` or when a wrapper references this file.

## Rules

- Add stable cross-agent rules only.
- Keep runtime-specific behavior in the relevant wrapper file.
```

## Global Codex AGENTS.md Wrapper

```md
# Agent Rules

These are Codex-specific global rules. Shared personal rules live in `~/.agents/`.

## Reference Loading

- Before applying these rules, read every file referenced by a line that starts with `@`.
- Expand `~` to the user's home directory when resolving `@` references.
- Treat referenced files as part of this global guidance unless a higher-priority instruction conflicts.

@~/.agents/AGENTS.md
@~/.agents/rules/security.md
@~/.agents/rules/execution.md

## Codex-Specific Execution

- Include Codex-specific sandbox, approvals, skills, automation, and runtime preferences.
- Do not use `~/.codex/rules/*.md` for Markdown instruction prose; Codex uses `rules/` for approval-rule data unless runtime documentation says otherwise.
```

## Global Claude CLAUDE.md Wrapper

```md
# Claude Code Memory

These are Claude Code-specific global rules. Shared personal rules live in `~/.agents/`.

@~/.agents/AGENTS.md
@~/.agents/rules/security.md
@~/.agents/rules/execution.md

## Claude Code Workflow

- Include Claude-specific memory, hooks, slash commands, and local workflow assumptions.
```

## Project Claude CLAUDE.md Wrapper

```md
@AGENTS.md

## Claude Code

- Add only Claude-specific project behavior here.
```

## Project Import Layout

Project directories should use:

```text
repo/
├── AGENTS.md
└── CLAUDE.md
```

Where `CLAUDE.md` starts with:

```md
@AGENTS.md
```

Monorepos may add subtree-level files:

```text
repo/
├── AGENTS.md
├── CLAUDE.md
├── frontend/
│   ├── AGENTS.md
│   └── CLAUDE.md
└── contracts/
    ├── AGENTS.md
    └── CLAUDE.md
```
