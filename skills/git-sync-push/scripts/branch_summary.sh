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
  exit 1
fi

default_branch=$(detect_default_branch || true)
if [ -z "$default_branch" ]; then
  echo "RESULT=default_branch_unknown"
  echo "CURRENT_BRANCH=$current_branch"
  exit 1
fi

echo "RESULT=ok"
echo "CURRENT_BRANCH=$current_branch"
echo "DEFAULT_BRANCH=$default_branch"
echo "COMMIT_COUNT=$(git rev-list --count "origin/$default_branch..HEAD" 2>/dev/null || echo unknown)"

print_section COMMITS git log "origin/$default_branch..HEAD" --format='%H %s'
print_section DIFF_STAT git diff --stat "origin/$default_branch...HEAD"
print_section FILES git diff --name-only "origin/$default_branch...HEAD"
print_section FULL_DIFF git diff "origin/$default_branch...HEAD"
