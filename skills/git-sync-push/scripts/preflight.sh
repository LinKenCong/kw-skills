#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_repo_context || exit 1
current_branch="$CURRENT_BRANCH"
default_branch="$DEFAULT_BRANCH"

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
echo "RTK_AVAILABLE=$(rtk_installed && echo true || echo false)"
echo "TOKEN_FILTER=$(git_output_filter)"
echo "IS_SHALLOW=$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)"
echo "WORKTREE_DIRTY=$worktree_dirty"
echo "BRANCH_IS_DEFAULT=$branch_is_default"
echo "REBASE_IN_PROGRESS=$(has_rebase_in_progress && echo true || echo false)"
echo "HEAD=$(git rev-parse HEAD)"

print_section STATUS compact_git status --porcelain
