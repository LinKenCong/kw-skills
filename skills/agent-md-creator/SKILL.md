---
name: agent-md-creator
description: Create, audit, refactor, and migrate agent instruction documents for coding agents. Use when the user asks to create or improve AGENTS.md, CLAUDE.md, agent memory files, project instructions, monorepo agent context, Claude Code/Codex shared project guidance, or when consolidating CLAUDE.md into AGENTS.md with safe symlink handling.
---

# Agent MD Creator

## Purpose

Create and maintain agent instruction documents that are short, stable, layered, and tool-aware. Treat these files as onboarding and routing context for coding agents, not as encyclopedias, linters, changelogs, or temporary workaround stores.

Load these references only when needed:

- `references/best-practices.md`: principles and placement rules.
- `references/templates.md`: canonical templates for project, module, and global files.
- `references/review-checklist.md`: audit and migration checklist.

## Mode Decision

Determine the target mode before editing:

- **Project mode**: Work inside a repository or project directory. Author `AGENTS.md` as the canonical file and create `CLAUDE.md` as a relative symlink to `AGENTS.md` for Claude compatibility.
- **Global mode**: Work on user-level configuration. Do not symlink. Maintain tool-specific files separately:
  - `~/.claude/CLAUDE.md`
  - `~/.codex/AGENTS.md`

If the request is ambiguous, infer from the target path. Paths under a repository are project mode; paths under `~/.claude` or `~/.codex` are global mode.

## Project Workflow

1. Inspect current state before editing:
   - Check for `AGENTS.md` and `CLAUDE.md`.
   - Check whether `CLAUDE.md` is missing, empty, a symlink, or a non-empty regular file.
   - Inspect nearby context such as `README.md`, package manifests, build files, CI, docs, and relevant module directories.
2. Choose document placement:
   - Put high-frequency, stable, project-wide facts in root `AGENTS.md`.
   - Put module-specific rules in descendant `AGENTS.md` files.
   - Put longer details in `agent_docs/*.md` and link to them from `AGENTS.md`.
   - Put personal preferences in global files, not project files.
   - Put deterministic formatting or style enforcement in tools such as linters, formatters, typecheckers, tests, hooks, or CI.
3. Write or refactor `AGENTS.md`:
   - Keep it concise and specific.
   - Prefer file references over copied code.
   - Use commands that actually match the detected project tooling.
   - State assumptions when project evidence is incomplete.
4. Handle `CLAUDE.md` safely:
   - If missing, create `CLAUDE.md` as a relative symlink: `CLAUDE.md -> AGENTS.md`.
   - If already a symlink to `AGENTS.md`, leave it unchanged.
   - If whitespace-only or empty, replace it with the symlink.
   - If non-empty, a different symlink, or both files contain conflicting content, do not overwrite. Summarize the situation and ask the user before migration.
5. Report what changed and why, including any content moved, removed, or deferred to tools/docs.

Use a relative symlink command in the target directory:

```bash
ln -s AGENTS.md CLAUDE.md
```

Never create an absolute symlink for this compatibility file.

## Global Workflow

Maintain Claude and Codex global files separately:

- Use `~/.claude/CLAUDE.md` for Claude Code-specific memory, hooks, slash-command assumptions, and personal Claude workflow.
- Use `~/.codex/AGENTS.md` for Codex-specific behavior, sandbox/approval expectations, skills, automation, and personal Codex workflow.

Shared personal principles can be expressed in both files, but do not symlink them because global agent runtimes and tool semantics differ.

## Safety Gates

Stop and ask the user before:

- Overwriting or deleting a non-empty `CLAUDE.md`.
- Replacing a `CLAUDE.md` symlink that points somewhere other than `AGENTS.md`.
- Auto-merging different non-empty `AGENTS.md` and `CLAUDE.md` contents.
- Moving project-specific instructions into a global file.
- Changing a team's established agent-document convention.

Do not ask before creating a missing `AGENTS.md` or a missing project `CLAUDE.md -> AGENTS.md` symlink when the user requested project setup.

## Output Quality

The final document should answer:

- What is this project/module?
- How is it organized?
- Which commands should agents use?
- What rules are truly project-wide and high-impact?
- Which additional docs should agents read only when relevant?

Avoid vague rules like "write clean code" or "follow best practices." Replace them with project-specific constraints, commands, ownership boundaries, or references.
