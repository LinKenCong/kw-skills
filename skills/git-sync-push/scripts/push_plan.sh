#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/common.sh"

read_state_value() {
  local key="$1"
  local file="$2"
  sed -n "s/^${key}=//p" "$file" | head -1
}

require_repo_context || exit 1
current_branch="$CURRENT_BRANCH"
default_branch="$DEFAULT_BRANCH"

remote_url=$(git remote get-url origin)
status_output=$(git status --porcelain)
worktree_dirty=false
if [ -n "$status_output" ]; then
  worktree_dirty=true
fi

state_file=$(state_file_path)
state_matches=false
remote_branch_status="unknown"
if [ -f "$state_file" ]; then
  state_branch=$(read_state_value CURRENT_BRANCH "$state_file")
  state_default_branch=$(read_state_value DEFAULT_BRANCH "$state_file")
  remote_branch_status=$(read_state_value REMOTE_BRANCH_STATUS "$state_file")
  if [ "$state_branch" = "$current_branch" ] && [ "$state_default_branch" = "$default_branch" ]; then
    state_matches=true
  fi
fi

needs_force="unknown"
push_command=""
result="remote_branch_status_unknown"
if [ "$state_matches" = "true" ]; then
  case "$remote_branch_status" in
    missing)
      needs_force=false
      push_command="git push -u origin '$current_branch'"
      result="ok"
      ;;
    present)
      if git rev-parse --verify "refs/remotes/origin/$current_branch" >/dev/null 2>&1; then
        needs_force=false
        if ! git merge-base --is-ancestor "origin/$current_branch" HEAD >/dev/null 2>&1; then
          needs_force=true
        fi
        push_command="git push -u origin '$current_branch'"
        if [ "$needs_force" = "true" ]; then
          push_command="git push --force-with-lease origin '$current_branch'"
        fi
        result="ok"
      fi
      ;;
  esac
fi

echo "RESULT=$result"
echo "CURRENT_BRANCH=$current_branch"
echo "DEFAULT_BRANCH=$default_branch"
echo "REMOTE_URL=$remote_url"
echo "RTK_AVAILABLE=$(rtk_installed && echo true || echo false)"
echo "TOKEN_FILTER=$(git_output_filter)"
echo "WORKTREE_DIRTY=$worktree_dirty"
echo "NEEDS_FORCE=$needs_force"
echo "PUSH_COMMAND=$push_command"
echo "STATE_MATCHES=$state_matches"
echo "REMOTE_BRANCH_STATUS=$remote_branch_status"
echo "AHEAD_DEFAULT_COUNT=$(git rev-list --count "origin/$default_branch..HEAD" 2>/dev/null || echo unknown)"
if [ "$state_matches" = "true" ] && [ "$remote_branch_status" = "present" ] && \
  git rev-parse --verify "refs/remotes/origin/$current_branch" >/dev/null 2>&1; then
  echo "AHEAD_REMOTE_COUNT=$(git rev-list --count "origin/$current_branch..HEAD" 2>/dev/null || echo unknown)"
else
  echo "AHEAD_REMOTE_COUNT=unknown"
fi

print_section COMMITS_AHEAD compact_git log --oneline "origin/$default_branch..HEAD"
print_section DIFF_STAT compact_git diff --stat "origin/$default_branch..HEAD"
print_section STATUS compact_git status --porcelain
