#!/usr/bin/env bash

print_section() {
  local name="$1"
  shift
  local tmpdir
  local output_file

  tmpdir=$(make_tmpdir)
  output_file="$tmpdir/${name}.out"

  "$@" >"$output_file" 2>&1 || true

  echo "${name}_ENCODING=base64"
  echo "__${name}_START__"
  base64 <"$output_file" | tr -d '\n'
  echo
  echo "__${name}_END__"

  rm -rf "$tmpdir"
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

state_file_path() {
  git rev-parse --git-path git-sync-push-state
}

shell_quote() {
  printf '%q' "$1"
}
