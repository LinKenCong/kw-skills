---
name: git-sync-push
description: >
  Safe Git sync-and-push workflow for feature branches. Fetch the latest default branch,
  rebase the current branch onto it, show a push plan, and push only after explicit user
  confirmation. Use this whenever the user asks to push code, sync and push, update a branch
  before pushing, rebase onto main/master and push, or similar requests in English or Chinese
  such as "推送代码", "同步并推送", "提交推送", "推到远程". If the user also wants PR help,
  summarize the branch diff as text only; do not create a PR and do not use gh or browser automation.
allowed-tools: terminal, file
---

# Git Sync & Push

Sync the current feature branch with the remote default branch and push it safely.

The fast path is short:

1. Read repo state with `scripts/preflight.sh`
2. Run `scripts/sync.sh` with escalation
3. Read push details with `scripts/push_plan.sh`
4. Ask once for push confirmation
5. Push

Use exception handling only when the scripts report a conflict or another blocking state.

## Safety Rules

- Never run this workflow on the default branch itself.
- Never use `--force`; only use `--force-with-lease`, and only after explicit user confirmation.
- Never skip hooks unless the user explicitly asks.
- Never auto-resolve rebase conflicts.
- Never create or submit a PR from this skill.
- When the user asks for PR help, return text only: title + summary bullets.

## Permission Strategy

In this environment, `git fetch`, `git rebase`, `git stash`, and `git push` may fail in the sandbox because they write `.git` state or require network access.

- Run `scripts/preflight.sh` without escalation.
- For `scripts/sync.sh`, request escalation up front.
- For `git push`, request escalation up front.
- Do not intentionally "try once and fail" for these write/network operations.

## Optional rtk Token Filter

The bundled scripts automatically detect `rtk` with `command -v rtk`. When available, they prefer `rtk git ...` only for read-only, token-heavy sections that are shown to the model, such as status, log, diff stat, and optional branch-summary diff output.

Keep all gate decisions and state-changing commands on native `git`:

- Do not use `rtk` for `git stash`, `git fetch`, `git rebase`, or `git push`.
- Do not use `rtk` to decide whether a branch can be pushed or whether force-with-lease is required.
- If compact output hides detail needed for PR text, rerun the relevant read-only script with `GIT_SYNC_PUSH_RTK=0`.

Scripts emit `RTK_AVAILABLE=true|false` and `TOKEN_FILTER=rtk|raw` so the active mode is visible.

## Bundled Scripts

Open these only when needed:

- `scripts/common.sh`: shared helpers — `require_repo_context` gate, branch/default-branch detection, rebase detection, and section output
- `scripts/preflight.sh`: read-only repo checks
- `scripts/sync.sh`: optional stash, fetch, rebase, stash restore, and sync-state recording
- `scripts/push_plan.sh`: push decision summary
- `scripts/branch_summary.sh`: raw branch data for a PR-style text summary

## Step 0 — Preflight

Run:

```bash
bash /path/to/git-sync-push/scripts/preflight.sh
```

The script prints stable `KEY=VALUE` lines plus base64-encoded delimited sections. Each section also emits `<NAME>_ENCODING=base64` before the payload.

If `TOKEN_FILTER=rtk`, section payloads may contain compact `rtk git` output rather than raw Git output. Gate fields such as `RESULT`, `CURRENT_BRANCH`, `DEFAULT_BRANCH`, `WORKTREE_DIRTY`, and `BRANCH_IS_DEFAULT` still come from native Git checks.

Gate checks:

- `RESULT=not_git_repo`: stop
- `RESULT=detached_head`: stop
- `RESULT=no_origin`: stop
- `RESULT=default_branch_unknown`: note that local default-branch metadata is missing; `scripts/sync.sh` may still resolve it under escalation for an actual sync-and-push run
- `BRANCH_IS_DEFAULT=true`: stop

