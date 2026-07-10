#!/bin/sh
set -u

usage() {
  cat >&2 <<'USAGE'
Usage:
  sh collect-git-activity.sh --author AUTHOR --since YYYY-MM-DD --until YYYY-MM-DD --project PATH [--project PATH ...]

Output is TSV-like text for agents to parse. It needs git and POSIX sh only.
USAGE
}

AUTHOR=""
SINCE=""
UNTIL=""
PROJECTS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --author)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      AUTHOR=$1
      ;;
    --since)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      SINCE=$1
      ;;
    --until)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      UNTIL=$1
      ;;
    --project)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      if [ -n "$PROJECTS" ]; then
        PROJECTS=$PROJECTS'
'$1
      else
        PROJECTS=$1
      fi
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

[ -n "$AUTHOR" ] || { printf 'Missing --author\n' >&2; usage; exit 2; }
[ -n "$SINCE" ] || { printf 'Missing --since\n' >&2; usage; exit 2; }
[ -n "$UNTIL" ] || { printf 'Missing --until\n' >&2; usage; exit 2; }
[ -n "$PROJECTS" ] || { printf 'Missing --project\n' >&2; usage; exit 2; }

printf 'RANGE\t%s\t%s\n' "$SINCE" "$UNTIL"
printf 'AUTHOR\t%s\n' "$AUTHOR"

printf '%s\n' "$PROJECTS" | while IFS= read -r project; do
  [ -n "$project" ] || continue

  printf 'PROJECT\t%s\n' "$project"

  if [ ! -d "$project" ]; then
    printf 'STATUS\tmissing_path\n'
    printf 'END_PROJECT\n'
    continue
  fi

  if ! git -C "$project" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf 'STATUS\tnot_git\n'
    printf 'END_PROJECT\n'
    continue
  fi

  root=$(git -C "$project" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$project")
  printf 'ROOT\t%s\n' "$root"

  commit_count=$(git -C "$project" log \
    --since="$SINCE 00:00:00" \
    --until="$UNTIL 23:59:59" \
    --author="$AUTHOR" \
    --format='%H' 2>/dev/null | sed '/^$/d' | wc -l | awk '{print $1}')

  if [ "${commit_count:-0}" = "0" ]; then
    printf 'STATUS\tno_records\n'
    printf 'END_PROJECT\n'
    continue
  fi

  printf 'STATUS\tok\n'
  printf 'COUNT\t%s\n' "$commit_count"

  git -C "$project" log \
    --since="$SINCE 00:00:00" \
    --until="$UNTIL 23:59:59" \
    --author="$AUTHOR" \
    --date=short \
    --pretty=format:'COMMIT%x09%h%x09%ad%x09%an%x09%ae%x09%s'
  printf '\n'

  git -C "$project" log \
    --since="$SINCE 00:00:00" \
    --until="$UNTIL 23:59:59" \
    --author="$AUTHOR" \
    --numstat \
    --pretty=format: | awk '
      NF == 3 {
        files += 1
        if ($1 != "-") insertions += $1
        if ($2 != "-") deletions += $2
      }
      END {
        printf "STAT\tfiles=%d\tinsertions=%d\tdeletions=%d\n", files + 0, insertions + 0, deletions + 0
      }
    '

  git -C "$project" log \
    --since="$SINCE 00:00:00" \
    --until="$UNTIL 23:59:59" \
    --author="$AUTHOR" \
    --name-status \
    --pretty=format: | awk '
      NF >= 2 { print "FILE\t" $1 "\t" $2 }
    ' | sort | uniq

  git -C "$project" log \
    --since="$SINCE 00:00:00" \
    --until="$UNTIL 23:59:59" \
    --author="$AUTHOR" \
    --name-only \
    --pretty=format: | awk '
      NF > 0 {
        split($0, parts, "/")
        module = parts[1]
        if (module != "") count[module] += 1
      }
      END {
        for (module in count) print "MODULE\t" module "\t" count[module]
      }
    ' | sort

  printf 'END_PROJECT\n'
done
