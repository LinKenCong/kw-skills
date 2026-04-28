#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_repo_context || exit 1
current_branch="$CURRENT_BRANCH"
default_branch="$DEFAULT_BRANCH"

echo "RESULT=ok"
echo "CURRENT_BRANCH=$current_branch"
echo "DEFAULT_BRANCH=$default_branch"
echo "RTK_AVAILABLE=$(rtk_installed && echo true || echo false)"
echo "TOKEN_FILTER=$(git_output_filter)"
echo "COMMIT_COUNT=$(git rev-list --count "origin/$default_branch..HEAD" 2>/dev/null || echo unknown)"

print_section COMMITS git log "origin/$default_branch..HEAD" --format='%H %s'
print_section DIFF_STAT compact_git diff --stat "origin/$default_branch..HEAD"
print_section FILES git diff --name-only "origin/$default_branch..HEAD"
print_section FULL_DIFF compact_git diff "origin/$default_branch..HEAD"
