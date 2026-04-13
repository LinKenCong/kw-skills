#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/common.sh"

tmpdir=$(make_tmpdir)
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

stash_pop_log="$tmpdir/stash-pop.log"
stash_create_log="$tmpdir/stash-create.log"
fetch_log="$tmpdir/fetch.log"
default_branch_log="$tmpdir/default-branch.log"
remote_lookup_log="$tmpdir/remote-lookup.log"
rebase_log="$tmpdir/rebase.log"
rebase_continue_log="$tmpdir/rebase-continue.log"
state_file=$(state_file_path)

emit_conflicts() {
  echo "RESULT=conflict"
  print_section CONFLICT_FILES sh -c 'git diff --name-only --diff-filter=U'
  print_section STATUS sh -c 'git status --short'
  exit 1
}

restore_stash_if_present() {
  local stash_ref="$1"
  [ -n "$stash_ref" ] || return 0
  git stash pop "$stash_ref" >"$stash_pop_log" 2>&1 || {
    echo "RESULT=stash_conflict"
    echo "STASH_REF=$stash_ref"
    print_section STASH_POP_OUTPUT cat "$stash_pop_log"
    print_section CONFLICT_FILES sh -c 'git diff --name-only --diff-filter=U'
    exit 1
  }
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "RESULT=not_git_repo"
  exit 1
fi

rm -f "$state_file"

current_branch=$(current_branch_name || true)
if [ -z "$current_branch" ]; then
  echo "RESULT=detached_head"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "RESULT=no_origin"
  exit 1
fi

default_branch=$(detect_default_branch || true)
if git remote set-head origin --auto >"$default_branch_log" 2>&1; then
  default_branch=$(detect_default_branch || true)
fi
if [ -z "$default_branch" ]; then
  echo "RESULT=default_branch_unknown"
  echo "CURRENT_BRANCH=$current_branch"
  print_section DEFAULT_BRANCH_RESOLUTION_OUTPUT cat "$default_branch_log"
  exit 1
fi

if [ "$current_branch" = "$default_branch" ]; then
  echo "RESULT=default_branch_selected"
  exit 1
fi

echo "CURRENT_BRANCH=$current_branch"
echo "DEFAULT_BRANCH=$default_branch"
echo "HEAD_BEFORE=$(git rev-parse HEAD)"

while has_rebase_in_progress; do
  if [ -n "$(git diff --name-only --diff-filter=U || true)" ]; then
    emit_conflicts
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "RESULT=rebase_continue_required"
    print_section STATUS sh -c 'git status'
    exit 1
  fi

  if ! git rebase --continue >"$rebase_continue_log" 2>&1; then
    if [ -n "$(git diff --name-only --diff-filter=U || true)" ]; then
      emit_conflicts
    fi
    echo "RESULT=rebase_failed"
    print_section REBASE_OUTPUT cat "$rebase_continue_log"
    exit 1
  fi
done

stash_ref=""
status_before=$(git status --porcelain)
if [ -n "$status_before" ]; then
  stash_name="git-sync-push-backup-$(date +%s)-$$"
  stash_count_before=$(git stash list | wc -l | tr -d ' ')
  if ! git stash push -m "$stash_name" --include-untracked >"$stash_create_log" 2>&1; then
    echo "RESULT=stash_failed"
    print_section STASH_CREATE_OUTPUT cat "$stash_create_log"
    exit 1
  fi
  stash_count_after=$(git stash list | wc -l | tr -d ' ')
  if [ "$stash_count_after" -gt "$stash_count_before" ]; then
    stash_ref=$(git stash list | grep -F -- "$stash_name" | head -1 | cut -d: -f1 || true)
    if [ -z "$stash_ref" ]; then
      echo "RESULT=stash_lookup_failed"
      print_section STASH_CREATE_OUTPUT cat "$stash_create_log"
      exit 1
    fi
  fi
fi

remote_branch_status="unknown"
if ! git fetch origin \
  "refs/heads/$default_branch:refs/remotes/origin/$default_branch" >"$fetch_log" 2>&1; then
  if [ -n "$stash_ref" ]; then
    restore_stash_if_present "$stash_ref"
  fi
  echo "RESULT=fetch_failed"
  print_section FETCH_OUTPUT cat "$fetch_log"
  exit 1
fi

if git ls-remote --exit-code --heads origin "$current_branch" >"$remote_lookup_log" 2>&1; then
  remote_branch_status="present"
  if ! git fetch origin \
    "refs/heads/$current_branch:refs/remotes/origin/$current_branch" >>"$fetch_log" 2>&1; then
    restore_stash_if_present "$stash_ref"
    echo "RESULT=fetch_failed"
    print_section FETCH_OUTPUT cat "$fetch_log"
    exit 1
  fi
else
  ls_remote_code=$?
  if [ "$ls_remote_code" -eq 2 ]; then
    remote_branch_status="missing"
  else
    echo "RESULT=fetch_failed"
    print_section REMOTE_BRANCH_LOOKUP_OUTPUT cat "$remote_lookup_log"
    print_section FETCH_OUTPUT cat "$fetch_log"
    exit 1
  fi
fi

if ! git rebase "origin/$default_branch" >"$rebase_log" 2>&1; then
  if [ -n "$(git diff --name-only --diff-filter=U || true)" ]; then
    echo "STASH_REF=$stash_ref"
    emit_conflicts
  fi
  echo "RESULT=rebase_failed"
  print_section REBASE_OUTPUT cat "$rebase_log"
  exit 1
fi

restore_stash_if_present "$stash_ref"

cat >"$state_file" <<EOF
CURRENT_BRANCH=$current_branch
DEFAULT_BRANCH=$default_branch
REMOTE_BRANCH_STATUS=$remote_branch_status
EOF

echo "RESULT=ok"
echo "STASH_REF=$stash_ref"
echo "REMOTE_BRANCH_STATUS=$remote_branch_status"
echo "HEAD_AFTER=$(git rev-parse HEAD)"
