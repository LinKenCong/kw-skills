# kw-skills

A multi-skill repository for skills that can be installed with `skills.sh` / `npx skills add`.

## Repository layout

```text
skills/
  <skill-name>/
    SKILL.md
    optional supporting files (for example: scripts/, references/, DESIGN.md)
  <group-name>/
    <skill-name>/
      SKILL.md
      optional supporting files (for example: references/)
```

## Install examples

```bash
# List skills in this repo
npx skills add LinKenCong/kw-skills --list

# Install one skill from this repo
npx skills add LinKenCong/kw-skills --skill git-sync-push

# Install all skills from this repo
npx skills add LinKenCong/kw-skills --skill '*'
```

## Included skills

- `agent-md-creator` — create, audit, refactor, and migrate AGENTS.md / CLAUDE.md agent instruction documents with safe `@` reference handling
- `figma-react-restore` — restore, implement, compare, verify, or repair Figma designs in existing React projects using local extraction and browser verification artifacts
- `figma-to-code` — extract live Figma design data through a local plugin and bridge, then translate designs into production frontend code
- `git-sync-push` — safe Git sync-and-push workflow for feature branches
- `implementation-executor` — execute an approved implementation task with run cache, TDD contract tests, isolated worker worktrees, independent reviewer workers, validation, acceptance evidence, local integration, and cleanup
- `linus-review` — non-trivial code, PR, architecture, plan, compatibility, migration, refactor, and regression-risk reviews through a direct Linus-inspired engineering lens
- `project-spec-design` — turn new project, product, or feature ideas into approved specs and sequential implementation task plans for later development
- `skill-template-manager` — manager-owned skill store, reusable symlink templates, and project-level skill activation
- `weekly-report` — generate Chinese personal weekly reports from Git commit activity, with confirmed project paths, date ranges, output location, and safe default filenames

## Notes

- Each installable skill must contain a `SKILL.md` with at least `name` and `description` in frontmatter.
- Grouping directories under `skills/` may contain related installable skills; they are not skills unless they contain their own `SKILL.md`.
- Do not commit nested `.git` directories inside `skills/<skill-name>/`.
- Supporting files such as `scripts/` and design docs can live beside `SKILL.md`.
