---
name: agent-md-creator
description: Create, audit, refactor, and migrate agent instruction documents for coding agents. Use when the user asks to create or improve AGENTS.md, CLAUDE.md, agent memory files, project instructions, monorepo agent context, Claude Code/Codex shared project guidance, or when consolidating AGENTS.md and CLAUDE.md with safe @ reference handling.
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

- **Project mode**: Work inside a repository or project directory. Author `AGENTS.md` as the canonical file and create `CLAUDE.md` as a regular file that starts with `@AGENTS.md`; append Claude-specific project rules after the import only when needed.
- **Global mode**: Work on user-level configuration. Do not symlink. Prefer shared personal rules under `~/.agents/` plus tool-specific wrapper files:
  - `~/.agents/AGENTS.md`
  - `~/.agents/rules/*.md`
  - `~/.claude/CLAUDE.md`
  - `~/.codex/AGENTS.md`

If the request is ambiguous, infer from the target path. Paths under a repository are project mode; paths under `~/.agents`, `~/.claude`, or `~/.codex` are global mode.

## Entry Update Workflow

When the user asks to add or modify entries in `AGENTS.md`, `CLAUDE.md`, or a global agent instruction file:

1. Apply the requested entry in the safest appropriate location, following the project or global workflow below.
2. After editing, re-read the latest version of the changed document and any directly affected wrapper/import file.
3. Review the latest document against `references/best-practices.md` and `references/review-checklist.md`.
4. Report optimization suggestions separately from the completed edit. Check for:
   - duplicated or conflicting rules;
   - vague, temporary, or overly broad wording;
   - content that belongs in a descendant `AGENTS.md`, `agent_docs/*.md`, `~/.agents/rules/*.md`, or a tool config instead;
   - commands, paths, or assumptions that are unverified or too project-specific for the current scope;
   - opportunities to shorten, merge, or convert prose into explicit file references.
5. Ask the user whether to apply the suggested optimizations. Do not apply optional optimization changes unless the user confirms, unless the user explicitly requested optimization in the same turn.

## Project Workflow

1. Inspect current state before editing:
   - Check for `AGENTS.md` and `CLAUDE.md`.
   - Check whether `CLAUDE.md` is missing, empty, a symlink, a regular `@AGENTS.md` wrapper, or a non-empty regular file.
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
   - If using `@path` references for Codex-facing guidance, add a short instruction before them telling agents to read those referenced files.
   - Use commands that actually match the detected project tooling.
   - State assumptions when project evidence is incomplete.
4. Handle `CLAUDE.md` safely:
   - If missing, create a regular `CLAUDE.md` that starts with `@AGENTS.md`.
   - If Claude-specific project rules are needed, append them below the import in a clearly labeled section.
   - If already a regular file that imports `AGENTS.md`, leave the import intact and edit only the relevant Claude-specific section.
   - If whitespace-only or empty, replace it with the `@AGENTS.md` wrapper.
   - If it is a symlink, a non-empty file without an `AGENTS.md` import, or it conflicts with `AGENTS.md`, do not overwrite. Summarize the situation and ask the user before migration.
5. If this was an entry add/update request, run the Entry Update Workflow's post-edit optimization review.
6. Report what changed and why, including any content moved, removed, deferred to tools/docs, or recommended for follow-up optimization.

Use this project `CLAUDE.md` wrapper when no Claude-specific rules are needed:

```md
@AGENTS.md
```

Use this wrapper when Claude-specific project rules are needed:

```md
@AGENTS.md

## Claude Code

- Add only Claude-specific project behavior here.
```

Do not create a project `CLAUDE.md` symlink by default.

## Global Workflow

Use a shared global source of personal rules plus tool-specific wrappers:

- Use `~/.agents/AGENTS.md` for cross-agent, cross-project personal defaults and safety rules.
- Use `~/.agents/rules/*.md` for longer shared rule documents that should apply to multiple agents.
- Use `~/.claude/CLAUDE.md` as a Claude Code wrapper:
  - Reference shared files with Claude Code's supported `@path` import syntax.
  - Keep Claude-specific memory, hooks, slash-command assumptions, and Claude workflow in this file.
- Use `~/.codex/AGENTS.md` as a Codex wrapper:
  - Include an explicit instruction telling Codex agents to read files referenced by `@path` lines.
  - List shared files with `@path` references, but do not claim Codex automatically expands them.
  - Keep Codex-specific sandbox, approval, skills, automation, and runtime behavior in this file.

Example Codex wrapper pattern:

```md
# Agent Rules

## Reference Loading

- Before applying these rules, read every file referenced by a line that starts with `@`.
- Expand `~` to the user's home directory when resolving `@` references.
- Treat referenced files as part of this global guidance unless a higher-priority instruction conflicts.

@~/.agents/AGENTS.md
@~/.agents/rules/security.md

## Codex Workflow

- Add only Codex-specific runtime behavior here.
```

Do not use global symlinks. Do not put Markdown instruction prose in `~/.codex/rules/*.md`; Codex uses its `rules/` directory for approval-rule data unless the runtime documentation says otherwise.

If the current global setup is not in this shared-wrapper layout, inspect the existing files, classify shared/tool-specific/conflicting content, and ask the user before migrating non-empty global files.

After adding or modifying global entries, re-read the latest wrapper and shared files that changed, then run the Entry Update Workflow's post-edit optimization review.

## Safety Gates

Stop and ask the user before:

- Overwriting or deleting a non-empty `CLAUDE.md`.
- Replacing any existing `CLAUDE.md` symlink with a regular file.
- Auto-merging different non-empty `AGENTS.md` and `CLAUDE.md` contents.
- Moving project-specific instructions into a global file.
- Migrating non-empty global files into `~/.agents/` shared layout.
- Changing a team's established agent-document convention.

Do not ask before creating a missing `AGENTS.md` or a missing project `CLAUDE.md` wrapper that starts with `@AGENTS.md` when the user requested project setup.

## Output Quality

The final document should answer:

- What is this project/module?
- How is it organized?
- Which commands should agents use?
- What rules are truly project-wide and high-impact?
- Which additional docs should agents read only when relevant?

Avoid vague rules like "write clean code" or "follow best practices." Replace them with project-specific constraints, commands, ownership boundaries, or references.
