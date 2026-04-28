# Skill Template Manager Design

## Goal

Maintain one manager-owned skill store and expose reusable skill combinations through template directories made of symlinks.

The design intentionally makes templates floating. When a template changes, every project linked to that template changes.

## Out Of Scope

- No manager lock file.
- No project dependency freeze.
- No use of user global skill directories as the real store.
- No `npx skills -g`.

## Directory Model

```text
~/.skill-template-manager/
  store/
    <skill>/
      SKILL.md
      .stm/source.json
  templates/
    <template>/
      TEMPLATE.md
      skills/
        <skill> -> ../../../store/<skill>
  .staging/
```

## `npx skills` Integration

`npx skills` is only an upstream provider:

- `npx skills find <query>`
- `npx skills add <source> --list`
- `npx skills add <source> --agent codex --copy -y`

The final store is populated only after a staging install validates.

## Source Metadata

Each store skill records provenance:

```json
{
  "schemaVersion": 1,
  "manager": "skill-template-manager",
  "name": "example-skill",
  "source": {
    "type": "npx-skills",
    "specifier": "owner/repo@example-skill"
  },
  "installedAt": "2026-04-28T00:00:00+00:00"
}
```

This is not a lock file.

## Safety Invariants

- Store entries must contain `SKILL.md`.
- Template entries must be symlinks.
- Template symlinks must point inside the manager store.
- Project template mode only creates `.agents/skills` as a symlink.
- Existing real project `.agents/skills` directories are not overwritten.
