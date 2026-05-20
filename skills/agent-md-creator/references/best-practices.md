# Best Practices

## Core Model

Agent instruction files are high-leverage context. They should orient an agent quickly and route it toward authoritative project information. They should not duplicate the repository, replace tooling, or accumulate one-off task notes.

Use these principles:

- Keep root files short, stable, and broadly applicable.
- Prefer layered context over one large root document.
- Prefer references to source files and docs over copied snippets.
- Prefer deterministic tools over natural-language formatting rules.
- Treat global instructions as personal/tool-specific, and project instructions as repo-specific/team-specific.
- State uncertainty when generated content is inferred from incomplete project evidence.

## Placement Rules

Use root `AGENTS.md` for:

- Project purpose and domain.
- Main architecture and directory ownership.
- Package manager, language, framework, and runtime facts that affect work.
- Common commands for install, dev, test, typecheck, lint, and build.
- High-impact safety rules.
- Links to additional docs that should be read only when relevant.

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

Use tools instead of agent prose for:

- Formatting.
- Import sorting.
- Type checks.
- Lint checks.
- Test enforcement.
- Generated-code checks.

## Project File Strategy

In projects, maintain `AGENTS.md` as the only real source of agent instructions. Create `CLAUDE.md` as a relative symlink to `AGENTS.md` so Claude Code can use the same project context:

```text
AGENTS.md
CLAUDE.md -> AGENTS.md
```

Do not overwrite an existing non-empty `CLAUDE.md`. First compare its role with `AGENTS.md`, then ask the user whether to migrate, merge, or keep it separate.

## Global File Strategy

Do not symlink global files. Maintain:

```text
~/.claude/CLAUDE.md
~/.codex/AGENTS.md
```

Reason: global Claude and Codex files often need different tool assumptions, memory behavior, hooks, skills, approvals, and runtime-specific instructions.

## Anti-Patterns

Remove or relocate:

- Large copied code blocks.
- Historical explanations that no longer affect work.
- Temporary workaround notes.
- Long lists of generic style preferences.
- Module-specific details in the project root file.
- Project-specific architecture in global files.
- Vague rules without an actionable project signal.
- Commands that are not verified against the repository.
