# Review Checklist

## Existing State

- Identify whether the request is project mode or global mode.
- Check whether `AGENTS.md` exists.
- Check whether `CLAUDE.md` exists.
- If `CLAUDE.md` exists, determine whether it is missing, empty, a symlink, or a non-empty regular file.
- If both files exist, compare their roles before editing.

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
- Tool-enforceable checks are represented by commands/configs, not long prose.

## Project Symlink Safety

- `CLAUDE.md` is a relative symlink to `AGENTS.md` when safe.
- Empty `CLAUDE.md` can be replaced with the symlink.
- Non-empty `CLAUDE.md` is not overwritten without user confirmation.
- A `CLAUDE.md` symlink pointing elsewhere is not replaced without user confirmation.
- Absolute symlinks are not created.

## Global Safety

- `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` are maintained separately.
- No global symlink is created.
- Project-specific details are not written into global files.
- Tool-specific behavior is kept in the relevant tool's global file.

## Final Response

Report:

- Files created or changed.
- Symlinks created or intentionally not created.
- Content moved, removed, or deferred to separate docs/tools.
- Any assumptions or unresolved conflicts.
- Suggested validation or follow-up only when useful.
