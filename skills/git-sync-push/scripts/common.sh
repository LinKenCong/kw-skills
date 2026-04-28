#!/usr/bin/env bash

print_section() {
  local name="$1"
  shift
  local output_file="${_SYNC_TMPDIR:-$(make_tmpdir)}/${name}.out"
  "$@" >"$output_file" 2>&1 || true

  echo "${name}_ENCODING=base64"
  echo "__${name}_START__"
  base64 <"$output_file" | tr -d '\n'
  echo
  echo "__${name}_END__"
  rm -f "$output_file"
}

rtk_installed() {
  command -v rtk >/dev/null 2>&1
}

rtk_enabled() {
  case "${GIT_SYNC_PUSH_RTK:-auto}" in
    0|false|FALSE|False|no|NO|No|off|OFF|Off)
      return 1
      ;;
  esac

  rtk_installed
}

git_output_filter() {
  if rtk_enabled; then
    echo "rtk"
  else
    echo "raw"
  fi
}

compact_git() {
  local rtk_output

  if rtk_enabled; then
    rtk_output=$(mktemp "${TMPDIR:-/tmp}/git-sync-push-rtk.XXXXXX")
    if rtk git "$@" >"$rtk_output" 2>/dev/null; then
      cat "$rtk_output"
      rm -f "$rtk_output"
      return 0
    fi
    rm -f "$rtk_output"
  fi

  git "$@"
}

git_path() {
  git rev-parse --git-path "$1"
}

has_rebase_in_progress() {
  local merge_dir
  local apply_dir
  merge_dir=$(git_path rebase-merge)
  apply_dir=$(git_path rebase-apply)
  [ -d "$merge_dir" ] || [ -d "$apply_dir" ]
}

current_branch_name() {
  local branch
  local head_name_path
  local ref_name

  branch=$(git branch --show-current 2>/dev/null || true)
  if [ -n "$branch" ]; then
    printf '%s\n' "$branch"
    return 0
  fi

  for head_name_path in "$(git_path rebase-merge/head-name)" "$(git_path rebase-apply/head-name)"; do
    if [ -f "$head_name_path" ]; then
      ref_name=$(cat "$head_name_path" 2>/dev/null || true)
      ref_name=${ref_name#refs/heads/}
      if [ -n "$ref_name" ]; then
        printf '%s\n' "$ref_name"
        return 0
      fi
    fi
  done

  return 1
}

detect_default_branch() {
  local branch

  branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)
  if [ -n "$branch" ]; then
    printf '%s\n' "$branch"
    return 0
  fi

  return 1
}

make_tmpdir() {
  mktemp -d "${TMPDIR:-/tmp}/git-sync-push.XXXXXX"
}

# Shared repo-context gate. Prints KEY=VALUE diagnostics and returns 1 on failure.
# Usage: require_repo_context || exit 1
# Sets: CURRENT_BRANCH, DEFAULT_BRANCH (exported to caller via eval or source)
require_repo_context() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "RESULT=not_git_repo"
    return 1
  fi

  _rrc_branch=$(current_branch_name || true)
  if [ -z "$_rrc_branch" ]; then
    echo "RESULT=detached_head"
    return 1
  fi

  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "RESULT=no_origin"
    echo "CURRENT_BRANCH=$_rrc_branch"
    return 1
  fi

  _rrc_default=$(detect_default_branch || true)
  if [ -z "$_rrc_default" ]; then
    echo "RESULT=default_branch_unknown"
    echo "CURRENT_BRANCH=$_rrc_branch"
    return 1
  fi

  # Export to caller's scope
  CURRENT_BRANCH="$_rrc_branch"
  DEFAULT_BRANCH="$_rrc_default"
  return 0
}

state_file_path() {
  git rev-parse --git-path git-sync-push-state
}

shell_quote() {
  printf '%q' "$1"
}
