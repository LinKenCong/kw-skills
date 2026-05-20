# Best Practices

## Core Model

Agent instruction files are high-leverage context. They should orient an agent quickly and route it toward authoritative project information. They should not duplicate the repository, replace tooling, or accumulate one-off task notes.

Use these principles:

- Keep root files short, stable, and broadly applicable.
- Prefer layered context over one large root document.
- Prefer references to source files and docs over copied snippets.
- Prefer deterministic tools over natural-language formatting rules.
- Treat global instructions as shared personal rules plus thin tool-specific wrappers, and project instructions as repo-specific/team-specific.
- State uncertainty when generated content is inferred from incomplete project evidence.

## Placement Rules

Use root `AGENTS.md` for:

- Project purpose and domain.
- Main architecture and directory ownership.
- Package manager, language, framework, and runtime facts that affect work.
- Common commands for install, dev, test, typecheck, lint, and build.
- High-impact safety rules.
- Links to additional docs that should be read only when relevant.
- A short reference-loading note before any `@path` references intended for Codex agents, because Codex does not automatically expand them.

Use descendant `AGENTS.md` files for:

- Module-specific architecture.
- Framework-specific conventions.
- Local test/build commands.
- Edge cases that apply only in that subtree.

Use `agent_docs/*.md` for:

- Longer architecture notes.
- Testing strategy.
- Database, API, deployment, or blockchain workflows.
- Any detail that is important but not needed in most sessions.

Use global files for:

- Personal communication preferences.
- Personal safety defaults.
- Tool-specific workflows.
- Cross-project defaults that should not be committed to a project.
- Shared rule references that avoid duplicating the same global prose across agent runtimes.

Use tools instead of agent prose for:

- Formatting.
- Import sorting.
- Type checks.
- Lint checks.
- Test enforcement.
- Generated-code checks.

## Project File Strategy

In projects, maintain `AGENTS.md` as the canonical source of shared agent instructions. Create `CLAUDE.md` as a regular file that imports `AGENTS.md` with Claude Code's `@` syntax:

```text
AGENTS.md
CLAUDE.md
```

```md
@AGENTS.md
```

If Claude-specific project rules are necessary, append them below the import:

```md
@AGENTS.md

## Claude Code

- Add only Claude-specific project behavior here.
```

Do not create project symlinks by default. Do not overwrite an existing non-empty `CLAUDE.md`. First compare its role with `AGENTS.md`, then ask the user whether to migrate, merge, or keep it separate.

## Global File Strategy

Do not symlink global files. Prefer a shared source of personal rules plus tool-specific wrappers:

```text
~/.agents/AGENTS.md
~/.agents/rules/*.md
~/.claude/CLAUDE.md
~/.codex/AGENTS.md
```

- `~/.agents/AGENTS.md` contains cross-agent, cross-project personal defaults.
- `~/.agents/rules/*.md` contains longer shared rule documents.
- `~/.claude/CLAUDE.md` uses Claude Code's supported `@path` import syntax for shared files and keeps Claude-specific memory, hooks, slash-command assumptions, and workflow.
- `~/.codex/AGENTS.md` may list shared files as `@path` references only if it also instructs Codex agents to read those referenced files. Do not claim Codex automatically expands `@path` references.

Reason: global Claude and Codex files often need different tool assumptions, memory behavior, hooks, skills, approvals, and runtime-specific instructions, but repeated shared prose drifts over time.

Do not use `~/.codex/rules/*.md` for Markdown instruction prose; Codex uses its `rules/` directory for approval-rule data unless the runtime documentation says otherwise.

## Anti-Patterns

Remove or relocate:

- Large copied code blocks.
- Historical explanations that no longer affect work.
- Temporary workaround notes.
- Long lists of generic style preferences.
- Module-specific details in the project root file.
- Project-specific architecture in global files.
- Duplicated global prose in both `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` when it could be shared or referenced from `~/.agents/`.
- Vague rules without an actionable project signal.
- Commands that are not verified against the repository.