Warn, but do not stop, when `IS_SHALLOW=true`.

## Step 1 — Sync

Run with escalation:

```bash
bash /path/to/git-sync-push/scripts/sync.sh
```

This script already handles the common cases:

- If the worktree is clean, it skips stash entirely.
- If the worktree is dirty, it creates a named backup stash before fetch/rebase.
- If a rebase is already in progress and the worktree is clean, it attempts `git rebase --continue`.
- It uses `git rev-parse --git-path ...` for rebase-state detection, so linked worktrees are supported.
- Before syncing, it refreshes `origin/HEAD` from the remote so default-branch detection does not rely on `main` / `master` guessing.
- It fetches explicit refspecs for both the default branch and the current branch, so narrow fetch refspec repos can still refresh `origin/<branch>` correctly.
- On success, it records a small repo-local sync-state file so `push_plan.sh` can distinguish `present` / `missing` / `unknown` remote-branch status and make an exact push decision when that status is reliable.

Interpret results:

- `RESULT=ok`: continue
- `RESULT=conflict`: show the conflicted files and ask the user how to resolve them
- `RESULT=stash_failed`: show the exact error and stop
- `RESULT=stash_lookup_failed`: show the exact error and stop
- `RESULT=stash_conflict`: explain that the sync succeeded but stash restoration conflicted
- `RESULT=fetch_failed`: show the exact error and stop
- `RESULT=rebase_failed`: show the exact error and stop
- `RESULT=rebase_continue_required`: show status and ask the user to resolve or abort
- `RESULT=default_branch_unknown`: stop

Only ask the user for input when the script reports a blocking state.

## Step 2 — Push Plan

Run:

```bash
bash /path/to/git-sync-push/scripts/push_plan.sh
```

Use its output to present:

- Branch name
- Default branch
- Remote URL
- Commits ahead of default branch
- Diff stat
- Whether the worktree is clean
- Whether `--force-with-lease` is required
- The exact push command when `RESULT=ok`, shown as shell-escaped literal command text from the script output

If `RESULT=remote_branch_status_unknown`, do not claim that force-push is unnecessary. State that the local repository does not have a reliable fresh-tracking signal for `origin/<branch>` from the last sync, so an exact offline push decision is not available.

Then ask: `确认推送？(y/n)`

## Step 3 — Push

If the user confirms:

- Use the shell-escaped command text emitted by `scripts/push_plan.sh` when `RESULT=ok`
- Request escalation up front

Treat the emitted command as data from the script. Do not rebuild it from raw branch text or interpolate the refname into a fresh shell command.

If `RESULT=remote_branch_status_unknown`, explain the uncertainty and ask before attempting a normal `git push -u origin <branch>`.

If push is rejected:

- Show the exact rejection
- Explain whether the likely next step is:
  - `git push --force-with-lease origin <branch>` after explicit user approval
  - `git pull --rebase origin <branch>` when others may have pushed to the same branch

Do not choose automatically.

## Step 4 — Optional Branch Summary

If the user wants PR help after push, do not create a PR.

Run:

```bash
bash /path/to/git-sync-push/scripts/branch_summary.sh
```

If the compact diff is too sparse for useful PR text, rerun:

```bash
GIT_SYNC_PUSH_RTK=0 bash /path/to/git-sync-push/scripts/branch_summary.sh
```

Then return only:

- `Title:` one concise conventional-commit-style summary
- `Summary:` 3-5 bullets describing the branch diff relative to the default branch

Do not call `gh`.
Do not open a browser.
Do not submit anything to the remote host.

## Response Style

- Keep normal sync-and-push runs concise.
- Do not enumerate fallback branches unless they actually happen.
- Prefer reporting script results over narrating every individual git plumbing command.
- If a command was skipped because the worktree was clean, say so directly.
- Keep stderr inside the encoded delimited sections when presenting script output; do not mix raw fatal lines into the outer protocol.
