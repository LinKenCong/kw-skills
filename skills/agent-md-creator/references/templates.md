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

## Global Codex AGENTS.md

```md
# Agent Rules

## Safety And Git

- Never push without explicit authorization for that specific push.
- Do not amend commits or revert user changes unless explicitly requested.

## Communication

- State assumptions and uncertainty explicitly.
- Keep responses concise and technical unless the user asks for teaching detail.

## Technical Defaults

- Record personal defaults that should apply across projects.
- Do not include project-specific architecture or commands.

## Code Changes

- Preserve existing architecture unless the user asks for redesign.
- Run validation appropriate to the project risk and available tooling.

## Codex-Specific Execution

- Include Codex-specific sandbox, approvals, skills, or automation preferences.
```

## Global Claude CLAUDE.md

```md
# Claude Code Memory

## Communication

- Record personal communication preferences.

## Safety And Git

- Record cross-project safety rules.

## Claude Code Workflow

- Include Claude-specific memory, hooks, slash commands, and local workflow assumptions.

## Technical Defaults

- Record cross-project defaults only. Keep project specifics in project files.
```

## Symlink Layout

Project directories should use:

```text
repo/
├── AGENTS.md
└── CLAUDE.md -> AGENTS.md
```

Monorepos may add subtree-level files:

```text
repo/
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── frontend/
│   ├── AGENTS.md
│   └── CLAUDE.md -> AGENTS.md
└── contracts/
    ├── AGENTS.md
    └── CLAUDE.md -> AGENTS.md
```
