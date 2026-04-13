#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/common.sh"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "RESULT=not_git_repo"
  exit 1
fi

current_branch=$(current_branch_name || true)
if [ -z "$current_branch" ]; then
  echo "RESULT=detached_head"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "RESULT=no_origin"
  echo "CURRENT_BRANCH=$current_branch"
  echo "REBASE_IN_PROGRESS=$(has_rebase_in_progress && echo true || echo false)"
  exit 1
fi

default_branch=$(detect_default_branch || true)
if [ -z "$default_branch" ]; then
  echo "RESULT=default_branch_unknown"
  echo "CURRENT_BRANCH=$current_branch"
  echo "REBASE_IN_PROGRESS=$(has_rebase_in_progress && echo true || echo false)"
  exit 1
fi

remote_url=$(git remote get-url origin)
status_output=$(git status --porcelain)
worktree_dirty=false
if [ -n "$status_output" ]; then
  worktree_dirty=true
fi

branch_is_default=false
if [ "$current_branch" = "$default_branch" ]; then
  branch_is_default=true
fi

echo "RESULT=ok"
echo "CURRENT_BRANCH=$current_branch"
echo "DEFAULT_BRANCH=$default_branch"
echo "HAS_ORIGIN=true"
echo "REMOTE_URL=$remote_url"
echo "IS_SHALLOW=$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)"
echo "WORKTREE_DIRTY=$worktree_dirty"
echo "BRANCH_IS_DEFAULT=$branch_is_default"
echo "REBASE_IN_PROGRESS=$(has_rebase_in_progress && echo true || echo false)"
echo "HEAD=$(git rev-parse HEAD)"

print_section STATUS sh -c 'git status --porcelain'
print_section RECENT_COMMITS sh -c 'git log --oneline -5'
