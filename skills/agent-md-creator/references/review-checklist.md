# Review Checklist

## Existing State

- Identify whether the request is project mode or global mode.
- Check whether `AGENTS.md` exists.
- Check whether `CLAUDE.md` exists.
- If `CLAUDE.md` exists, determine whether it is missing, empty, a symlink, a regular `@AGENTS.md` wrapper, or a non-empty regular file.
- If both files exist, compare their roles before editing.
- In global mode, check for `~/.agents/AGENTS.md`, `~/.agents/rules/`, `~/.claude/CLAUDE.md`, and `~/.codex/AGENTS.md`.

## Content Quality

- The root file is short enough to be useful in most sessions.
- The root file contains project-wide facts, not module-only details.
- Commands match detected tooling.
- Rules are specific and actionable.
- Long details are moved to linked docs.
- Copied code is replaced with file references.
- Vague advice is removed or converted into concrete project constraints.

## Placement

- Project-wide instructions are in root `AGENTS.md`.
- Module-only instructions are in descendant `AGENTS.md`.
- Long but useful details are in `agent_docs/*.md`.
- Personal preferences are in global files.
- Shared global personal rules are in `~/.agents/AGENTS.md` or `~/.agents/rules/*.md`.
- Tool-specific global behavior remains in the relevant wrapper file.
- Tool-enforceable checks are represented by commands/configs, not long prose.

## Project Claude Import Safety

- `CLAUDE.md` is a regular file that starts with `@AGENTS.md` when safe.
- Empty `CLAUDE.md` can be replaced with the `@AGENTS.md` wrapper.
- Claude-specific project rules are appended below the import, not duplicated into `AGENTS.md`.
- Non-empty `CLAUDE.md` is not overwritten without user confirmation.
- A `CLAUDE.md` symlink pointing elsewhere is not replaced without user confirmation.
- Existing `CLAUDE.md` symlinks are not replaced with regular files without user confirmation.
- Project `CLAUDE.md` symlinks are not created by default.

## Global Safety

- Shared global rules live in `~/.agents/AGENTS.md` and `~/.agents/rules/*.md`.
- `~/.claude/CLAUDE.md` uses supported `@path` imports for shared files and keeps Claude-specific behavior.
- `~/.codex/AGENTS.md` explicitly tells agents to read `@path` references before listing those references.
- `~/.codex/AGENTS.md` does not claim Codex automatically expands `@path` references.
- No global symlink is created.
- Project-specific details are not written into global files.
- Tool-specific behavior is kept in the relevant tool's global file.
- Markdown instruction prose is not moved into `~/.codex/rules/*.md`.
- Non-empty global files are not migrated into the shared-wrapper layout without user confirmation.

## Final Response

Report:

- Files created or changed.
- `@` wrappers or references created, and symlinks intentionally not created.
- Content moved, removed, or deferred to separate docs/tools.
- Any assumptions or unresolved conflicts.
- Suggested validation or follow-up only when useful.
