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
npx skills add LinKenCong/kw-skills --list

# Install one skill from this repo
npx skills add LinKenCong/kw-skills --skill git-sync-push

# Install all skills from this repo
npx skills add LinKenCong/kw-skills --skill '*'
```

## Included skills

- `figma-react-restore` — restore, implement, compare, verify, or repair Figma designs in existing React projects using local extraction and browser verification artifacts
- `figma-to-code` — extract live Figma design data through a local plugin and bridge, then translate designs into production frontend code
- `git-sync-push` — safe Git sync-and-push workflow for feature branches
- `skill-template-manager` — manager-owned skill store, reusable symlink templates, and project-level skill activation

## Notes

- Each installable skill must contain a `SKILL.md` with at least `name` and `description` in frontmatter.
- Do not commit nested `.git` directories inside `skills/<skill-name>/`.
- Supporting files such as `scripts/` and design docs can live beside `SKILL.md`.
