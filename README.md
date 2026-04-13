# kw-skills

A multi-skill repository for skills that can be installed with `skills.sh` / `npx skills add`.

## Repository layout

```text
skills/
  <skill-name>/
    SKILL.md
    optional supporting files (for example: scripts/, references/, DESIGN.md)
```

## Install examples

```bash
# List skills in this repo
npx skills add <owner>/kw-skills --list

# Install one skill from this repo
npx skills add <owner>/kw-skills --skill git-sync-push

# Install all skills from this repo
npx skills add <owner>/kw-skills --skill '*'
```

## Included skills

- `git-sync-push` — safe Git sync-and-push workflow for feature branches

## Notes

- Each installable skill must contain a `SKILL.md` with at least `name` and `description` in frontmatter.
- Do not commit nested `.git` directories inside `skills/<skill-name>/`.
- Supporting files such as `scripts/` and design docs can live beside `SKILL.md`.
