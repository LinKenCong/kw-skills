# git-sync-push Design

## Purpose

`git-sync-push` is a narrow operational skill for feature-branch maintenance:

1. inspect repository state
2. sync the current branch onto the remote default branch
3. show a push plan
4. push only after explicit confirmation

If the user asks for PR help, the skill only summarizes the branch diff as text. It does not create, submit, or edit a PR on any remote host.

## Scope

In scope:

- feature-branch preflight checks
- optional backup stash for dirty worktrees
- fetch + rebase onto the remote default branch
- recovery for common rebase-in-progress states
- push planning
- confirmed push
- text-only branch summary for PR drafting

Out of scope:

- direct PR creation
- `gh` / `tea` / browser automation
- force-push without explicit approval
- auto-resolution of merge or rebase conflicts
- default-branch release workflows

## Design Goals

- Keep the fast path short and deterministic.
- Move repetitive git plumbing into scripts instead of rebuilding shell logic in every run.
- Reduce model error surface from quoting, variable lifetime, and ad hoc condition handling.
- Minimize user interruptions.
- Ask for elevation only for commands that are expected to write `.git` state or require network access.

## Workflow

Normal path:

1. `scripts/preflight.sh`
2. `scripts/sync.sh`
3. `scripts/push_plan.sh`
4. user confirms push
5. push

Optional summary path:

1. `scripts/branch_summary.sh`
2. model writes `Title` and `Summary` text only

## Why Scripts Exist

The earlier version kept most logic inline in the model response. That caused three recurring problems:

- the same default-branch and branch-state logic was re-derived repeatedly
- shell quoting and command composition became error-prone
- sandbox failures often occurred before escalation because write/network commands were tried optimistically

The scripts centralize these concerns and return stable, parseable output.

## Script Contracts

All scripts follow two output conventions:

- top-level status is emitted as `KEY=VALUE`
- rich data blocks are emitted as base64 payloads inside delimited sections such as `__STATUS_START__` ... `__STATUS_END__`, with a companion `STATUS_ENCODING=base64`

This keeps the model in an interpretation role instead of a command-construction role. Command stderr should remain inside delimited sections instead of leaking into the outer protocol.

### `scripts/preflight.sh`

Responsibility:

- verify git repo context
- detect current branch
- detect default branch
- detect origin remote
- report worktree state

This script is read-only and should run without elevation.
If the default branch cannot be determined safely from local metadata, it must return `RESULT=default_branch_unknown` instead of guessing.

### `scripts/sync.sh`

Responsibility:

- skip stash when the worktree is already clean
- create a named stash only when needed
- fetch the latest refs
- rebase onto `origin/<default-branch>`
- continue an already-running rebase when that state is mechanically recoverable
- restore the backup stash if one was created

Implementation constraints:

- use `git rev-parse --git-path ...` for rebase-state detection so linked worktrees are supported
- resolve branch name from rebase metadata when HEAD is detached during rebase
- use unique temp files or temp directories for diagnostic logs
- return a structured `RESULT=...` for stash creation failures instead of exiting on raw shell errors
- refresh `origin/HEAD` from the remote before choosing the rebase base so default-branch detection does not depend on local guesswork
- fetch explicit branch refspecs so remote-tracking refs can be refreshed in narrow-fetch clones
- write a small repo-local sync-state file after successful sync so `push_plan.sh` can distinguish `present` / `missing` / `unknown` remote-branch status instead of collapsing everything into stale-local-ref uncertainty

Important result codes:

- `RESULT=ok`
- `RESULT=conflict`
- `RESULT=stash_failed`
- `RESULT=stash_lookup_failed`
- `RESULT=stash_conflict`
- `RESULT=fetch_failed`
- `RESULT=rebase_failed`
- `RESULT=rebase_continue_required`

This script is expected to need elevation.

### `scripts/push_plan.sh`

Responsibility:

- compute commits ahead of the default branch
- compute whether force-with-lease would be required when the remote tracking ref is reliable
- emit the exact shell-escaped push command only when that decision is reliable
- emit diff stat and worktree cleanliness

If the current branch does not have a reliable fresh `origin/<branch>` signal from the latest sync, it must report uncertainty rather than claiming `NEEDS_FORCE=false`. A first-push case with a fresh, explicit `missing` result is not uncertain and may emit the normal push command directly.

This script is read-only.

### `scripts/branch_summary.sh`

Responsibility:

- emit the raw commit list against the default branch
- emit diff stat
- emit changed files
- emit full diff when deeper summarization is needed

This script is read-only and exists only to support text drafting. It must remain scoped to text output and must not reintroduce PR creation or submission behavior.

## Permission Model

Read-only inspection should stay inside the sandbox.

These operations should request elevation up front:

- `git stash`
- `git fetch`
- `git rebase`
- `git push`

The skill should not intentionally probe these operations inside the sandbox first if the environment is already known to reject them.

## Conflict Policy

The skill distinguishes between content conflicts and operational interruptions.

Content conflict:

- report conflicted files
- explain the relevant options
- stop for user direction

Operational interruption:

- if rebase is already in progress and the worktree is clean, `scripts/sync.sh` may continue automatically
- otherwise, report the state and stop

The skill does not pick a semantic conflict resolution strategy on the user's behalf.

## User Interaction Rules

The user should normally only be interrupted for:

- a real rebase conflict
- a stash restore conflict
- push confirmation
- a rejected push that requires a strategic decision

Routine fetch/rebase/push-plan narration should stay compact.

## Non-Goals

This skill is not intended to be a full Git assistant. It does not manage:

- branch creation
- interactive rebases
- commit author rewriting
- release tagging
- PR lifecycle management

Those are separate workflows and should remain outside this skill.

## Maintenance Notes

- Keep `SKILL.md` focused on operator guidance and trigger behavior.
- Put deterministic workflow logic in `scripts/`.
- Prefer extending script result codes over embedding more branch logic in prose.
- If a future environment changes sandbox behavior, adjust the permission strategy section first.

## Changelog

### 2025-06 — Robustness & correctness pass

- **Bug fix**: `sync.sh` `git ls-remote` exit code was captured inside `if` condition, making it impossible to distinguish exit-code 2 (branch missing) from network errors. Fixed by capturing the code before the conditional.
- **Bug fix**: `sync.sh` rebase failure path did not restore the backup stash, leaving user changes stranded. Non-conflict rebase failures now call `restore_stash_if_present` before exiting. Conflict path now always emits `STASH_REF`.
- **Bug fix**: `branch_summary.sh` used three-dot `...` (symmetric diff) for `diff --stat`, `--name-only`, and full diff, while commits used two-dot `..`. Unified to two-dot for consistency with push_plan.sh.
- **Robustness**: Extracted `require_repo_context` into `common.sh` to deduplicate the not_git_repo / detached_head / no_origin / default_branch_unknown gate checks across all four scripts.
- **Robustness**: `print_section` now reuses a session-level `_SYNC_TMPDIR` when available instead of creating and destroying a temp directory per call.
- **Robustness**: `push_plan.sh` push command now uses single-quote wrapping instead of `printf %q` shell escaping, avoiding backslash-escaped branch names that confuse agent copy-paste.
- **Cleanup**: Removed `RECENT_COMMITS` section from `preflight.sh` (not used for any gate decision, adds token overhead).
- **Cleanup**: `allowed-tools` in SKILL.md updated from `Bash, Read` to `terminal, file`.
